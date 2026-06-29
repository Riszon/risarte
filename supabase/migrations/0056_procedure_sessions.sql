-- =============================================================================
-- 0056 — Protocolo de sessões do procedimento (Procedimentos E1)
-- -----------------------------------------------------------------------------
-- Cada procedimento passa a ter um PROTOCOLO de sessões (uma ou várias), com
-- nome e tempo (minutos) por sessão. clinic_id NULL = protocolo padrão da Rede;
-- clinic_id preenchido = protocolo personalizado da unidade (E2). O total de
-- minutos e a quantidade de sessões são derivados das linhas.
--
-- procedures.estimated_minutes passa a guardar o TOTAL do protocolo da Rede
-- (cache, recalculado pelo app a cada alteração). Idempotente.
-- =============================================================================

create table if not exists public.procedure_sessions (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  clinic_id uuid references public.clinics (id),
  session_index int not null,
  name text,
  estimated_minutes int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists procedure_sessions_idx
  on public.procedure_sessions (procedure_id, clinic_id, session_index);
alter table public.procedure_sessions enable row level security;

-- Leitura: catálogo (não é dado de paciente) — qualquer autenticado lê.
drop policy if exists "procedure_sessions_select" on public.procedure_sessions;
create policy "procedure_sessions_select" on public.procedure_sessions
  for select to authenticated using (true);

-- Escrita: Rede (clinic_id null) = Admin ou Dentista Planner. Unidade
-- (clinic_id preenchido) = Admin, Dentista Planner ou Coordenador Clínico dela.
drop policy if exists "procedure_sessions_write" on public.procedure_sessions;
create policy "procedure_sessions_write" on public.procedure_sessions
  for all to authenticated
  using (
    public.is_admin_master()
    or (clinic_id is null and public.is_planner())
    or (
      clinic_id is not null
      and (
        public.is_planner()
        or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
      )
    )
  )
  with check (
    public.is_admin_master()
    or (clinic_id is null and public.is_planner())
    or (
      clinic_id is not null
      and (
        public.is_planner()
        or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
      )
    )
  );
