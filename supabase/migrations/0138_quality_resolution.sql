-- =============================================================================
-- Risarte Odontologia — Migration 0138 (Cockpit do Coordenador — Bloco D, cont.)
-- Resolução de Revisão / Reprovação no controle de qualidade.
--
-- Ao marcar um procedimento como Revisão ou Reprovado (motivo obrigatório), o
-- sistema encaminha:
--  - Revisão / Reprovado "mesmo dentista refaz": avisa o dentista executor.
--  - Reprovado "outro dentista refaz": avisa o executor (reprovado) e o dentista
--    indicado (novo procedimento p/ refazer).
--  - Reprovado "incluir no próximo plano": marca p/ replanejar (segue ao Planner
--    quando enviar ao Centro de Planejamento).
-- Um botão no fim do checklist pede à RECEPÇÃO para agendar (uma vez por cliente).
-- Idempotente.
-- =============================================================================

alter table public.plan_quality_reviews
  add column if not exists executor_dentist_id uuid references public.profiles (id);
alter table public.plan_quality_reviews
  add column if not exists resolution text;
alter table public.plan_quality_reviews
  add column if not exists assigned_dentist_id uuid references public.profiles (id);
alter table public.plan_quality_reviews
  add column if not exists scheduling_requested boolean not null default false;

do $$
begin
  alter table public.plan_quality_reviews
    add constraint plan_quality_reviews_resolution_chk
    check (resolution is null or resolution in ('revise','redo_same','redo_other','replan'));
exception when duplicate_object then null;
end $$;

-- Substitui a RPC do 0137 por uma versão com resolução + avisos. ---------------
drop function if exists public.set_plan_item_quality(uuid, text, text);

create or replace function public.set_plan_item_quality(
  p_item_id uuid,
  p_status text,
  p_note text default null,
  p_executor uuid default null,
  p_resolution text default null,
  p_assigned uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_clinic uuid;
  v_client uuid;
  v_name text;
  v_proc text;
  v_locked boolean;
  v_primary_option uuid;
  v_total int;
  v_approved int;
  v_user uuid := (select auth.uid());
begin
  if p_status not in ('aprovado', 'revisao', 'reprovado') then
    raise exception 'INVALID_STATUS';
  end if;

  select o.plan_id, i.clinic_id, i.description
    into v_plan, v_clinic, v_proc
  from public.treatment_plan_option_items i
  join public.treatment_plan_options o on o.id = i.option_id
  where i.id = p_item_id;
  if v_plan is null then raise exception 'ITEM_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select quality_locked into v_locked from public.treatment_plans where id = v_plan;
  if v_locked then raise exception 'LOCKED'; end if;

  if p_status in ('revisao', 'reprovado') and coalesce(btrim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_status = 'reprovado' then
    if p_resolution is null or p_resolution not in ('redo_same','redo_other','replan') then
      raise exception 'RESOLUTION_REQUIRED';
    end if;
    if p_resolution = 'redo_other' and p_assigned is null then
      raise exception 'ASSIGNED_REQUIRED';
    end if;
  end if;

  select client_id into v_client from public.treatment_plans where id = v_plan;
  select full_name into v_name from public.clients where id = v_client;

  insert into public.plan_quality_reviews
    (plan_id, item_id, clinic_id, status, note, executor_dentist_id,
     resolution, assigned_dentist_id, reviewed_by, reviewed_at)
  values (v_plan, p_item_id, v_clinic, p_status, nullif(btrim(p_note), ''),
     p_executor,
     case when p_status = 'revisao' then 'revise'
          when p_status = 'reprovado' then p_resolution
          else null end,
     case when p_status = 'reprovado' and p_resolution = 'redo_other' then p_assigned else null end,
     v_user, now())
  on conflict (item_id) do update
    set status = excluded.status, note = excluded.note,
        executor_dentist_id = excluded.executor_dentist_id,
        resolution = excluded.resolution,
        assigned_dentist_id = excluded.assigned_dentist_id,
        reviewed_by = excluded.reviewed_by, reviewed_at = now();

  -- Avisos aos dentistas conforme a resolução.
  if p_status = 'revisao' or (p_status = 'reprovado' and p_resolution = 'redo_same') then
    if p_executor is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (p_executor, v_clinic,
        case when p_status = 'revisao' then 'Procedimento para revisar'
             else 'Procedimento reprovado — refazer' end,
        coalesce(v_name,'Cliente') || ' — ' || coalesce(v_proc,'procedimento') ||
          '. Motivo: ' || coalesce(btrim(p_note),''),
        '/prontuarios/' || v_client);
    end if;
  elsif p_status = 'reprovado' and p_resolution = 'redo_other' then
    if p_executor is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (p_executor, v_clinic, 'Procedimento reprovado no controle de qualidade',
        coalesce(v_name,'Cliente') || ' — ' || coalesce(v_proc,'procedimento') ||
          ' foi reprovado; outro profissional irá refazer.',
        '/prontuarios/' || v_client);
    end if;
    if p_assigned is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (p_assigned, v_clinic, 'Novo procedimento para refazer',
        coalesce(v_name,'Cliente') || ' — refazer ' || coalesce(v_proc,'procedimento') ||
          '. Veja o plano e o motivo no prontuário.',
        '/prontuarios/' || v_client);
    end if;
  end if;
  -- 'replan' não avisa dentista: segue ao Planner ao enviar ao planejamento.

  -- Opção principal (executada) do plano.
  select id into v_primary_option from public.treatment_plan_options
    where plan_id = v_plan order by is_primary desc, sort_order limit 1;
  select count(*) into v_total from public.treatment_plan_option_items
    where option_id = v_primary_option;
  select count(*) into v_approved
    from public.plan_quality_reviews r
    join public.treatment_plan_option_items i on i.id = r.item_id
    where i.option_id = v_primary_option and r.status = 'aprovado';
  if v_total > 0 and v_approved = v_total then
    update public.treatment_plans
      set quality_locked = true, quality_locked_at = now()
    where id = v_plan;
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'plan_quality_review', p_item_id::text,
    jsonb_build_object('status', p_status, 'resolution', p_resolution));
end;
$$;

revoke all on function public.set_plan_item_quality(uuid, text, text, uuid, text, uuid) from public;
grant execute on function public.set_plan_item_quality(uuid, text, text, uuid, text, uuid) to authenticated;

-- Pede à recepção para agendar a revisão/refação dos procedimentos do cliente.
create or replace function public.request_quality_scheduling(
  p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_name text;
  v_count int;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, client_id into v_clinic, v_client
    from public.treatment_plans where id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select count(*) into v_count from public.plan_quality_reviews
    where plan_id = p_plan_id and status in ('revisao','reprovado');
  if v_count = 0 then raise exception 'NOTHING_TO_SCHEDULE'; end if;

  select full_name into v_name from public.clients where id = v_client;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic, 'Agendar revisão de procedimentos',
    coalesce(v_name,'Cliente') || ' — ' || v_count ||
      ' procedimento(s) para revisar/refazer (controle de qualidade).',
    '/prontuarios/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';

  update public.plan_quality_reviews
    set scheduling_requested = true
  where plan_id = p_plan_id and status in ('revisao','reprovado');

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'quality_scheduling_request', p_plan_id::text,
    jsonb_build_object('count', v_count));
end;
$$;

revoke all on function public.request_quality_scheduling(uuid) from public;
grant execute on function public.request_quality_scheduling(uuid) to authenticated;
