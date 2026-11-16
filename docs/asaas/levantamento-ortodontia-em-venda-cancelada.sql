-- Levantamento (só leitura) — vendas canceladas com caso de Ortodontia ainda ativo
-- ou com mensalidades em aberto (spec 19.35.13, confirmação da Ortodontia).
-- Rode no SQL Editor da produção. Não altera nada.
-- Uma linha por caso: cliente, unidade, data do cancelamento, situação do caso e
-- as mensalidades em aberto/atrasadas (quantas, valor, quantas já venceram).
select cl.full_name                                   as cliente,
       un.name                                        as unidade,
       (pc.applied_at at time zone 'America/Sao_Paulo')::date as cancelada_em,
       oc.status                                      as situacao_do_caso,
       count(ch.id) filter (where ch.status in ('em_aberto', 'atrasada'))                        as mensalidades_abertas,
       coalesce(sum(ch.amount_cents) filter (where ch.status in ('em_aberto', 'atrasada')), 0) / 100.0 as valor_aberto_reais,
       count(ch.id) filter (where ch.status in ('em_aberto', 'atrasada')
                              and ch.due_date < (now() at time zone 'America/Sao_Paulo')::date) as ja_vencidas,
       min(ch.due_date) filter (where ch.status in ('em_aberto', 'atrasada'))                     as primeira_aberta,
       max(ch.due_date) filter (where ch.status in ('em_aberto', 'atrasada'))                     as ultima_aberta
  from public.plan_cancellations pc
  join public.ortho_cases oc on oc.negotiation_id = pc.negotiation_id
  join public.clients cl on cl.id = pc.client_id
  join public.clinics un on un.id = pc.clinic_id
  left join public.ortho_charges ch on ch.case_id = oc.id
 where pc.status = 'efetivado'
 group by cl.full_name, un.name, pc.applied_at, oc.id, oc.status
having oc.status in ('aguardando_inicio', 'em_tratamento', 'contencao')
    or count(ch.id) filter (where ch.status in ('em_aberto', 'atrasada')) > 0
 order by cancelada_em desc, unidade, cliente;
