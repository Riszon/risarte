-- =============================================================================
-- 0085 — Data prevista de cada sessão do tratamento — H4.3 (Lote 2)
-- -----------------------------------------------------------------------------
-- Guarda a data SUGERIDA de cada sessão a agendar (treatment_sessions), calculada
-- a partir de uma data inicial + o intervalo mínimo do protocolo (0084), pulando
-- dias fechados/feriados. A recepção confirma/ajusta cada agendamento. Idempotente.
-- =============================================================================

alter table public.treatment_sessions
  add column if not exists planned_date date;
