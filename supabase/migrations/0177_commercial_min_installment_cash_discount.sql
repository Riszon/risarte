-- =============================================================================
-- 0177 — I8: parcela mínima por meio de pagamento + desconto só à vista
-- -----------------------------------------------------------------------------
-- Pedidos do dono:
--   1. na regra comercial, definir o **valor mínimo da parcela para cada meio
--      de pagamento** (boleto, cartão parcelado etc.) — hoje o mínimo só existia
--      dentro do PPR+;
--   2. o **desconto automático vale só à vista** (ex.: 5%). No parcelado não
--      entra desconto automático nenhum: só o que o consultor aplicar à mão,
--      respeitando o teto de desconto da unidade.
--
-- Tudo em cascata (linha com clinic_id NULL = padrão da rede; a da unidade
-- sobrescreve campo a campo). Idempotente.
-- =============================================================================

alter table public.commercial_rules
  -- Desconto automático concedido quando o pagamento é à vista (1×).
  add column if not exists cash_discount_percent numeric(5,2)
    check (cash_discount_percent is null
           or (cash_discount_percent >= 0 and cash_discount_percent <= 100)),
  -- { "boleto": 15000, "cartao_parcelado": 10000 } — centavos por meio.
  add column if not exists min_installment_cents_by_method jsonb
    not null default '{}'::jsonb;

-- Parcela mínima efetiva (centavos) de um meio de pagamento numa unidade:
-- o valor da unidade vence o da rede; sem regra = sem mínimo (null).
create or replace function public.commercial_min_installment_cents(
  p_clinic uuid,
  p_method text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    coalesce(
      (select (u.min_installment_cents_by_method ->> p_method)::int
         from public.commercial_rules u where u.clinic_id = p_clinic),
      (select (n.min_installment_cents_by_method ->> p_method)::int
         from public.commercial_rules n where n.clinic_id is null)
    ), 0);
$$;

grant execute on function public.commercial_min_installment_cents(uuid, text)
  to authenticated;

-- Desconto automático à vista (%) efetivo da unidade.
create or replace function public.commercial_cash_discount_percent(p_clinic uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.cash_discount_percent from public.commercial_rules u
      where u.clinic_id = p_clinic),
    (select n.cash_discount_percent from public.commercial_rules n
      where n.clinic_id is null)
  );
$$;

grant execute on function public.commercial_cash_discount_percent(uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Validação da negociação: acrescenta a parcela mínima por meio de pagamento.
-- Mantém tudo o que a 0168 já fazia (PPR+ superior, teto pela faixa, à vista só
-- PIX/depósito).
-- -----------------------------------------------------------------------------
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
  if v_neg.installments > 1 and v_neg.payment_method is not null then
    v_min_cents := public.commercial_min_installment_cents(
      v_neg.clinic_id, v_neg.payment_method);
    -- O plano do PPR+ pode ter mínimo próprio; vale o MAIOR dos dois.
    if v_ppr.min_installment_cents is not null then
      v_min_cents := greatest(coalesce(v_min_cents, 0), v_ppr.min_installment_cents);
      v_min_cents := nullif(v_min_cents, 0);
    end if;
    if v_min_cents is not null and v_neg.final_cents is not null
       and v_neg.final_cents > 0 then
      v_installment_cents := ceil(v_neg.final_cents::numeric / v_neg.installments);
      if v_installment_cents < v_min_cents then
        v_violations := v_violations || format(
          'Parcela de R$ %s abaixo do mínimo de R$ %s para "%s"',
          to_char(v_installment_cents / 100.0, 'FM999G999D00'),
          to_char(v_min_cents / 100.0, 'FM999G999D00'),
          v_neg.payment_method);
      end if;
    end if;
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
