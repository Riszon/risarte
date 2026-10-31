-- =============================================================================
-- 0339 — A prioridade de cada procedimento: rápida e obrigatória no envio
-- -----------------------------------------------------------------------------
-- Pedido do dono (31/10/2026). Cada nota gravava e recarregava a ficha; agora a
-- lista "Prioridades" grava por trás, e a prioridade é exigida para enviar.
--
-- 1) `gut_repeated`: a nota veio de outro item igual do plano e o Planner ainda
--    não a confirmou. Nota dada por ele nunca é sobrescrita; a repetida acompanha
--    a origem (um clique errado se corrige em todos os iguais).
-- 2) `set_plan_item_priority`: a porta de gravar. Exige as TRÊS notas e o plano
--    editável, e repete para os iguais do plano.
-- 3) Item novo já nasce com a nota de um igual do plano (por gatilho: vale para
--    o lançamento avulso, por dente e por grupo).
-- 4) `plan_item_lock`: a prioridade passa a trancar com o plano. Sem isso, a API
--    deixaria apagar a nota depois do envio, que agora a exige.
-- 5) `submit_treatment_plan`: GUT_REQUIRED em todos os itens de todas as opções.
-- Idempotente.
-- =============================================================================

-- 1) A marca da nota repetida -----------------------------------------------------
alter table public.treatment_plan_option_items
  add column if not exists gut_repeated boolean not null default false;

-- 2) A porta de gravar ------------------------------------------------------------
create or replace function public.set_plan_item_priority(
  p_item uuid,
  p_gravity integer,
  p_urgency integer,
  p_tendency integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano uuid;
  v_clinica uuid;
  v_procedimento uuid;
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not (public.is_owner() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_gravity is null or p_urgency is null or p_tendency is null
     or p_gravity not between 1 and 5
     or p_urgency not between 1 and 5
     or p_tendency not between 1 and 5 then
    raise exception 'INVALID_PRIORITY';
  end if;

  select o.plan_id, i.clinic_id, i.procedure_id
    into v_plano, v_clinica, v_procedimento
    from public.treatment_plan_option_items i
    join public.treatment_plan_options o on o.id = i.option_id
   where i.id = p_item;
  if v_plano is null then raise exception 'ITEM_NOT_FOUND'; end if;

  -- A mesma régua de quem lança item no plano (0312).
  if not public.is_owner()
     and v_clinica not in (select public.user_full_access_clinic_ids()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not public._plan_is_editable(v_plano) then
    raise exception 'PLAN_LOCKED';
  end if;

  update public.treatment_plan_option_items
     set gut_gravity = p_gravity,
         gut_urgency = p_urgency,
         gut_tendency = p_tendency,
         gut_repeated = false
   where id = p_item;

  -- Os iguais do plano: só quem está sem nota ou com nota ainda repetida.
  if v_procedimento is not null then
    update public.treatment_plan_option_items i
       set gut_gravity = p_gravity,
           gut_urgency = p_urgency,
           gut_tendency = p_tendency,
           gut_repeated = true
      from public.treatment_plan_options o
     where o.id = i.option_id
       and o.plan_id = v_plano
       and i.procedure_id = v_procedimento
       and i.id <> p_item
       and (i.gut_repeated
            or i.gut_gravity is null or i.gut_urgency is null or i.gut_tendency is null);
  end if;

  update public.treatment_plans set updated_at = now() where id = v_plano;
end;
$$;
revoke execute on function public.set_plan_item_priority(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.set_plan_item_priority(uuid, integer, integer, integer)
  to authenticated;

-- 3) O item novo aproveita a nota de um igual do plano ----------------------------
create or replace function public.plan_item_repeat_priority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g smallint;
  v_u smallint;
  v_t smallint;
begin
  if new.procedure_id is null
     or new.gut_gravity is not null or new.gut_urgency is not null or new.gut_tendency is not null then
    return new;
  end if;
  -- A nota que o Planner deu vem antes da que já é repetida.
  select i.gut_gravity, i.gut_urgency, i.gut_tendency
    into v_g, v_u, v_t
    from public.treatment_plan_option_items i
    join public.treatment_plan_options o on o.id = i.option_id
    join public.treatment_plan_options este on este.id = new.option_id
   where o.plan_id = este.plan_id
     and i.procedure_id = new.procedure_id
     and i.gut_gravity is not null and i.gut_urgency is not null and i.gut_tendency is not null
   order by i.gut_repeated, i.sort_order desc
   limit 1;
  if v_g is not null then
    new.gut_gravity := v_g;
    new.gut_urgency := v_u;
    new.gut_tendency := v_t;
    new.gut_repeated := true;
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_item_repeat_priority() from public, anon, authenticated;
drop trigger if exists plan_item_repeat_priority_trg on public.treatment_plan_option_items;
create trigger plan_item_repeat_priority_trg
  before insert on public.treatment_plan_option_items
  for each row execute function public.plan_item_repeat_priority();

-- 4) A prioridade tranca com o plano ----------------------------------------------
-- Mesma função da 0311; o que muda é a lista das colunas que não mudam mais.
create or replace function public.plan_item_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_opcao uuid := case when tg_op = 'DELETE' then old.option_id else new.option_id end;
  v_plano uuid;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select plan_id into v_plano from public.treatment_plan_options where id = v_opcao;
  if not public._plan_is_editable(v_plano) then
    -- Indicar o profissional segue livre: não muda o que foi aprovado nem o preço.
    if tg_op = 'UPDATE'
       and (new.option_id, new.procedure_id, new.description, new.quantity, new.unit_price_cents,
            new.planned_sessions, new.planned_total_minutes, new.stage_id, new.tooth_code,
            new.face_codes, new.region_code, new.situation_override_reason, new.sort_order,
            new.gut_gravity, new.gut_urgency, new.gut_tendency, new.gut_repeated)
           is not distinct from
           (old.option_id, old.procedure_id, old.description, old.quantity, old.unit_price_cents,
            old.planned_sessions, old.planned_total_minutes, old.stage_id, old.tooth_code,
            old.face_codes, old.region_code, old.situation_override_reason, old.sort_order,
            old.gut_gravity, old.gut_urgency, old.gut_tendency, old.gut_repeated) then
      return new;
    end if;
    raise exception 'PLAN_LOCKED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.plan_item_lock() from public, anon, authenticated;

-- 5) O envio exige a prioridade ---------------------------------------------------
-- Mesma função da 0337; muda só a trava GUT_REQUIRED.
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

  -- 0339: todo procedimento de toda opção vai com as três notas de prioridade.
  if exists (
    select 1
      from public.treatment_plan_option_items i
      join public.treatment_plan_options o on o.id = i.option_id
     where o.plan_id = p_plan_id
       and (i.gut_gravity is null or i.gut_urgency is null or i.gut_tendency is null)
  ) then
    raise exception 'GUT_REQUIRED';
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
