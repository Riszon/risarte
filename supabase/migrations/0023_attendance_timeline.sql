-- =============================================================================
-- Risarte Odontologia — Migration 0023 (Lote D — etapa 2)
-- Linha do tempo do atendimento: marca QUANDO e POR QUEM cada transição ocorre,
-- para exibir tempo em espera, tempo em atendimento e quem movimentou.
--   checked_in_at (já existe) / checked_in_by  → chegada (recepção)
--   called_at / called_by (já existe)          → chamada (profissional)
--   done_at / done_by                          → conclusão (profissional)
-- Reescreve check_in_appointment e update_attendance acrescentando os carimbos.
-- Idempotente: add column if not exists + create or replace.
-- =============================================================================

alter table public.appointments
  add column if not exists checked_in_by uuid references public.profiles (id),
  add column if not exists called_at timestamptz,
  add column if not exists done_at timestamptz,
  add column if not exists done_by uuid references public.profiles (id);

-- -----------------------------------------------------------------------------
-- check_in_appointment: + registra quem fez a chegada (checked_in_by).
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

-- -----------------------------------------------------------------------------
-- update_attendance: + carimba called_at (ao chamar) e done_at/done_by (ao
-- concluir). Mantém a regra "quem chamou conclui" e a notificação de sessão.
-- -----------------------------------------------------------------------------
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
  v_client uuid;
  v_status public.journey_status;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  if p_state = 'waiting' then raise exception 'USE_CHECK_IN'; end if;

  select clinic_id, provider_user_id, called_by, client_id
    into v_clinic, v_provider, v_called_by, v_client
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if p_state = 'in_service' then
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
    set attendance = 'in_service',
        called_by = v_user,
        called_at = coalesce(called_at, now())
    where id = p_appointment_id;

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
