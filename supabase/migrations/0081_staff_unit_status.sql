-- =============================================================================
-- 0081 — Status do Risartano por unidade — H4.1 (ajuste)
-- -----------------------------------------------------------------------------
-- Um Risartano pode atender em várias unidades (as unidades vêm do ACESSO —
-- user_clinic_roles do login vinculado). Agora cada unidade tem seu próprio
-- Ativo/Inativo: `inactive_unit_ids` guarda as unidades onde ele está inativo.
-- Ativar/inativar numa unidade NÃO afeta as demais. O `is_active` global segue
-- valendo para o cadastro sem login (unidade única) e como desligamento geral.
-- Idempotente.
-- =============================================================================

alter table public.staff_members
  add column if not exists inactive_unit_ids uuid[] not null default '{}'::uuid[];
