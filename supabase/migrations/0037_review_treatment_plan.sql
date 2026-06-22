-- =============================================================================
-- Risarte Odontologia — Migration 0037 (Etapa 5.3 / 4.3 — Aprovação do plano)
-- O Coordenador Clínico aprova ou devolve o plano que o Planner enviou.
--   - aprovar  → status 'approved'; notifica o Planner para enviar ao Comercial.
--   - devolver → status 'returned' + orientações; sub-status do cliente vira
--                'revision_with_coordinator'; notifica o Planner.
-- Depois de aprovado, o Planner é quem move a Fase 3 → Fase 4 (na app, com a
-- trava de "plano aprovado"). Usa os campos reviewed_by/reviewed_at/review_notes
-- já criados na migração 0035. Idempotente (create or replace).
-- =============================================================================

create or replace function public.review_treatment_plan(
  p_plan_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_clinic uuid;
  v_status public.treatment_plan_status;
  v_planner uuid;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.status, tp.created_by
    into v_client, v_clinic, v_status, v_planner
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  -- Quem revisa: o Coordenador Clínico da unidade do plano (ou Admin Master).
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_status <> 'submitted' then raise exception 'NOT_SUBMITTED'; end if;

  select full_name into v_name from public.clients where id = v_client;

  if p_approve then
    update public.treatment_plans
      set status = 'approved', reviewed_by = v_user, reviewed_at = now(),
          review_notes = null, updated_at = now()
    where id = p_plan_id;

    -- Sem sub-status pendente após aprovar; o cartão do plano mostra "Aprovado".
    update public.clients set journey_status = null where id = v_client;

    if v_planner is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_planner, v_clinic, 'Plano aprovado',
        coalesce(v_name, 'Cliente') ||
          ' — plano aprovado pelo Coordenador. Envie ao Comercial.',
        '/clientes/' || v_client);
    end if;
  else
    if coalesce(btrim(p_notes), '') = '' then
      raise exception 'NOTES_REQUIRED';
    end if;
    update public.treatment_plans
      set status = 'returned', reviewed_by = v_user, reviewed_at = now(),
          review_notes = p_notes, updated_at = now()
    where id = p_plan_id;

    update public.clients
      set journey_status = 'revision_with_coordinator'
    where id = v_client;

    if v_planner is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_planner, v_clinic, 'Plano devolvido para revisão',
        coalesce(v_name, 'Cliente') ||
          ' — o Coordenador devolveu o plano. Veja as orientações na ficha.',
        '/clientes/' || v_client);
    end if;
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan', p_plan_id::text,
    jsonb_build_object('review',
      case when p_approve then 'approved' else 'returned' end));
end;
$$;
