-- =============================================================================
-- Risarte Odontologia — Migration 0042 (LOTE F — ajustes 2)
-- (1) Registrar QUEM encerrou o compartilhamento (client_shares.ended_by) e
--     gravá-lo em end_client_share, para a ficha mostrar os detalhes do
--     encerramento (a unidade B perde o acesso após encerrar).
-- (2) review_plan_option: as considerações passam a ser OBRIGATÓRIAS quando o
--     Coordenador REPROVA uma opção (ajudam o Planner a refazer o plano).
-- Idempotente.
-- =============================================================================

alter table public.client_shares
  add column if not exists ended_by uuid references public.profiles (id);

create or replace function public.end_client_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home uuid;
  v_target uuid;
  v_client uuid;
  v_name text;
  v_home_name text;
  v_target_name text;
  v_user uuid := (select auth.uid());
begin
  select s.clinic_id, s.client_id, c.clinic_id, c.full_name
    into v_target, v_client, v_home, v_name
  from public.client_shares s
  join public.clients c on c.id = s.client_id
  where s.id = p_share_id and s.ended_at is null;
  if v_client is null then raise exception 'SHARE_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_home, array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
    or public.has_role_in_clinic(v_target, array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.client_shares
    set ended_at = now(), ended_by = v_user
  where id = p_share_id;

  select name into v_home_name from public.clinics where id = v_home;
  select name into v_target_name from public.clinics where id = v_target;

  -- Unidade B (destino): perdeu o acesso.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_target,
         'Compartilhamento encerrado',
         v_name || ' não está mais compartilhado(a) com sua unidade.',
         '/clientes/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_target
    and ucr.role in ('receptionist','clinical_coordinator','unit_manager');

  -- Unidade A (origem): registro do encerramento.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_home,
         'Compartilhamento encerrado',
         v_name || ' deixou de ser compartilhado(a) com a unidade ' ||
           coalesce(v_target_name, 'destino') || '.',
         '/clientes/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_home
    and ucr.role in ('receptionist','clinical_coordinator','unit_manager');

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_target, 'update', 'client_share', v_client::text,
          jsonb_build_object('ended', true, 'from_clinic', v_home, 'to_clinic', v_target));
end;
$$;

-- -----------------------------------------------------------------------------
-- review_plan_option: considerações obrigatórias ao REPROVAR.
-- -----------------------------------------------------------------------------
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

  -- Reprovar exige considerações (orientam o Planner a refazer).
  if not p_approve and coalesce(btrim(p_notes), '') = '' then
    raise exception 'NOTES_REQUIRED';
  end if;

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
