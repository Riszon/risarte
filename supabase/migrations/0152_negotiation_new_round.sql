-- =============================================================================
-- Risarte Odontologia — Migration 0152 (Módulo Comercial — nova rodada)
--
-- BUG: quando a negociação foi DEVOLVIDA ao planejamento e o cliente voltou à
-- Fase 4 (replanejamento concluído + plano reaprovado), o Consultor não
-- conseguia editar a negociação — o status "devolvida" ficava travado.
--
-- 1) evaluate_negotiation_rules: salvar com status "devolvida" (cliente já na
--    Fase 4 — o portão de fase continua valendo) abre a NOVA RODADA
--    (status volta para "em_negociacao").
-- 2) accept_negotiation: não aceita uma rodada "devolvida" sem salvar antes
--    (ROUND_CLOSED) — o plano pode ter mudado no replanejamento; o Consultor
--    revisa e salva, e só então registra o aceite.
-- Idempotente.
-- =============================================================================

-- 1) Salvar reabre a rodada devolvida ------------------------------------------
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
    -- "devolvida": replanejamento concluído e cliente de volta à Fase 4 —
    -- salvar abre a NOVA RODADA de negociação.
    status = case
      when array_length(v_violations, 1) > 0
           and not (rule_authorized and not p_from_consultant)
        then 'aguardando_autorizacao'
      when status in ('aguardando_autorizacao', 'aceita', 'devolvida') then 'em_negociacao'
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

-- 2) Aceite exige salvar a nova rodada primeiro --------------------------------
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

  -- Rodada devolvida: o plano pode ter mudado no replanejamento — o Consultor
  -- precisa revisar e SALVAR a nova rodada antes de registrar o aceite.
  if v_neg.status = 'devolvida' then raise exception 'ROUND_CLOSED'; end if;
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
