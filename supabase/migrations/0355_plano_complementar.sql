-- =============================================================================
-- 0355 — O PLANO COMPLEMENTAR, PASSO 1: ABRIR, MONTAR E APROVAR (AP64)
--
-- Decisão do dono (03/11/2026), na AP64 (plano em
-- docs/comercial/AP63-AP64-PLANO.md §3–§5, V1–V7): um plano vendido pode ganhar
-- um PLANO COMPLEMENTAR. Exemplo do dono: o paciente fez enxerto ósseo e espera
-- uns 6 meses para o implante; nesse intervalo decide adiantar outra etapa que
-- não tinha contratado. O cliente FICA NA FASE 5 (V1); o complemento é um plano
-- NOVO e SEPARADO, ligado ao vendido (V6) — o vendido não é copiado, não muda e
-- não é substituído.
--
-- O FLUXO DESTE PASSO:
--   1) o Coordenador Clínico ABRE o complemento (V7), com as informações
--      clínicas — `open_plan_complement`;
--   2) o Planner monta o plano complementar como qualquer plano;
--   3) o Planner envia e o Coordenador aprova. `submit_treatment_plan`,
--      `review_treatment_plan` e `review_plan_option` passam a aceitar o
--      complemento na Fase 5 e NÃO mexem no sub-status da jornada (o cliente
--      está em tratamento).
-- A apresentação/negociação (passo 2) e as sessões (passo 3) vêm depois.
--
-- A ligação só nasce pela função: um gatilho recusa que alguém logado grave
-- ou mude `complement_of_plan_id` pela API.
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1) As colunas do complemento ---------------------------------------------------
alter table public.treatment_plans
  add column if not exists complement_of_plan_id uuid references public.treatment_plans (id),
  add column if not exists complement_no integer,
  add column if not exists complement_clinical_notes text,
  add column if not exists complement_opened_by uuid references public.profiles (id),
  add column if not exists complement_opened_at timestamptz;

comment on column public.treatment_plans.complement_of_plan_id is
  'AP64 (0355): este plano é COMPLEMENTAR do plano vendido apontado. Só nasce por open_plan_complement.';
comment on column public.treatment_plans.complement_clinical_notes is
  'AP64: as informações clínicas do Coordenador ao abrir o complemento.';

create index if not exists treatment_plans_complement_idx
  on public.treatment_plans (complement_of_plan_id) where complement_of_plan_id is not null;

-- 2) A ligação só pela função ----------------------------------------------------
create or replace function public.treatment_plan_complement_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.complement_of_plan_id is not null or new.complement_no is not null
       or new.complement_opened_by is not null or new.complement_opened_at is not null then
      raise exception 'COMPLEMENT_BY_FUNCTION';
    end if;
    return new;
  end if;
  if (new.complement_of_plan_id, new.complement_no, new.complement_clinical_notes,
      new.complement_opened_by, new.complement_opened_at)
     is distinct from
     (old.complement_of_plan_id, old.complement_no, old.complement_clinical_notes,
      old.complement_opened_by, old.complement_opened_at) then
    raise exception 'COMPLEMENT_BY_FUNCTION';
  end if;
  return new;
end;
$$;
revoke execute on function public.treatment_plan_complement_guard() from public, anon, authenticated;
drop trigger if exists treatment_plan_complement_guard_trg on public.treatment_plans;
create trigger treatment_plan_complement_guard_trg
  before insert or update on public.treatment_plans
  for each row execute function public.treatment_plan_complement_guard();

-- 3) Abrir o complemento (Coordenador) -------------------------------------------
create or replace function public.open_plan_complement(p_parent_plan_id uuid, p_clinical_notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent record;
  v_phase public.journey_phase;
  v_name text;
  v_no integer;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  select tp.id, tp.client_id, tp.clinic_id, tp.status, tp.complement_of_plan_id
    into v_parent
  from public.treatment_plans tp where tp.id = p_parent_plan_id;
  if v_parent.id is null then raise exception 'PLAN_NOT_FOUND'; end if;

  if v_user is null or not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_parent.clinic_id, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_clinical_notes), '') = '' then
    raise exception 'CLINICAL_NOTES_REQUIRED';
  end if;

  select journey_phase, full_name into v_phase, v_name
  from public.clients where id = v_parent.client_id;
  if v_phase <> 'treatment_start' then raise exception 'WRONG_PHASE'; end if;

  -- O plano de base é um plano VENDIDO (negociação aceita, venda não cancelada).
  if v_parent.status <> 'approved' or not exists (
    select 1 from public.plan_negotiations n
    join public.commercial_sales s on s.negotiation_id = n.id
    where n.plan_id = v_parent.id and n.status = 'aceita' and s.cancelled_at is null
  ) then
    raise exception 'PARENT_NOT_SOLD';
  end if;

  -- Um complemento em andamento por vez (até ser aprovado).
  if exists (
    select 1 from public.treatment_plans c
    where c.client_id = v_parent.client_id and c.complement_of_plan_id is not null
      and c.status in ('draft', 'submitted', 'returned')
  ) then
    raise exception 'COMPLEMENT_IN_PROGRESS';
  end if;

  select coalesce(max(c.complement_no), 0) + 1 into v_no
  from public.treatment_plans c where c.client_id = v_parent.client_id;

  insert into public.treatment_plans (
    client_id, clinic_id, created_by, complement_of_plan_id, complement_no,
    complement_clinical_notes, complement_opened_by, complement_opened_at)
  values (
    v_parent.client_id, v_parent.clinic_id, v_user, v_parent.id, v_no,
    btrim(p_clinical_notes), v_user, now())
  returning id into v_id;

  perform public.log_plan_event(v_id, v_parent.clinic_id, 'complemento_aberto',
    'Plano complementar ' || v_no || ' aberto pelo Coordenador — informações clínicas: '
      || btrim(p_clinical_notes));
  perform public.log_plan_event(v_parent.id, v_parent.clinic_id, 'complemento_aberto',
    'Aberto o plano complementar ' || v_no || ' (o plano vendido segue valendo).');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_parent.clinic_id,
    'Plano COMPLEMENTAR para montar',
    coalesce(v_name, 'Cliente') || ' está em tratamento e o Coordenador abriu o plano '
      || 'complementar ' || v_no || '. Informações clínicas: ' || btrim(p_clinical_notes),
    '/prontuarios/' || v_parent.client_id || '?aba=plano'
  from public.user_clinic_roles ucr
  where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;

  return v_id;
end;
$$;
revoke execute on function public.open_plan_complement(uuid, text) from public, anon, authenticated;
grant execute on function public.open_plan_complement(uuid, text) to authenticated;

-- 4) Enviar para aprovação: o complemento vale na Fase 5 -------------------------
-- A definição em vigor (0339), com duas trocas marcadas "AP64".
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
  v_complemento boolean;
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.diagnosis, tp.superseded_at,
         tp.complement_of_plan_id is not null
    into v_client, v_clinic, v_diagnosis, v_superseded, v_complemento
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  -- D6: o titular ou o Planner (o Admin que não é o titular só vê).
  if v_user is null or not (public.is_owner() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_superseded is not null then raise exception 'PLAN_SUPERSEDED'; end if;

  select journey_phase, full_name into v_phase, v_name
  from public.clients where id = v_client;
  -- AP64: o complemento é montado com o cliente em tratamento (Fase 5).
  if v_complemento then
    if v_phase <> 'treatment_start' then raise exception 'WRONG_PHASE'; end if;
  elsif v_phase <> 'planning_center' then
    raise exception 'WRONG_PHASE';
  end if;

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

  -- AP64: o complemento não mexe no sub-status (o cliente está em tratamento).
  if not v_complemento then
    update public.clients
      set journey_status = 'awaiting_plan_approval'
    where id = v_client;
  end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic,
         case when v_complemento then 'Plano COMPLEMENTAR aguardando aprovação'
              else 'Plano aguardando aprovação' end,
         coalesce(v_name, 'Cliente') ||
           case when v_complemento
                then ' — o Planner enviou o plano complementar para sua aprovação (o cliente segue em tratamento).'
                else ' — o Planner enviou o plano de tratamento para sua aprovação.' end,
         '/clientes/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator';

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan', p_plan_id::text,
          jsonb_build_object('status', 'submitted'));
end;
$$;

-- 5) Aprovar ou devolver: o complemento não mexe no sub-status -------------------
-- A definição em vigor (0037), com as trocas marcadas "AP64".
create or replace function public.review_treatment_plan(
  p_plan_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_clinic uuid;
  v_status public.treatment_plan_status;
  v_planner uuid;
  v_name text;
  v_complemento boolean;
  v_no integer;
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.status, tp.created_by,
         tp.complement_of_plan_id is not null, tp.complement_no
    into v_client, v_clinic, v_status, v_planner, v_complemento, v_no
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  -- Quem revisa: o Coordenador Clínico da unidade do plano (ou Admin Master).
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_status <> 'submitted' then raise exception 'NOT_SUBMITTED'; end if;

  select full_name into v_name from public.clients where id = v_client;

  if p_approve then
    update public.treatment_plans
      set status = 'approved', reviewed_by = v_user, reviewed_at = now(),
          review_notes = null, updated_at = now()
    where id = p_plan_id;

    if v_complemento then
      -- AP64: o cliente segue em tratamento; os Planners ficam sabendo.
      perform public.log_plan_event(p_plan_id, v_clinic, 'complemento_aprovado',
        'Plano complementar ' || coalesce(v_no::text, '') || ' aprovado pelo Coordenador.');
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic, 'Plano complementar aprovado',
        coalesce(v_name, 'Cliente') || ' — o plano complementar '
          || coalesce(v_no::text, '') || ' foi aprovado pelo Coordenador.',
        '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
    else
      -- Sem sub-status pendente após aprovar; o cartão do plano mostra "Aprovado".
      update public.clients set journey_status = null where id = v_client;

      if v_planner is not null then
        insert into public.notifications (user_id, clinic_id, title, body, link)
        values (v_planner, v_clinic, 'Plano aprovado',
          coalesce(v_name, 'Cliente') ||
            ' — plano aprovado pelo Coordenador. Envie ao Comercial.',
          '/clientes/' || v_client);
      end if;
    end if;
  else
    if coalesce(btrim(p_notes), '') = '' then
      raise exception 'NOTES_REQUIRED';
    end if;
    update public.treatment_plans
      set status = 'returned', reviewed_by = v_user, reviewed_at = now(),
          review_notes = p_notes, updated_at = now()
    where id = p_plan_id;

    if v_complemento then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic, 'Plano complementar devolvido para revisão',
        coalesce(v_name, 'Cliente') || ' — o Coordenador devolveu o plano complementar '
          || coalesce(v_no::text, '') || '. Veja as orientações na ficha.',
        '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
    else
      update public.clients
        set journey_status = 'revision_with_coordinator'
      where id = v_client;

      if v_planner is not null then
        insert into public.notifications (user_id, clinic_id, title, body, link)
        values (v_planner, v_clinic, 'Plano devolvido para revisão',
          coalesce(v_name, 'Cliente') ||
            ' — o Coordenador devolveu o plano. Veja as orientações na ficha.',
          '/clientes/' || v_client);
      end if;
    end if;
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan', p_plan_id::text,
    jsonb_build_object('review',
      case when p_approve then 'approved' else 'returned' end));
end;
$$;

-- 6) A aprovação opção por opção (F4) — o mesmo cuidado com o complemento -------
-- A definição em vigor (0042), com as trocas marcadas "AP64". É o caminho que a
-- tela usa quando o Coordenador decide cada opção.
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
  v_complemento boolean;
  v_no integer;
  v_user uuid := (select auth.uid());
begin
  select o.plan_id, o.clinic_id into v_plan, v_clinic
  from public.treatment_plan_options o where o.id = p_option_id;
  if v_plan is null then raise exception 'OPTION_NOT_FOUND'; end if;

  select tp.client_id, tp.status, tp.created_by,
         tp.complement_of_plan_id is not null, tp.complement_no
    into v_client, v_status, v_planner, v_complemento, v_no
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
    if v_complemento then
      -- AP64: o cliente segue em tratamento; os Planners ficam sabendo.
      perform public.log_plan_event(v_plan, v_clinic, 'complemento_aprovado',
        'Plano complementar ' || coalesce(v_no::text, '') || ' aprovado pelo Coordenador.');
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic, 'Plano complementar aprovado',
        coalesce(v_name, 'Cliente') || ' — o plano complementar '
          || coalesce(v_no::text, '') || ' foi aprovado pelo Coordenador.',
        '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
    else
      update public.clients set journey_status = null where id = v_client;
      if v_planner is not null then
        insert into public.notifications (user_id, clinic_id, title, body, link)
        values (v_planner, v_clinic, 'Plano aprovado',
          coalesce(v_name, 'Cliente') ||
            ' — opções avaliadas pelo Coordenador. Envie ao Comercial.',
          '/clientes/' || v_client);
      end if;
    end if;
  else
    update public.treatment_plans
      set status = 'returned', reviewed_by = v_user, reviewed_at = now(),
          updated_at = now()
    where id = v_plan;
    if v_complemento then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic, 'Plano complementar devolvido para revisão',
        coalesce(v_name, 'Cliente') || ' — todas as opções do plano complementar '
          || coalesce(v_no::text, '') || ' foram reprovadas. Veja as considerações na ficha.',
        '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
    else
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
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan_option', p_option_id::text,
    jsonb_build_object('approved', p_approve));
end;
$$;

revoke execute on function public.submit_treatment_plan(uuid) from public, anon, authenticated;
grant execute on function public.submit_treatment_plan(uuid) to authenticated;
revoke execute on function public.review_treatment_plan(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_treatment_plan(uuid, boolean, text) to authenticated;
revoke execute on function public.review_plan_option(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_plan_option(uuid, boolean, text) to authenticated;

-- Conferência (só leitura) ------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'treatment_plans'
      and column_name in ('complement_of_plan_id', 'complement_no', 'complement_clinical_notes',
                          'complement_opened_by', 'complement_opened_at')) as colunas_esperado_5,
  (select count(*) from pg_trigger
    where tgname = 'treatment_plan_complement_guard_trg' and not tgisinternal) as trava_esperado_1,
  has_function_privilege('anon', 'public.open_plan_complement(uuid, text)', 'execute')
    as sem_login_abre_esperado_false,
  position('v_complemento' in pg_get_functiondef('public.submit_treatment_plan(uuid)'::regprocedure)) > 0
    and position('v_complemento' in pg_get_functiondef('public.review_treatment_plan(uuid, boolean, text)'::regprocedure)) > 0
    and position('v_complemento' in pg_get_functiondef('public.review_plan_option(uuid, boolean, text)'::regprocedure)) > 0
    as envio_e_aprovacao_conhecem_o_complemento;
