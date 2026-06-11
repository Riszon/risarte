-- =============================================================================
-- Risarte Odontologia — Migration 0002
-- Clients (per clinic, LGPD-aware) and SLA settings (network default +
-- per-unit override).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles.email: copy of auth.users.email so admin screens can list users
-- without touching the auth schema.
-- -----------------------------------------------------------------------------
alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  );
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Helper: franchisor staff can READ data across the whole network
-- -----------------------------------------------------------------------------
create function public.is_network_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_clinic_roles ucr
    join public.clinics c on c.id = ucr.clinic_id
    where ucr.user_id = (select auth.uid())
      and ucr.role = 'franchisor_staff'
      and c.type = 'franchisor'
  );
$$;

-- -----------------------------------------------------------------------------
-- clients: every client belongs to exactly ONE clinic.
-- LGPD: deletion is NEVER physical — status becomes 'anonymized' and personal
-- fields are blanked (legal retention of dental records).
-- -----------------------------------------------------------------------------
create type public.client_status as enum ('active', 'inactive', 'anonymized');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  full_name text not null,
  cpf text,
  birth_date date,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip_code text,
  notes text,
  status public.client_status not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_clinic_idx on public.clients (clinic_id);
create index clients_name_idx on public.clients (clinic_id, full_name);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

alter table public.clients enable row level security;

-- Read: members of the client's clinic, network viewers and Admin Master.
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_clinic_ids())
    or public.is_network_viewer()
  );

-- Create/update: receptionist of that clinic or Admin Master.
create policy "clients_insert_receptionist"
  on public.clients for insert
  to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
  );

create policy "clients_update_receptionist"
  on public.clients for update
  to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
  );

-- No DELETE policy on purpose: clients are anonymized, never deleted.

-- -----------------------------------------------------------------------------
-- sla_settings: clinic_id NULL = network default; a row with clinic_id set
-- overrides the default for that unit. Values in hours.
-- -----------------------------------------------------------------------------
create table public.sla_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete cascade,
  sla_key text not null,
  hours integer not null check (hours > 0),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (clinic_id, sla_key)
);

create trigger sla_settings_set_updated_at
  before update on public.sla_settings
  for each row execute function public.set_updated_at();

alter table public.sla_settings enable row level security;

-- Everyone logged in can read (defaults + overrides of their clinics).
create policy "sla_settings_select_all"
  on public.sla_settings for select
  to authenticated
  using (
    clinic_id is null
    or public.is_admin_master()
    or clinic_id in (select public.user_clinic_ids())
    or public.is_network_viewer()
  );

create policy "sla_settings_insert_admin"
  on public.sla_settings for insert
  to authenticated
  with check (public.is_admin_master());

create policy "sla_settings_update_admin"
  on public.sla_settings for update
  to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

create policy "sla_settings_delete_admin"
  on public.sla_settings for delete
  to authenticated
  using (public.is_admin_master());

-- Network defaults (editable later in the admin screen):
insert into public.sla_settings (clinic_id, sla_key, hours) values
  (null, 'evaluation', 24),                          -- realizar avaliação/reavaliação
  (null, 'planning', 24),                            -- centro de planejamento
  (null, 'evaluation_to_commercial_scheduling', 48), -- avaliação → apresentação agendada
  (null, 'presentation_to_closing', 72),             -- apresentação → fechamento
  (null, 'closing_to_treatment_start', 120);         -- fechamento → início do tratamento
