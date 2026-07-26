-- =============================================================================
-- Risarte Odontologia — Migration 0167 (PPR+ acima da regra da unidade no BANCO
-- + código do cliente por programa + notificação da adesão)
--
-- Ajustes do teste (dono, 25/07/2026):
--   1) A negociação continuava recusando parcelamento/boleto do plano porque a
--      validação roda no BANCO (evaluate_negotiation_rules) e ela só olhava a
--      regra da rede/unidade. Agora ela soma as condições do PPR+ do cliente.
--   2) Cliente que entra pelo PPR+ recebe código começando com **PPR**; pelo
--      Risarte Empresarial, com **PRE** (next_client_code_prefixed).
-- Idempotente.
-- =============================================================================

-- 1) Condições do PPR+ de um cliente (para uso dentro do banco) ---------------
create or replace function public.ppr_client_conditions(p_client_id uuid)
returns table (
  max_installments integer,
  allowed_methods text[],
  top_discount_percent numeric
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
    )
  from public.ppr_beneficiaries b
  join public.ppr_memberships m on m.id = b.membership_id
  join public.ppr_plans p on p.id = m.plan_id
  where b.client_id = p_client_id
    and b.left_at is null
    and m.status = 'ativo'
  limit 1;
$$;

grant execute on function public.ppr_client_conditions(uuid) to authenticated;

-- 2) Regras da negociação considerando o plano do cliente ---------------------
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

  -- PPR+ é SUPERIOR: amplia parcelas, formas de pagamento e teto de desconto.
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
    if v_max_disc is not null then
      v_max_disc := greatest(v_max_disc, coalesce(v_ppr.top_discount_percent, 0));
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

-- 3) Código do cliente por programa (PPR / PRE) -------------------------------
-- Mesmo contador da unidade, com o prefixo do programa no lugar do código da
-- clínica: assim dá para saber, olhando o código, por onde o cliente entrou.
create or replace function public.next_client_code_prefixed(
  p_clinic_id uuid,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq integer;
begin
  insert into public.clinic_client_counters (clinic_id, last_value)
  values (p_clinic_id, 1)
  on conflict (clinic_id)
  do update set last_value = public.clinic_client_counters.last_value + 1
  returning last_value into v_seq;

  return coalesce(nullif(btrim(p_prefix), ''), 'RIS')
    || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

grant execute on function public.next_client_code_prefixed(uuid, text) to authenticated;
