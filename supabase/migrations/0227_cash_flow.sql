-- =============================================================================
-- 0227 — FIN6.2: o fluxo de caixa (realizado + projetado)
-- -----------------------------------------------------------------------------
-- A DRE responde "o mês deu lucro?". Esta responde a outra pergunta, que é a
-- que quebra clínica lucrativa: **vai faltar dinheiro, e quando?**
--
-- AS DUAS METADES VÊM DE LUGARES DIFERENTES, E ISSO É DE PROPÓSITO:
--
--   • REALIZADO — do RAZÃO, pela `cash_date`. É exatamente o que a DRE passou a
--     ignorar na 0226: os dois relatórios leem o mesmo razão por metades
--     opostas, e por isso nunca podem divergir da origem.
--   • PREVISTO — dos DOCUMENTOS (parcelas e contas), não do razão. O razão
--     guarda o valor CHEIO da parcela; só o documento sabe quanto ainda falta.
--     Projetar pelo razão faria a parcela de R$ 500 já recebida pela metade
--     entrar como R$ 500 a receber.
--
-- DATA DO PREVISTO: `expected_settlement_date` quando existe, senão o
-- vencimento. Cartão liquida em D+30 — usar o vencimento faria a projeção
-- mostrar o dinheiro um mês antes de ele existir.
--
-- VENCIDO NÃO ENTRA NA PROJEÇÃO (decisão do dono). A parcela em atraso já
-- falhou uma data; contá-la de novo é a forma mais comum de uma projeção de
-- caixa mentir para o lado otimista — e o erro otimista é o que quebra caixa.
-- Ela aparece à parte, em `cash_overdue()`, para ser cobrada, não somada.
--
-- CONTA ESPERANDO AUTORIZAÇÃO ENTRA na saída prevista, ao contrário da DRE.
-- São regras diferentes porque as perguntas são diferentes: para o resultado
-- ela ainda não é despesa reconhecida; para o caixa ela é uma conta que quase
-- certamente vai ser paga, e ignorá-la deixaria a projeção otimista.
--
-- ATIVIDADE: operacional (tudo), investimento (5.1 compra de bens),
-- financiamento (5.3 empréstimos, 5.4 distribuição de lucros). É o que separa
-- "a operação gera caixa" de "fechou no azul porque vendeu uma cadeira".
--
-- LIMITES DECLARADOS: a projeção é BRUTA (a taxa da adquirente entra quando o
-- dinheiro entra, então o previsto de cartão fica ~2% otimista); não há
-- calendário de feriados; conta recorrente só entra quando é gerada.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) A GUARDA QUE FALTAVA
-- -----------------------------------------------------------------------------
-- Função `security definer` roda como dona do banco e por isso PASSA POR CIMA
-- do RLS. Sem uma checagem explícita, qualquer usuário logado poderia chamar o
-- relatório de OUTRA unidade pela API, mesmo sem enxergar a tela. A guarda
-- existia desde a 0212 (`suggested_avg_acquirer_fee`) mas estava copiada solta;
-- agora é uma função só, para não haver duas versões da mesma régua.
create or replace function public.can_see_clinic_finance(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic_id is not null and (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or p_clinic_id in (select public.finance_visible_clinic_ids())
  );
$$;

grant execute on function public.can_see_clinic_finance(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 1) A SÉRIE: um dia por linha, realizado e previsto lado a lado
-- -----------------------------------------------------------------------------
-- Devolve só os dias COM movimento. A régua de dias vazios e o saldo acumulado
-- são montados na tela — lá dá para agrupar por dia, semana ou mês sem três
-- versões desta consulta, e a conta fica coberta por teste automatizado.
create or replace function public.cash_flow_series(
  p_clinic_id uuid,
  p_from date,
  p_to date
)
returns table (
  day date,
  kind text,
  activity text,
  inflow_cents bigint,
  outflow_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  -- REALIZADO: o razão, pela data de caixa. Estorno some dos dois lados,
  -- mesma regra da DRE (status 'reversed' fora, contra-lançamento fora).
  select
    e.cash_date,
    'realizado',
    case
      when e.account_code like '5.1%' then 'investimento'
      when e.account_code like '5.3%'
        or e.account_code like '5.4%'   then 'financiamento'
      else 'operacional'
    end,
    sum(case when e.direction = 'inflow' then e.amount_cents else 0 end)::bigint,
    sum(case when e.direction = 'outflow' then e.amount_cents else 0 end)::bigint
  from public.financial_entries e
  where e.clinic_id = p_clinic_id
    and e.cash_date between p_from and p_to
    and e.status = 'settled'
    and e.reversal_of is null
    and public.can_see_clinic_finance(p_clinic_id)
  group by 1, 2, 3

  union all

  -- PREVISTO, ENTRADAS: o que FALTA receber (valor − já recebido).
  select
    coalesce(i.expected_settlement_date, i.due_date),
    'previsto',
    'operacional',
    sum(i.amount_cents - coalesce(i.paid_amount_cents, 0))::bigint,
    0::bigint
  from public.payment_installments i
  where i.clinic_id = p_clinic_id
    and i.status in ('em_aberto', 'parcial')
    and i.amount_cents > coalesce(i.paid_amount_cents, 0)
    -- Vencido fica de fora (ver cabeçalho): a projeção começa em HOJE.
    and coalesce(i.expected_settlement_date, i.due_date)
        between greatest(p_from, public.today_br()) and p_to
    and public.can_see_clinic_finance(p_clinic_id)
  group by 1, 2, 3

  union all

  -- PREVISTO, SAÍDAS: o que FALTA pagar.
  select
    p.due_date,
    'previsto',
    case
      when p.account_code like '5.1%' then 'investimento'
      when p.account_code like '5.3%'
        or p.account_code like '5.4%'   then 'financiamento'
      else 'operacional'
    end,
    0::bigint,
    sum(p.amount_cents - coalesce(p.paid_amount_cents, 0))::bigint
  from public.payables p
  where p.clinic_id = p_clinic_id
    and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
    and p.amount_cents > coalesce(p.paid_amount_cents, 0)
    and p.due_date between greatest(p_from, public.today_br()) and p_to
    and public.can_see_clinic_finance(p_clinic_id)
  group by 1, 2, 3;
$$;

grant execute on function public.cash_flow_series(uuid, date, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2) O SALDO DE PARTIDA
-- -----------------------------------------------------------------------------
-- Saldo inicial das contas bancárias cadastradas (o campo que a Conciliação já
-- pede: "o saldo no dia em que a unidade começou a usar o sistema") mais todo
-- o caixa anterior ao período. Sem conta cadastrada o ponto de partida é zero,
-- e a tela diz isso — saldo declaradamente incompleto é honesto; saldo
-- inventado vira decisão errada.
create or replace function public.cash_balance_before(
  p_clinic_id uuid,
  p_date date
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.can_see_clinic_finance(p_clinic_id) then
    coalesce((
      select sum(b.opening_balance_cents)
        from public.bank_accounts b
       where b.clinic_id = p_clinic_id and b.active
    ), 0)
    + coalesce((
      select sum(case when e.direction = 'inflow'
                      then e.amount_cents else -e.amount_cents end)
        from public.financial_entries e
       where e.clinic_id = p_clinic_id
         and e.cash_date is not null
         and e.cash_date < p_date
         and e.status = 'settled'
         and e.reversal_of is null
    ), 0)
  else 0 end::bigint;
$$;

grant execute on function public.cash_balance_before(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) O QUE ESTÁ VENCIDO — fora da projeção, à vista de todos
-- -----------------------------------------------------------------------------
create or replace function public.cash_overdue(p_clinic_id uuid)
returns table (
  receivable_cents bigint,
  receivable_count integer,
  payable_cents bigint,
  payable_count integer
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
         and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
         and p.amount_cents > coalesce(p.paid_amount_cents, 0)
         and p.due_date < public.today_br()
    ), 0)::bigint,
    coalesce((
      select count(*) from public.payables p
       where p.clinic_id = p_clinic_id
         and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
         and p.amount_cents > coalesce(p.paid_amount_cents, 0)
         and p.due_date < public.today_br()
    ), 0)::integer
  where public.can_see_clinic_finance(p_clinic_id);
$$;

grant execute on function public.cash_overdue(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O DRILL-DOWN: de qualquer período até o documento
-- -----------------------------------------------------------------------------
-- Mesma invariante do FIN0 e da DRE. Número de relatório que não se explica não
-- se usa para decidir — e foi a conferência linha a linha que achou o erro da
-- 0225.
create or replace function public.cash_flow_detail(
  p_clinic_id uuid,
  p_from date,
  p_to date
)
returns table (
  ref_date date,
  kind text,
  direction text,
  amount_cents bigint,
  description text,
  source_type text,
  source_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select
      e.cash_date, 'realizado', e.direction, e.amount_cents,
      coalesce(e.description, e.source_type), e.source_type, e.source_id
    from public.financial_entries e
    where e.clinic_id = p_clinic_id
      and e.cash_date between p_from and p_to
      and e.status = 'settled'
      and e.reversal_of is null
      and public.can_see_clinic_finance(p_clinic_id)

    union all

    select
      coalesce(i.expected_settlement_date, i.due_date), 'previsto', 'inflow',
      (i.amount_cents - coalesce(i.paid_amount_cents, 0))::bigint,
      case when i.kind = 'entrada' then 'Entrada da venda a receber'
           else 'Parcela ' || i.seq || ' a receber' end
        || case when coalesce(i.paid_amount_cents, 0) > 0
                then ' (saldo)' else '' end,
      'installment_expected', i.id
    from public.payment_installments i
    where i.clinic_id = p_clinic_id
      and i.status in ('em_aberto', 'parcial')
      and i.amount_cents > coalesce(i.paid_amount_cents, 0)
      and coalesce(i.expected_settlement_date, i.due_date)
          between greatest(p_from, public.today_br()) and p_to
      and public.can_see_clinic_finance(p_clinic_id)

    union all

    select
      p.due_date, 'previsto', 'outflow',
      (p.amount_cents - coalesce(p.paid_amount_cents, 0))::bigint,
      p.description
        || case when p.status = 'aguardando_autorizacao'
                then ' (esperando autorização)' else '' end,
      'payable_expected', p.id
    from public.payables p
    where p.clinic_id = p_clinic_id
      and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
      and p.amount_cents > coalesce(p.paid_amount_cents, 0)
      and p.due_date between greatest(p_from, public.today_br()) and p_to
      and public.can_see_clinic_finance(p_clinic_id)
  ) t
  order by 1, 2, 4 desc
  limit 300;
$$;

grant execute on function public.cash_flow_detail(uuid, date, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A MESMA GUARDA NOS RELATÓRIOS DA 0224/0225/0226
-- -----------------------------------------------------------------------------
-- A DRE e a lista de bens nasceram sem a checagem: `security definer` sem
-- guarda entrega o resultado a quem chamar. Nenhuma mudança de número aqui —
-- só a régua de quem pode ler.
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
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    -- LIQUIDAÇÃO NÃO É COMPETÊNCIA (0226): estas duas origens são o caixa.
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

grant execute on function public.dre_lines(uuid, date, date, uuid)
  to authenticated;

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
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
    and public.can_see_clinic_finance(p_clinic_id)
  order by e.accrual_date desc, e.created_at desc
  limit 300;
$$;

grant execute on function public.dre_entries(uuid, date, date, text, uuid)
  to authenticated;

create or replace function public.assets_overview(p_clinic_id uuid)
returns table (
  asset_id uuid,
  code text,
  name text,
  category_name text,
  in_service_date date,
  cost_cents bigint,
  monthly_cents bigint,
  accumulated_cents bigint,
  book_value_cents bigint,
  months_done integer,
  useful_life_months integer,
  status text,
  disposal_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id, a.code, a.name, c.name, a.in_service_date, a.cost_cents,
    round((a.cost_cents - a.residual_cents)::numeric / a.useful_life_months)::bigint,
    coalesce(d.total, 0)::bigint,
    greatest(a.cost_cents - coalesce(d.total, 0), 0)::bigint,
    coalesce(d.months, 0)::integer,
    a.useful_life_months,
    a.status,
    a.disposal_date
  from public.fixed_assets a
  left join public.asset_categories c on c.id = a.category_id
  left join lateral (
    select sum(amount_cents) as total, count(*) as months
    from public.asset_depreciations where asset_id = a.id
  ) d on true
  where a.clinic_id = p_clinic_id
    and public.can_see_clinic_finance(p_clinic_id)
  order by (a.status = 'baixado'), a.name;
$$;

grant execute on function public.assets_overview(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.financial_entries
    where cash_date is not null and status = 'settled' and reversal_of is null)
    as lancamentos_de_caixa_realizado,
  (select count(*) from public.payment_installments
    where status in ('em_aberto', 'parcial')
      and amount_cents > coalesce(paid_amount_cents, 0)
      and coalesce(expected_settlement_date, due_date) >= public.today_br())
    as parcelas_na_projecao,
  (select count(*) from public.payment_installments
    where status in ('em_aberto', 'parcial')
      and amount_cents > coalesce(paid_amount_cents, 0)
      and coalesce(expected_settlement_date, due_date) < public.today_br())
    as parcelas_vencidas_fora_da_projecao,
  (select count(*) from public.payables
    where status in ('aberta', 'parcial', 'aguardando_autorizacao')
      and amount_cents > coalesce(paid_amount_cents, 0))
    as contas_a_pagar_na_projecao,
  (select count(*) from public.bank_accounts where active)
    as contas_bancarias_com_saldo_inicial;
