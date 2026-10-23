-- =============================================================================
-- 0318 — METAS SMART (ETAPA M1)
-- -----------------------------------------------------------------------------
-- Plano e decisões do dono (D1–D9, aprovadas em 23/10/2026):
-- docs/metas/METAS-PLANO.md.
--
-- INDICADOR É CÓDIGO; META É DADO. O que se mede (cada indicador) é uma
-- consulta escrita aqui, em `_goal_measure_raw`; a meta (alvo, prazo,
-- participantes, os textos do SMART) é linha de tabela, configurada na tela.
-- A lista de indicadores do banco e a do código (`src/lib/metas/indicadores.ts`)
-- são conferidas uma contra a outra por teste.
--
-- O que esta migração faz:
--   1. Tabelas: `goals` (a meta), `goal_participant_rules` (unidade toda / por
--      função / pessoa), `goal_targets` (alvo por pessoa ou por unidade — D2),
--      `goal_milestones` (marcos), `goal_pauses`, `goal_changes` (histórico
--      com motivo) e `goal_results` (resultado CONGELADO de cada período).
--   2. Quem pode: criar meta de rede/várias unidades = Admin e Franqueadora;
--      meta de UMA unidade = também o Gerente e o Franqueado dela (D1). Ver =
--      quem cria/edita, gestores das unidades da meta e os participantes.
--   3. A medição dos 13 indicadores da M1 (`_goal_measure_raw`), somada no
--      BANCO (a API corta leitura em 1000 linhas).
--   4. Portas: `goal_measure` (o realizado), `goal_measure_preview` (linha de
--      base no assistente), `goal_participants`, `goal_candidates`,
--      `goal_save`, `goal_publish`, `goal_change_status`.
--   5. D3: valor em R$ só para quem já enxerga dinheiro da unidade; os demais
--      recebem o PERCENTUAL (e o próprio número, sempre).
--   6. Rotina diária (pg_cron): A iniciar → Ativa pela data; congela o mês
--      encerrado (meta mensal) e a meta encerrada (resultado é fato histórico).
--
-- Idempotente. Nada apaga dado fora da própria meta (descartar rascunho).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) TABELAS
-- -----------------------------------------------------------------------------
create sequence if not exists public.goals_code_seq;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    default ('MT-' || lpad(nextval('public.goals_code_seq')::text, 5, '0')),
  name text not null,
  -- S — específica
  indicator text not null,
  filters jsonb not null default '{}'::jsonb,
  scope text not null check (scope in ('network', 'clinics')),
  clinic_ids uuid[] not null default '{}',
  how_text text,
  -- M — mensurável
  direction text not null default 'increase' check (direction in ('increase', 'decrease')),
  target_mode text not null default 'collective'
    check (target_mode in ('collective', 'individual', 'both')),
  target_value numeric check (target_value is null or target_value >= 0),
  individual_rule text check (individual_rule is null or individual_rule in ('same', 'split')),
  individual_value numeric check (individual_value is null or individual_value >= 0),
  stretch_value numeric check (stretch_value is null or stretch_value >= 0),
  baseline_value numeric,
  baseline_from date,
  baseline_to date,
  -- A — atingível
  resources_text text,
  attainable_note text,
  -- R — relevante
  strategic_objective text,
  relevance_text text,
  -- T — temporal
  periodicity text not null default 'whole' check (periodicity in ('whole', 'monthly')),
  starts_on date not null,
  ends_on date not null,
  -- situação
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'active', 'paused', 'finished', 'cancelled')),
  outcome text check (outcome is null or outcome in ('stretch', 'achieved', 'not_achieved', 'no_data')),
  status_reason text,
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  finished_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint goals_scope_clinics check ((scope = 'network') = (cardinality(clinic_ids) = 0)),
  constraint goals_period check (ends_on >= starts_on)
);
create index if not exists goals_status_idx on public.goals (status, ends_on);
create index if not exists goals_clinics_idx on public.goals using gin (clinic_ids);

comment on table public.goals is
  'Metas SMART (0318). Indicador é código (_goal_measure_raw); meta é dado. Grava só pelas funções goal_*.';

create table if not exists public.goal_participant_rules (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  kind text not null check (kind in ('all', 'role', 'user')),
  role public.user_role,
  user_id uuid references public.profiles (id),
  constraint goal_rule_shape check (
    (kind = 'all' and role is null and user_id is null)
    or (kind = 'role' and role is not null and user_id is null)
    or (kind = 'user' and user_id is not null and role is null)
  ),
  constraint goal_participant_rules_uq unique nulls not distinct (goal_id, kind, role, user_id)
);

create table if not exists public.goal_targets (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  subject_kind text not null check (subject_kind in ('user', 'clinic')),
  subject_id uuid not null,
  target_value numeric not null check (target_value >= 0),
  unique (goal_id, subject_kind, subject_id)
);

create table if not exists public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  position integer not null default 0,
  label text not null,
  indicator text not null,
  filters jsonb not null default '{}'::jsonb,
  due_on date not null,
  target_value numeric not null check (target_value >= 0)
);
create index if not exists goal_milestones_goal_idx on public.goal_milestones (goal_id, position);

create table if not exists public.goal_pauses (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  paused_at timestamptz not null default now(),
  paused_by uuid references public.profiles (id),
  reason text not null,
  resumed_at timestamptz,
  resumed_by uuid references public.profiles (id)
);
create index if not exists goal_pauses_goal_idx on public.goal_pauses (goal_id, paused_at);

-- Histórico de alterações DEPOIS de publicada (o motivo é obrigatório).
create table if not exists public.goal_changes (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id),
  kind text not null,
  reason text,
  before jsonb,
  after jsonb
);
create index if not exists goal_changes_goal_idx on public.goal_changes (goal_id, changed_at);

-- O resultado CONGELADO (período mensal encerrado, ou a meta inteira).
-- Sem regra de leitura de propósito: quem lê é `goal_measure`, que aplica a D3.
create table if not exists public.goal_results (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  kind text not null check (kind in ('period', 'final')),
  period_start date not null,
  period_end date not null,
  snapshot jsonb not null,
  value numeric,
  achieved boolean,
  stretch_achieved boolean,
  people_achieved integer,
  people_total integer,
  measured_at timestamptz not null default now(),
  unique (goal_id, kind, period_start)
);

-- -----------------------------------------------------------------------------
-- 2) O CATÁLOGO DO BANCO (espelho de src/lib/metas/indicadores.ts)
-- -----------------------------------------------------------------------------
-- kind: 'sum' (acumula) | 'rate' (num/den). per_person: a meta individual faz
-- sentido. money: valor em R$ (centavos) — sujeito à D3.
-- ⚠️ A régua `metas-catalogo.test.ts` lê a lista entre as marcas abaixo.
create or replace function public._goal_indicator_meta(p_indicator text)
returns table (kind text, per_person boolean, money boolean)
language sql
immutable
set search_path = ''
as $$
  select m.kind, m.per_person, m.money
    from (values
      -- INDICADORES:INICIO
      ('sales_value',        'sum',  true,  true),
      ('sales_count',        'sum',  true,  false),
      ('sales_ticket',       'rate', true,  true),
      ('appointments_created','sum', true,  false),
      ('appointments_done',  'sum',  true,  false),
      ('evaluations_done',   'sum',  true,  false),
      ('attendance_rate',    'rate', true,  false),
      ('no_show_rate',       'rate', true,  false),
      ('check_ins',          'sum',  true,  false),
      ('returns_scheduled',  'sum',  true,  false),
      ('procedures_done',    'sum',  true,  false),
      ('new_clients',        'sum',  true,  false),
      ('ppr_adhesions',      'sum',  true,  false)
      -- INDICADORES:FIM
    ) as m (indicator, kind, per_person, money)
   where m.indicator = p_indicator;
$$;

-- -----------------------------------------------------------------------------
-- 3) A MEDIÇÃO — uma consulta por indicador (interna, sem guarda)
-- -----------------------------------------------------------------------------
-- Devolve (unidade, pessoa, dia, num, den). Taxa em % já vem com num × 100.
-- O período é de DATAS no relógio de parede do Brasil, as duas pontas inclusas.
create or replace function public._goal_measure_raw(
  p_indicator text,
  p_filters jsonb,
  p_clinic_ids uuid[],
  p_from date,
  p_to date
)
returns table (clinic_id uuid, user_id uuid, day date, num numeric, den numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_from timestamptz := (p_from::timestamp at time zone 'America/Sao_Paulo');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_types text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'appointment_types', '[]'::jsonb)) as t (x));
  v_specialties text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'specialties', '[]'::jsonb)) as t (x));
  v_origins text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'client_origins', '[]'::jsonb)) as t (x));
  v_plans text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'ppr_plans', '[]'::jsonb)) as t (x));
  v_sale_origin text := nullif(v_f ->> 'sale_origin', '');
begin
  if p_from is null or p_to is null or p_to < p_from or coalesce(cardinality(p_clinic_ids), 0) = 0 then
    return;
  end if;

  if p_indicator in ('sales_value', 'sales_count', 'sales_ticket') then
    -- Venda fechada = contrato + pagamento (closed_at), sem cancelamento.
    -- Quem vendeu: o consultor da negociação; venda direta: quem a criou.
    return query
      with s as (
        select cs.clinic_id, pn.consultant_id as user_id, cs.closed_at as at, cs.final_cents::numeric as cents
          from public.commercial_sales cs
          join public.plan_negotiations pn on pn.id = cs.negotiation_id
         where cs.closed_at >= v_from and cs.closed_at < v_to
           and cs.cancelled_at is null
           and cs.clinic_id = any (p_clinic_ids)
           and (v_sale_origin is null or v_sale_origin = 'plan')
        union all
        select ds.clinic_id, ds.created_by, ds.closed_at, ds.final_cents::numeric
          from public.direct_sales ds
         where ds.closed_at >= v_from and ds.closed_at < v_to
           and ds.status <> 'cancelada' and not ds.cancelled and ds.cancelled_at is null
           and ds.clinic_id = any (p_clinic_ids)
           and (v_sale_origin is null or v_sale_origin = 'direct')
      )
      select s.clinic_id, s.user_id, (s.at at time zone v_tz)::date,
             case when p_indicator = 'sales_count' then count(*)::numeric else sum(s.cents) end,
             case when p_indicator = 'sales_ticket' then count(*)::numeric else null::numeric end
        from s
       group by 1, 2, 3;

  elsif p_indicator in ('appointments_created', 'returns_scheduled') then
    -- Agendamentos MARCADOS no período (pela data em que foram marcados).
    -- Cancelado não conta; falta conta (o agendamento foi feito).
    if p_indicator = 'returns_scheduled' and cardinality(v_types) = 0 then
      v_types := array['return_visit', 'reevaluation'];
    end if;
    return query
      select a.clinic_id, a.created_by, (a.created_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.appointments a
       where a.created_at >= v_from and a.created_at < v_to
         and a.clinic_id = any (p_clinic_ids)
         and a.status::text <> 'cancelled'
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator in ('appointments_done', 'evaluations_done') then
    -- Atendimentos CONCLUÍDOS, pelo profissional do horário.
    if p_indicator = 'evaluations_done' then
      v_types := array['evaluation'];
    end if;
    return query
      select a.clinic_id, a.provider_user_id, (coalesce(a.done_at, a.ends_at) at time zone v_tz)::date,
             count(*)::numeric, null::numeric
        from public.appointments a
       where coalesce(a.done_at, a.ends_at) >= v_from and coalesce(a.done_at, a.ends_at) < v_to
         and a.clinic_id = any (p_clinic_ids)
         and (a.attendance::text = 'done' or a.status::text = 'completed')
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator in ('attendance_rate', 'no_show_rate') then
    -- Dos horários que JÁ passaram e tiveram desfecho: veio × faltou.
    -- "Veio" = chegou (check-in), foi atendido, ou desistiu depois de chegar.
    return query
      with b as (
        select a.clinic_id, a.created_by as user_id, (a.starts_at at time zone v_tz)::date as d,
               (a.checked_in_at is not null
                or a.attendance::text in ('done', 'gave_up', 'in_service')
                or a.status::text = 'completed') as came,
               a.status::text = 'no_show' as missed
          from public.appointments a
         where a.starts_at >= v_from and a.starts_at < v_to and a.starts_at < now()
           and a.clinic_id = any (p_clinic_ids)
           and a.status::text <> 'cancelled'
           and (cardinality(v_types) = 0 or a.type::text = any (v_types))
      )
      -- Horário passado SEM desfecho registrado fica fora das duas pontas.
      select b.clinic_id, b.user_id, b.d,
             100 * (count(*) filter (where b.came = (p_indicator = 'attendance_rate')))::numeric,
             count(*)::numeric
        from b
       where b.came or b.missed
       group by 1, 2, 3;

  elsif p_indicator = 'check_ins' then
    return query
      select a.clinic_id, a.checked_in_by, (a.checked_in_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.appointments a
       where a.checked_in_at >= v_from and a.checked_in_at < v_to
         and a.clinic_id = any (p_clinic_ids)
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator = 'procedures_done' then
    -- Sessões concluídas; quem executou (ou o indicado pelo Planner, como o repasse).
    return query
      select ts.clinic_id, coalesce(ts.executed_by, ts.planner_provider_id),
             (ts.done_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.treatment_sessions ts
        left join public.procedures p on p.id = ts.procedure_id
       where ts.status = 'done'
         and ts.done_at >= v_from and ts.done_at < v_to
         and ts.clinic_id = any (p_clinic_ids)
         and (cardinality(v_specialties) = 0 or p.specialty = any (v_specialties))
       group by 1, 2, 3;

  elsif p_indicator = 'new_clients' then
    -- A unidade de ORIGEM do cadastro (não muda com transferência).
    return query
      select coalesce(c.origin_clinic_id, c.clinic_id), c.created_by, (c.created_at at time zone v_tz)::date,
             count(*)::numeric, null::numeric
        from public.clients c
       where c.created_at >= v_from and c.created_at < v_to
         and coalesce(c.origin_clinic_id, c.clinic_id) = any (p_clinic_ids)
         and (cardinality(v_origins) = 0 or coalesce(c.origin_program, 'unidade') = any (v_origins))
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_adhesions' then
    -- Adesão vale na ATIVAÇÃO (contrato + 1º pagamento). Transferência não é nova.
    return query
      select m.clinic_id, m.sold_by, (m.activated_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.ppr_memberships m
       where m.activated_at >= v_from and m.activated_at < v_to
         and m.transferred_from_id is null
         and m.clinic_id = any (p_clinic_ids)
         and (cardinality(v_plans) = 0 or m.plan_id::text = any (v_plans))
       group by 1, 2, 3;

  else
    raise exception 'GOAL_UNKNOWN_INDICATOR';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) QUEM PODE (helpers)
-- -----------------------------------------------------------------------------
create or replace function public._goal_clinic_ids(p_scope text, p_clinic_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_scope = 'network'
    then coalesce((select array_agg(c.id order by c.name)
                     from public.clinics c
                    where c.type = 'franchise_unit' and c.is_active), '{}'::uuid[])
    else coalesce(p_clinic_ids, '{}'::uuid[])
  end;
$$;

-- D1: rede ou várias unidades = Admin e Franqueadora; UMA unidade = também o
-- Gerente e o Franqueado dela.
create or replace function public._goal_can_create(p_scope text, p_clinic_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and coalesce(
    public.is_admin_master()
    or public.is_network_viewer()
    or (p_scope = 'clinics'
        and cardinality(p_clinic_ids) = 1
        and public.has_role_in_clinic(p_clinic_ids[1], array['unit_manager', 'franchisee']::public.user_role[])),
    false);
$$;

create or replace function public._goal_can_edit(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public._goal_can_create(g.scope, g.clinic_ids)
                     from public.goals g where g.id = p_goal_id), false);
$$;

-- Os participantes, resolvidos AGORA (quem entra na equipe entra na meta).
-- Lê `user_clinic_roles_all`: a janela da 0277 dependeria de quem pergunta.
create or replace function public._goal_participants(p_goal_id uuid)
returns table (user_id uuid, roles text[], clinic_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select public._goal_clinic_ids(x.scope, x.clinic_ids) as cl
      from public.goals x where x.id = p_goal_id
  ),
  r as (
    select pr.kind, pr.role, pr.user_id from public.goal_participant_rules pr where pr.goal_id = p_goal_id
  ),
  m as (
    select ucr.user_id, ucr.role::text as role, ucr.clinic_id
      from public.user_clinic_roles_all ucr
      join g on true
     where (exists (select 1 from r where r.kind = 'all') and ucr.clinic_id = any (g.cl))
        or (ucr.role in (select r.role from r where r.kind = 'role')
            and (ucr.clinic_id = any (g.cl)
                 or exists (select 1 from public.clinics c
                             where c.id = ucr.clinic_id and c.type = 'franchisor')))
    union
    select r.user_id, null::text, null::uuid from r where r.kind = 'user'
  )
  select m.user_id,
         array_remove(array_agg(distinct m.role), null),
         array_remove(array_agg(distinct m.clinic_id), null)
    from m
    join public.profiles p on p.id = m.user_id and p.is_active
   group by m.user_id;
$$;

create or replace function public._goal_is_participant(p_goal_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public._goal_participants(p_goal_id) p where p.user_id = p_user_id);
$$;

-- Quem VÊ a meta. Rascunho: só quem pode editar (e quem criou).
create or replace function public.can_view_goal(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and coalesce((
    select public.is_admin_master()
        or public.is_network_viewer()
        or g.created_by = (select auth.uid())
        or public._goal_can_create(g.scope, g.clinic_ids)
        or (g.status <> 'draft' and (
              exists (select 1 from public.user_clinic_roles ucr
                       where ucr.user_id = (select auth.uid())
                         and ucr.role in ('unit_manager', 'franchisee', 'clinical_coordinator')
                         and (g.scope = 'network' or ucr.clinic_id = any (g.clinic_ids)))
              or public._goal_is_participant(g.id, (select auth.uid()))))
      from public.goals g where g.id = p_goal_id), false);
$$;

-- D3: quem vê o valor em R$. Quem edita, os gestores e quem já vê o
-- financeiro de TODAS as unidades da meta.
create or replace function public._goal_sees_money(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and coalesce((
    select public.is_admin_master()
        or public.is_network_viewer()
        or public._goal_can_create(g.scope, g.clinic_ids)
        or not exists (
             select 1 from unnest(public._goal_clinic_ids(g.scope, g.clinic_ids)) as c (id)
              where not (coalesce(public.can_see_clinic_finance(c.id), false)
                         or public.has_role_in_clinic(c.id, array['unit_manager', 'franchisee']::public.user_role[])))
      from public.goals g where g.id = p_goal_id), false);
$$;

-- -----------------------------------------------------------------------------
-- 5) O RESULTADO (interno): soma, por unidade, por pessoa e por dia
-- -----------------------------------------------------------------------------
create or replace function public._goal_value(p_entry jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_entry is null then null
    when p_entry -> 'den' is null or jsonb_typeof(p_entry -> 'den') = 'null' then (p_entry ->> 'num')::numeric
    when (p_entry ->> 'den')::numeric = 0 then null
    else (p_entry ->> 'num')::numeric / (p_entry ->> 'den')::numeric
  end;
$$;

create or replace function public._goal_achieved(p_direction text, p_value numeric, p_target numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_target is null then null
    when p_direction = 'decrease' then p_value <= p_target
    else p_value >= p_target
  end;
$$;

-- `p_indicator`/`p_filters` nulos = os da própria meta (os marcos passam os seus).
-- Indicador por pessoa com participantes restritos (função/pessoas) conta só o
-- que os participantes fizeram; com "unidade toda" conta tudo da unidade.
create or replace function public._goal_snapshot(
  p_goal_id uuid,
  p_from date,
  p_to date,
  p_indicator text default null,
  p_filters jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_ind text;
  v_cl uuid[];
  v_parts uuid[];
  v_restrict boolean;
  v_kind text;
  v_out jsonb;
begin
  select * into g from public.goals where id = p_goal_id;
  if not found then return null; end if;
  v_ind := coalesce(p_indicator, g.indicator);
  select m.kind into v_kind from public._goal_indicator_meta(v_ind) m;
  v_cl := public._goal_clinic_ids(g.scope, g.clinic_ids);
  select coalesce(array_agg(p.user_id), '{}'::uuid[]) into v_parts from public._goal_participants(p_goal_id) p;
  v_restrict := coalesce((select m.per_person from public._goal_indicator_meta(v_ind) m), false)
                and not exists (select 1 from public.goal_participant_rules r
                                 where r.goal_id = p_goal_id and r.kind = 'all');

  with raw as (
    select * from public._goal_measure_raw(v_ind, coalesce(p_filters, g.filters), v_cl, p_from, p_to)
  ),
  f as (
    select * from raw where not v_restrict or raw.user_id = any (v_parts)
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'kind', v_kind,
    'n_clinics', cardinality(v_cl),
    'n_participants', cardinality(v_parts),
    'restricted', v_restrict,
    'total', (select jsonb_build_object('num', coalesce(sum(f.num), 0), 'den', sum(f.den)) from f),
    'by_clinic', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.clinic_id, 'num', x.n, 'den', x.d))
        from (select f.clinic_id, sum(f.num) as n, sum(f.den) as d from f group by f.clinic_id) x), '[]'::jsonb),
    'by_user', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.user_id, 'num', x.n, 'den', x.d))
        from (select f.user_id, sum(f.num) as n, sum(f.den) as d
                from f where f.user_id = any (v_parts) group by f.user_id) x), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', x.day, 'num', x.n, 'den', x.d) order by x.day)
        from (select f.day, sum(f.num) as n, sum(f.den) as d from f group by f.day) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- O alvo de uma pessoa / unidade (D2): o ajuste manual, senão a regra.
create or replace function public._goal_subject_target(
  p_goal public.goals, p_subject_kind text, p_subject_id uuid, p_n integer
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.target_value from public.goal_targets t
      where t.goal_id = p_goal.id and t.subject_kind = p_subject_kind and t.subject_id = p_subject_id),
    case
      when p_subject_kind = 'user' and p_goal.individual_rule = 'same' then p_goal.individual_value
      when (select m.kind from public._goal_indicator_meta(p_goal.indicator) m) = 'rate' then
        case when p_subject_kind = 'user' then p_goal.individual_value else p_goal.target_value end
      when p_n > 0 then p_goal.target_value / p_n
      else null
    end);
$$;

-- D3: troca valores por percentual para quem não vê dinheiro. O próprio
-- número da pessoa continua visível para ela.
create or replace function public._goal_hide_money(p_goal public.goals, p_snap jsonb, p_target numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_pct numeric;
  v_out jsonb := p_snap;
begin
  if p_snap is null then return null; end if;
  v_pct := case when p_target > 0 then round(public._goal_value(p_snap -> 'total') / p_target * 100, 1) end;
  v_out := jsonb_set(v_out, '{total}', jsonb_build_object('pct', v_pct));
  -- A linha da unidade cujo dinheiro a pessoa já vê continua em R$.
  v_out := jsonb_set(v_out, '{by_clinic}', coalesce((
    select jsonb_agg(case
           when coalesce(public.can_see_clinic_finance((e ->> 'id')::uuid), false)
             or public.has_role_in_clinic((e ->> 'id')::uuid, array['unit_manager', 'franchisee']::public.user_role[])
           then e
           else jsonb_build_object('id', e ->> 'id', 'pct',
             (select round(public._goal_value(e) / nullif(t, 0) * 100, 1)
                from (select public._goal_subject_target(p_goal, 'clinic', (e ->> 'id')::uuid,
                                                         (p_snap ->> 'n_clinics')::int) as t) tt)) end)
      from jsonb_array_elements(p_snap -> 'by_clinic') e), '[]'::jsonb));
  v_out := jsonb_set(v_out, '{by_user}', coalesce((
    select jsonb_agg(case when (e ->> 'id')::uuid = v_me then e
           else jsonb_build_object('id', e ->> 'id', 'pct',
             (select round(public._goal_value(e) / nullif(t, 0) * 100, 1)
                from (select public._goal_subject_target(p_goal, 'user', (e ->> 'id')::uuid,
                                                         (p_snap ->> 'n_participants')::int) as t) tt)) end)
      from jsonb_array_elements(p_snap -> 'by_user') e), '[]'::jsonb));
  v_out := jsonb_set(v_out, '{by_day}', case when p_snap ->> 'kind' = 'sum' and p_target > 0 then coalesce((
    select jsonb_agg(jsonb_build_object('day', e ->> 'day', 'pct', round((e ->> 'num')::numeric / p_target * 100, 2)))
      from jsonb_array_elements(p_snap -> 'by_day') e), '[]'::jsonb) else '[]'::jsonb end);
  return v_out || jsonb_build_object('money_hidden', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) CONGELAR (rotina diária)
-- -----------------------------------------------------------------------------
create or replace function public._goal_freeze(p_goal_id uuid, p_kind text, p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_snap jsonb;
  v_value numeric;
  v_ok int;
  v_total int;
begin
  select * into g from public.goals where id = p_goal_id;
  if not found then return; end if;
  if exists (select 1 from public.goal_results r
              where r.goal_id = p_goal_id and r.kind = p_kind and r.period_start = p_from) then
    return;
  end if;
  v_snap := public._goal_snapshot(p_goal_id, p_from, p_to);
  v_value := public._goal_value(v_snap -> 'total');

  select count(*) filter (where x.ok), count(*) into v_ok, v_total
    from (
      select public._goal_achieved(
               g.direction,
               coalesce(public._goal_value(u.e),
                        case when v_snap ->> 'kind' = 'sum' then 0 end),
               public._goal_subject_target(g, 'user', p.user_id, (v_snap ->> 'n_participants')::int)) as ok
        from public._goal_participants(p_goal_id) p
        left join lateral (
          select e from jsonb_array_elements(v_snap -> 'by_user') e
           where (e ->> 'id')::uuid = p.user_id
        ) u on true
    ) x;

  insert into public.goal_results
    (goal_id, kind, period_start, period_end, snapshot, value, achieved, stretch_achieved, people_achieved, people_total)
  values (
    p_goal_id, p_kind, p_from, p_to, v_snap, v_value,
    case when g.target_mode = 'individual' then (v_total > 0 and v_ok = v_total)
         else public._goal_achieved(g.direction, v_value, g.target_value) end,
    case when g.target_mode <> 'individual' and g.stretch_value is not null
         then public._goal_achieved(g.direction, v_value, g.stretch_value) end,
    case when g.target_mode <> 'collective' then v_ok end,
    case when g.target_mode <> 'collective' then v_total end)
  on conflict (goal_id, kind, period_start) do nothing;
end;
$$;

create or replace function public._goal_finish(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.goals;
  m date;
  v_outcome text;
  v_all boolean;
  v_stretch boolean;
  v_nodata boolean;
begin
  select * into g from public.goals where id = p_goal_id for update;
  if not found or g.status in ('finished', 'cancelled', 'draft') then return; end if;

  if g.periodicity = 'monthly' then
    m := date_trunc('month', g.starts_on)::date;
    while m <= g.ends_on loop
      perform public._goal_freeze(p_goal_id, 'period', greatest(m, g.starts_on),
                                  least((m + interval '1 month')::date - 1, g.ends_on));
      m := (m + interval '1 month')::date;
    end loop;
  end if;
  perform public._goal_freeze(p_goal_id, 'final', g.starts_on, g.ends_on);

  if g.periodicity = 'monthly' then
    select bool_and(coalesce(r.achieved, false)), bool_and(coalesce(r.stretch_achieved, false)),
           bool_or(r.achieved is null)
      into v_all, v_stretch, v_nodata
      from public.goal_results r where r.goal_id = p_goal_id and r.kind = 'period';
  else
    select coalesce(r.achieved, false), coalesce(r.stretch_achieved, false), r.achieved is null
      into v_all, v_stretch, v_nodata
      from public.goal_results r where r.goal_id = p_goal_id and r.kind = 'final';
  end if;
  v_outcome := case when v_nodata then 'no_data'
                    when v_all and v_stretch then 'stretch'
                    when v_all then 'achieved'
                    else 'not_achieved' end;

  update public.goal_pauses set resumed_at = now() where goal_id = p_goal_id and resumed_at is null;
  update public.goals
     set status = 'finished', outcome = v_outcome, finished_at = now(), updated_at = now()
   where id = p_goal_id;
end;
$$;

create or replace function public.goals_daily_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
  v_started int := 0;
  v_finished int := 0;
  r record;
  m date;
begin
  update public.goals set status = 'active', updated_at = now()
   where status = 'scheduled' and starts_on <= v_today;
  get diagnostics v_started = row_count;

  -- Meta mensal: congela cada mês que já terminou.
  for r in select id, starts_on, ends_on from public.goals
            where periodicity = 'monthly' and status in ('active', 'paused') loop
    m := date_trunc('month', r.starts_on)::date;
    while (m + interval '1 month')::date - 1 < v_today and m <= r.ends_on loop
      perform public._goal_freeze(r.id, 'period', greatest(m, r.starts_on),
                                  least((m + interval '1 month')::date - 1, r.ends_on));
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  -- Prazo encerrado (pausada também: o prazo não se estende sozinho — D4).
  for r in select id from public.goals
            where status in ('scheduled', 'active', 'paused') and ends_on < v_today loop
    perform public._goal_finish(r.id);
    v_finished := v_finished + 1;
  end loop;

  return jsonb_build_object('started', v_started, 'finished', v_finished);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) PORTAS DE LEITURA
-- -----------------------------------------------------------------------------
-- O realizado: o período corrente ao vivo + o que já foi congelado + marcos.
create or replace function public.goal_measure(p_goal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_today date := public.today_br();
  v_from date;
  v_to date;
  v_money boolean;
  v_sees boolean;
  v_live jsonb;
  v_frozen jsonb;
  v_marcos jsonb;
begin
  if (select auth.uid()) is null or not public.can_view_goal(p_goal_id) then
    raise exception 'GOAL_NOT_ALLOWED';
  end if;
  select * into g from public.goals where id = p_goal_id;
  v_money := coalesce((select m.money from public._goal_indicator_meta(g.indicator) m), false);
  v_sees := not v_money or public._goal_sees_money(p_goal_id);

  -- Ao vivo: só enquanto não houver o resultado final congelado.
  if g.status <> 'cancelled'
     and not exists (select 1 from public.goal_results r where r.goal_id = p_goal_id and r.kind = 'final')
     and g.starts_on <= v_today then
    v_to := least(g.ends_on, v_today);
    v_from := case when g.periodicity = 'monthly'
                   then greatest(g.starts_on, date_trunc('month', v_to)::date)
                   else g.starts_on end;
    v_live := public._goal_snapshot(p_goal_id, v_from, v_to);
    if not v_sees then v_live := public._goal_hide_money(g, v_live, g.target_value); end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', r.kind, 'from', r.period_start, 'to', r.period_end,
           'achieved', r.achieved, 'stretch', r.stretch_achieved,
           'people_achieved', r.people_achieved, 'people_total', r.people_total,
           'measured_at', r.measured_at,
           'snapshot', case when v_sees then r.snapshot
                            else public._goal_hide_money(g, r.snapshot, g.target_value) end)
         order by r.kind desc, r.period_start), '[]'::jsonb)
    into v_frozen
    from public.goal_results r where r.goal_id = p_goal_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ms.id,
           'snapshot', case
             when g.starts_on > v_today or g.status = 'cancelled' then null
             when not coalesce((select m.money from public._goal_indicator_meta(ms.indicator) m), false)
                  or public._goal_sees_money(p_goal_id)
               then public._goal_snapshot(p_goal_id, g.starts_on, least(ms.due_on, v_today), ms.indicator, ms.filters)
             else public._goal_hide_money(g,
                    public._goal_snapshot(p_goal_id, g.starts_on, least(ms.due_on, v_today), ms.indicator, ms.filters),
                    ms.target_value) end)
         order by ms.position), '[]'::jsonb)
    into v_marcos
    from public.goal_milestones ms where ms.goal_id = p_goal_id;

  return jsonb_build_object(
    'today', v_today,
    'money_hidden', not v_sees,
    'live', v_live,
    'frozen', v_frozen,
    'milestones', v_marcos);
end;
$$;

-- A linha de base no assistente: o mesmo indicador num período anterior,
-- com o total e mês a mês (para o selo de "atingível").
create or replace function public.goal_measure_preview(
  p_indicator text,
  p_filters jsonb,
  p_scope text,
  p_clinic_ids uuid[],
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cl uuid[];
  v_out jsonb;
begin
  if not public._goal_can_create(p_scope, coalesce(p_clinic_ids, '{}'::uuid[])) then
    raise exception 'GOAL_NOT_ALLOWED';
  end if;
  if not exists (select 1 from public._goal_indicator_meta(p_indicator)) then
    raise exception 'GOAL_UNKNOWN_INDICATOR';
  end if;
  v_cl := public._goal_clinic_ids(p_scope, p_clinic_ids);
  with f as (select * from public._goal_measure_raw(p_indicator, p_filters, v_cl, p_from, p_to))
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', (select jsonb_build_object('num', coalesce(sum(f.num), 0), 'den', sum(f.den)) from f),
    'people', (select count(distinct f.user_id) from f where f.user_id is not null),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', x.mo, 'num', x.n, 'den', x.d) order by x.mo)
        from (select date_trunc('month', f.day)::date as mo, sum(f.num) as n, sum(f.den) as d
                from f group by 1) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

create or replace function public.goal_participants(p_goal_id uuid)
returns table (user_id uuid, full_name text, roles text[], clinic_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.can_view_goal(p_goal_id) then
    raise exception 'GOAL_NOT_ALLOWED';
  end if;
  return query
    select p.user_id, pr.full_name, p.roles, p.clinic_ids
      from public._goal_participants(p_goal_id) p
      join public.profiles pr on pr.id = p.user_id
     order by pr.full_name;
end;
$$;

-- As metas em que QUEM CHAMA participa (cartão "Minhas metas" do Início).
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
     and g.status in ('scheduled', 'active', 'paused')
     and public._goal_is_participant(g.id, (select auth.uid()));
$$;

-- Quem pode ser escolhido no assistente (das unidades da meta, mais a equipe
-- da Franqueadora que atende as unidades).
drop function if exists public.goal_candidates(text, uuid[]);
create or replace function public.goal_candidates(p_scope text, p_clinic_ids uuid[])
returns table (user_id uuid, full_name text, role text, clinic_id uuid, at_franchisor boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cl uuid[];
begin
  if not public._goal_can_create(p_scope, coalesce(p_clinic_ids, '{}'::uuid[])) then
    raise exception 'GOAL_NOT_ALLOWED';
  end if;
  v_cl := public._goal_clinic_ids(p_scope, p_clinic_ids);
  return query
    select distinct ucr.user_id, p.full_name, ucr.role::text, ucr.clinic_id, c.type = 'franchisor'
      from public.user_clinic_roles_all ucr
      join public.profiles p on p.id = ucr.user_id and p.is_active
      join public.clinics c on c.id = ucr.clinic_id
     where ucr.clinic_id = any (v_cl) or c.type = 'franchisor'
     order by p.full_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) PORTAS DE GRAVAÇÃO
-- -----------------------------------------------------------------------------
create or replace function public._goal_export(p_goal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(g) - 'created_at' - 'updated_at' - 'updated_by'
         || jsonb_build_object(
              'rules', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'role', r.role, 'user_id', r.user_id)
                                                  order by r.kind, r.role, r.user_id)
                                   from public.goal_participant_rules r where r.goal_id = g.id), '[]'::jsonb),
              'targets', coalesce((select jsonb_agg(jsonb_build_object('subject_kind', t.subject_kind,
                                                    'subject_id', t.subject_id, 'target_value', t.target_value)
                                                    order by t.subject_kind, t.subject_id)
                                     from public.goal_targets t where t.goal_id = g.id), '[]'::jsonb),
              'milestones', coalesce((select jsonb_agg(jsonb_build_object('label', m.label, 'indicator', m.indicator,
                                                       'filters', m.filters, 'due_on', m.due_on,
                                                       'target_value', m.target_value) order by m.position)
                                        from public.goal_milestones m where m.goal_id = g.id), '[]'::jsonb))
    from public.goals g where g.id = p_goal_id;
$$;

-- Cria (p_goal_id nulo) ou altera. Depois de publicada: indicador, recorte,
-- abrangência, modo, direção e periodicidade ficam TRAVADOS (mudar isso é
-- outra meta), e toda alteração exige motivo e entra no histórico.
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
  v_kind text;
  v_before jsonb;
  v_after jsonb;
  v_starts date := (p_data ->> 'starts_on')::date;
  v_ends date := (p_data ->> 'ends_on')::date;
  r jsonb;
  i int := 0;
begin
  if v_user is null then raise exception 'GOAL_NOT_ALLOWED'; end if;
  if v_scope = 'network' then v_clinics := '{}'; end if;
  if nullif(trim(coalesce(p_data ->> 'name', '')), '') is null then raise exception 'GOAL_NAME_REQUIRED'; end if;
  select m.kind into v_kind from public._goal_indicator_meta(p_data ->> 'indicator') m;
  if v_kind is null then raise exception 'GOAL_UNKNOWN_INDICATOR'; end if;
  if v_starts is null or v_ends is null or v_ends < v_starts then raise exception 'GOAL_BAD_PERIOD'; end if;
  if v_kind = 'sum' and coalesce(p_data ->> 'direction', 'increase') <> 'increase' then
    raise exception 'GOAL_BAD_DIRECTION';
  end if;
  if v_kind = 'rate' and p_data ->> 'individual_rule' = 'split' then raise exception 'GOAL_RATE_SPLIT'; end if;
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
         or g.direction <> coalesce(p_data ->> 'direction', g.direction)
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
    direction = coalesce(p_data ->> 'direction', 'increase'),
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
    if not exists (select 1 from public._goal_indicator_meta(r ->> 'indicator')) then
      raise exception 'GOAL_UNKNOWN_INDICATOR';
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

-- Publicar: as cinco letras precisam estar preenchidas.
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
  return v_status;
end;
$$;

-- pausar / retomar / cancelar / descartar (rascunho).
create or replace function public.goal_change_status(p_goal_id uuid, p_action text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_user uuid := (select auth.uid());
  v_today date := public.today_br();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_new text;
begin
  select * into g from public.goals where id = p_goal_id for update;
  if not found then raise exception 'GOAL_NOT_FOUND'; end if;
  if not public._goal_can_create(g.scope, g.clinic_ids) then raise exception 'GOAL_NOT_ALLOWED'; end if;

  if p_action = 'discard' then
    if g.status <> 'draft' then raise exception 'GOAL_NOT_DRAFT'; end if;
    delete from public.goals where id = p_goal_id;
    return 'discarded';
  end if;

  if v_reason is null then raise exception 'GOAL_REASON_REQUIRED'; end if;

  if p_action = 'pause' then
    if g.status not in ('active', 'scheduled') then raise exception 'GOAL_BAD_TRANSITION'; end if;
    insert into public.goal_pauses (goal_id, paused_by, reason) values (p_goal_id, v_user, v_reason);
    v_new := 'paused';
  elsif p_action = 'resume' then
    if g.status <> 'paused' then raise exception 'GOAL_BAD_TRANSITION'; end if;
    update public.goal_pauses set resumed_at = now(), resumed_by = v_user
     where goal_id = p_goal_id and resumed_at is null;
    v_new := case when g.starts_on > v_today then 'scheduled' else 'active' end;
  elsif p_action = 'cancel' then
    if g.status in ('finished', 'cancelled', 'draft') then raise exception 'GOAL_BAD_TRANSITION'; end if;
    update public.goal_pauses set resumed_at = now() where goal_id = p_goal_id and resumed_at is null;
    v_new := 'cancelled';
  else
    raise exception 'GOAL_BAD_TRANSITION';
  end if;

  update public.goals
     set status = v_new,
         status_reason = v_reason,
         cancelled_at = case when v_new = 'cancelled' then now() else cancelled_at end,
         cancelled_by = case when v_new = 'cancelled' then v_user else cancelled_by end,
         updated_by = v_user,
         updated_at = now()
   where id = p_goal_id;
  insert into public.goal_changes (goal_id, changed_by, kind, reason)
  values (p_goal_id, v_user, p_action, v_reason);
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) RLS — leitura por `can_view_goal`; gravação só pelas funções
-- -----------------------------------------------------------------------------
alter table public.goals enable row level security;
alter table public.goal_participant_rules enable row level security;
alter table public.goal_targets enable row level security;
alter table public.goal_milestones enable row level security;
alter table public.goal_pauses enable row level security;
alter table public.goal_changes enable row level security;
alter table public.goal_results enable row level security;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
  for select to authenticated using (public.can_view_goal(id));

drop policy if exists goal_participant_rules_select on public.goal_participant_rules;
create policy goal_participant_rules_select on public.goal_participant_rules
  for select to authenticated using (public.can_view_goal(goal_id));

drop policy if exists goal_targets_select on public.goal_targets;
create policy goal_targets_select on public.goal_targets
  for select to authenticated using (public.can_view_goal(goal_id));

drop policy if exists goal_milestones_select on public.goal_milestones;
create policy goal_milestones_select on public.goal_milestones
  for select to authenticated using (public.can_view_goal(goal_id));

drop policy if exists goal_pauses_select on public.goal_pauses;
create policy goal_pauses_select on public.goal_pauses
  for select to authenticated using (public.can_view_goal(goal_id));

drop policy if exists goal_changes_select on public.goal_changes;
create policy goal_changes_select on public.goal_changes
  for select to authenticated using (public.can_view_goal(goal_id));

-- goal_results: sem regra de leitura (só `goal_measure`, por causa da D3).

-- -----------------------------------------------------------------------------
-- 10) ROTINA DIÁRIA (02:20 no Brasil)
-- -----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('risarte-metas-diaria');
  exception when others then
    null;
  end;
  perform cron.schedule('risarte-metas-diaria', '20 5 * * *', 'select public.goals_daily_run()');
exception when others then
  raise warning 'METAS: não foi possível agendar a rotina diária (pg_cron): %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11) PERMISSÕES DE EXECUÇÃO (AP15) e DA MATRIZ
-- -----------------------------------------------------------------------------
revoke execute on function public._goal_indicator_meta(text) from public, anon, authenticated;
revoke execute on function public._goal_measure_raw(text, jsonb, uuid[], date, date) from public, anon, authenticated;
revoke execute on function public._goal_clinic_ids(text, uuid[]) from public, anon, authenticated;
revoke execute on function public._goal_can_create(text, uuid[]) from public, anon, authenticated;
revoke execute on function public._goal_can_edit(uuid) from public, anon, authenticated;
revoke execute on function public._goal_participants(uuid) from public, anon, authenticated;
revoke execute on function public._goal_is_participant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._goal_sees_money(uuid) from public, anon, authenticated;
revoke execute on function public._goal_value(jsonb) from public, anon, authenticated;
revoke execute on function public._goal_achieved(text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public._goal_snapshot(uuid, date, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public._goal_subject_target(public.goals, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public._goal_hide_money(public.goals, jsonb, numeric) from public, anon, authenticated;
revoke execute on function public._goal_freeze(uuid, text, date, date) from public, anon, authenticated;
revoke execute on function public._goal_finish(uuid) from public, anon, authenticated;
revoke execute on function public._goal_export(uuid) from public, anon, authenticated;
revoke execute on function public.goals_daily_run() from public, anon, authenticated;

revoke execute on function public.can_view_goal(uuid) from public, anon, authenticated;
grant execute on function public.can_view_goal(uuid) to authenticated;
revoke execute on function public.goal_measure(uuid) from public, anon, authenticated;
grant execute on function public.goal_measure(uuid) to authenticated;
revoke execute on function public.goal_measure_preview(text, jsonb, text, uuid[], date, date) from public, anon, authenticated;
grant execute on function public.goal_measure_preview(text, jsonb, text, uuid[], date, date) to authenticated;
revoke execute on function public.goal_participants(uuid) from public, anon, authenticated;
grant execute on function public.goal_participants(uuid) to authenticated;
revoke execute on function public.my_goal_ids() from public, anon, authenticated;
grant execute on function public.my_goal_ids() to authenticated;
revoke execute on function public.goal_candidates(text, uuid[]) from public, anon, authenticated;
grant execute on function public.goal_candidates(text, uuid[]) to authenticated;
revoke execute on function public.goal_save(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.goal_save(uuid, jsonb, text) to authenticated;
revoke execute on function public.goal_publish(uuid) from public, anon, authenticated;
grant execute on function public.goal_publish(uuid) to authenticated;
revoke execute on function public.goal_change_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.goal_change_status(uuid, text, text) to authenticated;

-- A matriz de permissões: o módulo para toda a equipe; criar de rede para a
-- Franqueadora; criar da unidade para Gerente e Franqueado. Só semeia se a
-- matriz já estiver em uso — semear numa matriz vazia trocaria o padrão de
-- código de TODAS as permissões por estas três.
do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select 'modulo.metas', r
      from unnest(enum_range(null::public.user_role)) as r
    on conflict (capability, role) do nothing;
    insert into public.permission_matrix (capability, role) values
      ('acao.metas.criar_rede', 'franchisor_staff'),
      ('acao.metas.criar_unidade', 'unit_manager'),
      ('acao.metas.criar_unidade', 'franchisee')
    on conflict (capability, role) do nothing;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12) AUDITORIA (0288)
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'goal_changes', 'Histórico da própria meta (já registra quem, quando, antes e depois).'),
  ('public', 'goal_results', 'Fotografia derivada (resultado congelado pela rotina diária).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();
