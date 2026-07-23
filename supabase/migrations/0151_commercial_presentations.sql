-- =============================================================================
-- Risarte Odontologia — Migration 0151 (Módulo Comercial — COM2)
-- Mesa de apresentação do Consultor (cockpit /comercial/[clientId]).
--
-- commercial_presentations: uma "mesa" por cliente com o material da
-- apresentação comercial — link da videochamada (Google Meet), link da GRAVAÇÃO
-- (o Meet grava do início ao fim; manual-primeiro = colar o link), o RESUMO da
-- apresentação (vai no contrato que o cliente assina — COM4) e as considerações
-- do Consultor. A transcrição automática por IA pluga aqui depois.
-- Idempotente.
-- =============================================================================

create table if not exists public.commercial_presentations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  consultant_id uuid references public.profiles (id),
  meet_link text,
  recording_url text,
  summary text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

alter table public.commercial_presentations enable row level security;

-- Leitura: gestão/rede + equipe comercial (unidade OU Franqueadora com escopo).
drop policy if exists "commercial_presentations_select" on public.commercial_presentations;
create policy "commercial_presentations_select" on public.commercial_presentations
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','clinical_coordinator']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

-- Escrita: Admin e Consultor com escopo (o Assistente lê; edita no fechamento).
drop policy if exists "commercial_presentations_write" on public.commercial_presentations;
create policy "commercial_presentations_write" on public.commercial_presentations
  for all to authenticated
  using (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  )
  with check (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  );
