-- =============================================================================
-- 0228 — FIN6.3: ponto de equilíbrio e a ponte lucro × caixa
-- -----------------------------------------------------------------------------
-- Duas perguntas que fecham o Financeiro:
--   • Quanto preciso faturar para NÃO DAR PREJUÍZO?
--   • Deu lucro — então por que o caixa caiu?
--
-- FIXO × VARIÁVEL JÁ EXISTE. `chart_of_accounts.cost_behavior` está no banco
-- desde o FIN0, semeado (grupo 2 e impostos = variável; grupo 3 = fixo) e
-- EDITÁVEL na tela Plano de contas. Nenhuma coluna nova: a classificação é do
-- dono, não do código — margem de contribuição calculada sobre rótulo que
-- ninguém pode corrigir vira número errado com cara de oficial.
--
-- A PONTE FECHA POR CONSTRUÇÃO, NÃO POR ESTIMATIVA.
-- Em vez de estimar cada ajuste ("mais ou menos isto ficou a receber"), cada
-- lançamento do período cai em um de três baldes: só competência, só caixa, ou
-- os dois. Daí sai, exatamente:
--
--     variação do caixa = lucro − (só competência) + (só caixa)
--
-- porque a parte que está nos dois lados é literalmente a mesma soma dos dois
-- lados da conta. Se sobrar um centavo, existe lançamento que ninguém
-- classificou — e a tela mostra QUAL, em vez de fechar com uma linha "outros"
-- que esconde erro.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) AS LINHAS DO PONTO DE EQUILÍBRIO
-- -----------------------------------------------------------------------------
-- Mesmo recorte da DRE (0226): competência, sem liquidação, sem ativo. O papel
-- de cada conta sai do `cost_behavior`, com duas exceções que precisam vir
-- antes dele:
--   • 5.2 depreciação — é fixa, mas precisa ficar separada: sem ela sai o
--     ponto de equilíbrio DE CAIXA, que responde a outra pergunta.
--   • 4.1 receitas financeiras — não é faturamento; entra abatendo o custo
--     fixo. Somá-la à receita inflaria a base e faria o ponto parecer mais
--     perto do que está.
create or replace function public.breakeven_lines(
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
    and e.account_code not like '6%'
    and e.account_code not like '5.1%'
    and e.account_code not like '5.3%'
    and e.account_code not like '5.4%'
    and public.can_see_clinic_finance(p_clinic_id)
  group by e.account_code
  having sum(case when e.direction = 'inflow'
                  then e.amount_cents else -e.amount_cents end) <> 0
  order by e.account_code;
$$;

grant execute on function public.breakeven_lines(uuid, date, date, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A PONTE LUCRO × CAIXA
-- -----------------------------------------------------------------------------
-- Devolve quatro lados:
--   'lucro'     — uma linha, o resultado do período (o que a DRE mostra)
--   'dre_only'  — está no resultado e NÃO virou dinheiro neste período
--   'cash_only' — virou dinheiro e NÃO está no resultado deste período
--   'caixa'     — uma linha, a variação do caixa (o que o fluxo mostra)
-- E vale sempre: caixa = lucro − soma(dre_only) + soma(cash_only).
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
      and e.account_code not like '6%'
      and e.account_code not like '5.1%'
      and e.account_code not like '5.3%'
      and e.account_code not like '5.4%'
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

grant execute on function public.profit_cash_bridge(uuid, date, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.chart_of_accounts
    where cost_behavior = 'variable' and active) as contas_variaveis,
  (select count(*) from public.chart_of_accounts
    where cost_behavior = 'fixed' and active) as contas_fixas,
  (select count(*) from public.chart_of_accounts
    where cost_behavior = 'none' and active and is_analytic
      and code not like '1%' and code not like '5.1%'
      and code not like '5.3%' and code not like '5.4%')
    as contas_sem_classificacao_fora_da_conta;
