-- =============================================================================
-- 0094 — Ajustes na junção de sessões: tempo, sequência e profissional
-- -----------------------------------------------------------------------------
-- Pedido do dono (09/07): na área "Atendimentos" do cockpit o Planner precisa
--  (1) editar o TEMPO de cada sessão (2 procedimentos juntos duram menos que a
--      soma), (2) definir a SEQUÊNCIA lógica (ordem) dos atendimentos, e
--  (3) ver/trocar o PROFISSIONAL por sessão (evitar juntar sessões com
--      profissionais diferentes).
-- Guardamos tudo por (item, índice da sessão) em plan_session_joins e a geração
-- passa a aplicar esses ajustes. Idempotente.
-- =============================================================================

-- group_no deixa de ser obrigatório (a linha pode existir só para tempo/ordem/
-- profissional, sem atendimento conjunto).
alter table public.plan_session_joins alter column group_no drop not null;
alter table public.plan_session_joins
  add column if not exists minutes_override int;
alter table public.plan_session_joins
  add column if not exists provider_override uuid references public.profiles (id);
alter table public.plan_session_joins
  add column if not exists block_order int;

-- Ordem da sessão na sequência do tratamento (definida no planejamento).
alter table public.treatment_sessions
  add column if not exists plan_order int;

-- -----------------------------------------------------------------------------
-- project_option_sessions: agora aplica o tempo/profissional editados e devolve
-- a ordem (block_order) para a tela de sequência.
-- -----------------------------------------------------------------------------
drop function if exists public.project_option_sessions(uuid);
create or replace function public.project_option_sessions(p_option_id uuid)
returns table (
  item_id uuid, session_index int, procedure_name text, name text,
  planned_minutes int, group_no int, block_order int, provider_id uuid
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
  select r.item_id, r.session_index, r.procedure_name, r.name,
         coalesce(psj.minutes_override, r.planned_minutes) as planned_minutes,
         psj.group_no,
         psj.block_order,
         coalesce(psj.provider_override, r.suggested_provider_id) as provider_id
  from public.option_session_rows(p_option_id, v_clinic) r
  left join public.plan_session_joins psj
    on psj.item_id = r.item_id and psj.session_index = r.session_index
  order by coalesce(psj.block_order, 9999), r.procedure_name, r.session_index;
end $$;
grant execute on function public.project_option_sessions(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- ensure_treatment_sessions: aplica tempo/profissional editados, o atendimento
-- conjunto (join_key) e a ordem (plan_order).
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
     stage_name, stage_order, planner_provider_id, join_key, plan_order)
  select p_client_id, v_clinic, v_plan, r.item_id, r.procedure_id,
    r.procedure_name, r.session_index, r.session_total, r.name,
    coalesce(psj.minutes_override, r.planned_minutes),
    r.stage_name, r.stage_order,
    coalesce(psj.provider_override, r.suggested_provider_id),
    psj.group_no::text,
    psj.block_order
  from public.option_session_rows(v_option, v_clinic) r
  left join public.plan_session_joins psj
    on psj.item_id = r.item_id and psj.session_index = r.session_index;
end $$;

grant execute on function public.ensure_treatment_sessions(uuid) to authenticated;
