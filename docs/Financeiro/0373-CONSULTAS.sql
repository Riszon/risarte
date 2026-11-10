-- =============================================================================
-- 0373 — CONSULTAS SÓ DE LEITURA (não mudam nada). Rodar na PRODUÇÃO ANTES da
-- 0373, no SQL Editor, para ver o tamanho do estrago. Mostram só códigos,
-- datas e valores — nenhum nome, CPF ou telefone.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) O CASO DO RELATO — cliente CBE-00001 (Risarte Cambé - Centro)
-- -----------------------------------------------------------------------------
-- A1) As negociações dela e se a venda fechou
select n.code as venda, n.status as situacao_negociacao, n.final_cents / 100.0 as valor,
       n.created_at::date as criada, n.updated_at::date as atualizada,
       cs.closed_at as fechada_em, cs.contract_signed as contrato_assinado,
       tp.version_no as versao_do_plano, tp.status as situacao_do_plano
  from public.plan_negotiations n
  join public.clients c on c.id = n.client_id
  left join public.commercial_sales cs on cs.negotiation_id = n.id
  left join public.treatment_plans tp on tp.id = n.plan_id
 where c.id = '11faf656-ea71-4b3f-ae1b-a841b3fbf760'
 order by n.created_at;

-- A2) A receita de competência dela: cada linha diz se a cobrança ainda existe.
--     Esperado (suspeita): 16 lançamentos abertos = 8 de cobranças que existem
--     + 8 de cobranças APAGADAS por um segundo "Salvar negociação".
select e.accrual_date as competencia, e.description, e.amount_cents / 100.0 as valor,
       e.status, e.created_at as lancado_em,
       (i.id is not null) as cobranca_existe
  from public.financial_entries e
  left join public.payment_installments i on i.id = e.source_id
 where e.source_type = 'installment_accrual'
   and e.clinic_id = (select clinic_id from public.clients where id = '11faf656-ea71-4b3f-ae1b-a841b3fbf760')
   and e.accrual_date >= '2026-10-01'
   and (i.client_id = '11faf656-ea71-4b3f-ae1b-a841b3fbf760'
        or (i.id is null and e.amount_cents in (49694, 49697)))
 order by e.created_at;

-- A3) Quantas vezes as cobranças dela foram gravadas (trilha de alterações)
select ac.op as operacao, ac.occurred_at::date as dia, count(*) as linhas
  from public.audit_changes ac
 where ac.table_name = 'payment_installments'
   and ac.client_id = '11faf656-ea71-4b3f-ae1b-a841b3fbf760'
 group by 1, 2 order by 2, 1;

-- -----------------------------------------------------------------------------
-- B) QUEM MAIS FOI AFETADO (a rede inteira)
-- -----------------------------------------------------------------------------
-- B1) Receita "órfã" (cobrança apagada, receita aberta) — a receita em DOBRO.
select cl.name as unidade, to_char(e.accrual_date, 'YYYY-MM') as mes,
       count(*) as lancamentos, sum(e.amount_cents) / 100.0 as reais
  from public.financial_entries e
  join public.clinics cl on cl.id = e.clinic_id
 where e.source_type = 'installment_accrual' and e.status = 'open'
   and not exists (select 1 from public.payment_installments i where i.id = e.source_id)
 group by 1, 2 order by 1, 2;

-- B2) Receita de venda que ainda NÃO fechou (sem dinheiro recebido), por venda.
select cl.name as unidade, c.code as cliente, n.code as venda, n.status as situacao,
       count(*) as cobrancas, sum(e.amount_cents) / 100.0 as reais_na_dre,
       min(e.accrual_date) as competencia
  from public.financial_entries e
  join public.payment_installments i on i.id = e.source_id
  join public.plan_negotiations n on n.id = i.negotiation_id
  join public.clients c on c.id = i.client_id
  join public.clinics cl on cl.id = e.clinic_id
  left join public.commercial_sales cs on cs.negotiation_id = n.id
 where e.source_type = 'installment_accrual' and e.status = 'open'
   and i.renegotiation_id is null
   and cs.closed_at is null
   and coalesce(i.paid_amount_cents, 0) = 0
 group by 1, 2, 3, 4 order by 1, 2;

-- B3) O mesmo para a VENDA DIRETA não concluída.
select cl.name as unidade, s.code as venda, count(*) as cobrancas,
       sum(e.amount_cents) / 100.0 as reais_na_dre
  from public.financial_entries e
  join public.payment_installments i on i.id = e.source_id
  join public.direct_sales s on s.id = i.direct_sale_id
  join public.clinics cl on cl.id = e.clinic_id
 where e.source_type = 'installment_accrual' and e.status = 'open'
   and s.closed_at is null and coalesce(i.paid_amount_cents, 0) = 0
 group by 1, 2 order by 1, 2;

-- B4) Algum desses meses já foi FECHADO na contabilidade? (a 0373 não mexe nele)
select cl.name as unidade, p.year, p.month
  from public.fiscal_periods p join public.clinics cl on cl.id = p.clinic_id
 where p.status = 'closed' order by 1, 2, 3;
