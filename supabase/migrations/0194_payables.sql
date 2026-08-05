-- =============================================================================
-- 0194 — FIN3: CONTAS A PAGAR
-- -----------------------------------------------------------------------------
-- O outro lado do caixa. Até aqui o sistema sabia tudo o que ENTRA (FIN1/FIN2)
-- e nada do que SAI — sem isso não existe DRE, nem fluxo de caixa, nem ponto de
-- equilíbrio.
--
-- Regra estrutural do módulo (CLAUDE.md 8b): toda despesa nasce CLASSIFICADA —
-- conta do plano de contas + centro de custo. É isso que faz a DRE fechar
-- sozinha depois, em vez de alguém classificar 500 lançamentos no fim do mês.
--
-- ALÇADA CONFIGURÁVEL (decisão do dono, 04/08/2026): cada conta do plano de
-- contas tem um MODO DE APROVAÇÃO, no padrão cascata (rede → unidade), com teto
-- de valor opcional:
--   • automatica       — despesa já contratada (aluguel, contabilidade). Nunca
--                        pede autorização e NÃO olha o teto.
--   • sem_autorizacao  — lança e paga direto, MAS respeita o teto.
--   • com_autorizacao  — sempre exige liberação, qualquer valor.
-- A linha com `account_code` nulo é o padrão geral ("tudo acima de X precisa
-- de liberação"); a linha com conta específica sobrescreve.
--
-- SEGREGAÇÃO DE FUNÇÃO: quem lançou a conta NÃO autoriza a si mesmo. Senão a
-- alçada vira teatro.
--
-- Multa e juros PAGOS por atraso nosso vão para 4.2.01, separados da despesa —
-- e são INFORMADOS, não calculados: quem define a multa é o fornecedor, não a
-- nossa configuração.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) FORNECEDORES
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null,
  -- CNPJ ou CPF, só dígitos (mesma convenção das máscaras do app).
  document text,
  kind text not null default 'outros'
    check (kind in ('laboratorio', 'dental', 'servicos', 'ocupacao',
                    'pessoal', 'marketing', 'outros')),
  contact_name text,
  phone text,
  email text,
  -- Como se paga este fornecedor no dia a dia (texto livre: chave PIX, banco).
  payment_notes text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create index if not exists suppliers_clinic_idx
  on public.suppliers (clinic_id, active, name);

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- -----------------------------------------------------------------------------
-- 2) Quem mexe em contas a pagar
-- -----------------------------------------------------------------------------
-- Recepção NÃO entra aqui: pagar fornecedor não é ato de balcão.
create or replace function public.can_manage_payables(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or public.has_role_in_clinic(
           p_clinic_id, array['unit_manager']::public.user_role[]);
$$;

grant execute on function public.can_manage_payables(uuid) to authenticated;

drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers
  for all to authenticated
  using (public.can_manage_payables(clinic_id))
  with check (public.can_manage_payables(clinic_id));

-- -----------------------------------------------------------------------------
-- 3) REGRAS DE ALÇADA (cascata rede → unidade, geral → conta)
-- -----------------------------------------------------------------------------
create table if not exists public.payable_approval_rules (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = padrão da rede.
  clinic_id uuid references public.clinics (id),
  -- Nulo = vale para TODAS as contas (o padrão geral).
  account_code text references public.chart_of_accounts (code),
  approval_mode text not null default 'sem_autorizacao'
    check (approval_mode in ('automatica', 'sem_autorizacao', 'com_autorizacao')),
  -- Acima deste valor exige liberação mesmo em 'sem_autorizacao'.
  -- Nulo = sem teto. Ignorado quando o modo é 'automatica'.
  threshold_cents bigint check (threshold_cents is null or threshold_cents > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint payable_approval_rules_unique
    unique nulls not distinct (clinic_id, account_code)
);

comment on table public.payable_approval_rules is
  'Alçada das contas a pagar. Resolução: unidade+conta → rede+conta → '
  'unidade+geral → rede+geral → sem autorização e sem teto. A CONTA pesa mais '
  'que o escopo: regra da rede sobre uma conta não é derrubada pelo teto geral '
  'da unidade.';

alter table public.payable_approval_rules enable row level security;

drop policy if exists "payable_approval_rules_select" on public.payable_approval_rules;
create policy "payable_approval_rules_select" on public.payable_approval_rules
  for select to authenticated using (true);

-- A rede só a Franqueadora define; a unidade sobrescreve a SUA linha.
drop policy if exists "payable_approval_rules_write" on public.payable_approval_rules;
create policy "payable_approval_rules_write" on public.payable_approval_rules
  for all to authenticated
  using (
    case when clinic_id is null
      then public.is_admin_master() or public.is_finance_franchisor()
      else public.can_manage_payables(clinic_id) end
  )
  with check (
    case when clinic_id is null
      then public.is_admin_master() or public.is_finance_franchisor()
      else public.can_manage_payables(clinic_id) end
  );

-- Padrão da rede: nada exige autorização, teto de R$ 2.000,00.
insert into public.payable_approval_rules
  (clinic_id, account_code, approval_mode, threshold_cents)
values (null, null, 'sem_autorizacao', 200000)
on conflict do nothing;

create or replace function public.payable_approval_for(
  p_clinic_id uuid,
  p_account_code text
)
returns table (approval_mode text, threshold_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.approval_mode, r.threshold_cents
  from public.payable_approval_rules r
  where (r.clinic_id = p_clinic_id or r.clinic_id is null)
    and (r.account_code = p_account_code or r.account_code is null)
  order by
    -- Mais específico primeiro: unidade+conta, rede+conta, unidade, rede.
    -- A CONTA pesa mais que o escopo: se a rede exige autorização para
    -- equipamentos, a unidade não derruba isso só por ter um teto geral
    -- próprio — senão bastaria criar uma regra geral para escapar da regra
    -- da rede sobre uma conta sensível.
    (r.account_code is not null) desc,
    (r.clinic_id is not null) desc
  limit 1;
$$;

grant execute on function public.payable_approval_for(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) DESPESAS RECORRENTES (aluguel, software, contabilidade)
-- -----------------------------------------------------------------------------
create table if not exists public.payable_recurrences (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  supplier_id uuid references public.suppliers (id),
  account_code text not null references public.chart_of_accounts (code),
  cost_center_id uuid references public.cost_centers (id),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  due_day integer not null check (due_day between 1 and 31),
  start_month date not null,
  end_month date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists payable_recurrences_clinic_idx
  on public.payable_recurrences (clinic_id, active);

alter table public.payable_recurrences enable row level security;

drop policy if exists "payable_recurrences_select" on public.payable_recurrences;
create policy "payable_recurrences_select" on public.payable_recurrences
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "payable_recurrences_write" on public.payable_recurrences;
create policy "payable_recurrences_write" on public.payable_recurrences
  for all to authenticated
  using (public.can_manage_payables(clinic_id))
  with check (public.can_manage_payables(clinic_id));

-- -----------------------------------------------------------------------------
-- 5) A CONTA A PAGAR
-- -----------------------------------------------------------------------------
create table if not exists public.payables (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  supplier_id uuid references public.suppliers (id),
  -- Classificação obrigatória: sem isto a DRE não fecha sozinha.
  account_code text not null references public.chart_of_accounts (code),
  cost_center_id uuid references public.cost_centers (id),
  description text not null,
  document_number text,
  reference text,
  -- Competência (DRE) × vencimento (DFC).
  accrual_date date not null default current_date,
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  -- Espelho do que já foi pago (a soma dos pagamentos ativos).
  paid_amount_cents bigint not null default 0,
  paid_fee_cents bigint not null default 0,
  paid_interest_cents bigint not null default 0,
  status text not null default 'aberta'
    check (status in ('aguardando_autorizacao', 'aberta', 'parcial', 'paga',
                      'cancelada', 'recusada')),
  -- Alçada CONGELADA no lançamento: mudar a regra depois não reabre o passado.
  approval_mode text not null default 'sem_autorizacao',
  requires_approval boolean not null default false,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  approval_note text,
  cancel_reason text,
  recurrence_id uuid references public.payable_recurrences (id),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payables_clinic_due_idx
  on public.payables (clinic_id, status, due_date);
create index if not exists payables_supplier_idx
  on public.payables (supplier_id, due_date);
create index if not exists payables_account_idx
  on public.payables (account_code, accrual_date);
-- Uma recorrência gera UMA conta por competência.
create unique index if not exists payables_recurrence_unique
  on public.payables (recurrence_id, accrual_date)
  where recurrence_id is not null;

alter table public.payables enable row level security;

drop policy if exists "payables_select" on public.payables;
create policy "payables_select" on public.payables
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- Escrita só pelas funções (que resolvem alçada e validam saldo).
drop policy if exists "payables_write" on public.payables;

-- -----------------------------------------------------------------------------
-- 6) PAGAMENTOS (a baixa do outro lado)
-- -----------------------------------------------------------------------------
create table if not exists public.payable_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  payable_id uuid not null references public.payables (id) on delete cascade,
  -- Principal quitado. Multa e juros vão separados (conta 4.2.01).
  amount_cents bigint not null check (amount_cents > 0),
  fee_cents bigint not null default 0,
  interest_cents bigint not null default 0,
  paid_at date not null default current_date,
  payment_method text
    check (payment_method is null or payment_method in
      ('pix','boleto','cartao','transferencia','dinheiro','debito_automatico')),
  reference text,
  notes text,
  -- Estorno: o pagamento errado NÃO é apagado.
  reversal_of uuid references public.payable_payments (id),
  reversal_reason text,
  reversed boolean not null default false,
  client_token uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create unique index if not exists payable_payments_token_unique
  on public.payable_payments (client_token) where client_token is not null;
create index if not exists payable_payments_payable_idx
  on public.payable_payments (payable_id, created_at);
create index if not exists payable_payments_clinic_idx
  on public.payable_payments (clinic_id, paid_at);

alter table public.payable_payments enable row level security;

drop policy if exists "payable_payments_select" on public.payable_payments;
create policy "payable_payments_select" on public.payable_payments
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "payable_payments_write" on public.payable_payments;

-- -----------------------------------------------------------------------------
-- 7) O razão aceita as origens novas
-- -----------------------------------------------------------------------------
drop index if exists public.financial_entries_source_unique;
create unique index if not exists financial_entries_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('installment_accrual', 'receipt_cash',
                        'receipt_benefit', 'receipt_late_fee',
                        'renegotiation_charges', 'renegotiation_benefit',
                        'renegotiation_discount', 'renegotiation_surcharge',
                        'payable_accrual', 'payable_cash', 'payable_late_fee');

-- Competência da despesa: nasce quando a conta é APROVADA (ou já nasce aberta).
create or replace function public.post_payable_accrual(p_payable_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
begin
  select * into v_p from public.payables where id = p_payable_id;
  if v_p.id is null then return; end if;
  -- Conta esperando autorização ainda não é despesa reconhecida.
  if v_p.status in ('aguardando_autorizacao', 'cancelada', 'recusada') then
    return;
  end if;

  insert into public.financial_entries (
    clinic_id, account_code, cost_center_id, accrual_date, cash_date,
    expected_settlement_date, amount_cents, direction, status,
    source_type, source_id, description, created_by
  ) values (
    v_p.clinic_id, v_p.account_code, v_p.cost_center_id, v_p.accrual_date,
    null, v_p.due_date, v_p.amount_cents, 'outflow', 'open',
    'payable_accrual', v_p.id, v_p.description, v_p.created_by
  )
  on conflict (source_type, source_id) where source_type in
    ('installment_accrual', 'receipt_cash', 'receipt_benefit',
     'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
     'renegotiation_discount', 'renegotiation_surcharge',
     'payable_accrual', 'payable_cash', 'payable_late_fee') do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) LANÇAR a conta a pagar (resolve a alçada)
-- -----------------------------------------------------------------------------
create or replace function public.save_payable(
  p_clinic_id uuid,
  p_supplier_id uuid,
  p_account_code text,
  p_cost_center_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_due_date date,
  p_accrual_date date default current_date,
  p_document_number text default null,
  p_notes text default null,
  p_recurrence_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_needs boolean := false;
  v_status text;
  v_id uuid;
  v_user uuid := (select auth.uid());
  v_analytic boolean;
begin
  if not public.can_manage_payables(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;
  if p_due_date is null then raise exception 'DUE_DATE_REQUIRED'; end if;

  select is_analytic into v_analytic
  from public.chart_of_accounts where code = p_account_code;
  if v_analytic is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if not v_analytic then raise exception 'ACCOUNT_NOT_ANALYTIC'; end if;

  select * into v_rule
  from public.payable_approval_for(p_clinic_id, p_account_code);

  -- 'automatica' = despesa contratada: nem autorização, nem teto.
  if v_rule.approval_mode = 'com_autorizacao' then
    v_needs := true;
  elsif v_rule.approval_mode = 'sem_autorizacao'
        and v_rule.threshold_cents is not null
        and p_amount_cents > v_rule.threshold_cents then
    v_needs := true;
  end if;

  v_status := case when v_needs then 'aguardando_autorizacao' else 'aberta' end;

  insert into public.payables (
    clinic_id, supplier_id, account_code, cost_center_id, description,
    document_number, accrual_date, due_date, amount_cents, status,
    approval_mode, requires_approval, notes, recurrence_id, created_by
  ) values (
    p_clinic_id, p_supplier_id, p_account_code, p_cost_center_id,
    btrim(p_description), nullif(btrim(p_document_number), ''),
    coalesce(p_accrual_date, current_date), p_due_date, p_amount_cents,
    v_status, coalesce(v_rule.approval_mode, 'sem_autorizacao'), v_needs,
    nullif(btrim(p_notes), ''), p_recurrence_id, v_user
  )
  returning id into v_id;

  if not v_needs then perform public.post_payable_accrual(v_id); end if;

  if v_needs then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, p_clinic_id,
      'Conta a pagar — autorizar?',
      btrim(p_description) || ' — R$ ' ||
      to_char(p_amount_cents / 100.0, 'FM999G999D00') ||
      ', vence em ' || to_char(p_due_date, 'DD/MM/YYYY'),
      '/financeiro/contas-a-pagar'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = p_clinic_id
      and ucr.role in ('unit_manager', 'finance_franchisor')
      and ucr.user_id is distinct from v_user;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_payable(
  uuid, uuid, text, uuid, text, bigint, date, date, text, text, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 9) AUTORIZAR (ou recusar) — quem lançou não autoriza a si mesmo
-- -----------------------------------------------------------------------------
create or replace function public.approve_payable(
  p_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_user uuid := (select auth.uid());
begin
  select * into v_p from public.payables where id = p_id;
  if v_p.id is null then raise exception 'PAYABLE_NOT_FOUND'; end if;
  if v_p.status <> 'aguardando_autorizacao' then raise exception 'NOT_PENDING'; end if;
  if not public.can_manage_payables(v_p.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  -- Segregação de função: alçada não é autoaprovação.
  if v_p.created_by = v_user
     and not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'SELF_APPROVAL';
  end if;

  update public.payables set
    status = case when p_approve then 'aberta' else 'recusada' end,
    approved_by = v_user,
    approved_at = now(),
    approval_note = nullif(btrim(p_note), ''),
    updated_at = now()
  where id = p_id;

  if p_approve then perform public.post_payable_accrual(p_id); end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select v_p.created_by, v_p.clinic_id,
    case when p_approve then 'Conta a pagar autorizada'
         else 'Conta a pagar recusada' end,
    v_p.description || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
    '/financeiro/contas-a-pagar'
  where v_p.created_by is not null and v_p.created_by is distinct from v_user;
end;
$$;

grant execute on function public.approve_payable(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10) Situação da conta DERIVADA dos pagamentos
-- -----------------------------------------------------------------------------
create or replace function public.refresh_payable_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.payable_id, old.payable_id);
  v_paid bigint; v_fee bigint; v_int bigint;
  v_amount bigint; v_status text;
begin
  select coalesce(sum(p.amount_cents), 0), coalesce(sum(p.fee_cents), 0),
         coalesce(sum(p.interest_cents), 0)
    into v_paid, v_fee, v_int
  from public.payable_payments p
  where p.payable_id = v_id and not p.reversed and p.reversal_of is null;

  select amount_cents, status into v_amount, v_status
  from public.payables where id = v_id;

  update public.payables set
    paid_amount_cents = v_paid,
    paid_fee_cents = v_fee,
    paid_interest_cents = v_int,
    status = case
      when v_status in ('cancelada', 'recusada', 'aguardando_autorizacao')
        then v_status
      when v_paid >= v_amount then 'paga'
      when v_paid > 0 then 'parcial'
      else 'aberta'
    end,
    updated_at = now()
  where id = v_id;

  return null;
end;
$$;

drop trigger if exists payable_payments_refresh on public.payable_payments;
create trigger payable_payments_refresh
  after insert or update or delete on public.payable_payments
  for each row execute function public.refresh_payable_payment();

-- -----------------------------------------------------------------------------
-- 11) PAGAR (total ou parcial)
-- -----------------------------------------------------------------------------
create or replace function public.register_payable_payment(
  p_payable_id uuid,
  p_amount_cents bigint,
  p_paid_at date default current_date,
  p_payment_method text default null,
  p_fee_cents bigint default 0,
  p_interest_cents bigint default 0,
  p_reference text default null,
  p_notes text default null,
  p_client_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_paid bigint;
  v_saldo bigint;
  v_id uuid;
  v_fee bigint := greatest(0, coalesce(p_fee_cents, 0));
  v_int bigint := greatest(0, coalesce(p_interest_cents, 0));
  v_user uuid := (select auth.uid());
begin
  select * into v_p from public.payables where id = p_payable_id;
  if v_p.id is null then raise exception 'PAYABLE_NOT_FOUND'; end if;
  if not public.can_manage_payables(v_p.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_p.status = 'aguardando_autorizacao' then raise exception 'NOT_APPROVED'; end if;
  if v_p.status in ('cancelada', 'recusada') then raise exception 'PAYABLE_CLOSED'; end if;

  if p_client_token is not null then
    select id into v_id from public.payable_payments
    where client_token = p_client_token;
    if v_id is not null then return v_id; end if;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
  from public.payable_payments
  where payable_id = p_payable_id and not reversed and reversal_of is null;
  v_saldo := v_p.amount_cents - v_paid;
  if p_amount_cents > v_saldo then raise exception 'AMOUNT_OVER_BALANCE'; end if;

  insert into public.payable_payments (
    clinic_id, payable_id, amount_cents, fee_cents, interest_cents, paid_at,
    payment_method, reference, notes, client_token, created_by
  ) values (
    v_p.clinic_id, p_payable_id, p_amount_cents, v_fee, v_int,
    coalesce(p_paid_at, current_date), nullif(p_payment_method, ''),
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''),
    p_client_token, v_user
  )
  returning id into v_id;

  -- Caixa (DFC): saída na conta da despesa.
  insert into public.financial_entries (
    clinic_id, account_code, cost_center_id, accrual_date, cash_date,
    amount_cents, direction, status, source_type, source_id, description,
    created_by
  ) values (
    v_p.clinic_id, v_p.account_code, v_p.cost_center_id, v_p.accrual_date,
    coalesce(p_paid_at, current_date), p_amount_cents, 'outflow', 'settled',
    'payable_cash', v_id, 'Pagamento — ' || v_p.description, v_user
  )
  on conflict (source_type, source_id) where source_type in
    ('installment_accrual', 'receipt_cash', 'receipt_benefit',
     'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
     'renegotiation_discount', 'renegotiation_surcharge',
     'payable_accrual', 'payable_cash', 'payable_late_fee') do nothing;

  -- Multa e juros que NÓS pagamos: despesa financeira, não custo do serviço.
  if (v_fee + v_int) > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, cost_center_id, accrual_date, cash_date,
      amount_cents, direction, status, source_type, source_id, description,
      created_by
    ) values (
      v_p.clinic_id, '4.2.01', v_p.cost_center_id,
      coalesce(p_paid_at, current_date), coalesce(p_paid_at, current_date),
      v_fee + v_int, 'outflow', 'settled', 'payable_late_fee', v_id,
      'Multa e juros pagos — ' || v_p.description, v_user
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee') do nothing;
  end if;

  return v_id;
end;
$$;

grant execute on function public.register_payable_payment(
  uuid, bigint, date, text, bigint, bigint, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 12) ESTORNAR pagamento — contra-lançamento, nunca exclusão
-- -----------------------------------------------------------------------------
create or replace function public.reverse_payable_payment(
  p_payment_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay record;
  v_new_id uuid;
  v_user uuid := (select auth.uid());
begin
  select * into v_pay from public.payable_payments where id = p_payment_id;
  if v_pay.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_pay.reversed then raise exception 'ALREADY_REVERSED'; end if;
  if v_pay.reversal_of is not null then raise exception 'CANNOT_REVERSE_REVERSAL'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if not public.can_manage_payables(v_pay.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.payable_payments set reversed = true where id = p_payment_id;

  insert into public.payable_payments (
    clinic_id, payable_id, amount_cents, fee_cents, interest_cents, paid_at,
    payment_method, reference, reversal_of, reversal_reason, reversed, created_by
  ) values (
    v_pay.clinic_id, v_pay.payable_id, v_pay.amount_cents, v_pay.fee_cents,
    v_pay.interest_cents, current_date, v_pay.payment_method, v_pay.reference,
    p_payment_id, btrim(p_reason), true, v_user
  )
  returning id into v_new_id;

  insert into public.financial_entries (
    clinic_id, account_code, cost_center_id, accrual_date, cash_date,
    amount_cents, direction, status, source_type, source_id, description,
    reversal_of, reversal_reason, created_by
  )
  select e.clinic_id, e.account_code, e.cost_center_id, e.accrual_date,
         current_date, e.amount_cents, 'inflow', 'settled', e.source_type,
         v_new_id, 'Estorno — ' || coalesce(e.description, 'pagamento'),
         e.id, btrim(p_reason), v_user
  from public.financial_entries e
  where e.source_id = p_payment_id
    and e.source_type in ('payable_cash', 'payable_late_fee')
    and e.reversal_of is null;

  update public.financial_entries set status = 'reversed'
   where source_id = p_payment_id
     and source_type in ('payable_cash', 'payable_late_fee')
     and reversal_of is null;

  return v_new_id;
end;
$$;

grant execute on function public.reverse_payable_payment(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 13) CANCELAR a conta (com motivo) — nada se apaga
-- -----------------------------------------------------------------------------
create or replace function public.cancel_payable(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_user uuid := (select auth.uid());
begin
  select * into v_p from public.payables where id = p_id;
  if v_p.id is null then raise exception 'PAYABLE_NOT_FOUND'; end if;
  if not public.can_manage_payables(v_p.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if coalesce(v_p.paid_amount_cents, 0) > 0 then
    raise exception 'ALREADY_PAID';
  end if;

  update public.payables set
    status = 'cancelada', cancel_reason = btrim(p_reason), updated_at = now()
  where id = p_id;

  -- O lançamento de competência é cancelado junto (a despesa não existiu).
  update public.financial_entries set status = 'cancelled'
   where source_type = 'payable_accrual' and source_id = p_id;
end;
$$;

grant execute on function public.cancel_payable(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 14) GERAR as contas do mês a partir das recorrências
-- -----------------------------------------------------------------------------
create or replace function public.generate_recurring_payables(
  p_clinic_id uuid,
  p_month date default date_trunc('month', current_date)::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_due date;
  v_last_day integer;
  v_count integer := 0;
begin
  if not public.can_manage_payables(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::integer;

  for r in
    select * from public.payable_recurrences
    where clinic_id = p_clinic_id and active
      and start_month <= v_month
      and (end_month is null or end_month >= v_month)
  loop
    -- Dia 31 em mês curto cai no último dia (mesma regra do parcelamento).
    v_due := v_month + (least(r.due_day, v_last_day) - 1);
    if exists (select 1 from public.payables
               where recurrence_id = r.id and accrual_date = v_month) then
      continue;
    end if;
    perform public.save_payable(
      r.clinic_id, r.supplier_id, r.account_code, r.cost_center_id,
      r.description, r.amount_cents, v_due, v_month, null, null, r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.generate_recurring_payables(uuid, date)
  to authenticated;

select
  (select count(*) from public.suppliers) as fornecedores,
  (select count(*) from public.payables) as contas_a_pagar,
  (select count(*) from public.payable_approval_rules) as regras_de_alcada;
