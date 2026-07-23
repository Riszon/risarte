-- =============================================================================
-- Risarte Odontologia — Migration 0150 (Módulo Comercial — ajustes pós-teste 3)
--
-- 1) Negociação com MAIS DE UM plano (opções principal + secundários): as
--    marcações de procedimentos agora podem existir em várias opções ao mesmo
--    tempo. Os TOTAIS da negociação passam a contar só os itens da opção
--    SELECIONADA (as marcações das outras opções ficam registradas e acompanham
--    o plano na devolução).
-- 2) Histórico do plano mais DETALHADO: além dos eventos de fluxo, registra
--    "Plano editado" (diagnóstico/opções/orçamento) com o usuário — no máximo
--    1 evento por autor a cada 30 minutos (não polui o histórico).
-- Idempotente.
-- =============================================================================

-- 1) Totais da negociação = só a opção selecionada -----------------------------
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

  -- Totais e aprovação parcial: SÓ os itens da opção selecionada. Marcações em
  -- outras opções ficam gravadas (informação p/ o replanejamento), sem somar.
  select coalesce(sum(case when ni.included then i.quantity * i.unit_price_cents else 0 end), 0),
         count(*) filter (where not ni.included)
    into v_subtotal, v_excluded
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items i on i.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and i.option_id = v_neg.option_id;

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

-- 2) Histórico detalhado: "Plano editado" com autor (1 por autor a cada 30 min)
create or replace function public.log_plan_edited_event(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_clinic uuid;
begin
  if p_plan_id is null then return; end if;
  if exists (
    select 1 from public.treatment_plan_events e
    where e.plan_id = p_plan_id
      and e.event_type = 'editado'
      and e.actor_id is not distinct from v_actor
      and e.created_at > now() - interval '30 minutes'
  ) then
    return;
  end if;
  select clinic_id into v_clinic from public.treatment_plans where id = p_plan_id;
  insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
  values (p_plan_id, v_clinic, 'editado',
    'Plano editado (diagnóstico, opções ou orçamento)', v_actor);
end;
$$;

-- Edição do texto do plano (diagnóstico/objetivos/observações).
create or replace function public.trg_plan_content_edited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.diagnosis is distinct from new.diagnosis
     or old.objectives is distinct from new.objectives
     or old.planning_notes is distinct from new.planning_notes then
    perform public.log_plan_edited_event(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plan_content_edited on public.treatment_plans;
create trigger trg_plan_content_edited
  after update of diagnosis, objectives, planning_notes on public.treatment_plans
  for each row execute function public.trg_plan_content_edited();

-- Edição das OPÇÕES (título/descrição/principal/ordem — não o review do Coord.).
create or replace function public.trg_plan_option_edited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.log_plan_edited_event(coalesce(new.plan_id, old.plan_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_plan_option_edited_ins on public.treatment_plan_options;
create trigger trg_plan_option_edited_ins
  after insert on public.treatment_plan_options
  for each row execute function public.trg_plan_option_edited();
drop trigger if exists trg_plan_option_edited_upd on public.treatment_plan_options;
create trigger trg_plan_option_edited_upd
  after update of title, description, is_primary, sort_order on public.treatment_plan_options
  for each row execute function public.trg_plan_option_edited();
drop trigger if exists trg_plan_option_edited_del on public.treatment_plan_options;
create trigger trg_plan_option_edited_del
  after delete on public.treatment_plan_options
  for each row execute function public.trg_plan_option_edited();

-- Edição dos ITENS do orçamento (qualquer mudança).
create or replace function public.trg_plan_item_edited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  select plan_id into v_plan from public.treatment_plan_options
  where id = coalesce(new.option_id, old.option_id);
  perform public.log_plan_edited_event(v_plan);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_plan_item_edited_ins on public.treatment_plan_option_items;
create trigger trg_plan_item_edited_ins
  after insert on public.treatment_plan_option_items
  for each row execute function public.trg_plan_item_edited();
drop trigger if exists trg_plan_item_edited_upd on public.treatment_plan_option_items;
create trigger trg_plan_item_edited_upd
  after update on public.treatment_plan_option_items
  for each row execute function public.trg_plan_item_edited();
drop trigger if exists trg_plan_item_edited_del on public.treatment_plan_option_items;
create trigger trg_plan_item_edited_del
  after delete on public.treatment_plan_option_items
  for each row execute function public.trg_plan_item_edited();
