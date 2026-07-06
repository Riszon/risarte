-- =============================================================================
-- 0072 — Excluir cadeira/sala (soft delete, só Admin) — Ajuste pré-Grupo 4 #1
-- -----------------------------------------------------------------------------
-- O Admin pode EXCLUIR uma cadeira: ela some das opções de agendamento FUTURO,
-- mas os agendamentos PASSADOS mantêm o vínculo com a sala (o nome continua
-- resolvendo) e a interface marca "(excluída)". Não é apagamento físico — a
-- linha continua existindo com deleted_at preenchido, preservando o histórico.
-- A permissão de excluir é validada na action (requireAdminMaster); a RLS de
-- escrita já existente (admin/gerente) continua valendo para update.
-- Idempotente.
-- =============================================================================

alter table public.clinic_rooms
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id);

-- Índice parcial: listar/contar rapidamente as salas vivas de uma unidade.
create index if not exists clinic_rooms_active_idx
  on public.clinic_rooms (clinic_id)
  where deleted_at is null;
