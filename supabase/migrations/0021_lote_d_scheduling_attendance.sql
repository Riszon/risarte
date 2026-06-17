-- =============================================================================
-- Risarte Odontologia — Migration 0021 (Lote D — correções do teste geral)
--   1) unit_scheduling_staff(): a SDR (que fica na Franqueadora) precisa ver a
--      equipe da unidade ao agendar; a RLS de user_clinic_roles a bloqueava.
--      Função SECURITY DEFINER devolve a equipe com segurança.
--   2) appointments.called_by + update_attendance reescrita: quem CHAMA o
--      cliente é quem pode CONCLUIR; Coordenador/Dentista/Consultor podem
--      chamar; concluir marca o agendamento como "Realizado" (completed).
--   3) check_in_appointment: ao colocar o cliente "Em espera", notifica o
--      profissional responsável.
-- Idempotente: seguro para rodar mais de uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Equipe de agendamento de uma unidade (contorna a RLS de user_clinic_roles).
--    Devolve os papéis da unidade para quem tem acesso de agendamento a ela
--    (Admin, membro da unidade, ou função da Franqueadora com acesso à unidade).
-- -----------------------------------------------------------------------------
create or replace function public.unit_scheduling_staff(p_clinic_id uuid)
returns table (user_id uuid, role public.user_role, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select ucr.user_id, ucr.role, p.full_name
  from public.user_clinic_roles ucr
  join public.profiles p on p.id = ucr.user_id
  where ucr.clinic_id = p_clinic_id
    and (
      public.is_admin_master()
      or p_clinic_id in (select public.user_clinic_ids())
      or p_clinic_id in (select public.user_full_access_clinic_ids())
    );
$$;

-- -----------------------------------------------------------------------------
-- 2) Quem chamou o cliente é quem conclui.
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column if not exists called_by uuid references public.profiles (id);

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
  v_called_by uuid;
  v_user uuid := (select auth.uid());
begin
  if p_state = 'waiting' then raise exception 'USE_CHECK_IN'; end if;

  select clinic_id, provider_user_id, called_by
    into v_clinic, v_provider, v_called_by
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if p_state = 'in_service' then
    -- Chamar: Coordenador Clínico, Dentista ou Consultor Comercial (ou o
    -- profissional responsável, que pode ser um Consultor da matriz).
    if not (
      public.is_admin_master()
      or v_provider = v_user
      or public.has_role_in_clinic(
        v_clinic,
        array['clinical_coordinator', 'dentist', 'commercial_consultant']::public.user_role[]
      )
    ) then
      raise exception 'NOT_ALLOWED';
    end if;
    update public.appointments
    set attendance = 'in_service', called_by = v_user
    where id = p_appointment_id;

  elsif p_state = 'done' then
    -- Concluir: só quem chamou (Admin sempre; o responsável como reserva
    -- quando ninguém ficou registrado como quem chamou).
    if not (
      public.is_admin_master()
      or v_called_by = v_user
      or (v_called_by is null and v_provider = v_user)
    ) then
      raise exception 'NOT_CALLER';
    end if;
    update public.appointments
    set attendance = 'done', status = 'completed'
    where id = p_appointment_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) check_in_appointment: registra a chegada, avança a fase e notifica o
--    profissional responsável de que o cliente ficou "Em espera".
--    (Reescrita completa da função da migração 0018, com a notificação.)
-- -----------------------------------------------------------------------------
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

  -- Avisa o profissional de que o cliente está na sala de espera.
  select full_name into v_name from public.clients where id = v_client;
  if v_provider is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (v_provider, v_clinic, 'Cliente em espera: ' || v_name,
            v_name || ' fez check-in e está na sala de espera.', '/atendimento');
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
