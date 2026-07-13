-- =============================================================================
-- 0119 — Almoço padrão da REDE (H4.8 Bloco 2)
-- -----------------------------------------------------------------------------
-- A franqueadora define o padrão de almoço da rede na linha clinic_id NULL de
-- clinic_agenda_settings (cascata: a unidade herda, mas pode sobrescrever o seu).
-- A escrita da linha padrão (NULL) passa a ser permitida a quem gerencia a rede
-- (Admin ou gestor da franqueadora — can_manage_network_plan, criada na 0118).
-- A linha padrão já existe (seed da 0043). Idempotente.
-- =============================================================================

drop policy if exists "clinic_agenda_settings_write" on public.clinic_agenda_settings;
create policy "clinic_agenda_settings_write" on public.clinic_agenda_settings
  for all
  to authenticated
  using (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
    or (clinic_id is null and public.can_manage_network_plan())
  )
  with check (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
    or (clinic_id is null and public.can_manage_network_plan())
  );
