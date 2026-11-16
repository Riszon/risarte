-- Levantamento (só leitura) — cobranças externas em aberto, para o plano da 4019 (spec 19.34).
-- Rode no SQL Editor da produção. Não altera nada.
select cl.name as unidade,
       count(*) as externas_abertas,
       count(*) filter (where i.due_date < (now() at time zone 'America/Sao_Paulo')::date) as parcelas_vencidas,
       min(c.created_at)::date as marcada_mais_antiga,
       sum(i.amount_cents) / 100.0 as valor_total_reais
  from public.charges c
  join public.payment_installments i on i.id = c.payment_installment_id
  join public.clinics cl on cl.id = c.clinic_id
 where c.is_external and c.status = 'externa'
   and i.status in ('em_aberto', 'parcial')
 group by cl.name
 order by 2 desc;
