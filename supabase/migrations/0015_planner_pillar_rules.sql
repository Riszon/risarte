-- =============================================================================
-- Risarte Odontologia — Migration 0015
-- The Dentista Planner may set the treatment pillar ONLY while the client is in
-- the Planning Center (FASE 3). Elsewhere, only the Admin Master can change it.
-- (The "pillar required before FASE 3 → FASE 4" rule is enforced in the app.)
-- =============================================================================

create or replace function public.set_treatment_pillar(
  p_client_id uuid,
  p_pillar public.methodology_pillar
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_phase public.journey_phase;
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_pillar not in ('health', 'function', 'aesthetics', 'prevention') then
    raise exception 'INVALID_TREATMENT_PILLAR';
  end if;

  select clinic_id, journey_phase into v_clinic, v_phase
  from public.clients where id = p_client_id;

  if v_clinic is null then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  -- The Planner may only classify during the Planning Center phase.
  if not public.is_admin_master() and v_phase <> 'planning_center' then
    raise exception 'PILLAR_ONLY_IN_PLANNING';
  end if;

  update public.clients set methodology_pillar = p_pillar where id = p_client_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    (select auth.uid()), v_clinic, 'update', 'client_pillar',
    p_client_id::text, jsonb_build_object('treatment_pillar', p_pillar)
  );
end;
$$;
