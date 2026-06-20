-- =============================================================================
-- Risarte Odontologia — Migration 0032 (LOTE E — E5)
-- O Consultor Comercial (profissional responsável) pode registrar a CHEGADA da
-- sua própria apresentação (movimentar o cliente em todas as etapas do
-- atendimento). Recria check_in_appointment liberando o responsável, e evita
-- notificar a si mesmo quando é o próprio profissional que faz o check-in.
-- Idempotente (create or replace).
-- =============================================================================

create or replace function public.check_in_appointment(p_appointment_id uuid)
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
  v_provider uuid;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, client_id, type, provider_user_id
    into v_clinic, v_client, v_type, v_provider
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['receptionist']::public.user_role[])
    or (public.is_sdr() and v_clinic in (select public.user_full_access_clinic_ids()))
    or v_provider = v_user  -- o profissional responsável (ex.: o Consultor) registra a própria chegada
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.appointments
  set checked_in_at = coalesce(checked_in_at, now()),
      checked_in_by = coalesce(checked_in_by, v_user),
      attendance = 'waiting'
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
    where id = v_client;

    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_user, v_clinic, 'update', 'client_journey', v_client::text,
            jsonb_build_object('from', v_phase, 'to', v_new, 'via', 'check_in'));
  end if;

  -- Avisa o profissional de que o cliente está na sala de espera (mas não a si
  -- mesmo, quando é o próprio profissional que faz o check-in).
  select full_name into v_name from public.clients where id = v_client;
  if v_provider is not null then
    if v_provider is distinct from v_user then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_provider, v_clinic, 'Cliente em espera: ' || v_name,
              v_name || ' fez check-in e está na sala de espera.', '/atendimento');
    end if;
  else
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic, 'Cliente em espera: ' || v_name,
           v_name || ' fez check-in e está na sala de espera.', '/atendimento'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('clinical_coordinator', 'dentist', 'commercial_consultant');
  end if;
end;
$$;
