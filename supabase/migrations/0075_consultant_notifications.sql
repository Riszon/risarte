-- =============================================================================
-- 0075 — Notificações ao Consultor Comercial (Ajuste 2 pré-Grupo 4 / AJ11)
-- -----------------------------------------------------------------------------
-- Dois ajustes:
--  1) Recria move_client_phase (era da 0071) mudando SÓ o aviso ao Consultor +
--     Assistente ao chegar na Conversão Comercial: agora usa providers_with_access
--     para incluir os consultores da FRANQUEADORA com escopo na unidade (antes,
--     só pegava quem tinha papel na própria clínica → o consultor da matriz não
--     recebia nada).
--  2) Novo RPC notify_commercial_presentation: quando uma apresentação comercial
--     é agendada, avisa o Consultor/Assistente (mesma abrangência) para ele poder
--     cobrar agilidade do Centro de Planejamento antes do dia.
-- Idempotente (create or replace).
-- =============================================================================

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
  v_presentation_at timestamptz;
begin
  select clinic_id, journey_phase, full_name, methodology_pillar
    into v_clinic, v_old, v_client_name, v_pillar
  from public.clients where id = p_client_id;

  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if v_old = p_new_phase then return; end if;

  v_allowed := public.is_admin_master();
  if not v_allowed then
    v_allowed := case
      when v_old = 'acquisition' and p_new_phase = 'clinical_conversion'
        then public.has_role_in_clinic(v_clinic, array['receptionist','sdr']::public.user_role[])
      when v_old = 'clinical_conversion' and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'planning_center' and p_new_phase = 'commercial_conversion'
        then exists (select 1 from public.user_clinic_roles ucr where ucr.user_id = v_user and ucr.role = 'planner_dentist')
      when v_old = 'planning_center' and p_new_phase in ('clinical_conversion', 'reevaluation')
        then exists (select 1 from public.user_clinic_roles ucr where ucr.user_id = v_user and ucr.role = 'planner_dentist')
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

  if not v_allowed then raise exception 'NOT_ALLOWED'; end if;

  update public.journey_phase_history set exited_at = now()
  where client_id = p_client_id and exited_at is null;
  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (p_client_id, v_clinic, p_new_phase, v_user);
  update public.clients set journey_phase = p_new_phase, phase_entered_at = now()
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
    end into v_sender_role
  from public.user_clinic_roles ucr
  where ucr.user_id = v_user and (ucr.clinic_id = v_clinic or ucr.role = 'planner_dentist')
  order by case when ucr.clinic_id = v_clinic then 0 else 1 end limit 1;

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
    when 'diagnosis' then 'Diagnóstico' when 'planning' then 'Planejamento'
    when 'health' then 'Saúde' when 'function' then 'Função'
    when 'aesthetics' then 'Estética' when 'prevention' then 'Prevenção'
  end, 'a definir');

  v_body := v_client_name
    || ' — Clínica: ' || coalesce(v_clinic_name, '—')
    || ' — Pilar: ' || v_pillar_label
    || ' — Veio de: ' || coalesce(v_phase_label, '—')
    || ' — Por: ' || coalesce(nullif(v_sender_name, ''), '—')
    || coalesce(' (' || v_sender_role || ')', '');

  if p_new_phase = 'planning_center' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Novo caso no Centro de Planejamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'commercial_conversion' then
    select a.starts_at into v_presentation_at
    from public.appointments a
    where a.client_id = p_client_id
      and a.type = 'commercial_presentation'
      and a.status in ('scheduled', 'confirmed')
      and a.starts_at >= now()
    order by a.starts_at asc
    limit 1;

    -- AJ11: Consultor + Assistente Comercial da unidade E os da Franqueadora com
    -- escopo na unidade (providers_with_access) — antes só pegava a própria clínica.
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct pwa.user_id, v_clinic, 'Caso pronto para apresentação comercial',
      v_body || case
        when v_presentation_at is not null
          then ' — Apresentação: '
               || to_char(v_presentation_at at time zone 'America/Sao_Paulo',
                          'DD/MM "às" HH24"h"MI')
        else ' — ATENÇÃO: sem apresentação agendada.'
      end,
      '/clientes/' || p_client_id
    from (
      select user_id from public.providers_with_access(v_clinic, 'commercial_consultant')
      union
      select user_id from public.providers_with_access(v_clinic, 'commercial_assistant')
    ) pwa
    where pwa.user_id <> v_user;

    if v_presentation_at is null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic,
        'URGENTE: agendar apresentação comercial',
        v_client_name
          || ' está pronto(a) para a Conversão Comercial, mas NÃO tem apresentação'
          || ' comercial agendada. Agende o quanto antes para o caso não travar.',
        '/agenda?cliente=' || p_client_id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;

      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic,
        'Caso comercial sem apresentação agendada',
        v_client_name
          || ' entrou na Conversão Comercial sem apresentação agendada.'
          || ' Acompanhe para garantir o agendamento com a recepção.',
        '/clientes/' || p_client_id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic
        and ucr.role in ('unit_manager', 'clinical_coordinator') and ucr.user_id <> v_user;
    end if;
  elsif p_new_phase = 'treatment_start' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Fechamento! Agendar início de tratamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'reevaluation' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em reavaliação', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator' and ucr.user_id <> v_user;
  elsif p_new_phase = 'follow_up' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em acompanhamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'clinical_conversion' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em conversão clínica', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator' and ucr.user_id <> v_user;
  end if;

  v_schedule_hint := case p_new_phase
    when 'clinical_conversion' then 'Agendar avaliação'
    when 'reevaluation' then 'Agendar reavaliação'
    else null
  end;

  if v_schedule_hint is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_schedule_hint || ': ' || v_client_name, v_body,
           '/agenda?cliente=' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'client_journey', p_client_id::text,
          jsonb_build_object('from', v_old, 'to', p_new_phase));
end;
$$;

-- -----------------------------------------------------------------------------
-- AJ11 (2): ao agendar uma apresentação comercial, avisa o Consultor/Assistente
-- (da unidade e da Franqueadora com escopo) para acompanhar o plano a tempo.
-- notifications não tem policy de insert → função security-definer.
-- -----------------------------------------------------------------------------
create or replace function public.notify_commercial_presentation(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_type public.appointment_type;
  v_starts timestamptz;
  v_client_name text;
  v_when text;
  v_uid uuid := (select auth.uid());
begin
  select a.clinic_id, a.client_id, a.type, a.starts_at
    into v_clinic, v_client, v_type, v_starts
  from public.appointments a where a.id = p_appointment_id;

  if v_clinic is null or v_type <> 'commercial_presentation' then return; end if;

  if not (
    public.is_admin_master()
    or v_clinic in (select public.user_full_access_clinic_ids())
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.user_id = v_uid
    )
  ) then
    return;
  end if;

  select full_name into v_client_name from public.clients where id = v_client;
  v_when := to_char(v_starts at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24"h"MI');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_clinic,
    'Apresentação comercial agendada',
    coalesce(v_client_name, 'Cliente') || ' — apresentação em ' || v_when
      || '. Acompanhe para o plano estar pronto a tempo.',
    '/clientes/' || v_client
  from (
    select user_id from public.providers_with_access(v_clinic, 'commercial_consultant')
    union
    select user_id from public.providers_with_access(v_clinic, 'commercial_assistant')
  ) pwa
  where pwa.user_id <> v_uid;
end;
$$;

grant execute on function public.notify_commercial_presentation(uuid) to authenticated;
