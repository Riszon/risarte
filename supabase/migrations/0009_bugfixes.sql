-- =============================================================================
-- Risarte Odontologia — Migration 0009 (bug fixes after Lote A.2 testing)
-- 1. Dentist was seeing ALL clients of the clinic (via client-history access)
-- 2. Dentista Planner could not open client records / journey
-- 3. Notification texts stored garbled (clipboard re-encoding) — recreate the
--    three notification-generating functions with correct UTF-8 text and
--    clear the old garbled test notifications
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Former-clinic access must NOT apply to dentist-only members.
--    (user_clinic_ids includes dentist clinics; switch to full-access set.)
-- -----------------------------------------------------------------------------
create or replace function public.user_has_client_history_access(p_client_id uuid)
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
      and h.clinic_id in (select public.user_full_access_clinic_ids())
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. Dentista Planner works at the network Planning Center and must be able to
--    read clients, journey history and appointments across the whole network.
-- -----------------------------------------------------------------------------
create or replace function public.is_planner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_clinic_roles ucr
    where ucr.user_id = (select auth.uid())
      and ucr.role = 'planner_dentist'
  );
$$;

drop policy if exists "clients_select_member" on public.clients;
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.is_planner()
    or public.user_has_client_history_access(id)
    or exists (
      select 1 from public.appointments a
      where a.client_id = clients.id
        and a.provider_user_id = (select auth.uid())
    )
  );

drop policy if exists "journey_history_select_member" on public.journey_phase_history;
create policy "journey_history_select_member"
  on public.journey_phase_history for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_clinic_ids())
    or public.is_network_viewer()
    or public.is_planner()
  );

drop policy if exists "appointments_select_member" on public.appointments;
create policy "appointments_select_member"
  on public.appointments for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.is_planner()
    or provider_user_id = (select auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 3. Clear old garbled test notifications (text only — safe).
-- -----------------------------------------------------------------------------
delete from public.notifications;

-- -----------------------------------------------------------------------------
-- 3b. Recreate notification-generating functions with correct UTF-8 text.
--     (Same logic as 0008; only re-applied so the embedded Portuguese text is
--     stored correctly this time.)
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
        v_client_name || ' — ' || v_clinic_name || ' — ' || v_when,
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
        v_client_name || ' — ' || v_clinic_name || ' — ' || v_when,
        '/agenda'
      );
    end if;
  end if;
  return new;
end;
$$;

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
      -- Planner may send a case back to clinical conversion or reevaluation
      when v_old = 'planning_center' and p_new_phase in ('clinical_conversion', 'reevaluation')
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
    || ' — Clínica: ' || coalesce(v_clinic_name, '—')
    || ' — Pilar: ' || v_pillar_label
    || ' — Veio de: ' || coalesce(v_phase_label, '—')
    || ' — Por: ' || coalesce(nullif(v_sender_name, ''), '—')
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
