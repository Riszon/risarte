-- =============================================================================
-- 0325 — O PREÇO DO GRUPO DE PROCEDIMENTOS (pedido do dono, 27/10/2026)
-- Plano e decisões GP4–GP6: docs/procedimentos/GRUPOS-PLANO.md §6
--
-- A 0324 nasceu com o grupo SEM preço (atalho de lançamento). O dono pediu
-- desconto ou acréscimo no pacote. As decisões:
--
--   GP4: vale NO PLANO — o item lançado pelo grupo já entra com o preço do
--        pacote; o Coordenador aprova vendo esse preço, e o Comercial negocia a
--        partir dele com o desconto e o teto de sempre.
--   GP5: o grupo guarda o PERCENTUAL (negativo = desconto, positivo =
--        acréscimo). Vale para qualquer quantidade de dentes e acompanha o
--        catálogo: o preço de cada item continua sendo o do catálogo, ajustado.
--   GP6: o paciente vê "de … por …" no orçamento e na apresentação (o item
--        guarda o preço de tabela ao lado do preço do pacote).
--
-- O que NÃO muda: o Planner continua sem escolher preço (OC-00067) — quem
-- define o percentual do pacote é o Admin Master, como o preço do catálogo
-- (OC-00068). O repasse ao dentista é fixo: o desconto sai da margem.
--
-- Idempotente.
-- =============================================================================

-- 1) Colunas -------------------------------------------------------------------
alter table public.procedure_groups
  add column if not exists price_adjust_percent numeric(5,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'procedure_groups_price_adjust_chk') then
    alter table public.procedure_groups
      add constraint procedure_groups_price_adjust_chk
      check (price_adjust_percent > -100 and price_adjust_percent <= 100);
  end if;
end $$;

-- O preço de TABELA do item quando o pacote mudou o preço (o "de …"). Nulo =
-- o item não tem ajuste de pacote: o preço dele é o de tabela.
alter table public.treatment_plan_option_items
  add column if not exists list_price_cents integer
  check (list_price_cents is null or list_price_cents >= 0);

-- 2) A conta (uma só, usada pela trava do item e pelo envio do plano) ----------
-- Meio para cima, como todo dinheiro da rede: `round` de numeric arredonda o
-- meio para longe do zero, e preço nunca é negativo.
create or replace function public.group_adjusted_price(p_price integer, p_percent numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_price is null then null
    when coalesce(p_percent, 0) = 0 then p_price
    else round(p_price::numeric * (100 + p_percent) / 100)::integer
  end;
$$;

-- O percentual do pacote que vale para ESTE procedimento: só quando ele está
-- no grupo da etiqueta (a etiqueta cai, na 0324, quando não está).
create or replace function public.plan_item_group_percent(p_group uuid, p_procedure uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select g.price_adjust_percent
      from public.procedure_groups g
      join public.procedure_group_items gi on gi.group_id = g.id
     where g.id = p_group and gi.procedure_id = p_procedure
  ), 0);
$$;

revoke execute on function public.group_adjusted_price(integer, numeric) from public, anon, authenticated;
revoke execute on function public.plan_item_group_percent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.group_adjusted_price(integer, numeric) to authenticated;
grant execute on function public.plan_item_group_percent(uuid, uuid) to authenticated;

-- 3) A trava do item (0306) passa a conhecer o pacote ----------------------------
-- ⚠️ SEM `security definer` DE PROPÓSITO (0306): com ele, `current_user` seria
-- sempre o dono e a trava nunca valeria.
create or replace function public.plan_item_catalog_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tabela integer;
  v_pct numeric;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.procedure_id is null then
      raise exception 'CATALOG_ITEM_REQUIRED';
    end if;
    -- O nome e o preço são os do catálogo — o que a tela mandou não vale.
    select p.name into new.description from public.procedures p where p.id = new.procedure_id;
    if new.description is null then raise exception 'PROCEDURE_NOT_FOUND'; end if;
    v_tabela := coalesce(public.catalog_price_for(new.clinic_id, new.procedure_id), 0);
    -- 0325 (GP4): lançado pelo grupo, entra com o preço do pacote.
    v_pct := public.plan_item_group_percent(new.procedure_group_id, new.procedure_id);
    new.unit_price_cents := public.group_adjusted_price(v_tabela, v_pct);
    new.list_price_cents := case when v_pct <> 0 then v_tabela end;
    return new;
  end if;

  -- UPDATE: procedimento, nome, preço e pacote ficam como nasceram.
  if new.procedure_id is distinct from old.procedure_id then
    raise exception 'ITEM_PROCEDURE_LOCKED';
  end if;
  if new.unit_price_cents is distinct from old.unit_price_cents
     or new.list_price_cents is distinct from old.list_price_cents
     or new.procedure_group_id is distinct from old.procedure_group_id
     or new.description is distinct from old.description then
    raise exception 'ITEM_PRICE_LOCKED';
  end if;
  return new;
end;
$$;

revoke execute on function public.plan_item_catalog_guard() from public, anon, authenticated;

-- 4) O envio do plano (0312) congela o preço COM o pacote ------------------------
-- Igual à 0312, exceto o passo F3: o preço do dia do envio agora é o do
-- catálogo AJUSTADO pelo pacote, e o item guarda o de tabela ao lado.
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

-- 5) A porta do preço do pacote: SÓ o Admin Master (o preço é dele, OC-00068) ---
-- O Planner monta o grupo (GP1), mas não mexe em preço — nem no do pacote.
create or replace function public.set_procedure_group_price(p_id uuid, p_percent numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'PRICE_NOT_ALLOWED';
  end if;
  if p_percent is null or p_percent <= -100 or p_percent > 100 then
    raise exception 'INVALID_ADJUST';
  end if;
  update public.procedure_groups
     set price_adjust_percent = round(p_percent, 2),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
end;
$$;
revoke execute on function public.set_procedure_group_price(uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_procedure_group_price(uuid, numeric) to authenticated;
