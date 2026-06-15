-- =============================================================================
-- Risarte Odontologia — Migration 0010 (run BEFORE 0011, in a separate
-- execution: Postgres requires new enum values to be committed before use)
-- =============================================================================

-- Novas funções de unidade.
alter type public.user_role add value 'tsb'; -- Técnica em Saúde Bucal
alter type public.user_role add value 'asb'; -- Auxiliar em Saúde Bucal
