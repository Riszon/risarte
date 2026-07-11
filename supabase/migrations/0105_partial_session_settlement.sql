-- =============================================================================
-- 0105 — Baixa PARCIAL das sessões do atendimento (H4.6 A1 — Módulo do Dentista)
-- -----------------------------------------------------------------------------
-- Hoje, ao concluir um atendimento, `settle_treatment_sessions` liquida TODAS as
-- sessões ligadas a ele (0059). O dono pediu que o DENTISTA confirme, no fim do
-- atendimento, QUAIS sessões foram realmente feitas. Então:
--   - as CONFIRMADAS são concluídas (tempo real rateado só entre elas);
--   - as NÃO feitas voltam para "a agendar" (soltam do horário, planned_date
--     limpa) e podem receber um motivo opcional;
--   - a Recepção é avisada para revisar/reagendar.
-- Quem confirma a baixa é só o Dentista (ou Admin). Idempotente.
-- =============================================================================

-- Rastreio da reabertura (para o histórico e para a Recepção entender o porquê).
alter table public.treatment_sessions
  add column if not exists reopen_reason text,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references public.profiles (id);

-- -----------------------------------------------------------------------------
-- conclude_attendance_partial: conclui o atendimento e dá baixa SÓ nas sessões
-- confirmadas; reabre as demais e avisa a Recepção. Substitui, para atendimentos
-- COM sessões, o caminho do `update_attendance(done)` (que liquida tudo).
--   p_done_ids  — ids das sessões realmente feitas.
--   p_reasons   — jsonb { "<session_id>": "motivo" } opcional para as não feitas.
-- -----------------------------------------------------------------------------
create or replace function public.conclude_attendance_partial(
  p_appointment_id uuid,
  p_done_ids uuid[],
  p_reasons jsonb default '{}'::jsonb
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
begin
  select clinic_id, provider_user_id, called_by, client_id, called_at
    into v_clinic, v_provider, v_called_by, v_client, v_called
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  -- Só o Dentista (ou Admin) confirma a baixa clínica das sessões. Além disso,
  -- precisa ser quem chamou o cliente (ou o profissional do agendamento).
  if not (
    public.is_admin_master()
    or (
      public.has_role_in_clinic(v_clinic, array['dentist']::public.user_role[])
      and (v_called_by = v_user or (v_called_by is null and v_provider = v_user))
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Conclui o atendimento (mesmo efeito do ramo 'done' de update_attendance).
  update public.appointments
  set attendance = 'done', status = 'completed',
      done_at = v_done, done_by = v_user
  where id = p_appointment_id;

  -- Tempo real do atendimento (chamada -> conclusão), em minutos.
  if v_called is not null then
    v_total_min := greatest(0, round(extract(epoch from (v_done - v_called)) / 60));
  else
    v_total_min := null;
  end if;

  -- Rateio: base só nas sessões CONFIRMADAS (feitas) deste atendimento.
  select count(*),
         coalesce(sum(coalesce(planned_minutes, 0)), 0),
         bool_and(coalesce(planned_minutes, 0) > 0)
    into v_count, v_planned_sum, v_all_planned
  from public.treatment_sessions
  where appointment_id = p_appointment_id
    and status <> 'done'
    and id = any (p_done_ids);

  -- Liquida as confirmadas com o tempo real rateado só entre elas.
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
      and ts.id = any (p_done_ids);
  end if;

  -- Reabre as NÃO feitas: voltam para "a agendar" (soltam do horário concluído).
  update public.treatment_sessions ts
  set status = 'pending',
      appointment_id = null,
      planned_date = null,
      reopen_reason = nullif(btrim(p_reasons ->> ts.id::text), ''),
      reopened_at = v_done,
      reopened_by = v_user
  where ts.appointment_id = p_appointment_id
    and ts.status <> 'done'
    and not (ts.id = any (p_done_ids));
  get diagnostics v_reopened = row_count;

  -- Se o ponteiro "primeira sessão" do agendamento apontava para uma reaberta,
  -- limpa (o atendimento já foi concluído; a sessão reaberta não fica presa).
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

  -- Alerta à Recepção quando houve sessões reabertas (mensagem específica).
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
    -- Sem reabertura: mantém o aviso padrão "agendar próxima sessão".
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

grant execute on function public.conclude_attendance_partial(uuid, uuid[], jsonb)
  to authenticated;
