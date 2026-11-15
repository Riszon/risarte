-- PRÉ-CONFERÊNCIA DA 4015a (SÓ LEITURA) — rodar na PRODUÇÃO ANTES da 4015a.
-- Mostra o que a 4015a vai travar, com a mesma regra dela (escrita aqui por
-- extenso, porque a função ainda não existe na produção):
--   parte 1: os termos de cancelamento JÁ ABERTOS (rascunho ou assinado) que não
--            vão conseguir ser efetivados;
--   parte 2: quantos planos e vendas diretas ainda não cancelados ficam travados.
-- Não altera nada: só SELECT.

with recursive
vendas as (
  select 'termo aberto'::text as grupo, pc.code as referencia, pc.status as situacao,
         pc.negotiation_id, null::uuid as direct_sale_id, pc.clinic_id, pc.client_id, pc.created_at
    from public.plan_cancellations pc
   where pc.status in ('rascunho', 'assinado')
  union all
  select 'plano não cancelado', n.code, 'venda fechada', cs.negotiation_id, null, n.clinic_id, n.client_id, cs.closed_at
    from public.commercial_sales cs
    join public.plan_negotiations n on n.id = cs.negotiation_id
   where cs.cancelled_at is null
  union all
  select 'venda direta não cancelada', s.code, case when s.closed_at is null then 'aberta' else 'fechada' end,
         null, s.id, s.clinic_id, s.client_id, s.created_at
    from public.direct_sales s
   where not coalesce(s.cancelled, false)
),
cadeia (grupo, referencia, negotiation_id, direct_sale_id, reneg_id) as (
  select distinct v.grupo, v.referencia, v.negotiation_id, v.direct_sale_id, i.renegotiated_by_id
    from vendas v
    join public.payment_installments i
      on ((v.negotiation_id is not null and i.negotiation_id = v.negotiation_id)
       or (v.direct_sale_id is not null and i.direct_sale_id = v.direct_sale_id))
   where i.status = 'renegociada' and i.renegotiated_by_id is not null
  union
  select c.grupo, c.referencia, c.negotiation_id, c.direct_sale_id, j.renegotiated_by_id
    from cadeia c
    join public.payment_installments j on j.renegotiation_id = c.reneg_id
   where j.status = 'renegociada' and j.renegotiated_by_id is not null
),
travas as (
  -- acordo aplicado com parcela nova em aberto
  select c.grupo, c.referencia, c.negotiation_id, c.direct_sale_id, r.code as acordo
    from cadeia c
    join public.payment_renegotiations r on r.id = c.reneg_id
   where exists (select 1 from public.payment_installments k
                  where k.renegotiation_id = r.id and k.status in ('em_aberto', 'parcial'))
  union
  -- renegociação esperando a autorização do Gerente, com parcela desta venda
  select v.grupo, v.referencia, v.negotiation_id, v.direct_sale_id, r.code
    from vendas v
    join public.payment_renegotiations r on r.status = 'aguardando_autorizacao'
   where exists (select 1 from public.payment_installments i
                  where i.id = any(r.source_installment_ids)
                    and ((v.negotiation_id is not null and i.negotiation_id = v.negotiation_id)
                      or (v.direct_sale_id is not null and i.direct_sale_id = v.direct_sale_id)))
)
-- PARTE 1: cada termo aberto que vai travar (vazio = nenhum)
select 'PARTE 1 — termo aberto que vai travar' as o_que,
       cl.name as unidade,
       coalesce(cli.code, '') || ' ' || coalesce(cli.full_name, '') as cliente,
       v.referencia as termo, v.situacao,
       to_char(v.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') as aberto_em,
       string_agg(distinct t.acordo, ', ') as acordos,
       null::bigint as quantidade
  from vendas v
  join travas t on t.grupo = v.grupo and t.referencia is not distinct from v.referencia
               and t.negotiation_id is not distinct from v.negotiation_id
               and t.direct_sale_id is not distinct from v.direct_sale_id
  join public.clinics cl on cl.id = v.clinic_id
  left join public.clients cli on cli.id = v.client_id
 where v.grupo = 'termo aberto'
 group by cl.name, cli.code, cli.full_name, v.referencia, v.situacao, v.created_at
union all
-- PARTE 2: quantos ficam travados, por grupo
select 'PARTE 2 — quantos ficam travados', null, null, g.grupo, null, null, null,
       (select count(distinct (t.negotiation_id, t.direct_sale_id)) from travas t where t.grupo = g.grupo)
  from (values ('termo aberto'), ('plano não cancelado'), ('venda direta não cancelada')) g(grupo)
order by 1, 2, 3;
