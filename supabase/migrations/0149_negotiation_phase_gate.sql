-- =============================================================================
-- Risarte Odontologia — Migration 0149 (Módulo Comercial — ajustes pós-teste)
--
-- 1) BUG: negociação só pode acontecer com o cliente NA FASE 4. As RPCs de
--    salvar/aceitar negociação passam a exigir journey_phase =
--    commercial_conversion (WRONG_PHASE caso contrário).
-- 2) Devolvido ao planejamento = situação "Replanejamento" (derivada no app de
--    status rascunho + nota da devolução). Ao ser REAPROVADO pelo Coordenador,
--    a nota da devolução é limpa automaticamente (trigger) — o plano volta ao
--    ciclo normal; a história completa permanece em treatment_plan_events.
-- 3) As considerações do Consultor deixam de ir para as "informações
--    complementares do Coordenador" (planning_supplements) — agora têm lugar
--    próprio: destaque no plano + pop-up "Devoluções do Comercial" no cockpit.
-- Idempotente.
-- =============================================================================

-- 1) Portão de fase nas RPCs da negociação -------------------------------------
create or replace function public.evaluate_negotiation_rules(
  p_negotiation_id uuid,
  p_from_consultant boolean default true
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_client_phase public.journey_phase;
  v_subtotal integer;
  v_excluded integer;
  v_max_disc numeric;
  v_max_inst integer;
  v_methods text[];
  v_discount_pct numeric;
  v_violations text[] := '{}';
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  -- Negociação SÓ com o cliente na Conversão Comercial (Fase 4).
  select journey_phase into v_client_phase
  from public.clients where id = v_neg.client_id;
  if v_client_phase <> 'commercial_conversion' then
    raise exception 'WRONG_PHASE';
  end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_neg.clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select coalesce(sum(case when ni.included then i.quantity * i.unit_price_cents else 0 end), 0),
         count(*) filter (where not ni.included)
    into v_subtotal, v_excluded
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items i on i.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id;

  select coalesce(u.max_discount_percent, n.max_discount_percent),
         coalesce(u.max_installments, n.max_installments),
         coalesce(u.allowed_methods, n.allowed_methods)
    into v_max_disc, v_max_inst, v_methods
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_neg.clinic_id
  left join public.commercial_rules n on n.clinic_id is null;

  v_discount_pct := case
    when v_subtotal > 0 and v_neg.adjustment_cents < 0
      then (-v_neg.adjustment_cents)::numeric * 100 / v_subtotal
    else 0
  end;

  if v_max_disc is not null and v_discount_pct > v_max_disc then
    v_violations := v_violations || format(
      'Desconto de %s%% acima do máximo permitido (%s%%)',
      round(v_discount_pct, 1), v_max_disc);
  end if;
  if v_max_inst is not null and v_neg.installments > v_max_inst then
    v_violations := v_violations || format(
      'Parcelamento em %sx acima do máximo permitido (%sx)',
      v_neg.installments, v_max_inst);
  end if;
  if v_neg.payment_method is not null and v_methods is not null
     and not (v_neg.payment_method = any (v_methods)) then
    v_violations := v_violations || format(
      'Meio de pagamento "%s" não permitido pela regra comercial',
      v_neg.payment_method);
  end if;

  update public.plan_negotiations set
    subtotal_cents = v_subtotal,
    final_cents = v_subtotal + adjustment_cents,
    is_partial = (v_excluded > 0),
    rule_authorized = case when p_from_consultant then false else rule_authorized end,
    rule_violations = case when array_length(v_violations, 1) > 0
                           then array_to_string(v_violations, '; ') else null end,
    status = case
      when array_length(v_violations, 1) > 0
           and not (rule_authorized and not p_from_consultant)
        then 'aguardando_autorizacao'
      when status in ('aguardando_autorizacao', 'aceita') then 'em_negociacao'
      else status
    end,
    consultant_id = coalesce(consultant_id, v_user),
    updated_at = now()
  where id = p_negotiation_id;

  if array_length(v_violations, 1) > 0 then
    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'AUTORIZAÇÃO NECESSÁRIA: negociação fora da regra comercial',
      coalesce(v_client_name, 'Cliente') || ' — ' || array_to_string(v_violations, '; ')
        || '. Revise e autorize (ou negue) na tela de apresentação.',
      '/apresentacao/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'plan_negotiation', p_negotiation_id::text,
    jsonb_build_object('violations', v_violations));

  return v_violations;
end;
$$;

revoke all on function public.evaluate_negotiation_rules(uuid, boolean) from public;
grant execute on function public.evaluate_negotiation_rules(uuid, boolean) to authenticated;

create or replace function public.accept_negotiation(p_negotiation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_client_phase public.journey_phase;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  select journey_phase into v_client_phase
  from public.clients where id = v_neg.client_id;
  if v_client_phase <> 'commercial_conversion' then
    raise exception 'WRONG_PHASE';
  end if;

  if not (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_neg.status = 'aguardando_autorizacao' then raise exception 'AWAITING_AUTHORIZATION'; end if;
  if v_neg.rule_violations is not null and not v_neg.rule_authorized then
    raise exception 'NEEDS_AUTHORIZATION';
  end if;
  if v_neg.is_partial and coalesce(btrim(v_neg.partial_reason), '') = '' then
    raise exception 'PARTIAL_REASON_REQUIRED';
  end if;
  if v_neg.payment_method is null then raise exception 'PAYMENT_REQUIRED'; end if;

  update public.plan_negotiations set
    status = 'aceita',
    consultant_id = coalesce(consultant_id, v_user),
    updated_at = now()
  where id = p_negotiation_id;

  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_neg.clinic_id,
    'Negociação aceita — preparar fechamento',
    coalesce(v_client_name, 'Cliente')
      || ' aceitou as condições. Prepare o contrato e o pagamento (fechamento).',
    '/apresentacao/' || v_neg.client_id
  from public.providers_with_access(v_neg.clinic_id, 'commercial_assistant') pwa
  where pwa.user_id <> v_user;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'plan_negotiation_accept', p_negotiation_id::text, null);
end;
$$;

revoke all on function public.accept_negotiation(uuid) from public;
grant execute on function public.accept_negotiation(uuid) to authenticated;

-- 2) Reaprovação limpa a nota da devolução (a história fica nos eventos). ------
create or replace function public.clear_commercial_return_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    new.commercial_return_note := null;
    new.commercial_returned_at := null;
    new.commercial_returned_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clear_commercial_return on public.treatment_plans;
create trigger trg_clear_commercial_return
  before update of status on public.treatment_plans
  for each row execute function public.clear_commercial_return_on_approval();

-- 3) Devolução sem planning_supplement (a informação tem lugar próprio). -------
create or replace function public.return_commercial_to_planning(
  p_client_id uuid,
  p_considerations text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_phase public.journey_phase;
  v_plan uuid;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, journey_phase into v_clinic, v_phase
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if v_phase <> 'commercial_conversion' then raise exception 'WRONG_PHASE'; end if;

  if not (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_considerations), '') = '' then
    raise exception 'CONSIDERATIONS_REQUIRED';
  end if;

  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;

  update public.plan_negotiations set status = 'devolvida', updated_at = now()
  where client_id = p_client_id and status in ('em_negociacao', 'aguardando_autorizacao');

  if v_plan is not null then
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    values (v_plan, v_clinic, 'devolvido_comercial',
      'Devolvido pelo Comercial — considerações do Consultor: ' || btrim(p_considerations),
      v_user);

    update public.treatment_plans set
      status = 'draft',
      lifecycle = null,
      commercial_return_note = btrim(p_considerations),
      commercial_returned_at = now(),
      commercial_returned_by = v_user,
      updated_at = now()
    where id = v_plan;
  end if;

  perform public.move_client_phase(p_client_id, 'planning_center');

  select full_name into v_client_name from public.clients where id = p_client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_clinic,
    'Plano DEVOLVIDO pelo Comercial — reabrir e ajustar',
    coalesce(v_client_name, 'Cliente')
      || ' — o plano foi reaberto (situação REPLANEJAMENTO) com as considerações '
      || 'do Consultor em destaque. Ajuste e envie novamente para aprovação.',
    '/planejamento/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
end;
$$;

revoke all on function public.return_commercial_to_planning(uuid, text) from public;
grant execute on function public.return_commercial_to_planning(uuid, text) to authenticated;
