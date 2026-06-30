-- =============================================================================
-- 0057 — Sessões/tempo planejados por item do plano (Procedimentos E3)
-- -----------------------------------------------------------------------------
-- O Dentista Planner pode ajustar, por procedimento do plano, a quantidade de
-- sessões e o tempo total planejados (base = protocolo da Unidade ou da Rede).
-- Esses valores seguem para o agendamento por sessão (E4). Idempotente.
-- =============================================================================

alter table public.treatment_plan_option_items
  add column if not exists planned_sessions int,
  add column if not exists planned_total_minutes int;

comment on column public.treatment_plan_option_items.planned_sessions is
  'Quantidade de sessões planejadas para este procedimento neste plano.';
comment on column public.treatment_plan_option_items.planned_total_minutes is
  'Tempo total planejado (minutos) para este procedimento neste plano.';
