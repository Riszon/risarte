-- =============================================================================
-- 0434 — A TRANSFERÊNCIA CANCELA TAMBÉM O QUE FICOU EM ABERTO NO PASSADO
--        (OC-00188) E A CONTA "MONITORAMENTO E SEGURANÇA" (OC-00023)
--
-- 1) OC-00188 (23/11/2026, treino, Coordenador de Cambé): "Paciente
--    transferido de unidade não abre o cockpit de avaliação." O cockpit só
--    abre para o Coordenador da unidade ATUAL do cliente — isso é regra. O
--    defeito: o cliente foi transferido para Londrina em 28/10, mas a
--    avaliação de 27/10 em Cambé (já passada, nunca resolvida) continuou
--    "marcada" — `transfer_client` (0089) só cancelava `starts_at > now()`.
--    Ela virou pendência de dia anterior no Atendimento de Cambé; a recepção
--    registrou a chegada (06/11) e o Coordenador chamou (23/11) um cliente que
--    nem era mais da unidade. Agora a transferência cancela também os
--    agendamentos passados ainda em aberto; só o atendimento em curso fica.
--    O resto da função é o da 0089 (e a guarda de execução da 0379).
--
-- 2) OC-00023 (24/11/2026, produção, Financeiro da Franqueadora): faltava
--    conta para a despesa fixa de monitoramento e segurança — 3.2.06, irmã de
--    3.2.05 (0433).
--
-- Não mexe nos agendamentos que já ficaram presos antes desta migração.
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
  v_plan_status text;
  v_evaluator text;
  v_eval_at timestamptz;
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
      and status in ('scheduled', 'confirmed')
      -- 0434 (OC-00188): também o que já PASSOU e ficou em aberto (não
      -- veio, ninguém deu falta) — sem isso ele virava pendência de dia
      -- anterior na unidade antiga, e lá chamavam um cliente que não é
      -- mais dela. Só fica o atendimento EM CURSO (alguém está atendendo).
      and (starts_at > now() or attendance is distinct from 'in_service')
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

  -- ---------------------------------------------------------------------------
  -- O plano de tratamento acompanha o cliente: move todo o encadeamento
  -- (plano → opções → itens/etapas) e as sessões para a unidade de destino.
  -- ---------------------------------------------------------------------------
  update public.treatment_plans
    set clinic_id = p_target_clinic_id
  where client_id = p_client_id;

  update public.treatment_plan_options o
    set clinic_id = p_target_clinic_id
  where o.plan_id in (
    select tp.id from public.treatment_plans tp where tp.client_id = p_client_id
  );

  update public.treatment_plan_option_items i
    set clinic_id = p_target_clinic_id
  where i.option_id in (
    select o.id from public.treatment_plan_options o
    join public.treatment_plans tp on tp.id = o.plan_id
    where tp.client_id = p_client_id
  );

  update public.treatment_plan_stages s
    set clinic_id = p_target_clinic_id
  where s.option_id in (
    select o.id from public.treatment_plan_options o
    join public.treatment_plans tp on tp.id = o.plan_id
    where tp.client_id = p_client_id
  );

  update public.treatment_sessions
    set clinic_id = p_target_clinic_id
  where client_id = p_client_id;

  -- Estado do plano mais recente + quem fez a avaliação em A (para os avisos).
  select tp.status::text into v_plan_status
  from public.treatment_plans tp
  where tp.client_id = p_client_id
  order by tp.created_at desc limit 1;

  select p.full_name, cn.created_at into v_evaluator, v_eval_at
  from public.clinical_notes cn
  join public.profiles p on p.id = cn.created_by
  where cn.client_id = p_client_id and cn.clinic_id = v_old_clinic
  order by cn.created_at desc limit 1;

  -- ORIGEM (A): saiu da unidade — Recepção, Gerente, Coordenador.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_old_clinic,
         'Cliente transferido para outra unidade',
         v_client_name || ' agora é atendido(a) em ' || v_target_name
           || case when v_cancelled_count > 0
              then '. Agendamentos em aberto cancelados: ' || v_cancelled_list
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

  -- Avisos específicos do plano de tratamento, quando existe um plano.
  if v_plan_status is not null then
    -- ORIGEM (A) — Coordenador: handoff do plano/avaliação.
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_old_clinic,
           'Plano de tratamento segue para outra unidade',
           'O plano de tratamento e a avaliação de ' || v_client_name
             || ' seguem para ' || v_target_name
             || '. A aprovação agora é do Coordenador de ' || v_target_name
             || '. Você continua com acesso à avaliação para consulta.',
           '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_old_clinic
      and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;

    -- DESTINO (B) — Coordenador: plano aguardando aprovação (com detalhes).
    if v_plan_status = 'submitted' then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, p_target_clinic_id,
             'Plano de tratamento para aprovação',
             v_client_name || ' foi transferido(a) de '
               || coalesce(v_old_name, 'outra unidade')
               || '. A avaliação foi feita em '
               || coalesce(v_old_name, 'outra unidade')
               || case when v_evaluator is not null
                    then ' por ' || v_evaluator else '' end
               || case when v_eval_at is not null
                    then ' em ' || to_char(
                           v_eval_at at time zone 'America/Sao_Paulo',
                           'DD/MM/YYYY') else '' end
               || '. Agora a aprovação do plano é da sua unidade.',
             '/clientes/' || p_client_id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = p_target_clinic_id
        and ucr.role = 'clinical_coordinator'
        and ucr.user_id is distinct from v_user;
    end if;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, p_target_clinic_id, 'update', 'client_transfer', p_client_id::text,
    jsonb_build_object(
      'from_clinic', v_old_clinic, 'to_clinic', p_target_clinic_id,
      'consent', true, 'cancelled_appointments', v_cancelled_count,
      'plan_moved', v_plan_status is not null
    )
  );
end;
$$;
revoke execute on function public.transfer_client(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.transfer_client(uuid, uuid, boolean) to authenticated, service_role;

insert into public.chart_of_accounts (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic) values
  ('3.2.06', 'Monitoramento e segurança', '3.2', 'expense', 'operational', 'fixed', 'both', true)
on conflict (code) do nothing;
