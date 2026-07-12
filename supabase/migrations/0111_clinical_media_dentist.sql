-- =============================================================================
-- 0111 — Câmera intraoral: dentista na mídia clínica (H4.12)
-- -----------------------------------------------------------------------------
-- A captura da câmera salva no bucket clínico (imagem do prontuário). O dono
-- decidiu que Coordenador E Dentista capturam. O Storage já libera o dentista
-- (0109); aqui liberamos a TABELA clinical_media (metadados) para o dentista da
-- unidade: LEITURA (ver as imagens) e INSERÇÃO (salvar a captura). Idempotente.
-- =============================================================================

drop policy if exists "clinical_media_select" on public.clinical_media;
create policy "clinical_media_select" on public.clinical_media
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

drop policy if exists "clinical_media_insert" on public.clinical_media;
create policy "clinical_media_insert" on public.clinical_media
  for insert to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator','dentist']::public.user_role[])
  );
