-- =============================================================================
-- 0313 — ODONTOGRAMA OD4: VALIDADE DO ORÇAMENTO E A NEGOCIAÇÃO DO PLANO
-- SUBSTITUÍDO
--
-- Plano e decisões do dono em docs/odontograma/OD4-PLANO.md (20/10/2026):
--   * G2: o orçamento impresso vale 15 dias por padrão — configurável pelo
--     Admin na regra comercial (rede → unidade).
--   * O furo achado no levantamento (segue a F2 da OD3, não muda regra):
--     quando a NOVA versão do plano é aprovada e a anterior fica substituída,
--     a negociação AINDA ABERTA da anterior é encerrada ("substituída") — o
--     Consultor recomeça na nova. Negociação ACEITA (venda) não é tocada.
--     E as sessões, quando não há venda, não saem mais de plano substituído.
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- 1) G2: a validade do orçamento (dias), na regra comercial em cascata ----------
alter table public.commercial_rules
  add column if not exists budget_validity_days integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commercial_rules_budget_validity_check') then
    alter table public.commercial_rules
      add constraint commercial_rules_budget_validity_check
      check (budget_validity_days is null or budget_validity_days between 1 and 365);
  end if;
end $$;

-- 2) A negociação ganha a situação "substituída" ---------------------------------
alter table public.plan_negotiations
  drop constraint if exists plan_negotiations_status_check;
alter table public.plan_negotiations
  add constraint plan_negotiations_status_check
  check (status in ('em_negociacao', 'aguardando_autorizacao', 'aceita',
                    'devolvida', 'perdida', 'cancelada', 'substituida'));

-- 3) Plano substituído encerra a negociação ABERTA dele (a vendida fica) --------
create or replace function public.treatment_plan_supersede_negotiation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versao integer;
  v_code text;
begin
  if new.superseded_at is not null and old.superseded_at is null then
    select version_no into v_versao from public.treatment_plans where id = new.superseded_by_plan_id;
    update public.plan_negotiations
       set status = 'substituida',
           updated_at = now(),
           notes = concat_ws(E'\n', nullif(btrim(coalesce(notes, '')), ''),
                             'Encerrada: o plano foi substituído pela versão '
                             || coalesce(v_versao::text, 'nova') || ' em '
                             || to_char(public.today_br(), 'DD/MM/YYYY') || '.')
     where plan_id = new.id
       and status in ('em_negociacao', 'aguardando_autorizacao', 'devolvida')
    returning coalesce(code, '(sem código)') into v_code;
    -- A linha do tempo do plano conta o que aconteceu (mesmo padrão da 0208).
    if found then
      perform public.log_plan_event(
        new.id, new.clinic_id, 'negociacao_substituida',
        'Negociação encerrada: o plano foi substituído pela versão '
          || coalesce(v_versao::text, 'nova') || ' — ' || v_code);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.treatment_plan_supersede_negotiation() from public, anon, authenticated;
drop trigger if exists treatment_plan_supersede_negotiation_trg on public.treatment_plans;
create trigger treatment_plan_supersede_negotiation_trg
  after update of superseded_at on public.treatment_plans
  for each row execute function public.treatment_plan_supersede_negotiation();

-- 4) Sessões: sem venda, NÃO saem de plano substituído --------------------------
-- Mesmas funções da 0286; muda só o caminho "sem venda registrada" (o plano
-- aprovado mais recente passa a ser o que NÃO foi substituído). Com venda
-- aceita, nada muda: o que foi vendido vale.
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

  -- Sem venda registrada: o plano aprovado mais recente QUE VALE (OD4).
  if v_neg is null then
    select id into v_plan from public.treatment_plans
    where client_id = p_client_id and status = 'approved' and superseded_at is null
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

  -- OD4: o plano aprovado mais recente QUE VALE (não substituído).
  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved' and superseded_at is null
  order by created_at desc limit 1;
  -- Só substituídos: o plano em execução é o da venda (abaixo).
  if v_plan is null then
    select n.plan_id into v_plan
    from public.plan_negotiations n
    join public.treatment_plans tp on tp.id = n.plan_id
    where n.client_id = p_client_id
      and n.status = 'aceita'
      and tp.status = 'approved'
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
    order by n.updated_at desc nulls last, n.created_at desc
    limit 1;
    -- Sem venda aceita: volta ao plano aprovado mais recente que vale.
    if v_plan is null then
      select id into v_plan from public.treatment_plans
      where client_id = p_client_id and status = 'approved' and superseded_at is null
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
