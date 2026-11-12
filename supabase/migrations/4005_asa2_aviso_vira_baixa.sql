-- =============================================================================
-- 4005 — ASA2, ENTREGA 1: O AVISO DO ASAAS VIRA BAIXA
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 11/11/2026: docs/integracao-asaas.md, seção 16.
--
--   * O aviso gravado pelo webhook (`gateway_webhook_events`, 4000) é
--     PROCESSADO por `_gateway_process_event`: pago → fecha a venda (D21) e dá a
--     baixa; recebido → liquidada; vencido; apagada/restaurada/alterada no
--     painel do Asaas; estorno; contestação; chave e conta.
--   * A baixa automática (`_gateway_receipt`) segue a regra de sempre, entra na
--     conta "Asaas" da unidade, grava a taxa e a data REAIS do aviso; o que vier
--     a mais é juros; o que faltar até o limite da rede (padrão R$ 0,10) fecha
--     como ARREDONDAMENTO (automático) — não é dispensa; acima disso, aviso.
--   * Pagamento de cobrança cancelada ou de parcela já paga não baixa em dobro:
--     vira PAGAMENTO EM DUPLICIDADE (`gateway_payment_surpluses`).
--   * Estorno total: a baixa é estornada e a parcela reabre, mas a taxa da rede
--     CONTINUA devida (D13); Financeiro da Franqueadora e Admin podem
--     dispensá-la com motivo (`network_fee_waive_after_refund`).
--   * A emissão passa a mandar a multa em reais e os juros proporcionais.
--
-- ⚠️ Toda função interna responde SÓ à chave de serviço (revoke de public,
-- anon e authenticated). As portas das telas de hoje não mudam.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CONFIGURAÇÃO DA REDE E COLUNAS NOVAS
-- -----------------------------------------------------------------------------
alter table public.finance_settings
  add column if not exists gateway_rounding_tolerance_cents integer;
alter table public.finance_settings
  drop constraint if exists finance_settings_rounding_tolerance_check;
alter table public.finance_settings
  add constraint finance_settings_rounding_tolerance_check
  check (gateway_rounding_tolerance_cents is null or gateway_rounding_tolerance_cents between 0 and 500);
comment on column public.finance_settings.gateway_rounding_tolerance_cents is
  'Diferença a MENOR do pagamento pelo Asaas que fecha a parcela sozinha, como arredondamento (rede; padrão 10 = R$ 0,10) (4005).';
update public.finance_settings
   set gateway_rounding_tolerance_cents = 10
 where clinic_id is null and gateway_rounding_tolerance_cents is null;

create or replace function public._gateway_rounding_tolerance()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.gateway_rounding_tolerance_cents from public.finance_settings s where s.clinic_id is null limit 1),
    10
  );
$$;
revoke execute on function public._gateway_rounding_tolerance() from public, anon, authenticated;

-- De onde veio a confirmação do pagamento da venda (D21: 'asaas').
alter table public.commercial_sales add column if not exists payment_confirmed_source text;
alter table public.direct_sales add column if not exists payment_confirmed_source text;
alter table public.payment_renegotiations add column if not exists payment_confirmed_source text;

-- A cobrança guarda o que o Asaas informou do pagamento.
alter table public.charges add column if not exists paid_cents bigint;
alter table public.charges add column if not exists paid_on date;
alter table public.charges add column if not exists credit_date date;
alter table public.charges add column if not exists receipt_id uuid references public.payment_receipts (id);
alter table public.charges add column if not exists last_event_at timestamptz;

-- A conta bancária "Asaas" da unidade (B).
alter table public.bank_accounts add column if not exists gateway_account_id uuid references public.gateway_accounts (id);
create unique index if not exists bank_accounts_gateway_unique
  on public.bank_accounts (gateway_account_id) where gateway_account_id is not null;

-- O aviso: quantas vezes foi tentado e de qual cobrança é.
alter table public.gateway_webhook_events add column if not exists attempts integer not null default 0;
alter table public.gateway_webhook_events add column if not exists charge_id uuid;
alter table public.gateway_webhook_events add column if not exists result text;
create index if not exists gateway_webhook_events_charge_idx on public.gateway_webhook_events (charge_id, received_at);

-- A dispensa ganha a natureza: a de sempre (Gerente/Admin, com motivo) ou o
-- ARREDONDAMENTO automático do Asaas (16.3) — este não é dispensa.
alter table public.payment_waivers add column if not exists kind text not null default 'dispensa';
alter table public.payment_waivers drop constraint if exists payment_waivers_kind_check;
alter table public.payment_waivers add constraint payment_waivers_kind_check
  check (kind in ('dispensa', 'arredondamento'));
alter table public.payment_waivers alter column created_by drop not null;
alter table public.payment_waivers drop constraint if exists payment_waivers_author_check;
alter table public.payment_waivers add constraint payment_waivers_author_check
  check (created_by is not null or kind = 'arredondamento');

-- A taxa da rede que continua devida depois do estorno (D13) e a dispensa dela.
alter table public.split_charges add column if not exists kept_after_refund boolean not null default false;
alter table public.split_charges add column if not exists waived_at timestamptz;
alter table public.split_charges add column if not exists waived_by uuid references public.profiles (id);
alter table public.split_charges add column if not exists waived_reason text;

-- -----------------------------------------------------------------------------
-- 1b) PAGAMENTO EM DUPLICIDADE (16.6)
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_payment_surpluses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  charge_id uuid not null references public.charges (id),
  installment_id uuid references public.payment_installments (id),
  client_id uuid references public.clients (id),
  asaas_payment_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date,
  reason text not null check (reason in ('cobranca_cancelada', 'parcela_ja_paga', 'cobranca_estornada')),
  status text not null default 'aberto' check (status in ('aberto', 'devolvido', 'abatido')),
  applied_installment_id uuid references public.payment_installments (id),
  applied_receipt_id uuid references public.payment_receipts (id),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (asaas_payment_id)
);
comment on table public.gateway_payment_surpluses is
  'Pagamento pelo Asaas de cobrança cancelada ou parcela já paga (4005): não baixa em dobro; Gerente ou Financeiro decide devolver ou abater em outra parcela.';
create index if not exists gateway_payment_surpluses_clinic_idx on public.gateway_payment_surpluses (clinic_id, status);

alter table public.gateway_payment_surpluses enable row level security;
drop policy if exists "gateway_payment_surpluses_select" on public.gateway_payment_surpluses;
create policy "gateway_payment_surpluses_select" on public.gateway_payment_surpluses
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or public.has_role_in_clinic(clinic_id, array['unit_manager', 'receptionist']::public.user_role[])
  );

-- -----------------------------------------------------------------------------
-- 1c) AVISOS (16.7) — um por fato, para os papéis certos
-- -----------------------------------------------------------------------------
create or replace function public._gateway_notify(
  p_account_id uuid,
  p_kind text,
  p_key text,
  p_clinic_id uuid,
  p_managers boolean,
  p_finance boolean,
  p_admins boolean,
  p_title text,
  p_body text,
  p_link text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
  v_n integer := 0;
begin
  insert into public.gateway_notices (account_id, kind, key)
  values (p_account_id, p_kind, coalesce(p_key, ''))
  on conflict (account_id, kind, key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then return 0; end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct u.user_id, p_clinic_id, p_title, p_body, p_link
    from (
      select ucr.user_id from public.user_clinic_roles ucr
       where p_managers and ucr.clinic_id = p_clinic_id and ucr.role = 'unit_manager'
      union
      select ucr.user_id from public.user_clinic_roles ucr
       where p_finance and ucr.role = 'finance_franchisor'
      union
      select p.id from public.profiles p
       where p_admins and p.is_admin_master and p.is_active
    ) u;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public._gateway_notify(uuid, text, text, uuid, boolean, boolean, boolean, text, text, text) from public, anon, authenticated;

-- A conta "Asaas" da unidade: criada na primeira baixa (B).
create or replace function public._gateway_bank_account(p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_clinic uuid;
begin
  select b.id into v_id from public.bank_accounts b where b.gateway_account_id = p_account_id;
  if v_id is not null then return v_id; end if;
  select a.clinic_id into v_clinic from public.gateway_accounts a where a.id = p_account_id;
  if v_clinic is null then raise exception 'GATEWAY_ACCOUNT_WITHOUT_CLINIC'; end if;
  insert into public.bank_accounts (clinic_id, alias, bank_name, bank_code, kind, opening_balance_cents, opening_date, gateway_account_id)
  values (v_clinic, 'Asaas', 'Asaas', '461', 'corrente', 0, public.today_br(), p_account_id)
  on conflict (gateway_account_id) where gateway_account_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select b.id into v_id from public.bank_accounts b where b.gateway_account_id = p_account_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public._gateway_bank_account(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A EMISSÃO COM MULTA EM REAIS E JUROS PROPORCIONAIS (16.3)
-- -----------------------------------------------------------------------------
-- As mesmas funções da 4004, com a multa em reais (`fine_cents`) e os juros
-- ajustados. O retorno muda: as três são recriadas.
alter table public.charges add column if not exists fine_cents bigint not null default 0;
alter table public.charges alter column interest_percent type numeric(9,4);

drop function if exists public.charge_preview(uuid, text, date);
drop function if exists public._charge_compute(uuid, text, date);
drop function if exists public._charge_for_gateway(uuid);

create or replace function public._charge_compute(
  p_installment_id uuid,
  p_billing_type text,
  p_due_date date
)
returns table (
  error_code text,
  clinic_id uuid,
  client_id uuid,
  gateway_account_id uuid,
  billing_type text,
  value_cents bigint,
  discount_cents bigint,
  fine_percent numeric,
  fine_cents bigint,
  interest_percent numeric,
  due_date date,
  is_overdue_reissue boolean,
  max_reissue_days integer,
  payer_kind text,
  payer_guardian_id uuid,
  payer_name text,
  payer_cpf text,
  payer_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.payment_installments%rowtype;
  v_today date := public.today_br();
  v_bal record;
  v_signed boolean;
  v_client public.clients%rowtype;
  v_guard public.client_guardians%rowtype;
  v_menor boolean;
  v_max integer := public._overdue_reissue_max_days();
  v_due date;
  v_value bigint;
  v_disc bigint := 0;
  v_fine numeric := 0;
  v_int numeric := 0;
  v_overdue boolean := false;
  v_base bigint;
  v_fine_cents bigint := 0;
begin
  max_reissue_days := v_max;
  select * into v from public.payment_installments i where i.id = p_installment_id;
  if not found then error_code := 'INSTALLMENT_NOT_FOUND'; return next; return; end if;
  clinic_id := v.clinic_id;
  client_id := v.client_id;

  if v.status not in ('em_aberto', 'parcial') then
    error_code := 'INSTALLMENT_CLOSED'; return next; return;
  end if;
  if coalesce(v.payment_method, '') in ('cartao_parcelado', 'credito_recorrente', 'deposito_avista') then
    error_code := 'METHOD_NOT_SUPPORTED'; return next; return;
  end if;
  if coalesce(p_billing_type, '') not in ('BOLETO', 'PIX', 'CREDIT_CARD') then
    error_code := 'BILLING_TYPE_INVALID'; return next; return;
  end if;
  billing_type := p_billing_type;
  if coalesce(v.grace_days, 0) > 0 then
    error_code := 'GRACE_NOT_SUPPORTED'; return next; return;
  end if;
  if exists (
    select 1 from public.charges c
     where c.payment_installment_id = v.id
       and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa')
  ) then
    error_code := 'CHARGE_ALREADY_ACTIVE'; return next; return;
  end if;

  -- Parcela de venda: o contrato já tem de estar assinado (o banco só aceita
  -- a baixa com a venda fechada; a ASA2 fecha a venda no primeiro pagamento).
  if v.renegotiation_id is null then
    if v.direct_sale_id is not null then
      select s.contract_signed into v_signed from public.direct_sales s where s.id = v.direct_sale_id;
    elsif v.negotiation_id is not null then
      select cs.contract_signed into v_signed from public.commercial_sales cs where cs.negotiation_id = v.negotiation_id;
    else
      v_signed := true;
    end if;
    if not coalesce(v_signed, false) then
      error_code := 'CONTRACT_NOT_SIGNED'; return next; return;
    end if;
  end if;

  -- A unidade tem de estar pronta (conta Asaas, termo, split…).
  if not exists (
    select 1 from public.central_unit_readiness u
     where u.clinic_id = v.clinic_id and u.marked_ready_at is not null
  ) or exists (select 1 from public._central_readiness_raw(v.clinic_id) r where not r.ok) then
    error_code := 'UNIT_NOT_READY'; return next; return;
  end if;
  gateway_account_id := public._gateway_account_of(v.clinic_id);

  -- O pagador: o responsável financeiro, quando houver; senão, o cliente.
  select * into v_client from public.clients c where c.id = v.client_id;
  if not found then error_code := 'CLIENT_NOT_FOUND'; return next; return; end if;
  select * into v_guard from public.client_guardians g where g.client_id = v.client_id and g.is_financial limit 1;
  v_menor := v_client.birth_date is not null
             and v_client.birth_date > (v_today - interval '18 years')::date;
  if v_guard.id is not null then
    payer_kind := 'guardian';
    payer_guardian_id := v_guard.id;
    payer_name := v_guard.full_name;
    payer_cpf := public.cpf_digits(v_guard.cpf);
    payer_phone := coalesce(v_guard.phone, v_client.phone);
  elsif v_menor then
    error_code := 'PAYER_REQUIRED'; return next; return;
  else
    payer_kind := 'client';
    payer_name := v_client.full_name;
    payer_cpf := public.cpf_digits(v_client.cpf);
    payer_phone := v_client.phone;
  end if;
  if not public._cpf_ok(payer_cpf) then
    error_code := case when payer_kind = 'guardian' then 'PAYER_CPF_INVALID_GUARDIAN' else 'PAYER_CPF_INVALID_CLIENT' end;
    return next; return;
  end if;

  -- O valor.
  if v.due_date >= v_today then
    -- Em dia: o valor cheio (com o benefício) e o benefício como desconto até
    -- o vencimento; multa e juros congelados na parcela.
    select * into v_bal from public.installment_balance(v.id, v.due_date);
    v_due := v.due_date;
    v_disc := least(coalesce(v.benefit_discount_cents, 0), greatest(0, v_bal.principal_rem));
    v_value := v_bal.principal_rem + v_disc;
    v_fine := coalesce(v.late_fee_percent, 2);
    v_int := coalesce(v.monthly_interest_percent, 1);
    -- 4005 (16.3): a multa vai EM REAIS, sobre o valor cheio (como o riSZon
    -- calcula), e os juros ajustados na mesma proporção — a cobrança do saldo
    -- de uma baixa parcial cobra o mesmo que o riSZon espera.
    v_base := v.amount_cents + coalesce(v.benefit_discount_cents, 0);
    v_fine_cents := round(v_base * v_fine / 100.0);
    if coalesce(v_value, 0) > 0 then
      v_int := round(v_int * v_base / v_value, 4);
    end if;
  else
    -- VENCIDA (14.3): nova data de hoje até N dias; valor atualizado ATÉ essa
    -- data; sem desconto e sem multa nova; juros mensais a partir dela.
    v_overdue := true;
    v_due := coalesce(p_due_date, v_today);
    if v_due < v_today or v_due > v_today + v_max then
      error_code := 'REISSUE_DATE_OUT_OF_RANGE'; due_date := v_due; return next; return;
    end if;
    select * into v_bal from public.installment_balance(v.id, v_due);
    v_value := v_bal.total_rem;
    v_disc := 0;
    v_fine := 0;
    v_int := coalesce(v.monthly_interest_percent, 1);
    -- 4005: juros na proporção do valor cheio (o riSZon calcula juros sobre a
    -- parcela + benefício perdido, não sobre o saldo já com multa e juros).
    v_base := v.amount_cents + coalesce(v.benefit_discount_cents, 0);
    if coalesce(v_value, 0) > 0 then
      v_int := round(v_int * v_base / v_value, 4);
    end if;
  end if;

  if coalesce(v_value, 0) <= 0 then
    error_code := 'NOTHING_TO_CHARGE'; return next; return;
  end if;

  value_cents := v_value;
  discount_cents := v_disc;
  fine_percent := v_fine;
  fine_cents := v_fine_cents;
  interest_percent := v_int;
  due_date := v_due;
  is_overdue_reissue := v_overdue;
  return next;
end;
$$;
revoke execute on function public._charge_compute(uuid, text, date) from public, anon, authenticated;

-- A prévia da tela: quem pode emitir vê a conta e o motivo da recusa. Sem CPF
-- na resposta (só o nome de quem paga).
create or replace function public.charge_preview(
  p_installment_id uuid,
  p_billing_type text,
  p_due_date date default null
)
returns table (
  error_code text,
  value_cents bigint,
  discount_cents bigint,
  fine_percent numeric,
  fine_cents bigint,
  interest_percent numeric,
  due_date date,
  is_overdue_reissue boolean,
  max_reissue_days integer,
  payer_kind text,
  payer_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select i.clinic_id into v_clinic from public.payment_installments i where i.id = p_installment_id;
  if v_clinic is null or not public._charge_can('emit', v_clinic) then
    error_code := 'NOT_ALLOWED'; return next; return;
  end if;
  return query
    select c.error_code, c.value_cents, c.discount_cents, c.fine_percent, c.fine_cents, c.interest_percent,
           c.due_date, c.is_overdue_reissue, c.max_reissue_days, c.payer_kind, c.payer_name
      from public._charge_compute(p_installment_id, p_billing_type, p_due_date) c;
end;
$$;
revoke execute on function public.charge_preview(uuid, text, date) from public, anon, authenticated;
grant execute on function public.charge_preview(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) EMITIR — a porta da tela grava a cobrança "emitindo"; o servidor fala com
--    o Asaas e grava a resposta pelas funções internas
-- -----------------------------------------------------------------------------
create or replace function public.charge_prepare(
  p_installment_id uuid,
  p_billing_type text,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v record;
  v_id uuid;
begin
  select i.clinic_id into v_clinic from public.payment_installments i where i.id = p_installment_id for update;
  if v_clinic is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not public._charge_can('emit', v_clinic) then raise exception 'NOT_ALLOWED'; end if;

  select * into v from public._charge_compute(p_installment_id, p_billing_type, p_due_date);
  if v.error_code is not null then raise exception '%', v.error_code; end if;

  insert into public.charges (
    clinic_id, gateway_account_id, source_type, payment_installment_id, client_id,
    payer_kind, payer_guardian_id, billing_type, value_cents, discount_cents,
    fine_percent, fine_cents, interest_percent, due_date, is_overdue_reissue, status, created_by
  ) values (
    v_clinic, v.gateway_account_id, 'installment', p_installment_id, v.client_id,
    v.payer_kind, v.payer_guardian_id, v.billing_type, v.value_cents, v.discount_cents,
    v.fine_percent, v.fine_cents, v.interest_percent, v.due_date, v.is_overdue_reissue, 'emitindo', (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.charge_prepare(uuid, text, date) from public, anon, authenticated;
grant execute on function public.charge_prepare(uuid, text, date) to authenticated;

-- Tentar de novo: a cobrança com erro (ou "emitindo" parada há 2 minutos)
-- volta a "emitindo". O servidor CONSULTA o Asaas pela referência antes de
-- criar de novo.
create or replace function public.charge_retry_prepare(p_charge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.charges%rowtype;
begin
  select * into v from public.charges c where c.id = p_charge_id for update;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_can('emit', v.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if not (v.status = 'erro_emissao' or (v.status = 'emitindo' and v.updated_at < now() - interval '2 minutes')) then
    raise exception 'CHARGE_NOT_RETRYABLE';
  end if;
  update public.charges c set status = 'emitindo', error_code = null where c.id = p_charge_id;
  return p_charge_id;
end;
$$;
revoke execute on function public.charge_retry_prepare(uuid) from public, anon, authenticated;
grant execute on function public.charge_retry_prepare(uuid) to authenticated;

-- O que o servidor precisa para falar com o Asaas (só a chave de serviço).
create or replace function public._charge_for_gateway(p_charge_id uuid)
returns table (
  charge_id uuid,
  status text,
  clinic_id uuid,
  gateway_account_id uuid,
  billing_type text,
  value_cents bigint,
  discount_cents bigint,
  fine_percent numeric,
  fine_cents bigint,
  interest_percent numeric,
  due_date date,
  description text,
  asaas_payment_id text,
  payer_kind text,
  payer_guardian_id uuid,
  client_id uuid,
  payer_name text,
  payer_cpf text,
  asaas_customer_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.status, c.clinic_id, c.gateway_account_id, c.billing_type, c.value_cents,
         c.discount_cents, c.fine_percent, c.fine_cents, c.interest_percent, c.due_date,
         'Parcela ' || i.seq || ' — ' || cl.name,
         c.asaas_payment_id, c.payer_kind, c.payer_guardian_id, c.client_id,
         coalesce(g.full_name, k.full_name),
         public.cpf_digits(coalesce(g.cpf, k.cpf)),
         gc.asaas_customer_id
    from public.charges c
    join public.payment_installments i on i.id = c.payment_installment_id
    join public.clinics cl on cl.id = c.clinic_id
    left join public.clients k on k.id = c.client_id
    left join public.client_guardians g on g.id = c.payer_guardian_id
    left join public.gateway_customers gc
      on gc.gateway_account_id = c.gateway_account_id
     and gc.cpf_cnpj = public.cpf_digits(coalesce(g.cpf, k.cpf))
   where c.id = p_charge_id;
$$;
revoke execute on function public._charge_for_gateway(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) D21 — a confirmação do pagamento fecha a venda (só a chave de serviço)
-- -----------------------------------------------------------------------------
-- Venda comercial: a mesma função que a assinatura digital usa (0357), sem
-- usuário, com origem 'asaas'. Venda direta e renegociação: o mesmo passo
-- "pagamento confirmado" das portas de hoje, sem a guarda de quem clica (aqui
-- não há ninguém clicando).
create or replace function public._gateway_confirm_sale(p_installment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_installments%rowtype;
  v_r public.payment_renegotiations%rowtype;
  v_d public.direct_sales%rowtype;
  v_c public.commercial_sales%rowtype;
begin
  select * into v from public.payment_installments i where i.id = p_installment_id;
  if not found then raise exception 'INSTALLMENT_NOT_FOUND'; end if;

  if v.renegotiation_id is not null then
    select * into v_r from public.payment_renegotiations r where r.id = v.renegotiation_id for update;
    if v_r.id is null or v_r.closed_at is not null or v_r.status <> 'aplicada' then return 'sem_fechamento'; end if;
    if not v_r.payment_confirmed then
      update public.payment_renegotiations
         set payment_confirmed = true, payment_confirmed_at = now(), payment_confirmed_by = null,
             payment_confirmed_source = 'asaas'
       where id = v_r.id;
    end if;
    update public.payment_renegotiations
       set closed_at = case when contract_signed and payment_confirmed then now() else null end
     where id = v_r.id;
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (null, v_r.clinic_id, 'update', 'renegotiation_close', v_r.id::text,
            jsonb_build_object('step', 'payment_confirmed', 'value', true, 'source', 'asaas'));
    return 'renegociacao';
  elsif v.direct_sale_id is not null then
    select * into v_d from public.direct_sales s where s.id = v.direct_sale_id for update;
    if v_d.id is null or v_d.closed_at is not null then return 'ja_fechada'; end if;
    if not v_d.payment_confirmed then
      update public.direct_sales
         set payment_confirmed = true, payment_confirmed_at = now(), payment_confirmed_by = null,
             payment_confirmed_source = 'asaas', updated_at = now()
       where id = v_d.id;
    end if;
    if v_d.contract_signed then
      update public.direct_sales set status = 'concluida', closed_at = now(), updated_at = now()
       where id = v_d.id;
    end if;
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (null, v_d.clinic_id, 'update', 'direct_sale_close', v_d.id::text,
            jsonb_build_object('step', 'payment_confirmed', 'value', true, 'source', 'asaas',
                               'closed', v_d.contract_signed));
    return case when v_d.contract_signed then 'venda_direta_fechada' else 'venda_direta_confirmada' end;
  elsif v.negotiation_id is not null then
    select * into v_c from public.commercial_sales cs where cs.negotiation_id = v.negotiation_id for update;
    if v_c.id is not null and v_c.closed_at is not null then return 'ja_fechada'; end if;
    perform public._commercial_close_step_raw(v.negotiation_id, 'payment_confirmed', true, null, 'asaas', null);
    update public.commercial_sales set payment_confirmed_source = 'asaas' where negotiation_id = v.negotiation_id;
    return 'venda_comercial';
  end if;
  return 'sem_venda';
end;
$$;
revoke execute on function public._gateway_confirm_sale(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) A BAIXA INTERNA (só a chave de serviço)
-- -----------------------------------------------------------------------------
-- A mesma regra de `register_payment_receipt` (0188): abate principal →
-- benefício perdido → multa → juros e lança o caixa por natureza. Diferenças:
--   * sem pessoa logada: quem deu a baixa fica vazio ("Asaas (automático)");
--   * entra na conta "Asaas" da unidade (`risarte.conta_do_dinheiro`);
--   * com `p_allow_excess`, o que vier A MAIS entra como juros (14.3);
--   * depois da baixa, a diferença a MENOR até o limite da rede fecha como
--     ARREDONDAMENTO (automático); acima, volta em `shortfall_cents`.
create or replace function public._gateway_receipt(
  p_installment_id uuid,
  p_amount_cents bigint,
  p_received_at date,
  p_payment_method text,
  p_reference text,
  p_client_token uuid,
  p_bank_account_id uuid,
  p_allow_excess boolean
)
returns table (receipt_id uuid, rounding_cents bigint, shortfall_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.payment_installments%rowtype;
  v_bal record;
  v_bal2 record;
  v_id uuid;
  v_rest bigint;
  v_p bigint; v_b bigint; v_f bigint; v_j bigint;
  v_account text;
  v_at date := coalesce(p_received_at, public.today_br());
  v_tol integer := public._gateway_rounding_tolerance();
  v_waiver uuid;
begin
  rounding_cents := 0;
  shortfall_cents := 0;
  select * into v_inst from public.payment_installments i where i.id = p_installment_id for update;
  if not found then raise exception 'INSTALLMENT_NOT_FOUND'; end if;

  if p_client_token is not null then
    select r.id into v_id from public.payment_receipts r where r.client_token = p_client_token;
    if v_id is not null then receipt_id := v_id; return next; return; end if;
  end if;

  if v_inst.status in ('cancelada', 'renegociada') then raise exception 'INSTALLMENT_CLOSED'; end if;
  if v_inst.status = 'paga' then raise exception 'INSTALLMENT_SETTLED'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_bal from public.installment_balance(p_installment_id, v_at);
  if coalesce(v_bal.total_rem, 0) <= 0 then raise exception 'INSTALLMENT_SETTLED'; end if;
  if p_amount_cents > v_bal.total_rem and not coalesce(p_allow_excess, false) then
    raise exception 'AMOUNT_OVER_BALANCE';
  end if;

  v_rest := p_amount_cents;
  v_p := least(v_rest, v_bal.principal_rem); v_rest := v_rest - v_p;
  v_b := least(v_rest, v_bal.benefit_rem);   v_rest := v_rest - v_b;
  v_f := least(v_rest, v_bal.fee_rem);       v_rest := v_rest - v_f;
  v_j := v_rest;  -- juros que faltavam + o que veio a mais

  perform set_config('risarte.baixa_do_asaas', '1', true);
  perform set_config('risarte.conta_do_dinheiro', coalesce(p_bank_account_id::text, ''), true);

  insert into public.payment_receipts (
    clinic_id, installment_id, amount_cents, received_at, payment_method,
    reference, notes, client_token, created_by,
    principal_cents, benefit_cents, late_fee_cents, interest_cents
  ) values (
    v_inst.clinic_id, p_installment_id, p_amount_cents, v_at, nullif(p_payment_method, ''),
    nullif(btrim(p_reference), ''), 'Baixa automática (Asaas)', p_client_token, null,
    v_p, v_b, v_f, v_j
  )
  returning id into v_id;

  v_account := case when v_inst.direct_sale_id is not null then '1.1.02' else '1.1.01' end;
  if v_p > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_inst.clinic_id, v_account, coalesce(v_inst.created_at::date, v_at), v_at, v_p,
      'inflow', 'settled', 'receipt_cash', v_id, 'Recebimento de parcela (Asaas)', null
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit', 'receipt_late_fee') do nothing;
  end if;
  if v_b > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_inst.clinic_id, v_account, v_at, v_at, v_b, 'inflow', 'settled',
      'receipt_benefit', v_id, 'Benefício perdido por atraso (Asaas)', null
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit', 'receipt_late_fee') do nothing;
  end if;
  if (v_f + v_j) > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_inst.clinic_id, '4.1.01', v_at, v_at, v_f + v_j, 'inflow', 'settled',
      'receipt_late_fee', v_id, 'Multa e juros por atraso (Asaas)', null
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit', 'receipt_late_fee') do nothing;
  end if;

  perform set_config('risarte.conta_do_dinheiro', '', true);
  perform set_config('risarte.baixa_do_asaas', '', true);

  -- O que faltou: até o limite da rede é arredondamento; acima, fica em aberto.
  select * into v_bal2 from public.installment_balance(p_installment_id, v_at);
  if coalesce(v_bal2.total_rem, 0) > 0 then
    if v_bal2.total_rem <= v_tol then
      insert into public.payment_waivers (
        clinic_id, installment_id, receipt_id, principal_cents, benefit_cents,
        late_fee_cents, interest_cents, total_cents, reason, created_by, kind
      ) values (
        v_inst.clinic_id, p_installment_id, v_id, v_bal2.principal_rem, v_bal2.benefit_rem,
        v_bal2.fee_rem, v_bal2.interest_rem, v_bal2.total_rem,
        'Arredondamento do Asaas (automático)', null, 'arredondamento'
      )
      returning id into v_waiver;
      if v_bal2.principal_rem > 0 then
        insert into public.financial_entries (
          clinic_id, account_code, accrual_date, amount_cents, direction, status,
          source_type, source_id, description, created_by
        ) values (
          v_inst.clinic_id, '1.9.02', v_at, v_bal2.principal_rem, 'outflow', 'open',
          'receipt_rounding', v_waiver, 'Arredondamento do Asaas (automático)', null
        );
      end if;
      rounding_cents := v_bal2.total_rem;
    else
      shortfall_cents := v_bal2.total_rem;
    end if;
  end if;

  receipt_id := v_id;
  return next;
end;
$$;
revoke execute on function public._gateway_receipt(uuid, bigint, date, text, text, uuid, uuid, boolean) from public, anon, authenticated;

-- A taxa e a data REAIS do aviso (C): valor menos valor líquido; data do crédito.
create or replace function public._gateway_apply_fee(
  p_receipt_id uuid,
  p_fee_cents bigint,
  p_settle date,
  p_account_id uuid,
  p_billing_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.payment_receipts%rowtype;
  v_acq uuid;
  v_name text;
  v_modality text := case p_billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto'
                                         when 'CREDIT_CARD' then 'credito_avista' else null end;
  v_fee bigint := greatest(coalesce(p_fee_cents, 0), 0);
  v_settle date;
begin
  select * into v_rec from public.payment_receipts r where r.id = p_receipt_id;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if v_rec.acquirer_id is not null or coalesce(v_rec.acquirer_fee_cents, 0) > 0 then return; end if;
  v_settle := coalesce(p_settle, v_rec.received_at);
  select a.id, a.name into v_acq, v_name from public.card_acquirers a where a.gateway_account_id = p_account_id limit 1;

  update public.payment_receipts set
    acquirer_id = v_acq,
    acquirer_modality = v_modality,
    acquirer_fee_cents = v_fee,
    acquirer_fixed_fee_cents = 0,
    acquirer_fee_percent = case when v_rec.amount_cents > 0 then round(v_fee * 100.0 / v_rec.amount_cents, 4) else 0 end,
    acquirer_fee_waived = false,
    acquirer_fee_charged_at_issue = false,
    settlement_date = v_settle
  where id = p_receipt_id;

  if v_fee > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, created_by
    ) values (
      v_rec.clinic_id, '2.4.01', v_rec.received_at, v_settle, v_settle, v_fee, 'outflow', 'settled',
      'acquirer_fee', p_receipt_id, 'Taxa do Asaas — ' || coalesce(v_modality, 'cobrança'), null
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee',
       'acquirer_fee', 'boleto_issue') do nothing;
  end if;

  update public.financial_entries
     set cash_date = v_settle, expected_settlement_date = v_settle
   where source_type = 'receipt_cash' and source_id = p_receipt_id;
end;
$$;
revoke execute on function public._gateway_apply_fee(uuid, bigint, date, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) ESTORNO PELO ASAAS E A TAXA DA REDE QUE CONTINUA DEVIDA (16.5)
-- -----------------------------------------------------------------------------
-- A taxa da rede da baixa estornada fica marcada como mantida: o gatilho da
-- taxa (0370) não a desfaz. Só a dispensa manual a desfaz.
create or replace function public.apply_receipt_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reversal_of is not null then
    return null;
  end if;
  -- 4005 (D13): estorno pelo Asaas — a taxa da rede continua devida.
  if coalesce(new.reversed, false) and exists (
    select 1 from public.split_charges s
     where s.receipt_id = new.id and s.kept_after_refund and s.waived_at is null
  ) then
    return null;
  end if;
  perform public._apply_fee_split(
    new.clinic_id, 'receipt', new.id, new.amount_cents, new.received_at,
    coalesce(new.reversed, false)
  );
  return null;
end;
$$;
revoke execute on function public.apply_receipt_split() from public, anon, authenticated;

-- O estorno pela via do Asaas: o mesmo de `reverse_payment_receipt` (0204),
-- sem pessoa logada, e SEM devolver a taxa do Asaas (o Asaas não a devolve).
create or replace function public._gateway_reverse_receipt(p_receipt_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.payment_receipts%rowtype;
  v_new uuid;
begin
  select * into v_rec from public.payment_receipts r where r.id = p_receipt_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if v_rec.reversed then
    select r.id into v_new from public.payment_receipts r where r.reversal_of = p_receipt_id limit 1;
    return v_new;
  end if;

  update public.split_charges set kept_after_refund = true where receipt_id = p_receipt_id;
  update public.payment_receipts set reversed = true where id = p_receipt_id;

  perform set_config('risarte.baixa_do_asaas', '1', true);
  insert into public.payment_receipts (
    clinic_id, installment_id, amount_cents, received_at, payment_method,
    reference, reversal_of, reversal_reason, reversed, created_by,
    principal_cents, benefit_cents, late_fee_cents, interest_cents
  ) values (
    v_rec.clinic_id, v_rec.installment_id, v_rec.amount_cents, public.today_br(),
    v_rec.payment_method, v_rec.reference, p_receipt_id, btrim(p_reason), true, null,
    v_rec.principal_cents, v_rec.benefit_cents, v_rec.late_fee_cents, v_rec.interest_cents
  )
  returning id into v_new;
  perform set_config('risarte.baixa_do_asaas', '', true);

  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description,
    reversal_of, reversal_reason, created_by
  )
  select e.clinic_id, e.account_code, e.accrual_date, public.today_br(), e.amount_cents,
         case when e.direction = 'inflow' then 'outflow' else 'inflow' end,
         'settled', e.source_type, v_new,
         'Estorno no Asaas — ' || coalesce(e.description, 'recebimento'),
         e.id, btrim(p_reason), null
    from public.financial_entries e
   where e.source_id = p_receipt_id
     and e.source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee')
     and e.reversal_of is null;

  update public.financial_entries set status = 'reversed'
   where source_id = p_receipt_id
     and source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee')
     and reversal_of is null;

  return v_new;
end;
$$;
revoke execute on function public._gateway_reverse_receipt(uuid, text) from public, anon, authenticated;

-- A dispensa manual da taxa mantida: Financeiro da Franqueadora e Admin, com
-- motivo (ex.: pagamento em duplicidade devolvido).
create or replace function public.network_fee_waive_after_refund(p_receipt_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.payment_receipts%rowtype;
  v_n integer;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_rec from public.payment_receipts r where r.id = p_receipt_id;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  update public.split_charges
     set waived_at = now(), waived_by = (select auth.uid()), waived_reason = btrim(p_reason)
   where receipt_id = p_receipt_id and kept_after_refund and waived_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NOTHING_TO_WAIVE'; end if;
  perform public._apply_fee_split(v_rec.clinic_id, 'receipt', v_rec.id, v_rec.amount_cents, v_rec.received_at, true);
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), v_rec.clinic_id, 'update', 'network_fee_waiver', p_receipt_id::text,
          jsonb_build_object('reason', btrim(p_reason), 'fees', v_n));
  return v_n;
end;
$$;
revoke execute on function public.network_fee_waive_after_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.network_fee_waive_after_refund(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) PAGAMENTO EM DUPLICIDADE: registrar e resolver (16.6)
-- -----------------------------------------------------------------------------
create or replace function public._gateway_surplus_can(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or public.is_finance_franchisor()
      or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[]);
$$;
revoke execute on function public._gateway_surplus_can(uuid) from public, anon, authenticated;

-- Devolvido ao pagador (a devolução em si é feita no painel do Asaas).
create or replace function public.gateway_surplus_mark_refunded(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.gateway_payment_surpluses%rowtype;
begin
  select * into v from public.gateway_payment_surpluses s where s.id = p_id for update;
  if not found then raise exception 'SURPLUS_NOT_FOUND'; end if;
  if not public._gateway_surplus_can(v.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v.status <> 'aberto' then raise exception 'SURPLUS_ALREADY_RESOLVED'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  update public.gateway_payment_surpluses
     set status = 'devolvido', resolved_at = now(), resolved_by = (select auth.uid()), resolution_note = btrim(p_note)
   where id = p_id;
end;
$$;
revoke execute on function public.gateway_surplus_mark_refunded(uuid, text) from public, anon, authenticated;
grant execute on function public.gateway_surplus_mark_refunded(uuid, text) to authenticated;

-- Abatido em outra parcela do mesmo cliente: vira a baixa daquela parcela, na
-- conta "Asaas", até o saldo dela (nunca a mais).
create or replace function public.gateway_surplus_apply(p_id uuid, p_installment_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.gateway_payment_surpluses%rowtype;
  v_c public.charges%rowtype;
  v_t public.payment_installments%rowtype;
  v_r record;
  v_method text;
begin
  select * into v from public.gateway_payment_surpluses s where s.id = p_id for update;
  if not found then raise exception 'SURPLUS_NOT_FOUND'; end if;
  if not public._gateway_surplus_can(v.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v.status <> 'aberto' then raise exception 'SURPLUS_ALREADY_RESOLVED'; end if;
  select * into v_t from public.payment_installments i where i.id = p_installment_id;
  if not found then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if v_t.client_id is distinct from v.client_id or v_t.clinic_id <> v.clinic_id then raise exception 'INSTALLMENT_OF_OTHER_CLIENT'; end if;
  if public._installment_has_active_charge(p_installment_id, true) then raise exception 'CHARGE_IN_GATEWAY'; end if;
  select * into v_c from public.charges c where c.id = v.charge_id;
  v_method := case v_c.billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto' when 'CREDIT_CARD' then 'cartao' end;
  select * into v_r from public._gateway_receipt(
    p_installment_id, v.amount_cents, coalesce(v.paid_on, public.today_br()), v_method,
    'Asaas ' || v.asaas_payment_id || ' (duplicidade abatida)',
    md5('asaas-surplus:' || v.id::text)::uuid,
    public._gateway_bank_account(v_c.gateway_account_id), false);
  update public.gateway_payment_surpluses
     set status = 'abatido', applied_installment_id = p_installment_id, applied_receipt_id = v_r.receipt_id,
         resolved_at = now(), resolved_by = (select auth.uid()),
         resolution_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  return v_r.receipt_id;
end;
$$;
revoke execute on function public.gateway_surplus_apply(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.gateway_surplus_apply(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O PROCESSAMENTO DO AVISO
-- -----------------------------------------------------------------------------
-- Pago (confirmado ou recebido): D21, baixa, taxa real, situação.
create or replace function public._gateway_on_paid(p_charge_id uuid, p_event text, p_payment jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  i public.payment_installments%rowtype;
  v_pid text := p_payment->>'id';
  v_paid bigint := round(coalesce((p_payment->>'value')::numeric, 0) * 100);
  v_net bigint := round((p_payment->>'netValue')::numeric * 100);
  v_on date := coalesce((p_payment->>'clientPaymentDate')::date, (p_payment->>'paymentDate')::date,
                        (p_payment->>'confirmedDate')::date, public.today_br());
  v_credit date := coalesce((p_payment->>'creditDate')::date, (p_payment->>'estimatedCreditDate')::date);
  v_final text := case when p_event = 'PAYMENT_CONFIRMED' then 'paga' else 'liquidada' end;
  v_reason text;
  v_r record;
  v_method text;
  v_link text;
begin
  select * into c from public.charges ch where ch.id = p_charge_id for update;
  v_link := '/prontuarios/' || c.client_id::text;

  -- Já baixada por esta cobrança: só a liquidação (o dinheiro caiu).
  if c.receipt_id is not null then
    if v_final = 'liquidada' and c.status = 'paga' then
      update public.charges set status = 'liquidada', credit_date = coalesce(v_credit, credit_date), last_event_at = now()
       where id = c.id;
      if v_credit is not null then
        update public.payment_receipts set settlement_date = v_credit where id = c.receipt_id;
        update public.financial_entries set cash_date = v_credit, expected_settlement_date = v_credit
         where source_id = c.receipt_id and source_type in ('receipt_cash', 'acquirer_fee') and reversal_of is null;
      end if;
      return 'liquidada';
    end if;
    return 'ja_baixada';
  end if;

  select * into i from public.payment_installments pi where pi.id = c.payment_installment_id for update;

  -- Duplicidade (16.6): cobrança encerrada ou parcela já paga.
  v_reason := case
    when c.status = 'cancelada' or c.is_external then 'cobranca_cancelada'
    when c.status = 'estornada' then 'cobranca_estornada'
    when i.status in ('paga', 'cancelada', 'renegociada') then 'parcela_ja_paga'
    else null end;
  if v_reason is not null then
    insert into public.gateway_payment_surpluses
      (clinic_id, charge_id, installment_id, client_id, asaas_payment_id, amount_cents, paid_on, reason)
    values (c.clinic_id, c.id, c.payment_installment_id, c.client_id, v_pid, greatest(v_paid, 1), v_on, v_reason)
    on conflict (asaas_payment_id) do nothing;
    update public.charges set paid_cents = v_paid, paid_on = v_on, last_event_at = now() where id = c.id;
    perform public._gateway_notify(c.gateway_account_id, 'duplicidade', v_pid, c.clinic_id, true, true, false,
      'Pagamento em duplicidade',
      'Um pagamento pelo Asaas chegou para uma cobrança cancelada ou parcela já paga. Decida entre devolver ou abater em outra parcela.',
      v_link);
    return 'duplicidade';
  end if;

  -- D21: a confirmação do pagamento fecha a venda (antes da baixa).
  perform public._gateway_confirm_sale(i.id);

  v_method := case c.billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto' when 'CREDIT_CARD' then 'cartao' end;
  select * into v_r from public._gateway_receipt(
    i.id, v_paid, v_on, v_method, 'Asaas ' || v_pid,
    md5('asaas-receipt:' || v_pid)::uuid,
    public._gateway_bank_account(c.gateway_account_id), true);

  if v_net is not null then
    perform public._gateway_apply_fee(v_r.receipt_id, v_paid - v_net, coalesce(v_credit, v_on), c.gateway_account_id, c.billing_type);
  end if;

  update public.charges
     set status = v_final, paid_cents = v_paid, paid_on = v_on, credit_date = v_credit,
         receipt_id = v_r.receipt_id, last_event_at = now()
   where id = c.id;

  if v_r.shortfall_cents > 0 then
    perform public._gateway_notify(c.gateway_account_id, 'pago_a_menor', v_pid, c.clinic_id, true, false, false,
      'Pagamento pelo Asaas abaixo do devido',
      'A parcela recebeu pelo Asaas um valor menor que o devido; o saldo ficou em aberto. Receba ou quite por valor menor.',
      v_link);
  end if;
  return 'baixa';
end;
$$;
revoke execute on function public._gateway_on_paid(uuid, text, jsonb) from public, anon, authenticated;

-- O que cada aviso faz (16.2). Erro aqui vira `error` no aviso (quem chama
-- trata), nunca resposta diferente de 200 ao Asaas.
create or replace function public._gateway_apply_event(p_event_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.gateway_webhook_events%rowtype;
  p jsonb;
  v_ref text;
  c public.charges%rowtype;
  v_link text;
  v_other boolean;
  v_rec public.payment_receipts%rowtype;
begin
  select * into e from public.gateway_webhook_events w where w.id = p_event_id;

  -- Chave e situação da conta: aviso ao Admin.
  if e.event like 'ACCESS_TOKEN_%' or e.event like 'ACCOUNT_STATUS_%' then
    perform public._gateway_notify_admins(e.account_id, lower(e.event), e.asaas_event_id,
      'Asaas: atenção na conta',
      'O Asaas avisou: ' || e.event || '. Confira a conta na Central de Configuração.');
    return 'aviso_admin';
  end if;
  if e.event not like 'PAYMENT_%' then return 'sem_efeito'; end if;
  if e.event like 'PAYMENT_SPLIT_%' then return 'registrado_asa3'; end if;

  p := e.payload->'payment';
  if p is null then return 'ignorado_sem_cobranca'; end if;
  v_ref := p->>'externalReference';
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'ignorado_fora_do_riszon';
  end if;
  select * into c from public.charges ch where ch.id = v_ref::uuid and ch.gateway_account_id = e.account_id for update;
  if not found then return 'ignorado_fora_do_riszon'; end if;
  if c.asaas_payment_id is not null and c.asaas_payment_id <> coalesce(p->>'id', '') then
    return 'ignorado_outra_cobranca';
  end if;
  update public.gateway_webhook_events set charge_id = c.id where id = e.id;
  if c.asaas_payment_id is null then
    update public.charges set asaas_payment_id = p->>'id' where id = c.id;
  end if;
  v_link := '/prontuarios/' || c.client_id::text;

  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    return public._gateway_on_paid(c.id, case when e.event = 'PAYMENT_CONFIRMED' then 'PAYMENT_CONFIRMED' else 'PAYMENT_RECEIVED' end, p);

  elsif e.event = 'PAYMENT_OVERDUE' then
    if c.status = 'emitida' then
      update public.charges set status = 'vencida', last_event_at = now() where id = c.id;
      return 'vencida';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_DELETED' then
    if c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
      update public.charges
         set status = 'cancelada', cancelled_at = now(), cancelled_by = null,
             cancel_reason = 'Apagada no painel do Asaas', last_event_at = now()
       where id = c.id;
      perform public._gateway_notify(c.gateway_account_id, 'apagada_no_asaas', c.id::text, c.clinic_id, true, false, true,
        'Cobrança apagada no Asaas',
        'Uma cobrança emitida pelo riSZon foi apagada direto no painel do Asaas. A parcela voltou a aceitar nova cobrança.',
        v_link);
      return 'cancelada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_RESTORED' then
    select exists (
      select 1 from public.charges o
       where o.payment_installment_id = c.payment_installment_id and o.id <> c.id
         and o.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa')
    ) into v_other;
    if c.status = 'cancelada' and c.cancel_reason = 'Apagada no painel do Asaas' and not v_other
       and exists (select 1 from public.payment_installments i
                    where i.id = c.payment_installment_id and i.status in ('em_aberto', 'parcial')) then
      update public.charges
         set status = case when c.due_date < public.today_br() then 'vencida' else 'emitida' end,
             cancelled_at = null, cancel_reason = null, last_event_at = now()
       where id = c.id;
      return 'restaurada';
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'restaurada_no_asaas', c.id::text, c.clinic_id, true, false, true,
      'Cobrança restaurada no Asaas',
      'Uma cobrança foi restaurada no painel do Asaas, mas a parcela já tem outra cobrança ou não está em aberto. Confira e cancele a que sobrar.',
      v_link);
    return 'restaurada_so_aviso';

  elsif e.event = 'PAYMENT_UPDATED' then
    if round(coalesce((p->>'value')::numeric, 0) * 100) <> coalesce(c.value_cents, 0)
       or (p->>'dueDate')::date is distinct from c.due_date then
      perform public._gateway_notify(c.gateway_account_id, 'alterada_no_asaas', e.asaas_event_id, c.clinic_id, true, false, true,
        'Cobrança alterada no Asaas',
        'Uma cobrança emitida pelo riSZon teve valor ou vencimento alterado direto no painel do Asaas. O riSZon não segue a mudança; o pagamento segue a regra do valor a maior ou a menor.',
        v_link);
      return 'alterada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_REFUNDED' then
    if c.receipt_id is not null then
      select * into v_rec from public.payment_receipts r where r.id = c.receipt_id;
      if not v_rec.reversed then
        perform public._gateway_reverse_receipt(c.receipt_id, 'Estorno no Asaas');
      end if;
    end if;
    if c.status in ('paga', 'liquidada', 'em_contestacao') then
      update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
      'Estorno no Asaas',
      'Um pagamento pelo Asaas foi estornado. A baixa foi desfeita e a parcela voltou a ficar em aberto; a taxa da rede continua devida (pode ser dispensada pelo Financeiro).',
      v_link);
    return 'estornada';

  elsif e.event in ('PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE') then
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), e.asaas_event_id, c.clinic_id, true, true, true,
      'Asaas: estorno para tratar à mão',
      'O Asaas avisou ' || e.event || ' numa cobrança do riSZon. O Financeiro trata à mão.',
      v_link);
    return 'aviso_manual';

  elsif e.event in ('PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL') then
    if c.status in ('paga', 'liquidada') then
      update public.charges set status = 'em_contestacao', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), c.id::text, c.clinic_id, true, true, true,
      'Contestação no cartão',
      'O pagador contestou no cartão uma cobrança do riSZon (' || e.event || '). O Financeiro acompanha e trata à mão.',
      v_link);
    return 'contestacao';
  end if;

  return 'sem_efeito';
end;
$$;
revoke execute on function public._gateway_apply_event(bigint) from public, anon, authenticated;

-- Processa um aviso: tenta, grava o resultado ou o erro. Nunca levanta erro.
create or replace function public._gateway_process_event(p_event_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.gateway_webhook_events%rowtype;
  v_result text;
begin
  select * into e from public.gateway_webhook_events w where w.id = p_event_id for update skip locked;
  if not found then return 'ocupado'; end if;
  if e.processed_at is not null then return coalesce(e.result, 'processado'); end if;
  update public.gateway_webhook_events set attempts = attempts + 1 where id = p_event_id;
  begin
    v_result := public._gateway_apply_event(p_event_id);
    update public.gateway_webhook_events
       set processed_at = now(), error = null, result = v_result
     where id = p_event_id;
  exception when others then
    update public.gateway_webhook_events
       set error = left(sqlstate || ' ' || sqlerrm, 400), result = 'erro'
     where id = p_event_id;
    v_result := 'erro';
  end;
  return v_result;
end;
$$;
revoke execute on function public._gateway_process_event(bigint) from public, anon, authenticated;

-- Os pendentes, na ordem em que chegaram (o webhook chama com a conta; a
-- rotina diária, com todas).
create or replace function public._gateway_process_pending(p_account_id uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_n integer := 0;
begin
  for v_id in
    select w.id from public.gateway_webhook_events w
     where w.processed_at is null
       and (p_account_id is null or w.account_id = p_account_id)
       and w.attempts < 20
     order by w.received_at, w.id
     limit greatest(coalesce(p_limit, 50), 1)
  loop
    perform public._gateway_process_event(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public._gateway_process_pending(uuid, integer) from public, anon, authenticated;

-- O botão "Reprocessar" (Admin Master).
create or replace function public.gateway_reprocess_event(p_event_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  return public._gateway_process_event(p_event_id);
end;
$$;
revoke execute on function public.gateway_reprocess_event(bigint) from public, anon, authenticated;
grant execute on function public.gateway_reprocess_event(bigint) to authenticated;

-- O Admin Master lê os avisos (para a lista dos com erro).
drop policy if exists "gateway_webhook_events_admin_select" on public.gateway_webhook_events;
create policy "gateway_webhook_events_admin_select" on public.gateway_webhook_events
  for select to authenticated
  using (public.is_admin_master());

-- O resumo diário das vencidas, por unidade (16.7).
create or replace function public._gateway_overdue_summary()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select c.gateway_account_id, c.clinic_id, count(*)::integer as n
      from public.charges c
     where c.status = 'vencida' and c.gateway_account_id is not null
     group by c.gateway_account_id, c.clinic_id
  loop
    v_n := v_n + public._gateway_notify(r.gateway_account_id, 'resumo_vencidas', public.today_br()::text, r.clinic_id,
      true, false, false,
      'Cobranças vencidas: ' || r.n,
      r.n || ' cobrança(s) do Asaas vencida(s) nesta unidade. Veja os pacientes em Prontuários (filtro de cobrança em atraso).',
      '/prontuarios?cobranca=atraso');
  end loop;
  return v_n;
end;
$$;
revoke execute on function public._gateway_overdue_summary() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_gateway_process_event', '_gateway_apply_event', '_gateway_on_paid', '_gateway_receipt',
      '_gateway_apply_fee', '_gateway_reverse_receipt', '_gateway_confirm_sale',
      'network_fee_waive_after_refund', 'gateway_surplus_apply', 'gateway_surplus_mark_refunded',
      'gateway_reprocess_event', '_gateway_overdue_summary')) as funcoes,
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'gateway_payment_surpluses') as tabela_duplicidade,
  (select gateway_rounding_tolerance_cents from public.finance_settings where clinic_id is null) as arredondamento_centavos,
  (select count(*) from public.gateway_webhook_events where processed_at is null) as avisos_pendentes;
