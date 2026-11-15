-- LEVANTAMENTO (SÓ LEITURA) — vendas canceladas que tinham parcelas num acordo
-- de renegociação (19.28.11, ajuste A.2 do Jeferson, 15/11/2026).
-- Rodar no SQL Editor da PRODUÇÃO. Não altera nada: só SELECT.
--
-- Para cada venda cancelada (plano ou venda direta) com parcelas renegociadas:
--   unidade, cliente, data, código do cancelamento, a parcela de acerto (seq 999),
--   os acordos que vieram dela (seguindo a cadeia: acordo de acordo),
--   as parcelas desses acordos em aberto e o que já foi pago neles,
--   a parte do acordo que veio desta venda (proporção pelo valor das parcelas de
--   origem) e o valor POSSIVELMENTE cobrado a mais.
--
-- Como ler "possivelmente_a_mais": o cancelamento calculou o acerto sem contar o
-- que foi pago no acordo e deixou o acordo em aberto. Então a parte do acordo que
-- veio desta venda (pago + em aberto) pode estar sendo cobrada duas vezes: uma no
-- acerto (ou num reembolso menor) e outra no próprio acordo. É um teto para
-- conferir caso a caso, não um valor a devolver.

with recursive
vendas as (
  select 'plano'::text as tipo, pc.code as cancelamento, pc.negotiation_id, null::uuid as direct_sale_id,
         pc.clinic_id, pc.client_id, pc.applied_at as cancelada_em,
         pc.due_cents, pc.paid_cents, pc.client_owes_cents, pc.clinic_refunds_cents
    from public.plan_cancellations pc
   where pc.status = 'efetivado'
  union all
  select 'venda direta', s.code, null, s.id, s.clinic_id, s.client_id, s.cancelled_at,
         null, null, null, null
    from public.direct_sales s
   where coalesce(s.cancelled, false)
),
-- acordo de 1º nível: parte desta venda = valor das parcelas desta venda ÷ valor de todas as de origem
nivel1 as (
  select v.tipo, v.cancelamento, v.negotiation_id, v.direct_sale_id, i.renegotiated_by_id as reneg_id,
         sum(i.amount_cents)::numeric as da_venda
    from vendas v
    join public.payment_installments i
      on ((v.negotiation_id is not null and i.negotiation_id = v.negotiation_id)
       or (v.direct_sale_id is not null and i.direct_sale_id = v.direct_sale_id))
   where i.status = 'renegociada' and i.renegotiated_by_id is not null
   group by 1, 2, 3, 4, 5
),
cadeia (tipo, cancelamento, negotiation_id, direct_sale_id, reneg_id, parte) as (
  select n.tipo, n.cancelamento, n.negotiation_id, n.direct_sale_id, n.reneg_id,
         n.da_venda / nullif((select sum(o.amount_cents) from public.payment_installments o
                                where o.renegotiated_by_id = n.reneg_id), 0)
    from nivel1 n
  union
  -- o acordo que renegociou parcelas de um acordo da cadeia herda a parte
  select c.tipo, c.cancelamento, c.negotiation_id, c.direct_sale_id, j.renegotiated_by_id,
         c.parte * (select sum(x.amount_cents) from public.payment_installments x
                     where x.renegotiation_id = c.reneg_id and x.renegotiated_by_id = j.renegotiated_by_id)::numeric
           / nullif((select sum(o.amount_cents) from public.payment_installments o
                      where o.renegotiated_by_id = j.renegotiated_by_id), 0)
    from cadeia c
    join public.payment_installments j on j.renegotiation_id = c.reneg_id
   where j.status = 'renegociada' and j.renegotiated_by_id is not null
),
por_acordo as (
  select c.*, r.code as acordo,
         (select count(*) from public.payment_installments k
           where k.renegotiation_id = c.reneg_id and k.status in ('em_aberto', 'parcial')) as parcelas_em_aberto,
         (select coalesce(sum(k.amount_cents), 0) from public.payment_installments k
           where k.renegotiation_id = c.reneg_id and k.status in ('em_aberto', 'parcial')) as valor_parcelas_em_aberto,
         (select coalesce(sum(rc.amount_cents), 0) from public.payment_receipts rc
            join public.payment_installments k on k.id = rc.installment_id
           where k.renegotiation_id = c.reneg_id and not rc.reversed and rc.reversal_of is null) as pago_no_acordo
    from cadeia c
    join public.payment_renegotiations r on r.id = c.reneg_id
)
select
  cl.name as unidade,
  coalesce(cli.code, '') || ' ' || coalesce(cli.full_name, '') as cliente,
  v.tipo,
  v.cancelamento,
  to_char(v.cancelada_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') as cancelada_em,
  -- a parcela de acerto (só no plano)
  (select (a.amount_cents / 100.0)::numeric(12,2) from public.payment_installments a
    where a.negotiation_id = v.negotiation_id and a.seq = 999 limit 1) as acerto_valor,
  (select a.status from public.payment_installments a
    where a.negotiation_id = v.negotiation_id and a.seq = 999 limit 1) as acerto_situacao,
  (v.clinic_refunds_cents / 100.0)::numeric(12,2) as reembolso_calculado,
  string_agg(p.acordo, ', ' order by p.acordo) as acordos,
  sum(p.parcelas_em_aberto) as parcelas_do_acordo_em_aberto,
  (sum(p.valor_parcelas_em_aberto) / 100.0)::numeric(12,2) as valor_em_aberto_no_acordo,
  (sum(p.pago_no_acordo) / 100.0)::numeric(12,2) as pago_no_acordo,
  round(max(p.parte) * 100, 1)::numeric(5,1) as parte_da_venda_pct,
  round(sum(p.parte * (p.valor_parcelas_em_aberto + p.pago_no_acordo)) / 100.0, 2) as possivelmente_a_mais
from vendas v
join por_acordo p on p.cancelamento is not distinct from v.cancelamento
                 and p.negotiation_id is not distinct from v.negotiation_id
                 and p.direct_sale_id is not distinct from v.direct_sale_id
join public.clinics cl on cl.id = v.clinic_id
left join public.clients cli on cli.id = v.client_id
group by cl.name, cli.code, cli.full_name, v.tipo, v.cancelamento, v.cancelada_em,
         v.negotiation_id, v.clinic_refunds_cents
order by v.cancelada_em desc;
