-- =============================================================================
-- Risarte Odontologia — Migration 0005 (run BEFORE 0006, in a separate
-- execution: Postgres requires new enum values to be committed before use)
-- =============================================================================

-- FASE 1 da jornada: Aquisição (primeiro contato, antes da Conversão Clínica)
alter type public.journey_phase add value 'acquisition' before 'clinical_conversion';

-- Nova função: Dentista (executor) — realiza o tratamento na unidade.
alter type public.user_role add value 'dentist' after 'planner_dentist';
