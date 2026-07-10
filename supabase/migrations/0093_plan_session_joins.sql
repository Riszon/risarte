-- =============================================================================
-- 0093 — Planner junta sessões durante o planejamento (H4.5, Pedido 2)
-- -----------------------------------------------------------------------------
-- Durante o planejamento as sessões ainda não existem (só nascem ao iniciar o
-- tratamento). Para o Planner poder agrupar "sessão a sessão" os atendimentos,
-- centralizamos a PROJEÇÃO das sessões (option_session_rows) — a mesma lógica que
-- gera as sessões — e guardamos os agrupamentos por (item, índice da sessão) em
-- plan_session_joins. Ao gerar as sessões, cada uma herda o join_key do grupo; no
-- painel da Fase 5 as sessões do mesmo grupo já vêm agrupadas ("Agendar juntas").
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Agrupamentos definidos pelo Planner: uma sessão projetada (item + índice)
-- pertence a um "atendimento" (group_no) por opção. clinic_id denormalizado.
-- -----------------------------------------------------------------------------
create table if not exists public.plan_session_joins (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.treatment_plan_option_items (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  session_index int not null,
  group_no int not null,
  created_at timestamptz not null default now(),
  unique (item_id, session_index)
);
create index if not exists plan_session_joins_item_idx
  on public.plan_session_joins (item_id);
alter table public.plan_session_joins enable row level security;

drop policy if exists "plan_session_joins_select" on public.plan_session_joins;
create policy "plan_session_joins_select" on public.plan_session_joins
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "plan_session_joins_write" on public.plan_session_joins;
create policy "plan_session_joins_write" on public.plan_session_joins
  for all to authenticated
  using (public.is_admin_master() or public.is_planner())
  with check (
    public.is_admin_master()
    or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

-- Cada sessão gerada carrega o "atendimento conjunto" (join_key) do planejamento.
alter table public.treatment_sessions
  add column if not exists join_key text;

-- -----------------------------------------------------------------------------
-- option_session_rows: PROJEÇÃO das sessões de uma opção (mesma lógica da
-- geração — protocolo unidade>rede, ou contagem planejada com tempo dividido).
-- Fonte única, usada pela geração E pela tela de agrupamento.
-- -----------------------------------------------------------------------------
create or replace function public.option_session_rows(
  p_option_id uuid, p_clinic_id uuid
)
returns table (
  item_id uuid, procedure_id uuid, procedure_name text,
  session_index int, session_total int, name text, planned_minutes int,
  stage_name text, stage_order int, suggested_provider_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item record; v_proto record; v_use_unit boolean; v_proto_count int;
  v_qty int; v_total int; v_idx int; v_q int;
begin
  for v_item in
    select i.id as item_id, i.procedure_id, i.quantity,
           coalesce(i.planned_sessions, 1) as planned_sessions,
           i.planned_total_minutes, i.suggested_provider_id,
           coalesce(p.name, i.description) as proc_name,
           st.name as stage_name, st.sort_order as stage_order
    from public.treatment_plan_option_items i
    left join public.procedures p on p.id = i.procedure_id
    left join public.treatment_plan_stages st on st.id = i.stage_id
    where i.option_id = p_option_id
  loop
    v_qty := greatest(coalesce(v_item.quantity, 1), 1);
    v_use_unit := false; v_proto_count := 0;
    if v_item.procedure_id is not null then
      select count(*) into v_proto_count from public.procedure_sessions ps
      where ps.procedure_id = v_item.procedure_id and ps.clinic_id = p_clinic_id;
      if v_proto_count > 0 then
        v_use_unit := true;
      else
        select count(*) into v_proto_count from public.procedure_sessions ps
        where ps.procedure_id = v_item.procedure_id and ps.clinic_id is null;
      end if;
    end if;

    if v_item.procedure_id is not null and v_proto_count > 0 then
      v_total := v_proto_count * v_qty; v_idx := 0;
      for v_q in 1..v_qty loop
        for v_proto in
          select ps.name, ps.estimated_minutes from public.procedure_sessions ps
          where ps.procedure_id = v_item.procedure_id
            and ps.clinic_id is not distinct from
                (case when v_use_unit then p_clinic_id else null end)
          order by ps.session_index
        loop
          v_idx := v_idx + 1;
          item_id := v_item.item_id; procedure_id := v_item.procedure_id;
          procedure_name := v_item.proc_name; session_index := v_idx;
          session_total := v_total;
          name := coalesce(nullif(v_proto.name, ''),
                           'Sessão ' || v_idx || ' de ' || v_total);
          planned_minutes := nullif(v_proto.estimated_minutes, 0);
          stage_name := v_item.stage_name; stage_order := v_item.stage_order;
          suggested_provider_id := v_item.suggested_provider_id;
          return next;
        end loop;
      end loop;
    else
      v_total := v_item.planned_sessions;
      for v_idx in 1..v_total loop
        item_id := v_item.item_id; procedure_id := v_item.procedure_id;
        procedure_name := v_item.proc_name; session_index := v_idx;
        session_total := v_total;
        name := 'Sessão ' || v_idx || ' de ' || v_total;
        planned_minutes := case
          when v_total > 0 and v_item.planned_total_minutes is not null
          then round(v_item.planned_total_minutes::numeric / v_total)::int
          else null end;
        stage_name := v_item.stage_name; stage_order := v_item.stage_order;
        suggested_provider_id := v_item.suggested_provider_id;
        return next;
      end loop;
    end if;
  end loop;
end $$;
grant execute on function public.option_session_rows(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- project_option_sessions: as sessões projetadas de uma opção + o atendimento
-- (group_no) de cada uma — para a tela de agrupamento do cockpit.
-- -----------------------------------------------------------------------------
create or replace function public.project_option_sessions(p_option_id uuid)
returns table (
  item_id uuid, session_index int, procedure_name text, name text,
  planned_minutes int, group_no int
)
language plpgsql stable security definer set search_path = '' as $$
declare v_clinic uuid;
begin
  if not (public.is_admin_master() or public.is_planner()) then return; end if;
  select c.clinic_id into v_clinic
  from public.treatment_plan_options o
  join public.treatment_plans tp on tp.id = o.plan_id
  join public.clients c on c.id = tp.client_id
  where o.id = p_option_id;
  if v_clinic is null then return; end if;

  return query
  select r.item_id, r.session_index, r.procedure_name, r.name, r.planned_minutes,
         psj.group_no
  from public.option_session_rows(p_option_id, v_clinic) r
  left join public.plan_session_joins psj
    on psj.item_id = r.item_id and psj.session_index = r.session_index
  order by r.procedure_name, r.session_index;
end $$;
grant execute on function public.project_option_sessions(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- ensure_treatment_sessions: agora insere a partir de option_session_rows e
-- herda o join_key (atendimento conjunto) de plan_session_joins.
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
     session_index, session_total, name, planned_minutes,
     stage_name, stage_order, planner_provider_id, join_key)
  select p_client_id, v_clinic, v_plan, r.item_id, r.procedure_id,
    r.procedure_name, r.session_index, r.session_total, r.name, r.planned_minutes,
    r.stage_name, r.stage_order, r.suggested_provider_id,
    (select psj.group_no::text from public.plan_session_joins psj
      where psj.item_id = r.item_id and psj.session_index = r.session_index)
  from public.option_session_rows(v_option, v_clinic) r;
end $$;

grant execute on function public.ensure_treatment_sessions(uuid) to authenticated;
