-- Levantamento: split marcado como "repasse a mais" (SÓ LEITURA). Rodar no SQL Editor da produção.
--
-- Para cada split liquidado marcado com valor a mais, mostra o que a rede deveria
-- receber HOJE (a soma das linhas de taxa da cobrança), o que recebeu e o veredito:
--   'falso alarme'  = a rede recebeu igual ou menos que o devido (a marca ficou velha:
--                     o split foi liquidado antes de as linhas de taxa existirem — mensalidades, 4018);
--   'a mais de verdade' = recebeu mais que o devido + a tolerância da Central.
-- "No rows returned" = nenhuma marca.

select
  c.paid_on                                       as pago_em,
  c.billing_type                                  as meio,
  coalesce(c.description, 'Parcela')              as cobranca,
  c.source_type                                   as origem,
  to_char(c.paid_cents / 100.0, 'FM999G990D00')   as pago_rs,
  to_char(cs.settled_cents / 100.0, 'FM999G990D00') as rede_recebeu_rs,
  to_char(d.devido / 100.0, 'FM999G990D00')       as rede_devia_rs,
  to_char(cs.excess_cents / 100.0, 'FM999G990D00') as marcado_a_mais_rs,
  case when cs.settled_cents <= d.devido + coalesce(s.tolerance_cents, 10) then 'falso alarme'
       else 'a mais de verdade' end              as veredito
from public.charge_splits cs
join public.charges c on c.id = cs.charge_id
cross join lateral (
  select coalesce(sum(sc.amount_cents), 0) as devido
    from public.split_charges sc
   where sc.charge_id = c.id and not sc.reversed and cs.fees ? sc.fee
) d
left join public.gateway_split_settings s on s.id
where cs.status = 'liquidado' and cs.excess_cents > 0
order by c.paid_on, c.id;
