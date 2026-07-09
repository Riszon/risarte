-- =============================================================================
-- 0091 — Especialidades do profissional (H4.5 Lote 3)
-- -----------------------------------------------------------------------------
-- Para sugerir o profissional certo por sessão, o sistema precisa saber a
-- especialidade de cada dentista. Guardamos como uma lista de textos, usando os
-- mesmos nomes de especialidade já cadastrados nos procedimentos
-- (procedures.specialty). Quando não houver especialidade marcada, a sugestão
-- cai na continuidade do tratamento / histórico (feito na aplicação).
-- Idempotente.
-- =============================================================================

alter table public.staff_members
  add column if not exists specialties text[] not null default '{}'::text[];
