-- =============================================================================
-- 0065 — Atendimento: bloqueio de cadeira/profissional ocupados (H3.4b)
-- -----------------------------------------------------------------------------
-- Um atendimento "em atendimento" (in_service) que não foi concluído mantém a
-- CADEIRA e o PROFISSIONAL ocupados: não é possível chamar outro cliente na
-- mesma sala ou com o mesmo profissional até concluir o atual. Isso força a
-- sempre resolver/concluir e não deixar atendimento em aberto (os pendentes de
-- dias anteriores continuam aparecendo no painel de hoje — parte de app).
-- Reescreve update_attendance (corpo da 0063 + PROVIDER_BUSY/ROOM_BUSY na
-- chamada). Idempotente.
-- =============================================================================

create or replace function public.update_attendance(
  p_appointment_id uuid,
  p_state public.attendance_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_provider uuid;
  v_room uuid;
  v_online boolean;
  v_called_by uuid;
  v_client uuid;
  v_attendance public.attendance_status;
  v_status public.journey_status;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  if p_state = 'waiting' then raise exception 'USE_CHECK_IN'; end if;

  select clinic_id, provider_user_id, room_id, is_online, called_by,
         client_id, attendance
    into v_clinic, v_provider, v_room, v_online, v_called_by,
         v_client, v_attendance
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if p_state = 'in_service' then
    -- H1.4: só o profissional do agendamento chama (Admin sempre pode).
    if not (
      public.is_admin_master()
      or v_provider = v_user
      or (
        v_provider is null
        and public.has_role_in_clinic(
          v_clinic,
          array['clinical_coordinator', 'dentist', 'commercial_consultant']::public.user_role[]
        )
      )
    ) then
      raise exception 'NOT_PROVIDER';
    end if;

    -- H1.3: o cliente não pode estar em dois lugares ao mesmo tempo.
    if exists (
      select 1 from public.appointments a
      where a.client_id = v_client
        and a.id <> p_appointment_id
        and a.attendance = 'in_service'
    ) then
      raise exception 'CLIENT_BUSY';
    end if;

    -- H3.4b: o profissional já está em atendimento não concluído (ocupado).
    if v_provider is not null and exists (
      select 1 from public.appointments a
      where a.provider_user_id = v_provider
        and a.id <> p_appointment_id
        and a.attendance = 'in_service'
    ) then
      raise exception 'PROVIDER_BUSY';
    end if;

    -- H3.4b: a sala/cadeira já está ocupada por um atendimento não concluído.
    if v_room is not null and not coalesce(v_online, false) and exists (
      select 1 from public.appointments a
      where a.room_id = v_room
        and a.id <> p_appointment_id
        and a.attendance = 'in_service'
    ) then
      raise exception 'ROOM_BUSY';
    end if;

    update public.appointments
    set attendance = 'in_service',
        called_by = v_user,
        called_at = coalesce(called_at, now())
    where id = p_appointment_id;

  elsif p_state = 'gave_up' then
    if not (
      public.is_admin_master()
      or v_provider = v_user
      or public.has_role_in_clinic(
        v_clinic,
        array['receptionist', 'clinical_coordinator', 'unit_manager']::public.user_role[]
      )
    ) then
      raise exception 'NOT_ALLOWED';
    end if;
    if v_attendance is distinct from 'waiting' then
      raise exception 'NOT_WAITING';
    end if;

    update public.appointments
    set attendance = 'gave_up', status = 'cancelled'
    where id = p_appointment_id;

    if v_provider is not null then
      select full_name into v_name from public.clients where id = v_client;
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (
        v_provider, v_clinic,
        'Cliente desistiu da espera',
        coalesce(v_name, 'Cliente') || ' desistiu de esperar e saiu da fila de atendimento.',
        '/atendimento'
      );
    end if;

  elsif p_state = 'done' then
    if not (
      public.is_admin_master()
      or v_called_by = v_user
      or (v_called_by is null and v_provider = v_user)
    ) then
      raise exception 'NOT_CALLER';
    end if;
    update public.appointments
    set attendance = 'done', status = 'completed',
        done_at = now(), done_by = v_user
    where id = p_appointment_id;

    perform public.settle_treatment_sessions(p_appointment_id);

    select journey_status, full_name into v_status, v_name
    from public.clients where id = v_client;
    if v_status = 'in_treatment' and not exists (
      select 1 from public.appointments a
      where a.client_id = v_client
        and a.type = 'treatment_session'
        and a.starts_at > now()
        and a.status in ('scheduled', 'confirmed')
    ) then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic,
             'Agendar próxima sessão de tratamento: ' || v_name,
             v_name || ' concluiu uma sessão e não tem a próxima agendada.',
             '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
    end if;
  end if;
end;
$$;
