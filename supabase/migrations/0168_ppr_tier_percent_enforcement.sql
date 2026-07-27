-- =============================================================================
-- Risarte Odontologia — Migration 0168 (PPR+ — desconto SEMPRE pela faixa do
-- parcelamento escolhido + "à vista só PIX/depósito")
--
-- Bug do teste (dono, 26/07/2026): o desconto da faixa ficava congelado de uma
-- escolha anterior de parcelas (ex.: 15% do à vista aplicado numa venda que
-- depois virou 18× — faixa SEM desconto). O app foi corrigido para recalcular
-- a cada salvamento; aqui fecha o lado do BANCO:
--
--   1) ppr_client_tier_percent(cliente, parcelas): o percentual que o plano dá
--      para AQUELE parcelamento (1× = à vista; sem faixa = 0).
--   2) evaluate_negotiation_rules passa a usar esse percentual como teto extra
--      (antes usava o MAIOR percentual do plano, o que deixaria passar 15% em
--      18× sem autorização).
--   3) À vista (1×) só é aceito em PIX ou depósito à vista — também na
--      negociação.
-- Idempotente.
-- =============================================================================

-- 1) Percentual da faixa do plano para o parcelamento escolhido ----------------
create or replace function public.ppr_client_tier_percent(
  p_client_id uuid,
  p_installments integer
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_installments, 1) <= 1 then p.cash_discount_percent
    else coalesce(
      (select t.discount_percent
         from public.ppr_plan_installment_tiers t
        where t.plan_id = p.id
          and p_installments <= t.up_to_installments
        order by t.up_to_installments
        limit 1),
      0)
  end
  from public.ppr_beneficiaries b
  join public.ppr_memberships m on m.id = b.membership_id
  join public.ppr_plans p on p.id = m.plan_id
  where b.client_id = p_client_id
    and b.left_at is null
    and m.status = 'ativo'
  limit 1;
$$;

grant execute on function public.ppr_client_tier_percent(uuid, integer) to authenticated;

-- 2) Regras da negociação: teto de desconto pela FAIXA escolhida ---------------
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
  v_subtotal integer;
  v_excluded integer;
  v_max_disc numeric;
  v_max_inst integer;
  v_methods text[];
  v_discount_pct numeric;
  v_violations text[] := '{}';
  v_client_name text;
  v_user uuid := (select auth.uid());
  v_ppr record;
  v_tier_pct numeric;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

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

  -- Regra efetiva: campo a campo, ajuste da unidade > padrão da rede.
  select coalesce(u.max_discount_percent, n.max_discount_percent),
         coalesce(u.max_installments, n.max_installments),
         coalesce(u.allowed_methods, n.allowed_methods)
    into v_max_disc, v_max_inst, v_methods
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_neg.clinic_id
  left join public.commercial_rules n on n.clinic_id is null;

  -- PPR+ é SUPERIOR: amplia parcelas e formas de pagamento; o teto de desconto
  -- sobe SÓ até o percentual da FAIXA do parcelamento escolhido (não o maior
  -- percentual do plano — 15% do à vista não vale para 18×).
  select * into v_ppr from public.ppr_client_conditions(v_neg.client_id);
  if v_ppr.max_installments is not null then
    v_max_inst := greatest(coalesce(v_max_inst, 1), v_ppr.max_installments);
    if v_methods is not null then
      if v_ppr.allowed_methods is null then
        v_methods := null;                       -- plano libera todas
      else
        select array(select distinct unnest(v_methods || v_ppr.allowed_methods))
          into v_methods;
      end if;
    end if;
    v_tier_pct := public.ppr_client_tier_percent(v_neg.client_id, v_neg.installments);
    if v_max_disc is not null then
      v_max_disc := greatest(v_max_disc, coalesce(v_tier_pct, 0));
    end if;
  end if;

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
  if v_methods is not null and v_neg.payment_method is not null
     and not (v_neg.payment_method = any(v_methods)) then
    v_violations := v_violations || format(
      'Meio de pagamento "%s" não permitido pela regra comercial',
      v_neg.payment_method);
  end if;
  -- À vista (1×) só em PIX ou depósito à vista (decisão do dono, 26/07/2026).
  if v_neg.installments <= 1 and v_neg.payment_method is not null
     and v_neg.payment_method not in ('pix','deposito_avista') then
    v_violations := v_violations
      || 'À vista (1x) o pagamento é só por PIX ou depósito à vista';
  end if;

  update public.plan_negotiations set
    rule_violations = case when array_length(v_violations, 1) > 0
                           then array_to_string(v_violations, '; ') else null end,
    status = case
      when array_length(v_violations, 1) > 0 and p_from_consultant
        then 'aguardando_autorizacao'
      when array_length(v_violations, 1) is null and status = 'aguardando_autorizacao'
        then 'em_negociacao'
      else status
    end,
    updated_at = now()
  where id = p_negotiation_id;

  -- Fora da regra: avisa o Gerente da unidade para autorizar.
  if array_length(v_violations, 1) > 0 and p_from_consultant then
    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Negociação fora da regra — autorizar?',
      coalesce(v_client_name, 'Cliente') || ' — ' || array_to_string(v_violations, '; '),
      '/comercial/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id
      and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  return v_violations;
end;
$$;

revoke all on function public.evaluate_negotiation_rules(uuid, boolean) from public;
grant execute on function public.evaluate_negotiation_rules(uuid, boolean) to authenticated;
