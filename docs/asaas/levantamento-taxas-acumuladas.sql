-- Levantamento: taxas da rede acumuladas e ainda não pagas, por unidade (ASA6, 20.15.1)
-- SÓ LEITURA. Não altera nada. Rodar no SQL Editor da produção.
--
-- O que mostra: as contas a pagar de taxa da rede (uma por unidade, taxa e mês) que estão
-- em aberto ou pagas em parte. É o "saldo anterior" que a 1ª cobrança mensal NÃO inclui
-- sozinha: o Financeiro ou o Admin decide, por unidade, incluir, parcelar ou dispensar.
--
-- Linhas com "taxa" = '— TOTAL DA UNIDADE' são o total de cada unidade.
-- A última linha ("— TOTAL DA REDE") é o total geral.

select
  coalesce(c.name, '— TOTAL DA REDE')                                  as unidade,
  case
    when grouping(p.network_fee) = 1 and grouping(c.name) = 0 then '— TOTAL DA UNIDADE'
    when grouping(p.network_fee) = 1 then ''
    else p.network_fee
  end                                                                   as taxa,
  case when grouping(p.fee_period) = 0 then to_char(p.fee_period, 'MM/YYYY') else '' end as mes,
  count(*)                                                              as contas,
  to_char(sum(p.amount_cents) / 100.0, 'FM999G999G990D00')              as devido_rs,
  to_char(sum(p.paid_amount_cents) / 100.0, 'FM999G999G990D00')         as pago_rs,
  to_char(sum(p.amount_cents - p.paid_amount_cents) / 100.0, 'FM999G999G990D00') as em_aberto_rs,
  min(p.due_date)                                                       as vencimento_mais_antigo
from public.payables p
join public.clinics c on c.id = p.clinic_id
where p.network_fee is not null
  and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
group by grouping sets ((c.name, p.network_fee, p.fee_period), (c.name), ())
order by grouping(c.name), c.name, grouping(p.network_fee), p.fee_period, p.network_fee;

-- Conferência esperada: uma linha por unidade, taxa e mês em aberto; uma linha de total por
-- unidade; e uma linha final com o total da rede. "No rows returned" = nada acumulado.
