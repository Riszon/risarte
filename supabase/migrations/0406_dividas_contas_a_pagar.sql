-- =============================================================================
-- 0406 — LEVANTAMENTO DE DÍVIDAS, FASE 3: INTEGRAÇÃO COM O CONTAS A PAGAR
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/Financeiro/DIVIDAS-PLANO.md
-- (1.3, 2.3, fase 3; decisões D1, D5, D6, D7, D8 e ajustes 2, 3 e 4).
--
--   * CONTAS NOVAS (D5, "a validar com o contador"): 5.5 Dívidas — passivo
--     (fora da DRE): 5.5.01 Saldo de implantação e 5.5.02 Acordos de dívidas;
--     4.1.03 Descontos obtidos; 3.3.05 Custas cartoriais e de cobrança.
--   * A REGRA "FORA DO RESULTADO" NUM LUGAR SÓ (D5, ajuste 4):
--     `account_outside_result(code)` (6, 5.1, 5.3, 5.4 e agora 5.5) e
--     `account_cash_activity(code)` (5.5 = linha própria "dividas", ajuste 3).
--     As 9 funções que leem o razão passam a chamá-las no lugar do trecho
--     repetido — cada uma é a definição mais recente dela, com SÓ esse trecho
--     trocado (gerado por script e conferido no ensaio contra o banco).
--   * TÍTULOS DA DÍVIDA (fonte única: o título é do Contas a Pagar, o
--     pagamento é do Contas a Pagar; a dívida só aponta):
--       A (anterior à implantação): 1 título, conta de saldo (5.5.01, ou 5.3.01
--         nas categorias de empréstimo), valor ATUALIZADO (D7), competência =
--         data de implantação (o saldo de abertura é a posição naquele dia —
--         por isso não cai em mês fechado), marcado `opening_balance`.
--       B (nova): 1 título na conta de DESPESA da categoria, competência da
--         dívida → entra na DRE do mês.
--       C (já lançada): só vincula títulos que já existem.
--     Sem alçada (D8): o lançamento pelo Financeiro da Franqueadora é o ato de
--     autorizar. Juros e multa entram quando pagos (D6, 4.2.01 na baixa).
--   * O título gerado só muda pela dívida (trava `payables_debt_guard`):
--     editar a dívida atualiza o título não pago; excluir cancela o título
--     gerado (recusa se já houver pagamento) e desvincula o vinculado.
--   * Todos os títulos pagos → situação "Quitada — pendências de baixa".
--   * `cash_overdue` separa o saldo de implantação (D1-c): uma linha por CNPJ,
--     nunca um aviso por título.
--
-- Muda o retorno de `cash_overdue` (drop + create). Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CONTAS NOVAS (a validar com o contador)
-- -----------------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic) values
  ('5.5',    'Dívidas — passivo (fora da DRE)',          '5',   'expense', 'investment', 'none',     'both', false),
  ('5.5.01', 'Saldo de implantação — dívidas anteriores', '5.5', 'expense', 'investment', 'none',     'both', true),
  ('5.5.02', 'Acordos de dívidas — principal',           '5.5', 'expense', 'investment', 'none',     'both', true),
  ('4.1.03', 'Descontos obtidos',                        '4.1', 'revenue', 'financial',  'none',     'both', true),
  ('3.3.05', 'Custas cartoriais e de cobrança',          '3.3', 'expense', 'operational', 'variable', 'both', true)
on conflict (code) do nothing;

-- As categorias de empréstimo usam a conta de empréstimo que já existe (D5);
-- as demais, o saldo de implantação. Só preenche o vazio.
update public.debt_categories
   set opening_account_code = case
         when name in ('Empréstimos e financiamentos', 'Capital de giro / limite / cheque especial',
                       'Antecipação de recebíveis') then '5.3.01'
         else '5.5.01' end
 where parent_id is null and system and opening_account_code is null;

-- -----------------------------------------------------------------------------
-- 2) A REGRA ÚNICA (espelho: `contaForaDoResultado` / `atividadeDoCaixa` em
--    src/lib/finance/regra-do-resultado.ts — régua `regra-fora-do-resultado.test.ts`)
-- -----------------------------------------------------------------------------
-- Fora do resultado: ativos (6), compra de bens (5.1), empréstimo (5.3),
-- distribuição (5.4) e dívidas — passivo (5.5). A DRE, o ponto de equilíbrio,
-- o orçado × realizado, o consolidado, a hora clínica e a ponte não contam.
create or replace function public.account_outside_result(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_code, '') like '6%'
      or coalesce(p_code, '') like '5.1%'
      or coalesce(p_code, '') like '5.3%'
      or coalesce(p_code, '') like '5.4%'
      or coalesce(p_code, '') like '5.5%';
$$;
revoke execute on function public.account_outside_result(text) from public, anon, authenticated;
grant execute on function public.account_outside_result(text) to authenticated;

-- A atividade do fluxo de caixa: dívidas antigas e acordos em linha PRÓPRIA
-- (ajuste 3), separada da operação, no realizado e no previsto.
create or replace function public.account_cash_activity(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_code, '') like '5.5%' then 'dividas'
    when coalesce(p_code, '') like '5.1%' or coalesce(p_code, '') like '6.3%' then 'investimento'
    when coalesce(p_code, '') like '5.3%' or coalesce(p_code, '') like '5.4%' then 'financiamento'
    else 'operacional'
  end;
$$;
revoke execute on function public.account_cash_activity(text) from public, anon, authenticated;
grant execute on function public.account_cash_activity(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) OS LEITORES DO RAZÃO passam a usar a regra única
-- -----------------------------------------------------------------------------
-- _dre_lines_raw: definição da 0320_metas_m3_eficiencia.sql, com a regra única no lugar do trecho repetido.
create or replace function public._dre_lines_raw(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_cost_center_id uuid default null
)
returns table (
  account_code text,
  account_name text,
  block text,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.account_code,
    coalesce(max(a.name), e.account_code),
    case
      when e.account_code like '1.9%' then 'deducoes'
      when e.account_code like '1%'   then 'receita_bruta'
      when e.account_code like '2%'   then 'custos_diretos'
      when e.account_code like '3%'   then 'despesas_operacionais'
      when e.account_code like '4%'   then 'resultado_financeiro'
      when e.account_code like '5.2%' then 'depreciacao'
      else 'fora'
    end,
    -- O SINAL VEM DA DIREÇÃO: entrada soma, saída subtrai.
    sum(case when e.direction = 'inflow'
             then e.amount_cents else -e.amount_cents end)::bigint
  from public.financial_entries e
  left join public.chart_of_accounts a on a.code = e.account_code
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    -- LIQUIDAÇÃO NÃO É COMPETÊNCIA (0226): estas duas origens são o caixa.
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
    and not public.account_outside_result(e.account_code)
  group by e.account_code
  having sum(case when e.direction = 'inflow'
                  then e.amount_cents else -e.amount_cents end) <> 0
  order by e.account_code;
$$;

-- breakeven_lines_raw: definição da 0230_finance_alerts.sql, com a regra única no lugar do trecho repetido.
create or replace function public.breakeven_lines_raw(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_cost_center_id uuid default null
)
returns table (
  account_code text,
  account_name text,
  role text,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.account_code,
    coalesce(max(a.name), e.account_code),
    case
      when e.account_code like '1.9%' then 'deducao'
      when e.account_code like '1%'   then 'receita'
      when e.account_code like '5.2%' then 'depreciacao'
      when e.account_code like '4.1%' then 'receita_financeira'
      when max(a.cost_behavior) = 'variable' then 'variavel'
      when max(a.cost_behavior) = 'fixed'    then 'fixo'
      else 'fora'
    end,
    sum(case when e.direction = 'inflow'
             then e.amount_cents else -e.amount_cents end)::bigint
  from public.financial_entries e
  left join public.chart_of_accounts a on a.code = e.account_code
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
    and not public.account_outside_result(e.account_code)
  group by e.account_code
  having sum(case when e.direction = 'inflow'
                  then e.amount_cents else -e.amount_cents end) <> 0
  order by e.account_code;
$$;

-- profit_cash_bridge: definição da 0228_breakeven_and_bridge.sql, com a regra única no lugar do trecho repetido.
create or replace function public.profit_cash_bridge(
  p_clinic_id uuid,
  p_from date,
  p_to date
)
returns table (
  side text,
  account_code text,
  account_name text,
  source_type text,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.can_see_clinic_finance(p_clinic_id) as ok
  ),
  -- O que a DRE conta no período (mesmo recorte da 0226).
  dre as (
    select
      e.id,
      e.account_code,
      e.source_type,
      (case when e.direction = 'inflow'
            then e.amount_cents else -e.amount_cents end)::bigint as v,
      (e.cash_date is not null
        and e.cash_date between p_from and p_to) as has_cash
    from public.financial_entries e, allowed
    where allowed.ok
      and e.clinic_id = p_clinic_id
      and e.accrual_date between p_from and p_to
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and not public.account_outside_result(e.account_code)
  ),
  -- O que o caixa conta no período (mesmo recorte da 0227).
  cash as (
    select
      e.id,
      e.account_code,
      e.source_type,
      (case when e.direction = 'inflow'
            then e.amount_cents else -e.amount_cents end)::bigint as v,
      exists (select 1 from dre d where d.id = e.id) as in_dre
    from public.financial_entries e, allowed
    where allowed.ok
      and e.clinic_id = p_clinic_id
      and e.cash_date between p_from and p_to
      and e.status = 'settled'
      and e.reversal_of is null
  )
  select 'lucro'::text, null::text, null::text, null::text,
         coalesce(sum(v), 0)::bigint
    from dre

  union all

  select 'dre_only'::text, d.account_code,
         coalesce(max(a.name), d.account_code), d.source_type,
         sum(d.v)::bigint
    from dre d
    left join public.chart_of_accounts a on a.code = d.account_code
   where not d.has_cash
   group by d.account_code, d.source_type
  having sum(d.v) <> 0

  union all

  select 'cash_only'::text, c.account_code,
         coalesce(max(a.name), c.account_code), c.source_type,
         sum(c.v)::bigint
    from cash c
    left join public.chart_of_accounts a on a.code = c.account_code
   where not c.in_dre
   group by c.account_code, c.source_type
  having sum(c.v) <> 0

  union all

  select 'caixa'::text, null::text, null::text, null::text,
         coalesce(sum(v), 0)::bigint
    from cash;
$$;

-- budget_vs_actual: definição da 0229_budget.sql, com a regra única no lugar do trecho repetido.
create or replace function public.budget_vs_actual(
  p_clinic_id uuid,
  p_year integer,
  p_month integer
)
returns table (
  account_code text,
  account_name text,
  block text,
  budget_cents bigint,
  actual_cents bigint,
  ytd_budget_cents bigint,
  ytd_actual_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.can_see_clinic_finance(p_clinic_id) as ok
  ),
  -- Mesmo recorte da DRE (0226): competência, sem liquidação, sem ativo.
  actual as (
    select
      e.account_code,
      sum(case when extract(month from e.accrual_date) = p_month
               then (case when e.direction = 'inflow'
                          then e.amount_cents else -e.amount_cents end)
               else 0 end)::bigint as m,
      sum(case when e.direction = 'inflow'
               then e.amount_cents else -e.amount_cents end)::bigint as ytd
    from public.financial_entries e, allowed
    where allowed.ok
      and e.clinic_id = p_clinic_id
      and extract(year from e.accrual_date) = p_year
      and extract(month from e.accrual_date) <= p_month
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and not public.account_outside_result(e.account_code)
    group by e.account_code
  ),
  budget as (
    select
      b.account_code,
      sum(case when b.month = p_month then b.amount_cents else 0 end)::bigint as m,
      sum(b.amount_cents)::bigint as ytd
    from public.budget_lines b, allowed
    where allowed.ok
      and b.clinic_id = p_clinic_id
      and b.year = p_year
      and b.month <= p_month
    group by b.account_code
  )
  select
    coalesce(a.account_code, b.account_code),
    coalesce(c.name, coalesce(a.account_code, b.account_code)),
    case
      when coalesce(a.account_code, b.account_code) like '1.9%' then 'deducoes'
      when coalesce(a.account_code, b.account_code) like '1%'   then 'receita_bruta'
      when coalesce(a.account_code, b.account_code) like '2%'   then 'custos_diretos'
      when coalesce(a.account_code, b.account_code) like '3%'   then 'despesas_operacionais'
      when coalesce(a.account_code, b.account_code) like '4%'   then 'resultado_financeiro'
      when coalesce(a.account_code, b.account_code) like '5.2%' then 'depreciacao'
      else 'fora'
    end,
    coalesce(b.m, 0)::bigint,
    coalesce(a.m, 0)::bigint,
    coalesce(b.ytd, 0)::bigint,
    coalesce(a.ytd, 0)::bigint
  from actual a
  full outer join budget b on b.account_code = a.account_code
  left join public.chart_of_accounts c
    on c.code = coalesce(a.account_code, b.account_code)
  where coalesce(a.m, 0) <> 0 or coalesce(b.m, 0) <> 0
     or coalesce(a.ytd, 0) <> 0 or coalesce(b.ytd, 0) <> 0
  order by 1;
$$;

-- fill_budget_from_actual: definição da 0229_budget.sql, com a regra única no lugar do trecho repetido.
create or replace function public.fill_budget_from_actual(
  p_clinic_id uuid,
  p_to_year integer,
  p_months_back integer default 3,
  p_percent numeric default 0,
  p_overwrite boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer := 0;
  v_from date := (date_trunc('month', public.today_br())
                  - (greatest(coalesce(p_months_back, 3), 1) || ' months')::interval)::date;
  v_to date := (date_trunc('month', public.today_br()) - interval '1 day')::date;
  v_months integer := greatest(coalesce(p_months_back, 3), 1);
begin
  if not (public.is_admin_master() or public.can_post_finance(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_overwrite then
    delete from public.budget_lines
     where clinic_id = p_clinic_id and year = p_to_year;
  end if;

  insert into public.budget_lines
    (clinic_id, year, month, account_code, amount_cents, created_by, updated_by)
  select
    p_clinic_id, p_to_year, m.month, a.account_code,
    round(a.media * (1 + coalesce(p_percent, 0) / 100.0))::bigint,
    v_user, v_user
  from (
    select
      e.account_code,
      sum(case when e.direction = 'inflow'
               then e.amount_cents else -e.amount_cents end)::numeric / v_months
        as media
    from public.financial_entries e
    where e.clinic_id = p_clinic_id
      and e.accrual_date between v_from and v_to
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and not public.account_outside_result(e.account_code)
    group by e.account_code
    having sum(case when e.direction = 'inflow'
                    then e.amount_cents else -e.amount_cents end) <> 0
  ) a
  cross join (select generate_series(1, 12) as month) m
  on conflict (clinic_id, year, month, account_code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- consolidated_dre: definição da 0236_consolidation.sql, com a regra única no lugar do trecho repetido.
create or replace function public.consolidated_dre(
  p_from date,
  p_to date,
  p_scope text default 'grupo'
)
returns table (
  account_code text,
  account_name text,
  block text,
  amount_cents bigint,
  eliminated_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with permitido as (
    select (public.is_admin_master() or public.is_finance_franchisor()) as ok
  ),
  franqueadora as (
    select id from public.clinics where type = 'franchisor' limit 1
  ),
  escopo as (
    select c.id
    from public.clinics c
    where c.is_active
      and case
        -- O grupo: a franqueadora e as unidades próprias.
        when p_scope = 'grupo'
          then c.type = 'franchisor' or c.ownership = 'own'
        -- A rede: as unidades. A franqueadora não é uma unidade.
        else c.type <> 'franchisor'
      end
  ),
  base as (
    select
      e.id,
      e.clinic_id,
      e.account_code,
      e.source_type,
      e.source_id,
      coalesce(a.nature, '') as nature,
      (case when e.direction = 'inflow'
            then e.amount_cents else -e.amount_cents end)::bigint as v
    from public.financial_entries e
    left join public.chart_of_accounts a on a.code = e.account_code
    where (select ok from permitido)
      and e.clinic_id in (select id from escopo)
      and e.accrual_date between p_from and p_to
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and not public.account_outside_result(e.account_code)
  ),
  marcado as (
    select
      b.*,
      case
        -- Só no grupo se elimina: a rede é comparação, não consolidação.
        when p_scope <> 'grupo' then false
        when b.nature <> 'intercompany' then false
        -- Unidade do grupo pagando taxa: o outro lado é a franqueadora, que
        -- está no grupo por definição.
        when b.clinic_id <> (select id from franqueadora) then true
        -- Receita da franqueadora: elimina só o que veio de unidade DO GRUPO.
        when b.source_type = 'network_fee_revenue' then exists (
          select 1 from public.payables p
           where p.id = b.source_id and p.clinic_id in (select id from escopo)
        )
        when b.source_type = 'network_fee_discount' then exists (
          select 1 from public.payable_payments pp
          join public.payables p on p.id = pp.payable_id
           where pp.id = b.source_id and p.clinic_id in (select id from escopo)
        )
        -- Sem origem rastreável, não elimina (ver cabeçalho).
        else false
      end as eliminado
    from base b
  )
  select
    m.account_code,
    coalesce(max(a.name), m.account_code),
    case
      when m.account_code like '1.9%' then 'deducoes'
      when m.account_code like '1%'   then 'receita_bruta'
      when m.account_code like '2%'   then 'custos_diretos'
      when m.account_code like '3%'   then 'despesas_operacionais'
      when m.account_code like '4%'   then 'resultado_financeiro'
      when m.account_code like '5.2%' then 'depreciacao'
      else 'fora'
    end,
    -- Conta inteiramente eliminada devolve nulo no `filter`; sem o coalesce a
    -- linha apareceria vazia em vez de zerada.
    coalesce(sum(m.v) filter (where not m.eliminado), 0)::bigint,
    coalesce(sum(m.v) filter (where m.eliminado), 0)::bigint
  from marcado m
  left join public.chart_of_accounts a on a.code = m.account_code
  group by m.account_code
  having sum(m.v) <> 0
  order by m.account_code;
$$;

-- network_units_summary: definição da 0236_consolidation.sql, com a regra única no lugar do trecho repetido.
create or replace function public.network_units_summary(
  p_from date,
  p_to date
)
returns table (
  clinic_id uuid,
  clinic_name text,
  ownership text,
  gross_revenue_cents bigint,
  net_revenue_cents bigint,
  result_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.ownership,
    coalesce(sum(x.v) filter (
      where x.account_code like '1%' and x.account_code not like '1.9%'), 0)::bigint,
    coalesce(sum(x.v) filter (where x.account_code like '1%'), 0)::bigint,
    coalesce(sum(x.v), 0)::bigint
  from public.clinics c
  left join lateral (
    select
      e.account_code,
      (case when e.direction = 'inflow'
            then e.amount_cents else -e.amount_cents end)::bigint as v
    from public.financial_entries e
    where e.clinic_id = c.id
      and e.accrual_date between p_from and p_to
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and not public.account_outside_result(e.account_code)
  ) x on true
  where c.is_active
    and c.type <> 'franchisor'
    and (public.is_admin_master() or public.is_finance_franchisor())
  group by c.id, c.name, c.ownership
  order by 4 desc, c.name;
$$;

-- clinic_fixed_costs_by_month: definição da 0330_hora_clinica.sql, com a regra única no lugar do trecho repetido.
create or replace function public.clinic_fixed_costs_by_month(
  p_clinic uuid,
  p_from date,
  p_to date
)
returns table (
  month date,
  fixed_cents bigint,
  depreciation_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_clinic is null or not public.can_read_clinic_data(p_clinic) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
  select
    date_trunc('month', e.accrual_date)::date,
    coalesce(sum(case when e.account_code not like '5.2%'
                      then case when e.direction = 'outflow'
                                then e.amount_cents else -e.amount_cents end
                      else 0 end), 0)::bigint,
    coalesce(sum(case when e.account_code like '5.2%'
                      then case when e.direction = 'outflow'
                                then e.amount_cents else -e.amount_cents end
                      else 0 end), 0)::bigint
  from public.financial_entries e
  left join public.chart_of_accounts a on a.code = e.account_code
  where e.clinic_id = p_clinic
    and e.accrual_date between p_from and p_to
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and not public.account_outside_result(e.account_code)
    and e.account_code not like '1%'
    and e.account_code not like '4.1%'
    and (e.account_code like '5.2%' or a.cost_behavior = 'fixed')
  group by 1
  order by 1;
end;
$$;

-- cash_flow_series_raw: definição da 0301_conciliacao_transferencia_e_varios_lancamentos.sql, com a regra única no lugar do trecho repetido.
CREATE OR REPLACE FUNCTION public.cash_flow_series_raw(p_clinic_id uuid, p_from date, p_to date)
 RETURNS TABLE(day date, kind text, activity text, inflow_cents bigint, outflow_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    e.cash_date,
    'realizado'::text,
    public.account_cash_activity(e.account_code),
    sum(case when e.direction = 'inflow' then e.amount_cents else 0 end)::bigint,
    sum(case when e.direction = 'outflow' then e.amount_cents else 0 end)::bigint
  from public.financial_entries e
  where e.clinic_id = p_clinic_id
    and e.cash_date between p_from and p_to
    and e.status = 'settled'
    and e.reversal_of is null
  group by 1, 2, 3

  union all

  select
    coalesce(i.expected_settlement_date, i.due_date),
    'previsto'::text,
    'operacional'::text,
    sum(i.amount_cents - coalesce(i.paid_amount_cents, 0))::bigint,
    0::bigint
  from public.payment_installments i
  where i.clinic_id = p_clinic_id
    and i.status in ('em_aberto', 'parcial')
    and i.amount_cents > coalesce(i.paid_amount_cents, 0)
    and coalesce(i.expected_settlement_date, i.due_date)
        between greatest(p_from, public.today_br()) and p_to
  group by 1, 2, 3

  union all

  select
    p.due_date,
    'previsto'::text,
    public.account_cash_activity(p.account_code),
    0::bigint,
    sum(p.amount_cents - coalesce(p.paid_amount_cents, 0))::bigint
  from public.payables p
  where p.clinic_id = p_clinic_id
    and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
    and p.amount_cents > coalesce(p.paid_amount_cents, 0)
    and p.due_date between greatest(p_from, public.today_br()) and p_to
  group by 1, 2, 3;
$function$;

-- -----------------------------------------------------------------------------
-- 4) O TÍTULO SABE DE QUE DÍVIDA É
-- -----------------------------------------------------------------------------
alter table public.payables add column if not exists debt_id uuid references public.debts(id) on delete restrict;
alter table public.payables add column if not exists debt_link text;
alter table public.payables add column if not exists opening_balance boolean not null default false;
alter table public.payables drop constraint if exists payables_debt_link_check;
alter table public.payables add constraint payables_debt_link_check
  check ((debt_id is null and debt_link is null) or (debt_id is not null and debt_link in ('gerado', 'vinculado')));
create index if not exists payables_debt_idx on public.payables (debt_id) where debt_id is not null;
comment on column public.payables.debt_id is 'Dívida do Levantamento de Dívidas a que o título pertence (0406). gerado = nasceu da dívida; vinculado = já existia (origem C).';
comment on column public.payables.opening_balance is 'Saldo de implantação: dívida anterior à implantação do riSZon (origem A, 0406). Não gera aviso de vencida um a um (D1-c).';

-- O título GERADO pela dívida só muda pela dívida. Pagar continua livre.
create or replace function public.payables_debt_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  if coalesce(current_setting('risarte.debt_sync', true), '') = 'on' then
    return new;
  end if;
  -- Marca de dívida não se põe nem se tira por fora.
  if (new.debt_id, new.debt_link, new.opening_balance) is distinct from (old.debt_id, old.debt_link, old.opening_balance) then
    raise exception 'O vínculo do título com a dívida só muda pela tela do Levantamento de Dívidas.';
  end if;
  if old.debt_link = 'gerado' and (
       (new.amount_cents, new.due_date, new.account_code, new.accrual_date, new.clinic_id, new.supplier_id)
         is distinct from
       (old.amount_cents, old.due_date, old.account_code, old.accrual_date, old.clinic_id, old.supplier_id)
       or (new.status in ('cancelada', 'recusada') and old.status not in ('cancelada', 'recusada'))) then
    select code into v_code from public.debts where id = old.debt_id;
    raise exception 'Este título é da dívida %: altere ou exclua pela tela do Levantamento de Dívidas.', coalesce(v_code, '');
  end if;
  return new;
end;
$$;
drop trigger if exists payables_debt_guard on public.payables;
create trigger payables_debt_guard before update on public.payables
  for each row execute function public.payables_debt_guard();

-- -----------------------------------------------------------------------------
-- 5) A SITUAÇÃO passa a enxergar a quitação (fase 5 acrescenta o acordo)
-- -----------------------------------------------------------------------------
create or replace function public._debt_compute_status(p_debt_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.debts%rowtype;
  v_late integer;
  v_titulos integer;
  v_abertos integer;
begin
  select * into d from public.debts where id = p_debt_id;
  if not found then return null; end if;

  if d.manual_stage = 'baixada' then return 'baixada'; end if;

  -- Quitada: todos os títulos da dívida pagos (0406).
  if d.finance_synced_at is not null then
    select count(*), count(*) filter (where p.status <> 'paga')
      into v_titulos, v_abertos
      from public.payables p
     where p.debt_id = d.id and p.status not in ('cancelada', 'recusada');
    if v_titulos > 0 and v_abertos = 0 then return 'quitada_pendencias'; end if;
  end if;

  if d.manual_stage = 'contestada' then return 'contestada'; end if;
  if d.manual_stage = 'judicial' then return 'judicial'; end if;
  if d.manual_stage = 'em_negociacao' then return 'em_negociacao'; end if;

  v_late := public.today_br() - d.due_date;
  if v_late <= 0 then return 'a_vencer'; end if;
  if v_late <= public._debt_days_to_default(d.clinic_id, d.supplier_id) then return 'em_atraso'; end if;
  return 'inadimplente';
end;
$$;
revoke execute on function public._debt_compute_status(uuid) from public, anon, authenticated;

-- Pagou (ou estornou) um título de dívida: a situação da dívida acompanha.
create or replace function public.payables_debt_status_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.debt_id is not null and new.status is distinct from old.status then
    perform public._debt_refresh_status(new.debt_id, false);
  end if;
  return null;
end;
$$;
revoke execute on function public.payables_debt_status_sync() from public, anon, authenticated;
drop trigger if exists payables_debt_status_sync on public.payables;
create trigger payables_debt_status_sync after update of status on public.payables
  for each row execute function public.payables_debt_status_sync();

-- -----------------------------------------------------------------------------
-- 6) O QUE A DÍVIDA GERA NO FINANCEIRO (uma regra só, usada pela prévia e
--    pela gravação — espelho: `impactoNoFinanceiro` em src/lib/finance/dividas.ts)
-- -----------------------------------------------------------------------------
create or replace function public._debt_title_spec(p_debt_id uuid)
returns table (
  account_code text,
  amount_cents bigint,
  accrual_date date,
  due_date date,
  description text,
  opening_balance boolean,
  in_result boolean,
  problem text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.debts%rowtype;
  c public.debt_categories%rowtype;
  v_go_live date;
  v_conta text;
  v_valor bigint;
begin
  select * into d from public.debts where id = p_debt_id and deleted_at is null;
  if not found then return; end if;
  if d.category_id is not null then select * into c from public.debt_categories where id = d.category_id; end if;
  select go_live_on into v_go_live from public.clinics where id = d.clinic_id;

  if d.origin = 'C' then
    return query select null::text, null::bigint, null::date, d.due_date, null::text, false, false,
      'Origem C: vincule os títulos que já estão no Contas a Pagar.'::text;
    return;
  end if;

  if d.origin = 'A' then
    v_conta := coalesce(d.account_code, c.opening_account_code, '5.5.01');
    v_valor := coalesce(d.updated_cents, d.original_cents);
    if not public.account_outside_result(v_conta) then
      return query select v_conta, v_valor, null::date, d.due_date, null::text, true, false,
        'Dívida anterior à implantação precisa de conta de saldo (fora da DRE), como a 5.5.01. Troque a conta da dívida.'::text;
      return;
    end if;
    return query select v_conta, v_valor, coalesce(v_go_live, public.today_br()), d.due_date,
      ('Dívida ' || d.code || coalesce(' · ' || d.installment_label, '') || ' · saldo de implantação')::text,
      true, false, null::text;
    return;
  end if;

  -- B: despesa nova, entra na DRE na competência da dívida.
  v_conta := coalesce(d.account_code, c.expense_account_code);
  v_valor := coalesce(d.original_cents, d.updated_cents);
  if v_conta is null then
    return query select null::text, v_valor, null::date, d.due_date, null::text, false, true,
      'Dívida nova precisa da conta de despesa: escolha na dívida ou configure na categoria.'::text;
    return;
  end if;
  if public.account_outside_result(v_conta) then
    return query select v_conta, v_valor, null::date, d.due_date, null::text, false, true,
      'Dívida nova é despesa: a conta não pode ser de saldo (fora da DRE).'::text;
    return;
  end if;
  return query select v_conta, v_valor, coalesce(d.accrual_month, d.issue_date, d.due_date), d.due_date,
    ('Dívida ' || d.code || coalesce(' · ' || d.installment_label, ''))::text, false, true, null::text;
end;
$$;
revoke execute on function public._debt_title_spec(uuid) from public, anon, authenticated;

-- A prévia do impacto (3.1: "serão criados…"), para a tela mostrar antes.
create or replace function public.debt_finance_preview(p_debt_id uuid)
returns table (
  account_code text,
  account_name text,
  amount_cents bigint,
  accrual_date date,
  due_date date,
  opening_balance boolean,
  in_result boolean,
  problem text,
  already_synced boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.account_code, a.name, s.amount_cents, s.accrual_date, s.due_date, s.opening_balance,
         s.in_result, s.problem, d.finance_synced_at is not null
    from public.debts d
    cross join lateral public._debt_title_spec(d.id) s
    left join public.chart_of_accounts a on a.code = s.account_code
   where d.id = p_debt_id
     and public.debt_can('modulo.dividas', d.clinic_id);
$$;
revoke execute on function public.debt_finance_preview(uuid) from public, anon, authenticated;
grant execute on function public.debt_finance_preview(uuid) to authenticated;

-- Cria (ou atualiza, se ainda não pago) o título da dívida. Interna: quem
-- chama já conferiu a guarda.
create or replace function public._debt_sync_finance(p_debt_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.debts%rowtype;
  s record;
  p public.payables%rowtype;
  v_id uuid;
begin
  select * into d from public.debts where id = p_debt_id and deleted_at is null for update;
  if not found then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if d.origin = 'C' then return null; end if;

  select * into s from public._debt_title_spec(p_debt_id);
  if s.problem is not null then raise exception '%', s.problem; end if;
  if coalesce(s.amount_cents, 0) <= 0 then raise exception 'A dívida precisa de valor para gerar o título.'; end if;

  perform set_config('risarte.debt_sync', 'on', true);

  select * into p from public.payables
   where debt_id = p_debt_id and debt_link = 'gerado' and status not in ('cancelada', 'recusada')
   order by created_at limit 1 for update;

  if not found then
    insert into public.payables (clinic_id, supplier_id, account_code, description, document_number,
      accrual_date, due_date, amount_cents, status, approval_mode, requires_approval,
      notes, created_by, debt_id, debt_link, opening_balance)
    values (d.clinic_id, d.supplier_id, s.account_code, s.description, d.contract_number,
      s.accrual_date, s.due_date, s.amount_cents, 'aberta', 'automatica', false,
      'Gerado pelo Levantamento de Dívidas.', v_uid, d.id, 'gerado', s.opening_balance)
    returning id into v_id;
    perform public.post_payable_accrual(v_id);
    update public.debts set finance_synced_at = now() where id = d.id;
    insert into public.debt_events (debt_id, user_id, kind, data)
    values (d.id, v_uid, 'titulo_gerado', jsonb_build_object('payable_id', v_id, 'account_code', s.account_code,
            'amount_cents', s.amount_cents, 'opening_balance', s.opening_balance));
  else
    v_id := p.id;
    if (p.amount_cents, p.account_code, p.accrual_date, p.due_date, p.clinic_id, p.supplier_id, p.description,
        coalesce(p.document_number, ''))
       is distinct from
       (s.amount_cents, s.account_code, s.accrual_date, s.due_date, d.clinic_id, d.supplier_id, s.description,
        coalesce(d.contract_number, '')) then
      if coalesce(p.paid_amount_cents, 0) > 0 then
        raise exception 'O título desta dívida já tem pagamento: valor, vencimento, conta e credor não mudam mais. Estorne o pagamento no Contas a Pagar antes.';
      end if;
      update public.payables
         set amount_cents = s.amount_cents, account_code = s.account_code, accrual_date = s.accrual_date,
             due_date = s.due_date, supplier_id = d.supplier_id, description = s.description,
             document_number = d.contract_number, opening_balance = s.opening_balance, updated_at = now()
       where id = p.id;
      -- O lançamento de competência acompanha (o refresh das taxas da rede faz igual).
      update public.financial_entries
         set amount_cents = s.amount_cents, account_code = s.account_code, accrual_date = s.accrual_date,
             expected_settlement_date = s.due_date, description = s.description
       where source_type = 'payable_accrual' and source_id = p.id and status = 'open';
      perform public.post_payable_accrual(p.id); -- se não existia, nasce agora
      insert into public.debt_events (debt_id, user_id, kind, data)
      values (d.id, v_uid, 'titulo_atualizado', jsonb_build_object('payable_id', p.id, 'amount_cents', s.amount_cents,
              'due_date', s.due_date));
    end if;
  end if;

  perform set_config('risarte.debt_sync', '', true);
  perform public._debt_refresh_status(d.id, false);
  return v_id;
end;
$$;
revoke execute on function public._debt_sync_finance(uuid) from public, anon, authenticated;

-- A porta: gerar no Contas a Pagar (origens A e B).
create or replace function public.debt_sync_finance(p_debt_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid := public._debt_clinic(p_debt_id);
begin
  if v_clinic is null then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para gerar títulos de dívidas.';
  end if;
  if (select origin from public.debts where id = p_debt_id) = 'C' then
    raise exception 'Origem C: vincule os títulos que já estão no Contas a Pagar.';
  end if;
  return public._debt_sync_finance(p_debt_id);
end;
$$;
revoke execute on function public.debt_sync_finance(uuid) from public, anon, authenticated;
grant execute on function public.debt_sync_finance(uuid) to authenticated;

-- Origem C: vincula títulos que já existem (não cria nada, ajuste 2).
create or replace function public.debt_link_payables(p_debt_id uuid, p_payable_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.debts%rowtype;
  v_n integer;
begin
  select * into d from public.debts where id = p_debt_id and deleted_at is null for update;
  if not found then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', d.clinic_id) then
    raise exception 'Você não tem permissão para vincular títulos.';
  end if;
  if d.origin <> 'C' then raise exception 'Só a origem C (já está no Contas a Pagar) vincula títulos.'; end if;
  if coalesce(array_length(p_payable_ids, 1), 0) = 0 then raise exception 'Escolha ao menos um título.'; end if;
  if exists (
       select 1 from unnest(p_payable_ids) x
        where not exists (
          select 1 from public.payables p
           where p.id = x and p.clinic_id = d.clinic_id and p.debt_id is null
             and p.status not in ('cancelada', 'recusada'))) then
    raise exception 'Algum título não é deste CNPJ, já é de outra dívida ou está cancelado.';
  end if;
  perform set_config('risarte.debt_sync', 'on', true);
  update public.payables set debt_id = d.id, debt_link = 'vinculado', updated_at = now()
   where id = any (p_payable_ids);
  get diagnostics v_n = row_count;
  perform set_config('risarte.debt_sync', '', true);
  update public.debts set finance_synced_at = coalesce(finance_synced_at, now()) where id = d.id;
  insert into public.debt_events (debt_id, user_id, kind, data)
  values (d.id, v_uid, 'titulo_vinculado', jsonb_build_object('payable_ids', to_jsonb(p_payable_ids)));
  perform public._debt_refresh_status(d.id, false);
  return v_n;
end;
$$;
revoke execute on function public.debt_link_payables(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.debt_link_payables(uuid, uuid[]) to authenticated;

-- Editar a dívida já gerada atualiza o título (na MESMA transação: se o
-- título já foi pago, a edição inteira é recusada).
create or replace function public.debts_finance_resync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null or new.finance_synced_at is null or new.origin = 'C' then
    return null;
  end if;
  if new.origin is distinct from old.origin then
    raise exception 'A origem não muda depois de gerar os títulos: exclua a dívida e lance de novo.';
  end if;
  if (new.clinic_id, new.supplier_id, new.account_code, new.category_id, new.original_cents, new.updated_cents,
      new.due_date, new.accrual_month, new.issue_date, new.installment_label, new.contract_number)
     is distinct from
     (old.clinic_id, old.supplier_id, old.account_code, old.category_id, old.original_cents, old.updated_cents,
      old.due_date, old.accrual_month, old.issue_date, old.installment_label, old.contract_number) then
    perform public._debt_sync_finance(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.debts_finance_resync() from public, anon, authenticated;
drop trigger if exists debts_finance_resync on public.debts;
create trigger debts_finance_resync after update on public.debts
  for each row when (old.finance_synced_at is not null)
  execute function public.debts_finance_resync();

-- -----------------------------------------------------------------------------
-- 7) EXCLUIR A DÍVIDA estorna o que ela gerou (e nunca o que já foi pago)
-- -----------------------------------------------------------------------------
create or replace function public.debt_delete(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.debts%rowtype;
  p record;
begin
  select * into d from public.debts where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Dívida não encontrada (ou já excluída).'; end if;
  if not public.debt_can('acao.dividas.excluir', d.clinic_id) then
    raise exception 'Você não tem permissão para excluir dívidas.';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escreva o motivo da exclusão.';
  end if;
  if exists (select 1 from public.payables
              where debt_id = p_id and debt_link = 'gerado' and coalesce(paid_amount_cents, 0) > 0
                and status not in ('cancelada', 'recusada')) then
    raise exception 'Esta dívida tem título com pagamento no Contas a Pagar: não pode ser excluída (o pagamento é do Financeiro). Estorne o pagamento antes, se foi lançado por engano.';
  end if;

  perform set_config('risarte.debt_sync', 'on', true);
  for p in select id from public.payables
            where debt_id = p_id and debt_link = 'gerado' and status not in ('cancelada', 'recusada') loop
    update public.payables
       set status = 'cancelada', cancel_reason = 'Dívida excluída: ' || btrim(p_reason),
           cancelled_by = v_uid, cancelled_at = now(), updated_at = now()
     where id = p.id;
    update public.financial_entries set status = 'cancelled'
     where source_type = 'payable_accrual' and source_id = p.id;
  end loop;
  -- Título que já existia (origem C) volta a ser só do Contas a Pagar.
  update public.payables set debt_id = null, debt_link = null, updated_at = now()
   where debt_id = p_id and debt_link = 'vinculado';
  perform set_config('risarte.debt_sync', '', true);

  update public.debts
     set deleted_at = now(), deleted_by = v_uid, deleted_reason = btrim(p_reason),
         updated_by = v_uid, updated_at = now()
   where id = p_id;
  insert into public.debt_events (debt_id, user_id, kind, note)
  values (p_id, v_uid, 'excluida', btrim(p_reason));
end;
$$;
revoke execute on function public.debt_delete(uuid, text) from public, anon, authenticated;
grant execute on function public.debt_delete(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) VENCIDO E NÃO PAGO: o saldo de implantação à parte (D1-c)
-- -----------------------------------------------------------------------------
drop function if exists public.cash_overdue(uuid);
create function public.cash_overdue(p_clinic_id uuid)
returns table (
  receivable_cents bigint,
  receivable_count integer,
  payable_cents bigint,
  payable_count integer,
  opening_cents bigint,
  opening_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(i.amount_cents - coalesce(i.paid_amount_cents, 0))
        from public.payment_installments i
       where i.clinic_id = p_clinic_id
         and i.status in ('em_aberto', 'parcial')
         and i.amount_cents > coalesce(i.paid_amount_cents, 0)
         and coalesce(i.expected_settlement_date, i.due_date) < public.today_br()
    ), 0)::bigint,
    coalesce((
      select count(*) from public.payment_installments i
       where i.clinic_id = p_clinic_id
         and i.status in ('em_aberto', 'parcial')
         and i.amount_cents > coalesce(i.paid_amount_cents, 0)
         and coalesce(i.expected_settlement_date, i.due_date) < public.today_br()
    ), 0)::integer,
    coalesce((
      select sum(p.amount_cents - coalesce(p.paid_amount_cents, 0))
        from public.payables p
       where p.clinic_id = p_clinic_id
         and not p.opening_balance
         and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
         and p.amount_cents > coalesce(p.paid_amount_cents, 0)
         and p.due_date < public.today_br()
    ), 0)::bigint,
    coalesce((
      select count(*) from public.payables p
       where p.clinic_id = p_clinic_id
         and not p.opening_balance
         and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
         and p.amount_cents > coalesce(p.paid_amount_cents, 0)
         and p.due_date < public.today_br()
    ), 0)::integer,
    coalesce((
      select sum(p.amount_cents - coalesce(p.paid_amount_cents, 0))
        from public.payables p
       where p.clinic_id = p_clinic_id
         and p.opening_balance
         and p.status in ('aberta', 'parcial')
         and p.amount_cents > coalesce(p.paid_amount_cents, 0)
         and p.due_date < public.today_br()
    ), 0)::bigint,
    coalesce((
      select count(*) from public.payables p
       where p.clinic_id = p_clinic_id
         and p.opening_balance
         and p.status in ('aberta', 'parcial')
         and p.amount_cents > coalesce(p.paid_amount_cents, 0)
         and p.due_date < public.today_br()
    ), 0)::integer
  where public.can_see_clinic_finance(p_clinic_id);
$$;
revoke execute on function public.cash_overdue(uuid) from public, anon, authenticated;
grant execute on function public.cash_overdue(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois): o esperado é 5 · true · false · dividas · 9
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from public.chart_of_accounts where code in ('5.5','5.5.01','5.5.02','4.1.03','3.3.05')) as contas,
--   public.account_outside_result('5.5.01') as saldo_fora,
--   public.account_outside_result('3.3.05') as custas_dentro,
--   public.account_cash_activity('5.5.02') as atividade,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and (pg_get_functiondef(p.oid) like '%account_outside_result(e.account_code)%'
--        or pg_get_functiondef(p.oid) like '%account_cash_activity(e.account_code)%')) as leitores;
