-- =============================================================================
-- 0077 — Foto do Risartano (H4.1 Lote 1b)
-- -----------------------------------------------------------------------------
-- Bucket PRIVADO de fotos dos colaboradores. Caminho: <clinic_id>/<staff_id>/...
-- (a 1ª pasta é o clinic_id, como em clinical-media). Acesso: Admin, Gerente da
-- unidade e Franqueadora (RH) com acesso — os mesmos que editam o cadastro.
-- URLs sempre assinadas (nunca públicas). Idempotente.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('staff-photos', 'staff-photos', false)
on conflict (id) do nothing;

-- Quem pode gerir a foto de um clinic_id (mesma regra da escrita de staff_members).
create or replace function public.can_manage_staff_clinic(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])
    or exists (
      select 1 from public.providers_with_access(p_clinic_id, 'franchisor_staff') p
      where p.user_id = (select auth.uid())
    );
$$;

drop policy if exists "risarte_staff_photos_select" on storage.objects;
create policy "risarte_staff_photos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'staff-photos'
    and public.can_manage_staff_clinic((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "risarte_staff_photos_insert" on storage.objects;
create policy "risarte_staff_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-photos'
    and public.can_manage_staff_clinic((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "risarte_staff_photos_update" on storage.objects;
create policy "risarte_staff_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'staff-photos'
    and public.can_manage_staff_clinic((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "risarte_staff_photos_delete" on storage.objects;
create policy "risarte_staff_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'staff-photos'
    and public.can_manage_staff_clinic((storage.foldername(name))[1]::uuid)
  );
