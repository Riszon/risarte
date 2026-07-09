-- =============================================================================
-- 0088 — Sessões do tratamento a partir do PROTOCOLO (H4.5, ajuste)
-- -----------------------------------------------------------------------------
-- Antes: ao entrar em Início de Tratamento, cada procedimento gerava N sessões
-- genéricas ("Sessão 1 de N") com o tempo TOTAL dividido igualmente entre elas.
-- Agora: quando o procedimento tem PROTOCOLO cadastrado (procedure_sessions —
-- unidade do cliente tem prioridade sobre a rede), cada sessão gerada herda o
-- NOME e o TEMPO reais daquela sessão do protocolo (repetindo pela quantidade do
-- item). Sem protocolo, mantém o comportamento antigo (contagem planejada +
-- divisão do tempo).
-- Recria ensure_treatment_sessions. Idempotente.
-- Obs.: só afeta séries geradas a partir de agora (a função gera uma única vez
-- por cliente); casos já em Início de Tratamento mantêm as sessões atuais.
-- =============================================================================

create or replace function public.ensure_treatment_sessions(p_client_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_phase text;
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
  select clinic_id, journey_phase::text into v_clinic, v_phase
  from public.clients where id = p_client_id;
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
  if v_phase <> 'treatment_start' then return; end if;
  if exists (select 1 from public.treatment_sessions where client_id = p_client_id) then
    return;
  end if;

  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;
  if v_plan is null then return; end if;

  select id into v_option from public.treatment_plan_options
  where plan_id = v_plan and review_status = 'approved'
  order by is_primary desc, sort_order asc limit 1;
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
  loop
    v_qty := greatest(coalesce(v_item.quantity, 1), 1);

    -- Protocolo do procedimento: a UNIDADE tem prioridade sobre a REDE.
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
      -- Gera a partir do protocolo, com o nome e o tempo reais de cada sessão,
      -- repetindo pela quantidade do item.
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
      -- Sem protocolo: comportamento antigo (contagem planejada + divisão).
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
end $$;

grant execute on function public.ensure_treatment_sessions(uuid) to authenticated;
