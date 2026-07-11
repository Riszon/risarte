-- =============================================================================
-- 0106 — Desenvolvimento Clínico (H4.6 A2 — Módulo do Dentista)
-- -----------------------------------------------------------------------------
-- O Dentista registra, no prontuário, o "Desenvolvimento Clínico" do atendimento
-- (o que foi feito, observações, o que fica para a próxima sessão). Cada anotação
-- é uma entrada com autor + unidade + data, formando uma LINHA DO TEMPO visível a
-- todos os dentistas e coordenadores da unidade + Planner (continuidade do caso).
-- Salvamento automático (a UI regrava e mostra o horário do último save).
-- Registro clínico: sem DELETE. Idempotente.
-- =============================================================================

create table if not exists public.clinical_progress_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  author_id uuid not null references public.profiles (id),
  -- Atendimento de origem (opcional; a anotação vale pelo cliente + autor + data).
  appointment_id uuid references public.appointments (id) on delete set null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinical_progress_notes_client_idx
  on public.clinical_progress_notes (client_id, created_at desc);
alter table public.clinical_progress_notes enable row level security;

-- SELECT: dentistas e coordenadores da unidade + Planner + admin/escopo + acesso
-- pelo histórico do cliente (continuidade entre unidades). Espelha a anamnese
-- (que também libera o dentista, o que user_full_access_clinic_ids NÃO faz).
drop policy if exists "clinical_progress_notes_select" on public.clinical_progress_notes;
create policy "clinical_progress_notes_select" on public.clinical_progress_notes
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

-- INSERT: só o próprio Dentista (author = auth.uid()) na unidade; ou Admin.
drop policy if exists "clinical_progress_notes_insert" on public.clinical_progress_notes;
create policy "clinical_progress_notes_insert" on public.clinical_progress_notes
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (
      author_id = (select auth.uid())
      and public.has_role_in_clinic(clinic_id, array['dentist']::public.user_role[])
    )
  );

-- UPDATE: só o autor edita a própria anotação (ou Admin). Sem DELETE.
drop policy if exists "clinical_progress_notes_update" on public.clinical_progress_notes;
create policy "clinical_progress_notes_update" on public.clinical_progress_notes
  for update to authenticated
  using (public.is_admin_master() or author_id = (select auth.uid()))
  with check (public.is_admin_master() or author_id = (select auth.uid()));
