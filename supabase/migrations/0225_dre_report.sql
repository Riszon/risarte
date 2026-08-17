-- =============================================================================
-- 0225 — FIN6.1: A DRE
-- -----------------------------------------------------------------------------
-- O sistema registra tudo há meses, mas até aqui só respondia perguntas
-- pontuais. A DRE responde a que decide: **o mês deu lucro?**
--
-- REGIME (decisão do dono, 12/08/2026): entram os lançamentos **liquidados e em
-- aberto**; previsto, estornado e cancelado ficam de fora. Competência não
-- depende de ter pago — a venda de março aparece em março mesmo que o cliente
-- pague em junho. É a definição de competência, e é o que separa a DRE do
-- fluxo de caixa.
--
-- ESTORNO SOME DOS DOIS LADOS. O original vira `reversed` e o contra-lançamento
-- nasce com `reversal_of` preenchido: filtrar só por status deixaria passar o
-- contra-lançamento sozinho, e o valor entraria na DRE com o SINAL INVERTIDO —
-- uma receita estornada viraria despesa. Por isso `reversal_of is null` junto.
--
-- O SINAL VEM DA DIREÇÃO, NÃO DA CONTA: valor = entradas − saídas. Assim cada
-- bloco soma naturalmente e os subtotais são somas acumuladas, sem uma tabela de
-- "esta conta subtrai, aquela soma" que alguém teria de manter sincronizada com
-- o plano de contas.
--
-- O QUE ENTRA NA DRE, por grupo do plano de contas:
--   1 (menos 1.9) → receita bruta        1.9 → deduções
--   2            → custos diretos          3 → despesas operacionais
--   4            → resultado financeiro  5.2 → depreciação e baixa de bens
--
-- O QUE FICA DE FORA, e por quê:
--   • 5.1 imobilizado — comprar um bem não é gastar; ele vive em 6.2.01 e entra
--     no resultado pela depreciação. Contar os dois seria contar duas vezes.
--   • 5.3 empréstimos (principal) — é troca de dívida por caixa, não resultado.
--   • 5.4 distribuição de lucros — sai DEPOIS do lucro; incluí-la faria a
--     empresa parecer dar prejuízo por ter distribuído o que ganhou.
--   • 6 ativos (estoque e bens) — patrimônio, nunca resultado.
-- Idempotente.
-- =============================================================================

create or replace function public.dre_lines(
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
    -- Competência: liquidado + em aberto. Previsto ainda não aconteceu.
    and e.status in ('settled', 'open')
    -- Estorno some dos dois lados (ver cabeçalho).
    and e.reversal_of is null
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
    and e.account_code not like '6%'
    and e.account_code not like '5.1%'
    and e.account_code not like '5.3%'
    and e.account_code not like '5.4%'
  group by e.account_code
  having sum(case when e.direction = 'inflow'
                  then e.amount_cents else -e.amount_cents end) <> 0
  order by e.account_code;
$$;

grant execute on function public.dre_lines(uuid, date, date, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- O DRILL-DOWN: de qualquer linha até o documento
-- -----------------------------------------------------------------------------
-- Invariante do módulo desde o FIN0 — "qualquer número de relatório precisa
-- chegar ao documento de origem". É aqui que ela finalmente aparece na tela.
create or replace function public.dre_entries(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_account_code text,
  p_cost_center_id uuid default null
)
returns table (
  entry_id uuid,
  accrual_date date,
  amount_cents bigint,
  direction text,
  status text,
  source_type text,
  source_id uuid,
  description text,
  cost_center_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id, e.accrual_date,
    case when e.direction = 'inflow'
         then e.amount_cents else -e.amount_cents end,
    e.direction, e.status, e.source_type, e.source_id, e.description,
    c.name
  from public.financial_entries e
  left join public.cost_centers c on c.id = e.cost_center_id
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    and e.account_code = p_account_code
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
  order by e.accrual_date desc, e.created_at desc
  limit 300;
$$;

grant execute on function public.dre_entries(uuid, date, date, text, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.financial_entries
    where status in ('settled', 'open') and reversal_of is null)
    as lancamentos_na_dre,
  (select count(*) from public.financial_entries
    where status = 'reversed' or reversal_of is not null)
    as lancamentos_de_estorno_ignorados,
  (select count(distinct account_code) from public.financial_entries)
    as contas_movimentadas,
  (select count(*) from public.financial_entries
    where account_code like '6%') as lancamentos_de_ativo_fora_da_dre;
