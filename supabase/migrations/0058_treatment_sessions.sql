-- =============================================================================
-- 0058 — Sessões do tratamento a agendar (Procedimentos E4)
-- -----------------------------------------------------------------------------
-- Quando o cliente entra em Início de Tratamento (Fase 5), o sistema gera as
-- SESSÕES a agendar a partir da opção principal aprovada do plano (uma linha por
-- sessão planejada, com o tempo de cada uma). A Recepção agenda cada sessão; o
-- vínculo com o agendamento e o controle de execução vêm a seguir (E4b/E5).
-- Idempotente.
-- =============================================================================

create table if not exists public.treatment_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  plan_id uuid references public.treatment_plans (id) on delete set null,
  item_id uuid references public.treatment_plan_option_items (id) on delete set null,
  procedure_id uuid references public.procedures (id),
  procedure_name text not null,
  session_index int not null,
  session_total int not null,
  name text,
  planned_minutes int,
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'done')),
  appointment_id uuid references public.appointments (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists treatment_sessions_client_idx
  on public.treatment_sessions (client_id, status);
alter table public.treatment_sessions enable row level security;

-- Vínculo do agendamento com a sessão (usado na E4b).
alter table public.appointments
  add column if not exists treatment_session_id uuid
    references public.treatment_sessions (id) on delete set null;

-- -----------------------------------------------------------------------------
-- RLS — leitura: equipe da unidade (admin/escopo/planner/dentista/coordenador/
-- recepção). Escrita: admin, recepção ou coordenador da unidade.
-- -----------------------------------------------------------------------------
drop policy if exists "treatment_sessions_select" on public.treatment_sessions;
create policy "treatment_sessions_select" on public.treatment_sessions
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator','receptionist']::public.user_role[])
  );

drop policy if exists "treatment_sessions_write" on public.treatment_sessions;
create policy "treatment_sessions_write" on public.treatment_sessions
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','clinical_coordinator','dentist']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','clinical_coordinator','dentist']::public.user_role[])
  );

-- -----------------------------------------------------------------------------
-- ensure_treatment_sessions: gera (idempotente) as sessões da opção principal
-- aprovada quando o cliente está na Fase 5 e ainda não tem sessões.
-- -----------------------------------------------------------------------------
create or replace function public.ensure_treatment_sessions(p_client_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_phase text;
  v_plan uuid;
  v_option uuid;
begin
  select clinic_id, journey_phase::text into v_clinic, v_phase
  from public.clients where id = p_client_id;
  if v_clinic is null then return; end if;
  if not (
    public.is_admin_master()
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.user_id = (select auth.uid())
    )
  ) then
    return;
  end if;
  if v_phase <> 'treatment_start' then return; end if;
  if exists (select 1 from public.treatment_sessions where client_id = p_client_id) then
    return;
  end if;

  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;
  if v_plan is null then return; end if;

  select id into v_option from public.treatment_plan_options
  where plan_id = v_plan and review_status = 'approved'
  order by is_primary desc, sort_order asc limit 1;
  if v_option is null then
    select id into v_option from public.treatment_plan_options
    where plan_id = v_plan order by is_primary desc, sort_order asc limit 1;
  end if;
  if v_option is null then return; end if;

  insert into public.treatment_sessions
    (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
     session_index, session_total, name, planned_minutes)
  select p_client_id, v_clinic, v_plan, i.id, i.procedure_id,
    coalesce(p.name, i.description),
    gs.idx,
    coalesce(i.planned_sessions, 1),
    'Sessão ' || gs.idx || ' de ' || coalesce(i.planned_sessions, 1),
    case
      when coalesce(i.planned_sessions, 1) > 0 and i.planned_total_minutes is not null
      then round(i.planned_total_minutes::numeric / coalesce(i.planned_sessions, 1))::int
      else null
    end
  from public.treatment_plan_option_items i
  left join public.procedures p on p.id = i.procedure_id
  cross join lateral generate_series(1, coalesce(i.planned_sessions, 1)) as gs(idx)
  where i.option_id = v_option;
end $$;

grant execute on function public.ensure_treatment_sessions(uuid) to authenticated;
