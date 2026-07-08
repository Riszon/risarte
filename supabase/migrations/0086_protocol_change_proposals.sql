-- =============================================================================
-- 0086 — Propostas de mudança de protocolo (definitivo) — H4.3 (Lote 4)
-- -----------------------------------------------------------------------------
-- O Dentista Planner deixa de gravar o protocolo DEFINITIVO direto; ele PROPÕE
-- uma alteração (escopo rede ou unidade). A proposta notifica o aprovador:
--   * unidade  → Coordenador Clínico da unidade (confirma/aplica ou recusa);
--   * rede     → Admin Master.
-- Admin (rede) e Coordenador (a própria unidade) seguem aplicando direto. O
-- ajuste do protocolo DO CASO (no plano do cliente) continua direto e não passa
-- por aqui. Idempotente.
-- =============================================================================

create table if not exists public.protocol_change_proposals (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  clinic_id uuid references public.clinics (id),   -- null = rede; preenchido = unidade
  proposed_by uuid references public.profiles (id),
  note text,                                       -- justificativa do Planner
  sessions jsonb not null default '[]'::jsonb,      -- [{name, minutes, intervalDays}]
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);
create index if not exists protocol_proposals_idx
  on public.protocol_change_proposals (status, clinic_id, created_at desc);
alter table public.protocol_change_proposals enable row level security;

-- Leitura: admin; o próprio autor; ou o Coordenador da unidade (escopo unidade).
drop policy if exists "protocol_proposals_select" on public.protocol_change_proposals;
create policy "protocol_proposals_select" on public.protocol_change_proposals
  for select to authenticated
  using (
    public.is_admin_master()
    or proposed_by = (select auth.uid())
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  );

-- Cria: Planner (ou Admin), sempre como autor.
drop policy if exists "protocol_proposals_insert" on public.protocol_change_proposals;
create policy "protocol_proposals_insert" on public.protocol_change_proposals
  for insert to authenticated
  with check (
    proposed_by = (select auth.uid())
    and (public.is_admin_master() or public.is_planner())
  );

-- Revisa (aprova/recusa): Admin (qualquer) ou Coordenador da unidade.
drop policy if exists "protocol_proposals_update" on public.protocol_change_proposals;
create policy "protocol_proposals_update" on public.protocol_change_proposals
  for update to authenticated
  using (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  )
  with check (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  );

-- -----------------------------------------------------------------------------
-- Protocolo DEFINITIVO: o Planner não grava mais direto (só por proposta).
-- Rede = Admin; Unidade = Admin ou Coordenador da unidade.
-- -----------------------------------------------------------------------------
drop policy if exists "procedure_sessions_write" on public.procedure_sessions;
create policy "procedure_sessions_write" on public.procedure_sessions
  for all to authenticated
  using (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  )
  with check (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  );

-- -----------------------------------------------------------------------------
-- Notificações (a tabela não tem insert policy — só por SECURITY DEFINER).
-- -----------------------------------------------------------------------------
create or replace function public.notify_protocol_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.protocol_change_proposals%rowtype;
  v_proc text;
  v_by text;
begin
  select * into r from public.protocol_change_proposals where id = p_proposal_id;
  if r.id is null then return; end if;
  select name into v_proc from public.procedures where id = r.procedure_id;
  select full_name into v_by from public.profiles where id = r.proposed_by;

  if r.clinic_id is null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select p.id, null,
      'Proposta de protocolo (rede)',
      coalesce(v_by, 'O Planner') || ' propôs alterar o protocolo de '
        || coalesce(v_proc, 'um procedimento') || ' na rede.',
      '/procedimentos'
    from public.profiles p
    where p.is_admin_master and p.id <> coalesce(r.proposed_by, '00000000-0000-0000-0000-000000000000'::uuid);
  else
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, r.clinic_id,
      'Proposta de protocolo',
      coalesce(v_by, 'O Planner') || ' propôs alterar o protocolo de '
        || coalesce(v_proc, 'um procedimento') || ' nesta unidade.',
      '/procedimentos?unidade=' || r.clinic_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = r.clinic_id
      and ucr.role = 'clinical_coordinator'
      and ucr.user_id <> coalesce(r.proposed_by, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
end;
$$;

create or replace function public.notify_protocol_decision(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.protocol_change_proposals%rowtype;
  v_proc text;
begin
  select * into r from public.protocol_change_proposals where id = p_proposal_id;
  if r.id is null or r.proposed_by is null then return; end if;
  select name into v_proc from public.procedures where id = r.procedure_id;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  values (
    r.proposed_by,
    r.clinic_id,
    case when r.status = 'approved'
      then 'Proposta de protocolo aprovada'
      else 'Proposta de protocolo recusada' end,
    'Protocolo de ' || coalesce(v_proc, 'procedimento') || ': sua proposta foi '
      || case when r.status = 'approved' then 'aprovada e aplicada.' else 'recusada.' end
      || coalesce(' Motivo: ' || nullif(r.review_notes, ''), ''),
    '/procedimentos'
  );
end;
$$;

grant execute on function public.notify_protocol_proposal(uuid) to authenticated;
grant execute on function public.notify_protocol_decision(uuid) to authenticated;
