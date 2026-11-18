-- CONSULTA PRÉVIA da 4022 (só LÊ; não grava nada). Rode na produção ANTES da 4022.
--
-- O que ela responde:
--   unidades_prontas_hoje   quantas unidades estão "Prontas para cobrar" agora. Com a 4022,
--                           TODAS perdem a marca até o débito, o levantamento e a nova marcação
--                           (a unidade sem a marca não emite cobrança). Esperado: 0.
--   nomes_das_prontas       quais são (vazio se 0).
--   producao_ligada         o interruptor hoje. Esperado: false.
--   contas_producao         contas Asaas de produção ativas. Esperado: 0.
--   contas_sandbox          contas de teste ativas (só informativo).
--   a_4021a_esta_ai         a migração anterior (4021a) na produção. Esperado: true.
--   a_4022_ja_rodou         a 4022 já rodou? Esperado: false.
--   pasta_ja_existe         a pasta privada asaas-rede. Esperado: false.
select
  (select count(*) from public.clinics k where public.central_is_ready(k.id)) as unidades_prontas_hoje,
  (select coalesce(string_agg(k.name, ', ' order by k.name), '') from public.clinics k where public.central_is_ready(k.id)) as nomes_das_prontas,
  (select production_enabled from public.gateway_settings where id) as producao_ligada,
  (select count(*) from public.gateway_accounts where status = 'active' and environment = 'production') as contas_producao,
  (select count(*) from public.gateway_accounts where status = 'active' and environment = 'sandbox') as contas_sandbox,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = '_franchise_ledger_found') as a_4021a_esta_ai,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'gateway_production_switch') as a_4022_ja_rodou,
  exists (select 1 from storage.buckets where id = 'asaas-rede') as pasta_ja_existe;
