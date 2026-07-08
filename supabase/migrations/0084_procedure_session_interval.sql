-- =============================================================================
-- 0084 — Intervalo mínimo entre sessões do protocolo — H4.3 (Lote 1)
-- -----------------------------------------------------------------------------
-- Cada sessão do protocolo (procedure_sessions) ganha o intervalo MÍNIMO em dias
-- em relação à sessão anterior (ex.: implante — 2ª sessão só 90 dias depois da
-- 1ª). null na 1ª sessão (não há anterior). Segue a cascata rede/unidade que já
-- existe na tabela. Base do "agendamento em série" (Lote 2). Idempotente.
-- =============================================================================

alter table public.procedure_sessions
  add column if not exists min_interval_days int;

comment on column public.procedure_sessions.min_interval_days is
  'H4.3: dias minimos apos a sessao anterior (null na 1a sessao).';
