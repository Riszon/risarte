-- =============================================================================
-- Risarte Odontologia — Migration 0027 (LOTE E — E6 Avaliação Clínica)
--   - clinical_media.external_url: item por LINK (ex.: escaneamento) sem arquivo
--     no Storage (storage_path passa a poder ser nulo).
--   - clinical_notes editáveis: updated_at/updated_by + tabela de revisões
--     (histórico das versões anteriores) + policy de UPDATE.
-- Idempotente.
-- =============================================================================

-- 1) Mídia por link externo (escaneamento etc.).
alter table public.clinical_media
  add column if not exists external_url text;
alter table public.clinical_media
  alter column storage_path drop not null;

-- 2) Considerações: rastreio de edição.
alter table public.clinical_notes
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles (id);

drop policy if exists "clinical_notes_update" on public.clinical_notes;
create policy "clinical_notes_update" on public.clinical_notes
  for update to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );

-- 3) Histórico de versões anteriores das considerações.
create table if not exists public.clinical_note_revisions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.clinical_notes (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  body text not null,
  edited_by uuid references public.profiles (id),
  edited_at timestamptz not null default now()
);
create index if not exists clinical_note_revisions_note_idx
  on public.clinical_note_revisions (note_id);
alter table public.clinical_note_revisions enable row level security;

drop policy if exists "clinical_note_revisions_select" on public.clinical_note_revisions;
create policy "clinical_note_revisions_select" on public.clinical_note_revisions
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "clinical_note_revisions_insert" on public.clinical_note_revisions;
create policy "clinical_note_revisions_insert" on public.clinical_note_revisions
  for insert to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );
