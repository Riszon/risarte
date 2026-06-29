-- =============================================================================
-- 0052 — Anamnese clínica (Prontuários P3)
-- -----------------------------------------------------------------------------
-- Ficha de anamnese preenchida pelo Coordenador Clínico (1 por cliente por
-- unidade — a unidade compartilhada mantém a sua, igual às demais evidências
-- clínicas). 4 campos livres: queixa principal, histórico de saúde, histórico
-- odontológico e estilo de vida. Versões anteriores guardadas em
-- clinical_anamnesis_revisions (histórico do prontuário).
--
-- RLS espelha clinical_notes: leitura para Admin/escopo da unidade/Planner;
-- escrita só para o Coordenador Clínico (ou Admin). Idempotente.
-- =============================================================================

create table if not exists public.clinical_anamnesis (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  chief_complaint text,
  health_history text,
  dental_history text,
  lifestyle text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid references public.profiles (id),
  unique (client_id, clinic_id)
);
create index if not exists clinical_anamnesis_client_idx
  on public.clinical_anamnesis (client_id);
alter table public.clinical_anamnesis enable row level security;

drop policy if exists "clinical_anamnesis_select" on public.clinical_anamnesis;
create policy "clinical_anamnesis_select" on public.clinical_anamnesis
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "clinical_anamnesis_insert" on public.clinical_anamnesis;
create policy "clinical_anamnesis_insert" on public.clinical_anamnesis
  for insert to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );

drop policy if exists "clinical_anamnesis_update" on public.clinical_anamnesis;
create policy "clinical_anamnesis_update" on public.clinical_anamnesis
  for update to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );

-- -----------------------------------------------------------------------------
-- Histórico de versões anteriores da anamnese.
-- -----------------------------------------------------------------------------
create table if not exists public.clinical_anamnesis_revisions (
  id uuid primary key default gen_random_uuid(),
  anamnesis_id uuid not null
    references public.clinical_anamnesis (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  chief_complaint text,
  health_history text,
  dental_history text,
  lifestyle text,
  edited_by uuid references public.profiles (id),
  edited_at timestamptz not null default now()
);
create index if not exists clinical_anamnesis_revisions_idx
  on public.clinical_anamnesis_revisions (anamnesis_id);
alter table public.clinical_anamnesis_revisions enable row level security;

drop policy if exists "clinical_anamnesis_revisions_select"
  on public.clinical_anamnesis_revisions;
create policy "clinical_anamnesis_revisions_select"
  on public.clinical_anamnesis_revisions
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "clinical_anamnesis_revisions_insert"
  on public.clinical_anamnesis_revisions;
create policy "clinical_anamnesis_revisions_insert"
  on public.clinical_anamnesis_revisions
  for insert to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );
