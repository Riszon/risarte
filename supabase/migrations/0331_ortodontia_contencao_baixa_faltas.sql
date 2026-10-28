-- =============================================================================
-- 0331 — ORTODONTIA: as decisões O1, O2 e O3 do dono (28/10/2026)
-- -----------------------------------------------------------------------------
-- O1 — A MENSALIDADE É COBRADA ATÉ A ENTREGA DAS CONTENÇÕES. Entregar as
--      contenções FINALIZA o tratamento (`finished_at`) e o caso passa a
--      ACOMPANHAMENTO (a situação `contencao` muda de sentido: deixa de ser
--      "fase ativa sem cobrança" e vira "tratamento finalizado, em
--      acompanhamento"). A contenção pode ser COBRADA: liga/desliga e valor na
--      configuração (rede → unidade), com uma condição especial em texto; o
--      caso nasce com a cópia e pode ajustar. A cobrança da contenção é uma
--      `ortho_charges` de `kind = 'contencao'`, na mesma conta 1.1.04.
-- O2 — QUEM DÁ BAIXA: Gerente da unidade e Financeiro (da Franqueadora), além
--      do Admin e da Franqueadora/Rede. A Recepção e o Franqueado saem da guarda
--      e da matriz; a Recepção continua VENDO a situação (regra de leitura).
-- O3 — CADA FALTA PRORROGA O TÉRMINO PREVISTO em um intervalo de manutenção
--      (`extension_days` = faltas × intervalo, mantido por gatilho). O prazo
--      "atrasado" segue sendo término previsto + tolerância — agora o término
--      já carrega as faltas. A assiduidade é conta de tela (regras.ts).
-- Tudo isto vai escrito no TERMO (regras.ts → orthoClauses).
-- Idempotente. Assinaturas que mudam levam `drop function` antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONTA: passa a receber a contenção também
-- -----------------------------------------------------------------------------
update public.chart_of_accounts
   set name = 'Ortodontia — mensalidades e contenções'
 where code = '1.1.04' and name = 'Ortodontia — mensalidades';

-- -----------------------------------------------------------------------------
-- 2) CONFIGURAÇÃO: a contenção (cobra? quanto? em que condição?)
-- -----------------------------------------------------------------------------
alter table public.ortho_settings
  add column if not exists retainer_charge_enabled boolean not null default false;
alter table public.ortho_settings
  add column if not exists retainer_fee_cents integer not null default 0;
alter table public.ortho_settings
  add column if not exists retainer_terms text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_settings_retainer_fee_check') then
    alter table public.ortho_settings
      add constraint ortho_settings_retainer_fee_check check (retainer_fee_cents >= 0);
  end if;
end $$;

-- O retorno ganha 3 colunas: precisa derrubar antes (regra 1 do check-migrations).
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
  retainer_terms text
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
    coalesce(u.retainer_terms, n.retainer_terms)
  from (select 1) one
  left join public.ortho_settings u on u.clinic_id = p_clinic_id
  left join public.ortho_settings n on n.clinic_id is null;
$$;
revoke execute on function public.ortho_effective_settings(uuid) from public, anon, authenticated;
grant execute on function public.ortho_effective_settings(uuid) to authenticated;

drop function if exists public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer);
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
  p_retainer_terms text default null
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

  insert into public.ortho_settings
    (clinic_id, monthly_fee_cents, planned_months, maintenance_interval_days,
     reevaluation_interval_months, finish_tolerance_days, maintenance_procedure_id,
     billing_day, retainer_charge_enabled, retainer_fee_cents, retainer_terms, updated_by)
  values
    (p_clinic_id, coalesce(p_monthly_fee_cents, 0), coalesce(p_planned_months, 24),
     coalesce(p_interval_days, 30), coalesce(p_reevaluation_months, 6),
     coalesce(p_tolerance_days, 30), p_maintenance_procedure_id,
     coalesce(p_billing_day, 10),
     coalesce(p_retainer_charge_enabled, false), coalesce(p_retainer_fee_cents, 0),
     nullif(btrim(p_retainer_terms), ''), (select auth.uid()))
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
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;
revoke execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) O2 — QUEM DÁ BAIXA: Gerente e Financeiro (a Recepção e o Franqueado saem)
-- -----------------------------------------------------------------------------
-- `is_network_viewer()` só enxerga a Franqueadora/Rede; o Financeiro da
-- Franqueadora entra aqui de propósito (a 0329 o deixava de fora no banco).
create or replace function public.ortho_can_settle(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_network_viewer()
      or exists (
           select 1
           from public.user_clinic_roles ucr
           join public.clinics c on c.id = ucr.clinic_id
           where ucr.user_id = (select auth.uid())
             and c.type = 'franchisor'
             and ucr.role = 'finance_franchisor')
      or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[]);
$$;
revoke execute on function public.ortho_can_settle(uuid) from public, anon, authenticated;
grant execute on function public.ortho_can_settle(uuid) to authenticated;

delete from public.permission_matrix
 where capability = 'acao.ortodontia.financeiro'
   and role in ('receptionist', 'franchisee');

-- -----------------------------------------------------------------------------
-- 4) O CASO: contenção (cópia da configuração), entrega, alta e as faltas
-- -----------------------------------------------------------------------------
alter table public.ortho_cases
  add column if not exists retainer_charged boolean not null default false;
alter table public.ortho_cases
  add column if not exists retainer_fee_cents integer not null default 0;
alter table public.ortho_cases
  add column if not exists retainer_terms text;
alter table public.ortho_cases
  add column if not exists retainer_delivered_at date;
alter table public.ortho_cases
  add column if not exists discharged_at date;
alter table public.ortho_cases
  add column if not exists extension_days integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_cases_retainer_fee_check') then
    alter table public.ortho_cases
      add constraint ortho_cases_retainer_fee_check check (retainer_fee_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ortho_cases_extension_check') then
    alter table public.ortho_cases
      add constraint ortho_cases_extension_check check (extension_days >= 0);
  end if;
end $$;

-- Quem já estava "em contenção" pela regra antiga passa a "finalizado, em
-- acompanhamento": a data de término é a da última alteração (não há outra).
update public.ortho_cases
   set finished_at = (updated_at at time zone 'America/Sao_Paulo')::date,
       retainer_delivered_at = (updated_at at time zone 'America/Sao_Paulo')::date
 where status = 'contencao' and finished_at is null;

-- O término previsto passa a carregar as faltas (O3).
create or replace function public.ortho_case_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.start_date is not null then
    new.planned_end_date :=
      (new.start_date + make_interval(months => new.planned_months))::date
      + coalesce(new.extension_days, 0);
  else
    new.planned_end_date := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.ortho_case_before_write() from public, anon, authenticated;

-- Recalcula a prorrogação: faltas × intervalo. Interna.
create or replace function public._ortho_recompute_extension(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missed integer;
  v_interval integer;
  v_current integer;
begin
  select maintenance_interval_days, extension_days into v_interval, v_current
    from public.ortho_cases where id = p_case_id;
  if v_interval is null then return; end if;
  select count(*) into v_missed
    from public.ortho_maintenances where case_id = p_case_id and status = 'faltou';
  if v_current is distinct from v_missed * v_interval then
    update public.ortho_cases set extension_days = v_missed * v_interval where id = p_case_id;
  end if;
end;
$$;
revoke execute on function public._ortho_recompute_extension(uuid) from public, anon, authenticated;

create or replace function public.ortho_maintenance_extension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._ortho_recompute_extension(coalesce(new.case_id, old.case_id));
  return null;
end;
$$;
revoke execute on function public.ortho_maintenance_extension() from public, anon, authenticated;

drop trigger if exists ortho_maintenances_extension on public.ortho_maintenances;
create trigger ortho_maintenances_extension
  after insert or delete or update of status on public.ortho_maintenances
  for each row execute function public.ortho_maintenance_extension();

-- Casos que já tinham faltas antes desta migração: acerta a prorrogação.
do $$
declare r record;
begin
  for r in select distinct case_id from public.ortho_maintenances where status = 'faltou' loop
    perform public._ortho_recompute_extension(r.case_id);
  end loop;
end $$;

-- O cronograma só cresce em caso EM TRATAMENTO (a prorrogação chama de novo).
-- E o próximo `seq` conta TODAS as linhas, canceladas inclusive: reabrir um
-- caso depois da entrega (que cancela as previstas) colidia com `(case_id,
-- seq)` — achado no ensaio da 0331.
create or replace function public.ortho_plan_maintenances(p_case_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_last date;
  v_seq integer;
  v_next date;
  v_count integer := 0;
  v_total integer;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null or v_c.status <> 'em_tratamento'
     or v_c.start_date is null or v_c.planned_end_date is null then
    return 0;
  end if;

  select max(planned_date), count(*)
    into v_last, v_total
  from public.ortho_maintenances
  where case_id = p_case_id and status <> 'cancelada';
  select coalesce(max(seq), 0) into v_seq
  from public.ortho_maintenances
  where case_id = p_case_id;

  v_next := coalesce(v_last, v_c.start_date) + v_c.maintenance_interval_days;
  while v_next <= v_c.planned_end_date and v_total + v_count < 120 loop
    v_seq := v_seq + 1;
    insert into public.ortho_maintenances (case_id, clinic_id, client_id, seq, planned_date, status)
    values (p_case_id, v_c.clinic_id, v_c.client_id, v_seq, v_next, 'prevista');
    v_count := v_count + 1;
    v_next := v_next + v_c.maintenance_interval_days;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.ortho_plan_maintenances(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) MENSALIDADES: a contenção é uma cobrança própria (`kind`)
-- -----------------------------------------------------------------------------
alter table public.ortho_charges
  add column if not exists kind text not null default 'mensalidade';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_charges_kind_check') then
    alter table public.ortho_charges
      add constraint ortho_charges_kind_check check (kind in ('mensalidade', 'contencao'));
  end if;
end $$;
-- A unicidade passa a incluir o tipo: mensalidade E contenção no mesmo mês.
alter table public.ortho_charges drop constraint if exists ortho_charges_case_id_reference_month_key;
create unique index if not exists ortho_charges_case_month_kind_uq
  on public.ortho_charges (case_id, reference_month, kind);

-- O razão: a descrição diz o que é.
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
      case when new.status = 'paga' then coalesce((new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br()) end,
      new.due_date, new.amount_cents, 'inflow',
      case when new.status = 'paga' then 'settled' else 'open' end,
      'ortho_charge', new.id, v_desc, new.created_by
    )
    on conflict (source_type, source_id) where source_type = 'ortho_charge' do nothing;
    return null;
  end if;

  -- UPDATE
  if new.status = 'paga' and old.status <> 'paga' then
    v_cash := coalesce((new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br());
    update public.financial_entries
       set status = 'settled', cash_date = v_cash, amount_cents = new.amount_cents, updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status in ('open','cancelled');
  elsif old.status = 'paga' and new.status <> 'paga' then
    update public.financial_entries
       set status = case when new.status = 'cancelada' then 'cancelled' else 'open' end,
           cash_date = null,
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

-- Gerar as mensalidades do mês: só `em_tratamento` (O1 — até a entrega das
-- contenções), só o tipo mensalidade. Não duplica.
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
    (v_month + (c.billing_day - 1)),
    c.monthly_fee_cents, 'em_aberto', (select auth.uid())
  from public.ortho_cases c
  where c.status = 'em_tratamento'
    and c.monthly_fee_cents > 0
    and (c.start_date is null or date_trunc('month', c.start_date)::date <= v_month)
    and (p_clinic_id is null or c.clinic_id = p_clinic_id)
  on conflict (case_id, reference_month, kind) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.ortho_generate_charges(date, uuid) from public, anon, authenticated;
grant execute on function public.ortho_generate_charges(date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) ABRIR E EDITAR O CASO: com a contenção (assinaturas novas)
-- -----------------------------------------------------------------------------
drop function if exists public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean);
create or replace function public.ortho_create_case(
  p_client_id uuid,
  p_orthodontist_id uuid,
  p_treatment_kind text,
  p_start_date date,
  p_planned_months integer,
  p_interval_days integer,
  p_monthly_fee_cents integer,
  p_billing_day integer,
  p_installation_fee_cents integer default 0,
  p_maintenance_procedure_id uuid default null,
  p_negotiation_id uuid default null,
  p_notes text default null,
  p_start_now boolean default false,
  p_retainer_charged boolean default null,
  p_retainer_fee_cents integer default null,
  p_retainer_terms text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_id uuid;
  v_status text := 'aguardando_inicio';
  v_s record;
  v_plan uuid;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from public.ortho_cases
              where client_id = p_client_id
                and status in ('aguardando_inicio','em_tratamento','contencao')) then
    raise exception 'CASE_ALREADY_OPEN';
  end if;
  if p_start_now and p_start_date is not null and p_start_date <= public.today_br() then
    v_status := 'em_tratamento';
  end if;

  select * into v_s from public.ortho_effective_settings(v_clinic);
  if p_negotiation_id is not null then
    select plan_id into v_plan from public.plan_negotiations where id = p_negotiation_id;
  end if;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     monthly_fee_cents, billing_day, installation_fee_cents,
     maintenance_procedure_id, plan_id, negotiation_id, notes,
     retainer_charged, retainer_fee_cents, retainer_terms, created_by)
  values
    (v_clinic, p_client_id, p_orthodontist_id, coalesce(p_treatment_kind, 'aparelho_fixo'),
     v_status, p_start_date,
     coalesce(p_planned_months, 24), coalesce(p_interval_days, 30),
     case when p_start_date is not null
          then (p_start_date + make_interval(months => coalesce(v_s.reevaluation_interval_months, 6)))::date end,
     coalesce(p_monthly_fee_cents, 0), coalesce(p_billing_day, 10),
     coalesce(p_installation_fee_cents, 0),
     p_maintenance_procedure_id, v_plan, p_negotiation_id, nullif(btrim(p_notes), ''),
     coalesce(p_retainer_charged, v_s.retainer_charge_enabled, false),
     coalesce(p_retainer_fee_cents, v_s.retainer_fee_cents, 0),
     coalesce(nullif(btrim(p_retainer_terms), ''), v_s.retainer_terms),
     (select auth.uid()))
  returning id into v_id;

  perform public._ortho_log(v_id, 'caso_aberto',
    'Caso aberto' || case when v_status = 'em_tratamento' then ' — tratamento iniciado' else '' end);
  if v_status = 'em_tratamento' then
    perform public.ortho_plan_maintenances(v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) to authenticated;

drop function if exists public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text);
create or replace function public.ortho_update_case(
  p_case_id uuid,
  p_orthodontist_id uuid,
  p_treatment_kind text,
  p_start_date date,
  p_planned_months integer,
  p_interval_days integer,
  p_monthly_fee_cents integer,
  p_billing_day integer,
  p_installation_fee_cents integer,
  p_maintenance_procedure_id uuid,
  p_next_reevaluation_date date,
  p_notes text,
  p_retainer_charged boolean default null,
  p_retainer_fee_cents integer default null,
  p_retainer_terms text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;

  update public.ortho_cases set
    orthodontist_id = p_orthodontist_id,
    treatment_kind = coalesce(p_treatment_kind, treatment_kind),
    start_date = p_start_date,
    planned_months = coalesce(p_planned_months, planned_months),
    maintenance_interval_days = coalesce(p_interval_days, maintenance_interval_days),
    monthly_fee_cents = coalesce(p_monthly_fee_cents, monthly_fee_cents),
    billing_day = coalesce(p_billing_day, billing_day),
    installation_fee_cents = coalesce(p_installation_fee_cents, installation_fee_cents),
    maintenance_procedure_id = p_maintenance_procedure_id,
    next_reevaluation_date = p_next_reevaluation_date,
    notes = nullif(btrim(p_notes), ''),
    retainer_charged = coalesce(p_retainer_charged, retainer_charged),
    retainer_fee_cents = coalesce(p_retainer_fee_cents, retainer_fee_cents),
    retainer_terms = nullif(btrim(p_retainer_terms), '')
  where id = p_case_id;

  -- Mudou o intervalo: a prorrogação das faltas muda junto.
  if v_c.maintenance_interval_days is distinct from coalesce(p_interval_days, v_c.maintenance_interval_days) then
    perform public._ortho_recompute_extension(p_case_id);
  end if;

  -- Mudou o cronograma: as previstas FUTURAS sem agendamento são refeitas; o
  -- que já aconteceu ou já está agendado fica.
  if v_c.status = 'em_tratamento'
     and (v_c.start_date is distinct from p_start_date
          or v_c.planned_months is distinct from coalesce(p_planned_months, v_c.planned_months)
          or v_c.maintenance_interval_days is distinct from coalesce(p_interval_days, v_c.maintenance_interval_days)) then
    delete from public.ortho_maintenances
     where case_id = p_case_id and status = 'prevista' and appointment_id is null
       and planned_date > public.today_br();
    perform public.ortho_plan_maintenances(p_case_id);
  end if;

  perform public._ortho_log(p_case_id, 'caso_editado', 'Dados do caso alterados');
end;
$$;
revoke execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text, boolean, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O1 — ENTREGAR AS CONTENÇÕES: finaliza o tratamento e abre o acompanhamento
-- -----------------------------------------------------------------------------
create or replace function public.ortho_deliver_retainers(
  p_case_id uuid,
  p_date date default null,
  p_charge boolean default null,
  p_amount_cents integer default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_date date := coalesce(p_date, public.today_br());
  v_charge boolean;
  v_amount integer;
  v_reeval integer;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;

  v_charge := coalesce(p_charge, v_c.retainer_charged);
  v_amount := greatest(0, coalesce(p_amount_cents, v_c.retainer_fee_cents));
  select s.reevaluation_interval_months into v_reeval
    from public.ortho_effective_settings(v_c.clinic_id) s;

  update public.ortho_cases set
    status = 'contencao',
    finished_at = v_date,
    retainer_delivered_at = v_date,
    discharged_at = null,
    finish_reason = nullif(btrim(p_reason), ''),
    retainer_charged = v_charge,
    retainer_fee_cents = case when v_charge then v_amount else retainer_fee_cents end,
    -- O primeiro controle da contenção: daqui a um intervalo de reavaliação.
    next_reevaluation_date = (v_date + make_interval(months => coalesce(v_reeval, 6)))::date
  where id = p_case_id;

  -- O cronograma ativo acaba; a mensalidade dos meses seguintes sai (O1).
  update public.ortho_maintenances set status = 'cancelada', updated_at = now()
   where case_id = p_case_id and status = 'prevista' and appointment_id is null;
  update public.ortho_charges set status = 'cancelada', updated_at = now()
   where case_id = p_case_id and kind = 'mensalidade'
     and status in ('em_aberto','atrasada')
     and reference_month > date_trunc('month', v_date)::date;

  -- A contenção cobrada: uma cobrança própria, vencendo na entrega.
  if v_charge and v_amount > 0 then
    insert into public.ortho_charges
      (case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, notes, created_by)
    values
      (p_case_id, v_c.clinic_id, v_c.client_id, 'contencao',
       date_trunc('month', v_date)::date, v_date, v_amount, 'em_aberto',
       nullif(btrim(v_c.retainer_terms), ''), (select auth.uid()))
    on conflict (case_id, reference_month, kind) do nothing;
  end if;

  perform public._ortho_log(p_case_id, 'contencoes_entregues',
    'Contenções entregues em ' || to_char(v_date, 'DD/MM/YYYY')
    || ' — tratamento finalizado; segue em acompanhamento'
    || case when v_charge and v_amount > 0
            then ' (contenção cobrada: R$ ' || to_char(v_amount / 100.0, 'FM999G999G990D00') || ')'
            else '' end
    || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
end;
$$;
revoke execute on function public.ortho_deliver_retainers(uuid, date, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_deliver_retainers(uuid, date, boolean, integer, text) to authenticated;

-- Iniciar, entregar contenções (= finalizar), alta, interromper, reabrir.
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
  v_date date := coalesce(p_date, public.today_br());
  v_reeval integer;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_status not in ('em_tratamento','contencao','finalizado','interrompido') then
    raise exception 'INVALID_STATUS';
  end if;
  if p_status = v_c.status then return; end if;

  if p_status = 'em_tratamento' then
    if v_c.status not in ('aguardando_inicio','contencao','finalizado','interrompido') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if v_c.status in ('finalizado','interrompido')
       and exists (select 1 from public.ortho_cases
                    where client_id = v_c.client_id and id <> p_case_id
                      and status in ('aguardando_inicio','em_tratamento','contencao')) then
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
      interrupted_at = null, interrupt_reason = null
    where id = p_case_id;
    perform public.ortho_plan_maintenances(p_case_id);
    perform public._ortho_log(p_case_id, 'tratamento_iniciado',
      case when v_c.status = 'aguardando_inicio' then 'Tratamento iniciado em '
           else 'Caso reaberto em ' end || to_char(v_date, 'DD/MM/YYYY')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));

  elsif p_status = 'contencao' then
    -- O1: contenção = contenções entregues, com a cobrança combinada no caso.
    perform public.ortho_deliver_retainers(p_case_id, v_date, null, null, p_reason);

  elsif p_status = 'finalizado' then
    -- Alta do acompanhamento (de `contencao`) ou encerramento direto.
    if v_c.status not in ('em_tratamento','contencao') then raise exception 'INVALID_TRANSITION'; end if;
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

  elsif p_status = 'interrompido' then
    if v_c.status not in ('aguardando_inicio','em_tratamento','contencao') then
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
    perform public._ortho_log(p_case_id, 'interrompido',
      'Tratamento interrompido em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));
  end if;
end;
$$;
revoke execute on function public.ortho_set_status(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.ortho_set_status(uuid, text, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) O3 — A FALTA FICA REGISTRADA E PRORROGA; o cronograma ganha a vaga no fim
-- -----------------------------------------------------------------------------
-- "Prevista" a partir de "faltou" é DESFAZER a falta (marcada por engano); a
-- falta de verdade fica, e a próxima prevista recebe o reagendamento.
create or replace function public.ortho_mark_maintenance(
  p_maintenance_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_schedule(v_m.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_status not in ('faltou','cancelada','prevista') then raise exception 'INVALID_STATUS'; end if;
  if v_m.status = 'realizada' then raise exception 'ALREADY_DONE'; end if;

  update public.ortho_maintenances set
    status = p_status,
    appointment_id = case when p_status = 'prevista' then null else appointment_id end,
    updated_at = now()
  where id = p_maintenance_id;

  -- A falta prorrogou o término: o cronograma ganha a vaga correspondente.
  if p_status = 'faltou' then
    perform public.ortho_plan_maintenances(v_m.case_id);
  end if;

  perform public._ortho_log(v_m.case_id, 'manutencao_' || p_status,
    'Manutenção ' || v_m.seq || ' marcada como ' ||
    case p_status when 'faltou' then 'falta (o término previsto foi prorrogado)'
                  when 'cancelada' then 'cancelada'
                  else case when v_m.status = 'faltou' then 'prevista (falta desfeita)' else 'prevista' end end);
end;
$$;
revoke execute on function public.ortho_mark_maintenance(uuid, text) from public, anon, authenticated;
grant execute on function public.ortho_mark_maintenance(uuid, text) to authenticated;

-- A agenda: falta registrada prorroga e ganha vaga; cancelar o agendamento de
-- uma falta NÃO apaga a falta (só solta o agendamento).
create or replace function public.ortho_appointment_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_date date;
begin
  begin
    select * into v_m from public.ortho_maintenances where appointment_id = new.id;

    if v_m.id is null then
      if new.status::text = 'cancelled' then return null; end if;
      if new.type::text not in ('treatment_session','treatment_start','return_visit') then
        return null;
      end if;
      if new.provider_user_id is null then return null; end if;
      select * into v_c from public.ortho_cases c
       where c.client_id = new.client_id
         and c.status in ('aguardando_inicio','em_tratamento','contencao')
       order by c.created_at desc limit 1;
      if v_c.id is null or v_c.orthodontist_id is distinct from new.provider_user_id then
        return null;
      end if;
      v_date := (new.starts_at at time zone 'America/Sao_Paulo')::date;

      select * into v_m from public.ortho_maintenances m
       where m.case_id = v_c.id and m.status = 'prevista' and m.appointment_id is null
         and m.planned_date is not null and abs(m.planned_date - v_date) <= 45
       order by abs(m.planned_date - v_date), m.seq limit 1;

      if v_m.id is null then
        insert into public.ortho_maintenances
          (case_id, clinic_id, client_id, seq, planned_date, status, appointment_id)
        values (v_c.id, v_c.clinic_id, v_c.client_id,
                coalesce((select max(seq) from public.ortho_maintenances where case_id = v_c.id), 0) + 1,
                v_date, 'agendada', new.id)
        returning * into v_m;
      else
        update public.ortho_maintenances
           set appointment_id = new.id, status = 'agendada', updated_at = now()
         where id = v_m.id;
      end if;
    end if;

    if new.status::text = 'completed' then
      perform public._ortho_complete_maintenance(v_m.id, coalesce(new.done_at, new.starts_at), new.provider_user_id);
    elsif new.status::text = 'no_show' then
      update public.ortho_maintenances set status = 'faltou', updated_at = now()
       where id = v_m.id and status <> 'realizada';
      perform public.ortho_plan_maintenances(v_m.case_id);
    elsif new.status::text = 'cancelled' then
      update public.ortho_maintenances
         set status = case when status = 'agendada' then 'prevista' else status end,
             appointment_id = null, updated_at = now()
       where id = v_m.id and status in ('agendada','faltou');
    elsif v_m.status in ('prevista','faltou') then
      update public.ortho_maintenances set status = 'agendada', updated_at = now()
       where id = v_m.id;
    end if;
  exception when others then
    raise warning 'ortho_appointment_sync (% em %): %', tg_op, new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.ortho_appointment_sync() from public, anon, authenticated;

drop trigger if exists appointments_ortho_sync on public.appointments;
create trigger appointments_ortho_sync
  after insert or update of status, provider_user_id, starts_at, type on public.appointments
  for each row execute function public.ortho_appointment_sync();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.chart_of_accounts
    where code = '1.1.04' and name = 'Ortodontia — mensalidades e contenções') as conta_renomeada,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_cases'
      and column_name in ('retainer_charged','retainer_fee_cents','retainer_terms',
                          'retainer_delivered_at','discharged_at','extension_days')) as colunas_do_caso,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_settings'
      and column_name in ('retainer_charge_enabled','retainer_fee_cents','retainer_terms')) as colunas_da_config,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_charges' and column_name = 'kind') as tipo_da_cobranca,
  (select count(*) from public.permission_matrix
    where capability = 'acao.ortodontia.financeiro' and role in ('receptionist','franchisee')) as recepcao_e_franqueado_na_baixa,
  (select count(*) from pg_trigger where tgname = 'ortho_maintenances_extension') as gatilho_das_faltas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ortho_deliver_retainers') as funcao_entrega;
-- Esperado: 1 · 6 · 3 · 1 · 0 · 1 · 1
