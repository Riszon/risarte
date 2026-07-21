-- =============================================================================
-- Risarte Odontologia — Migration 0139 (Cockpit do Coordenador — Bloco D, cont.)
-- Só procedimentos FINALIZADOS entram no controle de qualidade.
--
-- Um procedimento (item do plano) só pode ser avaliado (aprovado/revisão/
-- reprovado) quando TODAS as suas sessões estão "realizadas" (done). Procedimentos
-- em aberto/agendados aparecem no checklist mas não são avaliáveis; para os em
-- aberto sem agendamento, o Coordenador pode pedir agendamento à recepção.
-- Idempotente.
-- =============================================================================

-- 1) A RPC de qualidade passa a exigir procedimento finalizado. ----------------
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
  v_sess_total int;
  v_sess_open int;
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

  -- Só finalizado: precisa ter sessões e todas realizadas (done).
  select count(*), count(*) filter (where status <> 'done')
    into v_sess_total, v_sess_open
  from public.treatment_sessions where item_id = p_item_id;
  if v_sess_total = 0 or v_sess_open > 0 then
    raise exception 'NOT_FINALIZED';
  end if;

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

-- 2) Coordenador pede à recepção o agendamento de UM procedimento em aberto. ----
create or replace function public.request_item_scheduling(
  p_item_id uuid
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
  v_proc text;
  v_user uuid := (select auth.uid());
begin
  select i.clinic_id, i.description, tp.client_id
    into v_clinic, v_proc, v_client
  from public.treatment_plan_option_items i
  join public.treatment_plan_options o on o.id = i.option_id
  join public.treatment_plans tp on tp.id = o.plan_id
  where i.id = p_item_id;
  if v_client is null then raise exception 'ITEM_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select full_name into v_name from public.clients where id = v_client;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic, 'Agendar procedimento',
    coalesce(v_name,'Cliente') || ' — agendar ' || coalesce(v_proc,'procedimento') ||
      ' (controle de qualidade).',
    '/prontuarios/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'item_scheduling_request', p_item_id::text, null);
end;
$$;

revoke all on function public.request_item_scheduling(uuid) from public;
grant execute on function public.request_item_scheduling(uuid) to authenticated;
