-- =============================================================================
-- 0321 — METAS SMART, ETAPA M4: ENGAJAMENTO
-- -----------------------------------------------------------------------------
-- Plano e decisões do dono: docs/metas/METAS-PLANO.md, §9d (Q1–Q5, aprovadas
-- em 24/10/2026). Continua a 0318, 0319 e 0320.
--
-- O que esta migração faz:
--   1. `goals` ganha o reconhecimento da meta e da Super Meta (texto — Q5:
--      nada vai ao Financeiro) e a opção de mostrar o ranking (Q4).
--   2. Os AVISOS no sino (Q1), pela porta do banco (regra da 0316: aviso só
--      nasce em função do banco). Cada aviso sai UMA vez (`goal_notices`) e
--      nunca mostra valor em R$ — só o percentual (D3):
--        publicada · começou · faltam 3 dias · atingida antes do prazo /
--        Super Meta · marco atingido · encerrada (participantes; os dois
--        últimos também a quem criou) · ritmo vermelho (só quem criou e os
--        gestores, no máximo 1 vez por semana).
--      Q2: a meta medida no código (cadeira) não entra no ritmo nem no
--      "atingida antes do prazo".
--   3. "Minhas metas" (Início) mostra a meta atingida por 7 dias (troféu).
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) COLUNAS
-- -----------------------------------------------------------------------------
alter table public.goals
  add column if not exists reward_text text,
  add column if not exists stretch_reward_text text,
  add column if not exists show_ranking boolean not null default true;

-- -----------------------------------------------------------------------------
-- 2) "JÁ AVISADO" — cada aviso sai uma vez por meta, evento e chave
-- -----------------------------------------------------------------------------
-- chave: '' (publicada, começou, 3 dias, encerrada), o início do período
-- (atingida / Super Meta de uma meta mensal), o id do marco, ou a semana ISO
-- (ritmo vermelho).
create table if not exists public.goal_notices (
  goal_id uuid not null references public.goals (id) on delete cascade,
  kind text not null,
  key text not null default '',
  recipients integer not null default 0,
  sent_at timestamptz not null default now(),
  primary key (goal_id, kind, key)
);
alter table public.goal_notices enable row level security;
-- Sem regra de leitura: é registro técnico da rotina.

-- -----------------------------------------------------------------------------
-- 3) A PORTA DO AVISO (interna)
-- -----------------------------------------------------------------------------
-- p_to: 'participants' | 'participants_and_creator' | 'creator_and_managers'.
-- Devolve quantos avisos saíram (0 = já tinha avisado).
create or replace function public._goal_notify(
  p_goal_id uuid, p_kind text, p_key text, p_to text, p_title text, p_body text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_users uuid[];
  v_n integer := 0;
  v_novo boolean;
begin
  select * into g from public.goals where id = p_goal_id;
  if not found then return 0; end if;

  insert into public.goal_notices (goal_id, kind, key)
  values (p_goal_id, p_kind, coalesce(p_key, ''))
  on conflict (goal_id, kind, key) do nothing
  returning true into v_novo;
  if not coalesce(v_novo, false) then return 0; end if;

  if p_to = 'creator_and_managers' then
    select array_agg(distinct u) into v_users from (
      select g.created_by as u
      union
      select ucr.user_id
        from public.user_clinic_roles_all ucr
        join public.profiles p on p.id = ucr.user_id and p.is_active
       where ucr.role in ('unit_manager', 'franchisee')
         and ucr.clinic_id = any (public._goal_clinic_ids(g.scope, g.clinic_ids))
    ) x where u is not null;
  else
    select array_agg(distinct u) into v_users from (
      select p.user_id as u from public._goal_participants(p_goal_id) p
      union
      select g.created_by where p_to = 'participants_and_creator'
    ) x where u is not null;
  end if;

  if v_users is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select u, case when cardinality(g.clinic_ids) = 1 then g.clinic_ids[1] end,
           left(p_title, 200), left(p_body, 500), '/metas/' || p_goal_id
      from unnest(v_users) as u;
    get diagnostics v_n = row_count;
  end if;
  update public.goal_notices set recipients = v_n
   where goal_id = p_goal_id and kind = p_kind and key = coalesce(p_key, '');
  return v_n;
end;
$$;

-- O que já deveria ter sido feito hoje (0 a 1), contando os dias JÁ
-- encerrados e tirando os pausados — espelho de `fracaoEsperada` no código.
create or replace function public._goal_expected(p_goal_id uuid, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select least(public.today_br() - 1, p_to) as corte,
           (p_to - p_from + 1) as total
  ),
  -- Só as pausas que EXISTEM (uma junção com a tabela vazia criaria uma
  -- "pausa" fantasma do período inteiro — achado na sonda da M4).
  pausa as (
    select coalesce((
      select sum(greatest(0,
               least(coalesce((gp.resumed_at at time zone 'America/Sao_Paulo')::date, b.corte), b.corte)
               - greatest((gp.paused_at at time zone 'America/Sao_Paulo')::date, p_from) + 1))
        from public.goal_pauses gp
       where gp.goal_id = p_goal_id), 0) as dias
      from b
  )
  select case
    when public.today_br() <= p_from then 0
    when b.total - least(pausa.dias, greatest(0, b.corte - p_from + 1)) <= 0 then 1
    else greatest(0, least(1,
           (greatest(0, b.corte - p_from + 1) - least(pausa.dias, greatest(0, b.corte - p_from + 1)))::numeric
           / (b.total - least(pausa.dias, greatest(0, b.corte - p_from + 1)))))
  end
  from b, pausa;
$$;

-- -----------------------------------------------------------------------------
-- 4) OS AVISOS DA MADRUGADA
-- -----------------------------------------------------------------------------
create or replace function public._goals_daily_notices(p_comecou uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
  v_semana text := to_char(public.today_br(), 'IYYY-IW');
  v_n integer := 0;
  r record;
  ms record;
  v_from date;
  v_to date;
  v_snap jsonb;
  v_value numeric;
  v_pct numeric;
  v_esperado numeric;
  v_meta record;
begin
  -- começou
  for r in select g.id, g.name from public.goals g where g.id = any (coalesce(p_comecou, '{}')) loop
    v_n := v_n + public._goal_notify(r.id, 'started', '', 'participants',
             'A meta começou: ' || r.name, 'A partir de hoje a barra está valendo.');
  end loop;

  for r in select g.* from public.goals g where g.status = 'active' and g.starts_on <= v_today loop
    select * into v_meta from public._goal_indicator_meta(r.indicator) m;

    -- faltam 3 dias
    if r.ends_on = v_today + 3 then
      v_n := v_n + public._goal_notify(r.id, 'ending_soon', '', 'participants',
               'Faltam 3 dias: ' || r.name, 'A meta termina em ' || to_char(r.ends_on, 'DD/MM/YYYY') || '.');
    end if;

    -- Q2: a meta medida no código não entra nos avisos que precisam do número.
    continue when v_meta.in_app;

    -- marcos atingidos (sempre soma de aumentar)
    for ms in select * from public.goal_milestones m where m.goal_id = r.id loop
      v_snap := public._goal_snapshot(r.id, r.starts_on, least(ms.due_on, v_today), ms.indicator, ms.filters);
      if public._goal_value(v_snap -> 'total') >= ms.target_value then
        v_n := v_n + public._goal_notify(r.id, 'milestone', ms.id::text, 'participants',
                 'Marco atingido: ' || ms.label, 'Na meta "' || r.name || '".');
      end if;
    end loop;

    -- só soma de aumentar e alvo coletivo daqui em diante (atingida e ritmo)
    continue when v_meta.kind <> 'sum' or r.direction <> 'increase'
               or r.target_mode = 'individual' or r.target_value is null;

    v_to := least(r.ends_on, v_today);
    v_from := case when r.periodicity = 'monthly' then greatest(r.starts_on, date_trunc('month', v_to)::date)
                   else r.starts_on end;
    v_snap := public._goal_snapshot(r.id, v_from, v_to);
    v_value := public._goal_value(v_snap -> 'total');
    v_pct := public._goal_percent(r.direction, v_meta.kind, v_value, r.target_value, null);

    -- atingida antes do prazo / Super Meta
    if v_pct >= 100 then
      v_n := v_n + public._goal_notify(r.id, 'achieved', v_from::text, 'participants_and_creator',
               'Meta atingida: ' || r.name,
               case when r.periodicity = 'monthly' then 'O alvo do mês já foi alcançado.'
                    else 'O alvo já foi alcançado antes do prazo.' end
               || coalesce(' Reconhecimento: ' || r.reward_text, ''));
      if r.stretch_value is not null
         and public._goal_percent(r.direction, v_meta.kind, v_value, r.stretch_value, null) >= 100 then
        v_n := v_n + public._goal_notify(r.id, 'stretch', v_from::text, 'participants_and_creator',
                 'Super Meta atingida: ' || r.name,
                 'A equipe passou da Super Meta.' || coalesce(' Reconhecimento: ' || r.stretch_reward_text, ''));
      end if;
    else
      -- ritmo vermelho: abaixo de 85% do que já devia ter sido feito
      v_esperado := public._goal_expected(r.id, v_from,
                      case when r.periodicity = 'monthly'
                           then least(r.ends_on, (date_trunc('month', v_to) + interval '1 month')::date - 1)
                           else r.ends_on end);
      if v_esperado > 0 and coalesce(v_pct, 0) < v_esperado * 100 * 0.85 then
        v_n := v_n + public._goal_notify(r.id, 'behind', v_semana, 'creator_and_managers',
                 'Meta atrás do ritmo: ' || r.name,
                 'Está em ' || round(coalesce(v_pct, 0))::text || '% do alvo; para estar no ritmo, já deveria estar em '
                 || round(v_esperado * 100)::text || '%.');
      end if;
    end if;
  end loop;

  -- encerradas (pela rotina ou pelo servidor, no caso da cadeira)
  for r in select g.* from public.goals g
            where g.status = 'finished' and g.finished_at > now() - interval '3 days' loop
    v_n := v_n + public._goal_notify(r.id, 'finished', '', 'participants_and_creator',
             'Meta encerrada: ' || r.name,
             case r.outcome
               when 'stretch' then 'Super Meta atingida!' || coalesce(' Reconhecimento: ' || r.stretch_reward_text, '')
               when 'achieved' then 'Meta atingida!' || coalesce(' Reconhecimento: ' || r.reward_text, '')
               when 'not_achieved' then 'A meta não foi atingida. Veja o resultado e o que aprender com ele.'
               else 'Não houve dados para apurar o resultado.' end);
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) GRAVAR: os campos novos
-- -----------------------------------------------------------------------------
create or replace function public.goal_save(p_goal_id uuid, p_data jsonb, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date := public.today_br();
  g public.goals;
  v_id uuid := p_goal_id;
  v_scope text := p_data ->> 'scope';
  v_clinics uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'clinic_ids', '[]'::jsonb)) as t (x));
  v_meta record;
  v_before jsonb;
  v_after jsonb;
  v_starts date := (p_data ->> 'starts_on')::date;
  v_ends date := (p_data ->> 'ends_on')::date;
  v_direction text := coalesce(p_data ->> 'direction', 'increase');
  r jsonb;
  i int := 0;
begin
  if v_user is null then raise exception 'GOAL_NOT_ALLOWED'; end if;
  if v_scope = 'network' then v_clinics := '{}'; end if;
  if nullif(trim(coalesce(p_data ->> 'name', '')), '') is null then raise exception 'GOAL_NAME_REQUIRED'; end if;
  select * into v_meta from public._goal_indicator_meta(p_data ->> 'indicator') m;
  if v_meta.kind is null then raise exception 'GOAL_UNKNOWN_INDICATOR'; end if;
  if v_starts is null or v_ends is null or v_ends < v_starts then raise exception 'GOAL_BAD_PERIOD'; end if;
  if v_meta.kind = 'sum' and v_direction <> 'increase' and not v_meta.can_decrease then
    raise exception 'GOAL_BAD_DIRECTION';
  end if;
  if v_meta.kind = 'sum' and v_meta.can_decrease and v_direction <> 'decrease' then
    raise exception 'GOAL_BAD_DIRECTION';
  end if;
  if v_meta.kind <> 'sum' and p_data ->> 'individual_rule' = 'split' then raise exception 'GOAL_RATE_SPLIT'; end if;
  if v_meta.kind = 'point' and coalesce(p_data ->> 'periodicity', 'whole') <> 'whole' then
    raise exception 'GOAL_POINT_MONTHLY';
  end if;
  if v_meta.in_app and coalesce(p_data ->> 'periodicity', 'whole') <> 'whole' then
    raise exception 'GOAL_APP_MONTHLY';
  end if;
  if not v_meta.per_person and coalesce(p_data ->> 'target_mode', 'collective') <> 'collective' then
    raise exception 'GOAL_NOT_PER_PERSON';
  end if;
  if v_scope = 'clinics' and exists (
       select 1 from unnest(v_clinics) as c (id)
        where not exists (select 1 from public.clinics k where k.id = c.id and k.type = 'franchise_unit')) then
    raise exception 'GOAL_BAD_CLINIC';
  end if;
  if not public._goal_can_create(v_scope, v_clinics) then raise exception 'GOAL_NOT_ALLOWED'; end if;

  if v_id is null then
    insert into public.goals (name, indicator, filters, scope, clinic_ids, starts_on, ends_on, created_by)
    values (trim(p_data ->> 'name'), p_data ->> 'indicator', coalesce(p_data -> 'filters', '{}'::jsonb),
            v_scope, v_clinics, v_starts, v_ends, v_user)
    returning id into v_id;
    select * into g from public.goals where id = v_id;
  else
    select * into g from public.goals where id = v_id for update;
    if not found then raise exception 'GOAL_NOT_FOUND'; end if;
    if not public._goal_can_create(g.scope, g.clinic_ids) then raise exception 'GOAL_NOT_ALLOWED'; end if;
    if g.status in ('finished', 'cancelled') then raise exception 'GOAL_CLOSED'; end if;
    if g.status <> 'draft' then
      if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'GOAL_REASON_REQUIRED'; end if;
      if g.indicator <> p_data ->> 'indicator'
         or g.filters <> coalesce(p_data -> 'filters', '{}'::jsonb)
         or g.scope <> v_scope
         or g.clinic_ids <> v_clinics
         or g.target_mode <> coalesce(p_data ->> 'target_mode', g.target_mode)
         or g.direction <> v_direction
         or g.periodicity <> coalesce(p_data ->> 'periodicity', g.periodicity) then
        raise exception 'GOAL_LOCKED_FIELD';
      end if;
      if g.starts_on <> v_starts and g.starts_on <= v_today then raise exception 'GOAL_STARTED'; end if;
      if v_ends < v_today then raise exception 'GOAL_END_IN_PAST'; end if;
      v_before := public._goal_export(v_id);
    end if;
  end if;

  update public.goals set
    name = trim(p_data ->> 'name'),
    indicator = p_data ->> 'indicator',
    filters = coalesce(p_data -> 'filters', '{}'::jsonb),
    scope = v_scope,
    clinic_ids = v_clinics,
    how_text = nullif(trim(coalesce(p_data ->> 'how_text', '')), ''),
    direction = v_direction,
    target_mode = coalesce(p_data ->> 'target_mode', 'collective'),
    target_value = (p_data ->> 'target_value')::numeric,
    individual_rule = nullif(p_data ->> 'individual_rule', ''),
    individual_value = (p_data ->> 'individual_value')::numeric,
    stretch_value = (p_data ->> 'stretch_value')::numeric,
    baseline_value = (p_data ->> 'baseline_value')::numeric,
    baseline_from = (p_data ->> 'baseline_from')::date,
    baseline_to = (p_data ->> 'baseline_to')::date,
    resources_text = nullif(trim(coalesce(p_data ->> 'resources_text', '')), ''),
    attainable_note = nullif(trim(coalesce(p_data ->> 'attainable_note', '')), ''),
    strategic_objective = nullif(p_data ->> 'strategic_objective', ''),
    relevance_text = nullif(trim(coalesce(p_data ->> 'relevance_text', '')), ''),
    periodicity = coalesce(p_data ->> 'periodicity', 'whole'),
    reward_text = nullif(trim(coalesce(p_data ->> 'reward_text', '')), ''),
    stretch_reward_text = nullif(trim(coalesce(p_data ->> 'stretch_reward_text', '')), ''),
    show_ranking = coalesce((p_data ->> 'show_ranking')::boolean, true),
    starts_on = v_starts,
    ends_on = v_ends,
    updated_by = v_user,
    updated_at = now()
  where id = v_id;

  delete from public.goal_participant_rules where goal_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'rules', '[]'::jsonb)) loop
    insert into public.goal_participant_rules (goal_id, kind, role, user_id)
    values (v_id, r ->> 'kind', (nullif(r ->> 'role', ''))::public.user_role, (nullif(r ->> 'user_id', ''))::uuid)
    on conflict do nothing;
  end loop;

  delete from public.goal_targets where goal_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'targets', '[]'::jsonb)) loop
    insert into public.goal_targets (goal_id, subject_kind, subject_id, target_value)
    values (v_id, r ->> 'subject_kind', (r ->> 'subject_id')::uuid, (r ->> 'target_value')::numeric)
    on conflict (goal_id, subject_kind, subject_id) do update set target_value = excluded.target_value;
  end loop;

  delete from public.goal_milestones where goal_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'milestones', '[]'::jsonb)) loop
    -- Marco é sempre "chegar a X até a data": só soma de aumentar.
    if not exists (select 1 from public._goal_indicator_meta(r ->> 'indicator') m
                    where m.kind = 'sum' and not m.can_decrease and not m.in_app) then
      raise exception 'GOAL_BAD_MILESTONE';
    end if;
    insert into public.goal_milestones (goal_id, position, label, indicator, filters, due_on, target_value)
    values (v_id, i, trim(r ->> 'label'), r ->> 'indicator', coalesce(r -> 'filters', '{}'::jsonb),
            (r ->> 'due_on')::date, (r ->> 'target_value')::numeric);
    i := i + 1;
  end loop;

  if v_before is not null then
    v_after := public._goal_export(v_id);
    if v_after is distinct from v_before then
      insert into public.goal_changes (goal_id, changed_by, kind, reason, before, after)
      values (v_id, v_user, 'edit', trim(p_reason), v_before, v_after);
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) PUBLICAR: com o aviso
-- -----------------------------------------------------------------------------
create or replace function public.goal_publish(p_goal_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_today date := public.today_br();
  v_status text;
begin
  select * into g from public.goals where id = p_goal_id for update;
  if not found then raise exception 'GOAL_NOT_FOUND'; end if;
  if not public._goal_can_create(g.scope, g.clinic_ids) then raise exception 'GOAL_NOT_ALLOWED'; end if;
  if g.status <> 'draft' then raise exception 'GOAL_NOT_DRAFT'; end if;
  if g.how_text is null then raise exception 'GOAL_SMART_S'; end if;
  if (g.target_mode <> 'individual' and g.target_value is null)
     or (g.target_mode <> 'collective' and g.individual_rule is null)
     or (g.target_mode <> 'collective' and g.individual_rule = 'same' and g.individual_value is null)
     or (g.individual_rule = 'split' and g.target_value is null) then
    raise exception 'GOAL_SMART_M';
  end if;
  if g.resources_text is null then raise exception 'GOAL_SMART_A'; end if;
  if g.strategic_objective is null or g.relevance_text is null then raise exception 'GOAL_SMART_R'; end if;
  if g.ends_on < v_today then raise exception 'GOAL_END_IN_PAST'; end if;
  if not exists (select 1 from public.goal_participant_rules r where r.goal_id = p_goal_id) then
    raise exception 'GOAL_NO_PARTICIPANTS';
  end if;
  v_status := case when g.starts_on > v_today then 'scheduled' else 'active' end;
  update public.goals
     set status = v_status, published_at = now(), published_by = (select auth.uid()), updated_at = now()
   where id = p_goal_id;
  insert into public.goal_changes (goal_id, changed_by, kind, after)
  values (p_goal_id, (select auth.uid()), 'publish', public._goal_export(p_goal_id));
  -- M4: o aviso da publicação (Q1). Nunca derruba a publicação.
  begin
    perform public._goal_notify(p_goal_id, 'published', '', 'participants',
      'Nova meta: ' || g.name,
      case when v_status = 'scheduled'
           then 'Começa em ' || to_char(g.starts_on, 'DD/MM/YYYY') || '. Veja como ela é medida.'
           else 'Já está valendo. Veja a barra e como ela é medida.' end);
  exception when others then
    raise warning 'METAS: aviso de publicação não saiu: %', sqlerrm;
  end;
  return v_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) MINHAS METAS: com o troféu de 7 dias
-- -----------------------------------------------------------------------------
create or replace function public.my_goal_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id
    from public.goals g
   where (select auth.uid()) is not null
     and (g.status in ('scheduled', 'active', 'paused')
          -- M4: a meta atingida fica no Início por 7 dias, com o troféu.
          or (g.status = 'finished' and g.outcome in ('achieved', 'stretch')
              and g.finished_at > now() - interval '7 days'))
     and public._goal_is_participant(g.id, (select auth.uid()));
$$;

-- -----------------------------------------------------------------------------
-- 8) A ROTINA DIÁRIA: com os avisos
-- -----------------------------------------------------------------------------
create or replace function public.goals_daily_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
  v_ontem date := public.today_br() - 1;
  v_started int := 0;
  v_finished int := 0;
  v_fotos int := 0;
  v_avisos int := 0;
  v_comecou uuid[] := '{}';
  r record;
  m date;
begin
  -- N1: a foto de ONTEM (o estado no fim do dia) de cada meta-fotografia que
  -- estava correndo ontem — inclusive a que terminou ontem: é ela que vira o
  -- resultado final, logo abaixo.
  for r in select g.id, g.scope, g.clinic_ids, g.indicator, g.filters, g.starts_on, g.ends_on
             from public.goals g
            where g.status in ('active', 'paused', 'scheduled')
              and g.starts_on <= v_ontem and g.ends_on >= v_ontem
              and (select m.kind from public._goal_indicator_meta(g.indicator) m) = 'point' loop
    insert into public.goal_daily_values (goal_id, day, snapshot)
    values (r.id, v_ontem, public._goal_snapshot(r.id, v_ontem, v_ontem, r.indicator, r.filters))
    on conflict (goal_id, day) do nothing;
    v_fotos := v_fotos + 1;
  end loop;

  -- M4: quem começa hoje ganha o aviso "começou" (uma vez — goal_notices).
  for r in select g.id from public.goals g
            where g.status = 'scheduled' and g.starts_on <= v_today loop
    v_comecou := array_append(v_comecou, r.id);
  end loop;
  update public.goals set status = 'active', updated_at = now()
   where status = 'scheduled' and starts_on <= v_today;
  get diagnostics v_started = row_count;

  for r in select id, starts_on, ends_on from public.goals
            where periodicity = 'monthly' and status in ('active', 'paused') loop
    m := date_trunc('month', r.starts_on)::date;
    while (m + interval '1 month')::date - 1 < v_today and m <= r.ends_on loop
      perform public._goal_freeze(r.id, 'period', greatest(m, r.starts_on),
                                  least((m + interval '1 month')::date - 1, r.ends_on));
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  -- O2: meta medida no código é encerrada pelo SERVIDOR (goal_record_app_final),
  -- que tem a conta; a rotina não a congela com o zero que o banco veria.
  for r in select g.id from public.goals g
            where g.status in ('scheduled', 'active', 'paused') and g.ends_on < v_today
              and not coalesce((select m.in_app from public._goal_indicator_meta(g.indicator) m), false) loop
    perform public._goal_finish(r.id);
    v_finished := v_finished + 1;
  end loop;

  -- M4: os avisos (Q1). Cada um isolado: um aviso que falha não para a rotina.
  begin
    v_avisos := public._goals_daily_notices(v_comecou);
  exception when others then
    raise warning 'METAS: avisos da madrugada não saíram: %', sqlerrm;
  end;

  return jsonb_build_object('started', v_started, 'finished', v_finished, 'photos', v_fotos, 'notices', v_avisos);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) PERMISSÕES DE EXECUÇÃO (AP15) e AUDITORIA
-- -----------------------------------------------------------------------------
revoke execute on function public._goal_notify(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public._goal_expected(uuid, date, date) from public, anon, authenticated;
revoke execute on function public._goals_daily_notices(uuid[]) from public, anon, authenticated;
revoke execute on function public.goals_daily_run() from public, anon, authenticated;
revoke execute on function public.goal_save(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.goal_save(uuid, jsonb, text) to authenticated;
revoke execute on function public.goal_publish(uuid) from public, anon, authenticated;
grant execute on function public.goal_publish(uuid) to authenticated;
revoke execute on function public.my_goal_ids() from public, anon, authenticated;
grant execute on function public.my_goal_ids() to authenticated;

insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'goal_notices', 'Registro técnico da rotina (quais avisos de meta já saíram).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();
