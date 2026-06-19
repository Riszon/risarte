-- =============================================================================
-- Risarte Odontologia — Migration 0028 (LOTE E — E6)
-- Novo tipo de mídia clínica: 'video' (o Coordenador grava/anexa um vídeo para
-- explicar melhor ao Dentista Planner). Reproduzido sem baixar (player inline).
-- Idempotente (add value if not exists).
-- =============================================================================

alter type public.clinical_media_kind add value if not exists 'video';
