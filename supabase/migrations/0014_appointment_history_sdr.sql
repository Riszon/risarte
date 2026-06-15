-- =============================================================================
-- Risarte Odontologia — Migration 0014
-- 1. appointment_changes: user-facing history of appointment changes
-- 2. handle_appointment_notifications: log changes + provider/SDR notifications
-- 3. move_client_phase: schedule notification links to /agenda?cliente=<id>
--    and goes only to the Recepcionista (not the SDR)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. appointment_changes (readable by whoever can see the client)
-- -----------------------------------------------------------------------------
create table public.appointment_changes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  description text not null
);

create index appointment_changes_client_idx
  on public.appointment_changes (client_id, changed_at);

alter table public.appointment_changes enable row level security;

create policy "appointment_changes_select"
  on public.appointment_changes for select
  to authenticated
  using (
    public.is_admin_master()
    or exists (
      select 1 from public.clients c where c.id = appointment_changes.client_id
    )
  );
-- Inserts happen only via the security-definer trigger below.

-- -----------------------------------------------------------------------------
-- 2. handle_appointment_notifications: history + provider + SDR notifications
-- -----------------------------------------------------------------------------
create or replace function public.handle_appointment_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_name text;
  v_clinic_name text;
  v_when text;
  v_actor uuid := (select auth.uid());
  v_client_creator uuid;
  v_creator_is_sdr boolean := false;
  v_desc text;
  v_changes text[] := array[]::text[];
begin
  select full_name, created_by into v_client_name, v_client_creator
  from public.clients where id = new.client_id;
  select name into v_clinic_name from public.clinics where id = new.clinic_id;
  v_when := to_char(new.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');

  if v_client_creator is not null then
    select exists (
      select 1 from public.user_clinic_roles
      where user_id = v_client_creator and role = 'sdr'
    ) into v_creator_is_sdr;
  end if;

  if tg_op = 'INSERT' then
    insert into public.appointment_changes
      (appointment_id, client_id, clinic_id, changed_by, description)
    values (new.id, new.client_id, new.clinic_id, v_actor,
            'Agendamento criado — ' || v_when);

    if new.provider_user_id is not null
       and new.provider_user_id is distinct from new.created_by then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (new.provider_user_id, new.clinic_id, 'Novo agendamento para você',
              v_client_name || ' — ' || v_clinic_name || ' — ' || v_when, '/agenda');
    end if;
    return new;
  end if;

  -- UPDATE: describe what changed
  if old.starts_at is distinct from new.starts_at then
    v_changes := array_append(v_changes, 'horário para ' || v_when);
  end if;
  if old.type is distinct from new.type then
    v_changes := array_append(v_changes, 'tipo de atendimento');
  end if;
  if old.provider_user_id is distinct from new.provider_user_id then
    v_changes := array_append(v_changes, 'profissional responsável');
  end if;
  if old.status is distinct from new.status then
    v_changes := array_append(v_changes, 'status para ' || (case new.status
      when 'scheduled' then 'Agendado'
      when 'confirmed' then 'Confirmado'
      when 'completed' then 'Realizado'
      when 'cancelled' then 'Cancelado'
      when 'no_show' then 'Faltou'
      else new.status::text end));
  end if;

  if array_length(v_changes, 1) is null then
    return new;
  end if;

  v_desc := 'Alterado: ' || array_to_string(v_changes, ', ');

  insert into public.appointment_changes
    (appointment_id, client_id, clinic_id, changed_by, description)
  values (new.id, new.client_id, new.clinic_id, v_actor, v_desc);

  -- Notify the assigned professional on relevant changes (not self).
  if new.provider_user_id is not null
     and new.provider_user_id is distinct from v_actor then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (new.provider_user_id, new.clinic_id, 'Agendamento alterado',
            v_client_name || ' — ' || v_clinic_name || ' — ' || v_when, '/agenda');
  end if;

  -- SDR (who registered the client) notifications.
  if v_creator_is_sdr and v_client_creator is distinct from v_actor then
    if old.status is distinct from new.status and new.status = 'no_show' then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_client_creator, new.clinic_id, 'Seu cliente faltou',
              v_client_name || ' faltou — ' || v_clinic_name || ' — ' || v_when,
              '/clientes/' || new.client_id);
    else
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_client_creator, new.clinic_id,
              'Agendamento do seu cliente foi alterado',
              v_client_name || ' — ' || v_desc, '/clientes/' || new.client_id);
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. move_client_phase: schedule notifications link to the pre-filled agenda
--    and go only to the Recepcionista (the SDR has her own notifications).
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
  from public.clients where id = p_client_id;

  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if v_old = p_new_phase then return; end if;

  v_allowed := public.is_admin_master();
  if not v_allowed then
    v_allowed := case
      when v_old = 'acquisition' and p_new_phase = 'clinical_conversion'
        then public.has_role_in_clinic(v_clinic, array['receptionist','sdr']::public.user_role[])
      when v_old = 'clinical_conversion' and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'planning_center' and p_new_phase = 'commercial_conversion'
        then exists (select 1 from public.user_clinic_roles ucr where ucr.user_id = v_user and ucr.role = 'planner_dentist')
      when v_old = 'planning_center' and p_new_phase in ('clinical_conversion', 'reevaluation')
        then exists (select 1 from public.user_clinic_roles ucr where ucr.user_id = v_user and ucr.role = 'planner_dentist')
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

  if not v_allowed then raise exception 'NOT_ALLOWED'; end if;

  update public.journey_phase_history set exited_at = now()
  where client_id = p_client_id and exited_at is null;
  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (p_client_id, v_clinic, p_new_phase, v_user);
  update public.clients set journey_phase = p_new_phase, phase_entered_at = now()
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
    end into v_sender_role
  from public.user_clinic_roles ucr
  where ucr.user_id = v_user and (ucr.clinic_id = v_clinic or ucr.role = 'planner_dentist')
  order by case when ucr.clinic_id = v_clinic then 0 else 1 end limit 1;

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
    when 'diagnosis' then 'Diagnóstico' when 'planning' then 'Planejamento'
    when 'health' then 'Saúde' when 'function' then 'Função'
    when 'aesthetics' then 'Estética' when 'prevention' then 'Prevenção'
  end, 'a definir');

  v_body := v_client_name
    || ' — Clínica: ' || coalesce(v_clinic_name, '—')
    || ' — Pilar: ' || v_pillar_label
    || ' — Veio de: ' || coalesce(v_phase_label, '—')
    || ' — Por: ' || coalesce(nullif(v_sender_name, ''), '—')
    || coalesce(' (' || v_sender_role || ')', '');

  if p_new_phase = 'planning_center' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Novo caso no Centro de Planejamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'commercial_conversion' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Caso pronto para apresentação comercial', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic
      and ucr.role in ('commercial_consultant', 'commercial_assistant') and ucr.user_id <> v_user;
  elsif p_new_phase = 'treatment_start' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Fechamento! Agendar início de tratamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'reevaluation' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em reavaliação', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator' and ucr.user_id <> v_user;
  elsif p_new_phase = 'follow_up' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em acompanhamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'clinical_conversion' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em conversão clínica', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator' and ucr.user_id <> v_user;
  end if;

  -- Reception is asked to schedule the next step — link opens the agenda with
  -- the client pre-filled.
  v_schedule_hint := case p_new_phase
    when 'clinical_conversion' then 'Agendar avaliação'
    when 'commercial_conversion' then 'Agendar apresentação comercial'
    when 'reevaluation' then 'Agendar reavaliação'
    else null
  end;

  if v_schedule_hint is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_schedule_hint || ': ' || v_client_name, v_body,
           '/agenda?cliente=' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'client_journey', p_client_id::text,
          jsonb_build_object('from', v_old, 'to', p_new_phase));
end;
$$;
