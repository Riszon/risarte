-- LEVANTAMENTO (SÓ LEITURA) — adesões do PPR+ CANCELADAS com mensalidade ainda
-- em aberto ou atrasada (19.32.6, ponto 7 do Jeferson, 15/11/2026).
-- Rodar no SQL Editor da PRODUÇÃO. Não altera nada: só SELECT.
--
-- Hoje, cancelar a adesão (à mão ou pela regra de 90 dias) não cancela as
-- mensalidades em aberto. Esta consulta lista cada caso para decidir a correção.
select
  cl.name as unidade,
  coalesce(c.code, '') || ' ' || coalesce(c.full_name, '') as titular,
  m.status as situacao_da_adesao,
  to_char(m.updated_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') as alterada_em,
  count(pc.id) as mensalidades_abertas,
  string_agg(to_char(pc.reference_month, 'MM/YYYY') || ' (' || pc.status || ')', ', ' order by pc.reference_month) as meses,
  (sum(pc.amount_cents) / 100.0)::numeric(12,2) as valor_em_aberto,
  count(pc.id) filter (where pc.due_date < current_date) as ja_vencidas,
  count(pc.id) filter (where pc.due_date >= current_date) as a_vencer
from public.ppr_memberships m
join public.ppr_charges pc on pc.membership_id = m.id and pc.status in ('em_aberto', 'atrasada')
join public.clinics cl on cl.id = m.clinic_id
left join public.clients c on c.id = m.holder_client_id
where m.status = 'cancelado'
group by cl.name, c.code, c.full_name, m.status, m.updated_at
order by m.updated_at desc;
