-- =============================================================================
-- Risarte Odontologia — Migration 0145 (Cockpit — Bloco D: refinos + Entrega 4)
--
-- (A) BUG: o Dentista que vai REFAZER/REVISAR um procedimento (controle de
--     qualidade, Fase 6) não conseguia abrir o prontuário quando ainda não havia
--     agendamento com ele (caso "indicar outro dentista"). A RLS de clients só
--     liberava o dentista via agendamento. Agora libera também o dentista
--     executor/indicado de uma revisão/reprovação-refazer.
-- (B) Refino: quando o procedimento reaberto é REFINALIZADO (todas as sessões
--     concluídas de novo), avisa o Coordenador para refazer o controle de qualidade.
-- (C) Entrega 4: procedimento REPROVADO → "incluir no próximo plano" (replan) leva
--     ao Centro de Planejamento os dados + o motivo da troca (falha profissional ×
--     inviabilidade clínica) como informação complementar ao Planner.
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (A) RLS: o dentista que vai refazer/revisar vê o cliente mesmo sem agendamento.
--     Função SECURITY DEFINER (lê ignorando RLS) para evitar recursão entre
--     policies — mesmo padrão de client_shared_with_user (0034).
-- ---------------------------------------------------------------------------
create or replace function public.client_qc_redo_for_user(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plan_quality_reviews r
    join public.treatment_plans tp on tp.id = r.plan_id
    where tp.client_id = p_client_id
      and (
        r.executor_dentist_id = (select auth.uid())
        or r.assigned_dentist_id = (select auth.uid())
      )
      and (
        r.status = 'revisao'
        or (r.status = 'reprovado' and r.resolution in ('redo_same', 'redo_other'))
      )
  );
$$;

drop policy if exists "clients_select_member" on public.clients;
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or preferred_clinic_id in (select public.user_full_access_clinic_ids())
    or public.user_has_client_history_access(id)
    or exists (
      select 1 from public.appointments a
      where a.client_id = clients.id
        and a.provider_user_id = (select auth.uid())
    )
    or public.client_shared_with_user(id)
    -- Dentista designado para revisar/refazer (controle de qualidade — Fase 6).
    or public.client_qc_redo_for_user(id)
  );

-- ---------------------------------------------------------------------------
-- (C) motivo da troca no replan (falha profissional × inviabilidade clínica) +
--     controle de "já levado ao Planner" (não duplica ao reenviar).
-- ---------------------------------------------------------------------------
alter table public.plan_quality_reviews
  add column if not exists replan_reason text;
do $$
begin
  alter table public.plan_quality_reviews
    add constraint plan_quality_reviews_replan_reason_chk
    check (replan_reason is null or replan_reason in ('falha', 'inviabilidade'));
exception when duplicate_object then null;
end $$;
alter table public.plan_quality_reviews
  add column if not exists replan_carried boolean not null default false;

-- ---------------------------------------------------------------------------
-- RPC set_plan_item_quality: adiciona p_replan_reason (obrigatório no replan) e
-- grava o motivo. Mantém toda a lógica de reabertura da 0143.
-- ---------------------------------------------------------------------------
drop function if exists public.set_plan_item_quality(uuid, text, text, uuid, text, uuid);

create or replace function public.set_plan_item_quality(
  p_item_id uuid,
  p_status text,
  p_note text default null,
  p_executor uuid default null,
  p_resolution text default null,
  p_assigned uuid default null,
  p_replan_reason text default null
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
    if p_resolution = 'replan'
       and (p_replan_reason is null or p_replan_reason not in ('falha','inviabilidade')) then
      raise exception 'REPLAN_REASON_REQUIRED';
    end if;
  end if;

  select client_id into v_client from public.treatment_plans where id = v_plan;
  select full_name into v_name from public.clients where id = v_client;

  insert into public.plan_quality_reviews
    (plan_id, item_id, clinic_id, status, note, executor_dentist_id,
     resolution, assigned_dentist_id, replan_reason, replan_carried,
     reviewed_by, reviewed_at)
  values (v_plan, p_item_id, v_clinic, p_status, nullif(btrim(p_note), ''),
     p_executor,
     case when p_status = 'revisao' then 'revise'
          when p_status = 'reprovado' then p_resolution
          else null end,
     case when p_status = 'reprovado' and p_resolution = 'redo_other' then p_assigned else null end,
     case when p_status = 'reprovado' and p_resolution = 'replan' then p_replan_reason else null end,
     false,
     v_user, now())
  on conflict (item_id) do update
    set status = excluded.status, note = excluded.note,
        executor_dentist_id = excluded.executor_dentist_id,
        resolution = excluded.resolution,
        assigned_dentist_id = excluded.assigned_dentist_id,
        replan_reason = excluded.replan_reason,
        replan_carried = false,
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

  -- Reabre o procedimento conforme a resolução (o procedimento volta a "aberto").
  if p_status = 'revisao' then
    if not exists (
      select 1 from public.treatment_sessions ts
      where ts.item_id = p_item_id and ts.status <> 'done'
        and ts.redo_kind = 'revisao'
    ) then
      insert into public.treatment_sessions
        (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
         session_index, session_total, name, redo_kind)
      select v_client, v_clinic, v_plan, p_item_id, i.procedure_id,
        coalesce(v_proc, 'Procedimento'),
        coalesce((select max(session_index) from public.treatment_sessions
                  where item_id = p_item_id), 0) + 1,
        1, 'Revisão do procedimento', 'revisao'
      from public.treatment_plan_option_items i where i.id = p_item_id;
    end if;
  elsif p_status = 'reprovado' and p_resolution in ('redo_same','redo_other') then
    update public.treatment_sessions
      set status = 'pending', done_at = null, executed_by = null,
          appointment_id = null, redo_kind = 'refacao'
    where item_id = p_item_id;
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
    jsonb_build_object('status', p_status, 'resolution', p_resolution,
                       'replan_reason', p_replan_reason));
end;
$$;

revoke all on function
  public.set_plan_item_quality(uuid, text, text, uuid, text, uuid, text) from public;
grant execute on function
  public.set_plan_item_quality(uuid, text, text, uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (B) Refinalização de um procedimento reaberto → avisa o Coordenador para
--     refazer o controle de qualidade. Dispara quando uma sessão de revisão/
--     refação (redo_kind) passa a 'done'.
-- ---------------------------------------------------------------------------
create or replace function public.notify_qc_after_redo_finish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_open int;
begin
  if new.redo_kind is null then return new; end if;
  if new.status <> 'done' or old.status is not distinct from 'done' then
    return new;
  end if;

  -- Só avisa quando o procedimento inteiro voltou a ficar finalizado.
  select count(*) filter (where status <> 'done') into v_open
  from public.treatment_sessions where item_id = new.item_id;
  if v_open > 0 then return new; end if;

  select full_name into v_name from public.clients where id = new.client_id;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, new.clinic_id,
    'Procedimento refeito — refazer controle de qualidade',
    coalesce(v_name, 'Cliente') || ' — ' || coalesce(new.procedure_name, 'procedimento') ||
      ' foi refeito/revisado. Reveja no controle de qualidade.',
    '/avaliacao/' || new.client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = new.clinic_id and ucr.role = 'clinical_coordinator';

  return new;
end;
$$;

drop trigger if exists trg_notify_qc_after_redo_finish on public.treatment_sessions;
create trigger trg_notify_qc_after_redo_finish
  after update of status on public.treatment_sessions
  for each row
  execute function public.notify_qc_after_redo_finish();

-- ---------------------------------------------------------------------------
-- (C) send_to_planning_followup: além de concluir o atendimento e avisar a
--     recepção, leva os procedimentos REPROVADOS → replan ao Centro de
--     Planejamento como informação complementar ao Planner (com o motivo da
--     troca). Marca como "levado" para não duplicar em reenvios.
-- ---------------------------------------------------------------------------
create or replace function public.send_to_planning_followup(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_name text;
  v_user uuid := (select auth.uid());
  v_body text;
  v_count int;
begin
  select clinic_id, full_name into v_clinic, v_name
  from public.clients where id = p_client_id;
  if v_clinic is null then return; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
      v_clinic, array['clinical_coordinator']::public.user_role[]
    )
  ) then
    return;
  end if;

  -- (a) Conclui o atendimento em curso deste cliente na unidade.
  update public.appointments
  set attendance = 'done', status = 'completed',
      done_at = now(), done_by = v_user
  where client_id = p_client_id
    and clinic_id = v_clinic
    and attendance = 'in_service';

  -- (b) Avisa a Recepção para agendar a apresentação comercial.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic,
         'Agendar apresentação comercial',
         coalesce(v_name, 'O cliente') ||
           ' passou pela avaliação e foi ao Centro de Planejamento. Agende a ' ||
           'apresentação online do plano com o Consultor Comercial.',
         '/prontuarios/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'receptionist'
    and ucr.user_id is distinct from v_user;

  -- (c) Entrega 4: procedimentos reprovados → replan seguem ao Planner.
  select count(*),
         string_agg(
           '• ' || coalesce(i.description, 'Procedimento') ||
           ' (' || case when r.replan_reason = 'inviabilidade'
                        then 'inviabilidade clínica'
                        else 'falha profissional' end || ')' ||
           case when coalesce(btrim(r.note), '') <> ''
                then ' — ' || btrim(r.note) else '' end,
           E'\n' order by i.description)
    into v_count, v_body
  from public.plan_quality_reviews r
  join public.treatment_plans tp on tp.id = r.plan_id
  join public.treatment_plan_option_items i on i.id = r.item_id
  where tp.client_id = p_client_id
    and r.status = 'reprovado'
    and r.resolution = 'replan'
    and r.replan_carried = false;

  if coalesce(v_count, 0) > 0 then
    insert into public.planning_supplements (client_id, clinic_id, body, created_by)
    values (
      p_client_id, v_clinic,
      'Controle de qualidade — procedimento(s) reprovado(s) para REPLANEJAR (trocar):'
        || E'\n' || v_body,
      v_user);

    update public.plan_quality_reviews r
      set replan_carried = true
    from public.treatment_plans tp
    where tp.id = r.plan_id
      and tp.client_id = p_client_id
      and r.status = 'reprovado'
      and r.resolution = 'replan'
      and r.replan_carried = false;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
           'Procedimento para replanejar',
           coalesce(v_name, 'Um cliente') ||
             ' tem procedimento(s) reprovado(s) no controle de qualidade para trocar no novo plano.',
           '/planejamento/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.role = 'planner_dentist'
      and ucr.user_id is distinct from v_user;
  end if;
end;
$$;

grant execute on function public.send_to_planning_followup(uuid) to authenticated;
