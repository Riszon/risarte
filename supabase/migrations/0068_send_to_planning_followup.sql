-- =============================================================================
-- 0068 — Fluxo pós-avaliação do Coordenador (LOTE H3: item H3.10)
-- -----------------------------------------------------------------------------
-- Quando o Coordenador envia o cliente ao Centro de Planejamento:
--   (a) o atendimento que está "Em atendimento" (in_service) daquele cliente é
--       CONCLUÍDO automaticamente (não fica aberto);
--   (b) a Recepção da unidade é avisada para AGENDAR a apresentação online do
--       plano com o Consultor Comercial.
-- Chamada como follow-up após move_client_phase(planning_center). Best-effort:
-- se não for coordenador/admin da unidade, não faz nada (silencioso).
-- Idempotente.
-- =============================================================================

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
end;
$$;

grant execute on function public.send_to_planning_followup(uuid) to authenticated;
