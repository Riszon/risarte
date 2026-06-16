-- =============================================================================
-- Risarte Odontologia — Migration 0018 (Lote Base da Jornada, passo 4)
-- Check-in + waiting-room flow. Check-in (by reception) records arrival and
-- drives the automatic phase transition; the professional then calls and
-- finishes the attendance.
-- =============================================================================

create type public.attendance_status as enum ('waiting', 'in_service', 'done');

alter table public.appointments
  add column checked_in_at timestamptz,
  add column attendance public.attendance_status;

-- -----------------------------------------------------------------------------
-- check_in_appointment: reception registers arrival → 'waiting' and moves the
-- client to the next phase, automatically, based on the appointment type.
-- -----------------------------------------------------------------------------
create function public.check_in_appointment(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_type public.appointment_type;
  v_phase public.journey_phase;
  v_new public.journey_phase;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, client_id, type into v_clinic, v_client, v_type
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['receptionist']::public.user_role[])
    or (public.is_sdr() and v_clinic in (select public.user_full_access_clinic_ids()))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.appointments
  set checked_in_at = coalesce(checked_in_at, now()), attendance = 'waiting'
  where id = p_appointment_id;

  select journey_phase into v_phase from public.clients where id = v_client;

  v_new := case
    when v_phase = 'acquisition' and v_type = 'evaluation' then 'clinical_conversion'
    when v_phase = 'acquisition' and v_type in ('urgency', 'emergency') then 'treatment_start'
    when v_phase = 'commercial_conversion' and v_type = 'treatment_start' then 'treatment_start'
    when v_phase = 'follow_up' and v_type = 'reevaluation' then 'reevaluation'
    when v_phase = 'follow_up' and v_type in ('treatment_session', 'treatment_start') then 'treatment_start'
    else null
  end::public.journey_phase;

  if v_new is not null and v_new is distinct from v_phase then
    update public.journey_phase_history set exited_at = now()
    where client_id = v_client and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_client, v_clinic, v_new, v_user);
    update public.clients set journey_phase = v_new, phase_entered_at = now()
    where id = v_client; -- the default-status trigger fills journey_status

    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_user, v_clinic, 'update', 'client_journey', v_client::text,
            jsonb_build_object('from', v_phase, 'to', v_new, 'via', 'check_in'));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- update_attendance: the professional calls the client (in_service) and
-- finishes the attendance (done).
-- -----------------------------------------------------------------------------
create function public.update_attendance(
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
begin
  if p_state = 'waiting' then raise exception 'USE_CHECK_IN'; end if;

  select clinic_id, provider_user_id into v_clinic, v_provider
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or v_provider = (select auth.uid())
    or public.has_role_in_clinic(
      v_clinic,
      array['clinical_coordinator', 'dentist', 'receptionist']::public.user_role[]
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.appointments set attendance = p_state where id = p_appointment_id;
end;
$$;
