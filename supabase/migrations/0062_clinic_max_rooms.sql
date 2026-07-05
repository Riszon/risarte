-- =============================================================================
-- 0062 — Teto de salas/cadeiras por clínica (LOTE H1: item H1.10)
-- -----------------------------------------------------------------------------
-- Quem define QUANTAS salas (cadeiras) a unidade tem é o Admin Master, no
-- cadastro da clínica (clinics.max_rooms). A Gerente da unidade configura os
-- nomes, a sala do Coordenador e ativa/desativa, mas NÃO pode criar salas acima
-- desse teto. Backfill: clínicas existentes recebem o maior entre as salas que
-- já têm e 4 (headroom para não travar quem já configurou). Idempotente.
-- =============================================================================

alter table public.clinics
  add column if not exists max_rooms int not null default 4;

-- Garante que o teto nunca fique abaixo do que a unidade já criou.
update public.clinics c
set max_rooms = greatest(
  c.max_rooms,
  coalesce((
    select count(*) from public.clinic_rooms r where r.clinic_id = c.id
  ), 0),
  1
);

alter table public.clinics
  add constraint clinics_max_rooms_positive check (max_rooms >= 1) not valid;
