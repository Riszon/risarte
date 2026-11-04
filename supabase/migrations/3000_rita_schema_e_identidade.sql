-- =============================================================================
-- 3000 — Rita (assistente virtual de SDR), Fase 0A.1: o schema e a identidade
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.1 (DA1, DA2, DA3, DA4).
-- Depende da 0365 (core): `profiles.kind` e a auditoria lendo `rita.actor`.
--
-- O QUE CRIA
--   * O schema `rita` (faixa de migrações 3000+). Ninguém além da chave de
--     serviço usa o schema; as views da tela (0A.7) abrem leitura depois.
--   * `rita.agent_id()`: o id do perfil da assistente (o único `kind = 'agent'`).
--   * `rita.begin_as_agent()`: declara a Rita como autora da transação
--     (`set_config('rita.actor', <id>, true)`) e devolve o id. Toda função
--     `rita.*` que gravar alguma coisa chama esta primeiro: assim a auditoria
--     (0288/0365) registra "Rita (assistente virtual)", não "Sistema".
--     Sem o perfil da Rita criado, recusa com RITA_AGENT_MISSING.
--
-- NÃO CRIA o usuário técnico: ele nasce pelo roteiro
-- `scripts/rita-criar-identidade.mjs` (chave de serviço, sem senha, login
-- bloqueado), rodado em cada banco.
--
-- Nenhuma tabela nova. Idempotente.
-- =============================================================================

create schema if not exists rita;

revoke all on schema rita from public;
revoke all on schema rita from anon, authenticated;
grant usage on schema rita to service_role;

-- -----------------------------------------------------------------------------
-- O id da assistente
-- -----------------------------------------------------------------------------
create or replace function rita.agent_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.kind = 'agent' limit 1;
$$;

revoke execute on function rita.agent_id() from public, anon, authenticated;
grant execute on function rita.agent_id() to service_role;

-- -----------------------------------------------------------------------------
-- A Rita como autora da transação
-- -----------------------------------------------------------------------------
create or replace function rita.begin_as_agent()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Pessoa logada nunca fala pela Rita (o Supabase já recusa a chamada
  -- antes; esta é a segunda barreira).
  if auth.uid() is not null then
    raise exception 'NOT_ALLOWED';
  end if;

  v_id := rita.agent_id();
  if v_id is null then
    raise exception 'RITA_AGENT_MISSING'
      using hint = 'Rodar scripts/rita-criar-identidade.mjs neste banco.';
  end if;

  perform set_config('rita.actor', v_id::text, true);
  return v_id;
end;
$$;

revoke execute on function rita.begin_as_agent() from public, anon, authenticated;
grant execute on function rita.begin_as_agent() to service_role;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Conferência (rodar depois; esperado: 1 · 2 · 0)
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from pg_namespace where nspname = 'rita') as schema_rita,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'rita') as funcoes_rita,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'rita'
--       and (has_function_privilege('anon', p.oid, 'execute')
--         or has_function_privilege('authenticated', p.oid, 'execute'))) as abertas_a_quem_loga;
