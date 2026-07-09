-- =============================================================================
-- 0087 — Etapas do tratamento (H4.5 Cockpit 2.0, Lote 1)
-- -----------------------------------------------------------------------------
-- O Dentista Planner passa a dividir cada OPÇÃO do plano em ETAPAS (fases), ex.:
-- "Etapa 1 – Adequação do meio", "Etapa 2 – Reabilitação". Cada item do orçamento
-- pertence a uma etapa (ou a nenhuma). Quando a opção aprovada vira sessões
-- (ensure_treatment_sessions), cada sessão herda o nome/ordem da etapa
-- (denormalizado, como já é feito com procedure_name) para o painel/cockpit
-- agruparem por etapa sem depender do plano depois.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Etapas de uma opção do plano. clinic_id denormalizado (RLS autossuficiente,
-- sem subconsulta cruzada → sem recursão), mesmo padrão de tpo_items.
-- -----------------------------------------------------------------------------
create table if not exists public.treatment_plan_stages (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.treatment_plan_options (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists treatment_plan_stages_option_idx
  on public.treatment_plan_stages (option_id);
alter table public.treatment_plan_stages enable row level security;

-- RLS espelha treatment_plan_option_items: leem admin/rede/Planner; escreve o
-- Planner (na sua rede) ou o Admin Master.
drop policy if exists "tp_stages_select" on public.treatment_plan_stages;
create policy "tp_stages_select" on public.treatment_plan_stages
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "tp_stages_insert" on public.treatment_plan_stages;
create policy "tp_stages_insert" on public.treatment_plan_stages
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

drop policy if exists "tp_stages_update" on public.treatment_plan_stages;
create policy "tp_stages_update" on public.treatment_plan_stages
  for update to authenticated
  using (public.is_admin_master() or public.is_planner());

drop policy if exists "tp_stages_delete" on public.treatment_plan_stages;
create policy "tp_stages_delete" on public.treatment_plan_stages
  for delete to authenticated
  using (public.is_admin_master() or public.is_planner());

-- -----------------------------------------------------------------------------
-- O item do orçamento pertence a uma etapa (opcional; null = "Sem etapa").
-- Ao remover a etapa, o item fica sem etapa (não some).
-- -----------------------------------------------------------------------------
alter table public.treatment_plan_option_items
  add column if not exists stage_id uuid
    references public.treatment_plan_stages (id) on delete set null;

-- -----------------------------------------------------------------------------
-- A sessão gerada carrega o nome e a ordem da etapa (denormalizado).
-- -----------------------------------------------------------------------------
alter table public.treatment_sessions
  add column if not exists stage_name text;
alter table public.treatment_sessions
  add column if not exists stage_order integer;

-- -----------------------------------------------------------------------------
-- ensure_treatment_sessions: agora copia a etapa do item para a sessão.
-- (Recriada por completo; mesma lógica da 0058 + join com as etapas.)
-- -----------------------------------------------------------------------------
create or replace function public.ensure_treatment_sessions(p_client_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_phase text;
  v_plan uuid;
  v_option uuid;
begin
  select clinic_id, journey_phase::text into v_clinic, v_phase
  from public.clients where id = p_client_id;
  if v_clinic is null then return; end if;
  if not (
    public.is_admin_master()
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.user_id = (select auth.uid())
    )
  ) then
    return;
  end if;
  if v_phase <> 'treatment_start' then return; end if;
  if exists (select 1 from public.treatment_sessions where client_id = p_client_id) then
    return;
  end if;

  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;
  if v_plan is null then return; end if;

  select id into v_option from public.treatment_plan_options
  where plan_id = v_plan and review_status = 'approved'
  order by is_primary desc, sort_order asc limit 1;
  if v_option is null then
    select id into v_option from public.treatment_plan_options
    where plan_id = v_plan order by is_primary desc, sort_order asc limit 1;
  end if;
  if v_option is null then return; end if;

  insert into public.treatment_sessions
    (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
     session_index, session_total, name, planned_minutes, stage_name, stage_order)
  select p_client_id, v_clinic, v_plan, i.id, i.procedure_id,
    coalesce(p.name, i.description),
    gs.idx,
    coalesce(i.planned_sessions, 1),
    'Sessão ' || gs.idx || ' de ' || coalesce(i.planned_sessions, 1),
    case
      when coalesce(i.planned_sessions, 1) > 0 and i.planned_total_minutes is not null
      then round(i.planned_total_minutes::numeric / coalesce(i.planned_sessions, 1))::int
      else null
    end,
    st.name,
    st.sort_order
  from public.treatment_plan_option_items i
  left join public.procedures p on p.id = i.procedure_id
  left join public.treatment_plan_stages st on st.id = i.stage_id
  cross join lateral generate_series(1, coalesce(i.planned_sessions, 1)) as gs(idx)
  where i.option_id = v_option;
end $$;

grant execute on function public.ensure_treatment_sessions(uuid) to authenticated;
