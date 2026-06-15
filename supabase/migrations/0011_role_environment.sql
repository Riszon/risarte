-- =============================================================================
-- Risarte Odontologia — Migration 0011 (Lote Base da Jornada, passo 1)
-- A role can only be assigned to a clinic whose TYPE matches its environment:
--   franchisor: sdr, planner_dentist, commercial_consultant,
--               commercial_assistant, franchisor_staff
--   franchise_unit: receptionist, clinical_coordinator, dentist, unit_manager,
--               tsb, asb, franchisee
-- Enforced by a BEFORE trigger on user_clinic_roles (existing rows untouched).
-- =============================================================================

create function public.role_allowed_for_clinic(
  p_role public.user_role,
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (select type from public.clinics where id = p_clinic_id)
    when 'franchisor' then p_role in (
      'sdr','planner_dentist','commercial_consultant',
      'commercial_assistant','franchisor_staff'
    )
    when 'franchise_unit' then p_role in (
      'receptionist','clinical_coordinator','dentist','unit_manager',
      'tsb','asb','franchisee'
    )
    else false
  end;
$$;

create function public.check_role_environment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.role_allowed_for_clinic(new.role, new.clinic_id) then
    raise exception 'ROLE_NOT_ALLOWED_FOR_CLINIC_TYPE'
      using hint = 'Esta função não pode ser atribuída neste tipo de clínica.';
  end if;
  return new;
end;
$$;

create trigger user_clinic_roles_environment
  before insert or update on public.user_clinic_roles
  for each row execute function public.check_role_environment();
