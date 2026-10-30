-- =============================================================================
-- 0337 — A SEQUÊNCIA PASSA A SER PARTE DO PLANO (OC-00005, OC-00009, OC-00010)
--
-- Causas confirmadas na produção (30/10/2026):
--   OC-00005 — `topup_treatment_sessions` não conferia a fase: abrir a ficha
--     gerava as sessões de um plano só aprovado, sem venda (19 sessões num
--     cliente em Conversão Comercial, sem negociação).
--   OC-00009 — a tela abria a janela no plano substituído (corrigido no código);
--     a configuração do plano certo estava gravada. Mas as sessões geradas antes
--     da hora não levavam a sequência, e a nova versão do plano não a copiava.
--   OC-00010 — nada exigia a sequência no envio, e o Coordenador não a enxergava.
--
-- Decisões do dono (30/10/2026, todas como recomendado):
--   SQ1 — "configurada" = o Planner clica em Confirmar, opção por opção. Entrou,
--         saiu ou mudou a quantidade de um procedimento: volta a ficar pendente.
--   SQ3 — Coordenador e Consultor VEEM; quem altera é o Planner (o Coordenador
--         devolve o plano com a observação).
--   SQ4 — apagar só as sessões geradas antes da hora e nunca usadas.
--
-- Idempotente.
-- =============================================================================

-- 1) A confirmação, por opção --------------------------------------------------
-- Sem ligação com `profiles` de propósito: uma 2ª ligação tornaria ambíguos os
-- embeds que já existem (lição da 0281). A trilha de auditoria guarda o autor.
alter table public.treatment_plan_options
  add column if not exists sequence_confirmed_at timestamptz,
  add column if not exists sequence_confirmed_by uuid;

-- 2) Plano enviado, aprovado ou substituído não muda a sequência ----------------
-- `security invoker` de propósito (como `plan_item_lock`, 0311): só vale para
-- quem vem pela API. A exclusão em cascata e as funções do banco passam.
create or replace function public.plan_session_joins_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item uuid := case when tg_op = 'DELETE' then old.item_id else new.item_id end;
  v_plano uuid;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select o.plan_id into v_plano
    from public.treatment_plan_option_items i
    join public.treatment_plan_options o on o.id = i.option_id
   where i.id = v_item;
  -- Plano que não se consegue ler conta como trancado.
  if v_plano is null or not public._plan_is_editable(v_plano) then
    raise exception 'PLAN_LOCKED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.plan_session_joins_lock() from public, anon, authenticated;
grant execute on function public.plan_session_joins_lock() to authenticated;
drop trigger if exists plan_session_joins_lock on public.plan_session_joins;
create trigger plan_session_joins_lock
  before insert or update or delete on public.plan_session_joins
  for each row execute function public.plan_session_joins_lock();

-- 3) Mudou o que vira sessão: a confirmação cai --------------------------------
create or replace function public.plan_item_clears_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.treatment_plan_options
     set sequence_confirmed_at = null, sequence_confirmed_by = null
   where id = case when tg_op = 'DELETE' then old.option_id else new.option_id end
     and sequence_confirmed_at is not null;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.plan_item_clears_sequence() from public, anon, authenticated;
drop trigger if exists plan_item_clears_sequence on public.treatment_plan_option_items;
create trigger plan_item_clears_sequence
  after insert or delete on public.treatment_plan_option_items
  for each row execute function public.plan_item_clears_sequence();
drop trigger if exists plan_item_clears_sequence_upd on public.treatment_plan_option_items;
create trigger plan_item_clears_sequence_upd
  after update of procedure_id, quantity, planned_sessions on public.treatment_plan_option_items
  for each row
  when ((old.procedure_id, old.quantity, old.planned_sessions)
        is distinct from (new.procedure_id, new.quantity, new.planned_sessions))
  execute function public.plan_item_clears_sequence();

-- 4) Confirmar -----------------------------------------------------------------
create or replace function public.confirm_option_sequence(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano uuid;
  v_clinica uuid;
begin
  -- D6: quem monta o plano (o titular ou o Planner).
  if (select auth.uid()) is null or not (public.is_owner() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  select o.plan_id, c.clinic_id into v_plano, v_clinica
    from public.treatment_plan_options o
    join public.treatment_plans tp on tp.id = o.plan_id
    join public.clients c on c.id = tp.client_id
   where o.id = p_option_id;
  if v_plano is null then raise exception 'OPTION_NOT_FOUND'; end if;
  if not public._plan_is_editable(v_plano) then raise exception 'PLAN_LOCKED'; end if;
  -- Toda sessão projetada tem de ter a sua posição gravada.
  if exists (
    select 1 from public.option_session_rows(p_option_id, v_clinica) r
    left join public.plan_session_joins psj
      on psj.item_id = r.item_id and psj.session_index = r.session_index
    where psj.block_order is null
  ) then
    raise exception 'SEQUENCE_INCOMPLETE';
  end if;
  update public.treatment_plan_options
     set sequence_confirmed_at = now(), sequence_confirmed_by = (select auth.uid())
   where id = p_option_id;
end;
$$;
revoke execute on function public.confirm_option_sequence(uuid) from public, anon, authenticated;
grant execute on function public.confirm_option_sequence(uuid) to authenticated;

-- 5) O Coordenador e o Consultor passam a ler a sequência (SQ3) -----------------
create or replace function public.project_option_sessions(p_option_id uuid)
returns table (
  item_id uuid, session_index int, procedure_name text, name text,
  planned_minutes int, group_no int, block_order int, provider_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
declare v_clinic uuid;
begin
  select c.clinic_id into v_clinic
  from public.treatment_plan_options o
  join public.treatment_plans tp on tp.id = o.plan_id
  join public.clients c on c.id = tp.client_id
  where o.id = p_option_id;
  if v_clinic is null then return; end if;

  if not (
    public.is_admin_master()
    or public.is_planner()
    or public.has_role_in_clinic(
         v_clinic,
         array['clinical_coordinator', 'commercial_consultant']::public.user_role[]
       )
  ) then
    return;
  end if;

  return query
  select r.item_id, r.session_index, r.procedure_name, r.name,
         coalesce(psj.minutes_override, r.planned_minutes) as planned_minutes,
         psj.group_no,
         psj.block_order,
         coalesce(psj.provider_override, r.suggested_provider_id) as provider_id
  from public.option_session_rows(p_option_id, v_clinic) r
  left join public.plan_session_joins psj
    on psj.item_id = r.item_id and psj.session_index = r.session_index
  order by coalesce(psj.block_order, 9999), r.procedure_name, r.session_index;
end $$;
revoke execute on function public.project_option_sessions(uuid) from public, anon, authenticated;
grant execute on function public.project_option_sessions(uuid) to authenticated;

-- 6) O envio exige a sequência confirmada (mesma função da 0325) ----------------
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
  v_superseded timestamptz;
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.diagnosis, tp.superseded_at
    into v_client, v_clinic, v_diagnosis, v_superseded
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  -- D6: o titular ou o Planner (o Admin que não é o titular só vê).
  if v_user is null or not (public.is_owner() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_superseded is not null then raise exception 'PLAN_SUPERSEDED'; end if;

  select journey_phase, full_name into v_phase, v_name
  from public.clients where id = v_client;
  if v_phase <> 'planning_center' then raise exception 'WRONG_PHASE'; end if;

  if coalesce(btrim(v_diagnosis), '') = '' then
    raise exception 'DIAGNOSIS_REQUIRED';
  end if;

  -- E2: o plano se monta sobre o diagnóstico DEFINIDO.
  if exists (select 1 from public.tooth_findings
              where client_id = v_client and status = 'suggested') then
    raise exception 'DIAGNOSIS_PENDING_SUGGESTIONS';
  end if;
  if not exists (select 1 from public.clinical_evaluations
                  where client_id = v_client and diagnosis_finalized_at is not null) then
    raise exception 'DIAGNOSIS_NOT_FINALIZED';
  end if;

  select count(*) into v_options
  from public.treatment_plan_options where plan_id = p_plan_id;
  if v_options = 0 then raise exception 'OPTIONS_REQUIRED'; end if;

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

  if exists (
    select 1
      from public.treatment_plan_option_items i
      join public.treatment_plan_options o on o.id = i.option_id
      join public.procedure_dental_rules r on r.procedure_id = i.procedure_id
     where o.plan_id = p_plan_id
       and r.application_level <> 'none'
       and i.tooth_code is null and i.region_code is null
  ) then
    raise exception 'ITEM_LOCATION_REQUIRED';
  end if;

  -- OC-00010: toda opção do plano vai com os atendimentos e a sequência
  -- CONFIRMADOS pelo Planner.
  if exists (
    select 1 from public.treatment_plan_options o
     where o.plan_id = p_plan_id and o.sequence_confirmed_at is null
  ) then
    raise exception 'SEQUENCE_REQUIRED';
  end if;

  -- F3: o preço de cada item é o do catálogo NO DIA DO ENVIO — e, desde a
  -- 0325, ajustado pelo pacote do grupo da etiqueta (GP4).
  update public.treatment_plan_option_items i
     set unit_price_cents = public.group_adjusted_price(
           public.catalog_price_for(i.clinic_id, i.procedure_id),
           public.plan_item_group_percent(i.procedure_group_id, i.procedure_id)),
         list_price_cents = case
           when public.plan_item_group_percent(i.procedure_group_id, i.procedure_id) <> 0
           then public.catalog_price_for(i.clinic_id, i.procedure_id)
         end
    from public.treatment_plan_options o
   where o.id = i.option_id
     and o.plan_id = p_plan_id
     and i.procedure_id is not null;

  update public.treatment_plan_options
    set review_status = 'pending', reviewed_by = null, reviewed_at = null,
        review_notes = null
  where plan_id = p_plan_id;

  update public.treatment_plans
    set status = 'submitted', submitted_at = now(), updated_at = now(),
        reviewed_by = null, reviewed_at = null, review_notes = null,
        prices_frozen_at = now()
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
revoke execute on function public.submit_treatment_plan(uuid) from public, anon, authenticated;
grant execute on function public.submit_treatment_plan(uuid) to authenticated;

-- 7) As sessões complementares: só depois da venda, com a sequência -------------
-- Mesma função da 0313; mudam a guarda da fase e as colunas da configuração.
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

revoke execute on function public.topup_treatment_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.topup_treatment_sessions(uuid) to authenticated;

-- 8) As sessões geradas antes da hora -------------------------------------------
-- SQ4: só de plano (a venda direta não tem plano), de cliente antes da Fase 5 e
-- sem venda aceita, e só se NENHUMA sessão daquele plano tiver sido usada. Sessão
-- com agendamento, realizada, com repasse ou resultado de atendimento fica.
-- DESTRUTIVO: apaga sessões nunca usadas, geradas por engano (OC-00005; autorizado pelo dono em 30/10/2026). Ao vender, elas nascem de novo, com a sequência.
delete from public.treatment_sessions ts
 using public.clients c
 where c.id = ts.client_id
   and ts.plan_id is not null
   and c.journey_phase not in ('treatment_start', 'reevaluation', 'follow_up')
   and not exists (
     select 1 from public.plan_negotiations n
      where n.client_id = c.id and n.status = 'aceita'
   )
   and not exists (
     select 1 from public.treatment_sessions u
      where u.plan_id = ts.plan_id
        and (
          u.appointment_id is not null
          or u.status <> 'pending'
          or u.done_at is not null
          or exists (select 1 from public.appointments a where a.treatment_session_id = u.id)
          or exists (select 1 from public.attendance_session_outcomes x where x.session_id = u.id)
          or exists (select 1 from public.provider_payouts p where p.session_id = u.id)
          or exists (select 1 from public.tooth_findings f where f.treatment_session_id = u.id)
        )
   );
