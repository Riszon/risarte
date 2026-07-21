-- =============================================================================
-- Risarte Odontologia — Migration 0140
-- Complementa as sessões de procedimentos ADICIONADOS depois que o tratamento
-- começou. A geração original (`ensure_treatment_sessions`) roda uma única vez
-- (trava "já existe sessão") e só na Fase 5 — então um procedimento incluído no
-- plano depois fica SEM sessões e não aparecia com sessões na aba. Esta função
-- gera as sessões APENAS dos itens que não têm nenhuma sessão ainda (idempotente,
-- sem duplicar), na opção executada do plano aprovado.
-- =============================================================================

create or replace function public.topup_treatment_sessions(
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_plan uuid;
  v_option uuid;
  v_item record;
  v_proto record;
  v_use_unit boolean;
  v_proto_count int;
  v_qty int;
  v_total int;
  v_idx int;
  v_q int;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then return; end if;
  if not (
    public.is_admin_master()
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.user_id = (select auth.uid())
    )
  ) then
    return;
  end if;

  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;
  if v_plan is null then return; end if;

  -- Opção executada: a que já tem sessões; senão a aprovada/principal.
  select o.id into v_option from public.treatment_plan_options o
  where o.plan_id = v_plan
    and exists (
      select 1 from public.treatment_plan_option_items i
      join public.treatment_sessions ts on ts.item_id = i.id
      where i.option_id = o.id
    )
  order by o.is_primary desc, o.sort_order asc limit 1;
  if v_option is null then
    select id into v_option from public.treatment_plan_options
    where plan_id = v_plan and review_status = 'approved'
    order by is_primary desc, sort_order asc limit 1;
  end if;
  if v_option is null then
    select id into v_option from public.treatment_plan_options
    where plan_id = v_plan order by is_primary desc, sort_order asc limit 1;
  end if;
  if v_option is null then return; end if;

  for v_item in
    select i.id as item_id, i.procedure_id, i.quantity,
           coalesce(i.planned_sessions, 1) as planned_sessions,
           i.planned_total_minutes,
           coalesce(p.name, i.description) as proc_name,
           st.name as stage_name, st.sort_order as stage_order
    from public.treatment_plan_option_items i
    left join public.procedures p on p.id = i.procedure_id
    left join public.treatment_plan_stages st on st.id = i.stage_id
    where i.option_id = v_option
      and not exists (
        select 1 from public.treatment_sessions ts where ts.item_id = i.id
      )
  loop
    v_qty := greatest(coalesce(v_item.quantity, 1), 1);

    v_use_unit := false;
    v_proto_count := 0;
    if v_item.procedure_id is not null then
      select count(*) into v_proto_count
      from public.procedure_sessions ps
      where ps.procedure_id = v_item.procedure_id and ps.clinic_id = v_clinic;
      if v_proto_count > 0 then
        v_use_unit := true;
      else
        select count(*) into v_proto_count
        from public.procedure_sessions ps
        where ps.procedure_id = v_item.procedure_id and ps.clinic_id is null;
      end if;
    end if;

    if v_item.procedure_id is not null and v_proto_count > 0 then
      v_total := v_proto_count * v_qty;
      v_idx := 0;
      for v_q in 1..v_qty loop
        for v_proto in
          select ps.name, ps.estimated_minutes
          from public.procedure_sessions ps
          where ps.procedure_id = v_item.procedure_id
            and ps.clinic_id is not distinct from
                (case when v_use_unit then v_clinic else null end)
          order by ps.session_index
        loop
          v_idx := v_idx + 1;
          insert into public.treatment_sessions
            (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
             session_index, session_total, name, planned_minutes,
             stage_name, stage_order)
          values
            (p_client_id, v_clinic, v_plan, v_item.item_id, v_item.procedure_id,
             v_item.proc_name, v_idx, v_total,
             coalesce(nullif(v_proto.name, ''),
                      'Sessão ' || v_idx || ' de ' || v_total),
             nullif(v_proto.estimated_minutes, 0),
             v_item.stage_name, v_item.stage_order);
        end loop;
      end loop;
    else
      insert into public.treatment_sessions
        (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
         session_index, session_total, name, planned_minutes,
         stage_name, stage_order)
      select p_client_id, v_clinic, v_plan, v_item.item_id, v_item.procedure_id,
        v_item.proc_name, gs.idx, v_item.planned_sessions,
        'Sessão ' || gs.idx || ' de ' || v_item.planned_sessions,
        case
          when v_item.planned_sessions > 0 and v_item.planned_total_minutes is not null
          then round(v_item.planned_total_minutes::numeric / v_item.planned_sessions)::int
          else null
        end,
        v_item.stage_name, v_item.stage_order
      from generate_series(1, v_item.planned_sessions) as gs(idx);
    end if;
  end loop;
end;
$$;

revoke all on function public.topup_treatment_sessions(uuid) from public;
grant execute on function public.topup_treatment_sessions(uuid) to authenticated;
