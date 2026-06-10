-- =============================================================================
-- Risarte Odontologia — Initial schema
-- Tables: clinics, profiles, user_clinic_roles, audit_logs
-- All tables have Row Level Security (RLS) enabled.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.clinic_type as enum ('franchisor', 'franchise_unit');

create type public.user_role as enum (
  'receptionist',
  'clinical_coordinator',
  'planner_dentist',
  'commercial_consultant',
  'commercial_assistant',
  'unit_manager',
  'franchisor_staff',
  'franchisee'
);

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.clinic_type not null default 'franchise_unit',
  cnpj text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per authenticated user, created automatically by trigger.
-- Admin Master is a global flag (not tied to a clinic).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  is_admin_master boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A user may belong to several clinics with a DIFFERENT role in each one.
create table public.user_clinic_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, clinic_id, role)
);

create index user_clinic_roles_user_idx on public.user_clinic_roles (user_id);
create index user_clinic_roles_clinic_idx on public.user_clinic_roles (clinic_id);

-- LGPD audit trail: who viewed/created/changed sensitive records.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  clinic_id uuid references public.clinics (id) on delete set null,
  action text not null, -- 'view' | 'create' | 'update' | 'delete' | 'export' | ...
  entity_type text not null, -- e.g. 'client', 'treatment_plan'
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_user_idx on public.audit_logs (user_id);
create index audit_logs_created_idx on public.audit_logs (created_at);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clinics_set_updated_at
  before update on public.clinics
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Auto-create a profile when a new auth user is created
-- -----------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RLS helper functions
-- SECURITY DEFINER so they can read the tables without triggering the
-- row-level policies again (avoids infinite recursion in policies).
-- -----------------------------------------------------------------------------
create function public.is_admin_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin_master from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create function public.user_clinic_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ucr.clinic_id
  from public.user_clinic_roles ucr
  where ucr.user_id = (select auth.uid());
$$;

create function public.has_role_in_clinic(target_clinic_id uuid, allowed_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_clinic_roles ucr
    where ucr.user_id = (select auth.uid())
      and ucr.clinic_id = target_clinic_id
      and ucr.role = any (allowed_roles)
  );
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.user_clinic_roles enable row level security;
alter table public.audit_logs enable row level security;

-- clinics: members see their own clinics; only Admin Master manages them.
create policy "clinics_select_member_or_admin"
  on public.clinics for select
  to authenticated
  using (
    public.is_admin_master()
    or id in (select public.user_clinic_ids())
  );

create policy "clinics_insert_admin"
  on public.clinics for insert
  to authenticated
  with check (public.is_admin_master());

create policy "clinics_update_admin"
  on public.clinics for update
  to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

create policy "clinics_delete_admin"
  on public.clinics for delete
  to authenticated
  using (public.is_admin_master());

-- profiles: each user sees and edits their own profile; Admin Master sees all.
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.is_admin_master());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    -- A user must not be able to promote themselves to Admin Master:
    and is_admin_master = (
      select p.is_admin_master from public.profiles p where p.id = (select auth.uid())
    )
  );

create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- user_clinic_roles: users see their own roles; only Admin Master manages them.
create policy "user_clinic_roles_select_own_or_admin"
  on public.user_clinic_roles for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_master());

create policy "user_clinic_roles_insert_admin"
  on public.user_clinic_roles for insert
  to authenticated
  with check (public.is_admin_master());

create policy "user_clinic_roles_update_admin"
  on public.user_clinic_roles for update
  to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

create policy "user_clinic_roles_delete_admin"
  on public.user_clinic_roles for delete
  to authenticated
  using (public.is_admin_master());

-- audit_logs: append-only. Users insert their own entries; only Admin Master reads.
-- No update/delete policies on purpose: audit history must be immutable.
create policy "audit_logs_insert_own"
  on public.audit_logs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "audit_logs_select_admin"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin_master());
