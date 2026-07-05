-- =============================================================================
-- 0063 — Status de atendimento + alertas de espera (LOTE H3: item H3.4)
-- -----------------------------------------------------------------------------
-- 1) Novo estado 'gave_up' (desistiu da espera) no fluxo de atendimento, com
--    branch no update_attendance (recepção/coordenador/gerente/profissional):
--    marca o agendamento como cancelado e avisa o profissional.
-- 2) Limite de espera configurável por unidade (clinic_agenda_settings.
--    waiting_alert_minutes; padrão 20 min via fallback).
-- 3) notify_attendance_alerts(clinic): notificações que "incomodam" —
--    espera acima do limite (repete a cada 15 min) para recepção/coordenador/
--    gerente/profissional, e atendimentos de dias anteriores não concluídos
--    (1 aviso por dia). Chamada idempotente ao abrir o painel /atendimento.
-- Idempotente.
-- =============================================================================

alter type public.attendance_status add value if not exists 'gave_up';

alter table public.clinic_agenda_settings
  add column if not exists waiting_alert_minutes int;

-- -----------------------------------------------------------------------------
-- update_attendance: corpo da 0061 + branch 'gave_up' (desistiu da espera).
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
  v_attendance public.attendance_status;
  v_status public.journey_status;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  if p_state = 'waiting' then raise exception 'USE_CHECK_IN'; end if;

  select clinic_id, provider_user_id, called_by, client_id, attendance
    into v_clinic, v_provider, v_called_by, v_client, v_attendance
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

    update public.appointments
    set attendance = 'in_service',
        called_by = v_user,
        called_at = coalesce(called_at, now())
    where id = p_appointment_id;

  elsif p_state = 'gave_up' then
    -- H3.4: desistiu da espera — recepção/coordenador/gerente (ou o próprio
    -- profissional / Admin) registram; só vale para quem está em espera.
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

    -- Avisa o profissional que esperava esse cliente.
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

-- -----------------------------------------------------------------------------
-- notify_attendance_alerts: espera longa (repete a cada 15 min acima do limite)
-- + atendimentos de dias anteriores não concluídos (1 aviso por dia).
-- Dedupe pelo link (idempotente — segura para chamar a cada carregamento).
-- -----------------------------------------------------------------------------
create or replace function public.notify_attendance_alerts(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threshold int;
  rec record;
  v_link text;
  v_bucket int;
  v_label text;
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
      p_clinic_id,
      array['receptionist', 'clinical_coordinator', 'unit_manager', 'dentist', 'commercial_consultant']::public.user_role[]
    )
    or p_clinic_id in (select public.user_full_access_clinic_ids())
  ) then
    return;
  end if;

  select coalesce(
    (select s.waiting_alert_minutes from public.clinic_agenda_settings s
      where s.clinic_id = p_clinic_id),
    (select s.waiting_alert_minutes from public.clinic_agenda_settings s
      where s.clinic_id is null),
    20
  ) into v_threshold;
  if v_threshold is null or v_threshold < 5 then v_threshold := 20; end if;

  -- 1) Esperas longas de HOJE: novo aviso a cada 15 min acima do limite.
  for rec in
    select a.id, a.provider_user_id, c.full_name,
           floor(extract(epoch from (now() - a.checked_in_at)) / 60)::int as waited
    from public.appointments a
    join public.clients c on c.id = a.client_id
    where a.clinic_id = p_clinic_id
      and a.attendance = 'waiting'
      and a.checked_in_at is not null
      and (a.checked_in_at at time zone 'America/Sao_Paulo')::date
          = (now() at time zone 'America/Sao_Paulo')::date
  loop
    if rec.waited >= v_threshold then
      v_bucket := floor((rec.waited - v_threshold) / 15.0);
      v_link := '/atendimento?alerta=espera&ag=' || rec.id || '&n=' || v_bucket;
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select u.user_id, p_clinic_id,
             'Cliente esperando há ' || rec.waited || ' min',
             rec.full_name || ' está na sala de espera há ' || rec.waited ||
               ' minutos (limite da unidade: ' || v_threshold ||
               ' min). Chame o cliente ou registre a desistência.',
             v_link
      from (
        select ucr.user_id
        from public.user_clinic_roles ucr
        where ucr.clinic_id = p_clinic_id
          and ucr.role in ('receptionist', 'clinical_coordinator', 'unit_manager')
        union
        select rec.provider_user_id where rec.provider_user_id is not null
      ) u
      where not exists (
        select 1 from public.notifications n
        where n.user_id = u.user_id and n.link = v_link
      );
    end if;
  end loop;

  -- 2) Dias anteriores: em espera / em atendimento que ninguém concluiu.
  for rec in
    select a.id, a.attendance, a.starts_at, a.called_by, a.provider_user_id,
           c.full_name
    from public.appointments a
    join public.clients c on c.id = a.client_id
    where a.clinic_id = p_clinic_id
      and a.attendance in ('waiting', 'in_service')
      and (a.starts_at at time zone 'America/Sao_Paulo')::date
          < (now() at time zone 'America/Sao_Paulo')::date
  loop
    v_label := case
      when rec.attendance = 'waiting' then 'Em espera'
      else 'Em atendimento'
    end;
    v_link := '/atendimento?alerta=pendente&ag=' || rec.id || '&d=' ||
              to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select u.user_id, p_clinic_id,
           'Atendimento de dia anterior não concluído',
           rec.full_name || ' ficou como "' || v_label || '" no dia ' ||
             to_char(rec.starts_at at time zone 'America/Sao_Paulo', 'DD/MM') ||
             '. Conclua o atendimento ou registre falta/desistência.',
           v_link
    from (
      select ucr.user_id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = p_clinic_id
        and ucr.role in ('receptionist', 'clinical_coordinator', 'unit_manager')
      union
      select rec.called_by where rec.called_by is not null
      union
      select rec.provider_user_id where rec.provider_user_id is not null
    ) u
    where not exists (
      select 1 from public.notifications n
      where n.user_id = u.user_id and n.link = v_link
    );
  end loop;
end;
$$;

grant execute on function public.notify_attendance_alerts(uuid) to authenticated;
