-- =============================================================================
-- 0104 — Risarte Empresarial: correção da leitura de `companies`
-- -----------------------------------------------------------------------------
-- Bug: ao CADASTRAR uma empresa (INSERT ... RETURNING via `.select()`), a
-- política `companies_select` conferia a visibilidade relendo a própria tabela
-- (`id in accessible_company_ids()`). Numa mesma instrução INSERT+RETURNING, a
-- linha recém-inserida ainda não é visível a essa releitura (regra de CTE do
-- Postgres) → o retorno era barrado com 42501 "violates row-level security".
--
-- Correção: dar um caminho DIRETO na leitura (sem reler a tabela) para quem
-- gere o programa e para o consultor dono — assim o RETURNING passa. O termo
-- `accessible_company_ids()` continua, cobrindo a Gerência de Unidade (que vê a
-- empresa pelos colaboradores na sua unidade). Idempotente.
-- =============================================================================

drop policy if exists companies_select on empresarial.companies;
create policy companies_select on empresarial.companies for select to authenticated
  using (
    empresarial.is_program_manager()
    or assigned_consultant_id = (select auth.uid())
    or id in (select empresarial.accessible_company_ids())
  );
