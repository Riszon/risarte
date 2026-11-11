-- =============================================================================
-- 4004 — ASA1, ENTREGA 2: a cobrança de parcela pelo Asaas, as travas, a
-- quitação por valor menor e o limite de dias da reemissão
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 11/11/2026: docs/integracao-asaas.md, seção 14.
--
--   * `gateway_customers` — o pagador no Asaas, POR CPF/CNPJ E POR CONTA (um
--     responsável que também é cliente vira um cliente só no Asaas). O dono
--     do vínculo (cliente, responsável ou empresa) é só para rastrear.
--   * `charges` — cada cobrança. O `id` dela é o `externalReference` no Asaas
--     (estável: a parcela pode ganhar várias cobranças ao longo do tempo, mas
--     só UMA ativa). Nasce aceitando as origens e os meios das próximas fases;
--     na ASA1 só `installment` com BOLETO, PIX ou CREDIT_CARD é emitida — o
--     resto é recusado por regra.
--   * `payment_waivers` — a DISPENSA da quitação por valor menor (Gerente da
--     unidade ou Admin Master, motivo obrigatório). Abate juros → multa →
--     benefício perdido → principal; só o principal dispensado vai ao razão
--     (1.9.02). `installment_balance` passa a descontar a dispensa do que falta.
--   * TRAVAS: parcela com cobrança ativa não muda valor, vencimento, condições
--     nem meio, não é apagada, não é cancelada nem renegociada; e não recebe
--     baixa manual enquanto a cobrança do Asaas está ativa (a cobrança
--     EXTERNA, D17, continua com baixa manual).
--   * `finance_settings.overdue_reissue_max_days` — até quantos dias à frente
--     a parcela VENCIDA pode ganhar nova cobrança (rede; padrão 7).
--
-- ⚠️ Nenhuma chamada ao Asaas sai do banco: o servidor do riSZon prepara pela
-- porta (`charge_prepare`), fala com o Asaas e grava a resposta pelas funções
-- `_charge_*` (só a chave de serviço).
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O LIMITE DE DIAS DA REEMISSÃO (rede, padrão 7)
-- -----------------------------------------------------------------------------
alter table public.finance_settings
  add column if not exists overdue_reissue_max_days integer;

alter table public.finance_settings
  drop constraint if exists finance_settings_reissue_days_check;
alter table public.finance_settings
  add constraint finance_settings_reissue_days_check
  check (overdue_reissue_max_days is null or overdue_reissue_max_days between 0 and 30);

comment on column public.finance_settings.overdue_reissue_max_days is
  'Parcela vencida: a nova cobrança pode vencer de hoje até N dias corridos à frente (rede; padrão 7). Acima disso, renegociação (4004).';

update public.finance_settings
   set overdue_reissue_max_days = 7
 where clinic_id is null and overdue_reissue_max_days is null;

create or replace function public._overdue_reissue_max_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.overdue_reissue_max_days from public.finance_settings s where s.clinic_id is null limit 1),
    7
  );
$$;

revoke execute on function public._overdue_reissue_max_days() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) O PAGADOR NO ASAAS
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_customers (
  id uuid primary key default gen_random_uuid(),
  gateway_account_id uuid not null references public.gateway_accounts (id),
  cpf_cnpj text not null check (cpf_cnpj ~ '^[0-9]{11}$|^[0-9]{14}$'),
  asaas_customer_id text not null,
  -- De quem é (rastreio): o cliente, um responsável ou uma empresa (ASA5).
  owner_kind text not null check (owner_kind in ('client', 'guardian', 'company')),
  client_id uuid references public.clients (id),
  guardian_id uuid references public.client_guardians (id) on delete set null,
  company_id uuid,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (gateway_account_id, cpf_cnpj)
);

alter table public.gateway_customers enable row level security;

drop policy if exists "gateway_customers_select" on public.gateway_customers;
create policy "gateway_customers_select" on public.gateway_customers
  for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor());

-- -----------------------------------------------------------------------------
-- 3) AS COBRANÇAS
-- -----------------------------------------------------------------------------
create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  gateway_account_id uuid references public.gateway_accounts (id),
  -- Origens: na ASA1 só 'installment' (parcela de tratamento, venda direta ou
  -- renegociação). As outras são das próximas fases.
  source_type text not null check (source_type in (
    'installment', 'ppr_charge', 'ortho_charge', 'corporate_implementation',
    'corporate_monthly', 'franchise_monthly', 'ad_hoc')),
  payment_installment_id uuid references public.payment_installments (id),
  client_id uuid references public.clients (id),
  payer_kind text check (payer_kind in ('client', 'guardian', 'company')),
  payer_guardian_id uuid references public.client_guardians (id) on delete set null,
  gateway_customer_id uuid references public.gateway_customers (id),
  -- Meios: na ASA1 BOLETO, PIX e CREDIT_CARD (à vista, pela fatura do Asaas).
  billing_type text check (billing_type in (
    'BOLETO', 'PIX', 'CREDIT_CARD', 'PIX_AUTOMATIC', 'CREDIT_CARD_RECURRING')),
  value_cents bigint check (value_cents is null or value_cents > 0),
  -- Desconto de pontualidade (válido até o vencimento), multa e juros enviados.
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  fine_percent numeric(5,2) not null default 0,
  interest_percent numeric(5,2) not null default 0,
  due_date date,
  -- Reemissão de parcela VENCIDA (valor atualizado até a nova data).
  is_overdue_reissue boolean not null default false,
  description text,
  status text not null check (status in (
    'emitindo', 'emitida', 'paga', 'liquidada', 'vencida', 'cancelada',
    'estornada', 'em_contestacao', 'erro_emissao', 'externa')),
  -- D17: cobrança emitida direto no Asaas, fora do riSZon.
  is_external boolean not null default false,
  external_note text,
  asaas_payment_id text,
  invoice_url text,
  bank_slip_url text,
  pix_copy_paste text,
  identification_field text,
  error_code text,
  attempts integer not null default 0,
  issued_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  constraint charges_installment_source_check check (
    source_type <> 'installment' or payment_installment_id is not null)
);

comment on table public.charges is
  'Cobranças do Asaas (4004). O id é o externalReference no Asaas. Uma ativa por parcela.';

create unique index if not exists charges_asaas_payment_unique
  on public.charges (asaas_payment_id) where asaas_payment_id is not null;
-- UMA cobrança ativa por parcela (a mesma parcela pode ter várias no tempo).
create unique index if not exists charges_one_active_per_installment
  on public.charges (payment_installment_id)
  where status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa');
create index if not exists charges_client_idx on public.charges (client_id, created_at desc);
create index if not exists charges_clinic_idx on public.charges (clinic_id, status);

alter table public.charges enable row level security;

-- Lê quem lê a parcela (a mesma regra de linha de `payment_installments`).
drop policy if exists "charges_select" on public.charges;
create policy "charges_select" on public.charges
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or exists (select 1 from public.payment_installments i where i.id = payment_installment_id)
  );

create or replace function public.charges_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.charges_touch() from public, anon, authenticated;

drop trigger if exists charges_touch on public.charges;
create trigger charges_touch before update on public.charges
  for each row execute function public.charges_touch();

-- Cobrança nunca é apagada (histórico).
create or replace function public.charges_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CHARGE_NO_DELETE';
end;
$$;
revoke execute on function public.charges_no_delete() from public, anon, authenticated;

drop trigger if exists charges_no_delete on public.charges;
create trigger charges_no_delete before delete on public.charges
  for each row execute function public.charges_no_delete();

-- -----------------------------------------------------------------------------
-- 4) A DISPENSA (quitação por valor menor)
-- -----------------------------------------------------------------------------
create table if not exists public.payment_waivers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  installment_id uuid not null references public.payment_installments (id),
  receipt_id uuid references public.payment_receipts (id),
  principal_cents bigint not null default 0 check (principal_cents >= 0),
  benefit_cents bigint not null default 0 check (benefit_cents >= 0),
  late_fee_cents bigint not null default 0 check (late_fee_cents >= 0),
  interest_cents bigint not null default 0 check (interest_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  reason text not null check (length(btrim(reason)) >= 5),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

comment on table public.payment_waivers is
  'Dispensa da quitação por valor menor (4004): o que deixou de ser cobrado, por natureza, com autor e motivo. Lido pelo painel de repasses (ASA3).';

create index if not exists payment_waivers_installment_idx on public.payment_waivers (installment_id);
create index if not exists payment_waivers_clinic_idx on public.payment_waivers (clinic_id, created_at desc);

alter table public.payment_waivers enable row level security;

drop policy if exists "payment_waivers_select" on public.payment_waivers;
create policy "payment_waivers_select" on public.payment_waivers
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or exists (select 1 from public.payment_installments i where i.id = installment_id)
  );

-- Dispensa não se altera nem se apaga (é o registro do que foi perdoado).
create or replace function public.payment_waivers_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'WAIVER_IMMUTABLE';
end;
$$;
revoke execute on function public.payment_waivers_immutable() from public, anon, authenticated;

drop trigger if exists payment_waivers_immutable on public.payment_waivers;
create trigger payment_waivers_immutable before update or delete on public.payment_waivers
  for each row execute function public.payment_waivers_immutable();

-- A situação da parcela é recalculada também quando nasce uma dispensa.
drop trigger if exists payment_waivers_refresh on public.payment_waivers;
create trigger payment_waivers_refresh after insert on public.payment_waivers
  for each row execute function public.refresh_installment_payment();

-- -----------------------------------------------------------------------------
-- 5) O SALDO DA PARCELA passa a descontar a dispensa (mesmo retorno da 0188)
-- -----------------------------------------------------------------------------
-- "Pago" continua sendo só o que ENTROU (as baixas); a dispensa só reduz o
-- que FALTA. Assim `paid_amount_cents` segue dizendo quanto dinheiro entrou.
create or replace function public.installment_balance(
  p_installment_id uuid,
  p_date date default current_date
)
returns table (
  days_late integer,
  principal_due bigint, principal_paid bigint, principal_rem bigint,
  benefit_due bigint,   benefit_paid bigint,   benefit_rem bigint,
  fee_due bigint,       fee_paid bigint,       fee_rem bigint,
  interest_due bigint,  interest_paid bigint,  interest_rem bigint,
  total_rem bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_days integer;
  v_base bigint;
  v_pp bigint; v_pb bigint; v_pf bigint; v_pi bigint;
  v_wp bigint; v_wb bigint; v_wf bigint; v_wi bigint;
  v_bd bigint; v_fd bigint; v_jd bigint;
begin
  select * into v from public.payment_installments where id = p_installment_id;
  if v.id is null then return; end if;
  select coalesce(sum(r.principal_cents), 0), coalesce(sum(r.benefit_cents), 0),
         coalesce(sum(r.late_fee_cents), 0),  coalesce(sum(r.interest_cents), 0)
    into v_pp, v_pb, v_pf, v_pi
  from public.payment_receipts r
  where r.installment_id = p_installment_id
    and not r.reversed and r.reversal_of is null;
  -- 4004: o que foi DISPENSADO (quitação por valor menor).
  select coalesce(sum(w.principal_cents), 0), coalesce(sum(w.benefit_cents), 0),
         coalesce(sum(w.late_fee_cents), 0),  coalesce(sum(w.interest_cents), 0)
    into v_wp, v_wb, v_wf, v_wi
  from public.payment_waivers w
  where w.installment_id = p_installment_id;

  if v.status in ('cancelada', 'renegociada') then
    days_late := 0;
    principal_due := v.amount_cents; principal_paid := v_pp; principal_rem := 0;
    benefit_due := 0;  benefit_paid := v_pb;  benefit_rem := 0;
    fee_due := 0;      fee_paid := v_pf;      fee_rem := 0;
    interest_due := 0; interest_paid := v_pi; interest_rem := 0;
    total_rem := 0;
    return next;
    return;
  end if;
  v_days := greatest(0, (coalesce(p_date, current_date) - v.due_date)
                        - coalesce(v.grace_days, 0));
  v_bd := case when v_days > 0
               then coalesce(v.benefit_discount_cents, 0) else 0 end;
  v_base := v.amount_cents + v_bd;
  if v_days > 0 then
    v_fd := round(v_base * coalesce(v.late_fee_percent, 2) / 100.0);
    v_jd := round(v_base * coalesce(v.monthly_interest_percent, 1)
                  / 100.0 / 30.0 * v_days);
  else
    v_fd := 0;
    v_jd := 0;
  end if;
  -- Quitada com dispensa: nada mais corre depois dela.
  -- O devido de benefício, multa e juros fica preso no que foi pago + dispensado.
  if (v_wp + v_wb + v_wf + v_wi) > 0 then
    v_bd := v_pb + v_wb;
    v_fd := v_pf + v_wf;
    v_jd := v_pi + v_wi;
  end if;
  days_late := v_days;
  principal_due  := v.amount_cents;
  principal_paid := v_pp;
  principal_rem  := greatest(0, v.amount_cents - v_pp - v_wp);
  benefit_due  := v_bd; benefit_paid  := v_pb; benefit_rem  := greatest(0, v_bd - v_pb - v_wb);
  fee_due      := v_fd; fee_paid      := v_pf; fee_rem      := greatest(0, v_fd - v_pf - v_wf);
  interest_due := v_jd; interest_paid := v_pi; interest_rem := greatest(0, v_jd - v_pi - v_wi);
  total_rem := principal_rem + benefit_rem + fee_rem + interest_rem;
  return next;
end;
$$;

-- Mesmas permissões da 0280: só o servidor (as portas chamam por dentro).
revoke execute on function public.installment_balance(uuid, date) from public, anon, authenticated;
grant execute on function public.installment_balance(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- 6) QUEM PODE
-- -----------------------------------------------------------------------------
-- Emitir: Admin Master, Financeiro da Franqueadora, Gerente e Recepcionista da
-- unidade (matriz 9.3). Cancelar: Admin, Financeiro e Gerente. A TELA ainda
-- exige as permissões `acao.cobranca.*`, que nascem só com o Admin Master.
create or replace function public._charge_can(p_action text, p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or (p_action = 'emit' and public.has_role_in_clinic(p_clinic_id, array['unit_manager','receptionist']::public.user_role[]))
      or (p_action = 'cancel' and public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[]))
      or (p_action = 'counter' and public.can_receive_payment(p_clinic_id));
$$;
revoke execute on function public._charge_can(text, uuid) from public, anon, authenticated;

-- CPF com os dois dígitos verificadores certos.
create or replace function public._cpf_ok(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  s integer;
  r integer;
  i integer;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(d, i, 1)::integer * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::integer then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(d, i, 1)::integer * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::integer;
end;
$$;
revoke execute on function public._cpf_ok(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) A CONTA DA COBRANÇA (sem gravar nada)
-- -----------------------------------------------------------------------------
-- Devolve o que seria cobrado, ou o código do motivo da recusa. A tela usa
-- para a prévia; `charge_prepare` usa a mesma conta para gravar.
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
  end if;

  if coalesce(v_value, 0) <= 0 then
    error_code := 'NOTHING_TO_CHARGE'; return next; return;
  end if;

  value_cents := v_value;
  discount_cents := v_disc;
  fine_percent := v_fine;
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
    select c.error_code, c.value_cents, c.discount_cents, c.fine_percent, c.interest_percent,
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
    fine_percent, interest_percent, due_date, is_overdue_reissue, status, created_by
  ) values (
    v_clinic, v.gateway_account_id, 'installment', p_installment_id, v.client_id,
    v.payer_kind, v.payer_guardian_id, v.billing_type, v.value_cents, v.discount_cents,
    v.fine_percent, v.interest_percent, v.due_date, v.is_overdue_reissue, 'emitindo', (select auth.uid())
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
         c.discount_cents, c.fine_percent, c.interest_percent, c.due_date,
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

-- Grava o pagador encontrado ou criado no Asaas.
create or replace function public._gateway_customer_save(
  p_account_id uuid,
  p_cpf_cnpj text,
  p_asaas_customer_id text,
  p_owner_kind text,
  p_client_id uuid,
  p_guardian_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.gateway_customers (gateway_account_id, cpf_cnpj, asaas_customer_id, owner_kind, client_id, guardian_id)
  values (p_account_id, public.cpf_digits(p_cpf_cnpj), p_asaas_customer_id, p_owner_kind, p_client_id, p_guardian_id)
  on conflict (gateway_account_id, cpf_cnpj) do update
    set asaas_customer_id = excluded.asaas_customer_id, synced_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._gateway_customer_save(uuid, text, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public._charge_mark_issued(
  p_charge_id uuid,
  p_asaas_payment_id text,
  p_gateway_customer_id uuid,
  p_invoice_url text,
  p_bank_slip_url text,
  p_pix_copy_paste text,
  p_identification_field text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.charges c
     set status = 'emitida',
         asaas_payment_id = p_asaas_payment_id,
         gateway_customer_id = coalesce(p_gateway_customer_id, c.gateway_customer_id),
         invoice_url = p_invoice_url,
         bank_slip_url = p_bank_slip_url,
         pix_copy_paste = p_pix_copy_paste,
         identification_field = p_identification_field,
         error_code = null,
         issued_at = coalesce(c.issued_at, now()),
         attempts = c.attempts + 1
   where c.id = p_charge_id and c.status = 'emitindo';
  if not found then raise exception 'CHARGE_NOT_EMITTING'; end if;
end;
$$;
revoke execute on function public._charge_mark_issued(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public._charge_mark_error(p_charge_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.charges c
     set status = 'erro_emissao', error_code = left(coalesce(p_code, 'unknown'), 80), attempts = c.attempts + 1
   where c.id = p_charge_id and c.status = 'emitindo';
end;
$$;
revoke execute on function public._charge_mark_error(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) CANCELAR — a porta confere quem e o quê; o servidor cancela no Asaas e
--    só então grava
-- -----------------------------------------------------------------------------
-- p_purpose: 'cancel' (Admin, Financeiro, Gerente) ou 'counter' (o paciente
-- pagou no balcão: quem recebe pode cancelar a cobrança para receber à mão).
create or replace function public.charge_cancel_check(p_charge_id uuid, p_purpose text)
returns table (asaas_payment_id text, gateway_account_id uuid, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.charges%rowtype;
begin
  select * into v from public.charges c where c.id = p_charge_id;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if p_purpose not in ('cancel', 'counter') or not public._charge_can(p_purpose, v.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v.is_external or v.status not in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
    raise exception 'CHARGE_NOT_CANCELLABLE';
  end if;
  return query select v.asaas_payment_id, v.gateway_account_id, v.status;
end;
$$;
revoke execute on function public.charge_cancel_check(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_cancel_check(uuid, text) to authenticated;

create or replace function public._charge_mark_cancelled(p_charge_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.charges c
     set status = 'cancelada', cancelled_at = now(), cancelled_by = p_actor,
         cancel_reason = left(coalesce(nullif(btrim(p_reason), ''), 'cancelada'), 300)
   where c.id = p_charge_id
     and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao');
  if not found then raise exception 'CHARGE_NOT_CANCELLABLE'; end if;
end;
$$;
revoke execute on function public._charge_mark_cancelled(uuid, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10) COBRANÇA EXTERNA (D17) — a parcela já foi cobrada direto no Asaas
-- -----------------------------------------------------------------------------
create or replace function public.charge_mark_external(p_installment_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_installments%rowtype;
  v_id uuid;
begin
  select * into v from public.payment_installments i where i.id = p_installment_id for update;
  if not found then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not public._charge_can('cancel', v.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v.status not in ('em_aberto', 'parcial') then raise exception 'INSTALLMENT_CLOSED'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  insert into public.charges (clinic_id, source_type, payment_installment_id, client_id, status, is_external, external_note, created_by)
  values (v.clinic_id, 'installment', v.id, v.client_id, 'externa', true, left(btrim(p_note), 300), (select auth.uid()))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'CHARGE_ALREADY_ACTIVE';
end;
$$;
revoke execute on function public.charge_mark_external(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_mark_external(uuid, text) to authenticated;

create or replace function public.charge_unmark_external(p_charge_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.charges%rowtype;
begin
  select * into v from public.charges c where c.id = p_charge_id for update;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_can('cancel', v.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if not v.is_external or v.status <> 'externa' then raise exception 'CHARGE_NOT_EXTERNAL'; end if;
  update public.charges c
     set status = 'cancelada', cancelled_at = now(), cancelled_by = (select auth.uid()),
         cancel_reason = left(coalesce(nullif(btrim(p_reason), ''), 'marcação desfeita'), 300)
   where c.id = p_charge_id;
end;
$$;
revoke execute on function public.charge_unmark_external(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_unmark_external(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 11) AS TRAVAS
-- -----------------------------------------------------------------------------
create or replace function public._installment_has_active_charge(p_installment_id uuid, p_only_gateway boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.charges c
     where c.payment_installment_id = p_installment_id
       and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa')
       and (not p_only_gateway or not c.is_external)
  );
$$;
revoke execute on function public._installment_has_active_charge(uuid, boolean) from public, anon, authenticated;

-- Parcela com cobrança ativa (inclusive externa): não some, não muda o que foi
-- cobrado, não é cancelada nem renegociada. Baixa (paga/parcial) continua.
create or replace function public.payment_installments_charge_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._installment_has_active_charge(old.id, false) then
      raise exception 'CHARGE_ACTIVE';
    end if;
    return old;
  end if;
  if (new.amount_cents, new.due_date, new.benefit_discount_cents, new.late_fee_percent,
      new.monthly_interest_percent, new.payment_method, new.client_id)
     is distinct from
     (old.amount_cents, old.due_date, old.benefit_discount_cents, old.late_fee_percent,
      old.monthly_interest_percent, old.payment_method, old.client_id)
     or (new.status in ('cancelada', 'renegociada') and new.status is distinct from old.status)
  then
    if public._installment_has_active_charge(old.id, false) then
      raise exception 'CHARGE_ACTIVE';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.payment_installments_charge_lock() from public, anon, authenticated;

drop trigger if exists payment_installments_charge_lock on public.payment_installments;
create trigger payment_installments_charge_lock
  before update or delete on public.payment_installments
  for each row execute function public.payment_installments_charge_lock();

-- Sem baixa manual com cobrança do Asaas ativa (a externa continua manual).
-- A baixa vinda do Asaas (ASA2) liga `risarte.baixa_do_asaas` na transação.
create or replace function public.payment_receipts_charge_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reversal_of is not null then return new; end if;
  if coalesce(current_setting('risarte.baixa_do_asaas', true), '') = '1' then return new; end if;
  if public._installment_has_active_charge(new.installment_id, true) then
    raise exception 'CHARGE_IN_GATEWAY';
  end if;
  return new;
end;
$$;
revoke execute on function public.payment_receipts_charge_lock() from public, anon, authenticated;

drop trigger if exists payment_receipts_charge_lock on public.payment_receipts;
create trigger payment_receipts_charge_lock
  before insert on public.payment_receipts
  for each row execute function public.payment_receipts_charge_lock();

-- -----------------------------------------------------------------------------
-- 12) QUITAÇÃO POR VALOR MENOR (14.5)
-- -----------------------------------------------------------------------------
-- Só o Gerente da unidade e o Admin Master, com motivo. Recebe o valor pago
-- pela baixa de sempre (que lança o caixa e a taxa da rede sobre o que
-- entrou) e DISPENSA o resto: juros → multa → benefício perdido → principal.
-- Só o principal dispensado vai ao razão, como Descontos concedidos (1.9.02).
create or replace function public.register_payment_with_waiver(
  p_installment_id uuid,
  p_amount_cents bigint,
  p_received_at date,
  p_payment_method text,
  p_reference text,
  p_notes text,
  p_reason text,
  p_client_token uuid,
  p_conta text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_installments%rowtype;
  v_receipt uuid;
  v_bal record;
  v_at date := coalesce(p_received_at, public.today_br());
  v_waiver uuid;
  v_user uuid := (select auth.uid());
  v_account text;
begin
  select * into v from public.payment_installments i where i.id = p_installment_id for update;
  if not found then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v.clinic_id, array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;

  -- Idempotência: a mesma quitação reenviada devolve a baixa que já existe.
  if p_client_token is not null then
    select r.id into v_receipt from public.payment_receipts r where r.client_token = p_client_token;
    if v_receipt is not null then return v_receipt; end if;
  end if;

  if p_conta is not null then
    v_receipt := public.register_payment_receipt_to(p_conta, p_installment_id, p_amount_cents, v_at,
      p_payment_method, p_reference, p_notes, p_client_token);
  else
    v_receipt := public.register_payment_receipt(p_installment_id, p_amount_cents, v_at,
      p_payment_method, p_reference, p_notes, p_client_token);
  end if;

  select * into v_bal from public.installment_balance(p_installment_id, v_at);
  if coalesce(v_bal.total_rem, 0) <= 0 then
    -- Pagou tudo: não há o que dispensar.
    return v_receipt;
  end if;

  insert into public.payment_waivers (
    clinic_id, installment_id, receipt_id, principal_cents, benefit_cents,
    late_fee_cents, interest_cents, total_cents, reason, created_by
  ) values (
    v.clinic_id, p_installment_id, v_receipt, v_bal.principal_rem, v_bal.benefit_rem,
    v_bal.fee_rem, v_bal.interest_rem, v_bal.total_rem, btrim(p_reason), v_user
  )
  returning id into v_waiver;

  if v_bal.principal_rem > 0 then
    v_account := '1.9.02';
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v.clinic_id, v_account, v_at, v_bal.principal_rem, 'outflow', 'open',
      'receipt_waiver', v_waiver, 'Desconto concedido na quitação por valor menor', v_user
    );
  end if;

  return v_receipt;
end;
$$;
revoke execute on function public.register_payment_with_waiver(uuid, bigint, date, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.register_payment_with_waiver(uuid, bigint, date, text, text, text, text, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 13) AS PERMISSÕES DA TELA — nascem só com o Admin Master
-- -----------------------------------------------------------------------------
insert into public.permission_defaults (capability, roles) values
  ('acao.cobranca.ver', '{}'::public.user_role[]),
  ('acao.cobranca.emitir', '{}'::public.user_role[]),
  ('acao.cobranca.cancelar', '{}'::public.user_role[])
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 14) AUDITORIA (0288): cobranças, pagadores e dispensas entram na trilha
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_tables where schemaname = 'public'
    and tablename in ('charges', 'gateway_customers', 'payment_waivers')) as tabelas,
  (select count(*) from pg_trigger where tgname in
    ('payment_installments_charge_lock', 'payment_receipts_charge_lock', 'payment_waivers_refresh',
     'charges_no_delete', 'payment_waivers_immutable')) as gatilhos,
  (select count(*) from pg_policies where schemaname = 'public'
    and tablename in ('charges', 'gateway_customers', 'payment_waivers') and cmd <> 'SELECT') as regras_de_escrita,
  (select overdue_reissue_max_days from public.finance_settings where clinic_id is null) as dias_da_reemissao,
  (select count(*) from public.charges) as cobrancas;
