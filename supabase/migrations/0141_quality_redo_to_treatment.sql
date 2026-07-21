-- =============================================================================
-- Risarte Odontologia — Migration 0141 (Cockpit do Coordenador — Bloco D, cont.)
-- Regra de jornada da refação (Entrega 5).
--
-- Quando há procedimentos para REVISAR ou REPROVADOS que serão REFEITOS (pelo
-- mesmo dentista ou por outro), o cliente volta para a FASE 5 (Início de
-- Tratamento) para a recepção reagendar a refação com o profissional escolhido.
-- Se o procedimento reprovado for "incluir no próximo plano" (replan), o cliente
-- permanece na Fase 6 e só vai à Fase 3 quando o Coordenador enviar ao Centro de
-- Planejamento. Refação tem PRIORIDADE: primeiro Fase 5, depois o resto.
--
-- Aqui, o botão "solicitar agendamento" (request_quality_scheduling) passa a,
-- além de avisar a recepção, mover o cliente 6→5 quando há refação. O movimento
-- é feito direto (SECURITY DEFINER) — não entra no menu geral do kanban.
-- Idempotente.
-- =============================================================================

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
  v_redo int;
  v_phase public.journey_phase;
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

  -- Refação (revisão ou reprovado-refazer) → volta para a Fase 5 (Início de
  -- Tratamento) para a recepção reagendar. Replan não conta aqui.
  select count(*) into v_redo from public.plan_quality_reviews
    where plan_id = p_plan_id
      and (status = 'revisao'
           or (status = 'reprovado' and resolution in ('redo_same','redo_other')));

  if v_redo > 0 then
    select journey_phase into v_phase from public.clients where id = v_client;
    if v_phase is distinct from 'treatment_start'::public.journey_phase then
      update public.journey_phase_history
        set exited_at = now()
      where client_id = v_client and exited_at is null;
      insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
      values (v_client, v_clinic, 'treatment_start'::public.journey_phase, v_user);
      update public.clients
        set journey_phase = 'treatment_start'::public.journey_phase,
            phase_entered_at = now()
      where id = v_client;
    end if;
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'quality_scheduling_request', p_plan_id::text,
    jsonb_build_object('count', v_count, 'redo', v_redo));
end;
$$;
