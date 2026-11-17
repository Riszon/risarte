-- =============================================================================
-- 4021 — ASA6: a COBRANÇA MENSAL às unidades (spec 20, aprovada em 16/11/2026
-- com 1a–6a e os quatro complementos — 20.15)
-- -----------------------------------------------------------------------------
--   * A CONFIGURAÇÃO (20.12 e 20.15.6) nasce EM BRANCO: multa, juros, dia de
--     vencimento, período de apuração, dias da prévia, a regra do mês incompleto,
--     o e-mail financeiro e o 1º mês da cobrança de cada unidade. Sem eles, nada
--     é emitido. Valor de exemplo só no treino e no sandbox, marcado.
--   * A PRÉVIA do período (o mês anterior), por unidade: as taxas fixas e o
--     "a cobrar" das percentuais, linha a linha, com a origem; os ajustes de
--     meses anteriores e os créditos. Cada linha de taxa entra pelo DELTA: o que
--     ela vale hoje menos o que já está faturado — nunca duas vezes (F1).
--   * O "a reter" (cartão parcelado à espera do crédito) nunca entra.
--   * A unidade confere ou contesta dentro da janela; o SILÊNCIO leva a prévia à
--     aprovação (20.15.2), com avisos na abertura e 1 dia útil antes do fim.
--   * O Financeiro decide as contestações (aceita = a linha é dispensada; depois
--     da emissão, vira CRÉDITO no mês seguinte) e aprova. Mês sem valor não gera
--     cobrança; abaixo do mínimo do Asaas (R$ 5,00), acumula para o mês seguinte.
--   * O SALDO ANTERIOR (20.15.1): o que está em aberto antes do 1º mês da
--     cobrança mensal não entra sozinho; o Financeiro decide incluir, parcelar ou
--     dispensar, por unidade, com motivo.
--   * A EMISSÃO sai pela conta da FRANQUEADORA, com a unidade (CNPJ) como
--     pagadora; a BAIXA (aviso do Asaas) paga as contas a pagar de taxa da
--     unidade e lança o caixa da franqueadora; multa e juros vão para o
--     financeiro, sem taxa sobre taxa; a tarifa do Asaas é da franqueadora.
--   * Quem vê: Gerente e franqueado (a sua unidade), Financeiro da Franqueadora
--     e Admin Master (a rede). As tabelas novas não têm leitura direta: tudo
--     passa pelas funções.
--
-- Nenhuma chamada ao Asaas sai do banco. Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONFIGURAÇÃO
-- -----------------------------------------------------------------------------
create table if not exists public.franchise_billing_settings (
  id boolean primary key default true check (id),
  fine_percent numeric check (fine_percent is null or (fine_percent >= 0 and fine_percent <= 100)),
  interest_percent_month numeric check (interest_percent_month is null or (interest_percent_month >= 0 and interest_percent_month <= 100)),
  due_day integer check (due_day is null or (due_day between 1 and 28)),
  period_kind text check (period_kind is null or period_kind in ('mes_calendario')),
  preview_days integer check (preview_days is null or (preview_days between 1 and 20)),
  partial_month_rule text check (partial_month_rule is null or partial_month_rule in ('cheio', 'proporcional')),
  -- 20.15.4: pendente do contador (nulo = a definir). Só leitura do razão.
  revenue_recognition text check (revenue_recognition is null or revenue_recognition in ('fechamento', 'pagamento')),
  example_values boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.franchise_billing_settings enable row level security;
insert into public.franchise_billing_settings (id) values (true) on conflict (id) do nothing;

-- Os campos antigos da multa e dos juros da rede (gateway_split_settings, sem
-- uso) NÃO são copiados: a configuração nasce em branco (20.15.6).

create table if not exists public.franchise_billing_unit_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  fine_percent numeric check (fine_percent is null or (fine_percent >= 0 and fine_percent <= 100)),
  interest_percent_month numeric check (interest_percent_month is null or (interest_percent_month >= 0 and interest_percent_month <= 100)),
  due_day integer check (due_day is null or (due_day between 1 and 28)),
  finance_email text check (finance_email is null or finance_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- O 1º mês da cobrança mensal (em branco = a unidade ainda não entra).
  monthly_from date check (monthly_from is null or monthly_from = date_trunc('month', monthly_from)::date),
  -- 20.15.3: o mês incompleto (início e saída das atividades da unidade).
  started_on date,
  ended_on date,
  example_values boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (ended_on is null or started_on is null or ended_on >= started_on)
);
alter table public.franchise_billing_unit_settings enable row level security;

-- A dispensa de uma taxa FIXA num mês (a percentual usa split_charges.waived_*).
create table if not exists public.network_fee_fixed_waivers (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  fee text not null references public.network_fee_types(key),
  period date not null,
  reason text not null check (length(btrim(reason)) >= 5),
  waived_by uuid,
  waived_at timestamptz not null default now(),
  primary key (clinic_id, fee, period)
);
alter table public.network_fee_fixed_waivers enable row level security;

-- -----------------------------------------------------------------------------
-- 2) O LOTE (a cobrança de uma unidade num período) E OS ITENS
-- -----------------------------------------------------------------------------
create table if not exists public.franchise_monthly_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  period date not null check (period = date_trunc('month', period)::date),
  status text not null default 'previa' check (status in
    ('previa', 'aprovada', 'emitida', 'paga', 'sem_cobranca', 'acumulada', 'cancelada')),
  preview_deadline date not null,
  opened_at timestamptz not null default now(),
  opened_by uuid,
  unit_ack_at timestamptz,
  unit_ack_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  total_cents bigint,
  due_date date,
  fine_percent numeric,
  interest_percent_month numeric,
  charge_id uuid references public.charges(id),
  fund_split_account_id uuid,
  fund_split_cents bigint,
  paid_on date,
  paid_cents bigint,
  late_cents bigint,
  settled_at timestamptz,
  settle_note text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  example_values boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists franchise_monthly_batches_one_per_period
  on public.franchise_monthly_batches (clinic_id, period) where status <> 'cancelada';
create index if not exists franchise_monthly_batches_charge on public.franchise_monthly_batches (charge_id);
alter table public.franchise_monthly_batches enable row level security;

create table if not exists public.franchise_monthly_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.franchise_monthly_batches(id) on delete cascade,
  clinic_id uuid not null,
  kind text not null check (kind in ('fixa', 'percentual', 'ajuste', 'credito', 'saldo_anterior')),
  fee text not null references public.network_fee_types(key),
  origin_period date not null,
  split_charge_id uuid references public.split_charges(id),
  payable_id uuid references public.payables(id),
  credit_of_item_id uuid references public.franchise_monthly_items(id),
  received_on date,
  method text,
  origin_label text,
  patient_code text,
  patient_short text,
  base_cents bigint,
  percent numeric,
  amount_cents bigint not null check (amount_cents <> 0),
  description text,
  status text not null default 'ativo' check (status in ('ativo', 'contestado', 'dispensado')),
  contest_reason text,
  contest_attachment_path text,
  contested_by uuid,
  contested_at timestamptz,
  decision text check (decision is null or decision in ('aceita', 'recusada')),
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,
  after_issue boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind in ('credito') and amount_cents < 0) or kind not in ('credito')),
  check ((kind in ('fixa', 'percentual', 'saldo_anterior') and amount_cents > 0) or kind not in ('fixa', 'percentual', 'saldo_anterior'))
);
-- A mesma linha de taxa nunca duas vezes NO MESMO lote (entre lotes, o delta).
create unique index if not exists franchise_monthly_items_line_once
  on public.franchise_monthly_items (batch_id, split_charge_id) where split_charge_id is not null;
create unique index if not exists franchise_monthly_items_fixed_once
  on public.franchise_monthly_items (batch_id, payable_id) where kind in ('fixa', 'ajuste', 'credito') and split_charge_id is null and payable_id is not null;
create index if not exists franchise_monthly_items_batch on public.franchise_monthly_items (batch_id);
create index if not exists franchise_monthly_items_sc on public.franchise_monthly_items (split_charge_id);
create index if not exists franchise_monthly_items_payable on public.franchise_monthly_items (payable_id);
alter table public.franchise_monthly_items enable row level security;

-- O saldo anterior (20.15.1): a decisão por unidade e a fotografia das contas.
create table if not exists public.franchise_prior_balance (
  clinic_id uuid primary key references public.clinics(id),
  decision text not null check (decision in ('incluir', 'parcelar', 'dispensar')),
  installments integer not null default 1 check (installments between 1 and 24),
  total_cents bigint not null,
  first_period date not null,
  reason text not null check (length(btrim(reason)) >= 5),
  decided_by uuid,
  decided_at timestamptz not null default now()
);
alter table public.franchise_prior_balance enable row level security;

create table if not exists public.franchise_prior_balance_lines (
  clinic_id uuid not null references public.franchise_prior_balance(clinic_id) on delete cascade,
  payable_id uuid not null references public.payables(id),
  ord integer not null,
  open_cents bigint not null check (open_cents > 0),
  primary key (clinic_id, payable_id)
);
alter table public.franchise_prior_balance_lines enable row level security;

-- O ajuste de mês fechado (6b): a dispensa que não pôde mexer no mês fechado.
create table if not exists public.franchise_accrual_adjustments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  fee text not null references public.network_fee_types(key),
  period date not null,
  payable_id uuid references public.payables(id),
  amount_cents bigint not null check (amount_cents <> 0),
  reason text not null,
  item_id uuid,
  unit_entry_id uuid,
  hq_entry_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists franchise_accrual_adjustments_payable on public.franchise_accrual_adjustments (payable_id);
alter table public.franchise_accrual_adjustments enable row level security;

-- Os avisos já mandados (uma vez por lote e por chave).
create table if not exists public.franchise_monthly_notices (
  batch_id uuid not null references public.franchise_monthly_batches(id) on delete cascade,
  kind text not null,
  key text not null default '',
  sent_at timestamptz not null default now(),
  primary key (batch_id, kind, key)
);
alter table public.franchise_monthly_notices enable row level security;

-- O comprovante da contestação (pasta privada; só o servidor grava e lê, depois
-- de conferir quem pode — nenhuma regra de acesso direto).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cobranca-mensal', 'cobranca-mensal', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- O pagamento da conta de taxa feito pela cobrança mensal guarda o lote (a
-- conferência do caixa, 4021a, casa por ele).
alter table public.payable_payments add column if not exists franchise_batch_id uuid references public.franchise_monthly_batches(id);
create index if not exists payable_payments_franchise_batch on public.payable_payments (franchise_batch_id) where franchise_batch_id is not null;

-- A unidade como pagadora (no cadastro do Asaas da conta da franqueadora).
alter table public.charges drop constraint if exists charges_payer_kind_check;
alter table public.charges add constraint charges_payer_kind_check
  check (payer_kind = any (array['client', 'guardian', 'company', 'unit']));
alter table public.gateway_customers add column if not exists unit_clinic_id uuid references public.clinics(id);
alter table public.gateway_customers drop constraint if exists gateway_customers_owner_kind_check;
alter table public.gateway_customers add constraint gateway_customers_owner_kind_check
  check (owner_kind = any (array['client', 'guardian', 'company', 'unit']));

-- -----------------------------------------------------------------------------
-- 3) AS REGRAS DE QUEM VÊ E QUEM FAZ (20.11)
-- -----------------------------------------------------------------------------
create or replace function public._franchise_can_manage()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_master() or public.is_finance_franchisor();
$$;

-- Gerente e franqueado veem a SUA unidade; Financeiro e Admin, a rede. Dentista,
-- Planner, ASB, TSB, SDR e Recepcionista não veem (20.15.5).
create or replace function public._franchise_can_see(p_clinic_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic_id is not null and (
    public._franchise_can_manage()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager', 'franchisee']::public.user_role[]));
$$;

-- -----------------------------------------------------------------------------
-- 4) A CONFIGURAÇÃO EFETIVA E O QUE FALTA
-- -----------------------------------------------------------------------------
create or replace function public._franchise_root_account()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.gateway_accounts a
   where a.owner_type = 'franchisor' and a.status = 'active' and a.api_key_secret_id is not null
   order by a.created_at limit 1;
$$;

-- A franqueadora: a dona da conta raiz (ou a primeira cadastrada).
create or replace function public._franchise_hq()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select a.clinic_id from public.gateway_accounts a where a.id = public._franchise_root_account()),
    (select c.id from public.clinics c where c.type = 'franchisor' order by c.created_at limit 1));
$$;

create or replace function public._franchise_billing_cfg(p_clinic_id uuid)
returns table (
  fine_percent numeric, interest_percent_month numeric, due_day integer, period_kind text,
  preview_days integer, partial_month_rule text, revenue_recognition text, finance_email text,
  monthly_from date, started_on date, ended_on date, example_values boolean, missing text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  n public.franchise_billing_settings%rowtype;
  u public.franchise_billing_unit_settings%rowtype;
  c public.clinics%rowtype;
  v_missing text[] := '{}';
  v_fee record;
begin
  select * into n from public.franchise_billing_settings where id;
  select * into u from public.franchise_billing_unit_settings s where s.clinic_id = p_clinic_id;
  select * into c from public.clinics where id = p_clinic_id;

  if coalesce(u.fine_percent, n.fine_percent) is null then v_missing := array_append(v_missing, 'Multa por atraso (%)'); end if;
  if coalesce(u.interest_percent_month, n.interest_percent_month) is null then v_missing := array_append(v_missing, 'Juros ao mês (%)'); end if;
  if coalesce(u.due_day, n.due_day) is null then v_missing := array_append(v_missing, 'Dia de vencimento'); end if;
  if n.period_kind is null then v_missing := array_append(v_missing, 'Período de apuração'); end if;
  if n.preview_days is null then v_missing := array_append(v_missing, 'Dias da prévia'); end if;
  if n.partial_month_rule is null then v_missing := array_append(v_missing, 'Taxas fixas no mês incompleto'); end if;
  if u.finance_email is null then v_missing := array_append(v_missing, 'E-mail financeiro da unidade'); end if;
  if u.monthly_from is null then v_missing := array_append(v_missing, 'Primeiro mês da cobrança mensal'); end if;
  if public.cpf_digits(c.cnpj) is null or length(public.cpf_digits(c.cnpj)) <> 14 then
    v_missing := array_append(v_missing, 'CNPJ da unidade');
  end if;
  for v_fee in select t.key, t.label from public.network_fee_types t where t.kind = 'fixed' and t.active order by t.sort_order loop
    if exists (select 1 from public.network_fee_for(p_clinic_id, v_fee.key, null) f where f.active and f.amount_cents <= 0) then
      v_missing := array_append(v_missing, 'Valor de ' || v_fee.label);
    end if;
  end loop;
  if public._franchise_root_account() is null then v_missing := array_append(v_missing, 'Conta Asaas da franqueadora'); end if;

  return query select
    coalesce(u.fine_percent, n.fine_percent), coalesce(u.interest_percent_month, n.interest_percent_month),
    coalesce(u.due_day, n.due_day), n.period_kind, n.preview_days, n.partial_month_rule, n.revenue_recognition,
    u.finance_email, u.monthly_from, coalesce(u.started_on, c.go_live_on), u.ended_on,
    coalesce(n.example_values, false) or coalesce(u.example_values, false), v_missing;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) AS LINHAS: origem, valor devido hoje e o que já está faturado
-- -----------------------------------------------------------------------------
-- "Maria da Silva" → "Maria S." (decisão 6a: código e nome abreviado).
create or replace function public._franchise_short_name(p_name text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_name is null or btrim(p_name) = '' then null
    when array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) = 1 then btrim(p_name)
    else split_part(btrim(p_name), ' ', 1) || ' '
         || upper(left((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)], 1)) || '.'
  end;
$$;

create or replace function public._franchise_line_info(p_split_charge_id uuid)
returns table (received_on date, method text, origin_label text, patient_code text, patient_short text)
language plpgsql stable security definer set search_path = '' as $$
declare
  sc public.split_charges%rowtype;
  v_on date; v_method text; v_client uuid;
begin
  select * into sc from public.split_charges s where s.id = p_split_charge_id;
  if sc.source_type = 'receipt' then
    select r.received_at, r.payment_method, i.client_id into v_on, v_method, v_client
      from public.payment_receipts r left join public.payment_installments i on i.id = r.installment_id
     where r.id = sc.receipt_id;
  elsif sc.source_type = 'ortho_charge' then
    select coalesce(o.paid_on, o.paid_at::date), o.payment_method, o.client_id into v_on, v_method, v_client
      from public.ortho_charges o where o.id = sc.source_id;
  elsif sc.source_type = 'ppr_charge' then
    select p.paid_at::date, m.payment_method, m.holder_client_id into v_on, v_method, v_client
      from public.ppr_charges p join public.ppr_memberships m on m.id = p.membership_id where p.id = sc.source_id;
  end if;
  return query
  select v_on, v_method,
    case
      when sc.kept_after_refund then 'Estorno'
      when sc.charge_id is not null and sc.retained_cents > 0 then 'Split a menor'
      when sc.charge_id is not null then 'Asaas sem split'
      when v_method = 'dinheiro' then 'Dinheiro'
      when v_method in ('cartao', 'cartao_parcelado', 'credito_recorrente', 'debito') then 'Maquininha'
      when v_method like 'deposito%' then 'Depósito'
      when v_method = 'pix' then 'Pix manual'
      when v_method = 'permuta' then 'Permuta'
      when v_method = 'boleto' then 'Boleto fora do riSZon'
      when v_method like '%extern%' then 'Cobrança externa'
      when sc.source_type = 'ppr_charge' then 'Mensalidade PPR+'
      when sc.source_type = 'ortho_charge' then 'Mensalidade da Ortodontia'
      else coalesce(initcap(v_method), 'Recebimento')
    end,
    k.code, public._franchise_short_name(k.full_name)
  from (select 1) x left join public.clients k on k.id = v_client;
end;
$$;

-- O que a linha de taxa percentual vale HOJE: o devido menos o retido pelo
-- split ("a reter" e "retida" nunca entram); estornada ou dispensada = zero.
create or replace function public._franchise_line_due(p_split_charge_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when sc.reversed or sc.waived_at is not null then 0
              else greatest(sc.amount_cents - sc.retained_cents, 0) end
    from public.split_charges sc where sc.id = p_split_charge_id;
$$;

-- Os lotes que SEGURAM as linhas: a prévia aberta, a aprovada, a emitida e a paga.
create or replace function public._franchise_batch_holds(p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('previa', 'aprovada', 'emitida', 'paga');
$$;

create or replace function public._franchise_invoiced_line(p_split_charge_id uuid, p_except_batch uuid default null)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(i.amount_cents), 0)::bigint
    from public.franchise_monthly_items i join public.franchise_monthly_batches b on b.id = i.batch_id
   where i.split_charge_id = p_split_charge_id and i.status in ('ativo', 'contestado')
     and public._franchise_batch_holds(b.status) and b.id is distinct from p_except_batch;
$$;

create or replace function public._franchise_invoiced_payable(p_payable_id uuid, p_except_batch uuid default null)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(i.amount_cents), 0)::bigint
    from public.franchise_monthly_items i join public.franchise_monthly_batches b on b.id = i.batch_id
   where i.payable_id = p_payable_id and i.split_charge_id is null and i.kind in ('fixa', 'ajuste', 'credito')
     and i.status in ('ativo', 'contestado') and public._franchise_batch_holds(b.status)
     and b.id is distinct from p_except_batch;
$$;

create or replace function public._franchise_batch_total(p_batch_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.franchise_monthly_items
   where batch_id = p_batch_id and status in ('ativo', 'contestado');
$$;

-- -----------------------------------------------------------------------------
-- 6) OS AVISOS
-- -----------------------------------------------------------------------------
create or replace function public._franchise_notify(
  p_batch_id uuid, p_kind text, p_key text, p_unit boolean, p_finance boolean, p_admins boolean,
  p_title text, p_body text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  b public.franchise_monthly_batches%rowtype;
  v_new boolean;
  v_n integer := 0;
begin
  select * into b from public.franchise_monthly_batches where id = p_batch_id;
  insert into public.franchise_monthly_notices (batch_id, kind, key) values (p_batch_id, p_kind, coalesce(p_key, ''))
  on conflict do nothing returning true into v_new;
  if not coalesce(v_new, false) then return 0; end if;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct u.user_id, b.clinic_id, p_title, p_body, '/financeiro/cobranca-da-rede?lote=' || b.id::text
    from (
      select ucr.user_id from public.user_clinic_roles ucr
       where p_unit and ucr.clinic_id = b.clinic_id and ucr.role in ('unit_manager', 'franchisee')
      union
      select ucr.user_id from public.user_clinic_roles ucr where p_finance and ucr.role = 'finance_franchisor'
      union
      select p.id from public.profiles p where p_admins and p.is_admin_master and p.is_active
    ) u;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6b) O MÊS FECHADO: refazer a conta a pagar de um mês fechado é recusado pelo
-- razão (PERIOD_CLOSED). A mudança que o riSZon faz (dispensa) entra então no
-- MÊS ABERTO, como ajuste — a mesma regra do "recebimento que chega atrasado".
-- -----------------------------------------------------------------------------
create or replace function public._franchise_try_refresh(p_clinic_id uuid, p_fee text, p_period date)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_network_fee_payable(p_clinic_id, p_fee, p_period);
  return true;
exception when others then
  if sqlerrm = 'PERIOD_CLOSED' then return false; end if;
  raise;
end;
$$;

-- O ajuste no mês aberto, só competência: a despesa da unidade e a receita da
-- franqueadora (o caixa já está certo: o crédito é compensado, sem dinheiro).
create or replace function public._franchise_accrual_adjust(
  p_clinic_id uuid, p_fee text, p_period date, p_amount_cents bigint, p_reason text, p_item_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_acc record;
  v_payable public.payables%rowtype;
  v_id uuid;
  v_hq uuid;
  v_today date := public.today_br();
  v_u uuid; v_h uuid;
  v_label text := public.network_fee_label(p_fee) || ' ' || to_char(p_period, 'MM/YYYY');
begin
  if coalesce(p_amount_cents, 0) = 0 then return null; end if;
  select * into v_acc from public.network_fee_accounts(p_fee);
  select * into v_payable from public.payables where clinic_id = p_clinic_id and network_fee = p_fee and fee_period = p_period;
  v_hq := public._franchise_hq();
  -- A conta a pagar acompanha (a tabela não é competência; o lançamento é).
  if v_payable.id is not null then
    if v_payable.amount_cents + p_amount_cents > 0 then
      update public.payables set amount_cents = amount_cents + p_amount_cents, updated_at = now() where id = v_payable.id;
    elsif v_payable.paid_amount_cents = 0 and v_payable.status <> 'cancelada' then
      update public.payables set status = 'cancelada', cancel_reason = left(p_reason, 300), updated_at = now() where id = v_payable.id;
    end if;
  end if;
  insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
    source_type, source_id, description)
  values (p_clinic_id, v_acc.unit_account, v_today, null, abs(p_amount_cents),
          case when p_amount_cents < 0 then 'inflow' else 'outflow' end, 'open', 'network_fee_adjust_unit', gen_random_uuid(),
          'Ajuste de mês fechado — ' || v_label || ' — ' || left(p_reason, 200))
  returning id into v_u;
  if v_hq is not null and v_hq <> p_clinic_id then
    insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
      source_type, source_id, description)
    values (v_hq, v_acc.franchisor_account, v_today, null, abs(p_amount_cents),
            case when p_amount_cents < 0 then 'outflow' else 'inflow' end, 'open', 'network_fee_adjust_hq', gen_random_uuid(),
            'Ajuste de mês fechado — ' || v_label || ' — ' || left(p_reason, 200))
    returning id into v_h;
  end if;
  insert into public.franchise_accrual_adjustments (clinic_id, fee, period, payable_id, amount_cents, reason, item_id, unit_entry_id, hq_entry_id)
  values (p_clinic_id, p_fee, p_period, v_payable.id, p_amount_cents, left(p_reason, 300), p_item_id, v_u, v_h)
  returning id into v_id;
  return v_id;
end;
$$;

-- O dia útil anterior (sábado e domingo não contam).
create or replace function public._franchise_prev_business_day(p_date date)
returns date language plpgsql immutable set search_path = '' as $$
declare v date := p_date - 1;
begin
  while extract(dow from v) in (0, 6) loop v := v - 1; end loop;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) A PRÉVIA: monta os itens do período (20.3, 20.5 e 20.15)
-- -----------------------------------------------------------------------------
create or replace function public._franchise_monthly_build(p_clinic_id uuid, p_period date, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  cfg record;
  v_batch uuid;
  v_first date;
  v_deadline date;
  v_today date := public.today_br();
  pb public.franchise_prior_balance%rowtype;
  r record;
  v_due bigint; v_inv bigint; v_delta bigint;
  v_kind text;
  v_payable uuid;
  v_info record;
  v_m date;
  v_k integer; v_base bigint; v_lo bigint; v_hi bigint; v_c0 bigint := 0; v_part bigint;
  v_total bigint; v_n integer;
begin
  select * into cfg from public._franchise_billing_cfg(p_clinic_id);
  v_first := cfg.monthly_from;
  if v_first is null then raise exception 'MONTHLY_NOT_STARTED'; end if;
  if p_period < v_first then raise exception 'PERIOD_BEFORE_START'; end if;
  if p_period >= date_trunc('month', v_today)::date then raise exception 'PERIOD_NOT_CLOSED'; end if;
  if exists (select 1 from public.franchise_monthly_batches b
              where b.clinic_id = p_clinic_id and b.period = p_period and b.status <> 'cancelada') then
    raise exception 'BATCH_EXISTS';
  end if;
  -- Os meses anteriores da unidade precisam ter o lote (a ordem é mês a mês).
  if exists (select 1 from public.franchise_monthly_batches b
              where b.clinic_id = p_clinic_id and b.period > p_period and b.status <> 'cancelada') then
    raise exception 'LATER_BATCH_EXISTS';
  end if;

  -- A janela: do dia 1 do mês seguinte (ou de hoje, se já passou) por N dias.
  v_deadline := greatest((p_period + interval '1 month')::date, v_today) + (coalesce(cfg.preview_days, 5) - 1);

  insert into public.franchise_monthly_batches (clinic_id, period, status, preview_deadline, opened_by, example_values)
  values (p_clinic_id, p_period, 'previa', v_deadline, p_actor, cfg.example_values)
  returning id into v_batch;

  select * into pb from public.franchise_prior_balance where clinic_id = p_clinic_id;

  -- A) As TAXAS FIXAS: do 1º mês da cobrança mensal até o período.
  v_m := v_first;
  while v_m <= p_period loop
    for r in select t.key from public.network_fee_types t where t.kind = 'fixed' and t.active order by t.sort_order loop
      -- Mês fechado sem a conta da taxa fixa: o Financeiro reabre o mês ou muda o 1º mês.
      if not public._franchise_try_refresh(p_clinic_id, r.key, v_m)
         and not exists (select 1 from public.payables p where p.clinic_id = p_clinic_id and p.network_fee = r.key and p.fee_period = v_m)
         and exists (select 1 from public.network_fee_for(p_clinic_id, r.key, v_m) f where f.active and f.amount_cents > 0) then
        raise exception 'PERIOD_CLOSED_FIXED: %', to_char(v_m, 'MM/YYYY');
      end if;
    end loop;
    v_m := (v_m + interval '1 month')::date;
  end loop;

  for r in
    select p.id, p.network_fee, p.fee_period, p.amount_cents, p.status
      from public.payables p join public.network_fee_types t on t.key = p.network_fee and t.kind = 'fixed'
     where p.clinic_id = p_clinic_id and p.fee_period between v_first and p_period
     order by p.fee_period, t.sort_order
  loop
    v_due := case when r.status = 'cancelada'
                    or exists (select 1 from public.network_fee_fixed_waivers w
                                where w.clinic_id = p_clinic_id and w.fee = r.network_fee and w.period = r.fee_period)
                  then 0 else r.amount_cents end;
    v_inv := public._franchise_invoiced_payable(r.id, v_batch);
    v_delta := v_due - v_inv;
    continue when v_delta = 0;
    v_kind := case
      when v_delta > 0 and r.fee_period = p_period then 'fixa'
      when v_delta > 0 then 'ajuste'
      when exists (select 1 from public.franchise_monthly_items i
                    where i.payable_id = r.id and i.split_charge_id is null and i.decision = 'aceita' and i.after_issue) then 'credito'
      else 'ajuste' end;
    insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, payable_id, amount_cents, description,
                                                credit_of_item_id)
    values (v_batch, p_clinic_id, v_kind, r.network_fee, r.fee_period, r.id, v_delta,
            public.network_fee_label(r.network_fee) || ' — ' || to_char(r.fee_period, 'MM/YYYY'),
            case when v_kind = 'credito' then (select i.id from public.franchise_monthly_items i
                    where i.payable_id = r.id and i.split_charge_id is null and i.decision = 'aceita' and i.after_issue
                    order by i.decided_at desc limit 1) end);
  end loop;

  -- B) As TAXAS PERCENTUAIS "a cobrar", linha a linha, pelo DELTA. Antes, as
  -- contas a pagar dos meses tocados são refeitas (a dispensa sai delas).
  for r in
    select distinct sc.fee, sc.period_month from public.split_charges sc
     where sc.clinic_id = p_clinic_id and sc.period_month <= p_period
       and (sc.period_month >= v_first or (pb.decided_at is not null and sc.created_at > pb.decided_at))
  loop
    perform public._franchise_try_refresh(p_clinic_id, r.fee, r.period_month);
  end loop;

  for r in
    select sc.* from public.split_charges sc join public.network_fee_types t on t.key = sc.fee
     where sc.clinic_id = p_clinic_id and sc.period_month <= p_period
       and (sc.period_month >= v_first or (pb.decided_at is not null and sc.created_at > pb.decided_at))
     order by sc.period_month, sc.created_at, t.sort_order
  loop
    v_due := public._franchise_line_due(r.id);
    v_inv := public._franchise_invoiced_line(r.id, v_batch);
    v_delta := v_due - v_inv;
    continue when v_delta = 0;
    v_kind := case
      when v_delta > 0 and r.period_month = p_period and v_inv = 0 then 'percentual'
      when v_delta > 0 then 'ajuste'
      when exists (select 1 from public.franchise_monthly_items i
                    where i.split_charge_id = r.id and i.decision = 'aceita' and i.after_issue) then 'credito'
      else 'ajuste' end;
    select p.id into v_payable from public.payables p
     where p.clinic_id = p_clinic_id and p.network_fee = r.fee and p.fee_period = r.period_month;
    select * into v_info from public._franchise_line_info(r.id);
    insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, split_charge_id, payable_id,
      received_on, method, origin_label, patient_code, patient_short, base_cents, percent, amount_cents, description,
      credit_of_item_id)
    values (v_batch, p_clinic_id, v_kind, r.fee, r.period_month, r.id, v_payable,
      v_info.received_on, v_info.method, v_info.origin_label, v_info.patient_code, v_info.patient_short,
      r.base_cents, r.percent, v_delta, public.network_fee_label(r.fee),
      case when v_kind = 'credito' then (select i.id from public.franchise_monthly_items i
              where i.split_charge_id = r.id and i.decision = 'aceita' and i.after_issue order by i.decided_at desc limit 1) end);
  end loop;

  -- C) O SALDO ANTERIOR (20.15.1): só com a decisão "incluir" ou "parcelar".
  if pb.clinic_id is not null and pb.decision in ('incluir', 'parcelar') then
    select count(distinct b.id) + 1 into v_k
      from public.franchise_monthly_items i join public.franchise_monthly_batches b on b.id = i.batch_id
     where i.clinic_id = p_clinic_id and i.kind = 'saldo_anterior' and i.status in ('ativo', 'contestado')
       and public._franchise_batch_holds(b.status) and b.id <> v_batch;
    if v_k <= pb.installments then
      v_base := pb.total_cents / pb.installments;
      v_lo := v_base * (v_k - 1);
      v_hi := case when v_k = pb.installments then pb.total_cents else v_base * v_k end;
      for r in
        select l.payable_id, l.open_cents, p.network_fee, p.fee_period
          from public.franchise_prior_balance_lines l join public.payables p on p.id = l.payable_id
         where l.clinic_id = p_clinic_id order by l.ord
      loop
        v_part := greatest(0, least(v_hi, v_c0 + r.open_cents) - greatest(v_lo, v_c0));
        v_c0 := v_c0 + r.open_cents;
        continue when v_part <= 0;
        insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, payable_id, amount_cents, description)
        values (v_batch, p_clinic_id, 'saldo_anterior', r.network_fee, r.fee_period, r.payable_id, v_part,
                'Saldo anterior — ' || public.network_fee_label(r.network_fee) || ' ' || to_char(r.fee_period, 'MM/YYYY')
                || case when pb.installments > 1 then ' (parcela ' || v_k || ' de ' || pb.installments || ')' else '' end);
      end loop;
    end if;
  end if;

  -- Mês sem nada: sem cobrança. Abaixo do mínimo do Asaas: acumula.
  select count(*), coalesce(sum(amount_cents), 0) into v_n, v_total
    from public.franchise_monthly_items where batch_id = v_batch;
  update public.franchise_monthly_batches set
    total_cents = v_total,
    status = case when v_n = 0 or v_total = 0 then 'sem_cobranca'
                  when v_total < public._franchise_min_charge_cents() then 'acumulada'
                  else 'previa' end,
    updated_at = now()
   where id = v_batch;
  return v_batch;
end;
$$;

-- O menor valor de boleto que o Asaas aceita (R$ 5,00).
create or replace function public._franchise_min_charge_cents()
returns bigint language sql immutable set search_path = '' as $$ select 500::bigint; $$;

-- -----------------------------------------------------------------------------
-- 8) AS AÇÕES DA PRÉVIA
-- -----------------------------------------------------------------------------
-- Abrir a prévia à mão (a rotina abre no dia 1). Só Financeiro ou Admin.
create or replace function public.franchise_monthly_open(p_clinic_id uuid, p_period date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  cfg record;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  select * into cfg from public._franchise_billing_cfg(p_clinic_id);
  if cardinality(cfg.missing) > 0 then raise exception 'CONFIG_MISSING: %', array_to_string(cfg.missing, ', '); end if;
  v_id := public._franchise_monthly_build(p_clinic_id, date_trunc('month', p_period)::date, (select auth.uid()));
  perform public._franchise_monthly_opened(v_id);
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), p_clinic_id, 'create', 'franchise_monthly_batch', v_id::text,
          jsonb_build_object('period', p_period));
  return v_id;
end;
$$;

-- O aviso da abertura (20.15.2), com o prazo e o que acontece no silêncio.
create or replace function public._franchise_monthly_opened(p_batch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.franchise_monthly_batches%rowtype;
begin
  select * into b from public.franchise_monthly_batches where id = p_batch_id;
  if b.status = 'previa' then
    perform public._franchise_notify(b.id, 'abertura', '', true, false, false,
      'Cobrança mensal da rede: confira a prévia de ' || to_char(b.period, 'MM/YYYY'),
      'Confira até ' || to_char(b.preview_deadline, 'DD/MM') || '. Sem contestação até essa data, a cobrança segue para aprovação e é emitida.');
  end if;
end;
$$;

-- Refazer a prévia (configuração mudou, linha nova): descarta e monta de novo.
create or replace function public.franchise_monthly_rebuild(p_batch_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.franchise_monthly_batches%rowtype;
  v_id uuid;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into b from public.franchise_monthly_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if b.status not in ('previa', 'acumulada', 'sem_cobranca') then raise exception 'BATCH_NOT_PREVIEW'; end if;
  if exists (select 1 from public.franchise_monthly_batches o where o.clinic_id = b.clinic_id and o.period > b.period and o.status <> 'cancelada') then
    raise exception 'LATER_BATCH_EXISTS';
  end if;
  update public.franchise_monthly_batches set status = 'cancelada', cancelled_at = now(), cancelled_by = (select auth.uid()),
         cancel_reason = btrim(p_reason), updated_at = now() where id = b.id;
  v_id := public._franchise_monthly_build(b.clinic_id, b.period, (select auth.uid()));
  perform public._franchise_monthly_opened(v_id);
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), b.clinic_id, 'update', 'franchise_monthly_batch', b.id::text,
          jsonb_build_object('rebuilt_as', v_id, 'reason', btrim(p_reason)));
  return v_id;
end;
$$;

-- A unidade confere: "Conferi, está de acordo" (a prévia fica pronta antes do prazo).
create or replace function public.franchise_monthly_ack(p_batch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.franchise_monthly_batches%rowtype;
begin
  select * into b from public.franchise_monthly_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if not public.has_role_in_clinic(b.clinic_id, array['unit_manager', 'franchisee']::public.user_role[]) then
    raise exception 'NOT_ALLOWED';
  end if;
  if b.status <> 'previa' then raise exception 'BATCH_NOT_PREVIEW'; end if;
  if exists (select 1 from public.franchise_monthly_items i where i.batch_id = b.id and i.status = 'contestado') then
    raise exception 'OPEN_CONTEST';
  end if;
  update public.franchise_monthly_batches set unit_ack_at = now(), unit_ack_by = (select auth.uid()), updated_at = now() where id = b.id;
  perform public._franchise_notify(b.id, 'conferida', '', false, true, false,
    'Cobrança mensal: prévia conferida pela unidade',
    'A unidade conferiu a prévia de ' || to_char(b.period, 'MM/YYYY') || ' e está de acordo. Ela está pronta para a aprovação.');
end;
$$;

-- A unidade contesta uma linha (na prévia ou depois da emissão).
create or replace function public.franchise_monthly_contest(p_item_id uuid, p_reason text, p_attachment_path text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.franchise_monthly_items%rowtype;
  b public.franchise_monthly_batches%rowtype;
begin
  select * into i from public.franchise_monthly_items where id = p_item_id for update;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into b from public.franchise_monthly_batches where id = i.batch_id for update;
  if not public.has_role_in_clinic(b.clinic_id, array['unit_manager', 'franchisee']::public.user_role[]) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if i.amount_cents <= 0 or i.kind = 'saldo_anterior' then raise exception 'ITEM_NOT_CONTESTABLE'; end if;
  if i.status <> 'ativo' or i.decision is not null then raise exception 'ITEM_ALREADY_CONTESTED'; end if;
  if b.status = 'previa' then
    if b.preview_deadline < public.today_br() then raise exception 'PREVIEW_CLOSED'; end if;
  elsif b.status not in ('emitida', 'paga') then
    raise exception 'BATCH_NOT_CONTESTABLE';
  end if;
  update public.franchise_monthly_items set status = 'contestado', contest_reason = btrim(p_reason),
         contest_attachment_path = nullif(btrim(coalesce(p_attachment_path, '')), ''),
         contested_by = (select auth.uid()), contested_at = now(), after_issue = (b.status <> 'previa')
   where id = i.id;
  perform public._franchise_notify(b.id, 'contestacao', i.id::text, false, true, false,
    'Cobrança mensal: linha contestada',
    'A unidade contestou uma linha da cobrança de ' || to_char(b.period, 'MM/YYYY') || ': ' || btrim(p_reason));
end;
$$;

-- O Financeiro decide. Aceita = a linha é DISPENSADA (com o motivo, na auditoria);
-- depois da emissão, vira CRÉDITO na cobrança do mês seguinte (20.15.5).
create or replace function public.franchise_monthly_decide(p_item_id uuid, p_accept boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.franchise_monthly_items%rowtype;
  b public.franchise_monthly_batches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before bigint;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  if length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into i from public.franchise_monthly_items where id = p_item_id for update;
  if i.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.status <> 'contestado' then raise exception 'ITEM_NOT_CONTESTED'; end if;
  select * into b from public.franchise_monthly_batches where id = i.batch_id for update;

  if p_accept then
    -- A linha que já tem outra parte faturada (um ajuste dela) não é dispensada
    -- por aqui: a dispensa inteira devolveria também a parte já cobrada.
    if (i.split_charge_id is not null
        and public._franchise_invoiced_line(i.split_charge_id) - case when i.after_issue then i.amount_cents else 0 end
            - case when i.after_issue then 0 else i.amount_cents end <> 0)
       or (i.split_charge_id is null and i.payable_id is not null
        and public._franchise_invoiced_payable(i.payable_id) - i.amount_cents <> 0) then
      raise exception 'LINE_PARTLY_INVOICED';
    end if;
    -- A dispensa da linha de taxa: a percentual pela própria linha, a fixa pelo mês.
    if i.split_charge_id is not null then
      v_before := public._franchise_line_due(i.split_charge_id);
      update public.split_charges set waived_at = now(), waived_by = (select auth.uid()),
             waived_reason = 'Contestação aceita: ' || v_reason
       where id = i.split_charge_id and waived_at is null;
    else
      select case when p.status = 'cancelada' then 0 else p.amount_cents end into v_before from public.payables p where p.id = i.payable_id;
      insert into public.network_fee_fixed_waivers (clinic_id, fee, period, reason, waived_by)
      values (i.clinic_id, i.fee, i.origin_period, 'Contestação aceita: ' || v_reason, (select auth.uid()))
      on conflict do nothing;
    end if;
    -- Mês fechado: a dispensa entra no mês aberto (6b).
    if not public._franchise_try_refresh(i.clinic_id, i.fee, i.origin_period) then
      perform public._franchise_accrual_adjust(i.clinic_id, i.fee, i.origin_period, -coalesce(v_before, 0),
        'Contestação aceita: ' || v_reason, i.id);
    end if;
    update public.franchise_monthly_items set
      status = case when i.after_issue then 'ativo' else 'dispensado' end,
      decision = 'aceita', decision_reason = v_reason, decided_by = (select auth.uid()), decided_at = now()
     where id = i.id;
    if not i.after_issue then
      update public.franchise_monthly_batches set total_cents = public._franchise_batch_total(b.id), updated_at = now() where id = b.id;
    end if;
  else
    update public.franchise_monthly_items set status = 'ativo', decision = 'recusada', decision_reason = v_reason,
           decided_by = (select auth.uid()), decided_at = now()
     where id = i.id;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), i.clinic_id, 'update', 'franchise_monthly_contest', i.id::text,
          jsonb_build_object('accept', p_accept, 'reason', v_reason, 'after_issue', i.after_issue, 'amount_cents', i.amount_cents));
  perform public._franchise_notify(b.id, 'decisao', i.id::text, true, false, false,
    'Cobrança mensal: contestação ' || case when p_accept then 'aceita' else 'recusada' end,
    case when p_accept and i.after_issue then 'A linha vira crédito na cobrança do mês seguinte. '
         when p_accept then 'A linha foi dispensada. ' else '' end || 'Motivo: ' || v_reason);
end;
$$;

-- Aprovar: sem contestação aberta, depois do prazo (ou conferida), com a
-- configuração completa. Cria a cobrança "emitindo" na conta da franqueadora;
-- o servidor emite no Asaas.
create or replace function public.franchise_monthly_approve(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.franchise_monthly_batches%rowtype;
  cfg record;
  c public.clinics%rowtype;
  v_total bigint;
  v_n integer;
  v_due date;
  v_account uuid;
  v_hq uuid;
  v_charge uuid;
  v_fund_acc uuid;
  v_fund bigint;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  select * into b from public.franchise_monthly_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if b.status <> 'previa' then raise exception 'BATCH_NOT_PREVIEW'; end if;
  if exists (select 1 from public.franchise_monthly_items i where i.batch_id = b.id and i.status = 'contestado') then
    raise exception 'OPEN_CONTEST';
  end if;
  if b.preview_deadline >= public.today_br() and b.unit_ack_at is null then raise exception 'PREVIEW_OPEN'; end if;
  select * into cfg from public._franchise_billing_cfg(b.clinic_id);
  if cardinality(cfg.missing) > 0 then raise exception 'CONFIG_MISSING: %', array_to_string(cfg.missing, ', '); end if;

  select count(*), coalesce(sum(amount_cents), 0) into v_n, v_total
    from public.franchise_monthly_items where batch_id = b.id and status = 'ativo';
  if v_n = 0 or v_total = 0 then
    update public.franchise_monthly_batches set status = 'sem_cobranca', total_cents = v_total, approved_at = now(),
           approved_by = (select auth.uid()), updated_at = now() where id = b.id;
    return jsonb_build_object('status', 'sem_cobranca');
  end if;
  if v_total < public._franchise_min_charge_cents() then
    update public.franchise_monthly_batches set status = 'acumulada', total_cents = v_total, approved_at = now(),
           approved_by = (select auth.uid()), updated_at = now() where id = b.id;
    return jsonb_build_object('status', 'acumulada', 'total_cents', v_total);
  end if;

  select * into c from public.clinics where id = b.clinic_id;
  v_account := public._franchise_root_account();
  select a.clinic_id into v_hq from public.gateway_accounts a where a.id = v_account;
  v_due := greatest(make_date(extract(year from b.period + interval '1 month')::int,
                              extract(month from b.period + interval '1 month')::int, cfg.due_day),
                    public.today_br() + 1);

  -- 5a: o fundo com conta própria recebe a parte dele pelo split (valor fixo).
  select t.split_account_id into v_fund_acc from public.network_fee_types t
    join public.gateway_accounts a on a.id = t.split_account_id and a.status = 'active' and a.wallet_id is not null
   where t.key = 'fundo';
  if v_fund_acc is not null then
    select coalesce(sum(amount_cents), 0) into v_fund from public.franchise_monthly_items
     where batch_id = b.id and status = 'ativo' and fee = 'fundo';
    if v_fund <= 0 then v_fund_acc := null; v_fund := null; end if;
  end if;

  insert into public.charges (clinic_id, gateway_account_id, source_type, source_id, payer_kind, billing_type,
    value_cents, discount_cents, fine_percent, fine_cents, interest_percent, due_date, description, status, created_by)
  values (v_hq, v_account, 'franchise_monthly', b.id, 'unit', 'BOLETO',
    v_total, 0, cfg.fine_percent, round(v_total * cfg.fine_percent / 100.0)::bigint, cfg.interest_percent_month, v_due,
    'Cobrança mensal da rede — ' || to_char(b.period, 'MM/YYYY') || ' — ' || coalesce(c.legal_name, c.name),
    'emitindo', (select auth.uid()))
  returning id into v_charge;

  update public.franchise_monthly_batches set status = 'aprovada', total_cents = v_total, due_date = v_due,
    fine_percent = cfg.fine_percent, interest_percent_month = cfg.interest_percent_month, charge_id = v_charge,
    fund_split_account_id = v_fund_acc, fund_split_cents = v_fund,
    approved_at = now(), approved_by = (select auth.uid()), updated_at = now()
   where id = b.id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), b.clinic_id, 'update', 'franchise_monthly_batch', b.id::text,
          jsonb_build_object('approved', true, 'total_cents', v_total, 'charge_id', v_charge, 'due_date', v_due));
  return jsonb_build_object('status', 'aprovada', 'charge_id', v_charge, 'total_cents', v_total, 'due_date', v_due);
end;
$$;

-- Tentar de novo a emissão que deu erro.
create or replace function public.franchise_monthly_retry(p_batch_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.franchise_monthly_batches%rowtype;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  select * into b from public.franchise_monthly_batches where id = p_batch_id;
  if b.status <> 'aprovada' or b.charge_id is null then raise exception 'BATCH_NOT_APPROVED'; end if;
  update public.charges set status = 'emitindo', error_code = null where id = b.charge_id and status = 'erro_emissao';
  return b.charge_id;
end;
$$;

-- Cancelar a cobrança emitida (para reemitir). Só a última da unidade e só se
-- não paga. O servidor apaga no Asaas; a marca no banco volta o lote.
create or replace function public.franchise_monthly_cancel_check(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.franchise_monthly_batches%rowtype;
  ch public.charges%rowtype;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  select * into b from public.franchise_monthly_batches where id = p_batch_id;
  if b.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if b.status not in ('aprovada', 'emitida') then raise exception 'BATCH_NOT_CANCELLABLE'; end if;
  if exists (select 1 from public.franchise_monthly_batches o where o.clinic_id = b.clinic_id and o.period > b.period and o.status <> 'cancelada') then
    raise exception 'LATER_BATCH_EXISTS';
  end if;
  if exists (select 1 from public.franchise_monthly_items i where i.batch_id = b.id and i.after_issue) then
    raise exception 'CONTEST_AFTER_ISSUE';
  end if;
  select * into ch from public.charges where id = b.charge_id;
  return jsonb_build_object('charge_id', ch.id, 'account_id', ch.gateway_account_id, 'asaas_payment_id', ch.asaas_payment_id,
                            'status', ch.status);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) O SALDO ANTERIOR (20.15.1)
-- -----------------------------------------------------------------------------
create or replace function public.franchise_prior_balance_read(p_clinic_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg record;
  pb public.franchise_prior_balance%rowtype;
begin
  if not public._franchise_can_see(p_clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  select * into cfg from public._franchise_billing_cfg(p_clinic_id);
  select * into pb from public.franchise_prior_balance where clinic_id = p_clinic_id;
  return jsonb_build_object(
    'first_period', cfg.monthly_from,
    'decision', case when pb.clinic_id is null then null else jsonb_build_object(
       'decision', pb.decision, 'installments', pb.installments, 'total_cents', pb.total_cents,
       'reason', pb.reason, 'decided_at', pb.decided_at,
       'decided_by', (select full_name from public.profiles where id = pb.decided_by)) end,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('payable_id', p.id, 'fee', p.network_fee, 'label', public.network_fee_label(p.network_fee),
               'period', p.fee_period, 'amount_cents', p.amount_cents, 'paid_cents', p.paid_amount_cents,
               'open_cents', p.amount_cents - p.paid_amount_cents, 'due_date', p.due_date, 'status', p.status)
             order by p.fee_period, p.network_fee)
        from public.payables p
       where p.clinic_id = p_clinic_id and p.network_fee is not null
         and cfg.monthly_from is not null and p.fee_period < cfg.monthly_from
         and p.status in ('aberta', 'parcial')), '[]'::jsonb));
end;
$$;

create or replace function public.franchise_prior_balance_decide(p_clinic_id uuid, p_decision text, p_installments integer, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  cfg record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_total bigint := 0;
  v_n integer := greatest(1, coalesce(p_installments, 1));
  r record;
  v_ord integer := 0;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  if p_decision not in ('incluir', 'parcelar', 'dispensar') then raise exception 'INVALID_DECISION'; end if;
  if length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_decision = 'incluir' then v_n := 1; end if;
  if p_decision = 'parcelar' and v_n < 2 then raise exception 'INSTALLMENTS_REQUIRED'; end if;
  if exists (select 1 from public.franchise_prior_balance where clinic_id = p_clinic_id) then raise exception 'ALREADY_DECIDED'; end if;
  select * into cfg from public._franchise_billing_cfg(p_clinic_id);
  if cfg.monthly_from is null then raise exception 'MONTHLY_NOT_STARTED'; end if;

  -- As contas de taxa anteriores, refeitas antes (a dispensa já feita sai delas).
  for r in select distinct p.network_fee, p.fee_period from public.payables p
            where p.clinic_id = p_clinic_id and p.network_fee is not null and p.fee_period < cfg.monthly_from
              and p.status in ('aberta', 'parcial') loop
    perform public._franchise_try_refresh(p_clinic_id, r.network_fee, r.fee_period);
  end loop;
  if p_decision = 'dispensar' and exists (
       select 1 from public.payables p where p.clinic_id = p_clinic_id and p.network_fee is not null
          and p.fee_period < cfg.monthly_from and p.status = 'parcial') then
    raise exception 'PARTIAL_PAYABLE';
  end if;

  insert into public.franchise_prior_balance (clinic_id, decision, installments, total_cents, first_period, reason, decided_by)
  values (p_clinic_id, p_decision, v_n, 0, cfg.monthly_from, v_reason, (select auth.uid()));

  for r in select p.id, p.network_fee, p.fee_period, p.amount_cents - p.paid_amount_cents as open_cents
             from public.payables p join public.network_fee_types t on t.key = p.network_fee
            where p.clinic_id = p_clinic_id and p.network_fee is not null and p.fee_period < cfg.monthly_from
              and p.status in ('aberta', 'parcial') and p.amount_cents > p.paid_amount_cents
            order by p.fee_period, t.sort_order loop
    v_ord := v_ord + 1;
    v_total := v_total + r.open_cents;
    insert into public.franchise_prior_balance_lines (clinic_id, payable_id, ord, open_cents)
    values (p_clinic_id, r.id, v_ord, r.open_cents);
    if p_decision = 'dispensar' then
      update public.split_charges set waived_at = now(), waived_by = (select auth.uid()),
             waived_reason = 'Saldo anterior dispensado: ' || v_reason
       where clinic_id = p_clinic_id and fee = r.network_fee and period_month = r.fee_period and waived_at is null;
      if exists (select 1 from public.network_fee_types t where t.key = r.network_fee and t.kind = 'fixed') then
        insert into public.network_fee_fixed_waivers (clinic_id, fee, period, reason, waived_by)
        values (p_clinic_id, r.network_fee, r.fee_period, 'Saldo anterior dispensado: ' || v_reason, (select auth.uid()))
        on conflict do nothing;
      end if;
      -- Mês fechado: a dispensa entra no mês aberto (6b).
      if not public._franchise_try_refresh(p_clinic_id, r.network_fee, r.fee_period) then
        perform public._franchise_accrual_adjust(p_clinic_id, r.network_fee, r.fee_period, -r.open_cents,
          'Saldo anterior dispensado: ' || v_reason, null);
      end if;
    end if;
  end loop;
  update public.franchise_prior_balance set total_cents = v_total where clinic_id = p_clinic_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), p_clinic_id, 'update', 'franchise_prior_balance', p_clinic_id::text,
          jsonb_build_object('decision', p_decision, 'installments', v_n, 'total_cents', v_total, 'reason', v_reason));
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10) A COBRANÇA NO ASAAS: o lote acompanha a cobrança; o aviso do Asaas
-- -----------------------------------------------------------------------------
create or replace function public._franchise_monthly_charge_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_type <> 'franchise_monthly' or new.source_id is null then return null; end if;
  if new.status in ('emitida', 'vencida') then
    update public.franchise_monthly_batches set status = 'emitida', updated_at = now()
     where id = new.source_id and status = 'aprovada';
    if found and new.status = 'emitida' then
      perform public._franchise_notify(new.source_id, 'emitida', '', true, false, false,
        'Cobrança mensal da rede emitida',
        'A cobrança mensal da rede foi emitida (boleto com Pix), com vencimento em ' || to_char(new.due_date, 'DD/MM/YYYY')
        || '. O link está em Financeiro › Cobrança da rede.');
    end if;
  elsif new.status = 'cancelada' then
    update public.franchise_monthly_batches set status = 'cancelada', cancelled_at = now(), cancelled_by = new.cancelled_by,
           cancel_reason = coalesce(new.cancel_reason, 'Cobrança cancelada'), updated_at = now()
     where id = new.source_id and status in ('aprovada', 'emitida');
  end if;
  return null;
end;
$$;
drop trigger if exists charges_franchise_monthly_sync on public.charges;
create trigger charges_franchise_monthly_sync after update of status on public.charges
  for each row when (new.source_type = 'franchise_monthly' and old.status is distinct from new.status)
  execute function public._franchise_monthly_charge_sync();

-- A BAIXA (20.6): paga as contas a pagar de taxa da unidade (o crédito do mês
-- entra como compensação, sem saída de caixa), lança o caixa da franqueadora e
-- multa e juros no financeiro (sem taxa sobre taxa).
create or replace function public._franchise_monthly_settle(p_batch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.franchise_monthly_batches%rowtype;
  r record;
  v_credit bigint;
  v_comp bigint;
  v_cash bigint;
  v_pay uuid;
  v_hq uuid;
  v_ref text;
  v_method text;
begin
  select * into b from public.franchise_monthly_batches where id = p_batch_id for update;
  if b.settled_at is not null then return; end if;
  v_hq := public._franchise_hq();
  select case billing_type when 'PIX' then 'pix' else 'boleto' end into v_method from public.charges where id = b.charge_id;
  v_ref := 'Cobrança mensal da rede ' || to_char(b.period, 'MM/YYYY');

  select coalesce(-sum(amount_cents), 0) into v_credit from public.franchise_monthly_items
   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0;

  for r in
    select i.payable_id, sum(i.amount_cents)::bigint as amt
      from public.franchise_monthly_items i join public.payables p on p.id = i.payable_id
     where i.batch_id = b.id and i.status in ('ativo', 'contestado') and i.amount_cents > 0 and i.payable_id is not null
     group by i.payable_id, p.fee_period order by p.fee_period, i.payable_id
  loop
    v_comp := least(r.amt, v_credit);
    v_credit := v_credit - v_comp;
    v_cash := r.amt - v_comp;
    if v_comp > 0 then
      insert into public.payable_payments (clinic_id, payable_id, amount_cents, paid_at, payment_method, reference, notes, franchise_batch_id)
      values (b.clinic_id, r.payable_id, v_comp, b.paid_on, null, v_ref,
              'Compensação do crédito da cobrança mensal (sem saída de caixa).', b.id);
    end if;
    if v_cash > 0 then
      insert into public.payable_payments (clinic_id, payable_id, amount_cents, paid_at, payment_method, reference, notes, franchise_batch_id)
      values (b.clinic_id, r.payable_id, v_cash, b.paid_on, v_method, v_ref, 'Pago pela cobrança mensal da rede (Asaas).', b.id)
      returning id into v_pay;
      insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
        source_type, source_id, description)
      select b.clinic_id, p.account_code, p.accrual_date, b.paid_on, v_cash, 'outflow', 'settled', 'payable_cash', v_pay,
             'Pagamento — ' || p.description
        from public.payables p where p.id = r.payable_id
      on conflict do nothing;
      -- O caixa da franqueadora (só caixa, como o recebimento de parcela): a receita
      -- por competência continua no lançamento da taxa do mês (20.15.4: os dois jeitos).
      if v_hq is not null and v_hq <> b.clinic_id then
        insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
          source_type, source_id, description)
        select v_hq, (select x.franchisor_account from public.network_fee_accounts(p.network_fee) x), p.accrual_date, b.paid_on,
               v_cash, 'inflow', 'settled', 'receipt_cash', v_pay, 'Recebimento — ' || p.description || ' — ' || v_ref
          from public.payables p where p.id = r.payable_id
        on conflict do nothing;
      end if;
    end if;
  end loop;

  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.
  if coalesce(b.late_cents, 0) > 0 then
    insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
      source_type, source_id, description)
    values (b.clinic_id, '4.2.01', b.paid_on, b.paid_on, b.late_cents, 'outflow', 'settled', 'franchise_monthly_late_unit', b.id,
            'Multa e juros — ' || v_ref)
    on conflict do nothing;
    if v_hq is not null then
      insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
        source_type, source_id, description)
      values (v_hq, '4.1.01', b.paid_on, b.paid_on, b.late_cents, 'inflow', 'settled', 'franchise_monthly_late_hq', b.id,
              'Multa e juros recebidos — ' || v_ref)
      on conflict do nothing;
    end if;
  end if;

  update public.franchise_monthly_batches set settled_at = now(),
    settle_note = case when v_credit > 0 then 'Crédito maior que as contas do mês: ' || v_credit || ' centavos ficaram sem compensar.' end,
    updated_at = now()
   where id = b.id;
end;
$$;

create or replace function public._franchise_monthly_event(p_charge_id uuid, p_event text, p_payment jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.charges%rowtype;
  b public.franchise_monthly_batches%rowtype;
  v_paid bigint := round(coalesce((p_payment->>'value')::numeric, 0) * 100);
  v_net bigint := round((p_payment->>'netValue')::numeric * 100);
  v_on date := coalesce((p_payment->>'clientPaymentDate')::date, (p_payment->>'paymentDate')::date,
                        (p_payment->>'confirmedDate')::date, public.today_br());
  v_credit date := coalesce((p_payment->>'creditDate')::date, (p_payment->>'estimatedCreditDate')::date);
  v_final text;
begin
  select * into c from public.charges where id = p_charge_id for update;
  select * into b from public.franchise_monthly_batches where id = c.source_id for update;

  if p_event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    v_final := case when p_event = 'PAYMENT_CONFIRMED' then 'paga' else 'liquidada' end;
    if c.status in ('paga', 'liquidada') then
      if v_final = 'liquidada' and c.status = 'paga' then
        update public.charges set status = 'liquidada', credit_date = coalesce(v_credit, credit_date), last_event_at = now() where id = c.id;
        return 'liquidada';
      end if;
      return 'ja_baixada';
    end if;
    if c.status in ('cancelada', 'estornada') then
      update public.charges set paid_cents = v_paid, paid_on = v_on, last_event_at = now() where id = c.id;
      perform public._franchise_notify(b.id, 'paga_depois_de_cancelada', c.id::text, false, true, true,
        'Cobrança mensal paga depois de cancelada',
        'A unidade pagou uma cobrança mensal que o riSZon tinha cancelado. Trate a devolução ou a compensação à mão.');
      return 'duplicidade';
    end if;
    update public.charges set status = v_final, paid_cents = v_paid, paid_on = v_on, credit_date = v_credit,
           fee_cents = case when v_net is not null then v_paid - v_net end, net_cents = v_net, last_event_at = now()
     where id = c.id;
    update public.franchise_monthly_batches set status = 'paga', paid_on = v_on, paid_cents = v_paid,
           late_cents = greatest(v_paid - coalesce(b.total_cents, 0), 0), updated_at = now()
     where id = b.id;
    if v_paid >= coalesce(b.total_cents, 0) then
      perform public._franchise_monthly_settle(b.id);
    else
      update public.franchise_monthly_batches set settle_note = 'Pago a menor: ' || v_paid || ' de ' || b.total_cents || ' centavos. Baixa à mão.'
       where id = b.id;
      perform public._franchise_notify(b.id, 'paga_a_menor', '', false, true, true,
        'Cobrança mensal paga a menor', 'O Asaas avisou um pagamento menor que o total da cobrança mensal. A baixa não foi feita: confira e dê a baixa à mão.');
    end if;
    -- A tarifa do Asaas é da franqueadora (20.15.5).
    if v_net is not null and v_paid - v_net > 0
       and not exists (select 1 from public.financial_entries f where f.source_type = 'gateway_fee_charge' and f.source_id = c.id) then
      insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
        amount_cents, direction, status, source_type, source_id, description)
      values (c.clinic_id, '2.4.02', v_on, coalesce(v_credit, v_on), coalesce(v_credit, v_on), v_paid - v_net, 'outflow', 'settled',
        'gateway_fee_charge', c.id, 'Tarifa do Asaas — cobrança mensal da rede');
    end if;
    perform public._franchise_notify(b.id, 'paga', '', true, true, false,
      'Cobrança mensal da rede paga', 'O pagamento da cobrança de ' || to_char(b.period, 'MM/YYYY') || ' foi recebido. As contas de taxa do mês foram baixadas.');
    return 'baixa';

  elsif p_event = 'PAYMENT_OVERDUE' then
    if c.status = 'emitida' then
      update public.charges set status = 'vencida', last_event_at = now() where id = c.id;
      return 'vencida';
    end if;
    return 'sem_efeito';

  elsif p_event = 'PAYMENT_DELETED' then
    if c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
      update public.charges set status = 'cancelada', cancelled_at = now(), cancelled_by = null,
             cancel_reason = 'Apagada no painel do Asaas', last_event_at = now()
       where id = c.id;
      perform public._franchise_notify(b.id, 'apagada_no_asaas', c.id::text, false, true, true,
        'Cobrança mensal apagada no Asaas', 'A cobrança mensal foi apagada direto no painel do Asaas. A prévia volta a ser montada.');
      return 'cancelada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif p_event in ('PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
                    'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
                    'PAYMENT_UPDATED', 'PAYMENT_RESTORED') then
    if p_event = 'PAYMENT_REFUNDED' and c.status in ('paga', 'liquidada') then
      update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
    end if;
    if p_event = 'PAYMENT_UPDATED'
       and round(coalesce((p_payment->>'value')::numeric, 0) * 100) = coalesce(c.value_cents, 0)
       and (p_payment->>'dueDate')::date is not distinct from c.due_date then
      return 'sem_efeito';
    end if;
    perform public._franchise_notify(b.id, lower(p_event), coalesce(p_payment->>'id', '') || public.today_br()::text, false, true, true,
      'Cobrança mensal: ' || p_event, 'O Asaas avisou ' || p_event || ' na cobrança mensal da rede. O Financeiro trata à mão.');
    return 'aviso_manual';
  end if;
  return 'sem_efeito';
end;
$$;

-- -----------------------------------------------------------------------------
-- 11) A ROTINA DO DIA (pelo cron das cobranças)
-- -----------------------------------------------------------------------------
create or replace function public._franchise_monthly_cron()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.today_br();
  v_period date := (date_trunc('month', public.today_br()) - interval '1 month')::date;
  u record;
  b record;
  cfg record;
  v_id uuid;
  v_open integer := 0; v_notes integer := 0;
  v_days integer;
begin
  -- A) Abre a prévia do mês que fechou, de cada unidade com a configuração completa.
  for u in
    select c.id from public.clinics c join public.franchise_billing_unit_settings s on s.clinic_id = c.id
     where c.type = 'franchise_unit' and c.is_active and s.monthly_from is not null and s.monthly_from <= v_period
       and (s.ended_on is null or s.ended_on >= v_period)
       and not exists (select 1 from public.franchise_monthly_batches x where x.clinic_id = c.id and x.period = v_period and x.status <> 'cancelada')
  loop
    select * into cfg from public._franchise_billing_cfg(u.id);
    continue when cardinality(cfg.missing) > 0;
    begin
      v_id := public._franchise_monthly_build(u.id, v_period, null);
      perform public._franchise_monthly_opened(v_id);
      v_open := v_open + 1;
    exception when others then
      raise warning 'franchise monthly build failed for %: %', u.id, sqlerrm;
    end;
  end loop;

  -- B) 1 dia útil antes do fim da janela: o lembrete à unidade.
  for b in select * from public.franchise_monthly_batches x
            where x.status = 'previa' and public._franchise_prev_business_day(x.preview_deadline) = v_today and x.unit_ack_at is null loop
    v_notes := v_notes + public._franchise_notify(b.id, 'lembrete_prazo', '', true, false, false,
      'Cobrança mensal: o prazo da prévia termina ' || to_char(b.preview_deadline, 'DD/MM'),
      'Confira a prévia de ' || to_char(b.period, 'MM/YYYY') || ' até ' || to_char(b.preview_deadline, 'DD/MM')
      || '. Sem contestação até essa data, a cobrança segue para aprovação e é emitida.');
  end loop;

  -- C) Janela fechada (ou conferida) sem contestação: pronta para a aprovação.
  for b in select * from public.franchise_monthly_batches x
            where x.status = 'previa' and (x.preview_deadline < v_today or x.unit_ack_at is not null)
              and not exists (select 1 from public.franchise_monthly_items i where i.batch_id = x.id and i.status = 'contestado') loop
    v_notes := v_notes + public._franchise_notify(b.id, 'pronta', '', false, true, false,
      'Cobrança mensal pronta para aprovação',
      'A prévia de ' || to_char(b.period, 'MM/YYYY') || ' de uma unidade está pronta para a aprovação e a emissão.');
  end loop;

  -- D) Em atraso: aviso a cada 7 dias; aos 30, o Admin Master (20.7, decisão 3a).
  for b in select x.*, ch.due_date as ch_due from public.franchise_monthly_batches x join public.charges ch on ch.id = x.charge_id
            where x.status = 'emitida' and ch.status = 'vencida' loop
    v_days := v_today - b.ch_due;
    if v_days >= 1 then
      v_notes := v_notes + public._franchise_notify(b.id, 'atraso', (v_days / 7)::text, true, true, false,
        'Cobrança mensal da rede em atraso',
        'A cobrança de ' || to_char(b.period, 'MM/YYYY') || ' está em atraso há ' || v_days || ' dia(s), com multa e juros.');
    end if;
    if v_days >= 30 then
      v_notes := v_notes + public._franchise_notify(b.id, 'atraso_30', '', false, false, true,
        'Unidade em atraso com a rede há 30 dias',
        'A cobrança mensal de ' || to_char(b.period, 'MM/YYYY') || ' de uma unidade está em atraso há ' || v_days || ' dias. Nada é bloqueado sozinho.');
    end if;
  end loop;

  return jsonb_build_object('previas_abertas', v_open, 'avisos', v_notes);
end;
$$;

-- O plano do split (5a): só o fundo com conta própria, com o valor fixo.
create or replace function public._franchise_monthly_split_plan(p_charge_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when b.fund_split_account_id is null or coalesce(b.fund_split_cents, 0) <= 0 then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('walletId', a.wallet_id, 'fixedCents', b.fund_split_cents, 'accountId', a.id)) end
    from public.franchise_monthly_batches b left join public.gateway_accounts a on a.id = b.fund_split_account_id
   where b.charge_id = p_charge_id;
$$;

-- O pagador da cobrança mensal (o servidor cria ou acha no Asaas).
create or replace function public._franchise_monthly_payer(p_charge_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('clinic_id', c.id, 'name', coalesce(c.legal_name, c.name), 'cnpj', public.cpf_digits(c.cnpj),
           'email', s.finance_email, 'example', s.example_values,
           'asaas_customer_id', gc.asaas_customer_id, 'gateway_customer_id', gc.id)
    from public.charges ch
    join public.franchise_monthly_batches b on b.id = ch.source_id
    join public.clinics c on c.id = b.clinic_id
    left join public.franchise_billing_unit_settings s on s.clinic_id = c.id
    left join public.gateway_customers gc on gc.gateway_account_id = ch.gateway_account_id and gc.cpf_cnpj = public.cpf_digits(c.cnpj)
   where ch.id = p_charge_id and ch.source_type = 'franchise_monthly';
$$;

create or replace function public._franchise_monthly_payer_save(p_charge_id uuid, p_asaas_customer_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; ch public.charges%rowtype; v_clinic uuid; v_cnpj text;
begin
  select * into ch from public.charges where id = p_charge_id and source_type = 'franchise_monthly';
  if ch.id is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  select b.clinic_id, public.cpf_digits(c.cnpj) into v_clinic, v_cnpj
    from public.franchise_monthly_batches b join public.clinics c on c.id = b.clinic_id where b.id = ch.source_id;
  insert into public.gateway_customers (gateway_account_id, cpf_cnpj, asaas_customer_id, owner_kind, unit_clinic_id)
  values (ch.gateway_account_id, v_cnpj, p_asaas_customer_id, 'unit', v_clinic)
  on conflict (gateway_account_id, cpf_cnpj) do update set asaas_customer_id = excluded.asaas_customer_id, synced_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12) A CONFIGURAÇÃO NA CENTRAL (20.12 e 20.15.6)
-- -----------------------------------------------------------------------------
create or replace function public.franchise_billing_config_read()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare n public.franchise_billing_settings%rowtype;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  select * into n from public.franchise_billing_settings where id;
  return jsonb_build_object(
    'network', to_jsonb(n) - 'id',
    'root_account', (select jsonb_build_object('id', a.id, 'label', a.label, 'environment', a.environment)
                       from public.gateway_accounts a where a.id = public._franchise_root_account()),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clinic_id', c.id, 'name', c.name, 'legal_name', c.legal_name, 'cnpj', c.cnpj, 'go_live_on', c.go_live_on,
               'settings', coalesce(to_jsonb(s) - 'clinic_id', '{}'::jsonb),
               'missing', to_jsonb((select f.missing from public._franchise_billing_cfg(c.id) f)),
               'fixed', (select jsonb_agg(jsonb_build_object('fee', t.key, 'label', t.label, 'amount_cents', f.amount_cents,
                                   'active', f.active, 'is_override', f.is_override) order by t.sort_order)
                           from public.network_fee_types t cross join lateral public.network_fee_for(c.id, t.key, null) f
                          where t.kind = 'fixed' and t.active))
             order by c.name)
        from public.clinics c left join public.franchise_billing_unit_settings s on s.clinic_id = c.id
       where c.type = 'franchise_unit' and c.is_active), '[]'::jsonb));
end;
$$;

create or replace function public.franchise_billing_settings_save(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  update public.franchise_billing_settings set
    fine_percent = (nullif(p->>'fine_percent', ''))::numeric,
    interest_percent_month = (nullif(p->>'interest_percent_month', ''))::numeric,
    due_day = (nullif(p->>'due_day', ''))::integer,
    period_kind = nullif(p->>'period_kind', ''),
    preview_days = (nullif(p->>'preview_days', ''))::integer,
    partial_month_rule = nullif(p->>'partial_month_rule', ''),
    revenue_recognition = nullif(p->>'revenue_recognition', ''),
    example_values = coalesce((p->>'example_values')::boolean, false),
    updated_at = now(), updated_by = (select auth.uid())
  where id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), null, 'update', 'franchise_billing_settings', 'rede', p);
end;
$$;

create or replace function public.franchise_billing_unit_save(p_clinic_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id and type = 'franchise_unit') then raise exception 'CLINIC_NOT_FOUND'; end if;
  insert into public.franchise_billing_unit_settings (clinic_id, fine_percent, interest_percent_month, due_day, finance_email,
    monthly_from, started_on, ended_on, example_values, updated_by)
  values (p_clinic_id, (nullif(p->>'fine_percent', ''))::numeric, (nullif(p->>'interest_percent_month', ''))::numeric,
    (nullif(p->>'due_day', ''))::integer, nullif(btrim(coalesce(p->>'finance_email', '')), ''),
    date_trunc('month', (nullif(p->>'monthly_from', ''))::date)::date, (nullif(p->>'started_on', ''))::date,
    (nullif(p->>'ended_on', ''))::date, coalesce((p->>'example_values')::boolean, false), (select auth.uid()))
  on conflict (clinic_id) do update set
    fine_percent = excluded.fine_percent, interest_percent_month = excluded.interest_percent_month, due_day = excluded.due_day,
    finance_email = excluded.finance_email, monthly_from = excluded.monthly_from, started_on = excluded.started_on,
    ended_on = excluded.ended_on, example_values = excluded.example_values, updated_at = now(), updated_by = excluded.updated_by;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), p_clinic_id, 'update', 'franchise_billing_unit_settings', p_clinic_id::text, p);
end;
$$;

-- -----------------------------------------------------------------------------
-- 13) AS LEITURAS: a lista e o demonstrativo (20.4)
-- -----------------------------------------------------------------------------
create or replace function public.franchise_monthly_list(p_clinic_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_clinic_id is not null and not public._franchise_can_see(p_clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'clinic_id', b.clinic_id, 'clinic_name', c.name, 'period', b.period, 'status', b.status,
             'total_cents', b.total_cents, 'preview_deadline', b.preview_deadline, 'unit_ack_at', b.unit_ack_at,
             'due_date', b.due_date, 'paid_on', b.paid_on, 'charge_status', ch.status, 'example_values', b.example_values,
             'contests', (select count(*) from public.franchise_monthly_items i where i.batch_id = b.id and i.status = 'contestado'))
           order by b.period desc, c.name)
      from public.franchise_monthly_batches b join public.clinics c on c.id = b.clinic_id
      left join public.charges ch on ch.id = b.charge_id
     where b.status <> 'cancelada'
       and (p_clinic_id is null or b.clinic_id = p_clinic_id)
       and public._franchise_can_see(b.clinic_id)), '[]'::jsonb);
end;
$$;

create or replace function public.franchise_monthly_read(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.franchise_monthly_batches%rowtype;
  c public.clinics%rowtype;
  ch public.charges%rowtype;
  v_manage boolean := public._franchise_can_manage();
begin
  select * into b from public.franchise_monthly_batches where id = p_batch_id;
  if b.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if not public._franchise_can_see(b.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  select * into c from public.clinics where id = b.clinic_id;
  select * into ch from public.charges where id = b.charge_id;
  return jsonb_build_object(
    'batch', to_jsonb(b) - 'fund_split_account_id',
    'clinic', jsonb_build_object('id', c.id, 'name', c.name, 'legal_name', c.legal_name, 'cnpj', c.cnpj),
    'charge', case when ch.id is null then null else jsonb_build_object('id', ch.id, 'status', ch.status, 'invoice_url', ch.invoice_url,
                'bank_slip_url', ch.bank_slip_url, 'identification_field', ch.identification_field, 'pix_copy_paste', ch.pix_copy_paste,
                'due_date', ch.due_date, 'value_cents', ch.value_cents, 'paid_cents', ch.paid_cents, 'paid_on', ch.paid_on,
                'error_code', ch.error_code) end,
    'can_manage', v_manage,
    -- Para a confirmação da emissão: o vencimento previsto e o e-mail do aviso do Asaas.
    'previsto', (select jsonb_build_object(
        'due_date', case when f.due_day is null then null else greatest(
                      make_date(extract(year from b.period + interval '1 month')::int, extract(month from b.period + interval '1 month')::int, f.due_day),
                      public.today_br() + 1) end,
        'finance_email', f.finance_email,
        'missing', to_jsonb(f.missing))
      from public._franchise_billing_cfg(b.clinic_id) f),
    'can_contest', public.has_role_in_clinic(b.clinic_id, array['unit_manager', 'franchisee']::public.user_role[]),
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'clinic_id' || jsonb_build_object('fee_label', public.network_fee_label(i.fee))
                         order by case i.kind when 'fixa' then 1 when 'percentual' then 2 when 'ajuste' then 3 when 'credito' then 4 else 5 end,
                                  i.fee, i.origin_period, i.received_on, i.created_at)
                         from public.franchise_monthly_items i where i.batch_id = b.id), '[]'::jsonb),
    -- Informativo (20.4): o retido pelo split, o "a reter" e o dispensado no período.
    'info', (select jsonb_build_object(
        'retido_cents', coalesce(sum(sc.retained_cents) filter (where not sc.reversed and not public._split_charge_awaiting(sc.id)), 0),
        'a_reter_cents', coalesce(sum(sc.retained_cents) filter (where public._split_charge_awaiting(sc.id)), 0),
        'dispensado_cents', coalesce(sum(sc.amount_cents - sc.retained_cents) filter (where sc.waived_at is not null and not sc.reversed), 0))
      from public.split_charges sc where sc.clinic_id = b.clinic_id and sc.period_month = b.period),
    'notice', case when b.status = 'previa' then
       'Confira até ' || to_char(b.preview_deadline, 'DD/MM') || '. Sem contestação até essa data, a cobrança segue para aprovação e é emitida.'
       when b.status = 'acumulada' then 'Valor abaixo do mínimo do Asaas (R$ 5,00): acumula para a cobrança do mês seguinte.'
       when b.status = 'sem_cobranca' then 'Nada a cobrar neste mês.' end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 14) REDEFINIÇÕES: a conta a pagar de taxa (dispensa e mês incompleto), o aviso do Asaas e o pagador
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_network_fee_payable(p_clinic_id uuid, p_fee text, p_period date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cfg record;
  v_acc record;
  v_total bigint;
  v_payable uuid;
  v_due date;
  v_franchisor uuid;
  v_label text := public.network_fee_label(p_fee);
  v_start date; v_end date; v_rule text; v_mdue integer; v_from date; v_to date; v_days integer; v_dim integer;
begin
  select * into v_cfg from public.network_fee_for(p_clinic_id, p_fee, p_period);
  if v_cfg is null then return; end if;
  select * into v_acc from public.network_fee_accounts(p_fee);
  if v_acc is null then return; end if;

  if v_cfg.kind = 'percent' then
    -- ASA3: o que o split reteve na origem não é cobrado de novo.
    select coalesce(sum(amount_cents - retained_cents), 0) into v_total
      from public.split_charges
     where clinic_id = p_clinic_id and fee = p_fee
       and period_month = p_period and not reversed
       and waived_at is null;  -- 4021: a linha dispensada sai da conta
  else
    v_total := case when v_cfg.active then v_cfg.amount_cents else 0 end;
    -- 4021: a taxa fixa dispensada no mês.
    if exists (select 1 from public.network_fee_fixed_waivers w
                where w.clinic_id = p_clinic_id and w.fee = p_fee and w.period = p_period) then
      v_total := 0;
    end if;
    -- 4021 (20.15.3): o mês incompleto — início ou saída das atividades da unidade.
    select s.started_on, s.ended_on, n.partial_month_rule into v_start, v_end, v_rule
      from public.franchise_billing_unit_settings s cross join public.franchise_billing_settings n
     where s.clinic_id = p_clinic_id and n.id;
    if v_total > 0 and (v_start is not null or v_end is not null) then
      v_from := greatest(p_period, coalesce(v_start, p_period));
      v_to := least((p_period + interval '1 month' - interval '1 day')::date,
                    coalesce(v_end, (p_period + interval '1 month' - interval '1 day')::date));
      v_days := v_to - v_from + 1;
      v_dim := (p_period + interval '1 month')::date - p_period;
      if v_days <= 0 then
        v_total := 0;
      elsif v_days < v_dim and v_rule = 'proporcional' then
        v_total := round(v_total * v_days::numeric / v_dim)::bigint;
      end if;
    end if;
  end if;

  v_due := (p_period + interval '1 month')::date
           + (coalesce(v_cfg.due_day, 10) - 1);

  -- 4021: com a cobrança mensal ligada na unidade (o mês a partir do 1º), vale o
  -- vencimento DELA, não o dia de cada taxa (um só vencimento na tela).
  select coalesce(s.due_day, n.due_day) into v_mdue
    from public.franchise_billing_unit_settings s cross join public.franchise_billing_settings n
   where s.clinic_id = p_clinic_id and n.id and s.monthly_from is not null and s.monthly_from <= p_period;
  if v_mdue is not null then
    v_due := make_date(extract(year from p_period + interval '1 month')::int,
                       extract(month from p_period + interval '1 month')::int, v_mdue);
  end if;

  select id into v_payable from public.payables
   where clinic_id = p_clinic_id and network_fee = p_fee
     and fee_period = p_period;

  -- 4021: a conta cancelada À MÃO (por quem decide, com o motivo) não volta sozinha.
  -- Só a cancelada pela própria apuração ("Sem valor apurado no mês") é refeita.
  if v_payable is not null and exists (
       select 1 from public.payables x where x.id = v_payable and x.status = 'cancelada'
          and coalesce(x.cancel_reason, '') <> 'Sem valor apurado no mês') then
    return;
  end if;

  if v_total <= 0 then
    if v_payable is not null then
      update public.payables set status = 'cancelada',
        cancel_reason = 'Sem valor apurado no mês', updated_at = now()
       where id = v_payable and status <> 'paga';
      update public.financial_entries set status = 'cancelled'
       where source_type = 'payable_accrual' and source_id = v_payable;
      update public.financial_entries set status = 'cancelled'
       where source_type = 'network_fee_revenue' and source_id = v_payable;
    end if;
    return;
  end if;

  if v_payable is null then
    insert into public.payables (
      clinic_id, account_code, description, accrual_date, due_date,
      amount_cents, status, approval_mode, requires_approval,
      network_fee, fee_period, notes
    ) values (
      p_clinic_id, v_acc.unit_account,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
        || coalesce(' (' || v_cfg.campaign_name || ')', ''),
      p_period, v_due, v_total, 'aberta',
      'sem_autorizacao', false,
      p_fee, p_period,
      'Apurado automaticamente sobre os recebimentos do mês.'
    ) returning id into v_payable;

    perform public.post_payable_accrual(v_payable);
  else
    update public.payables set
      amount_cents = v_total, due_date = v_due,
      -- 4021: o valor mudou (dispensa, contestação aceita): a situação acompanha o pago.
      status = case
        when status = 'cancelada' then 'aberta'
        when status in ('aberta', 'parcial', 'paga') then
          case when paid_amount_cents + coalesce((select sum(pp.discount_cents) from public.payable_payments pp
                                                   where pp.payable_id = v_payable and not pp.reversed and pp.reversal_of is null), 0) >= v_total
                 then 'paga'
               when paid_amount_cents > 0 then 'parcial'
               else 'aberta' end
        else status end,
      updated_at = now()
     where id = v_payable;

    update public.financial_entries set
      amount_cents = v_total, status = 'open', updated_at = now()
     where source_type = 'payable_accrual' and source_id = v_payable;

    perform public.post_payable_accrual(v_payable);
  end if;

  select id into v_franchisor from public.clinics
   where type = 'franchisor' limit 1;

  if v_franchisor is not null and v_franchisor <> p_clinic_id then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description
    ) values (
      v_franchisor, v_acc.franchisor_account, p_period, null, v_due,
      v_total, 'inflow', 'open', 'network_fee_revenue', v_payable,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
    )
    on conflict (source_type, source_id)
      where source_type = 'network_fee_revenue'
    do update set amount_cents = excluded.amount_cents,
                  expected_settlement_date = excluded.expected_settlement_date,
                  status = 'open',
                  updated_at = now();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public._gateway_apply_event(p_event_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- 4021 (ASA6): a cobrança mensal da rede tem o ramo dela.
  if c.source_type = 'franchise_monthly' and to_regprocedure('public._franchise_monthly_event(uuid,text,jsonb)') is not null then
    return public._franchise_monthly_event(c.id, e.event, p);
  end if;

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
    -- 4018: a mensalidade estornada continua como paga; a unidade decide desfazer a baixa.
    if c.source_type <> 'installment' then
      if c.status in ('paga', 'liquidada', 'em_contestacao') then
        update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
      end if;
      -- 4020 (19.35.8): o estorno da mensalidade do PPR+ tira os pontos do Riso+ Social dela.
      if c.source_type = 'ppr_charge' then
        delete from public.ppr_social_points sp
         using public.ppr_charges pc
         where pc.id = c.source_id and sp.membership_id = pc.membership_id and sp.reference_month = pc.reference_month;
      end if;
      perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
        'Estorno de mensalidade no Asaas',
        'Uma mensalidade paga pelo Asaas foi estornada. Ela continua marcada como paga: desfaça a baixa à mão, se for o caso.',
        v_link);
      return 'estornada';
    end if;
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

  elsif e.event = 'PAYMENT_PARTIALLY_REFUNDED'
        and to_regprocedure('public._charge_refund_partial_event(uuid,jsonb)') is not null
        and exists (select 1 from public.charge_refunds f where f.charge_id = c.id and f.status = 'pedido' and f.amount_cents is not null) then
    -- 4020a: o estorno parcial pedido pelo riSZon (o pedido fecha, com o comprovante).
    return public._charge_refund_partial_event(c.id, p);

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
$function$;

CREATE OR REPLACE FUNCTION public._charge_for_gateway(p_charge_id uuid)
 RETURNS TABLE(charge_id uuid, status text, clinic_id uuid, gateway_account_id uuid, billing_type text, value_cents bigint, discount_cents bigint, fine_percent numeric, fine_cents bigint, interest_percent numeric, due_date date, description text, asaas_payment_id text, payer_kind text, payer_guardian_id uuid, client_id uuid, payer_name text, payer_cpf text, asaas_customer_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, c.status, c.clinic_id, c.gateway_account_id, c.billing_type, c.value_cents,
         c.discount_cents, c.fine_percent, c.fine_cents, c.interest_percent, c.due_date,
         coalesce(c.description, 'Parcela ' || i.seq || ' — ' || cl.name),
         c.asaas_payment_id, c.payer_kind, c.payer_guardian_id, c.client_id,
         coalesce(g.full_name, k.full_name, u.legal_name, u.name),
         public.cpf_digits(coalesce(g.cpf, k.cpf, u.cnpj)),
         gc.asaas_customer_id
    from public.charges c
    left join public.payment_installments i on i.id = c.payment_installment_id
    join public.clinics cl on cl.id = c.clinic_id
    left join public.clients k on k.id = c.client_id
    left join public.client_guardians g on g.id = c.payer_guardian_id
    left join public.franchise_monthly_batches fb on c.source_type = 'franchise_monthly' and fb.id = c.source_id
    left join public.clinics u on u.id = fb.clinic_id
    left join public.gateway_customers gc
      on gc.gateway_account_id = c.gateway_account_id
     and gc.cpf_cnpj = public.cpf_digits(coalesce(g.cpf, k.cpf, u.cnpj))
   where c.id = p_charge_id;
$function$;

-- Os pagamentos de cobrança mensal feitos antes da coluna do lote: ligados ao lote pago.
update public.payable_payments pp
   set franchise_batch_id = b.id
  from public.franchise_monthly_batches b
 where pp.franchise_batch_id is null and b.status = 'paga' and pp.clinic_id = b.clinic_id
   and pp.paid_at = b.paid_on and pp.reference = 'Cobrança mensal da rede ' || to_char(b.period, 'MM/YYYY');

-- -----------------------------------------------------------------------------
-- 15) PERMISSÕES
-- -----------------------------------------------------------------------------
revoke execute on function public._franchise_accrual_adjust(uuid,text,date,bigint,text,uuid) from public, anon, authenticated;
revoke execute on function public._franchise_batch_holds(text) from public, anon, authenticated;
revoke execute on function public._franchise_batch_total(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_billing_cfg(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_can_manage() from public, anon, authenticated;
revoke execute on function public._franchise_can_see(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_hq() from public, anon, authenticated;
revoke execute on function public._franchise_invoiced_line(uuid,uuid) from public, anon, authenticated;
revoke execute on function public._franchise_invoiced_payable(uuid,uuid) from public, anon, authenticated;
revoke execute on function public._franchise_line_due(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_line_info(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_min_charge_cents() from public, anon, authenticated;
revoke execute on function public._franchise_monthly_build(uuid,date,uuid) from public, anon, authenticated;
revoke execute on function public._franchise_monthly_charge_sync() from public, anon, authenticated;
revoke execute on function public._franchise_monthly_cron() from public, anon, authenticated;
revoke execute on function public._franchise_monthly_event(uuid,text,jsonb) from public, anon, authenticated;
revoke execute on function public._franchise_monthly_opened(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_monthly_payer(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_monthly_payer_save(uuid,text) from public, anon, authenticated;
revoke execute on function public._franchise_monthly_settle(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_monthly_split_plan(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_notify(uuid,text,text,boolean,boolean,boolean,text,text) from public, anon, authenticated;
revoke execute on function public._franchise_payout_charge_fees(date,date,uuid[],uuid) from public, anon, authenticated;
revoke execute on function public._franchise_payout_receipts(date,date,uuid[],uuid) from public, anon, authenticated;
revoke execute on function public._franchise_prev_business_day(date) from public, anon, authenticated;
revoke execute on function public._franchise_root_account() from public, anon, authenticated;
revoke execute on function public._franchise_short_name(text) from public, anon, authenticated;
revoke execute on function public._franchise_try_refresh(uuid,text,date) from public, anon, authenticated;
revoke execute on function public.franchise_billing_config_read() from public, anon, authenticated;
revoke execute on function public.franchise_billing_settings_save(jsonb) from public, anon, authenticated;
revoke execute on function public.franchise_billing_unit_save(uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_ack(uuid) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_approve(uuid) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_cancel_check(uuid) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_contest(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_decide(uuid,boolean,text) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_list(uuid) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_open(uuid,date) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_read(uuid) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_rebuild(uuid,text) from public, anon, authenticated;
revoke execute on function public.franchise_monthly_retry(uuid) from public, anon, authenticated;
revoke execute on function public.franchise_payouts_permutas(date,date,uuid) from public, anon, authenticated;
revoke execute on function public.franchise_payouts_read(date,date,uuid,text) from public, anon, authenticated;
revoke execute on function public.franchise_prior_balance_decide(uuid,text,integer,text) from public, anon, authenticated;
revoke execute on function public.franchise_prior_balance_read(uuid) from public, anon, authenticated;
grant execute on function public.franchise_monthly_open(uuid, date) to authenticated;
grant execute on function public.franchise_monthly_rebuild(uuid, text) to authenticated;
grant execute on function public.franchise_monthly_ack(uuid) to authenticated;
grant execute on function public.franchise_monthly_contest(uuid, text, text) to authenticated;
grant execute on function public.franchise_monthly_decide(uuid, boolean, text) to authenticated;
grant execute on function public.franchise_monthly_approve(uuid) to authenticated;
grant execute on function public.franchise_monthly_retry(uuid) to authenticated;
grant execute on function public.franchise_monthly_cancel_check(uuid) to authenticated;
grant execute on function public.franchise_prior_balance_read(uuid) to authenticated;
grant execute on function public.franchise_prior_balance_decide(uuid, text, integer, text) to authenticated;
grant execute on function public.franchise_billing_config_read() to authenticated;
grant execute on function public.franchise_billing_settings_save(jsonb) to authenticated;
grant execute on function public.franchise_billing_unit_save(uuid, jsonb) to authenticated;
grant execute on function public.franchise_monthly_list(uuid) to authenticated;
grant execute on function public.franchise_monthly_read(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 16) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in (
     'franchise_billing_settings', 'franchise_billing_unit_settings', 'network_fee_fixed_waivers', 'franchise_monthly_batches',
     'franchise_monthly_items', 'franchise_prior_balance', 'franchise_prior_balance_lines', 'franchise_monthly_notices')) as tabelas_novas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '\_franchise\_%' or p.proname like 'franchise\_%')) as funcoes_novas,
  (select fine_percent is null and interest_percent_month is null and due_day is null and period_kind is null
          and preview_days is null and partial_month_rule is null and revenue_recognition is null
     from public.franchise_billing_settings where id) as configuracao_em_branco,
  (select count(*) from public.franchise_billing_unit_settings) as unidades_configuradas,
  (select count(*) from public.franchise_monthly_batches) as lotes,
  position('waived_at is null' in pg_get_functiondef('public.refresh_network_fee_payable(uuid, text, date)'::regprocedure)) > 0
    and position('_franchise_monthly_event' in pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure)) > 0
    as ramos_ligados;
