-- =============================================================================
-- 0076 — Risartanos (cadastro de colaboradores) — H4.1 Lote 1
-- -----------------------------------------------------------------------------
-- Registro de RH do colaborador da unidade (o "Risartano"). Separado do usuário
-- de login (/admin/usuarios) — nem todo colaborador tem acesso ao sistema. Os
-- vínculos com o usuário de login e com o cadastro de cliente entram nos Lotes
-- 2/3. Gerido por Admin Master, Gerente da unidade e Franqueadora (RH da rede).
-- Idempotente.
-- =============================================================================

-- Sequência do código automático (RIS-0001, RIS-0002, ...).
create sequence if not exists public.staff_member_code_seq;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  code text unique,
  full_name text not null,
  preferred_name text,            -- "como quer ser chamado"
  cpf text,
  birth_date date,
  gender text,                    -- male | female | other | undisclosed
  marital_status text,            -- single | married | divorced | widowed | stable_union
  spouse_name text,
  spouse_phone text,
  whatsapp text,
  email text,
  zip_code text,
  address text,
  address_number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  contract_type text,             -- clt | pj | intern | freelancer | other
  role_title text,                -- cargo/função (texto livre)
  photo_path text,                -- Storage (bucket privado) — upload vem a seguir
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz,
  updated_by uuid references public.profiles (id)
);
create index if not exists staff_members_clinic_idx
  on public.staff_members (clinic_id, is_active);

-- Código automático no insert quando não vier preenchido.
create or replace function public.set_staff_member_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := 'RIS-' || lpad(nextval('public.staff_member_code_seq')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists staff_members_set_code on public.staff_members;
create trigger staff_members_set_code
  before insert on public.staff_members
  for each row execute function public.set_staff_member_code();

-- Histórico de alterações (uma linha por edição, campos em jsonb).
create table if not exists public.staff_member_changes (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id),
  fields jsonb not null default '{}'::jsonb
);
create index if not exists staff_member_changes_idx
  on public.staff_member_changes (staff_member_id, changed_at desc);

-- -----------------------------------------------------------------------------
-- RLS — leitura: quem tem acesso à unidade (gestão/rede/franqueado + admin).
-- Escrita: Admin Master, Gerente da unidade e Franqueadora (RH) com acesso.
-- -----------------------------------------------------------------------------
alter table public.staff_members enable row level security;
alter table public.staff_member_changes enable row level security;

drop policy if exists "staff_members_select" on public.staff_members;
create policy "staff_members_select" on public.staff_members
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
  );

drop policy if exists "staff_members_write" on public.staff_members;
create policy "staff_members_write" on public.staff_members
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    or exists (
      select 1 from public.providers_with_access(clinic_id, 'franchisor_staff') p
      where p.user_id = (select auth.uid())
    )
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    or exists (
      select 1 from public.providers_with_access(clinic_id, 'franchisor_staff') p
      where p.user_id = (select auth.uid())
    )
  );

drop policy if exists "staff_member_changes_select" on public.staff_member_changes;
create policy "staff_member_changes_select" on public.staff_member_changes
  for select to authenticated
  using (
    exists (
      select 1 from public.staff_members s
      where s.id = staff_member_changes.staff_member_id
    )
  );

drop policy if exists "staff_member_changes_insert" on public.staff_member_changes;
create policy "staff_member_changes_insert" on public.staff_member_changes
  for insert to authenticated
  with check (
    exists (
      select 1 from public.staff_members s
      where s.id = staff_member_changes.staff_member_id
        and (
          public.is_admin_master()
          or public.has_role_in_clinic(s.clinic_id, array['unit_manager']::public.user_role[])
          or exists (
            select 1 from public.providers_with_access(s.clinic_id, 'franchisor_staff') p
            where p.user_id = (select auth.uid())
          )
        )
    )
  );
