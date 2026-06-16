-- =============================================================================
-- Risarte Odontologia — Migration 0017 (Lote Base da Jornada, passo 3)
-- Sub-status within each phase. The initial status is set automatically when
-- the client changes phase (trigger); the responsible role advances it via
-- set_journey_status(). Full automatic wiring lands with the clinical modules
-- (Etapas 4 e 5).
-- =============================================================================

create type public.journey_status as enum (
  'awaiting_send_to_planning',     -- Fase 2 e 6
  'in_planning',                   -- Fase 3
  'awaiting_plan_approval',        -- Fase 3
  'revision_with_coordinator',     -- Fase 3 (devolvido)
  'awaiting_treatment_start',      -- Fase 5
  'in_treatment',                  -- Fase 5
  'treatment_finished',            -- Fase 5
  'treatment_cancelled',           -- Fase 5
  'treatment_partially_cancelled'  -- Fase 5
);

alter table public.clients add column journey_status public.journey_status;

-- -----------------------------------------------------------------------------
-- Default status when the client enters a phase (fires only on phase change).
-- -----------------------------------------------------------------------------
create function public.set_default_journey_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.journey_phase is distinct from old.journey_phase then
    new.journey_status := case new.journey_phase
      when 'planning_center' then 'in_planning'::public.journey_status
      when 'treatment_start' then 'awaiting_treatment_start'::public.journey_status
      else null
    end;
  end if;
  return new;
end;
$$;

create trigger clients_default_journey_status
  before update on public.clients
  for each row execute function public.set_default_journey_status();

-- -----------------------------------------------------------------------------
-- set_journey_status: the responsible role advances the sub-status.
-- -----------------------------------------------------------------------------
create function public.set_journey_status(
  p_client_id uuid,
  p_status public.journey_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_phase public.journey_phase;
  v_valid boolean;
  v_allowed boolean;
begin
  select clinic_id, journey_phase into v_clinic, v_phase
  from public.clients where id = p_client_id;

  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  -- The status must belong to the client's current phase.
  v_valid := case v_phase
    when 'clinical_conversion' then p_status = 'awaiting_send_to_planning'
    when 'reevaluation' then p_status = 'awaiting_send_to_planning'
    when 'planning_center' then p_status in
      ('in_planning', 'awaiting_plan_approval', 'revision_with_coordinator')
    when 'treatment_start' then p_status in
      ('awaiting_treatment_start', 'in_treatment', 'treatment_finished',
       'treatment_cancelled', 'treatment_partially_cancelled')
    else false
  end;
  if not v_valid then raise exception 'STATUS_INVALID_FOR_PHASE'; end if;

  -- Role allowed to set this status.
  v_allowed := public.is_admin_master() or case
    when p_status in ('in_planning', 'awaiting_plan_approval', 'revision_with_coordinator')
      then public.is_planner()
    when p_status = 'awaiting_send_to_planning'
      then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
    else
      public.has_role_in_clinic(v_clinic, array['clinical_coordinator','dentist','receptionist']::public.user_role[])
  end;
  if not v_allowed then raise exception 'NOT_ALLOWED'; end if;

  update public.clients set journey_status = p_status where id = p_client_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), v_clinic, 'update', 'client_status',
          p_client_id::text, jsonb_build_object('journey_status', p_status));
end;
$$;
