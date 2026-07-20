-- =============================================================================
-- Risarte Odontologia — Migration 0135 (LOTE Avaliações & Planos — Fase 3)
-- Avaliações/reavaliações VERSIONADAS (rodadas).
--
-- Até aqui a coleta clínica (considerações + mídias) empilhava tudo no cliente
-- sem separar "quando". Esta migração cria a "avaliação" como uma RODADA com
-- carimbo de data: Avaliação 1, Reavaliação 2, Reavaliação 3… Cada consideração
-- e cada mídia passa a pertencer à rodada ABERTA. Iniciar uma reavaliação FECHA
-- a rodada atual (que fica congelada e intacta) e abre a próxima.
--
-- Consentimento e anamnese continuam CONTÍNUOS (decisão do dono) — não são
-- duplicados por rodada.
--
-- Idempotente (safe para rodar de novo).
-- =============================================================================

-- 1) Enum do tipo de rodada. --------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'clinical_evaluation_kind') then
    create type public.clinical_evaluation_kind as enum ('avaliacao', 'reavaliacao');
  end if;
end $$;

-- 2) Tabela das rodadas (por cliente + unidade, igual às demais tabelas clínicas).
create table if not exists public.clinical_evaluations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  kind public.clinical_evaluation_kind not null default 'avaliacao',
  seq integer not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  title text,
  summary text,
  opened_by uuid references public.profiles (id),
  opened_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clinical_evaluations_client_idx
  on public.clinical_evaluations (client_id, clinic_id, seq desc);
-- Uma rodada por número (cliente+unidade) e no máximo UMA aberta por vez.
create unique index if not exists clinical_evaluations_seq_uk
  on public.clinical_evaluations (client_id, clinic_id, seq);
create unique index if not exists clinical_evaluations_one_open_uk
  on public.clinical_evaluations (client_id, clinic_id) where status = 'open';
alter table public.clinical_evaluations enable row level security;

drop policy if exists "clinical_evaluations_select" on public.clinical_evaluations;
create policy "clinical_evaluations_select" on public.clinical_evaluations
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

-- Escrita direta só por Coordenador/Admin (as RPCs abaixo são SECURITY DEFINER
-- e não dependem destas policies; ficam aqui por robustez/consistência).
drop policy if exists "clinical_evaluations_insert" on public.clinical_evaluations;
create policy "clinical_evaluations_insert" on public.clinical_evaluations
  for insert to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator','dentist']::public.user_role[])
  );

drop policy if exists "clinical_evaluations_update" on public.clinical_evaluations;
create policy "clinical_evaluations_update" on public.clinical_evaluations
  for update to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );

-- 3) Considerações e mídias apontam para a rodada (nulo = ainda sem rodada). ---
alter table public.clinical_notes
  add column if not exists evaluation_id uuid references public.clinical_evaluations (id) on delete set null;
alter table public.clinical_media
  add column if not exists evaluation_id uuid references public.clinical_evaluations (id) on delete set null;
create index if not exists clinical_notes_evaluation_idx
  on public.clinical_notes (evaluation_id);
create index if not exists clinical_media_evaluation_idx
  on public.clinical_media (evaluation_id);

-- 4) Backfill: tudo que já existe vira a "Avaliação 1" de cada cliente+unidade.
--    Nada se perde, nada muda de lugar. Só cria onde ainda não há rodada.
insert into public.clinical_evaluations
  (client_id, clinic_id, kind, seq, status, opened_at)
select d.client_id, d.clinic_id, 'avaliacao', 1, 'open', d.first_at
from (
  select client_id, clinic_id, min(created_at) as first_at
  from (
    select client_id, clinic_id, created_at from public.clinical_notes
    union all
    select client_id, clinic_id, created_at from public.clinical_media
  ) x
  group by client_id, clinic_id
) d
where not exists (
  select 1 from public.clinical_evaluations e
  where e.client_id = d.client_id and e.clinic_id = d.clinic_id
);

update public.clinical_notes n set evaluation_id = e.id
from public.clinical_evaluations e
where n.evaluation_id is null
  and e.client_id = n.client_id and e.clinic_id = n.clinic_id and e.seq = 1;

update public.clinical_media m set evaluation_id = e.id
from public.clinical_evaluations e
where m.evaluation_id is null
  and e.client_id = m.client_id and e.clinic_id = m.clinic_id and e.seq = 1;

-- 5) RPC: garante a rodada ABERTA (cria "Avaliação 1" se ainda não houver). ----
--    Chamada pela app ao registrar consideração/mídia. Coordenador ou Dentista.
create or replace function public.ensure_open_evaluation(
  p_client uuid,
  p_clinic uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         p_clinic, array['clinical_coordinator','dentist']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select id into v_id from public.clinical_evaluations
    where client_id = p_client and clinic_id = p_clinic and status = 'open'
    order by seq desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.clinical_evaluations
    (client_id, clinic_id, kind, seq, status, opened_by)
  values (p_client, p_clinic, 'avaliacao',
    coalesce((select max(seq) from public.clinical_evaluations
              where client_id = p_client and clinic_id = p_clinic), 0) + 1,
    'open', v_user)
  returning id into v_id;
  return v_id;
end;
$$;

-- 6) RPC: inicia uma NOVA rodada (fecha a atual, abre a próxima). Coord/Admin. --
create or replace function public.open_new_evaluation(
  p_client uuid,
  p_clinic uuid,
  p_kind public.clinical_evaluation_kind default 'reavaliacao',
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         p_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.clinical_evaluations
    set status = 'closed', closed_by = v_user, closed_at = now()
  where client_id = p_client and clinic_id = p_clinic and status = 'open';

  insert into public.clinical_evaluations
    (client_id, clinic_id, kind, seq, status, title, opened_by)
  values (p_client, p_clinic, p_kind,
    coalesce((select max(seq) from public.clinical_evaluations
              where client_id = p_client and clinic_id = p_clinic), 0) + 1,
    'open', nullif(btrim(p_title), ''), v_user)
  returning id into v_id;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, p_clinic, 'create', 'clinical_evaluation', v_id::text,
    jsonb_build_object('kind', p_kind::text));
  return v_id;
end;
$$;

revoke all on function public.ensure_open_evaluation(uuid, uuid) from public;
grant execute on function public.ensure_open_evaluation(uuid, uuid) to authenticated;
revoke all on function public.open_new_evaluation(uuid, uuid, public.clinical_evaluation_kind, text) from public;
grant execute on function public.open_new_evaluation(uuid, uuid, public.clinical_evaluation_kind, text) to authenticated;
