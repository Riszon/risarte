-- =============================================================================
-- 0286 — AS SESSÕES DO TRATAMENTO SAEM DA OPÇÃO QUE O CLIENTE COMPROU (OC-00087)
-- -----------------------------------------------------------------------------
-- Achado ao diagnosticar o relato OC-00087 (07/10/2026). O Planner pediu para
-- configurar "Atendimentos e sequência" também nas opções alternativas do
-- plano — e, ao conferir o que acontece quando o cliente compra a alternativa,
-- apareceu um defeito maior que o pedido:
--
--   `ensure_treatment_sessions` escolhia a opção APROVADA com `is_primary`
--   primeiro, SEM OLHAR A NEGOCIAÇÃO. Cliente que comprou a alternativa
--   começava o tratamento com as sessões da PRINCIPAL — outros procedimentos.
--
-- Provado no treino numa transação desfeita (negociação aceita na alternativa
-- → sessão gerada da principal). Na produção não havia nenhuma negociação em
-- 07/10/2026: ninguém foi afetado. No treino havia 1 venda com 8 sessões de
-- outra opção — NÃO são corrigidas aqui (nada retroativo; sessão já gerada
-- pode ter agendamento e atendimento em cima).
--
-- A COMPRA PARCIAL tinha o mesmo buraco: `plan_negotiation_items.included =
-- false` marca o procedimento que o cliente deixou de fora, e a geração criava
-- sessão para ele do mesmo jeito. E a `topup_treatment_sessions` (0140), que
-- completa as sessões de item que não tem nenhuma, devolveria esses itens no
-- carregamento seguinte da ficha — por isso as duas mudam juntas.
--
-- REGRA NOVA (decisão do dono, 07/10/2026):
--   * há negociação ACEITA → as sessões saem do plano e da opção DELA, e só dos
--     procedimentos que o cliente levou;
--   * não há negociação aceita (cliente antigo, fase forçada pelo Admin) →
--     exatamente como era: plano aprovado mais recente, opção aprovada, a
--     principal primeiro.
--
-- Item SEM linha na negociação não é "fora": é procedimento incluído no plano
-- depois (o caso da 0140). Só o `included = false` explícito tira a sessão.
--
-- Só troca o corpo de duas funções. Não altera tabela, não apaga nada, não
-- mexe em sessão que já existe. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ensure_treatment_sessions: a geração inicial (uma vez por cliente, na Fase 5).
-- Igual à 0094, mais a escolha pela negociação aceita.
-- -----------------------------------------------------------------------------
create or replace function public.ensure_treatment_sessions(p_client_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_phase text;
  v_plan uuid;
  v_option uuid;
  v_neg uuid;
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

  -- O QUE O CLIENTE COMPROU: a negociação aceita mais recente, de plano que
  -- continua aprovado. É ela que diz o plano, a opção e os itens.
  select n.id, n.plan_id, n.option_id
    into v_neg, v_plan, v_option
  from public.plan_negotiations n
  join public.treatment_plans tp on tp.id = n.plan_id
  where n.client_id = p_client_id
    and n.status = 'aceita'
    and tp.status = 'approved'
  order by n.updated_at desc nulls last, n.created_at desc
  limit 1;

  -- Sem venda registrada: o caminho de sempre.
  if v_neg is null then
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
  end if;
  if v_option is null then return; end if;

  insert into public.treatment_sessions
    (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
     session_index, session_total, name, planned_minutes,
     stage_name, stage_order, planner_provider_id, join_key, plan_order)
  select p_client_id, v_clinic, v_plan, r.item_id, r.procedure_id,
    r.procedure_name, r.session_index, r.session_total, r.name,
    coalesce(psj.minutes_override, r.planned_minutes),
    r.stage_name, r.stage_order,
    coalesce(psj.provider_override, r.suggested_provider_id),
    psj.group_no::text,
    psj.block_order
  from public.option_session_rows(v_option, v_clinic) r
  left join public.plan_session_joins psj
    on psj.item_id = r.item_id and psj.session_index = r.session_index
  -- Compra parcial: o que o cliente deixou de fora não vira sessão.
  where v_neg is null
     or not exists (
       select 1 from public.plan_negotiation_items ni
       where ni.negotiation_id = v_neg
         and ni.item_id = r.item_id
         and ni.included = false
     );
end $$;

revoke execute on function public.ensure_treatment_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_treatment_sessions(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- topup_treatment_sessions: completa as sessões de item incluído DEPOIS que o
-- tratamento começou. Igual à 0140, com duas diferenças: na falta de sessões,
-- a opção é a da negociação aceita; e item que o cliente deixou de fora
-- continua de fora (sem isto, ela desfaria a correção de cima).
-- -----------------------------------------------------------------------------
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
  v_neg uuid;
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

  -- ⚠️ O MESMO PLANO DA GERAÇÃO INICIAL. Com dois planos aprovados, o cliente
  -- pode ter comprado o mais ANTIGO: a geração (acima) usa o plano da venda, e
  -- esta função usava sempre o mais recente — completaria as sessões de um
  -- plano que ninguém comprou. Então: se o plano mais recente não tem sessão
  -- nenhuma e existe venda aceita, o plano em execução é o da venda. Quando o
  -- mais recente já tem sessões, nada muda em relação à 0140.
  if not exists (
    select 1 from public.treatment_sessions ts
    where ts.client_id = p_client_id and ts.plan_id = v_plan
  ) then
    select n.plan_id into v_plan
    from public.plan_negotiations n
    join public.treatment_plans tp on tp.id = n.plan_id
    where n.client_id = p_client_id
      and n.status = 'aceita'
      and tp.status = 'approved'
    order by n.updated_at desc nulls last, n.created_at desc
    limit 1;
    -- Sem venda aceita: volta ao plano aprovado mais recente, como sempre.
    if v_plan is null then
      select id into v_plan from public.treatment_plans
      where client_id = p_client_id and status = 'approved'
      order by created_at desc limit 1;
    end if;
  end if;

  -- Opção executada: a que já tem sessões; senão a COMPRADA; senão a
  -- aprovada/principal.
  select o.id into v_option from public.treatment_plan_options o
  where o.plan_id = v_plan
    and exists (
      select 1 from public.treatment_plan_option_items i
      join public.treatment_sessions ts on ts.item_id = i.id
      where i.option_id = o.id
    )
  order by o.is_primary desc, o.sort_order asc limit 1;
  if v_option is null then
    select n.option_id into v_option
    from public.plan_negotiations n
    where n.client_id = p_client_id
      and n.plan_id = v_plan
      and n.status = 'aceita'
    order by n.updated_at desc nulls last, n.created_at desc
    limit 1;
  end if;
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

  -- A venda desta opção, se houver: é ela que diz o que ficou de fora.
  select n.id into v_neg
  from public.plan_negotiations n
  where n.client_id = p_client_id
    and n.option_id = v_option
    and n.status = 'aceita'
  order by n.updated_at desc nulls last, n.created_at desc
  limit 1;

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
      -- Compra parcial: o que o cliente deixou de fora não ganha sessão.
      and (
        v_neg is null
        or not exists (
          select 1 from public.plan_negotiation_items ni
          where ni.negotiation_id = v_neg
            and ni.item_id = i.id
            and ni.included = false
        )
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

revoke execute on function public.topup_treatment_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.topup_treatment_sessions(uuid) to authenticated;
