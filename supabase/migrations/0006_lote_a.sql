-- =============================================================================
-- Risarte Odontologia — Migration 0006 (Lote A — run AFTER 0005)
-- 1. New clients enter Fase 1 (Aquisição)
-- 2. Role-based phase transition matrix inside move_client_phase()
-- 3. Unique client across the network: CPF unique index, clinic history,
--    duplicate detection and transfer function
-- 4. Appointments: assigned professional + notification trigger
-- 5. Colleague visibility (clinic members see each other's names/roles)
-- 6. Richer notifications (clinic, pillar, sender, origin phase)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New clients enter Aquisição
-- -----------------------------------------------------------------------------
alter table public.clients
  alter column journey_phase set default 'acquisition';

-- -----------------------------------------------------------------------------
-- 3a. CPF unique across the network (when present)
-- -----------------------------------------------------------------------------
create unique index clients_cpf_unique
  on public.clients (cpf)
  where cpf is not null;

-- -----------------------------------------------------------------------------
-- 3b. client_clinic_history: which unit served the client in each period
-- -----------------------------------------------------------------------------
create table public.client_clinic_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  transferred_by uuid references public.profiles (id) on delete set null,
  consent_registered boolean not null default false,
  created_at timestamptz not null default now()
);

create index client_clinic_history_client_idx
  on public.client_clinic_history (client_id, started_at);
create index client_clinic_history_clinic_idx
  on public.client_clinic_history (clinic_id);

-- Backfill: every existing client belongs to its clinic since registration.
insert into public.client_clinic_history (client_id, clinic_id, started_at, transferred_by)
select id, clinic_id, created_at, created_by from public.clients;

-- Keep history seeded for brand-new clients too.
create function public.handle_new_client_clinic_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.client_clinic_history (client_id, clinic_id, transferred_by)
  values (new.id, new.clinic_id, new.created_by);
  return new;
end;
$$;

create trigger on_client_created_clinic_history
  after insert on public.clients
  for each row execute function public.handle_new_client_clinic_history();

-- Helper: did any of my clinics ever serve this client?
create function public.user_has_client_history_access(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_clinic_history h
    where h.client_id = p_client_id
      and h.clinic_id in (select public.user_clinic_ids())
  );
$$;

alter table public.client_clinic_history enable row level security;

-- Visible to whoever can see the client (clients RLS applies in the subquery).
create policy "client_clinic_history_select"
  on public.client_clinic_history for select
  to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = client_clinic_history.client_id
    )
  );
-- Writes happen only via security-definer functions/triggers.

-- clients: former clinics keep (read) access to the client record.
drop policy "clients_select_member" on public.clients;
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_clinic_ids())
    or public.is_network_viewer()
    or public.user_has_client_history_access(id)
  );

-- -----------------------------------------------------------------------------
-- 3c. Duplicate detection (network-wide, bypasses RLS on purpose: the
-- receptionist must learn the client already exists in another unit)
-- -----------------------------------------------------------------------------
create function public.find_duplicate_client(
  p_cpf text,
  p_full_name text,
  p_birth_date date
)
returns table (
  client_id uuid,
  full_name text,
  clinic_id uuid,
  clinic_name text,
  match_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.full_name, c.clinic_id, cl.name, 'cpf'::text
  from public.clients c
  join public.clinics cl on cl.id = c.clinic_id
  where p_cpf is not null
    and c.cpf = p_cpf
    and c.status <> 'anonymized'
  union all
  select c.id, c.full_name, c.clinic_id, cl.name, 'name_birth'::text
  from public.clients c
  join public.clinics cl on cl.id = c.clinic_id
  where p_cpf is null
    and p_birth_date is not null
    and lower(c.full_name) = lower(p_full_name)
    and c.birth_date = p_birth_date
    and c.status <> 'anonymized'
  limit 5;
$$;

-- -----------------------------------------------------------------------------
-- 3d. Transfer a client to another unit (with registered consent)
-- -----------------------------------------------------------------------------
create function public.transfer_client(
  p_client_id uuid,
  p_target_clinic_id uuid,
  p_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_clinic uuid;
  v_client_name text;
  v_target_name text;
  v_user uuid := (select auth.uid());
begin
  if not coalesce(p_consent, false) then
    raise exception 'CONSENT_REQUIRED';
  end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_target_clinic_id, array['receptionist']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select clinic_id, full_name into v_old_clinic, v_client_name
  from public.clients where id = p_client_id;

  if v_old_clinic is null then
    raise exception 'CLIENT_NOT_FOUND';
  end if;
  if v_old_clinic = p_target_clinic_id then
    return;
  end if;

  update public.client_clinic_history
  set ended_at = now()
  where client_id = p_client_id and ended_at is null;

  insert into public.client_clinic_history
    (client_id, clinic_id, transferred_by, consent_registered)
  values (p_client_id, p_target_clinic_id, v_user, true);

  update public.clients
  set clinic_id = p_target_clinic_id
  where id = p_client_id;

  select name into v_target_name from public.clinics where id = p_target_clinic_id;

  -- Tell the former unit's reception.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_old_clinic,
         'Cliente transferido para outra unidade',
         v_client_name || ' agora é atendido(a) em ' || v_target_name,
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_old_clinic
    and ucr.role = 'receptionist'
    and ucr.user_id is distinct from v_user;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, p_target_clinic_id, 'update', 'client_transfer', p_client_id::text,
    jsonb_build_object('from_clinic', v_old_clinic, 'to_clinic', p_target_clinic_id, 'consent', true)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Appointments: assigned professional + notifications on create/change
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column provider_user_id uuid references public.profiles (id) on delete set null;

create index appointments_provider_idx
  on public.appointments (provider_user_id, starts_at);

create function public.handle_appointment_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_name text;
  v_clinic_name text;
  v_when text;
begin
  select full_name into v_client_name from public.clients where id = new.client_id;
  select name into v_clinic_name from public.clinics where id = new.clinic_id;
  v_when := to_char(new.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');

  if tg_op = 'INSERT' then
    if new.provider_user_id is not null
       and new.provider_user_id is distinct from new.created_by then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (
        new.provider_user_id, new.clinic_id,
        'Novo agendamento para você',
        v_client_name || ' · ' || v_clinic_name || ' · ' || v_when,
        '/agenda'
      );
    end if;
  elsif tg_op = 'UPDATE' then
    if new.provider_user_id is not null and (
      old.starts_at is distinct from new.starts_at
      or old.status is distinct from new.status
      or old.provider_user_id is distinct from new.provider_user_id
      or old.type is distinct from new.type
    ) then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (
        new.provider_user_id, new.clinic_id,
        'Agendamento alterado',
        v_client_name || ' · ' || v_clinic_name || ' · ' || v_when,
        '/agenda'
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger on_appointment_change
  after insert or update on public.appointments
  for each row execute function public.handle_appointment_notifications();

-- -----------------------------------------------------------------------------
-- 5. Colleague visibility inside the same clinic
-- -----------------------------------------------------------------------------
create function public.shares_clinic_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_clinic_roles a
    join public.user_clinic_roles b on b.clinic_id = a.clinic_id
    where a.user_id = p_user_id
      and b.user_id = (select auth.uid())
  );
$$;

create policy "profiles_select_colleagues"
  on public.profiles for select
  to authenticated
  using (public.shares_clinic_with(id));

create policy "user_clinic_roles_select_clinic_members"
  on public.user_clinic_roles for select
  to authenticated
  using (clinic_id in (select public.user_clinic_ids()));

-- Clinic names/addresses are network-public (needed for "transferred to X",
-- duplicate warnings and network views).
drop policy "clinics_select_member_or_admin" on public.clinics;
create policy "clinics_select_authenticated"
  on public.clinics for select
  to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- 2 + 6. move_client_phase(): role-based transition matrix + richer
-- notifications (clinic, pillar, sender with role, origin phase)
-- -----------------------------------------------------------------------------
create or replace function public.move_client_phase(
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
  v_pillar public.methodology_pillar;
  v_user uuid := (select auth.uid());
  v_allowed boolean;
  v_title text;
  v_body text;
  v_clinic_name text;
  v_sender_name text;
  v_sender_role text;
  v_phase_label text;
  v_pillar_label text;
begin
  select clinic_id, journey_phase, full_name, methodology_pillar
    into v_clinic, v_old, v_client_name, v_pillar
  from public.clients
  where id = p_client_id;

  if v_clinic is null then
    raise exception 'CLIENT_NOT_FOUND';
  end if;
  if v_old = p_new_phase then
    return;
  end if;

  -- Transition matrix (Admin Master may do anything).
  v_allowed := public.is_admin_master();
  if not v_allowed then
    v_allowed := case
      when v_old = 'acquisition' and p_new_phase = 'clinical_conversion'
        then public.has_role_in_clinic(v_clinic, array['receptionist']::public.user_role[])
      when v_old = 'clinical_conversion' and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'planning_center' and p_new_phase = 'commercial_conversion'
        -- Planner works at the franchisor's Planning Center, not at the unit.
        then exists (
          select 1 from public.user_clinic_roles ucr
          where ucr.user_id = v_user and ucr.role = 'planner_dentist'
        )
      when v_old = 'commercial_conversion' and p_new_phase = 'treatment_start'
        then public.has_role_in_clinic(v_clinic, array['commercial_consultant']::public.user_role[])
      when v_old = 'treatment_start' and p_new_phase in ('reevaluation', 'follow_up')
        then public.has_role_in_clinic(v_clinic, array['receptionist']::public.user_role[])
      when v_old = 'treatment_start' and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'reevaluation' and p_new_phase in ('follow_up', 'planning_center')
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      else false
    end;
  end if;

  if not v_allowed then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.journey_phase_history
  set exited_at = now()
  where client_id = p_client_id and exited_at is null;

  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (p_client_id, v_clinic, p_new_phase, v_user);

  update public.clients
  set journey_phase = p_new_phase, phase_entered_at = now()
  where id = p_client_id;

  -- Rich notification body: client · clinic · pillar · origin phase · sender.
  select name into v_clinic_name from public.clinics where id = v_clinic;
  select full_name into v_sender_name from public.profiles where id = v_user;

  select case ucr.role
      when 'receptionist' then 'Recepcionista'
      when 'clinical_coordinator' then 'Coordenador Clínico'
      when 'planner_dentist' then 'Dentista Planner'
      when 'dentist' then 'Dentista'
      when 'commercial_consultant' then 'Consultor Comercial'
      when 'commercial_assistant' then 'Assistente Comercial'
      when 'unit_manager' then 'Gerente de Unidade'
      when 'franchisor_staff' then 'Franqueadora'
      when 'franchisee' then 'Franqueado'
    end
    into v_sender_role
  from public.user_clinic_roles ucr
  where ucr.user_id = v_user
    and (ucr.clinic_id = v_clinic or ucr.role = 'planner_dentist')
  order by case when ucr.clinic_id = v_clinic then 0 else 1 end
  limit 1;

  if v_sender_role is null and public.is_admin_master() then
    v_sender_role := 'Admin Master';
  end if;

  v_phase_label := case v_old
    when 'acquisition' then 'Aquisição'
    when 'clinical_conversion' then 'Conversão Clínica'
    when 'planning_center' then 'Centro de Planejamento'
    when 'commercial_conversion' then 'Conversão Comercial'
    when 'treatment_start' then 'Início de Tratamento'
    when 'reevaluation' then 'Reavaliação'
    when 'follow_up' then 'Acompanhamento'
  end;

  v_pillar_label := coalesce(case v_pillar
    when 'diagnosis' then 'Diagnóstico'
    when 'planning' then 'Planejamento'
    when 'health' then 'Saúde'
    when 'function' then 'Função'
    when 'aesthetics' then 'Estética'
    when 'prevention' then 'Prevenção'
  end, 'a definir');

  v_body := v_client_name
    || ' · Clínica: ' || coalesce(v_clinic_name, '—')
    || ' · Pilar: ' || v_pillar_label
    || ' · Veio de: ' || coalesce(v_phase_label, '—')
    || ' · Por: ' || coalesce(v_sender_name, '—')
    || coalesce(' (' || v_sender_role || ')', '');

  if p_new_phase = 'planning_center' then
    v_title := 'Novo caso no Centro de Planejamento';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title, v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;

  elsif p_new_phase = 'commercial_conversion' then
    v_title := 'Caso pronto para apresentação comercial';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title, v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('commercial_consultant', 'commercial_assistant')
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'treatment_start' then
    v_title := 'Fechamento! Agendar início de tratamento';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title, v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'receptionist'
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'reevaluation' then
    v_title := 'Cliente em reavaliação';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title, v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'clinical_coordinator'
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'follow_up' then
    v_title := 'Cliente em acompanhamento';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title, v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'receptionist'
      and ucr.user_id <> v_user;

  elsif p_new_phase = 'clinical_conversion' then
    v_title := 'Cliente em conversão clínica';
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_title, v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'clinical_coordinator'
      and ucr.user_id <> v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, v_clinic, 'update', 'client_journey', p_client_id::text,
    jsonb_build_object('from', v_old, 'to', p_new_phase)
  );
end;
$$;
