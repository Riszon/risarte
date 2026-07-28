-- =============================================================================
-- 0176 — I7b: o atendimento fecha pelo Desenvolvimento Clínico
-- -----------------------------------------------------------------------------
-- Pedidos do dono (28/07/2026):
--   1. o que foi finalizado (e o que estava programado e NÃO foi) precisa ficar
--      registrado no histórico do Desenvolvimento Clínico;
--   2. o dentista pode finalizar também uma sessão que NÃO estava programada
--      para o dia — desde que seja dele ou ainda não tenha dentista definido;
--   3. dá para concluir o atendimento direto do Desenvolvimento Clínico, e só
--      DEPOIS de descrever o que foi feito;
--   4. uma anotação de Desenvolvimento Clínico por atendimento.
--
-- Para (1) a sessão não serve como registro: quando ela NÃO é feita, volta para
-- "a agendar" e perde o vínculo com o atendimento. Por isso o resultado de cada
-- atendimento vira um registro próprio (`attendance_session_outcomes`).
-- Idempotente.
-- =============================================================================

-- 1) Uma anotação por atendimento --------------------------------------------
create unique index if not exists clinical_progress_notes_appointment_uk
  on public.clinical_progress_notes (appointment_id)
  where appointment_id is not null;

-- 2) O que aconteceu com cada sessão naquele atendimento ----------------------
create table if not exists public.attendance_session_outcomes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  session_id uuid references public.treatment_sessions (id) on delete set null,
  -- Cópia do texto: a sessão pode ser reagendada/renomeada depois; o histórico
  -- do atendimento não muda.
  label text not null,
  stage_name text,
  planned_minutes int,
  done boolean not null,
  /** Sessão executada que NÃO estava programada para este atendimento. */
  unplanned boolean not null default false,
  reason text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id)
);
create index if not exists attendance_outcomes_appt_idx
  on public.attendance_session_outcomes (appointment_id);
create index if not exists attendance_outcomes_client_idx
  on public.attendance_session_outcomes (client_id, recorded_at desc);

alter table public.attendance_session_outcomes enable row level security;

-- Leitura: mesma régua das anotações clínicas (equipe clínica + acesso ao
-- histórico do cliente). Escrita: só pela função de conclusão.
drop policy if exists "attendance_outcomes_select" on public.attendance_session_outcomes;
create policy "attendance_outcomes_select" on public.attendance_session_outcomes
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(
         clinic_id,
         array['dentist','clinical_coordinator','receptionist']::public.user_role[]
       )
    or public.user_has_client_history_access(client_id)
  );

-- 3) Conclusão do atendimento -------------------------------------------------
-- Agora com: sessões EXTRAS (não programadas), registro do resultado e a trava
-- "só conclui depois de escrever o Desenvolvimento Clínico".
create or replace function public.conclude_attendance_partial(
  p_appointment_id uuid,
  p_done_ids uuid[],
  p_reasons jsonb default '{}'::jsonb,
  p_extra_ids uuid[] default array[]::uuid[]
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
  v_called timestamptz;
  v_done timestamptz := now();
  v_user uuid := (select auth.uid());
  v_status public.journey_status;
  v_name text;
  v_total_min numeric;
  v_planned_sum numeric;
  v_count int;
  v_all_planned boolean;
  v_reopened int := 0;
  v_extra uuid[] := coalesce(p_extra_ids, array[]::uuid[]);
  v_all_done uuid[];
begin
  select clinic_id, provider_user_id, called_by, client_id, called_at
    into v_clinic, v_provider, v_called_by, v_client, v_called
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or (
      public.has_role_in_clinic(v_clinic, array['dentist']::public.user_role[])
      and (v_called_by = v_user or (v_called_by is null and v_provider = v_user))
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- I7b: só conclui depois de descrever o atendimento.
  if not exists (
    select 1 from public.clinical_progress_notes n
    where n.appointment_id = p_appointment_id
      and btrim(n.body) <> ''
  ) then
    raise exception 'NOTE_REQUIRED';
  end if;

  -- I7b: sessões EXTRAS — só as do mesmo cliente, ainda não concluídas e que
  -- sejam do próprio dentista ou ainda sem dentista definido.
  if array_length(v_extra, 1) is not null then
    update public.treatment_sessions ts
       set appointment_id = p_appointment_id
     where ts.id = any (v_extra)
       and ts.client_id = v_client
       and ts.status <> 'done'
       and (ts.appointment_id is null or ts.appointment_id = p_appointment_id)
       and (ts.planner_provider_id is null
            or ts.planner_provider_id = coalesce(v_provider, v_user)
            or ts.planner_provider_id = v_user);
  end if;

  v_all_done := coalesce(p_done_ids, array[]::uuid[]) || v_extra;

  update public.appointments
  set attendance = 'done', status = 'completed',
      done_at = v_done, done_by = v_user
  where id = p_appointment_id;

  if v_called is not null then
    v_total_min := greatest(0, round(extract(epoch from (v_done - v_called)) / 60));
  else
    v_total_min := null;
  end if;

  select count(*),
         coalesce(sum(coalesce(planned_minutes, 0)), 0),
         bool_and(coalesce(planned_minutes, 0) > 0)
    into v_count, v_planned_sum, v_all_planned
  from public.treatment_sessions
  where appointment_id = p_appointment_id
    and status <> 'done'
    and id = any (v_all_done);

  -- Registro do resultado ANTES de mexer nas sessões (depois delas o vínculo
  -- com o atendimento some).
  insert into public.attendance_session_outcomes
    (appointment_id, clinic_id, client_id, session_id, label, stage_name,
     planned_minutes, done, unplanned, reason, recorded_by)
  select p_appointment_id, v_clinic, v_client, ts.id,
         ts.procedure_name || ' — ' ||
           coalesce(ts.name, 'Sessão ' || ts.session_index || ' de ' || ts.session_total),
         ts.stage_name,
         ts.planned_minutes,
         ts.id = any (v_all_done),
         ts.id = any (v_extra),
         nullif(btrim(p_reasons ->> ts.id::text), ''),
         v_user
    from public.treatment_sessions ts
   where ts.appointment_id = p_appointment_id
     and ts.status <> 'done'
     and not exists (
       select 1 from public.attendance_session_outcomes o
       where o.appointment_id = p_appointment_id and o.session_id = ts.id
     );

  if v_count > 0 then
    update public.treatment_sessions ts
    set status = 'done',
        done_at = v_done,
        executed_by = v_user,
        actual_minutes = case
          when v_total_min is null then null
          when v_all_planned and v_planned_sum > 0
            then round(v_total_min * ts.planned_minutes / v_planned_sum)::int
          else round(v_total_min / v_count)::int
        end
    where ts.appointment_id = p_appointment_id
      and ts.status <> 'done'
      and ts.id = any (v_all_done);
  end if;

  update public.treatment_sessions ts
  set status = 'pending',
      appointment_id = null,
      planned_date = null,
      reopen_reason = nullif(btrim(p_reasons ->> ts.id::text), ''),
      reopened_at = v_done,
      reopened_by = v_user
  where ts.appointment_id = p_appointment_id
    and ts.status <> 'done'
    and not (ts.id = any (v_all_done));
  get diagnostics v_reopened = row_count;

  update public.appointments a
  set treatment_session_id = null
  where a.id = p_appointment_id
    and a.treatment_session_id is not null
    and not exists (
      select 1 from public.treatment_sessions ts
      where ts.id = a.treatment_session_id
        and ts.appointment_id = p_appointment_id
    );

  select journey_status, full_name into v_status, v_name
  from public.clients where id = v_client;

  if v_reopened > 0 then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
           'Sessões reabertas: revisar agendamento de ' || v_name,
           v_reopened || ' sessão(ões) do atendimento não foram concluídas e '
             || 'voltaram para "a agendar". Revise os agendamentos do cliente.',
           '/clientes/' || v_client
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
  elsif v_status = 'in_treatment' and not exists (
    select 1 from public.appointments ap
    where ap.client_id = v_client
      and ap.type = 'treatment_session'
      and ap.starts_at > now()
      and ap.status in ('scheduled', 'confirmed')
  ) then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
           'Agendar próxima sessão de tratamento: ' || v_name,
           v_name || ' concluiu uma sessão e não tem a próxima agendada.',
           '/clientes/' || v_client
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
  end if;
end;
$$;

grant execute on function public.conclude_attendance_partial(uuid, uuid[], jsonb, uuid[])
  to authenticated;
-- A assinatura antiga continua existindo (3 argumentos); o app passa a usar a
-- de 4. Mantida para não quebrar chamadas em voo.
