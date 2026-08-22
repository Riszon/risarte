-- =============================================================================
-- 0237 — FIN8.3: o painel da rede
-- -----------------------------------------------------------------------------
-- É onde os alertas da rede deviam morar desde o FIN7.3, quando ficou decidido
-- que a franqueadora NÃO entra na lista do sino: com 200 unidades seriam
-- centenas de notificações por dia. Rede é assunto de PAINEL.
--
-- O PAINEL LÊ O QUE O MOTOR DE ALERTAS JÁ APUROU (`finance_alerts`), em vez de
-- recalcular tudo por unidade. Recalcular seria refazer, a cada abertura de
-- tela e para cada unidade, a projeção diária de caixa e o ponto de equilíbrio —
-- e, pior, poderia divergir do que a unidade recebeu no sino. Painel que mostra
-- número diferente do aviso que a pessoa recebeu não é painel, é confusão.
-- Consequência assumida: o painel mostra o retrato da última apuração. A tela
-- diz isso e traz o botão para apurar na hora.
--
-- A COBRANÇA DAS TAXAS fecha o ciclo do FIN8.1: hoje a franqueadora cobra e não
-- tem onde olhar quem pagou. Aqui ela vê apurado, recebido, em aberto e
-- VENCIDO, por unidade.
--
-- "EM ABERTO" DESCONTA O ABATIMENTO POR PONTUALIDADE. A conta de R$ 1.000 paga
-- com R$ 900 mais R$ 100 de desconto está quitada; contar os R$ 100 como saldo
-- devedor faria a franqueadora cobrar o que ela mesma concedeu.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O SEMÁFORO POR UNIDADE
-- -----------------------------------------------------------------------------
create or replace function public.network_panel(
  p_year integer default null,
  p_month integer default null
)
returns table (
  clinic_id uuid,
  clinic_name text,
  ownership text,
  alerts integer,
  alert_caixa text,
  alert_orcamento text,
  alert_equilibrio text,
  alert_atraso text,
  overdue_cents bigint,
  prev_month_closed boolean,
  fees_due_cents bigint,
  fees_paid_cents bigint,
  fees_open_cents bigint,
  fees_overdue_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with periodo as (
    select case
      when p_year is null or p_month is null
        then date_trunc('month', public.today_br())::date
      else make_date(p_year, p_month, 1)
    end as mes
  ),
  anterior as (
    select (mes - interval '1 month')::date as mes from periodo
  )
  select
    c.id,
    c.name,
    c.ownership,
    coalesce(a.n, 0)::integer,
    a.caixa,
    a.orcamento,
    a.equilibrio,
    a.atraso,
    coalesce(o.total, 0)::bigint,
    coalesce(f.fechado, false),
    coalesce(t.apurado, 0)::bigint,
    coalesce(t.recebido, 0)::bigint,
    coalesce(t.aberto, 0)::bigint,
    coalesce(t.vencido, 0)::bigint
  from public.clinics c

  -- Os alertas ATIVOS, do motor diário. Um por regra: se houver mais de um da
  -- mesma regra (várias contas estourando), o painel mostra um e o número total.
  left join lateral (
    select
      count(*) as n,
      max(detail) filter (where rule = 'caixa') as caixa,
      max(detail) filter (where rule = 'orcamento') as orcamento,
      max(detail) filter (where rule = 'equilibrio') as equilibrio,
      max(detail) filter (where rule = 'atraso') as atraso
    from public.finance_alerts fa
    where fa.clinic_id = c.id and fa.cleared_at is null
      and fa.notified_at is not null
  ) a on true

  -- O vencido a receber, direto da fonte: é número de cobrança, e precisa estar
  -- certo mesmo que o motor de alertas não tenha rodado hoje.
  left join lateral (
    select sum(i.amount_cents - coalesce(i.paid_amount_cents, 0)) as total
    from public.payment_installments i
    where i.clinic_id = c.id
      and i.status in ('em_aberto', 'parcial')
      and i.amount_cents > coalesce(i.paid_amount_cents, 0)
      and coalesce(i.expected_settlement_date, i.due_date) < public.today_br()
  ) o on true

  -- O mês ANTERIOR está fechado? É a pergunta de processo que só a
  -- franqueadora acompanha.
  left join lateral (
    select true as fechado
    from public.fiscal_periods fp, anterior
    where fp.clinic_id = c.id and fp.status = 'closed'
      and fp.year = extract(year from anterior.mes)::integer
      and fp.month = extract(month from anterior.mes)::integer
  ) f on true

  -- A cobrança das taxas do mês.
  left join lateral (
    select
      sum(p.amount_cents) as apurado,
      sum(p.paid_amount_cents) as recebido,
      -- O abatimento por pontualidade não é saldo devedor: cobrá-lo seria
      -- cobrar o que a própria rede concedeu.
      sum(greatest(0, p.amount_cents - p.paid_amount_cents
                      - coalesce(d.desconto, 0))) as aberto,
      sum(case when p.due_date < public.today_br()
               then greatest(0, p.amount_cents - p.paid_amount_cents
                                - coalesce(d.desconto, 0))
               else 0 end) as vencido
    -- O mês entra por subconsulta, e não por junção com vírgula: `p, periodo
    -- left join lateral (...)` faria o lateral enxergar só `periodo`, e a
    -- referência a `p.id` lá dentro seria recusada.
    from public.payables p
    left join lateral (
      select sum(pp.discount_cents) as desconto
      from public.payable_payments pp
      where pp.payable_id = p.id and not pp.reversed and pp.reversal_of is null
    ) d on true
    where p.clinic_id = c.id
      and p.network_fee is not null
      and p.fee_period = (select mes from periodo)
      and p.status <> 'cancelada'
  ) t on true

  where c.is_active
    and c.type <> 'franchisor'
    and (public.is_admin_master() or public.is_finance_franchisor())
  order by coalesce(a.n, 0) desc, c.name;
$$;

grant execute on function public.network_panel(integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A EVOLUÇÃO DA REDE
-- -----------------------------------------------------------------------------
-- Serve para ler o mês corrente contra o próprio histórico, em vez de contra
-- impressão. Sem eliminação: é faturamento de unidade, não resultado de grupo.
create or replace function public.network_monthly_revenue(
  p_months integer default 12
)
returns table (
  month date,
  gross_cents bigint,
  units integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with meses as (
    select generate_series(
      date_trunc('month', public.today_br())::date
        - ((greatest(coalesce(p_months, 12), 1) - 1) || ' months')::interval,
      date_trunc('month', public.today_br())::date,
      interval '1 month'
    )::date as mes
  )
  select
    m.mes,
    coalesce(sum(x.v), 0)::bigint,
    count(distinct x.clinic_id)::integer
  from meses m
  left join lateral (
    select e.clinic_id,
           (case when e.direction = 'inflow'
                 then e.amount_cents else -e.amount_cents end)::bigint as v
    from public.financial_entries e
    join public.clinics c on c.id = e.clinic_id
    where c.is_active and c.type <> 'franchisor'
      and date_trunc('month', e.accrual_date)::date = m.mes
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and e.account_code like '1%'
      and e.account_code not like '1.9%'
  ) x on true
  where (public.is_admin_master() or public.is_finance_franchisor())
  group by m.mes
  order by m.mes;
$$;

grant execute on function public.network_monthly_revenue(integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.clinics
    where is_active and type <> 'franchisor') as unidades_no_painel,
  (select count(*) from public.finance_alerts
    where cleared_at is null and notified_at is not null) as alertas_ativos,
  (select count(*) from public.payables
    where network_fee is not null and status <> 'cancelada') as contas_de_taxa,
  (select count(*) from public.fiscal_periods where status = 'closed')
    as periodos_fechados;
