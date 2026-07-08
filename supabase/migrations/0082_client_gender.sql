-- =============================================================================
-- 0082 — Gênero do cliente — H4.2 Anamnese 2.0 (Lote 1)
-- -----------------------------------------------------------------------------
-- Campo de gênero no cadastro do cliente (estava adiado no backlog). É a base
-- para as "perguntas por gênero" da Anamnese 2.0 (Lote 3). Valores:
-- female | male | other | undisclosed (mesmo conjunto dos Risartanos).
-- Idempotente.
-- =============================================================================

alter table public.clients
  add column if not exists gender text;
