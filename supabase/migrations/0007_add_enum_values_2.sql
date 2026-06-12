-- =============================================================================
-- Risarte Odontologia — Migration 0007 (run BEFORE 0008, in a separate
-- execution: Postgres requires new enum values to be committed before use)
-- =============================================================================

-- Nova função: Encantador(a) (SDR) — cadastra clientes, agenda,
-- move Fase 1→2 e Fase 7→6.
alter type public.user_role add value 'sdr' after 'receptionist';

-- Novos tipos de agendamento com regra de encaixe e destaque visual.
alter type public.appointment_type add value 'urgency';
alter type public.appointment_type add value 'emergency';
