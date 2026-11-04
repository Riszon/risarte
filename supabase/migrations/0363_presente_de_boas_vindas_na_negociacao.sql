-- =============================================================================
-- 0363 — O PRESENTE DE BOAS-VINDAS DO INDICA +RISOS NA NEGOCIAÇÃO (AP24, core)
--
-- Decisões do dono (04/11/2026), docs/indica-mais-risos/AP24-PLANO.md:
--   * I1: o Consultor APLICA o presente com um botão (não entra sozinho);
--   * I2: o desconto do presente é POR FORA da regra comercial (como o PPR+ e
--     o Empresarial) — não conta no limite de desconto nem pede o Gerente;
--   * I3: a validade conta do comparecimento à avaliação.
--
-- Esta é a parte do NÚCLEO (o resto — quem pode receber, a validade, o "usado
-- uma vez" — mora na 2011, no schema indica):
--   1) três colunas em `plan_negotiations`: o percentual aplicado, a indicação
--      de onde ele vem e o valor calculado;
--   2) uma trava: elas só mudam pela porta (`indica.aplicar_presente`, 2011) e
--      pela regra comercial — nunca direto pela API;
--   3) `evaluate_negotiation_rules` (a da 0334) tira o presente do total.
--
-- ⚠️ Ao recriar `evaluate_negotiation_rules`, levar o `v_presente` (régua em
-- `presente-do-indicado.test.ts`).
--
-- Nada apaga. Idempotente.
-- =============================================================================

-- 1) As colunas -----------------------------------------------------------------
alter table public.plan_negotiations
  add column if not exists indica_presente_percent numeric(5, 2)
    check (indica_presente_percent is null or (indica_presente_percent > 0 and indica_presente_percent <= 100)),
  -- Sem chave estrangeira de propósito: o schema indica nasce depois (2000+)
  -- numa reconstrução do zero. A 2011 confere a indicação ao aplicar.
  add column if not exists indica_indicacao_id uuid,
  add column if not exists indica_presente_cents integer not null default 0
    check (indica_presente_cents >= 0);

-- 2) A trava ---------------------------------------------------------------------
create or replace function public.plan_negotiations_presente_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('risarte.presente_indica', true), '') = 'sim' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.indica_presente_percent is not null or new.indica_indicacao_id is not null
       or coalesce(new.indica_presente_cents, 0) <> 0 then
      raise exception 'INDICA_PRESENTE_PELA_PORTA: o presente de boas-vindas só é aplicado pelo botão da negociação.';
    end if;
  elsif new.indica_presente_percent is distinct from old.indica_presente_percent
     or new.indica_indicacao_id is distinct from old.indica_indicacao_id
     or new.indica_presente_cents is distinct from old.indica_presente_cents then
    raise exception 'INDICA_PRESENTE_PELA_PORTA: o presente de boas-vindas só é aplicado pelo botão da negociação.';
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_negotiations_presente_guard() from public, anon, authenticated;

drop trigger if exists plan_negotiations_presente_guard on public.plan_negotiations;
create trigger plan_negotiations_presente_guard
  before insert or update on public.plan_negotiations
  for each row execute function public.plan_negotiations_presente_guard();

-- 3) A regra comercial tira o presente do total --------------------------------
-- A definição em vigor (0334), com as trocas marcadas "AP24".
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
  v_presente integer := 0;
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

  -- AP24 (0363): o PRESENTE DE BOAS-VINDAS do Indica +Risos (decisões I1–I3
  -- do dono, 04/11/2026). Percentual sobre o que o cliente pagaria depois do
  -- benefício do programa; POR FORA da regra comercial (I2): não entra no %
  -- do desconto, como o PPR+ e o Empresarial. Espelho em TS:
  -- `presenteDoIndicadoCents` (src/lib/indica/presente.ts).
  if v_neg.indica_presente_percent is not null and v_neg.indica_presente_percent > 0 then
    v_presente := round(greatest(0, v_subtotal - v_program)::numeric
                        * v_neg.indica_presente_percent / 100)::integer;
  end if;

  -- Total autoritativo: o que o cliente paga de fato.
  v_final := greatest(0, v_subtotal - v_program + v_neg.adjustment_cents - v_presente);

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
  -- PM (0327): procedimento abaixo do mínimo também pede o Gerente.
  v_violations := v_violations
    || public._negotiation_procedure_floor(p_negotiation_id, v_neg.adjustment_cents, v_discountable);
  -- ORTO8 (0334): o acordo ortodôntico também tem limites (Q4).
  v_violations := v_violations
    || public._negotiation_ortho_violations(p_negotiation_id);

  -- A porta do presente (0363): só esta função grava o valor calculado.
  perform set_config('risarte.presente_indica', 'sim', true);
  update public.plan_negotiations set
    indica_presente_cents = v_presente,
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
  perform set_config('risarte.presente_indica', '', true);

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

-- Conferência (só leitura) ------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_negotiations'
      and column_name in ('indica_presente_percent', 'indica_indicacao_id', 'indica_presente_cents')) as colunas_3,
  exists (select 1 from pg_trigger where tgname = 'plan_negotiations_presente_guard') as trava_existe,
  position('v_presente' in pg_get_functiondef('public.evaluate_negotiation_rules(uuid, boolean)'::regprocedure)) > 0
    as regra_conhece_o_presente,
  has_function_privilege('anon', 'public.evaluate_negotiation_rules(uuid, boolean)', 'execute') as sem_login_esperado_false;
