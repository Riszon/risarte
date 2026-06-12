-- =============================================================================
-- Risarte Odontologia — Migration 0008 (Lote A.2 — run AFTER 0007)
-- 1. Fix: profiles_update_own policy caused "infinite recursion"
-- 2. Clinic codes + client codes (unit + sequential)
-- 3. Guardians (responsáveis) for minors + CPF lookup
-- 4. SDR in policies and in the transition matrix; reception/SDR scheduling
--    notifications on phase moves
-- 5. Transfer: cancel future appointments, notify manager/coordinator too
-- 6. Dentist sees only their own patients/appointments
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fix infinite recursion when updating own profile
-- -----------------------------------------------------------------------------
drop policy "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    -- A user must not change their own Admin Master flag
    -- (definer function avoids self-referencing recursion):
    and is_admin_master = public.is_admin_master()
  );

-- -----------------------------------------------------------------------------
-- 2a. Clinic code (short identifier used in client codes)
-- -----------------------------------------------------------------------------
alter table public.clinics add column code text;

-- Auto-generate codes for existing clinics: first 3 letters of the most
-- significant word, deduplicated with a numeric suffix when needed.
with base as (
  select id,
         upper(substr(regexp_replace(coalesce(nullif(regexp_replace(name, '(?i)risarte', '', 'g'), ''), name), '[^a-zA-Z]', '', 'g'), 1, 3)) as raw,
         row_number() over (
           partition by upper(substr(regexp_replace(coalesce(nullif(regexp_replace(name, '(?i)risarte', '', 'g'), ''), name), '[^a-zA-Z]', '', 'g'), 1, 3))
           order by created_at
         ) as rn
  from public.clinics
)
update public.clinics c
set code = case when b.rn = 1 then b.raw else b.raw || b.rn end
from base b
where b.id = c.id;

alter table public.clinics alter column code set not null;
alter table public.clinics add constraint clinics_code_unique unique (code);

-- -----------------------------------------------------------------------------
-- 2b. Client code: CLINICCODE-00001, sequential per registering unit.
--     Immutable: keeps the unit where the client was first registered.
-- -----------------------------------------------------------------------------
alter table public.clients add column code text;

create table public.clinic_client_counters (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  last_value integer not null default 0
);

alter table public.clinic_client_counters enable row level security;
-- No policies: only security-definer functions touch this table.

create function public.next_client_code(p_clinic_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq integer;
  v_clinic_code text;
begin
  insert into public.clinic_client_counters (clinic_id, last_value)
  values (p_clinic_id, 1)
  on conflict (clinic_id)
  do update set last_value = public.clinic_client_counters.last_value + 1
  returning last_value into v_seq;

  select code into v_clinic_code from public.clinics where id = p_clinic_id;
  return coalesce(v_clinic_code, 'RIS') || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

create function public.handle_new_client_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := public.next_client_code(new.clinic_id);
  end if;
  return new;
end;
$$;

create trigger on_client_created_code
  before insert on public.clients
  for each row execute function public.handle_new_client_code();

-- Backfill codes for existing clients, in registration order.
do $$
declare
  r record;
begin
  for r in
    select id, clinic_id from public.clients order by created_at
  loop
    update public.clients
    set code = public.next_client_code(r.clinic_id)
    where id = r.id and code is null;
  end loop;
end;
$$;

create unique index clients_code_unique on public.clients (code);

-- -----------------------------------------------------------------------------
-- 3. Guardians (responsáveis) for minors
-- -----------------------------------------------------------------------------
create table public.client_guardians (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  -- filled when the guardian is also a Risarte client:
  guardian_client_id uuid references public.clients (id) on delete set null,
  full_name text not null,
  cpf text,
  birth_date date,
  relationship text not null, -- mãe, pai, avó, tutor...
  phone text,
  created_at timestamptz not null default now()
);

create index client_guardians_client_idx on public.client_guardians (client_id);
create index client_guardians_guardian_idx
  on public.client_guardians (guardian_client_id);

alter table public.client_guardians enable row level security;

-- Visible to whoever can see the minor OR the guardian's own record.
create policy "client_guardians_select"
  on public.client_guardians for select
  to authenticated
  using (
    exists (select 1 from public.clients c where c.id = client_id)
    or (
      guardian_client_id is not null
      and exists (select 1 from public.clients g where g.id = guardian_client_id)
    )
  );

-- Maintained by whoever can register clients in the minor's clinic.
create policy "client_guardians_write"
  on public.client_guardians for all
  to authenticated
  using (
    public.is_admin_master()
    or exists (
      select 1 from public.clients c
      where c.id = client_id
        and public.has_role_in_clinic(
          c.clinic_id, array['receptionist','sdr']::public.user_role[]
        )
    )
  )
  with check (
    public.is_admin_master()
    or exists (
      select 1 from public.clients c
      where c.id = client_id
        and public.has_role_in_clinic(
          c.clinic_id, array['receptionist','sdr']::public.user_role[]
        )
    )
  );

-- CPF lookup for guardian autofill (minimal fields, network-wide on purpose:
-- reception needs to find guardians registered at any unit).
create function public.find_client_basic_by_cpf(p_cpf text)
returns table (
  client_id uuid,
  full_name text,
  birth_date date,
  phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.full_name, c.birth_date, c.phone
  from public.clients c
  where c.cpf = p_cpf and c.status <> 'anonymized'
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 4. SDR: may register clients and schedule (same as reception)
-- -----------------------------------------------------------------------------
drop policy "clients_insert_receptionist" on public.clients;
create policy "clients_insert_receptionist"
  on public.clients for insert
  to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','sdr']::public.user_role[])
  );

drop policy "clients_update_receptionist" on public.clients;
create policy "clients_update_receptionist"
  on public.clients for update
  to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','sdr']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','sdr']::public.user_role[])
  );

drop policy "appointments_insert_receptionist" on public.appointments;
create policy "appointments_insert_receptionist"
  on public.appointments for insert
  to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','sdr']::public.user_role[])
  );

drop policy "appointments_update_receptionist" on public.appointments;
create policy "appointments_update_receptionist"
  on public.appointments for update
  to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','sdr']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist','sdr']::public.user_role[])
  );

-- Transfers can also be received by the SDR.
create or replace function public.transfer_client(
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
  v_cancelled_count integer := 0;
  v_cancelled_list text := '';
begin
  if not coalesce(p_consent, false) then
    raise exception 'CONSENT_REQUIRED';
  end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_target_clinic_id, array['receptionist','sdr']::public.user_role[])
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

  -- 5. Cancel future appointments at the former unit and keep a readable
  --    list for the receiving unit's notification.
  with cancelled as (
    update public.appointments
    set status = 'cancelled'
    where client_id = p_client_id
      and clinic_id = v_old_clinic
      and starts_at > now()
      and status in ('scheduled', 'confirmed')
    returning starts_at, type
  )
  select count(*),
         coalesce(string_agg(
           to_char(starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
           ', ' order by starts_at
         ), '')
    into v_cancelled_count, v_cancelled_list
  from cancelled;

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

  -- Notify reception, manager AND clinical coordinator of the losing unit.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_old_clinic,
         'Cliente transferido para outra unidade',
         v_client_name || ' agora é atendido(a) em ' || v_target_name
           || case when v_cancelled_count > 0
              then '. Agendamentos futuros cancelados: ' || v_cancelled_list
              else '' end,
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_old_clinic
    and ucr.role in ('receptionist', 'unit_manager', 'clinical_coordinator')
    and ucr.user_id is distinct from v_user;

  -- Tell the receiving unit about cancelled slots that may need rescheduling.
  if v_cancelled_count > 0 then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, p_target_clinic_id,
           'Reagendar cliente transferido',
           v_client_name || ' tinha ' || v_cancelled_count
             || ' agendamento(s) cancelado(s) na unidade anterior: '
             || v_cancelled_list || '. Verifique se precisa reagendar.',
           '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = p_target_clinic_id
      and ucr.role in ('receptionist', 'sdr');
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, p_target_clinic_id, 'update', 'client_transfer', p_client_id::text,
    jsonb_build_object(
      'from_clinic', v_old_clinic, 'to_clinic', p_target_clinic_id,
      'consent', true, 'cancelled_appointments', v_cancelled_count
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Dentist sees only their own patients/appointments
-- -----------------------------------------------------------------------------
-- Clinics where the user has any role beyond 'dentist' (full clinic access).
create function public.user_full_access_clinic_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ucr.clinic_id
  from public.user_clinic_roles ucr
  where ucr.user_id = (select auth.uid())
    and ucr.role <> 'dentist';
$$;

drop policy "clients_select_member" on public.clients;
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.user_has_client_history_access(id)
    -- dentist-only members: just the clients scheduled with them
    or exists (
      select 1 from public.appointments a
      where a.client_id = clients.id
        and a.provider_user_id = (select auth.uid())
    )
  );

drop policy "appointments_select_member" on public.appointments;
create policy "appointments_select_member"
  on public.appointments for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or provider_user_id = (select auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 4b. Transition matrix update (SDR: 1→2 and 7→6) + scheduling notifications
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
  v_schedule_hint text;
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

  v_allowed := public.is_admin_master();
  if not v_allowed then
    v_allowed := case
      when v_old = 'acquisition' and p_new_phase = 'clinical_conversion'
        then public.has_role_in_clinic(v_clinic, array['receptionist','sdr']::public.user_role[])
      when v_old = 'clinical_conversion' and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'planning_center' and p_new_phase = 'commercial_conversion'
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
      when v_old = 'follow_up' and p_new_phase = 'reevaluation'
        then public.has_role_in_clinic(v_clinic, array['sdr']::public.user_role[])
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

  select name into v_clinic_name from public.clinics where id = v_clinic;
  select full_name into v_sender_name from public.profiles where id = v_user;

  select case ucr.role
      when 'receptionist' then 'Recepcionista'
      when 'sdr' then 'Encantador(a) (SDR)'
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
    || ' · Por: ' || coalesce(nullif(v_sender_name, ''), '—')
    || coalesce(' (' || v_sender_role || ')', '');

  -- Role responsible for the next step.
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

  -- Reception/SDR must also be told to SCHEDULE the next step.
  v_schedule_hint := case p_new_phase
    when 'clinical_conversion' then 'Agendar avaliação'
    when 'commercial_conversion' then 'Agendar apresentação comercial'
    when 'reevaluation' then 'Agendar reavaliação'
    else null
  end;

  if v_schedule_hint is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic,
           v_schedule_hint || ': ' || v_client_name,
           v_body, '/agenda'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('receptionist', 'sdr')
      and ucr.user_id <> v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, v_clinic, 'update', 'client_journey', p_client_id::text,
    jsonb_build_object('from', v_old, 'to', p_new_phase)
  );
end;
$$;
