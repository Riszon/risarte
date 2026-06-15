-- =============================================================================
-- Risarte Odontologia — Migration 0012 (Lote Base da Jornada, passo 2)
-- The displayed methodology pillar is computed in the app from the phase
-- (automatic) + the Planner's "treatment pillar". The stored column
-- `clients.methodology_pillar` now holds the TREATMENT pillar (one of
-- health/function/aesthetics/prevention), set only by the Dentista Planner.
-- This function lets the Planner (or Admin Master) set it without widening the
-- general clients update policy.
-- =============================================================================

create function public.set_treatment_pillar(
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
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_pillar not in ('health', 'function', 'aesthetics', 'prevention') then
    raise exception 'INVALID_TREATMENT_PILLAR';
  end if;

  update public.clients
  set methodology_pillar = p_pillar
  where id = p_client_id
  returning clinic_id into v_clinic;

  if v_clinic is null then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    (select auth.uid()), v_clinic, 'update', 'client_pillar',
    p_client_id::text, jsonb_build_object('treatment_pillar', p_pillar)
  );
end;
$$;
