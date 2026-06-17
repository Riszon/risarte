-- =============================================================================
-- Risarte Odontologia — Migration 0022 (Lote D — etapa 1)
-- Cliente em tratamento: ao concluir uma sessão (attendance = done), se o
-- cliente está "Em Tratamento" e não tem nenhuma SESSÃO DE TRATAMENTO futura
-- agendada, a recepção é notificada para marcar a próxima.
-- Reescreve update_attendance (definida na 0021) acrescentando essa notificação.
-- Idempotente: create or replace.
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

    -- Cliente em tratamento sem próxima sessão agendada → avisa a recepção.
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
