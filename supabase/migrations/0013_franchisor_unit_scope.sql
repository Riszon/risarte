-- =============================================================================
-- Risarte Odontologia — Migration 0013 (Lote Acesso Franqueadora, etapa A+B+D)
-- Franchisor-role users get a configurable scope of accessible franchise units:
-- all / specific / none. RLS for clients/appointments/journey now respects it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Data model
-- -----------------------------------------------------------------------------
create type public.unit_scope as enum ('all', 'specific', 'none');

-- Scope lives on the user's role row at the FRANCHISOR clinic.
alter table public.user_clinic_roles add column unit_scope public.unit_scope;

-- Specific units when unit_scope = 'specific'.
create table public.role_unit_access (
  id uuid primary key default gen_random_uuid(),
  user_clinic_role_id uuid not null
    references public.user_clinic_roles (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_clinic_role_id, clinic_id)
);

create index role_unit_access_role_idx
  on public.role_unit_access (user_clinic_role_id);

alter table public.role_unit_access enable row level security;

create policy "role_unit_access_select"
  on public.role_unit_access for select
  to authenticated
  using (
    public.is_admin_master()
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.id = role_unit_access.user_clinic_role_id
        and ucr.user_id = (select auth.uid())
    )
  );

create policy "role_unit_access_admin_write"
  on public.role_unit_access for all
  to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Existing franchisor-role rows keep current behaviour: scope 'all'.
update public.user_clinic_roles ucr
set unit_scope = 'all'
from public.clinics c
where c.id = ucr.clinic_id and c.type = 'franchisor';

-- -----------------------------------------------------------------------------
-- B. Accessible clinics now include the franchisor scope units.
--    (user_full_access_clinic_ids = clinics where the user has broad read.)
-- -----------------------------------------------------------------------------
create or replace function public.user_full_access_clinic_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Direct non-dentist roles (unit staff, franchisor staff at the matriz)
  select ucr.clinic_id
  from public.user_clinic_roles ucr
  where ucr.user_id = (select auth.uid())
    and ucr.role <> 'dentist'
  union
  -- Franchisor scope 'all' → every active franchise unit
  select c.id
  from public.clinics c
  where c.type = 'franchise_unit'
    and exists (
      select 1
      from public.user_clinic_roles ucr
      join public.clinics fc on fc.id = ucr.clinic_id
      where ucr.user_id = (select auth.uid())
        and fc.type = 'franchisor'
        and ucr.unit_scope = 'all'
    )
  union
  -- Franchisor scope 'specific' → the listed units
  select rua.clinic_id
  from public.role_unit_access rua
  join public.user_clinic_roles ucr on ucr.id = rua.user_clinic_role_id
  where ucr.user_id = (select auth.uid())
    and ucr.unit_scope = 'specific';
$$;

-- -----------------------------------------------------------------------------
-- B. Rebuild the data-access policies around the scope (drop the old broad
--    is_planner()/is_network_viewer() access; the scope now covers it).
-- -----------------------------------------------------------------------------
drop policy if exists "clients_select_member" on public.clients;
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.user_has_client_history_access(id)
    or exists (
      select 1 from public.appointments a
      where a.client_id = clients.id
        and a.provider_user_id = (select auth.uid())
    )
  );

drop policy if exists "appointments_select_member" on public.appointments;
create policy "appointments_select_member"
  on public.appointments for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or provider_user_id = (select auth.uid())
  );

-- Journey history follows client visibility (relies on clients RLS).
drop policy if exists "journey_history_select_member" on public.journey_phase_history;
create policy "journey_history_select_member"
  on public.journey_phase_history for select
  to authenticated
  using (
    public.is_admin_master()
    or exists (
      select 1 from public.clients c where c.id = journey_phase_history.client_id
    )
  );

-- -----------------------------------------------------------------------------
-- D. Providers (for the agenda) with access to a unit for a given role —
--    includes unit staff AND franchisor staff whose scope reaches the unit.
--    Used so a commercial presentation can be scheduled with a Consultor
--    Comercial of the matriz that has access to the unit.
-- -----------------------------------------------------------------------------
create function public.providers_with_access(
  p_clinic_id uuid,
  p_role public.user_role
)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Unit staff with the role at this clinic
  select ucr.user_id, p.full_name
  from public.user_clinic_roles ucr
  join public.profiles p on p.id = ucr.user_id
  where ucr.clinic_id = p_clinic_id and ucr.role = p_role
  union
  -- Franchisor staff with the role whose scope reaches this clinic
  select ucr.user_id, p.full_name
  from public.user_clinic_roles ucr
  join public.clinics fc on fc.id = ucr.clinic_id and fc.type = 'franchisor'
  join public.profiles p on p.id = ucr.user_id
  where ucr.role = p_role
    and (
      ucr.unit_scope = 'all'
      or exists (
        select 1 from public.role_unit_access rua
        where rua.user_clinic_role_id = ucr.id and rua.clinic_id = p_clinic_id
      )
    );
$$;
