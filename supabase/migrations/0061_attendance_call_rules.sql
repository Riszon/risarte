-- =============================================================================
-- 0061 — Regras de chamada no atendimento (LOTE H1: itens H1.3 + H1.4)
-- -----------------------------------------------------------------------------
-- H1.3: um cliente NÃO pode estar em dois atendimentos ao mesmo tempo — chamar
--       um cliente que já está "Em atendimento" em outro agendamento é bloqueado
--       (erro CLIENT_BUSY).
-- H1.4: quem chama o cliente é o PROFISSIONAL do agendamento (ou Admin Master).
--       O Coordenador Clínico vê a sala de espera, mas não chama cliente
--       agendado com outro profissional (erro NOT_PROVIDER). Agendamento sem
--       profissional definido mantém a regra antiga (coordenador/dentista/
--       consultor da unidade podem chamar).
-- Reescreve update_attendance (corpo da 0059 + as duas travas). Idempotente.
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
    -- H1.4: só o profissional do agendamento chama (Admin sempre pode).
    -- Sem profissional definido, vale a regra por função na unidade.
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

    -- E5: liquida as sessões do tratamento ligadas a este agendamento.
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
