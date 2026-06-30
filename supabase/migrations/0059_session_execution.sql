-- =============================================================================
-- 0059 — Execução das sessões + médias reais (Procedimentos E5)
-- -----------------------------------------------------------------------------
-- Quando o dentista CONCLUI o atendimento (painel /atendimento), as sessões do
-- tratamento ligadas àquele agendamento passam a "Concluído" com o TEMPO REAL
-- de atendimento (intervalo chamada -> conclusão). Se o mesmo agendamento
-- executou mais de uma sessão/procedimento, o tempo é rateado proporcionalmente
-- ao tempo planejado de cada uma (rateio igual quando não há tempo planejado).
-- Esses tempos reais alimentam as médias por unidade e por dentista, exibidas
-- no editor do plano (Planner) e na agenda. Idempotente.
-- =============================================================================

alter table public.treatment_sessions
  add column if not exists actual_minutes int,
  add column if not exists executed_by uuid references public.profiles (id);

-- -----------------------------------------------------------------------------
-- settle_treatment_sessions: liquida (status done + tempo real rateado) todas as
-- sessões ligadas a um agendamento já concluído. Chamada por update_attendance.
-- -----------------------------------------------------------------------------
create or replace function public.settle_treatment_sessions(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_called timestamptz;
  v_done timestamptz;
  v_by uuid;
  v_total_min numeric;
  v_planned_sum numeric;
  v_count int;
  v_all_planned boolean;
begin
  select called_at, done_at, done_by
    into v_called, v_done, v_by
  from public.appointments where id = p_appointment_id;
  if v_done is null then return; end if;

  select count(*),
         coalesce(sum(coalesce(planned_minutes, 0)), 0),
         bool_and(coalesce(planned_minutes, 0) > 0)
    into v_count, v_planned_sum, v_all_planned
  from public.treatment_sessions
  where appointment_id = p_appointment_id and status <> 'done';
  if v_count = 0 then return; end if;

  -- Tempo real do atendimento (chamada -> conclusão), em minutos.
  if v_called is not null then
    v_total_min := greatest(0, round(extract(epoch from (v_done - v_called)) / 60));
  else
    v_total_min := null;
  end if;

  update public.treatment_sessions ts
  set status = 'done',
      done_at = v_done,
      executed_by = v_by,
      actual_minutes = case
        when v_total_min is null then null
        when v_all_planned and v_planned_sum > 0
          then round(v_total_min * ts.planned_minutes / v_planned_sum)::int
        else round(v_total_min / v_count)::int
      end
  where ts.appointment_id = p_appointment_id and ts.status <> 'done';
end;
$$;

grant execute on function public.settle_treatment_sessions(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- update_attendance: reescrita da 0023 + liquidação das sessões ao concluir.
-- -----------------------------------------------------------------------------
create or replace function public.update_attendance(
  p_appointment_id uuid,
  p_state public.attendance_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_provider uuid;
  v_called_by uuid;
  v_client uuid;
  v_status public.journey_status;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  if p_state = 'waiting' then raise exception 'USE_CHECK_IN'; end if;

  select clinic_id, provider_user_id, called_by, client_id
    into v_clinic, v_provider, v_called_by, v_client
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if p_state = 'in_service' then
    if not (
      public.is_admin_master()
      or v_provider = v_user
      or public.has_role_in_clinic(
        v_clinic,
        array['clinical_coordinator', 'dentist', 'commercial_consultant']::public.user_role[]
      )
    ) then
      raise exception 'NOT_ALLOWED';
    end if;
    update public.appointments
    set attendance = 'in_service',
        called_by = v_user,
        called_at = coalesce(called_at, now())
    where id = p_appointment_id;

  elsif p_state = 'done' then
    if not (
      public.is_admin_master()
      or v_called_by = v_user
      or (v_called_by is null and v_provider = v_user)
    ) then
      raise exception 'NOT_CALLER';
    end if;
    update public.appointments
    set attendance = 'done', status = 'completed',
        done_at = now(), done_by = v_user
    where id = p_appointment_id;

    -- E5: liquida as sessões do tratamento ligadas a este agendamento.
    perform public.settle_treatment_sessions(p_appointment_id);

    select journey_status, full_name into v_status, v_name
    from public.clients where id = v_client;
    if v_status = 'in_treatment' and not exists (
      select 1 from public.appointments a
      where a.client_id = v_client
        and a.type = 'treatment_session'
        and a.starts_at > now()
        and a.status in ('scheduled', 'confirmed')
    ) then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic,
             'Agendar próxima sessão de tratamento: ' || v_name,
             v_name || ' concluiu uma sessão e não tem a próxima agendada.',
             '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- procedure_real_stats: médias REALIZADAS por procedimento numa unidade —
-- considera apenas tratamentos (item do plano) totalmente concluídos e com
-- tempo real registrado. Devolve média de sessões e de tempo total por
-- tratamento + tamanho da amostra. Sem dado pessoal (só agregados).
-- -----------------------------------------------------------------------------
create or replace function public.procedure_real_stats(
  p_clinic_id uuid,
  p_procedure_ids uuid[] default null
)
returns table (
  procedure_id uuid,
  avg_sessions numeric,
  avg_total_minutes numeric,
  sample bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_admin_master()
    or public.is_planner()
    or p_clinic_id in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(
      p_clinic_id,
      array['clinical_coordinator', 'unit_manager', 'dentist']::public.user_role[]
    )
  ) then
    return;
  end if;

  return query
  with done_items as (
    select ts.procedure_id as proc_id,
           ts.item_id,
           count(*) as sess_count,
           sum(coalesce(ts.actual_minutes, 0)) as total_min
    from public.treatment_sessions ts
    where ts.clinic_id = p_clinic_id
      and ts.item_id is not null
      and (p_procedure_ids is null or ts.procedure_id = any (p_procedure_ids))
    group by ts.procedure_id, ts.item_id
    having count(*) filter (where ts.status <> 'done') = 0
       and count(*) filter (where ts.actual_minutes is null) = 0
  )
  select di.proc_id,
         avg(di.sess_count)::numeric,
         avg(di.total_min)::numeric,
         count(*)::bigint
  from done_items di
  group by di.proc_id;
end;
$$;

grant execute on function public.procedure_real_stats(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- provider_procedure_minutes: média REAL de minutos por sessão de um dentista
-- num procedimento (sugestão na agenda ao escolher procedimento + dentista).
-- -----------------------------------------------------------------------------
create or replace function public.provider_procedure_minutes(
  p_provider_id uuid,
  p_procedure_ids uuid[]
)
returns table (
  procedure_id uuid,
  avg_minutes numeric,
  sample bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return; end if;
  return query
  select ts.procedure_id,
         avg(ts.actual_minutes)::numeric,
         count(*)::bigint
  from public.treatment_sessions ts
  where ts.executed_by = p_provider_id
    and ts.status = 'done'
    and ts.actual_minutes is not null
    and ts.procedure_id = any (p_procedure_ids)
  group by ts.procedure_id;
end;
$$;

grant execute on function public.provider_procedure_minutes(uuid, uuid[]) to authenticated;
