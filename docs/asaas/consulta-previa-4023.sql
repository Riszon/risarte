-- CONSULTA PRÉVIA DA 4023 (só LÊ; não grava nada). Rode na produção e me mande a linha.
select
  (select production_enabled from public.gateway_settings where id) as producao_ligada,
  to_regclass('public.gateway_charge_issues') is not null as a_4022_esta_ai,
  to_regclass('public.corporate_gateway_settings') is not null as a_4023_ja_rodou,
  -- o legado tem de estar vazio (a 4023 apaga a tabela e a coluna; se tiver dado, ela para)
  case when to_regclass('empresarial.asaas_webhook_events') is null then 0
       else (xpath('/row/n/text()', query_to_xml('select count(*) n from empresarial.asaas_webhook_events', false, true, '')))[1]::text::int end as legado_avisos,
  case when not exists (select 1 from information_schema.columns where table_schema = 'empresarial' and table_name = 'adhesion_billing' and column_name = 'asaas_billing_id') then 0
       else (xpath('/row/n/text()', query_to_xml('select count(*) n from empresarial.adhesion_billing where asaas_billing_id is not null', false, true, '')))[1]::text::int end as legado_ids,
  -- a implantação passa a 100% RisLife (as exceções abaixo de 100 viram 100, com registro na auditoria)
  (select count(*) from empresarial.split_rules where first_payment_rislife_pct <> 100 or first_payment_risarte_pct <> 0) as regras_que_viram_100,
  -- o outro pagador dos dependentes passa a precisar de e-mail ou celular (os de hoje aparecem como pendência)
  (select count(*) from empresarial.employees where status = 'ACTIVE' and dependents_payer = 'OUTRO') as titulares_com_outro_pagador,
  -- as duas âncoras que a 4023 procura nas funções de hoje (têm de ser true)
  position('-- 4021 (ASA6): a cobrança mensal da rede tem o ramo dela.' in pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure)) > 0 as ancora_do_aviso,
  position('-- O 1º pagamento já lançado no financeiro não muda pelo funil.' in pg_get_functiondef('empresarial.guard_lead_signatures()'::regprocedure)) > 0 as ancora_do_funil;
