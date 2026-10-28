-- =============================================================================
-- 0329 — ORTODONTIA (ORTO1): o caso, o cronograma, a mensalidade e o repasse
-- -----------------------------------------------------------------------------
-- Pedido do dono (27/10/2026): acompanhar todos os pacientes em tratamento
-- ortodôntico — quantos, novos, finalizados, no prazo × atrasados, faltas,
-- quem precisa de agendamento, previsão de término — com linha própria de
-- receita na DRE, mensalidade que NÃO é procedimento e repasse ao ortodontista
-- POR MANUTENÇÃO REALIZADA. Plano e decisões: docs/ortodontia/ORTO-PLANO.md.
--
-- O DESENHO EM UMA FRASE: cada paciente de ortodontia vira um CASO
-- (`ortho_cases`) com um cronograma de MANUTENÇÕES (`ortho_maintenances`) e
-- MENSALIDADES (`ortho_charges`). A agenda liga sozinha o agendamento com o
-- ortodontista à manutenção prevista; concluir o atendimento marca a
-- manutenção como realizada e gera o repasse (`provider_payouts`, a mesma
-- tabela do Repasse — `session_id` passa a aceitar nulo e a linha aponta para
-- `ortho_maintenance_id`).
--
-- A MENSALIDADE NO RAZÃO É UM LANÇAMENTO SÓ (conta nova 1.1.04): nasce `open`
-- na competência do mês (DRE), a baixa põe `cash_date` e `settled` (fluxo de
-- caixa realizado), desfazer volta a `open`, cancelar vira `cancelled`. A
-- separação em duas linhas das parcelas (0187) existe para a baixa PARCIAL,
-- que a mensalidade não tem — e duas linhas aqui fariam a DRE contar duas vezes
-- (ela exclui liquidação só pelo NOME `receipt_cash`/`payable_cash`, 0226).
--
-- ACESSO: regras de linha deixam LER quem é da unidade (ou da rede); GRAVAR
-- só pelas funções abaixo, cada uma com a guarda do papel (ortho_can_*). As
-- permissões novas da matriz são SEMEADAS aqui — permissão sem linha no banco
-- não alcança ninguém (lição da 0294).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONTA DA DRE
-- -----------------------------------------------------------------------------
insert into public.chart_of_accounts
  (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic)
values
  ('1.1.04', 'Ortodontia — mensalidades', '1.1', 'revenue', 'operational', 'none', 'unit', true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2) CONFIGURAÇÃO EM CASCATA (rede → unidade)
-- -----------------------------------------------------------------------------
create table if not exists public.ortho_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete cascade,
  monthly_fee_cents integer not null default 0 check (monthly_fee_cents >= 0),
  planned_months integer not null default 24 check (planned_months between 1 and 120),
  maintenance_interval_days integer not null default 30 check (maintenance_interval_days between 7 and 180),
  reevaluation_interval_months integer not null default 6 check (reevaluation_interval_months between 1 and 36),
  finish_tolerance_days integer not null default 30 check (finish_tolerance_days between 0 and 365),
  maintenance_procedure_id uuid references public.procedures (id),
  billing_day integer not null default 10 check (billing_day between 1 and 28),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ortho_settings_clinic_uq
  on public.ortho_settings (clinic_id) nulls not distinct;

alter table public.ortho_settings enable row level security;

drop policy if exists "ortho_settings_select" on public.ortho_settings;
create policy "ortho_settings_select" on public.ortho_settings
  for select to authenticated using (true);

-- Admin edita a rede (e qualquer unidade); o Gerente, só a própria unidade.
drop policy if exists "ortho_settings_write" on public.ortho_settings;
create policy "ortho_settings_write" on public.ortho_settings
  for all to authenticated
  using (
    public.is_admin_master()
    or (clinic_id is not null
        and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[]))
  )
  with check (
    public.is_admin_master()
    or (clinic_id is not null
        and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[]))
  );

insert into public.ortho_settings (clinic_id) values (null)
on conflict (clinic_id) do nothing;

create or replace function public.ortho_effective_settings(p_clinic_id uuid)
returns table (
  monthly_fee_cents integer,
  planned_months integer,
  maintenance_interval_days integer,
  reevaluation_interval_months integer,
  finish_tolerance_days integer,
  maintenance_procedure_id uuid,
  billing_day integer
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
    coalesce(u.billing_day, n.billing_day, 10)
  from (select 1) one
  left join public.ortho_settings u on u.clinic_id = p_clinic_id
  left join public.ortho_settings n on n.clinic_id is null;
$$;
revoke execute on function public.ortho_effective_settings(uuid) from public, anon, authenticated;
grant execute on function public.ortho_effective_settings(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) AS GUARDAS (espelho de src/lib/ortodontia/access.ts)
-- -----------------------------------------------------------------------------
-- Quem LÊ o módulo: Admin, rede (Franqueadora/Rede, Financeiro da
-- Franqueadora pelo escopo), e a equipe da unidade.
create or replace function public.ortho_can_view(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_network_viewer()
      or p_clinic_id in (select public.user_full_access_clinic_ids())
      or public.has_role_in_clinic(p_clinic_id,
           array['receptionist','clinical_coordinator','unit_manager','franchisee',
                 'dentist','tsb','asb']::public.user_role[]);
$$;
revoke execute on function public.ortho_can_view(uuid) from public, anon, authenticated;
grant execute on function public.ortho_can_view(uuid) to authenticated;

-- Quem GERE o caso (abre, edita, inicia, finaliza): Gerente e Coordenador.
create or replace function public.ortho_can_manage(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.has_role_in_clinic(p_clinic_id,
           array['unit_manager','clinical_coordinator']::public.user_role[]);
$$;
revoke execute on function public.ortho_can_manage(uuid) from public, anon, authenticated;
grant execute on function public.ortho_can_manage(uuid) to authenticated;

-- Quem AGENDA e marca falta/cancela manutenção: a recepção, além de quem gere.
create or replace function public.ortho_can_schedule(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.ortho_can_manage(p_clinic_id)
      or public.has_role_in_clinic(p_clinic_id, array['receptionist']::public.user_role[]);
$$;
revoke execute on function public.ortho_can_schedule(uuid) from public, anon, authenticated;
grant execute on function public.ortho_can_schedule(uuid) to authenticated;

-- Quem DÁ BAIXA na mensalidade: Gerente, Recepção, Franqueado (decisão O2) e a
-- rede (Franqueadora/Rede, Financeiro da Franqueadora).
create or replace function public.ortho_can_settle(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_network_viewer()
      or public.has_role_in_clinic(p_clinic_id,
           array['unit_manager','receptionist','franchisee']::public.user_role[]);
$$;
revoke execute on function public.ortho_can_settle(uuid) from public, anon, authenticated;
grant execute on function public.ortho_can_settle(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O CASO
-- -----------------------------------------------------------------------------
create sequence if not exists public.ortho_case_code_seq;

create table if not exists public.ortho_cases (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    default ('ORT-' || lpad(nextval('public.ortho_case_code_seq')::text, 6, '0')),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  orthodontist_id uuid references public.profiles (id),
  treatment_kind text not null default 'aparelho_fixo'
    check (treatment_kind in ('aparelho_fixo','alinhadores','aparelho_removivel','contencao','outro')),
  status text not null default 'aguardando_inicio'
    check (status in ('aguardando_inicio','em_tratamento','contencao','finalizado','interrompido')),
  -- Cronograma.
  start_date date,
  planned_months integer not null default 24 check (planned_months between 1 and 120),
  planned_end_date date,
  maintenance_interval_days integer not null default 30
    check (maintenance_interval_days between 7 and 180),
  next_reevaluation_date date,
  -- Dinheiro: a MENSALIDADE (não é procedimento). A instalação é informativa.
  monthly_fee_cents integer not null default 0 check (monthly_fee_cents >= 0),
  billing_day integer not null default 10 check (billing_day between 1 and 28),
  installation_fee_cents integer not null default 0 check (installation_fee_cents >= 0),
  -- O procedimento que define o repasse de cada manutenção (tabela de repasse).
  maintenance_procedure_id uuid references public.procedures (id),
  -- Elos opcionais com o plano/venda do Comercial.
  plan_id uuid references public.treatment_plans (id) on delete set null,
  negotiation_id uuid references public.plan_negotiations (id) on delete set null,
  -- Encerramento.
  finished_at date,
  finish_reason text,
  interrupted_at date,
  interrupt_reason text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ortho_cases_clinic_status_idx on public.ortho_cases (clinic_id, status);
create index if not exists ortho_cases_client_idx on public.ortho_cases (client_id);
create index if not exists ortho_cases_orthodontist_idx on public.ortho_cases (orthodontist_id);
-- Um caso ABERTO por paciente.
create unique index if not exists ortho_cases_one_open_per_client
  on public.ortho_cases (client_id)
  where status in ('aguardando_inicio','em_tratamento','contencao');

alter table public.ortho_cases enable row level security;

drop policy if exists "ortho_cases_select" on public.ortho_cases;
create policy "ortho_cases_select" on public.ortho_cases
  for select to authenticated using (public.ortho_can_view(clinic_id));
-- Gravar: só pelas funções (security definer). Direto, só o Admin.
drop policy if exists "ortho_cases_write" on public.ortho_cases;
create policy "ortho_cases_write" on public.ortho_cases
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

-- Antes de gravar: o término previsto é CONTA (início + meses), e a hora.
create or replace function public.ortho_case_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.start_date is not null then
    new.planned_end_date := (new.start_date + make_interval(months => new.planned_months))::date;
  else
    new.planned_end_date := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.ortho_case_before_write() from public, anon, authenticated;

drop trigger if exists ortho_cases_before_write on public.ortho_cases;
create trigger ortho_cases_before_write
  before insert or update on public.ortho_cases
  for each row execute function public.ortho_case_before_write();

-- A marcação no cliente (mesmo formato do PPR+ e do Empresarial): o caso
-- aberto e se o paciente está em ortodontia — barato para o selo da ficha.
alter table public.clients
  add column if not exists ortho_case_id uuid references public.ortho_cases (id) on delete set null;
alter table public.clients
  add column if not exists ortho_active boolean;

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
       order by (o.status in ('aguardando_inicio','em_tratamento','contencao')) desc,
                o.created_at desc
       limit 1),
    ortho_active = exists (
      select 1 from public.ortho_cases o
       where o.client_id = new.client_id
         and o.status in ('aguardando_inicio','em_tratamento','contencao'))
  where c.id = new.client_id;
  return null;
end;
$$;
revoke execute on function public.ortho_case_sync_client() from public, anon, authenticated;

drop trigger if exists ortho_cases_sync_client on public.ortho_cases;
create trigger ortho_cases_sync_client
  after insert or update of status, client_id on public.ortho_cases
  for each row execute function public.ortho_case_sync_client();

-- -----------------------------------------------------------------------------
-- 5) AS MANUTENÇÕES
-- -----------------------------------------------------------------------------
create table if not exists public.ortho_maintenances (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ortho_cases (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  seq integer not null,
  planned_date date,
  appointment_id uuid references public.appointments (id) on delete set null,
  status text not null default 'prevista'
    check (status in ('prevista','agendada','realizada','faltou','cancelada')),
  done_at timestamptz,
  done_by uuid references public.profiles (id),
  -- A evolução: o que foi feito nesta manutenção.
  arch_wire text,
  notes text,
  next_steps text,
  payout_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, seq)
);
create index if not exists ortho_maintenances_case_idx on public.ortho_maintenances (case_id, planned_date);
create index if not exists ortho_maintenances_clinic_status_idx on public.ortho_maintenances (clinic_id, status, planned_date);
create unique index if not exists ortho_maintenances_appointment_uq
  on public.ortho_maintenances (appointment_id) where appointment_id is not null;

alter table public.ortho_maintenances enable row level security;

drop policy if exists "ortho_maintenances_select" on public.ortho_maintenances;
create policy "ortho_maintenances_select" on public.ortho_maintenances
  for select to authenticated using (public.ortho_can_view(clinic_id));
drop policy if exists "ortho_maintenances_write" on public.ortho_maintenances;
create policy "ortho_maintenances_write" on public.ortho_maintenances
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

-- -----------------------------------------------------------------------------
-- 6) AS MENSALIDADES
-- -----------------------------------------------------------------------------
create table if not exists public.ortho_charges (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ortho_cases (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  reference_month date not null,
  due_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'em_aberto'
    check (status in ('em_aberto','paga','atrasada','cancelada')),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id),
  payment_method text
    check (payment_method is null or payment_method in
      ('pix','boleto','cartao','credito_recorrente','dinheiro')),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, reference_month)
);
create index if not exists ortho_charges_clinic_idx on public.ortho_charges (clinic_id, status, due_date);
create index if not exists ortho_charges_client_idx on public.ortho_charges (client_id, due_date);

alter table public.ortho_charges enable row level security;

drop policy if exists "ortho_charges_select" on public.ortho_charges;
create policy "ortho_charges_select" on public.ortho_charges
  for select to authenticated using (public.ortho_can_view(clinic_id));
drop policy if exists "ortho_charges_write" on public.ortho_charges;
create policy "ortho_charges_write" on public.ortho_charges
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

-- -----------------------------------------------------------------------------
-- 7) O HISTÓRICO DO CASO (já é histórico: fora da auditoria de alterações)
-- -----------------------------------------------------------------------------
create table if not exists public.ortho_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ortho_cases (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  event_type text not null,
  description text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists ortho_events_case_idx on public.ortho_events (case_id, created_at);

alter table public.ortho_events enable row level security;

drop policy if exists "ortho_events_select" on public.ortho_events;
create policy "ortho_events_select" on public.ortho_events
  for select to authenticated using (public.ortho_can_view(clinic_id));
drop policy if exists "ortho_events_write" on public.ortho_events;
create policy "ortho_events_write" on public.ortho_events
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'ortho_events', 'Já é histórico (linha do tempo do caso ortodôntico)')
on conflict do nothing;

create or replace function public._ortho_log(
  p_case_id uuid, p_type text, p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.ortho_cases where id = p_case_id;
  if v_clinic is null then return; end if;
  insert into public.ortho_events (case_id, clinic_id, event_type, description, created_by)
  values (p_case_id, v_clinic, p_type, p_description, (select auth.uid()));
end;
$$;
revoke execute on function public._ortho_log(uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) O REPASSE: a manutenção realizada entra na MESMA tabela do Repasse
-- -----------------------------------------------------------------------------
-- `session_id` deixa de ser obrigatório; a linha da ortodontia aponta para a
-- manutenção. Exatamente UMA das duas origens. O fechamento mensal
-- (`close_payout_month`) soma por unidade/mês e não olha a origem — não muda.
alter table public.provider_payouts alter column session_id drop not null;
alter table public.provider_payouts
  add column if not exists ortho_maintenance_id uuid
    references public.ortho_maintenances (id) on delete cascade;
create unique index if not exists provider_payouts_ortho_maintenance_uq
  on public.provider_payouts (ortho_maintenance_id) where ortho_maintenance_id is not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'provider_payouts_one_origin'
  ) then
    alter table public.provider_payouts
      add constraint provider_payouts_one_origin
      check ((session_id is null) <> (ortho_maintenance_id is null));
  end if;
end $$;

-- Marca a manutenção como REALIZADA e apura o repasse (uma vez). Interna.
create or replace function public._ortho_complete_maintenance(
  p_maintenance_id uuid,
  p_done_at timestamptz,
  p_done_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_provider uuid;
  v_proc uuid;
  v_proc_name text;
  v_when date;
  v_rate record;
  v_payout uuid;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null then return; end if;
  select * into v_c from public.ortho_cases where id = v_m.case_id;

  v_provider := coalesce(p_done_by, v_m.done_by, v_c.orthodontist_id);
  v_when := coalesce((coalesce(p_done_at, v_m.done_at, now()) at time zone 'America/Sao_Paulo')::date, public.today_br());

  update public.ortho_maintenances set
    status = 'realizada',
    done_at = coalesce(p_done_at, done_at, now()),
    done_by = v_provider,
    updated_at = now()
  where id = p_maintenance_id;

  -- O procedimento que define o valor: o do caso, senão o da configuração.
  v_proc := coalesce(
    v_c.maintenance_procedure_id,
    (select s.maintenance_procedure_id from public.ortho_effective_settings(v_c.clinic_id) s));
  select p.name into v_proc_name from public.procedures p where p.id = v_proc;

  if v_provider is not null then
    if v_proc is not null then
      select * into v_rate from public.payout_rate_for(v_proc, v_provider, v_c.clinic_id, v_when);
    end if;
    -- Sem tabela: registra ZERO em vez de não registrar (a mesma regra do
    -- repasse por sessão) — silêncio aqui viraria ortodontista recebendo a menos.
    insert into public.provider_payouts
      (clinic_id, provider_id, ortho_maintenance_id, procedure_id, procedure_name,
       accrual_date, amount_cents, rate_id)
    values
      (v_c.clinic_id, v_provider, p_maintenance_id, v_proc,
       coalesce(v_proc_name, 'Manutenção ortodôntica'),
       v_when, coalesce(v_rate.amount_cents, 0), v_rate.rate_id)
    on conflict (ortho_maintenance_id) where ortho_maintenance_id is not null do nothing;

    select id into v_payout from public.provider_payouts where ortho_maintenance_id = p_maintenance_id;
    update public.ortho_maintenances set payout_id = v_payout where id = p_maintenance_id;
  end if;

  if v_m.status <> 'realizada' then
    perform public._ortho_log(v_m.case_id, 'manutencao_realizada',
      'Manutenção ' || v_m.seq || ' realizada em ' || to_char(v_when, 'DD/MM/YYYY'));
  end if;
end;
$$;
revoke execute on function public._ortho_complete_maintenance(uuid, timestamptz, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) O CRONOGRAMA (gera o que falta; nunca duplica)
-- -----------------------------------------------------------------------------
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
  if v_c.id is null or v_c.start_date is null or v_c.planned_end_date is null then
    return 0;
  end if;

  select max(planned_date), coalesce(max(seq), 0), count(*)
    into v_last, v_seq, v_total
  from public.ortho_maintenances
  where case_id = p_case_id and status <> 'cancelada';

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
-- 10) ABRIR, EDITAR E MUDAR A SITUAÇÃO DO CASO
-- -----------------------------------------------------------------------------
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
  p_start_now boolean default false
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
  v_reeval integer;
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

  select s.reevaluation_interval_months into v_reeval
    from public.ortho_effective_settings(v_clinic) s;
  if p_negotiation_id is not null then
    select plan_id into v_plan from public.plan_negotiations where id = p_negotiation_id;
  end if;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     monthly_fee_cents, billing_day, installation_fee_cents,
     maintenance_procedure_id, plan_id, negotiation_id, notes, created_by)
  values
    (v_clinic, p_client_id, p_orthodontist_id, coalesce(p_treatment_kind, 'aparelho_fixo'),
     v_status, p_start_date,
     coalesce(p_planned_months, 24), coalesce(p_interval_days, 30),
     case when p_start_date is not null
          then (p_start_date + make_interval(months => coalesce(v_reeval, 6)))::date end,
     coalesce(p_monthly_fee_cents, 0), coalesce(p_billing_day, 10),
     coalesce(p_installation_fee_cents, 0),
     p_maintenance_procedure_id, v_plan, p_negotiation_id, nullif(btrim(p_notes), ''),
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
revoke execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean) to authenticated;

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
  p_notes text
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
    notes = nullif(btrim(p_notes), '')
  where id = p_case_id;

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
revoke execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text) from public, anon, authenticated;
grant execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text) to authenticated;

-- Iniciar, pôr em contenção, finalizar, interromper, reabrir.
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
      interrupted_at = null, interrupt_reason = null
    where id = p_case_id;
    perform public.ortho_plan_maintenances(p_case_id);
    perform public._ortho_log(p_case_id, 'tratamento_iniciado',
      case when v_c.status = 'aguardando_inicio' then 'Tratamento iniciado em '
           else 'Caso reaberto em ' end || to_char(v_date, 'DD/MM/YYYY')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));

  elsif p_status = 'contencao' then
    if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;
    update public.ortho_cases set status = 'contencao' where id = p_case_id;
    -- Contenção não cobra mensalidade (decisão O1): os meses seguintes saem.
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    perform public._ortho_log(p_case_id, 'contencao',
      'Fase de contenção a partir de ' || to_char(v_date, 'DD/MM/YYYY')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));

  elsif p_status = 'finalizado' then
    if v_c.status not in ('em_tratamento','contencao') then raise exception 'INVALID_TRANSITION'; end if;
    update public.ortho_cases set
      status = 'finalizado', finished_at = v_date, finish_reason = nullif(btrim(p_reason), '')
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    perform public._ortho_log(p_case_id, 'finalizado',
      'Tratamento finalizado em ' || to_char(v_date, 'DD/MM/YYYY')
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
     where case_id = p_case_id and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    perform public._ortho_log(p_case_id, 'interrompido',
      'Tratamento interrompido em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));
  end if;
end;
$$;
revoke execute on function public.ortho_set_status(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.ortho_set_status(uuid, text, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 11) MANUTENÇÕES: evolução, falta, extra, vínculo com a agenda
-- -----------------------------------------------------------------------------
-- Quem registra a evolução: Coordenador/Gerente da unidade, ou o DENTISTA que
-- é o ortodontista do caso (não qualquer dentista).
create or replace function public.ortho_can_evolve(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ortho_cases c
     where c.id = p_case_id
       and (public.ortho_can_manage(c.clinic_id)
            or (c.orthodontist_id = (select auth.uid())
                and public.has_role_in_clinic(c.clinic_id, array['dentist']::public.user_role[])))
  );
$$;
revoke execute on function public.ortho_can_evolve(uuid) from public, anon, authenticated;
grant execute on function public.ortho_can_evolve(uuid) to authenticated;

-- Salva a evolução; com p_done = true marca realizada e apura o repasse.
create or replace function public.ortho_save_evolution(
  p_maintenance_id uuid,
  p_done boolean,
  p_done_at timestamptz,
  p_arch_wire text,
  p_notes text,
  p_next_steps text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_user uuid := (select auth.uid());
  v_by uuid;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_evolve(v_m.case_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_m.status = 'cancelada' then raise exception 'MAINTENANCE_CANCELLED'; end if;
  select * into v_c from public.ortho_cases where id = v_m.case_id;

  update public.ortho_maintenances set
    arch_wire = nullif(btrim(p_arch_wire), ''),
    notes = nullif(btrim(p_notes), ''),
    next_steps = nullif(btrim(p_next_steps), ''),
    updated_at = now()
  where id = p_maintenance_id;

  if p_done and v_m.status <> 'realizada' then
    -- Quem fez: o dentista logado quando é ele; senão o ortodontista do caso.
    v_by := case when public.has_role_in_clinic(v_c.clinic_id, array['dentist']::public.user_role[])
                 then v_user else v_c.orthodontist_id end;
    perform public._ortho_complete_maintenance(p_maintenance_id, coalesce(p_done_at, now()), v_by);
  elsif not p_done and v_m.status = 'realizada' then
    -- Desfazer: só quem gere, e só se o repasse ainda não foi fechado.
    if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
    if exists (select 1 from public.provider_payouts p
                where p.ortho_maintenance_id = p_maintenance_id and p.closing_id is not null) then
      raise exception 'PAYOUT_CLOSED';
    end if;
    delete from public.provider_payouts where ortho_maintenance_id = p_maintenance_id;
    update public.ortho_maintenances set
      status = case when appointment_id is not null then 'agendada' else 'prevista' end,
      done_at = null, done_by = null, payout_id = null, updated_at = now()
    where id = p_maintenance_id;
    perform public._ortho_log(v_m.case_id, 'manutencao_desfeita',
      'Manutenção ' || v_m.seq || ' voltou a não realizada');
  end if;
end;
$$;
revoke execute on function public.ortho_save_evolution(uuid, boolean, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.ortho_save_evolution(uuid, boolean, timestamptz, text, text, text) to authenticated;

-- Falta, cancelamento ou volta a "prevista" — pela recepção ou por quem gere.
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

  perform public._ortho_log(v_m.case_id, 'manutencao_' || p_status,
    'Manutenção ' || v_m.seq || ' marcada como ' ||
    case p_status when 'faltou' then 'falta' when 'cancelada' then 'cancelada' else 'prevista' end);
end;
$$;
revoke execute on function public.ortho_mark_maintenance(uuid, text) from public, anon, authenticated;
grant execute on function public.ortho_mark_maintenance(uuid, text) to authenticated;

-- Uma manutenção EXTRA (fora do cronograma: emergência, bráquete solto…).
create or replace function public.ortho_add_maintenance(
  p_case_id uuid,
  p_planned_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_id uuid;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_schedule(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status not in ('aguardando_inicio','em_tratamento','contencao') then
    raise exception 'CASE_CLOSED';
  end if;
  insert into public.ortho_maintenances (case_id, clinic_id, client_id, seq, planned_date, status)
  values (p_case_id, v_c.clinic_id, v_c.client_id,
          coalesce((select max(seq) from public.ortho_maintenances where case_id = p_case_id), 0) + 1,
          coalesce(p_planned_date, public.today_br()), 'prevista')
  returning id into v_id;
  perform public._ortho_log(p_case_id, 'manutencao_extra',
    'Manutenção extra prevista para ' || to_char(coalesce(p_planned_date, public.today_br()), 'DD/MM/YYYY'));
  return v_id;
end;
$$;
revoke execute on function public.ortho_add_maintenance(uuid, date) from public, anon, authenticated;
grant execute on function public.ortho_add_maintenance(uuid, date) to authenticated;

-- Liga à mão um agendamento do paciente a uma manutenção.
create or replace function public.ortho_link_appointment(
  p_maintenance_id uuid,
  p_appointment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_a public.appointments;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_schedule(v_m.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  select * into v_a from public.appointments where id = p_appointment_id;
  if v_a.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if v_a.client_id <> v_m.client_id then raise exception 'APPOINTMENT_OTHER_CLIENT'; end if;
  if exists (select 1 from public.ortho_maintenances
              where appointment_id = p_appointment_id and id <> p_maintenance_id) then
    raise exception 'APPOINTMENT_ALREADY_LINKED';
  end if;

  update public.ortho_maintenances set
    appointment_id = p_appointment_id,
    planned_date = coalesce(planned_date, (v_a.starts_at at time zone 'America/Sao_Paulo')::date),
    status = case when status in ('prevista','faltou') then 'agendada' else status end,
    updated_at = now()
  where id = p_maintenance_id;

  if v_a.status::text = 'completed' then
    perform public._ortho_complete_maintenance(p_maintenance_id, coalesce(v_a.done_at, v_a.starts_at), v_a.provider_user_id);
  elsif v_a.status::text = 'no_show' then
    update public.ortho_maintenances set status = 'faltou', updated_at = now() where id = p_maintenance_id;
  end if;
  perform public._ortho_log(v_m.case_id, 'manutencao_vinculada',
    'Manutenção ' || v_m.seq || ' ligada ao agendamento de ' ||
    to_char(v_a.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
end;
$$;
revoke execute on function public.ortho_link_appointment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ortho_link_appointment(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 12) A AGENDA LIGA SOZINHA (gatilho blindado: nunca derruba o agendamento)
-- -----------------------------------------------------------------------------
-- Agendamento do paciente COM O ORTODONTISTA do caso aberto (sessão, início de
-- tratamento ou retorno) → liga à manutenção prevista mais próxima (±45 dias)
-- ou cria uma extra. Concluído → realizada (+ repasse); falta → faltou;
-- cancelado → volta a prevista e solta o agendamento.
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
    elsif new.status::text = 'cancelled' then
      update public.ortho_maintenances
         set status = 'prevista', appointment_id = null, updated_at = now()
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
-- 13) A MENSALIDADE NO RAZÃO (um lançamento por cobrança — ver o cabeçalho)
-- -----------------------------------------------------------------------------
create unique index if not exists financial_entries_ortho_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type = 'ortho_charge';

create or replace function public.ortho_charge_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash date;
begin
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
      'ortho_charge', new.id,
      'Mensalidade ortodôntica ' || to_char(new.reference_month, 'MM/YYYY'),
      new.created_by
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
           reversal_reason = case when new.status = 'cancelada' then 'Mensalidade cancelada' else 'Baixa desfeita' end,
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

drop trigger if exists ortho_charges_ledger on public.ortho_charges;
create trigger ortho_charges_ledger
  after insert or update on public.ortho_charges
  for each row execute function public.ortho_charge_ledger();

-- Gerar as mensalidades do mês: uma por caso EM TRATAMENTO (decisão O1:
-- contenção e aguardando início não cobram). Não duplica.
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
    (case_id, clinic_id, client_id, reference_month, due_date, amount_cents, status, created_by)
  select
    c.id, c.clinic_id, c.client_id, v_month,
    (v_month + (c.billing_day - 1)) ,
    c.monthly_fee_cents, 'em_aberto', (select auth.uid())
  from public.ortho_cases c
  where c.status = 'em_tratamento'
    and c.monthly_fee_cents > 0
    and (c.start_date is null or date_trunc('month', c.start_date)::date <= v_month)
    and (p_clinic_id is null or c.clinic_id = p_clinic_id)
  on conflict (case_id, reference_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.ortho_generate_charges(date, uuid) from public, anon, authenticated;
grant execute on function public.ortho_generate_charges(date, uuid) to authenticated;

-- Dar baixa (ou desfazer).
create or replace function public.ortho_mark_charge_paid(
  p_charge_id uuid,
  p_paid boolean default true,
  p_payment_method text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ch public.ortho_charges;
  v_user uuid := (select auth.uid());
begin
  select * into v_ch from public.ortho_charges where id = p_charge_id;
  if v_ch.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_settle(v_ch.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_ch.status = 'cancelada' then raise exception 'CHARGE_CANCELLED'; end if;

  update public.ortho_charges set
    status = case when p_paid then 'paga'
                  when due_date < public.today_br() then 'atrasada'
                  else 'em_aberto' end,
    paid_at = case when p_paid then now() end,
    paid_by = case when p_paid then v_user end,
    payment_method = case when p_paid then nullif(p_payment_method, '') end,
    updated_at = now()
  where id = p_charge_id;

  perform public._ortho_log(v_ch.case_id, case when p_paid then 'mensalidade_paga' else 'baixa_desfeita' end,
    'Mensalidade ' || to_char(v_ch.reference_month, 'MM/YYYY') ||
    case when p_paid then ' paga' else ' — baixa desfeita' end);
end;
$$;
revoke execute on function public.ortho_mark_charge_paid(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.ortho_mark_charge_paid(uuid, boolean, text) to authenticated;

-- Cancelar uma mensalidade (erro de geração, acordo) — só quem gere.
create or replace function public.ortho_cancel_charge(
  p_charge_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ch public.ortho_charges;
begin
  select * into v_ch from public.ortho_charges where id = p_charge_id;
  if v_ch.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_ch.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_ch.status = 'paga' then raise exception 'CHARGE_PAID'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
  update public.ortho_charges set status = 'cancelada', notes = btrim(p_reason), updated_at = now()
   where id = p_charge_id;
  perform public._ortho_log(v_ch.case_id, 'mensalidade_cancelada',
    'Mensalidade ' || to_char(v_ch.reference_month, 'MM/YYYY') || ' cancelada — ' || btrim(p_reason));
end;
$$;
revoke execute on function public.ortho_cancel_charge(uuid, text) from public, anon, authenticated;
grant execute on function public.ortho_cancel_charge(uuid, text) to authenticated;

-- Marca como ATRASADA o que venceu e não foi pago.
create or replace function public.ortho_refresh_delinquency(p_clinic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not (public.is_admin_master()
          or (p_clinic_id is not null and public.ortho_can_view(p_clinic_id))) then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.ortho_charges set status = 'atrasada', updated_at = now()
   where status = 'em_aberto' and due_date < public.today_br()
     and (p_clinic_id is null or clinic_id = p_clinic_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.ortho_refresh_delinquency(uuid) from public, anon, authenticated;
grant execute on function public.ortho_refresh_delinquency(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 14) CONFIGURAÇÃO: salvar a cascata
-- -----------------------------------------------------------------------------
create or replace function public.ortho_save_settings(
  p_clinic_id uuid,
  p_monthly_fee_cents integer,
  p_planned_months integer,
  p_interval_days integer,
  p_reevaluation_months integer,
  p_tolerance_days integer,
  p_maintenance_procedure_id uuid,
  p_billing_day integer
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
     billing_day, updated_by)
  values
    (p_clinic_id, coalesce(p_monthly_fee_cents, 0), coalesce(p_planned_months, 24),
     coalesce(p_interval_days, 30), coalesce(p_reevaluation_months, 6),
     coalesce(p_tolerance_days, 30), p_maintenance_procedure_id,
     coalesce(p_billing_day, 10), (select auth.uid()))
  on conflict (clinic_id) do update set
    monthly_fee_cents = excluded.monthly_fee_cents,
    planned_months = excluded.planned_months,
    maintenance_interval_days = excluded.maintenance_interval_days,
    reevaluation_interval_months = excluded.reevaluation_interval_months,
    finish_tolerance_days = excluded.finish_tolerance_days,
    maintenance_procedure_id = excluded.maintenance_procedure_id,
    billing_day = excluded.billing_day,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;
revoke execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 15) AS PERMISSÕES NA MATRIZ (semeadas: permissão sem linha não alcança ninguém)
-- -----------------------------------------------------------------------------
insert into public.permission_matrix (capability, role) values
  ('modulo.ortodontia', 'unit_manager'),
  ('modulo.ortodontia', 'clinical_coordinator'),
  ('modulo.ortodontia', 'receptionist'),
  ('modulo.ortodontia', 'franchisee'),
  ('modulo.ortodontia', 'franchisor_staff'),
  ('modulo.ortodontia', 'finance_franchisor'),
  ('modulo.ortodontia', 'dentist'),
  ('modulo.ortodontia.painel', 'unit_manager'),
  ('modulo.ortodontia.painel', 'clinical_coordinator'),
  ('modulo.ortodontia.painel', 'franchisee'),
  ('modulo.ortodontia.painel', 'franchisor_staff'),
  ('modulo.ortodontia.painel', 'finance_franchisor'),
  ('acao.ortodontia.gerir', 'unit_manager'),
  ('acao.ortodontia.gerir', 'clinical_coordinator'),
  ('acao.ortodontia.evoluir', 'dentist'),
  ('acao.ortodontia.evoluir', 'clinical_coordinator'),
  ('acao.ortodontia.financeiro', 'unit_manager'),
  ('acao.ortodontia.financeiro', 'receptionist'),
  ('acao.ortodontia.financeiro', 'franchisee'),
  ('acao.ortodontia.financeiro', 'franchisor_staff'),
  ('acao.ortodontia.financeiro', 'finance_franchisor')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 16) AUDITORIA (0288): as tabelas de cadastro novas entram; o histórico ficou fora
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.chart_of_accounts where code = '1.1.04') as conta_1_1_04,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('ortho_settings','ortho_cases','ortho_maintenances','ortho_charges','ortho_events'))
    as tabelas_novas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'ortho%') as funcoes_ortho,
  (select count(*) from public.permission_matrix where capability like '%ortodontia%') as permissoes_semeadas,
  (select count(*) from pg_trigger where tgname in ('appointments_ortho_sync','ortho_charges_ledger','ortho_cases_sync_client'))
    as gatilhos,
  (select count(*) from public.ortho_cases) as casos_hoje;
