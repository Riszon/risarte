-- =============================================================================
-- 0055 — Tempo estimado por procedimento (Procedimentos PR1)
-- -----------------------------------------------------------------------------
-- Minutos estimados de execução de cada procedimento. Usado para ajustar a
-- duração no agendamento (PR2) e somar o tempo total do plano (PR3). Idempotente.
-- =============================================================================

alter table public.procedures
  add column if not exists estimated_minutes integer;

comment on column public.procedures.estimated_minutes is
  'Tempo estimado de execução em minutos (ajusta a duração no agendamento e o tempo total do plano).';
