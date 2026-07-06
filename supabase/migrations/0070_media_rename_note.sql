-- =============================================================================
-- 0070 — Renomear/anotar mídias clínicas (LOTE H3: item H3.12)
-- -----------------------------------------------------------------------------
-- Cada foto/arquivo do cliente ganha um nome de exibição editável e um campo de
-- anotação. Excluir já era possível (policy de delete da 0025). Falta apenas a
-- policy de UPDATE (renomear/anotar), restrita ao Coordenador Clínico da clínica
-- (e Admin Master). Idempotente.
-- =============================================================================

alter table public.clinical_media
  add column if not exists display_name text,
  add column if not exists note text,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles (id);

drop policy if exists "clinical_media_update" on public.clinical_media;
create policy "clinical_media_update" on public.clinical_media
  for update to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(
      clinic_id, array['clinical_coordinator']::public.user_role[]
    )
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(
      clinic_id, array['clinical_coordinator']::public.user_role[]
    )
  );
