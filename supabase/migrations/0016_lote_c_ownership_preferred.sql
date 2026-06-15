-- =============================================================================
-- Risarte Odontologia — Migration 0016 (Lote C)
-- 1. is_sdr() helper
-- 2. Appointments: SDR can schedule in units she has access to; SDR edits only
--    her own appointments; Recepcionista edits any appointment of her unit.
-- 3. clients.preferred_clinic_id: SDR-registered clients are owned by the
--    Franqueadora (FRA code) but also appear in the preferred unit's list.
-- =============================================================================

create or replace function public.is_sdr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_clinic_roles ucr
    where ucr.user_id = (select auth.uid()) and ucr.role = 'sdr'
  );
$$;

-- -----------------------------------------------------------------------------
-- Appointments insert: receptionist of the clinic, or an SDR with access to it.
-- -----------------------------------------------------------------------------
drop policy if exists "appointments_insert_receptionist" on public.appointments;
create policy "appointments_insert_receptionist"
  on public.appointments for insert
  to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

-- Appointments update: receptionist of the clinic edits ANY; SDR edits only
-- the appointments she created.
drop policy if exists "appointments_update_receptionist" on public.appointments;
create policy "appointments_update_receptionist"
  on public.appointments for update
  to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and created_by = (select auth.uid()))
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and created_by = (select auth.uid()))
  );

-- -----------------------------------------------------------------------------
-- clients.preferred_clinic_id + visibility for the preferred unit
-- -----------------------------------------------------------------------------
alter table public.clients
  add column preferred_clinic_id uuid references public.clinics (id);

create index clients_preferred_idx on public.clients (preferred_clinic_id);

drop policy if exists "clients_select_member" on public.clients;
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or preferred_clinic_id in (select public.user_full_access_clinic_ids())
    or public.user_has_client_history_access(id)
    or exists (
      select 1 from public.appointments a
      where a.client_id = clients.id
        and a.provider_user_id = (select auth.uid())
    )
  );
