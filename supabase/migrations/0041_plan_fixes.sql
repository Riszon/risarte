-- =============================================================================
-- Risarte Odontologia — Migration 0041 (LOTE F — correções do plano)
-- (1) review_plan_option: o CASE com literais virava `text` e o Postgres não
--     converte text→enum implicitamente no UPDATE → "não foi possível registrar
--     a avaliação". Corrigido com cast explícito para option_review_status.
-- (2) submit_treatment_plan: o Planner não pode enviar para aprovação se alguma
--     opção estiver SEM procedimentos lançados (sem itens de orçamento).
-- Idempotente (create or replace).
-- =============================================================================

create or replace function public.review_plan_option(
  p_option_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_clinic uuid;
  v_client uuid;
  v_status public.treatment_plan_status;
  v_planner uuid;
  v_name text;
  v_pending integer;
  v_approved integer;
  v_user uuid := (select auth.uid());
begin
  select o.plan_id, o.clinic_id into v_plan, v_clinic
  from public.treatment_plan_options o where o.id = p_option_id;
  if v_plan is null then raise exception 'OPTION_NOT_FOUND'; end if;

  select tp.client_id, tp.status, tp.created_by
    into v_client, v_status, v_planner
  from public.treatment_plans tp where tp.id = v_plan;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_status <> 'submitted' then raise exception 'NOT_SUBMITTED'; end if;

  update public.treatment_plan_options
    set review_status =
          (case when p_approve then 'approved' else 'rejected' end)
            ::public.option_review_status,
        reviewed_by = v_user, reviewed_at = now(),
        review_notes = nullif(btrim(coalesce(p_notes, '')), '')
  where id = p_option_id;

  select
    count(*) filter (where review_status = 'pending'),
    count(*) filter (where review_status = 'approved')
    into v_pending, v_approved
  from public.treatment_plan_options where plan_id = v_plan;

  if v_pending > 0 then return; end if;

  select full_name into v_name from public.clients where id = v_client;

  if v_approved >= 1 then
    update public.treatment_plans
      set status = 'approved', reviewed_by = v_user, reviewed_at = now(),
          updated_at = now()
    where id = v_plan;
    update public.clients set journey_status = null where id = v_client;
    if v_planner is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_planner, v_clinic, 'Plano aprovado',
        coalesce(v_name, 'Cliente') ||
          ' — opções avaliadas pelo Coordenador. Envie ao Comercial.',
        '/clientes/' || v_client);
    end if;
  else
    update public.treatment_plans
      set status = 'returned', reviewed_by = v_user, reviewed_at = now(),
          updated_at = now()
    where id = v_plan;
    update public.clients
      set journey_status = 'revision_with_coordinator'
    where id = v_client;
    if v_planner is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_planner, v_clinic, 'Plano devolvido para revisão',
        coalesce(v_name, 'Cliente') ||
          ' — todas as opções foram reprovadas. Veja as considerações na ficha.',
        '/clientes/' || v_client);
    end if;
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan_option', p_option_id::text,
    jsonb_build_object('approved', p_approve));
end;
$$;

create or replace function public.submit_treatment_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_clinic uuid;
  v_phase public.journey_phase;
  v_diagnosis text;
  v_options integer;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.diagnosis
    into v_client, v_clinic, v_diagnosis
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select journey_phase, full_name into v_phase, v_name
  from public.clients where id = v_client;
  if v_phase <> 'planning_center' then raise exception 'WRONG_PHASE'; end if;

  if coalesce(btrim(v_diagnosis), '') = '' then
    raise exception 'DIAGNOSIS_REQUIRED';
  end if;

  select count(*) into v_options
  from public.treatment_plan_options where plan_id = p_plan_id;
  if v_options = 0 then raise exception 'OPTIONS_REQUIRED'; end if;

  -- Toda opção precisa ter ao menos um procedimento (item de orçamento).
  if exists (
    select 1 from public.treatment_plan_options o
    where o.plan_id = p_plan_id
      and not exists (
        select 1 from public.treatment_plan_option_items i
        where i.option_id = o.id
      )
  ) then
    raise exception 'OPTION_NEEDS_ITEMS';
  end if;

  update public.treatment_plan_options
    set review_status = 'pending', reviewed_by = null, reviewed_at = null,
        review_notes = null
  where plan_id = p_plan_id;

  update public.treatment_plans
    set status = 'submitted', submitted_at = now(), updated_at = now(),
        reviewed_by = null, reviewed_at = null, review_notes = null
  where id = p_plan_id;

  update public.clients
    set journey_status = 'awaiting_plan_approval'
  where id = v_client;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic,
         'Plano aguardando aprovação',
         coalesce(v_name, 'Cliente') ||
           ' — o Planner enviou o plano de tratamento para sua aprovação.',
         '/clientes/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator';

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan', p_plan_id::text,
          jsonb_build_object('status', 'submitted'));
end;
$$;
