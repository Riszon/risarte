-- =============================================================================
-- Risarte Odontologia — Migration 0142 (Cockpit — Bloco D, reformulação)
-- O controle de qualidade NÃO trava mais a jornada.
--
-- Reverte a 0141: `request_quality_scheduling` volta a APENAS avisar a recepção
-- (não move o cliente 6→5). Revisão/reprovação não influenciam a fase — o cliente
-- segue a jornada como o coordenador definir, levando as pendências. O
-- agendamento tipo REVISÃO/REFAÇÃO e a reabertura do procedimento entram nas
-- próximas entregas. Idempotente.
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
  select ucr.user_id, v_clinic, 'Agendar revisão/refação de procedimentos',
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
