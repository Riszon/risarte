-- =============================================================================
-- 0083 — Perguntas por gênero + campos condicionais — H4.2 Anamnese 2.0 (Lote 3)
-- -----------------------------------------------------------------------------
-- Cada pergunta da ficha pode ser direcionada e/ou condicional:
--   * gender — null = todos; female|male|other|undisclosed = só para clientes
--     daquele gênero (usa clients.gender, do Lote 1).
--   * condition_question_id — pergunta "gatilho" (na mesma ficha).
--   * condition_values — a pergunta só aparece se a resposta da gatilho for um
--     destes valores (jsonb de strings). Vazio/nulo = mostra se a gatilho tiver
--     qualquer resposta.
-- Idempotente.
-- =============================================================================

alter table public.anamnesis_questions
  add column if not exists gender text;

alter table public.anamnesis_questions
  add column if not exists condition_question_id uuid
    references public.anamnesis_questions (id) on delete set null;

alter table public.anamnesis_questions
  add column if not exists condition_values jsonb;
