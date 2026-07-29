-- =============================================================================
-- 0179 — J1: conserto da validação da negociação (+ base p/ entrada no cockpit)
-- -----------------------------------------------------------------------------
-- BUG (introduzido na 0167, herdado por 0168/0177): ao reescrever
-- `evaluate_negotiation_rules` para somar o PPR+, a função perdeu partes da
-- versão 0152:
--   • parou de gravar `subtotal_cents`/`final_cents` (fechamento copiava total
--     obsoleto; parcela mínima olhava valor velho; cobranças davam
--     TOTAL_MISMATCH);
--   • o subtotal deixou de filtrar pela OPÇÃO SELECIONADA (com plano principal
--     + secundários aprovados, somava tudo junto);
--   • parou de gravar `is_partial` (trava do motivo de aprovação parcial);
--   • parou de reabrir a rodada (status devolvida/aceita → em_negociacao ao
--     salvar) — o aceite ficava preso em ROUND_CLOSED após replanejamento;
--   • parou de zerar `rule_authorized` quando o consultor salva de novo.
--
-- BUG 2 (da 0177): `evaluate_negotiation_rules` passou a ler
-- `v_ppr.min_installment_cents`, mas `ppr_client_conditions` não devolve esse
-- campo — qualquer negociação PARCELADA estourava erro de runtime ao salvar.
-- Corrigido acrescentando o campo à função.
--
-- Esta migração restaura tudo isso E mantém o que 0167/0168/0177 acrescentaram
-- (condições do PPR+ acima da regra, à vista só PIX/depósito, parcela mínima
-- por meio de pagamento). Também repara os totais das negociações existentes.
-- Idempotente.
-- =============================================================================

-- 1) ppr_client_conditions ganha a parcela mínima do plano do cliente.
--    (drop + create: "create or replace" não muda as colunas de retorno.)
drop function if exists public.ppr_client_conditions(uuid);
create function public.ppr_client_conditions(p_client_id uuid)
returns table (
  max_installments integer,
  allowed_methods text[],
  top_discount_percent numeric,
  min_installment_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.max_installments,
    p.allowed_methods,
    greatest(
      coalesce(p.cash_discount_percent, 0),
      coalesce((select max(t.discount_percent)
                from public.ppr_plan_installment_tiers t
                where t.plan_id = p.id), 0)
    ),
    nullif(p.min_installment_cents, 0)
  from public.ppr_beneficiaries b
  join public.ppr_memberships m on m.id = b.membership_id
  join public.ppr_plans p on p.id = m.plan_id
  where b.client_id = p_client_id
    and b.left_at is null
    and m.status = 'ativo'
  limit 1;
$$;

grant execute on function public.ppr_client_conditions(uuid) to authenticated;

-- 2) Validação da negociação — versão completa (0152 + 0167/0168/0177 + J1).

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
  v_final integer;
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
  v_min_cents integer;
  v_installment_cents integer;
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

  -- Totais e aprovação parcial: SÓ os itens da opção selecionada (0152).
  -- Marcações em outras opções ficam gravadas, sem somar.
  select coalesce(sum(case when ni.included then i.quantity * i.unit_price_cents else 0 end), 0),
         count(*) filter (where not ni.included)
    into v_subtotal, v_excluded
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items i on i.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and i.option_id = v_neg.option_id;

  -- Total autoritativo desta rodada (era isto que a 0167 parou de gravar).
  v_final := greatest(0, v_subtotal + v_neg.adjustment_cents);

  select coalesce(u.max_discount_percent, n.max_discount_percent),
         coalesce(u.max_installments, n.max_installments),
         coalesce(u.allowed_methods, n.allowed_methods)
    into v_max_disc, v_max_inst, v_methods
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_neg.clinic_id
  left join public.commercial_rules n on n.clinic_id is null;

  -- PPR+ acima da regra da rede/unidade (0167/0168).
  select * into v_ppr from public.ppr_client_conditions(v_neg.client_id);
  if v_ppr.max_installments is not null then
    v_max_inst := greatest(coalesce(v_max_inst, 1), v_ppr.max_installments);
    if v_methods is not null then
      if v_ppr.allowed_methods is null then
        v_methods := null;
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
  if v_neg.installments <= 1 and v_neg.payment_method is not null
     and v_neg.payment_method not in ('pix','deposito_avista') then
    v_violations := v_violations
      || 'À vista (1x) o pagamento é só por PIX ou depósito à vista';
  end if;

  -- I8: parcela mínima do MEIO DE PAGAMENTO escolhido (só no parcelado).
  -- Usa o total RECÉM-calculado, nunca o gravado (que podia estar obsoleto).
  if v_neg.installments > 1 and v_neg.payment_method is not null then
    v_min_cents := public.commercial_min_installment_cents(
      v_neg.clinic_id, v_neg.payment_method);
    -- O plano do PPR+ pode ter mínimo próprio; vale o MAIOR dos dois.
    if v_ppr.min_installment_cents is not null then
      v_min_cents := greatest(coalesce(v_min_cents, 0), v_ppr.min_installment_cents);
      v_min_cents := nullif(v_min_cents, 0);
    end if;
    if v_min_cents is not null and v_final > 0 then
      -- J1: com entrada, as parcelas dividem só o RESTANTE.
      v_installment_cents := ceil(
        greatest(0, v_final - coalesce(v_neg.down_payment_cents, 0))::numeric
        / v_neg.installments);
      if v_installment_cents > 0 and v_installment_cents < v_min_cents then
        v_violations := v_violations || format(
          'Parcela de R$ %s abaixo do mínimo de R$ %s para "%s"',
          to_char(v_installment_cents / 100.0, 'FM999G999D00'),
          to_char(v_min_cents / 100.0, 'FM999G999D00'),
          v_neg.payment_method);
      end if;
    end if;
  end if;

  update public.plan_negotiations set
    subtotal_cents = v_subtotal,
    final_cents = v_final,
    is_partial = (v_excluded > 0),
    rule_authorized = case when p_from_consultant then false else rule_authorized end,
    rule_violations = case when array_length(v_violations, 1) > 0
                           then array_to_string(v_violations, '; ') else null end,
    -- "devolvida"/"aceita": salvar abre a NOVA RODADA de negociação (0152).
    status = case
      when array_length(v_violations, 1) > 0
           and not (rule_authorized and not p_from_consultant)
        then 'aguardando_autorizacao'
      when status in ('aguardando_autorizacao', 'aceita', 'devolvida')
        then 'em_negociacao'
      else status
    end,
    consultant_id = case when p_from_consultant
                         then coalesce(consultant_id, v_user)
                         else consultant_id end,
    updated_at = now()
  where id = p_negotiation_id;

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

-- -----------------------------------------------------------------------------
-- Reparo: recalcula subtotal/final/is_partial das negociações gravadas com
-- total obsoleto (qualquer uma salva depois da 0167). Não mexe em status.
-- -----------------------------------------------------------------------------
update public.plan_negotiations n
   set subtotal_cents = t.subtotal,
       final_cents = greatest(0, t.subtotal + n.adjustment_cents),
       is_partial = (t.excluded > 0)
  from (
    select ni.negotiation_id, i.option_id,
           coalesce(sum(case when ni.included
                             then i.quantity * i.unit_price_cents
                             else 0 end), 0) as subtotal,
           count(*) filter (where not ni.included) as excluded
    from public.plan_negotiation_items ni
    join public.treatment_plan_option_items i on i.id = ni.item_id
    group by ni.negotiation_id, i.option_id
  ) t
 where t.negotiation_id = n.id
   and t.option_id = n.option_id
   and (n.subtotal_cents is distinct from t.subtotal
        or n.final_cents is distinct from
           greatest(0, t.subtotal + n.adjustment_cents)
        or n.is_partial is distinct from (t.excluded > 0));
