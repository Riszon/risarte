-- =============================================================================
-- Risarte Odontologia — Migration 0146 (Cockpit — Bloco D: refino da recepção)
--
-- Quando o Coordenador pede à recepção para agendar a revisão/refação do controle
-- de qualidade, a notificação agora leva a recepção direto para a AGENDA com o
-- cliente pré-selecionado e o TIPO de agendamento já escolhido (REVISÃO ou
-- REFAÇÃO), em vez de abrir o prontuário. Só muda o link das notificações.
-- Idempotente.
-- =============================================================================

-- 1) Pedido em massa (fim do checklist): abre a agenda com o cliente + tipo.
--    Tipo = REVISÃO se houver algum item em revisão; senão REFAÇÃO.
create or replace function public.request_quality_scheduling(
  p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_name text;
  v_count int;
  v_has_revisao boolean;
  v_type text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, client_id into v_clinic, v_client
    from public.treatment_plans where id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select count(*), bool_or(status = 'revisao')
    into v_count, v_has_revisao
  from public.plan_quality_reviews
  where plan_id = p_plan_id and status in ('revisao','reprovado');
  if v_count = 0 then raise exception 'NOTHING_TO_SCHEDULE'; end if;

  v_type := case when v_has_revisao then 'revision' else 'redo' end;

  select full_name into v_name from public.clients where id = v_client;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic, 'Agendar revisão de procedimentos',
    coalesce(v_name,'Cliente') || ' — ' || v_count ||
      ' procedimento(s) para revisar/refazer (controle de qualidade).',
    '/agenda?cliente=' || v_client || '&tipo=' || v_type
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';

  update public.plan_quality_reviews
    set scheduling_requested = true
  where plan_id = p_plan_id and status in ('revisao','reprovado');

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'quality_scheduling_request', p_plan_id::text,
    jsonb_build_object('count', v_count));
end;
$$;

revoke all on function public.request_quality_scheduling(uuid) from public;
grant execute on function public.request_quality_scheduling(uuid) to authenticated;

-- 2) Pedido de UM procedimento em aberto: abre a agenda com o cliente + tipo.
--    Tipo = REVISÃO/REFAÇÃO conforme a reabertura; senão sessão de tratamento.
create or replace function public.request_item_scheduling(
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_name text;
  v_proc text;
  v_redo text;
  v_type text;
  v_user uuid := (select auth.uid());
begin
  select i.clinic_id, i.description, tp.client_id
    into v_clinic, v_proc, v_client
  from public.treatment_plan_option_items i
  join public.treatment_plan_options o on o.id = i.option_id
  join public.treatment_plans tp on tp.id = o.plan_id
  where i.id = p_item_id;
  if v_client is null then raise exception 'ITEM_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Tipo do agendamento conforme a reabertura do procedimento.
  select case
           when bool_or(redo_kind = 'revisao') then 'revision'
           when bool_or(redo_kind = 'refacao') then 'redo'
           else 'treatment_session'
         end
    into v_type
  from public.treatment_sessions
  where item_id = p_item_id and status <> 'done';
  v_type := coalesce(v_type, 'treatment_session');

  select full_name into v_name from public.clients where id = v_client;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic, 'Agendar procedimento',
    coalesce(v_name,'Cliente') || ' — agendar ' || coalesce(v_proc,'procedimento') ||
      ' (controle de qualidade).',
    '/agenda?cliente=' || v_client || '&tipo=' || v_type
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'item_scheduling_request', p_item_id::text, null);
end;
$$;

revoke all on function public.request_item_scheduling(uuid) from public;
grant execute on function public.request_item_scheduling(uuid) to authenticated;
