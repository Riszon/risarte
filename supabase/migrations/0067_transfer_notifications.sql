-- =============================================================================
-- 0067 — Notificações ampliadas na transferência (LOTE H3: item H3.9)
-- -----------------------------------------------------------------------------
-- Quando um cliente é transferido, além da unidade de ORIGEM (que já era
-- avisada), a unidade de DESTINO passa a receber sempre um aviso de que o
-- cliente chegou — para Recepção, Gerente E Coordenador Clínico. (O
-- compartilhamento já notifica os 3 papéis das duas unidades desde a 0038.)
-- Reescreve transfer_client (corpo da 0031 + aviso de entrada ao destino).
-- Idempotente.
-- =============================================================================

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
  v_old_name text;
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
    or (public.is_sdr() and p_target_clinic_id in (select public.user_full_access_clinic_ids()))
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
  select name into v_old_name from public.clinics where id = v_old_clinic;

  -- ORIGEM (A): saiu da unidade — Recepção, Gerente, Coordenador.
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

  -- DESTINO (B): entrou na unidade — Recepção, Gerente, Coordenador (H3.9).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, p_target_clinic_id,
         'Cliente transferido para a sua unidade',
         v_client_name || ' foi transferido(a) da unidade '
           || coalesce(v_old_name, 'de origem') || ' para a sua unidade.'
           || case when v_cancelled_count > 0
              then ' Tinha ' || v_cancelled_count
                   || ' agendamento(s) cancelado(s) na unidade anterior ('
                   || v_cancelled_list || ') — verifique se precisa reagendar.'
              else '' end,
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = p_target_clinic_id
    and ucr.role in ('receptionist', 'unit_manager', 'clinical_coordinator')
    and ucr.user_id is distinct from v_user;

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
