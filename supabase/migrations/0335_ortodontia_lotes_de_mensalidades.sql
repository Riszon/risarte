-- =============================================================================
-- 0335 — ORTODONTIA (ORTO9): MENSALIDADES POR LOTE
--
-- Pedido do dono em 28/10/2026 (docs/ortodontia/ORTO-PLANO.md §5, regras R1
-- (baixa), R7, R8, R9 e decisões Q2, Q5, Q6):
--   * R7/R8: o acordo define N mensalidades (o LOTE). Ao iniciar o tratamento
--     o sistema emite as N cobranças de uma vez (competência mês a mês — a DRE
--     continua certa). A 60, 30 e 15 dias do vencimento da última, e depois
--     de vencida, uma ROTINA DIÁRIA avisa o Gerente e o Financeiro: renovar
--     (lote novo) ou encerrar ("não será necessário"). Um aviso por marco.
--   * R1/Q6: desconto por pontualidade aplicado NA BAIXA, quando a data do
--     pagamento é até o vencimento; o razão passa a valer o líquido.
--   * Q2: reajuste anual por percentual da rede (ajustável por unidade),
--     SUGERIDO na renovação depois de 12 meses do início.
--   * R9/Q5: situação nova SUSPENSO — lote encerrado sem renovação e sem
--     alta: o sistema avisa; o Gerente suspende (as previstas param, as
--     mensalidades seguintes saem) e, se for o caso, interrompe. Nunca
--     automático. Retomar = voltar a tratamento (e emitir lote novo).
--   * R9: as cláusulas das mensalidades no termo são texto (`orthoClauses`).
--
-- Idempotente. `ortho_effective_settings`/`ortho_save_settings` (reajuste) e
-- `ortho_mark_charge_paid` (data do pagamento) mudam de assinatura (drop +
-- create); as demais ficam (create or replace).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Q2 — O REAJUSTE ANUAL NA CONFIGURAÇÃO (rede → unidade)
-- -----------------------------------------------------------------------------
alter table public.ortho_settings
  add column if not exists annual_adjustment_percent numeric(5,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_settings_adjustment_check') then
    alter table public.ortho_settings
      add constraint ortho_settings_adjustment_check check (annual_adjustment_percent between 0 and 100);
  end if;
end $$;

drop function if exists public.ortho_effective_settings(uuid);
create function public.ortho_effective_settings(p_clinic_id uuid)
returns table (
  monthly_fee_cents integer,
  planned_months integer,
  maintenance_interval_days integer,
  reevaluation_interval_months integer,
  finish_tolerance_days integer,
  maintenance_procedure_id uuid,
  billing_day integer,
  retainer_charge_enabled boolean,
  retainer_fee_cents integer,
  retainer_terms text,
  punctuality_discount_percent numeric,
  max_punctuality_discount_percent numeric,
  min_monthly_fee_cents integer,
  legacy_entry_enabled boolean,
  annual_adjustment_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(u.monthly_fee_cents, n.monthly_fee_cents, 0),
    coalesce(u.planned_months, n.planned_months, 24),
    coalesce(u.maintenance_interval_days, n.maintenance_interval_days, 30),
    coalesce(u.reevaluation_interval_months, n.reevaluation_interval_months, 6),
    coalesce(u.finish_tolerance_days, n.finish_tolerance_days, 30),
    coalesce(u.maintenance_procedure_id, n.maintenance_procedure_id),
    coalesce(u.billing_day, n.billing_day, 10),
    coalesce(u.retainer_charge_enabled, n.retainer_charge_enabled, false),
    coalesce(u.retainer_fee_cents, n.retainer_fee_cents, 0),
    coalesce(u.retainer_terms, n.retainer_terms),
    coalesce(u.punctuality_discount_percent, n.punctuality_discount_percent, 0),
    coalesce(u.max_punctuality_discount_percent, n.max_punctuality_discount_percent, 10),
    coalesce(u.min_monthly_fee_cents, n.min_monthly_fee_cents, 0),
    coalesce(u.legacy_entry_enabled, n.legacy_entry_enabled, true),
    coalesce(u.annual_adjustment_percent, n.annual_adjustment_percent, 0)
  from (select 1) one
  left join public.ortho_settings u on u.clinic_id = p_clinic_id
  left join public.ortho_settings n on n.clinic_id is null;
$$;
revoke execute on function public.ortho_effective_settings(uuid) from public, anon, authenticated;
grant execute on function public.ortho_effective_settings(uuid) to authenticated;

drop function if exists public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text, numeric, numeric, integer, boolean);
create or replace function public.ortho_save_settings(
  p_clinic_id uuid,
  p_monthly_fee_cents integer,
  p_planned_months integer,
  p_interval_days integer,
  p_reevaluation_months integer,
  p_tolerance_days integer,
  p_maintenance_procedure_id uuid,
  p_billing_day integer,
  p_retainer_charge_enabled boolean default false,
  p_retainer_fee_cents integer default 0,
  p_retainer_terms text default null,
  p_punctuality_discount_percent numeric default 0,
  p_max_punctuality_discount_percent numeric default 10,
  p_min_monthly_fee_cents integer default 0,
  p_legacy_entry_enabled boolean default null,
  p_annual_adjustment_percent numeric default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_clinic_id is null then
    if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  elsif not (public.is_admin_master()
             or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_legacy_entry_enabled is not null and not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.ortho_settings
    (clinic_id, monthly_fee_cents, planned_months, maintenance_interval_days,
     reevaluation_interval_months, finish_tolerance_days, maintenance_procedure_id,
     billing_day, retainer_charge_enabled, retainer_fee_cents, retainer_terms,
     punctuality_discount_percent, max_punctuality_discount_percent, min_monthly_fee_cents,
     legacy_entry_enabled, annual_adjustment_percent, updated_by)
  values
    (p_clinic_id, coalesce(p_monthly_fee_cents, 0), coalesce(p_planned_months, 24),
     coalesce(p_interval_days, 30), coalesce(p_reevaluation_months, 6),
     coalesce(p_tolerance_days, 30), p_maintenance_procedure_id,
     coalesce(p_billing_day, 10),
     coalesce(p_retainer_charge_enabled, false), coalesce(p_retainer_fee_cents, 0),
     nullif(btrim(p_retainer_terms), ''),
     coalesce(p_punctuality_discount_percent, 0), coalesce(p_max_punctuality_discount_percent, 10),
     coalesce(p_min_monthly_fee_cents, 0),
     case when p_clinic_id is null then coalesce(p_legacy_entry_enabled, true) else p_legacy_entry_enabled end,
     coalesce(p_annual_adjustment_percent, 0),
     (select auth.uid()))
  on conflict (clinic_id) do update set
    monthly_fee_cents = excluded.monthly_fee_cents,
    planned_months = excluded.planned_months,
    maintenance_interval_days = excluded.maintenance_interval_days,
    reevaluation_interval_months = excluded.reevaluation_interval_months,
    finish_tolerance_days = excluded.finish_tolerance_days,
    maintenance_procedure_id = excluded.maintenance_procedure_id,
    billing_day = excluded.billing_day,
    retainer_charge_enabled = excluded.retainer_charge_enabled,
    retainer_fee_cents = excluded.retainer_fee_cents,
    retainer_terms = excluded.retainer_terms,
    punctuality_discount_percent = excluded.punctuality_discount_percent,
    max_punctuality_discount_percent = excluded.max_punctuality_discount_percent,
    min_monthly_fee_cents = excluded.min_monthly_fee_cents,
    legacy_entry_enabled = case when p_legacy_entry_enabled is null
                                then public.ortho_settings.legacy_entry_enabled
                                else excluded.legacy_entry_enabled end,
    annual_adjustment_percent = excluded.annual_adjustment_percent,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;
revoke execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text, numeric, numeric, integer, boolean, numeric) from public, anon, authenticated;
grant execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text, numeric, numeric, integer, boolean, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) R9/Q5 — A SITUAÇÃO "SUSPENSO"
-- -----------------------------------------------------------------------------
alter table public.ortho_cases
  add column if not exists suspended_at date,
  add column if not exists suspend_reason text;
alter table public.ortho_cases drop constraint if exists ortho_cases_status_check;
alter table public.ortho_cases
  add constraint ortho_cases_status_check
  check (status in ('aguardando_inicio','em_tratamento','contencao','finalizado','interrompido','suspenso'));
-- Suspenso ainda é "um caso aberto" (o paciente segue em ortodontia, parado).
drop index if exists public.ortho_cases_one_open_per_client;
create unique index ortho_cases_one_open_per_client
  on public.ortho_cases (client_id)
  where status in ('aguardando_inicio','em_tratamento','contencao','suspenso');

create or replace function public.ortho_case_sync_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.clients c set
    ortho_case_id = (
      select o.id from public.ortho_cases o
       where o.client_id = new.client_id
       order by (o.status in ('aguardando_inicio','em_tratamento','contencao','suspenso')) desc,
                o.created_at desc
       limit 1),
    ortho_active = exists (
      select 1 from public.ortho_cases o
       where o.client_id = new.client_id
         and o.status in ('aguardando_inicio','em_tratamento','contencao','suspenso'))
  where c.id = new.client_id;
  return null;
end;
$$;
revoke execute on function public.ortho_case_sync_client() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) R7/R8 — OS LOTES DE MENSALIDADES
-- -----------------------------------------------------------------------------
create table if not exists public.ortho_billing_batches (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ortho_cases (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  seq integer not null,
  installments_count integer not null check (installments_count between 1 and 120),
  first_month date not null,
  last_month date not null,
  amount_cents integer not null check (amount_cents >= 0),
  billing_method text
    check (billing_method is null or billing_method in
      ('pix_recorrente','debito_recorrente','credito_recorrente','cartao_parcelado','boleto','avista_periodo')),
  punctuality_discount_percent numeric(5,2) not null default 0
    check (punctuality_discount_percent between 0 and 100),
  status text not null default 'ativo' check (status in ('ativo','encerrado')),
  -- A decisão de quem gere quando o lote está acabando (R8).
  decision text check (decision is null or decision in ('renovar','nao_renovar')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (case_id, seq)
);
create index if not exists ortho_billing_batches_clinic_idx on public.ortho_billing_batches (clinic_id, status);

alter table public.ortho_billing_batches enable row level security;
drop policy if exists "ortho_billing_batches_select" on public.ortho_billing_batches;
create policy "ortho_billing_batches_select" on public.ortho_billing_batches
  for select to authenticated using (public.ortho_can_see_money(clinic_id));
drop policy if exists "ortho_billing_batches_write" on public.ortho_billing_batches;
create policy "ortho_billing_batches_write" on public.ortho_billing_batches
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

-- A cobrança sabe de que lote veio; a baixa guarda o desconto e o líquido.
alter table public.ortho_charges
  add column if not exists batch_id uuid references public.ortho_billing_batches (id) on delete set null,
  add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0),
  add column if not exists paid_amount_cents integer,
  add column if not exists paid_on date;
create index if not exists ortho_charges_batch_idx on public.ortho_charges (batch_id) where batch_id is not null;

-- Os avisos da rotina: um por lote e marco (a mesma régua das Metas, 0321).
create table if not exists public.ortho_notices (
  batch_id uuid not null references public.ortho_billing_batches (id) on delete cascade,
  kind text not null,
  recipients integer not null default 0,
  sent_at timestamptz not null default now(),
  primary key (batch_id, kind)
);
alter table public.ortho_notices enable row level security;
-- Sem regra de leitura: é registro técnico da rotina.
insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('public', 'ortho_notices', 'Registro técnico da rotina de avisos da ortodontia (um por lote e marco)')
on conflict do nothing;

-- Emite um lote: a linha do lote + as N cobranças (competência mês a mês).
-- Interna. `p_first_month` nulo = depois do último lote; sem lote, o mês do
-- início do tratamento — nunca antes do mês atual (o legado entra no meio).
create or replace function public._ortho_emit_batch(
  p_case_id uuid,
  p_count integer,
  p_amount_cents integer,
  p_billing_method text,
  p_punctuality numeric,
  p_first_month date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
  v_seq integer;
  v_first date;
  v_last date;
  v_id uuid;
  v_count integer := greatest(1, least(120, coalesce(p_count, 12)));
  v_amount integer := greatest(0, coalesce(p_amount_cents, 0));
  v_prev_last date;
  i integer;
  v_month date;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_t from public.ortho_case_terms where case_id = p_case_id;

  select coalesce(max(seq), 0) + 1, max(last_month)
    into v_seq, v_prev_last
    from public.ortho_billing_batches where case_id = p_case_id;

  v_first := coalesce(
    p_first_month,
    case when v_prev_last is not null then (v_prev_last + interval '1 month')::date end,
    greatest(date_trunc('month', coalesce(v_c.start_date, public.today_br()))::date,
             date_trunc('month', public.today_br())::date));
  v_first := date_trunc('month', v_first)::date;
  v_last := (v_first + make_interval(months => v_count - 1))::date;

  insert into public.ortho_billing_batches
    (case_id, clinic_id, seq, installments_count, first_month, last_month, amount_cents,
     billing_method, punctuality_discount_percent, created_by)
  values
    (p_case_id, v_c.clinic_id, v_seq, v_count, v_first, v_last, v_amount,
     p_billing_method, greatest(0, least(100, coalesce(p_punctuality, 0))), (select auth.uid()))
  returning id into v_id;

  -- Lote novo encerra o anterior (ele já cumpriu o que tinha de emitir).
  update public.ortho_billing_batches set status = 'encerrado'
   where case_id = p_case_id and id <> v_id and status = 'ativo';

  if v_amount > 0 then
    for i in 0 .. v_count - 1 loop
      v_month := (v_first + make_interval(months => i))::date;
      insert into public.ortho_charges
        (case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, batch_id, created_by)
      values
        (p_case_id, v_c.clinic_id, v_c.client_id, 'mensalidade', v_month,
         (v_month + (coalesce(v_t.billing_day, 10) - 1)), v_amount, 'em_aberto', v_id, (select auth.uid()))
      on conflict (case_id, reference_month, kind) do update
        set batch_id = coalesce(public.ortho_charges.batch_id, excluded.batch_id);
    end loop;
  end if;

  -- O acordo do caso passa a ser o do lote (a ORTO9 muda o valor na renovação).
  update public.ortho_case_terms set
    monthly_fee_cents = v_amount,
    installments_count = v_count,
    billing_method = coalesce(p_billing_method, billing_method),
    punctuality_discount_percent = greatest(0, least(100, coalesce(p_punctuality, punctuality_discount_percent)))
  where case_id = p_case_id;

  perform public._ortho_log(p_case_id, 'lote_emitido',
    'Lote ' || v_seq || ' de mensalidades emitido: ' || v_count || ' mensalidades, '
    || to_char(v_first, 'MM/YYYY') || ' a ' || to_char(v_last, 'MM/YYYY'));
  return v_id;
end;
$$;
revoke execute on function public._ortho_emit_batch(uuid, integer, integer, text, numeric, date) from public, anon, authenticated;

-- Quem gere ou dá baixa decide o lote (R8): renovar (lote novo, com o valor
-- que a tela mandar — o reajuste é sugestão da tela) ou "não será necessário".
create or replace function public.ortho_decide_batch(
  p_batch_id uuid,
  p_decision text,
  p_count integer default null,
  p_amount_cents integer default null,
  p_billing_method text default null,
  p_punctuality numeric default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.ortho_billing_batches;
  v_c public.ortho_cases;
  v_new uuid;
begin
  select * into v_b from public.ortho_billing_batches where id = p_batch_id;
  if v_b.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.ortho_can_manage(v_b.clinic_id) or public.ortho_can_settle(v_b.clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_decision not in ('renovar','nao_renovar') then raise exception 'INVALID_DECISION'; end if;
  select * into v_c from public.ortho_cases where id = v_b.case_id;
  if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;

  update public.ortho_billing_batches set
    decision = p_decision, decided_by = (select auth.uid()), decided_at = now(),
    decision_note = nullif(btrim(p_note), '')
  where id = p_batch_id;

  if p_decision = 'renovar' then
    v_new := public._ortho_emit_batch(v_b.case_id,
      coalesce(p_count, v_b.installments_count),
      coalesce(p_amount_cents, v_b.amount_cents),
      coalesce(p_billing_method, v_b.billing_method),
      coalesce(p_punctuality, v_b.punctuality_discount_percent),
      (v_b.last_month + interval '1 month')::date);
    return v_new;
  end if;

  perform public._ortho_log(v_b.case_id, 'lote_nao_renovado',
    'Lote ' || v_b.seq || ' não será renovado' || coalesce(' — ' || nullif(btrim(p_note), ''), ''));
  return null;
end;
$$;
revoke execute on function public.ortho_decide_batch(uuid, text, integer, integer, text, numeric, text) from public, anon, authenticated;
grant execute on function public.ortho_decide_batch(uuid, text, integer, integer, text, numeric, text) to authenticated;

-- Emitir um lote à mão (caso em tratamento SEM lote — os de antes desta versão,
-- ou depois de retomar da suspensão).
create or replace function public.ortho_emit_batch(
  p_case_id uuid,
  p_count integer,
  p_amount_cents integer,
  p_billing_method text default null,
  p_punctuality numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.ortho_can_manage(v_c.clinic_id) or public.ortho_can_settle(v_c.clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;
  if exists (select 1 from public.ortho_billing_batches b
              where b.case_id = p_case_id and b.status = 'ativo' and b.decision is null) then
    raise exception 'BATCH_ACTIVE';
  end if;
  return public._ortho_emit_batch(p_case_id, p_count, p_amount_cents, p_billing_method, p_punctuality, null);
end;
$$;
revoke execute on function public.ortho_emit_batch(uuid, integer, integer, text, numeric) from public, anon, authenticated;
grant execute on function public.ortho_emit_batch(uuid, integer, integer, text, numeric) to authenticated;

-- O botão "Gerar mensalidades do mês" fica para os casos SEM lote (os de
-- antes); quem tem lote já tem as cobranças.
create or replace function public.ortho_generate_charges(
  p_month date default null,
  p_clinic_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, public.today_br()))::date;
  v_count integer := 0;
begin
  if not (public.is_admin_master()
          or (p_clinic_id is not null and public.ortho_can_settle(p_clinic_id))) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.ortho_charges
    (case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, created_by)
  select
    c.id, c.clinic_id, c.client_id, 'mensalidade', v_month,
    (v_month + (t.billing_day - 1)),
    t.monthly_fee_cents, 'em_aberto', (select auth.uid())
  from public.ortho_cases c
  join public.ortho_case_terms t on t.case_id = c.id
  where c.status = 'em_tratamento'
    and t.monthly_fee_cents > 0
    and (c.start_date is null or date_trunc('month', c.start_date)::date <= v_month)
    and (p_clinic_id is null or c.clinic_id = p_clinic_id)
    and not exists (select 1 from public.ortho_billing_batches b where b.case_id = c.id)
  on conflict (case_id, reference_month, kind) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.ortho_generate_charges(date, uuid) from public, anon, authenticated;
grant execute on function public.ortho_generate_charges(date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) R1/Q6 — A PONTUALIDADE NA BAIXA
-- -----------------------------------------------------------------------------
-- O razão: na baixa vale o LÍQUIDO (com o desconto de pontualidade); desfeita
-- a baixa, volta o valor cheio.
create or replace function public.ortho_charge_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash date;
  v_desc text;
begin
  v_desc := case when new.kind = 'contencao'
                 then 'Contenção ortodôntica ' || to_char(new.reference_month, 'MM/YYYY')
                 else 'Mensalidade ortodôntica ' || to_char(new.reference_month, 'MM/YYYY') end;
  if tg_op = 'INSERT' then
    if new.status = 'cancelada' then return null; end if;
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, created_by
    ) values (
      new.clinic_id, '1.1.04', new.reference_month,
      case when new.status = 'paga' then coalesce(new.paid_on, (new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br()) end,
      new.due_date, coalesce(case when new.status = 'paga' then new.paid_amount_cents end, new.amount_cents), 'inflow',
      case when new.status = 'paga' then 'settled' else 'open' end,
      'ortho_charge', new.id, v_desc, new.created_by
    )
    on conflict (source_type, source_id) where source_type = 'ortho_charge' do nothing;
    return null;
  end if;

  -- UPDATE
  if new.status = 'paga' and old.status <> 'paga' then
    v_cash := coalesce(new.paid_on, (new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br());
    update public.financial_entries
       set status = 'settled', cash_date = v_cash,
           amount_cents = coalesce(new.paid_amount_cents, new.amount_cents), updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status in ('open','cancelled');
  elsif old.status = 'paga' and new.status <> 'paga' then
    update public.financial_entries
       set status = case when new.status = 'cancelada' then 'cancelled' else 'open' end,
           cash_date = null,
           amount_cents = new.amount_cents,
           reversal_reason = case when new.status = 'cancelada' then 'Cobrança cancelada' else 'Baixa desfeita' end,
           updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'settled';
  elsif new.status = 'cancelada' and old.status <> 'cancelada' then
    update public.financial_entries
       set status = 'cancelled', updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'open';
  elsif old.status = 'cancelada' and new.status <> 'cancelada' then
    update public.financial_entries
       set status = 'open', updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'cancelled';
  end if;

  if new.amount_cents <> old.amount_cents then
    update public.financial_entries
       set amount_cents = new.amount_cents, updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'open';
  end if;
  return null;
end;
$$;
revoke execute on function public.ortho_charge_ledger() from public, anon, authenticated;

-- A baixa com a DATA do pagamento: até o vencimento, o desconto de
-- pontualidade do lote (ou do caso) entra. Assinatura nova (+ p_paid_on).
drop function if exists public.ortho_mark_charge_paid(uuid, boolean, text);
create or replace function public.ortho_mark_charge_paid(
  p_charge_id uuid,
  p_paid boolean default true,
  p_payment_method text default null,
  p_paid_on date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ch public.ortho_charges;
  v_user uuid := (select auth.uid());
  v_on date := coalesce(p_paid_on, public.today_br());
  v_pct numeric := 0;
  v_disc integer := 0;
begin
  select * into v_ch from public.ortho_charges where id = p_charge_id;
  if v_ch.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_settle(v_ch.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_ch.status = 'cancelada' then raise exception 'CHARGE_CANCELLED'; end if;
  if v_on > public.today_br() then raise exception 'PAID_ON_FUTURE'; end if;

  if p_paid and v_ch.kind = 'mensalidade' then
    select coalesce(
      (select b.punctuality_discount_percent from public.ortho_billing_batches b where b.id = v_ch.batch_id),
      (select t.punctuality_discount_percent from public.ortho_case_terms t where t.case_id = v_ch.case_id),
      0) into v_pct;
    if v_on <= v_ch.due_date and v_pct > 0 then
      v_disc := least(v_ch.amount_cents, round(v_ch.amount_cents * v_pct / 100.0)::integer);
    end if;
  end if;

  update public.ortho_charges set
    status = case when p_paid then 'paga'
                  when due_date < public.today_br() then 'atrasada'
                  else 'em_aberto' end,
    paid_at = case when p_paid then now() end,
    paid_on = case when p_paid then v_on end,
    paid_by = case when p_paid then v_user end,
    payment_method = case when p_paid then nullif(p_payment_method, '') end,
    discount_cents = case when p_paid then v_disc else 0 end,
    paid_amount_cents = case when p_paid then amount_cents - v_disc end,
    updated_at = now()
  where id = p_charge_id;

  perform public._ortho_log(v_ch.case_id, case when p_paid then 'mensalidade_paga' else 'baixa_desfeita' end,
    case when v_ch.kind = 'contencao' then 'Contenção' else 'Mensalidade ' || to_char(v_ch.reference_month, 'MM/YYYY') end ||
    case when p_paid then ' paga em ' || to_char(v_on, 'DD/MM/YYYY')
                          || case when v_disc > 0 then ' (desconto de pontualidade de ' || v_pct || '%)' else '' end
         else ' — baixa desfeita' end);
end;
$$;
revoke execute on function public.ortho_mark_charge_paid(uuid, boolean, text, date) from public, anon, authenticated;
grant execute on function public.ortho_mark_charge_paid(uuid, boolean, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) INICIAR / SUSPENDER / RETOMAR: o lote nasce no início; suspenso para tudo
-- -----------------------------------------------------------------------------
create or replace function public.ortho_set_status(
  p_case_id uuid,
  p_status text,
  p_reason text default null,
  p_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
  v_date date := coalesce(p_date, public.today_br());
  v_reeval integer;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_status not in ('em_tratamento','contencao','finalizado','interrompido','suspenso') then
    raise exception 'INVALID_STATUS';
  end if;
  if p_status = v_c.status then return; end if;

  if p_status = 'em_tratamento' then
    if v_c.status not in ('aguardando_inicio','contencao','finalizado','interrompido','suspenso') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if v_c.status in ('finalizado','interrompido')
       and exists (select 1 from public.ortho_cases
                    where client_id = v_c.client_id and id <> p_case_id
                      and status in ('aguardando_inicio','em_tratamento','contencao','suspenso')) then
      raise exception 'CASE_ALREADY_OPEN';
    end if;
    select s.reevaluation_interval_months into v_reeval
      from public.ortho_effective_settings(v_c.clinic_id) s;
    update public.ortho_cases set
      status = 'em_tratamento',
      start_date = coalesce(start_date, v_date),
      next_reevaluation_date = coalesce(next_reevaluation_date,
        (coalesce(start_date, v_date) + make_interval(months => coalesce(v_reeval, 6)))::date),
      finished_at = null, finish_reason = null,
      retainer_delivered_at = null, discharged_at = null,
      interrupted_at = null, interrupt_reason = null,
      suspended_at = null, suspend_reason = null
    where id = p_case_id;
    perform public.ortho_plan_maintenances(p_case_id);
    perform public._ortho_log(p_case_id, 'tratamento_iniciado',
      case when v_c.status = 'aguardando_inicio' then 'Tratamento iniciado em '
           when v_c.status = 'suspenso' then 'Tratamento retomado em '
           else 'Caso reaberto em ' end || to_char(v_date, 'DD/MM/YYYY')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
    -- R7: no INÍCIO, o lote do acordo nasce (as N mensalidades). Retomar ou
    -- reabrir não emite sozinho: quem gere emite o lote novo na ficha.
    if v_c.status = 'aguardando_inicio'
       and not exists (select 1 from public.ortho_billing_batches b where b.case_id = p_case_id) then
      select * into v_t from public.ortho_case_terms where case_id = p_case_id;
      if coalesce(v_t.monthly_fee_cents, 0) > 0 then
        perform public._ortho_emit_batch(p_case_id, coalesce(v_t.installments_count, 12),
          v_t.monthly_fee_cents, v_t.billing_method, v_t.punctuality_discount_percent,
          date_trunc('month', coalesce(v_c.start_date, v_date))::date);
      end if;
    end if;

  elsif p_status = 'contencao' then
    perform public.ortho_deliver_retainers(p_case_id, v_date, null, null, p_reason);

  elsif p_status = 'finalizado' then
    if v_c.status not in ('em_tratamento','contencao','suspenso') then raise exception 'INVALID_TRANSITION'; end if;
    update public.ortho_cases set
      status = 'finalizado',
      finished_at = coalesce(finished_at, v_date),
      discharged_at = v_date,
      finish_reason = coalesce(nullif(btrim(p_reason), ''), finish_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    perform public._ortho_log(p_case_id, 'finalizado',
      case when v_c.status = 'contencao' then 'Alta do acompanhamento em '
           else 'Tratamento encerrado em ' end || to_char(v_date, 'DD/MM/YYYY')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));

  elsif p_status = 'suspenso' then
    -- Q5: nunca automático — quem gere suspende, com motivo.
    if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.ortho_cases set
      status = 'suspenso', suspended_at = v_date, suspend_reason = btrim(p_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    update public.ortho_billing_batches set status = 'encerrado'
     where case_id = p_case_id and status = 'ativo';
    perform public._ortho_log(p_case_id, 'suspenso',
      'Tratamento suspenso em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));

  elsif p_status = 'interrompido' then
    if v_c.status not in ('aguardando_inicio','em_tratamento','contencao','suspenso') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.ortho_cases set
      status = 'interrompido', interrupted_at = v_date, interrupt_reason = btrim(p_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    update public.ortho_billing_batches set status = 'encerrado'
     where case_id = p_case_id and status = 'ativo';
    perform public._ortho_log(p_case_id, 'interrompido',
      'Tratamento interrompido em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));
  end if;
end;
$$;
revoke execute on function public.ortho_set_status(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.ortho_set_status(uuid, text, text, date) to authenticated;

-- As aberturas que já começam "em tratamento" também emitem o lote.
create or replace function public._ortho_emit_initial_batch(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null or v_c.status <> 'em_tratamento' then return; end if;
  if exists (select 1 from public.ortho_billing_batches b where b.case_id = p_case_id) then return; end if;
  select * into v_t from public.ortho_case_terms where case_id = p_case_id;
  if coalesce(v_t.monthly_fee_cents, 0) <= 0 then return; end if;
  perform public._ortho_emit_batch(p_case_id, coalesce(v_t.installments_count, 12),
    v_t.monthly_fee_cents, v_t.billing_method, v_t.punctuality_discount_percent, null);
end;
$$;
revoke execute on function public._ortho_emit_initial_batch(uuid) from public, anon, authenticated;

-- `ortho_create_case` e `ortho_create_legacy_case` (0334) com `p_start_now`
-- abrem o caso já em tratamento e gravam a irmã logo depois: o lote entra
-- pelo gatilho de inserção da irmã — sem reescrever as duas funções.
create or replace function public.ortho_terms_after_write_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só a PRIMEIRA gravação das condições de um caso já em tratamento (abertura
  -- com "o aparelho já foi instalado"); as edições depois não emitem nada.
  if tg_op = 'INSERT' then
    perform public._ortho_emit_initial_batch(new.case_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.ortho_terms_after_write_batch() from public, anon, authenticated;
drop trigger if exists ortho_case_terms_batch on public.ortho_case_terms;
create trigger ortho_case_terms_batch
  after insert on public.ortho_case_terms
  for each row execute function public.ortho_terms_after_write_batch();

-- Os já-abertos de antes desta versão com venda ou legado: suspenso entra na
-- lista de "caso aberto" das aberturas.
create or replace function public._ortho_open_from_sale(p_negotiation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_p record;
  v_o record;
  v_s record;
  v_existing uuid;
  v_id uuid;
  v_client_name text;
  v_code text;
  v_user uuid := (select auth.uid());
begin
  select n.id, n.plan_id, n.option_id, n.client_id, n.clinic_id, n.code
    into v_neg from public.plan_negotiations n where n.id = p_negotiation_id;
  if v_neg.id is null then return null; end if;

  select * into v_p from public.treatment_plan_ortho where option_id = v_neg.option_id;
  if v_p.option_id is null and not exists (
    select 1 from public.treatment_plan_option_items i
    join public.procedures p on p.id = i.procedure_id
    where i.option_id = v_neg.option_id and p.specialty ilike '%ortod%'
  ) then
    return null;
  end if;

  select id into v_existing from public.ortho_cases
   where client_id = v_neg.client_id
     and status in ('aguardando_inicio','em_tratamento','contencao','suspenso')
   limit 1;
  if v_existing is not null then
    update public.ortho_cases set negotiation_id = coalesce(negotiation_id, p_negotiation_id),
                                  plan_id = coalesce(plan_id, v_neg.plan_id)
     where id = v_existing;
    perform public._ortho_log(v_existing, 'venda_fechada',
      'Venda fechada no Comercial' || coalesce(' (' || v_neg.code || ')', '') || ' — o caso já estava aberto');
    return v_existing;
  end if;

  select * into v_s from public.ortho_effective_settings(v_neg.clinic_id);
  select * into v_o from public.plan_negotiation_ortho where negotiation_id = p_negotiation_id;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     maintenance_procedure_id, plan_id, negotiation_id, notes, origin, created_by)
  values
    (v_neg.clinic_id, v_neg.client_id, null,
     coalesce(v_p.treatment_kind, 'aparelho_fixo'), 'aguardando_inicio', null,
     coalesce(v_p.planned_months, v_s.planned_months, 24),
     coalesce(v_p.maintenance_interval_days, v_s.maintenance_interval_days, 30),
     null, v_s.maintenance_procedure_id, v_neg.plan_id, p_negotiation_id,
     nullif(btrim(v_p.notes), ''), 'venda', v_user)
  returning id, code into v_id, v_code;

  insert into public.ortho_case_terms
    (case_id, clinic_id, monthly_fee_cents, billing_day, installation_fee_cents,
     retainer_charged, retainer_fee_cents, retainer_terms,
     installments_count, billing_method, punctuality_discount_percent, updated_by)
  values
    (v_id, v_neg.clinic_id,
     coalesce(v_o.monthly_fee_cents, v_s.monthly_fee_cents, 0),
     coalesce(v_o.billing_day, v_s.billing_day, 10), 0,
     coalesce(v_o.retainer_charged, v_s.retainer_charge_enabled, false),
     coalesce(v_o.retainer_fee_cents, v_s.retainer_fee_cents, 0),
     coalesce(v_o.retainer_terms, v_s.retainer_terms),
     coalesce(v_o.installments_count, 12), v_o.billing_method,
     coalesce(v_o.punctuality_discount_percent, v_s.punctuality_discount_percent, 0),
     v_user)
  on conflict (case_id) do nothing;

  perform public._ortho_log(v_id, 'caso_aberto',
    'Caso aberto no fechamento da venda' || coalesce(' ' || v_neg.code, '')
    || case when v_p.option_id is not null then ' — características da proposta ortodôntica do plano' else '' end
    || case when v_o.negotiation_id is not null then ' — acordo comercial da negociação' else ' — acordo pelo padrão da unidade' end);

  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_neg.clinic_id,
    'Ortodontia: caso fechado — agendar a instalação',
    coalesce(v_client_name, 'Paciente') || ' fechou o tratamento ortodôntico (' || v_code
      || '). Agende a instalação do aparelho (início de tratamento) com um ortodontista; o caso está aguardando início.',
    '/ortodontia/casos/' || v_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_neg.clinic_id
    and ucr.role in ('unit_manager','clinical_coordinator','receptionist')
    and ucr.user_id is distinct from v_user;

  return v_id;
end;
$$;
revoke execute on function public._ortho_open_from_sale(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) R8 — A ROTINA DIÁRIA: 60 / 30 / 15 dias do fim do lote, e vencido
-- -----------------------------------------------------------------------------
-- Chamada manual precisa de permissão; o cron roda sem usuário e passa (o
-- mesmo padrão de `check_finance_alerts`). Um aviso por lote e marco.
create or replace function public.ortho_daily_alerts(p_clinic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date := public.today_br();
  v_b record;
  v_days integer;
  v_kind text;
  v_title text;
  v_body text;
  v_novo boolean;
  v_n integer;
  v_sent integer := 0;
  v_client_name text;
begin
  if v_user is not null then
    if p_clinic_id is null then
      if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
    elsif not public.ortho_can_settle(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;

  for v_b in
    select b.id, b.case_id, b.clinic_id, b.seq, b.installments_count,
           coalesce((select max(ch.due_date) from public.ortho_charges ch
                      where ch.batch_id = b.id and ch.status <> 'cancelada'),
                    (b.last_month + 9)) as last_due,
           c.client_id, c.code
      from public.ortho_billing_batches b
      join public.ortho_cases c on c.id = b.case_id
     where b.status = 'ativo' and b.decision is null
       and c.status = 'em_tratamento'
       and (p_clinic_id is null or b.clinic_id = p_clinic_id)
  loop
    v_days := v_b.last_due - v_today;
    v_kind := case
      when v_days < 0 then 'vencido'
      when v_days <= 15 then 'd15'
      when v_days <= 30 then 'd30'
      when v_days <= 60 then 'd60'
      else null end;
    if v_kind is null then continue; end if;

    insert into public.ortho_notices (batch_id, kind) values (v_b.id, v_kind)
    on conflict (batch_id, kind) do nothing
    returning true into v_novo;
    if not coalesce(v_novo, false) then continue; end if;

    select full_name into v_client_name from public.clients where id = v_b.client_id;
    v_title := case
      when v_kind = 'vencido' then 'Ortodontia: o lote de mensalidades terminou — renovar ou encerrar?'
      when v_kind = 'd15' then 'Ortodontia: lote de mensalidades termina em até 15 dias — decidir agora'
      when v_kind = 'd30' then 'Ortodontia: lote de mensalidades termina em até 30 dias — renovar ou encerrar?'
      else 'Ortodontia: lote de mensalidades termina em até 60 dias — renovar ou encerrar?' end;
    v_body := coalesce(v_client_name, 'Paciente') || ' (' || v_b.code || ') — lote ' || v_b.seq
      || ' de ' || v_b.installments_count || ' mensalidades'
      || case when v_days < 0 then ', a última venceu em ' else ', a última vence em ' end
      || to_char(v_b.last_due, 'DD/MM/YYYY')
      || '. Na ficha do caso: "Emitir novas mensalidades" ou "Não será necessário". Sem decisão, o tratamento fica sem mensalidades e pode ser suspenso.';

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct u, v_b.clinic_id, v_title, v_body, '/ortodontia/casos/' || v_b.case_id
    from (
      select ucr.user_id as u from public.user_clinic_roles_all ucr
        join public.profiles p on p.id = ucr.user_id and p.is_active
       where ucr.clinic_id = v_b.clinic_id and ucr.role = 'unit_manager'
      union
      select ucr.user_id from public.user_clinic_roles_all ucr
        join public.profiles p on p.id = ucr.user_id and p.is_active
        join public.clinics c on c.id = ucr.clinic_id
       where c.type = 'franchisor' and ucr.role = 'finance_franchisor'
    ) x;
    get diagnostics v_n = row_count;
    update public.ortho_notices set recipients = v_n where batch_id = v_b.id and kind = v_kind;
    v_sent := v_sent + v_n;
  end loop;
  return v_sent;
end;
$$;
revoke execute on function public.ortho_daily_alerts(uuid) from public, anon, authenticated;
grant execute on function public.ortho_daily_alerts(uuid) to authenticated;

do $$
begin
  perform cron.schedule(
    'risarte-ortho-daily', '0 11 * * *',
    'select public.ortho_daily_alerts()'
  );
exception when others then null;
end;
$$;

-- Tabelas novas entram na auditoria (0288): os lotes sim; os avisos foram
-- declarados fora (acima).
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('ortho_billing_batches','ortho_notices')) as tabelas_novas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_charges'
      and column_name in ('batch_id','discount_cents','paid_amount_cents','paid_on')) as colunas_da_cobranca,
  (select count(*) from pg_constraint
    where conname = 'ortho_cases_status_check' and pg_get_constraintdef(oid) like '%suspenso%') as situacao_suspenso,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_ortho_emit_batch','ortho_decide_batch','ortho_emit_batch','ortho_daily_alerts')) as funcoes_novas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ortho_mark_charge_paid' and p.pronargs = 4) as baixa_com_data,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_settings' and column_name = 'annual_adjustment_percent') as reajuste_na_config,
  (select count(*) from cron.job where jobname = 'risarte-ortho-daily') as rotina_diaria;
-- Esperado: 2 · 4 · 1 · 4 · 1 · 1 · 1
