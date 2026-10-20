-- =============================================================================
-- 0311 — ODONTOGRAMA OD3: O PLANO POR DENTE
--
-- Plano e decisões do dono em docs/odontograma/OD3-PLANO.md (20/10/2026):
--   * Cada item do plano diz ONDE acontece: dente (+ faces) ou região (as
--     arcadas são regiões da TUSS: AS, AI, ASAI). F4: UM ITEM POR DENTE,
--     quantidade 1.
--   * F1: o que é de FORMA o banco recusa (face que o dente não tem, nº de
--     faces, dentição, grupo de dentes, nível errado); o que é de SITUAÇÃO
--     (impede / exige, conferido contra o diagnóstico definido e contra o que
--     a mesma opção já planeja) só passa com MOTIVO.
--   * D4 / F2: plano aprovado não se edita — vira NOVA VERSÃO; a anterior fica
--     "substituída" quando a nova é APROVADA. A trava passa a ser do BANCO
--     (AP62: era só da tela).
--   * F3: o preço do item congela no ENVIO para aprovação, pelo preço do dia.
--   * E2 (decidido na OD2): enviar exige o diagnóstico DEFINIDO — nenhuma
--     sugestão pendente e ao menos uma rodada finalizada.
--
-- Idempotente. Nada apaga dado. Os itens antigos (sem dente) continuam valendo;
-- o envio para aprovação é que passa a pedir o lugar de cada procedimento.
-- =============================================================================

-- 1) Onde o item acontece ---------------------------------------------------------
alter table public.treatment_plan_option_items
  add column if not exists tooth_code text references public.dental_teeth (code),
  add column if not exists face_codes text[] not null default '{}',
  add column if not exists region_code text references public.dental_regions (code),
  add column if not exists situation_override_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tpo_items_tooth_or_region_check') then
    alter table public.treatment_plan_option_items
      add constraint tpo_items_tooth_or_region_check
      check (tooth_code is null or region_code is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tpo_items_faces_need_tooth_check') then
    alter table public.treatment_plan_option_items
      add constraint tpo_items_faces_need_tooth_check
      check (tooth_code is not null or cardinality(face_codes) = 0);
  end if;
end $$;
create index if not exists tpo_items_tooth_idx
  on public.treatment_plan_option_items (tooth_code) where tooth_code is not null;

-- 2) Versões e o preço do envio -----------------------------------------------------
alter table public.treatment_plans
  add column if not exists version_no integer not null default 1,
  add column if not exists previous_plan_id uuid references public.treatment_plans (id),
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_plan_id uuid references public.treatment_plans (id),
  add column if not exists prices_frozen_at timestamptz;

-- 3) O que o diagnóstico DEFINIDO diz do dente, hoje -----------------------------
create or replace function public._tooth_current_conditions(p_client uuid, p_tooth text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct f.condition_code), '{}')
    from public.tooth_findings f
   where f.client_id = p_client
     and f.tooth_code = p_tooth
     and f.action = 'mark'
     and f.status = 'defined'
     and not exists (
       select 1 from public.tooth_findings r
        where r.removes_finding_id = f.id and r.status = 'defined');
$$;
revoke execute on function public._tooth_current_conditions(uuid, text) from public, anon, authenticated;

-- 4) A conferência do item (forma recusa; situação pede motivo) -------------------
create or replace function public.plan_item_location_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regra record;
  v_dente record;
  v_cliente uuid;
  v_atual text[];
  v_previsto text[];
  f text;
  v_conflito boolean := false;
begin
  if new.procedure_id is null then
    -- item antigo sem procedimento: não tem regra a conferir
    if new.tooth_code is not null or new.region_code is not null then raise exception 'ITEM_LOCATION_WITHOUT_PROCEDURE'; end if;
    return new;
  end if;

  select * into v_regra from public.procedure_dental_rules where procedure_id = new.procedure_id;
  new.face_codes := coalesce(new.face_codes, '{}');

  -- Sem lugar informado: vale (item antigo, ou ainda a completar). Quem cobra o
  -- lugar é o ENVIO para aprovação (submit_treatment_plan).
  if new.tooth_code is null and new.region_code is null then
    if cardinality(new.face_codes) > 0 then raise exception 'ITEM_FACES_WITHOUT_TOOTH'; end if;
    return new;
  end if;

  -- Procedimento sem regra (cadastrado depois da 0308): aceita o lugar sem conferir a forma.
  if v_regra.procedure_id is null then return new; end if;

  -- FORMA ------------------------------------------------------------------------
  if v_regra.application_level in ('face', 'tooth') then
    if new.tooth_code is null then raise exception 'ITEM_TOOTH_REQUIRED'; end if;
    -- F4: um item por dente
    if new.quantity is distinct from 1 then raise exception 'ITEM_ONE_PER_TOOTH'; end if;
    select code, dentition, tooth_group into v_dente from public.dental_teeth where code = new.tooth_code;
    if v_regra.dentition <> 'both' and v_dente.dentition <> v_regra.dentition then
      raise exception 'ITEM_WRONG_DENTITION';
    end if;
    if cardinality(coalesce(v_regra.tooth_groups, '{}')) > 0
       and not (v_dente.tooth_group = any (v_regra.tooth_groups)) then
      raise exception 'ITEM_WRONG_TOOTH_GROUP';
    end if;
    if v_regra.application_level = 'face' then
      new.face_codes := array(select distinct x from unnest(new.face_codes) x order by 1);
      if cardinality(new.face_codes) < coalesce(v_regra.face_count_min, 1)
         or cardinality(new.face_codes) > coalesce(v_regra.face_count_max, 5) then
        raise exception 'ITEM_FACE_COUNT';
      end if;
      foreach f in array new.face_codes loop
        if not exists (select 1 from public.dental_tooth_faces tf
                        where tf.tooth_code = new.tooth_code and tf.face_code = f) then
          raise exception 'FACE_NOT_ON_TOOTH';
        end if;
      end loop;
      if not (coalesce(v_regra.fixed_faces, '{}') <@ new.face_codes) then
        raise exception 'ITEM_FIXED_FACES';
      end if;
    elsif cardinality(new.face_codes) > 0 then
      raise exception 'FACES_NOT_ALLOWED';
    end if;
  elsif v_regra.application_level in ('region', 'arch') then
    if new.region_code is null then raise exception 'ITEM_REGION_REQUIRED'; end if;
    if v_regra.application_level = 'arch' and new.region_code not in ('AS', 'AI', 'ASAI') then
      raise exception 'ITEM_ARCH_REQUIRED';
    end if;
  else
    -- 'none': o procedimento não se marca no dente
    raise exception 'ITEM_NO_LOCATION';
  end if;

  -- SITUAÇÃO (só no dente) — conferida contra o diagnóstico DEFINIDO e contra o
  -- efeito do que a MESMA opção já planeja para o dente.
  if new.tooth_code is not null then
    select p.client_id into v_cliente
      from public.treatment_plan_options o
      join public.treatment_plans p on p.id = o.plan_id
     where o.id = new.option_id;
    v_atual := public._tooth_current_conditions(v_cliente, new.tooth_code);
    select coalesce(array_agg(distinct r.effect_condition) filter (where r.effect_condition is not null), '{}')
      into v_previsto
      from public.treatment_plan_option_items i
      join public.procedure_dental_rules r on r.procedure_id = i.procedure_id
     where i.option_id = new.option_id
       and i.tooth_code = new.tooth_code
       and i.id is distinct from new.id;
    if cardinality(coalesce(v_regra.blocked_conditions, '{}')) > 0
       and v_atual && v_regra.blocked_conditions then
      v_conflito := true;
    end if;
    if cardinality(coalesce(v_regra.required_conditions, '{}')) > 0
       and not ((v_atual || v_previsto) && v_regra.required_conditions) then
      v_conflito := true;
    end if;
    if v_conflito and length(btrim(coalesce(new.situation_override_reason, ''))) < 5 then
      raise exception 'SITUATION_CONFLICT';
    end if;
    if not v_conflito then new.situation_override_reason := null; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_item_location_check() from public, anon, authenticated;
drop trigger if exists plan_item_location_trg on public.treatment_plan_option_items;
create trigger plan_item_location_trg
  before insert or update of tooth_code, face_codes, region_code, procedure_id, quantity, situation_override_reason
  on public.treatment_plan_option_items
  for each row execute function public.plan_item_location_check();

-- 5) AP62 / D4: plano que não está em rascunho ou devolvido NÃO se edita --------
-- Vale para quem chega pela API (`authenticated`) — as funções do banco
-- (envio, aprovação, transferência de unidade) passam, como na trava de preço
-- da 0306. Por isso o gatilho é `security invoker`: com `security definer`,
-- `current_user` seria sempre o dono e a trava nunca valeria.
create or replace function public._plan_is_editable(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.status in ('draft', 'returned') and p.superseded_at is null
                     from public.treatment_plans p where p.id = p_plan), true);
$$;
-- Os gatilhos de trava rodam como QUEM CHAMA (`authenticated`): precisam
-- poder executar esta régua. Ela só responde se o plano está editável.
revoke execute on function public._plan_is_editable(uuid) from public, anon, authenticated;
grant execute on function public._plan_is_editable(uuid) to authenticated;

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
    -- Indicar o profissional e a prioridade (GUT) seguem livres: não mudam o
    -- que foi aprovado nem o preço.
    if tg_op = 'UPDATE'
       and (new.option_id, new.procedure_id, new.description, new.quantity, new.unit_price_cents,
            new.planned_sessions, new.planned_total_minutes, new.stage_id, new.tooth_code,
            new.face_codes, new.region_code, new.situation_override_reason, new.sort_order)
           is not distinct from
           (old.option_id, old.procedure_id, old.description, old.quantity, old.unit_price_cents,
            old.planned_sessions, old.planned_total_minutes, old.stage_id, old.tooth_code,
            old.face_codes, old.region_code, old.situation_override_reason, old.sort_order) then
      return new;
    end if;
    raise exception 'PLAN_LOCKED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.plan_item_lock() from public, anon, authenticated;
drop trigger if exists plan_item_lock_trg on public.treatment_plan_option_items;
create trigger plan_item_lock_trg
  before insert or update or delete on public.treatment_plan_option_items
  for each row execute function public.plan_item_lock();

create or replace function public.plan_option_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if not public._plan_is_editable(case when tg_op = 'DELETE' then old.plan_id else new.plan_id end) then
    raise exception 'PLAN_LOCKED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.plan_option_lock() from public, anon, authenticated;
drop trigger if exists plan_option_lock_trg on public.treatment_plan_options;
create trigger plan_option_lock_trg
  before insert or update or delete on public.treatment_plan_options
  for each row execute function public.plan_option_lock();

-- O plano em si: pela API, a SITUAÇÃO e as colunas de versão/preço não se mexem
-- (são das funções: enviar, aprovar, devolver); e o texto (diagnóstico,
-- objetivos, notas) de plano enviado/aprovado/substituído não muda. Sem isto,
-- voltar o plano para "rascunho" pela API reabriria tudo o que a trava fecha.
create or replace function public.treatment_plan_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.superseded_at is not null or new.superseded_by_plan_id is not null
       or new.prices_frozen_at is not null then
      raise exception 'PLAN_STATUS_BY_FUNCTION';
    end if;
    return new;
  end if;
  if (new.status, new.version_no, new.previous_plan_id, new.superseded_at, new.superseded_by_plan_id, new.prices_frozen_at,
      new.client_id)
     is distinct from
     (old.status, old.version_no, old.previous_plan_id, old.superseded_at, old.superseded_by_plan_id, old.prices_frozen_at,
      old.client_id) then
    raise exception 'PLAN_STATUS_BY_FUNCTION';
  end if;
  if not (old.status in ('draft', 'returned') and old.superseded_at is null)
     and (new.diagnosis, new.objectives, new.planning_notes)
         is distinct from (old.diagnosis, old.objectives, old.planning_notes) then
    raise exception 'PLAN_LOCKED';
  end if;
  return new;
end;
$$;
revoke execute on function public.treatment_plan_lock() from public, anon, authenticated;
drop trigger if exists treatment_plan_lock_trg on public.treatment_plans;
create trigger treatment_plan_lock_trg
  before insert or update on public.treatment_plans
  for each row execute function public.treatment_plan_lock();

-- 6) Versões: o número vem da anterior; aprovar a nova SUBSTITUI a anterior (F2) --
create or replace function public.treatment_plan_version_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.previous_plan_id is not null then
    if not exists (select 1 from public.treatment_plans p
                    where p.id = new.previous_plan_id and p.client_id = new.client_id) then
      raise exception 'PREVIOUS_PLAN_INVALID';
    end if;
    new.version_no := coalesce((select max(p.version_no) from public.treatment_plans p
                                 where p.client_id = new.client_id), 0) + 1;
  end if;
  return new;
end;
$$;
revoke execute on function public.treatment_plan_version_number() from public, anon, authenticated;
drop trigger if exists treatment_plan_version_trg on public.treatment_plans;
create trigger treatment_plan_version_trg
  before insert on public.treatment_plans
  for each row execute function public.treatment_plan_version_number();

create or replace function public.treatment_plan_supersede_previous()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and new.previous_plan_id is not null then
    update public.treatment_plans
       set superseded_at = now(), superseded_by_plan_id = new.id, updated_at = now()
     where id = new.previous_plan_id and superseded_at is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.treatment_plan_supersede_previous() from public, anon, authenticated;
drop trigger if exists treatment_plan_supersede_trg on public.treatment_plans;
create trigger treatment_plan_supersede_trg
  after update of status on public.treatment_plans
  for each row execute function public.treatment_plan_supersede_previous();

-- 7) O ENVIO para aprovação: E2 (diagnóstico definido), o lugar de cada item e o
-- preço congelado no dia (F3). Mesma assinatura e retorno da 0041.
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

  if v_user is null or not (public.is_admin_master() or public.is_planner()) then
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

  -- Todo procedimento que se marca no dente / região precisa do lugar.
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

  -- F3: o preço de cada item é o do catálogo NO DIA DO ENVIO.
  update public.treatment_plan_option_items i
     set unit_price_cents = public.catalog_price_for(i.clinic_id, i.procedure_id)
    from public.treatment_plan_options o
   where o.id = i.option_id
     and o.plan_id = p_plan_id
     and i.procedure_id is not null
     and i.unit_price_cents is distinct from public.catalog_price_for(i.clinic_id, i.procedure_id);

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
