-- =============================================================================
-- 0358 — O PLANO COMPLEMENTAR, PASSO 3: AS SESSÕES DO COMPLEMENTO VENDIDO (AP64)
--
-- Decisão do dono (03/11/2026), AP64 (docs/comercial/AP63-AP64-PLANO.md §3, item
-- 5): "a venda do complemento gera SÓ as sessões dele. As sessões, cobranças,
-- repasses e o painel de fechamento da venda original seguem iguais."
--
-- O DEFEITO QUE ISTO EVITA: `topup_treatment_sessions` (0337) e
-- `ensure_treatment_sessions` (0313) escolhem UM plano — o aprovado mais novo,
-- ou o da venda aceita mais recente. Com um complemento vendido, os dois
-- passariam a escolher o COMPLEMENTO, e as sessões do plano original deixariam
-- de ser completadas.
--
-- O que muda:
--   1) `_generate_complement_sessions` (interna): para cada complemento VENDIDO
--      (negociação aceita, venda fechada, não cancelada), gera as sessões dos
--      itens comprados que ainda não têm nenhuma — pela mesma
--      `option_session_rows` da geração inicial, com a sequência do Planner
--      (`plan_session_joins`). Idempotente.
--   2) Gatilho na venda: ao fechar a venda de um complemento, as sessões nascem
--      na hora e o complemento fica "aceito". Nunca derruba o fechamento.
--   3) `topup_treatment_sessions` chama a (1) e, no resto, nunca escolhe um
--      complemento; `ensure_treatment_sessions` também não.
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1) As sessões dos complementos vendidos ----------------------------------------
create or replace function public._generate_complement_sessions(p_client_id uuid, p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_n integer := 0;
  v_k integer;
begin
  for v_c in
    select n.id as neg_id, n.plan_id, n.option_id
    from public.plan_negotiations n
    join public.treatment_plans tp on tp.id = n.plan_id
    join public.commercial_sales s on s.negotiation_id = n.id
    where n.client_id = p_client_id
      and n.status = 'aceita'
      and tp.status = 'approved'
      and tp.complement_of_plan_id is not null
      and s.closed_at is not null
      and s.cancelled_at is null
  loop
    insert into public.treatment_sessions
      (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
       session_index, session_total, name, planned_minutes,
       stage_name, stage_order, planner_provider_id, join_key, plan_order)
    select p_client_id, p_clinic_id, v_c.plan_id, r.item_id, r.procedure_id,
      r.procedure_name, r.session_index, r.session_total, r.name,
      coalesce(psj.minutes_override, r.planned_minutes),
      r.stage_name, r.stage_order,
      coalesce(psj.provider_override, r.suggested_provider_id),
      psj.group_no::text,
      psj.block_order
    from public.option_session_rows(v_c.option_id, p_clinic_id) r
    left join public.plan_session_joins psj
      on psj.item_id = r.item_id and psj.session_index = r.session_index
    -- Só o item que ainda não tem sessão (idempotente) e que foi comprado.
    where not exists (select 1 from public.treatment_sessions ts where ts.item_id = r.item_id)
      and not exists (
        select 1 from public.plan_negotiation_items ni
        where ni.negotiation_id = v_c.neg_id
          and ni.item_id = r.item_id
          and ni.included = false
      );
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public._generate_complement_sessions(uuid, uuid) from public, anon, authenticated;

-- 2) Ao fechar a venda de um complemento: as sessões e a situação ----------------
create or replace function public.commercial_sale_complement_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closed_at is null or old.closed_at is not null then return new; end if;
  if not exists (
    select 1 from public.treatment_plans tp
    where tp.id = new.plan_id and tp.complement_of_plan_id is not null
  ) then
    return new;
  end if;
  begin
    perform public._generate_complement_sessions(new.client_id, new.clinic_id);
    update public.treatment_plans
       set lifecycle = 'aceito', updated_at = now()
     where id = new.plan_id
       and (lifecycle is null or lifecycle in ('aguardando_apresentacao', 'apresentado'));
  exception when others then
    -- Nunca derruba o fechamento: o "abrir a ficha" (topup) gera depois.
    raise warning 'commercial_sale_complement_sessions (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.commercial_sale_complement_sessions() from public, anon, authenticated;
drop trigger if exists commercial_sale_complement_sessions_trg on public.commercial_sales;
create trigger commercial_sale_complement_sessions_trg
  after update of closed_at on public.commercial_sales
  for each row execute function public.commercial_sale_complement_sessions();

-- 3) A geração normal nunca escolhe o complemento ---------------------------------
-- A definição em vigor (0337), com as trocas marcadas "AP64 (0358)".
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
  v_phase text;
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

  -- OC-00005: sessão do PLANO só existe depois da venda. Antes da Fase 5 não se
  -- gera nada, mesmo com o plano aprovado (a venda direta cria as dela à parte).
  if v_phase not in ('treatment_start', 'reevaluation', 'follow_up') then
    return;
  end if;

  -- AP64 (0358): as sessões dos planos COMPLEMENTARES vendidos, cada um com as
  -- suas. Antes do resto porque o resto escolhe UM plano e sai cedo.
  perform public._generate_complement_sessions(p_client_id, v_clinic);

  -- OD4: o plano aprovado mais recente QUE VALE (não substituído).
  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved' and superseded_at is null
    and complement_of_plan_id is null  -- AP64 (0358)
  order by created_at desc limit 1;
  -- Só substituídos: o plano em execução é o da venda (abaixo).
  if v_plan is null then
    select n.plan_id into v_plan
    from public.plan_negotiations n
    join public.treatment_plans tp on tp.id = n.plan_id
    where n.client_id = p_client_id
      and n.status = 'aceita'
      and tp.status = 'approved'
      and tp.complement_of_plan_id is null  -- AP64 (0358)
    order by n.updated_at desc nulls last, n.created_at desc
    limit 1;
  end if;
  if v_plan is null then return; end if;

  -- ⚠️ O MESMO PLANO DA GERAÇÃO INICIAL (0286). Se o plano escolhido não tem
  -- sessão nenhuma e existe venda aceita, o plano em execução é o da venda.
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
      and tp.complement_of_plan_id is null  -- AP64 (0358)
    order by n.updated_at desc nulls last, n.created_at desc
    limit 1;
    -- Sem venda aceita: volta ao plano aprovado mais recente que vale.
    if v_plan is null then
      select id into v_plan from public.treatment_plans
      where client_id = p_client_id and status = 'approved' and superseded_at is null
        and complement_of_plan_id is null  -- AP64 (0358)
      order by created_at desc limit 1;
    end if;
  end if;
  if v_plan is null then return; end if;

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
           i.planned_total_minutes, i.suggested_provider_id,
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
             stage_name, stage_order, planner_provider_id, join_key, plan_order)
          select
             p_client_id, v_clinic, v_plan, v_item.item_id, v_item.procedure_id,
             v_item.proc_name, v_idx, v_total,
             coalesce(nullif(v_proto.name, ''),
                      'Sessão ' || v_idx || ' de ' || v_total),
             coalesce(psj.minutes_override, nullif(v_proto.estimated_minutes, 0)),
             v_item.stage_name, v_item.stage_order,
             coalesce(psj.provider_override, v_item.suggested_provider_id),
             psj.group_no::text, psj.block_order
          from (select 1) as uma_linha
          left join public.plan_session_joins psj
            on psj.item_id = v_item.item_id and psj.session_index = v_idx;
        end loop;
      end loop;
    else
      insert into public.treatment_sessions
        (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
         session_index, session_total, name, planned_minutes,
         stage_name, stage_order, planner_provider_id, join_key, plan_order)
      select p_client_id, v_clinic, v_plan, v_item.item_id, v_item.procedure_id,
        v_item.proc_name, gs.idx, v_item.planned_sessions,
        'Sessão ' || gs.idx || ' de ' || v_item.planned_sessions,
        coalesce(psj.minutes_override, case
          when v_item.planned_sessions > 0 and v_item.planned_total_minutes is not null
          then round(v_item.planned_total_minutes::numeric / v_item.planned_sessions)::int
          else null
        end),
        v_item.stage_name, v_item.stage_order,
        coalesce(psj.provider_override, v_item.suggested_provider_id),
        psj.group_no::text, psj.block_order
      from generate_series(1, v_item.planned_sessions) as gs(idx)
      left join public.plan_session_joins psj
        on psj.item_id = v_item.item_id and psj.session_index = gs.idx;
    end if;
  end loop;
end;
$$;

revoke execute on function public.topup_treatment_sessions(uuid) from public, anon, authenticated;
grant execute on function public.topup_treatment_sessions(uuid) to authenticated;

-- A definição em vigor (0313), com as trocas marcadas "AP64 (0358)".
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
    and tp.complement_of_plan_id is null  -- AP64 (0358): o complemento tem as dele
  order by n.updated_at desc nulls last, n.created_at desc
  limit 1;

  -- Sem venda registrada: o plano aprovado mais recente QUE VALE (OD4).
  if v_neg is null then
    select id into v_plan from public.treatment_plans
    where client_id = p_client_id and status = 'approved' and superseded_at is null
      and complement_of_plan_id is null  -- AP64 (0358)
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

revoke execute on function public.ensure_treatment_sessions(uuid) from public, anon, authenticated;
grant execute on function public.ensure_treatment_sessions(uuid) to authenticated;

-- Conferência (só leitura) ------------------------------------------------------
select
  to_regprocedure('public._generate_complement_sessions(uuid, uuid)') is not null as geracao_existe,
  (select count(*) from pg_trigger
    where tgname = 'commercial_sale_complement_sessions_trg' and not tgisinternal) as gatilho_esperado_1,
  position('_generate_complement_sessions' in pg_get_functiondef('public.topup_treatment_sessions(uuid)'::regprocedure)) > 0
    and position('complement_of_plan_id is null' in pg_get_functiondef('public.ensure_treatment_sessions(uuid)'::regprocedure)) > 0
    as geracao_normal_pula_o_complemento,
  has_function_privilege('anon', 'public._generate_complement_sessions(uuid, uuid)', 'execute') as sem_login_esperado_false;
