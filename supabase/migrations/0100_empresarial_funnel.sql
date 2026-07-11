-- =============================================================================
-- 0100 — Risarte Empresarial (Fase 6): funil comercial do Consultor RisLife
-- -----------------------------------------------------------------------------
-- Enriquece empresarial.commercial_leads (agenda/próxima ação, valor estimado,
-- anotações) e cria a linha do tempo (commercial_lead_activities). RLS: gestor
-- do programa vê tudo; o consultor vê os leads que gerencia.
-- Idempotente.
-- =============================================================================

alter table empresarial.commercial_leads
  add column if not exists next_action_at timestamptz,
  add column if not exists next_action_note text,
  add column if not exists estimated_value_cents bigint,
  add column if not exists notes text;

create index if not exists commercial_leads_next_action_idx
  on empresarial.commercial_leads (next_action_at);

-- Linha do tempo do lead (contatos, reuniões, notas) --------------------------
create table if not exists empresarial.commercial_lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references empresarial.commercial_leads (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  kind varchar(20) not null default 'NOTE'
    check (kind in ('NOTE','CALL','MEETING','STAGE_CHANGE','PROPOSAL')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists lead_activities_lead_idx
  on empresarial.commercial_lead_activities (lead_id, created_at);

alter table empresarial.commercial_lead_activities enable row level security;

-- Acesso à atividade segue o acesso ao lead (gestor do programa ou consultor dono).
create or replace function empresarial.can_access_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select empresarial.is_program_manager()
      or exists (
        select 1 from empresarial.commercial_leads l
        where l.id = p_lead_id and l.consultant_id = (select auth.uid())
      );
$$;
grant execute on function empresarial.can_access_lead(uuid) to authenticated;

drop policy if exists lead_activities_select on empresarial.commercial_lead_activities;
create policy lead_activities_select on empresarial.commercial_lead_activities
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

drop policy if exists lead_activities_write on empresarial.commercial_lead_activities;
create policy lead_activities_write on empresarial.commercial_lead_activities
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete
  on empresarial.commercial_lead_activities to authenticated;
grant all on empresarial.commercial_lead_activities to service_role;
