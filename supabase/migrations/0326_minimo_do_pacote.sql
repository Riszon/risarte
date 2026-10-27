-- =============================================================================
-- 0326 — O MÍNIMO DO PACOTE TRAVA A NEGOCIAÇÃO (pedido do dono, 27/10/2026)
-- Plano e decisões GP7–GP8: docs/procedimentos/GRUPOS-PLANO.md §7
--
--   GP7: o grupo tem PREÇO MÍNIMO, e ele TRAVA a negociação: o Comercial não
--        fecha o pacote abaixo do mínimo sem a autorização do Gerente — o
--        mesmo caminho do desconto acima do teto (`aguardando_autorizacao`).
--   GP8: o mínimo é guardado em % do PREÇO DE TABELA (ex.: 80 = o pacote não
--        sai por menos de 80% da tabela), como o ajuste do pacote (GP5): vale
--        para qualquer número de dentes.
--
-- O que conta como "cobrado pelo pacote": o preço dos itens do grupo no plano
-- (já com o ajuste do pacote, 0325) menos a PARTE do desconto manual da
-- negociação que cabe a eles (proporcional, sobre a base descontável — a
-- mesma base do teto, J7). O benefício do programa (PPR+/Empresarial) NÃO
-- conta: é direito do cliente, não desconto do Comercial.
--
-- Idempotente.
-- =============================================================================

-- 1) A coluna ---------------------------------------------------------------------
alter table public.procedure_groups
  add column if not exists min_price_percent numeric(5,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'procedure_groups_min_price_chk') then
    alter table public.procedure_groups
      add constraint procedure_groups_min_price_chk
      check (min_price_percent is null or (min_price_percent > 0 and min_price_percent <= 200));
  end if;
end $$;

-- 2) As portas do preço: SÓ o Admin Master -------------------------------------------
-- O mínimo não pode ficar ACIMA do preço do pacote (100 + ajuste): toda
-- negociação nasceria fora da regra.
create or replace function public.set_procedure_group_pricing(
  p_id uuid,
  p_percent numeric,
  p_min_percent numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'PRICE_NOT_ALLOWED';
  end if;
  if p_percent is null or p_percent <= -100 or p_percent > 100 then
    raise exception 'INVALID_ADJUST';
  end if;
  if p_min_percent is not null and (p_min_percent <= 0 or p_min_percent > 200) then
    raise exception 'INVALID_MIN';
  end if;
  if p_min_percent is not null and round(p_min_percent, 2) > 100 + round(p_percent, 2) then
    raise exception 'MIN_ABOVE_PRICE';
  end if;
  update public.procedure_groups
     set price_adjust_percent = round(p_percent, 2),
         min_price_percent = round(p_min_percent, 2),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
end;
$$;
revoke execute on function public.set_procedure_group_pricing(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.set_procedure_group_pricing(uuid, numeric, numeric) to authenticated;

-- A porta da 0325 continua (o código antigo a chama), agora respeitando o mínimo.
create or replace function public.set_procedure_group_price(p_id uuid, p_percent numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min numeric;
begin
  if not public.is_admin_master() then
    raise exception 'PRICE_NOT_ALLOWED';
  end if;
  if p_percent is null or p_percent <= -100 or p_percent > 100 then
    raise exception 'INVALID_ADJUST';
  end if;
  select g.min_price_percent into v_min from public.procedure_groups g where g.id = p_id;
  if v_min is not null and v_min > 100 + round(p_percent, 2) then
    raise exception 'MIN_ABOVE_PRICE';
  end if;
  update public.procedure_groups
     set price_adjust_percent = round(p_percent, 2),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
end;
$$;
revoke execute on function public.set_procedure_group_price(uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_procedure_group_price(uuid, numeric) to authenticated;

-- 3) A conta do mínimo na negociação (regra interna) ---------------------------------
-- Um motivo por pacote abaixo do mínimo, no mesmo texto que vai ao Gerente.
-- A mesma conta em TS: `pacotesAbaixoDoMinimo` (src/lib/procedimentos/grupos.ts).
create or replace function public._negotiation_package_floor(
  p_negotiation_id uuid,
  p_adjustment integer,
  p_discountable integer
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select pg.id, pg.name, pg.min_price_percent as minimo,
           sum(i.quantity * coalesce(i.list_price_cents, i.unit_price_cents))::numeric as tabela,
           sum(i.quantity * i.unit_price_cents)::numeric as preco,
           sum(case when coalesce(ni.program_discount_cents, 0) = 0
                    then i.quantity * i.unit_price_cents else 0 end)::numeric as descontavel
      from public.plan_negotiation_items ni
      join public.plan_negotiations n on n.id = ni.negotiation_id
      join public.treatment_plan_option_items i on i.id = ni.item_id and i.option_id = n.option_id
      join public.procedure_groups pg on pg.id = i.procedure_group_id
     where ni.negotiation_id = p_negotiation_id
       and ni.included
       and pg.min_price_percent is not null
     group by pg.id, pg.name, pg.min_price_percent
  ),
  c as (
    select name, minimo,
           preco + case when coalesce(p_adjustment, 0) < 0 and coalesce(p_discountable, 0) > 0
                        then round(p_adjustment::numeric * descontavel / p_discountable)
                        else 0 end as cobrado,
           ceil(tabela * minimo / 100) as piso
      from g
  )
  select coalesce(array_agg(format(
           '%s abaixo do mínimo: %s (mínimo %s, %s%% da tabela)',
           case when name ~* '^pacote\M' then name else 'Pacote ' || name end,
           public.brl(cobrado::bigint),
           public.brl(piso::bigint),
           replace(rtrim(rtrim(to_char(minimo, 'FM990.00'), '0'), '.'), '.', ','))
         order by name), '{}'::text[])
    from c
   where cobrado < piso;
$$;
revoke execute on function public._negotiation_package_floor(uuid, integer, integer) from public, anon, authenticated;

-- 4) A regra da negociação (0182) ganha o mínimo do pacote ---------------------------
-- Igual à 0182, exceto o passo GP7 antes de gravar.
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
  v_program integer;
  v_discountable integer;
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
  v_emp record;
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

  -- Totais: SÓ os itens da opção selecionada (0152). J7: o benefício do
  -- programa é somado à parte, e a base do desconto manual exclui os itens que
  -- já recebem benefício (decisão do dono, 25/07/2026).
  select
    coalesce(sum(case when ni.included
                      then i.quantity * i.unit_price_cents else 0 end), 0),
    coalesce(sum(case when ni.included
                      then ni.program_discount_cents else 0 end), 0),
    coalesce(sum(case when ni.included and coalesce(ni.program_discount_cents, 0) = 0
                      then i.quantity * i.unit_price_cents else 0 end), 0),
    count(*) filter (where not ni.included)
    into v_subtotal, v_program, v_discountable, v_excluded
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items i on i.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and i.option_id = v_neg.option_id;

  -- Total autoritativo: o que o cliente paga de fato.
  v_final := greatest(0, v_subtotal - v_program + v_neg.adjustment_cents);

  select coalesce(u.max_discount_percent, n.max_discount_percent),
         coalesce(u.max_installments, n.max_installments),
         coalesce(u.allowed_methods, n.allowed_methods)
    into v_max_disc, v_max_inst, v_methods
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_neg.clinic_id
  left join public.commercial_rules n on n.clinic_id is null;

  -- J5: Risarte Empresarial — formas de pagamento e parcelamento da EMPRESA.
  select * into v_emp from public.empresarial_client_conditions(v_neg.client_id);
  if v_emp.max_installments is not null then
    v_max_inst := greatest(coalesce(v_max_inst, 1), v_emp.max_installments);
    if v_methods is not null then
      if v_emp.allowed_methods is null then
        v_methods := null;
      else
        select array(select distinct unnest(v_methods || v_emp.allowed_methods))
          into v_methods;
      end if;
    end if;
  end if;

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

  -- J7: o desconto manual é medido sobre a base DESCONTÁVEL (sem os itens que
  -- já têm benefício do programa) — antes era sobre o subtotal cheio, o que
  -- deixava passar desconto acima do teto real.
  v_discount_pct := case
    when v_discountable > 0 and v_neg.adjustment_cents < 0
      then (-v_neg.adjustment_cents)::numeric * 100 / v_discountable
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
  if v_neg.installments > 1 and v_neg.payment_method is not null then
    v_min_cents := public.commercial_min_installment_cents(
      v_neg.clinic_id, v_neg.payment_method);
    if v_ppr.min_installment_cents is not null then
      v_min_cents := greatest(coalesce(v_min_cents, 0), v_ppr.min_installment_cents);
      v_min_cents := nullif(v_min_cents, 0);
    end if;
    if v_min_cents is not null and v_final > 0 then
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

  -- GP7 (0326): pacote abaixo do mínimo pede a autorização do Gerente.
  v_violations := v_violations
    || public._negotiation_package_floor(p_negotiation_id, v_neg.adjustment_cents, v_discountable);

  update public.plan_negotiations set
    subtotal_cents = v_subtotal,
    program_discount_cents = v_program,
    final_cents = v_final,
    is_partial = (v_excluded > 0),
    rule_authorized = case when p_from_consultant then false else rule_authorized end,
    rule_violations = case when array_length(v_violations, 1) > 0
                           then array_to_string(v_violations, '; ') else null end,
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

revoke execute on function public.evaluate_negotiation_rules(uuid, boolean) from public, anon, authenticated;
grant execute on function public.evaluate_negotiation_rules(uuid, boolean) to authenticated;
