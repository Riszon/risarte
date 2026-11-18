-- LEVANTAMENTO DA ASA5 (só LÊ; não grava nada). Rode na produção e me mande a linha.
-- Responde ao que o plano da ASA5 precisa saber do Empresarial de hoje.
select
  (select count(*) from empresarial.companies where status = 'ACTIVE') as empresas_ativas,
  (select count(*) from empresarial.companies where status = 'SUSPENDED') as empresas_suspensas,
  -- os documentos que viram pagador no Asaas (o CAEPF é a dúvida)
  (select count(*) from empresarial.company_documents where doc_type = 'CNPJ') as docs_cnpj,
  (select count(*) from empresarial.company_documents where doc_type = 'CPF') as docs_cpf,
  (select count(*) from empresarial.company_documents where doc_type in ('CAEPF', 'CNO', 'NIF')) as docs_caepf_cno_nif,
  (select count(*) from empresarial.companies where billing_model = 'por_cnpj') as empresas_um_boleto_por_cnpj,
  -- quem paga os dependentes (1049)
  (select count(*) from empresarial.employees where status = 'ACTIVE' and dependents_payer = 'TITULAR') as titulares_pagam_dependentes,
  (select count(*) from empresarial.employees where status = 'ACTIVE' and dependents_payer = 'OUTRO') as outro_paga_dependentes,
  -- as cobranças de hoje
  (select count(*) from empresarial.adhesion_billing where cancelled_at is null and status in ('PENDING', 'OVERDUE')) as cobrancas_em_aberto,
  (select coalesce(sum(total_amount_cents), 0) from empresarial.adhesion_billing where cancelled_at is null and status in ('PENDING', 'OVERDUE')) as em_aberto_centavos,
  (select count(*) from empresarial.adhesion_billing where status = 'PAID' and reversed_at is null) as cobrancas_pagas,
  (select count(*) from empresarial.adhesion_billing where billing_type = 'MONTHLY' and cancelled_at is null
     and reference_month >= date_trunc('month', current_date - interval '2 months')) as mensalidades_ultimos_3_meses,
  -- as regras do split
  (select count(*) from empresarial.split_rules where company_id is not null) as excecoes_de_split,
  (select first_payment_rislife_pct || ' / ' || recurring_rislife_pct from empresarial.split_rules where company_id is null) as rislife_implantacao_mensalidade,
  -- o legado
  (select count(*) from empresarial.asaas_webhook_events) as avisos_antigos_gravados,
  (select count(*) from empresarial.adhesion_billing where asaas_billing_id is not null) as cobrancas_com_id_antigo,
  -- a carteira da RisLife na integração nova
  (select count(*) from public.gateway_accounts where owner_type = 'recipient' and status <> 'disabled') as carteiras_de_repasse;
