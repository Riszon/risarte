-- =============================================================================
-- Risarte Odontologia — Migration 0004
-- Client journey state machine (phases + time tracking), appointments,
-- notifications, and the move_client_phase() transition function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
-- Fase 1 (Aquisição) is out of scope; clients enter at Conversão Clínica.
create type public.journey_phase as enum (
  'clinical_conversion',   -- FASE 2
  'planning_center',       -- FASE 3 (núcleo)
  'commercial_conversion', -- FASE 4
  'treatment_start',       -- FASE 5
  'reevaluation',          -- FASE 6
  'follow_up'              -- FASE 7
);

-- Metodologia Risarte. Set by the Planner from stage 5 on; nullable until then.
create type public.methodology_pillar as enum (
  'diagnosis', 'planning', 'health', 'function', 'aesthetics', 'prevention'
);

create type public.appointment_type as enum (
  'evaluation',
  'commercial_presentation',
  'treatment_start',
  'treatment_session',
  'reevaluation',
  'return_visit'
);

create type public.appointment_status as enum (
  'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'
);

-- -----------------------------------------------------------------------------
-- clients: current phase (denormalized for fast kanban) + current pillar
-- -----------------------------------------------------------------------------
alter table public.clients
  add column journey_phase public.journey_phase not null default 'clinical_conversion',
  add column phase_entered_at timestamptz not null default now(),
  add column methodology_pillar public.methodology_pillar;

update public.clients set phase_entered_at = created_at;

create index clients_phase_idx on public.clients (clinic_id, journey_phase);

-- -----------------------------------------------------------------------------
-- journey_phase_history: automatic time tracking per phase
-- -----------------------------------------------------------------------------
create table public.journey_phase_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  phase public.journey_phase not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  moved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index journey_history_client_idx
  on public.journey_phase_history (client_id, entered_at);

alter table public.journey_phase_history enable row level security;

create policy "journey_history_select_member"
  on public.journey_phase_history for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_clinic_ids())
    or public.is_network_viewer()
  );
-- No insert/update/delete policies: rows are written exclusively by
-- move_client_phase() and the new-client trigger (security definer).

-- Backfill: one open history row per existing client.
insert into public.journey_phase_history (client_id, clinic_id, phase, entered_at, moved_by)
select id, clinic_id, journey_phase, created_at, created_by
from public.clients;

-- Seed history automatically when a client is created.
create function public.handle_new_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (new.id, new.clinic_id, new.journey_phase, new.created_by);
  return new;
end;
$$;

create trigger on_client_created
  after insert on public.clients
  for each row execute function public.handle_new_client();

-- -----------------------------------------------------------------------------
-- appointments (agenda)
-- -----------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  type public.appointment_type not null,
  status public.appointment_status not null default 'scheduled',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index appointments_clinic_time_idx on public.appointments (clinic_id, starts_at);
create index appointments_client_idx on public.appointments (client_id, starts_at);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;

-- Every clinic member sees the agenda (matrix: "ver agenda" for all roles).
create policy "appointments_select_member"
  on public.appointments for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_clinic_ids())
    or public.is_network_viewer()
  );

-- Only the receptionist schedules (matrix) — plus Admin Master.
create policy "appointments_insert_receptionist"
  on public.appointments for insert
  to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
  );

create policy "appointments_update_receptionist"
  on public.appointments for update
  to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
  );
-- No delete: cancellation is a status change (keeps history).

-- -----------------------------------------------------------------------------
-- notifications (internal, per user)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  clinic_id uuid references public.clinics (id) on delete cascade,
  title text not null,
  body text,
  link text, -- app-relative URL, e.g. /clientes/<id>
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read_at, created_at);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Mark as read (only your own; only read_at effectively changes via app).
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No insert policy: notifications are created by security-definer functions.

-- -----------------------------------------------------------------------------
-- move_client_phase(): THE journey transition. Updates the client, closes the
-- open history row, opens a new one, notifies the role responsible for the
-- next step and writes the audit log — all in one transaction.
-- -----------------------------------------------------------------------------
create function public.move_client_phase(
  p_client_id uuid,
  p_new_phase public.journey_phase
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_old public.journey_phase;
  v_client_name text;
  v_user uuid := (select auth.uid());
  v_title text;
begin
  select clinic_id, journey_phase, full_name
    into v_clinic, v_old, v_client_name
  from public.clients
  where id = p_client_id;

  if v_clinic is null then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
      v_clinic,
      array[
        'receptionist','clinical_coordinator','planner_dentist',
        'commercial_consultant','commercial_assistant'
      ]::public.user_role[]
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_old = p_new_phase then
    return;
  end if;

  update public.journey_phase_history
  set exited_at = now()
  where client_id = p_client_id and exited_at is null;

  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (p_client_id, v_clinic, p_new_phase, v_user);

  update public.clients
  set journey_phase = p_new_phase, phase_entered_at = now()
  where id = p_client_id;

  -- Notify the role responsible for the next step (never the user who moved).
  if p_new_phase = 'planning_center' then
    v_title := 'Novo caso no Centro de Planejamento';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title,
           v_client_name, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;

  elsif p_new_phase = 'commercial_conversion' then
    v_title := 'Caso pronto para apresentação comercial';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title,
           v_client_name, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('commercial_consultant', 'commercial_assistant')
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'treatment_start' then
    v_title := 'Fechamento! Agendar início de tratamento';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title,
           v_client_name, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'receptionist'
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'reevaluation' then
    v_title := 'Cliente em reavaliação';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title,
           v_client_name, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'clinical_coordinator'
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'follow_up' then
    v_title := 'Cliente em acompanhamento';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title,
           v_client_name, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'receptionist'
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'clinical_conversion' then
    v_title := 'Cliente retornou para conversão clínica';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title,
           v_client_name, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'clinical_coordinator'
      and ucr.user_id <> v_user;
  end if;

  -- LGPD audit trail (ids only).
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, v_clinic, 'update', 'client_journey', p_client_id::text,
    jsonb_build_object('from', v_old, 'to', p_new_phase)
  );
end;
$$;
