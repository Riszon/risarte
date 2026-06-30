-- =============================================================================
-- 0060 — Objetivos e considerações do planejamento (Apresentação do plano)
-- -----------------------------------------------------------------------------
-- O Dentista Planner passa a registrar, no plano, os OBJETIVOS do tratamento e
-- as CONSIDERAÇÕES do planejamento (texto livre). Esses campos aparecem na
-- apresentação que o Consultor Comercial mostra ao cliente. Idempotente.
-- =============================================================================

alter table public.treatment_plans
  add column if not exists objectives text,
  add column if not exists planning_notes text;
