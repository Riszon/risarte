-- =============================================================================
-- 0254 — RECEBÍVEIS E INADIMPLÊNCIA DA REDE (relato OC-00005, 2ª metade)
--
-- A 0253 entregou a visão da UNIDADE. Esta é a da Franqueadora: *"para a
-- franqueadora também deve ter estas informações sobre recebíveis e
-- inadimplentes"*.
--
-- ⚠️ UMA CONSULTA PARA A REDE INTEIRA, não uma por unidade. Chamar
-- `clinic_overdue_rate` num laço funcionaria com as duas unidades de hoje e
-- seria 200 idas ao banco na meta de cinco anos — o tipo de custo que nasce
-- invisível e só aparece quando já está caro.
--
-- ⚠️ E A TAXA DA REDE **NÃO É A MÉDIA DAS TAXAS DAS UNIDADES**. Média simples
-- dá o mesmo peso a uma unidade com R$ 500 a receber e a outra com R$ 500 mil:
-- uma unidade minúscula com tudo vencido jogaria a taxa da rede para cima, e a
-- rede pareceria pior do que é. A taxa da rede é **o vencido da rede dividido
-- pelo a receber da rede** — soma em cima, soma embaixo. A tela faz essa conta
-- com os totais que esta função devolve.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AS FAIXAS DE PRAZO, NO BANCO.
--
-- ⚠️ ESTES NÚMEROS EXISTEM EM DOIS LUGARES, E ISSO É UM RISCO ASSUMIDO. A conta
-- da unidade usa `AGING_LIMITS` (src/lib/finance/aging.ts), em TypeScript, com
-- teste; aqui ela precisa ser SQL porque roda sobre a rede inteira sem trazer
-- parcela nenhuma para o aplicativo. Duas implementações da mesma régua é
-- exatamente como elas passam a divergir.
--
-- A proteção é um teste que LÊ ESTE ARQUIVO e compara os limites com os do
-- TypeScript (`aging.test.ts`). Mudar um lado sem o outro quebra o portão. Sem
-- esse teste, a rede e a unidade diriam coisas diferentes sobre a mesma
-- parcela, e ninguém descobriria — o total continua batendo quando a faixa
-- está errada.
--
-- A convenção é a mesma dos dois lados: a faixa "até N dias" INCLUI o dia N.
-- -----------------------------------------------------------------------------
create or replace function public.network_receivables()
returns table (
  clinic_id uuid,
  clinic_name text,
  ownership text,
  open_cents bigint,
  overdue_cents bigint,
  overdue_count integer,
  open_count integer,
  overdue_percent numeric,
  limit_percent numeric,
  -- A vencer, por prazo: é o que existe para antecipar.
  due_30_cents bigint,
  due_60_cents bigint,
  due_90_cents bigint,
  due_more_cents bigint,
  -- Vencido, por tempo de atraso: é o que existe para cobrar.
  late_30_cents bigint,
  late_60_cents bigint,
  late_90_cents bigint,
  late_more_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with parcelas as (
    select
      i.clinic_id,
      i.amount_cents - coalesce(i.paid_amount_cents, 0) as falta,
      -- ⚠️ A DATA QUE VALE É A DE LIQUIDAÇÃO, quando existe. Cartão liquida em
      -- D+30: usar o vencimento acusaria de inadimplência o que é só prazo de
      -- adquirente. Mesma data que a projeção de caixa e a tela da unidade usam.
      coalesce(i.expected_settlement_date, i.due_date) as data_efetiva
    from public.payment_installments i
    where i.status in ('em_aberto', 'parcial')
      and i.amount_cents > coalesce(i.paid_amount_cents, 0)
  ),
  classificadas as (
    select
      clinic_id,
      falta,
      data_efetiva < public.today_br() as vencida,
      -- Distância em dias, sempre positiva: para a frente é quanto falta, para
      -- trás é há quanto tempo venceu. Quem chama já escolheu a direção.
      case
        when data_efetiva < public.today_br()
          then public.today_br() - data_efetiva
        else data_efetiva - public.today_br()
      end as dias
    from parcelas
  ),
  por_unidade as (
    select
      clinic_id,
      coalesce(sum(falta), 0)::bigint as aberto,
      coalesce(sum(falta) filter (where vencida), 0)::bigint as vencido,
      count(*) filter (where vencida)::integer as n_vencidas,
      count(*)::integer as n_abertas,
      coalesce(sum(falta) filter (where not vencida and dias <= 30), 0)::bigint as d30,
      coalesce(sum(falta) filter (where not vencida and dias > 30 and dias <= 60), 0)::bigint as d60,
      coalesce(sum(falta) filter (where not vencida and dias > 60 and dias <= 90), 0)::bigint as d90,
      coalesce(sum(falta) filter (where not vencida and dias > 90), 0)::bigint as dmais,
      coalesce(sum(falta) filter (where vencida and dias <= 30), 0)::bigint as a30,
      coalesce(sum(falta) filter (where vencida and dias > 30 and dias <= 60), 0)::bigint as a60,
      coalesce(sum(falta) filter (where vencida and dias > 60 and dias <= 90), 0)::bigint as a90,
      coalesce(sum(falta) filter (where vencida and dias > 90), 0)::bigint as amais
    from classificadas
    group by clinic_id
  )
  select
    c.id,
    c.name,
    c.ownership,
    coalesce(u.aberto, 0)::bigint,
    coalesce(u.vencido, 0)::bigint,
    coalesce(u.n_vencidas, 0)::integer,
    coalesce(u.n_abertas, 0)::integer,
    -- Sem nada a receber não existe taxa: 0% se leria como "está ótimo", quando
    -- a verdade é "não há o que medir". Mesma regra da 0253.
    case when coalesce(u.aberto, 0) > 0
      then round((coalesce(u.vencido, 0)::numeric * 100) / u.aberto, 2)
      else null
    end,
    public.overdue_limit_percent(c.id),
    coalesce(u.d30, 0)::bigint,
    coalesce(u.d60, 0)::bigint,
    coalesce(u.d90, 0)::bigint,
    coalesce(u.dmais, 0)::bigint,
    coalesce(u.a30, 0)::bigint,
    coalesce(u.a60, 0)::bigint,
    coalesce(u.a90, 0)::bigint,
    coalesce(u.amais, 0)::bigint
  from public.clinics c
  left join por_unidade u on u.clinic_id = c.id
  -- ⚠️ A UNIDADE SEM NENHUMA COBRANÇA CONTINUA NA LISTA (`left join`), zerada.
  -- Sumir seria pior que aparecer com zero: a Franqueadora leria a ausência
  -- como "esta unidade está em dia", quando pode ser "esta unidade não está
  -- lançando nada" — e as duas pedem conversas opostas.
  where c.is_active
    and c.type <> 'franchisor'
    -- Mesma guarda do painel da rede (FIN8.3): a unidade nunca vê a outra.
    and (public.is_admin_master() or public.is_finance_franchisor())
  order by c.name;
$fn$;

revoke all on function public.network_receivables() from public;
grant execute on function public.network_receivables() to authenticated;
