-- =============================================================================
-- 0290 — PAINEL DE USO DO SISTEMA + FILTROS POR UNIDADE E POR FUNÇÃO (auditoria)
-- -----------------------------------------------------------------------------
-- Pedido do dono (13/10/2026): "vamos criar os filtros por unidade e por
-- função. E também criar um dashboard na auditoria com ranking de quem mais
-- acessou o sistema, quem mais ficou logado, quem mais teve atividades, quem
-- menos interagiu, quem menos logou, quem está há mais tempo sem logar. [...]
-- que seja inteligente e úteis as informações."
--
-- O QUE ESTA MIGRAÇÃO FAZ — só funções de CONSULTA, nenhuma tabela, nenhum dado:
--
--   1. `audit_usage_members(unidade, função)` — QUEM entra no recorte. Interna.
--   2. `audit_activity_report` ganha os dois filtros (era pessoa só) e a
--      CORREÇÃO DO TEMPO: o acesso conta até a última atividade, não até a
--      hora em que o sistema o encerrou (ver o comentário na função).
--   3. `audit_usage_people` — uma linha por PESSOA: o período, o período
--      anterior de mesmo tamanho (para dizer se o uso subiu ou caiu) e a vida
--      inteira (primeiro e último acesso, último login).
--   4. `audit_usage_days` — uma linha por DIA: quantas pessoas entraram.
--   5. `audit_usage_hours` — dia da semana × hora: quando o sistema é usado.
--
-- O QUE "DA UNIDADE" QUER DIZER: a pessoa TEM UMA FUNÇÃO naquela unidade. Não é
-- "o que aconteceu naquela unidade": o acesso não tem unidade (a pessoa entra
-- no sistema, não numa clínica), e filtrar só as ações deixaria o tempo de uso
-- de fora. Quem tem função em duas unidades aparece nas duas.
-- Lê `user_clinic_roles_all` (a tabela), não a janela `user_clinic_roles`: a
-- função da pessoa existe mesmo com o sistema real fechado para ela.
--
-- POR QUE UMA LINHA POR PESSOA VEM PRONTA DO BANCO: a API devolve no máximo
-- 1.000 linhas por chamada (medido em 13/10/2026). Somar no navegador as
-- linhas pessoa×dia de 90 dias mostraria um ranking cortado, sem avisar.
--
-- A CONTA É UMA SÓ: as três funções novas chamam `audit_activity_report` e
-- somam o que ela devolve. Se o painel fizesse a própria conta, ele e o
-- relatório divergiriam na primeira mudança.
--
-- SÓ O ADMIN MASTER. Para qualquer outra pessoa tudo devolve vazio; sem login,
-- nem responde. O último login vem de `auth.users`, SÓ LEITURA.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) QUEM ENTRA NO RECORTE
-- -----------------------------------------------------------------------------
-- Sem filtro: todo mundo. `p_role = 'admin_master'` não é função de unidade: é
-- a marca global do perfil.
create or replace function public.audit_usage_members(p_clinic uuid, p_role text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where public.is_admin_master()
    and (
      (p_clinic is null and p_role is null)
      or (
        p_role = 'admin_master'
        and p.is_admin_master
        and (
          p_clinic is null
          or exists (
            select 1 from public.user_clinic_roles_all r
            where r.user_id = p.id and r.clinic_id = p_clinic
          )
        )
      )
      or (
        p_role is distinct from 'admin_master'
        and exists (
          select 1 from public.user_clinic_roles_all r
          where r.user_id = p.id
            and (p_clinic is null or r.clinic_id = p_clinic)
            and (p_role is null or r.role::text = p_role)
        )
      )
    );
$$;

revoke execute on function public.audit_usage_members(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) O RELATÓRIO PESSOA × DIA, AGORA COM UNIDADE E FUNÇÃO
-- -----------------------------------------------------------------------------
drop function if exists public.audit_activity_report(date, date, uuid);
drop function if exists public.audit_activity_report(date, date, uuid, uuid, text);

create function public.audit_activity_report(
  p_from date,
  p_to date,
  p_user uuid default null,
  p_clinic uuid default null,
  p_role text default null
)
returns table (
  user_id uuid,
  day date,
  sessions integer,
  first_access timestamptz,
  last_activity timestamptz,
  active_seconds bigint,
  total_seconds bigint,
  idle_logouts integer,
  day_change_logouts integer,
  actions integer,
  views integer,
  exports integer,
  inserts integer,
  updates integer,
  deletes integer,
  rows_touched integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with lim as (
    -- No máximo um ano por consulta; período invertido ou vazio = nada.
    select p_from as de, least(p_to, p_from + 366) as ate
    where public.is_admin_master()
      and p_from is not null and p_to is not null and p_to >= p_from
  ),
  quem as (
    -- Só é consultado quando há filtro de unidade ou de função.
    select m.id as user_id
    from public.audit_usage_members(p_clinic, p_role) as m(id)
    where p_clinic is not null or p_role is not null
  ),
  sess as (
    select
      a.user_id,
      a.access_day as day,
      -- ⚠️ ATÉ QUANDO O ACESSO CONTA (corrige a 0289): até a saída, se a pessoa
      -- clicou em Sair; senão, até a ÚLTIMA ATIVIDADE. "Inatividade" e "virada
      -- do dia" são gravadas quando o sistema nota — às vezes dias depois —, e
      -- esse intervalo virava "tempo parado" (91 horas num caso do treino).
      -- É a mesma regra de `fimDoAcesso`, em `src/lib/acesso.ts`.
      greatest(0, round(extract(epoch from (
        (case when a.end_reason = 'saiu' and a.ended_at is not null then a.ended_at else a.last_activity_at end)
        - a.started_at
      ))))::bigint as total_s,
      greatest(0, a.active_seconds)::bigint as active_s,
      a.started_at,
      a.last_activity_at,
      a.end_reason
    from public.access_sessions a
    cross join lim
    where a.access_day between lim.de and lim.ate
      and a.user_id is not null
      and (p_user is null or a.user_id = p_user)
      and ((p_clinic is null and p_role is null) or a.user_id in (select q.user_id from quem q))
  ),
  s as (
    select
      sess.user_id,
      sess.day,
      count(*)::integer as sessions,
      min(sess.started_at) as first_access,
      max(sess.last_activity_at) as last_activity,
      sum(least(sess.total_s, sess.active_s))::bigint as active_seconds,
      sum(sess.total_s)::bigint as total_seconds,
      (count(*) filter (where sess.end_reason = 'inatividade'))::integer as idle_logouts,
      (count(*) filter (where sess.end_reason = 'virada_do_dia'))::integer as day_change_logouts
    from sess
    group by sess.user_id, sess.day
  ),
  l as (
    select
      g.user_id,
      (g.created_at at time zone 'America/Sao_Paulo')::date as day,
      (count(*) filter (where g.action not in ('login', 'logout')))::integer as actions,
      (count(*) filter (where g.action = 'view'))::integer as views,
      (count(*) filter (where g.action = 'export'))::integer as exports
    from public.audit_logs g
    cross join lim
    where g.created_at >= (lim.de::timestamp at time zone 'America/Sao_Paulo')
      and g.created_at < ((lim.ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and g.user_id is not null
      and (p_user is null or g.user_id = p_user)
      and ((p_clinic is null and p_role is null) or g.user_id in (select q.user_id from quem q))
    group by g.user_id, (g.created_at at time zone 'America/Sao_Paulo')::date
  ),
  c as (
    select
      m.user_id,
      (m.occurred_at at time zone 'America/Sao_Paulo')::date as day,
      (count(*) filter (where m.op = 'I'))::integer as inserts,
      (count(*) filter (where m.op = 'U'))::integer as updates,
      (count(*) filter (where m.op = 'D'))::integer as deletes,
      (count(distinct (m.schema_name, m.table_name, coalesce(m.row_id, ''))))::integer as rows_touched
    from public.audit_changes m
    cross join lim
    where m.occurred_at >= (lim.de::timestamp at time zone 'America/Sao_Paulo')
      and m.occurred_at < ((lim.ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and m.user_id is not null
      and (p_user is null or m.user_id = p_user)
      and ((p_clinic is null and p_role is null) or m.user_id in (select q.user_id from quem q))
    group by m.user_id, (m.occurred_at at time zone 'America/Sao_Paulo')::date
  ),
  k as (
    select s.user_id, s.day from s
    union
    select l.user_id, l.day from l
    union
    select c.user_id, c.day from c
  )
  select
    k.user_id,
    k.day,
    coalesce(s.sessions, 0),
    s.first_access,
    s.last_activity,
    coalesce(s.active_seconds, 0)::bigint,
    coalesce(s.total_seconds, 0)::bigint,
    coalesce(s.idle_logouts, 0),
    coalesce(s.day_change_logouts, 0),
    coalesce(l.actions, 0),
    coalesce(l.views, 0),
    coalesce(l.exports, 0),
    coalesce(c.inserts, 0),
    coalesce(c.updates, 0),
    coalesce(c.deletes, 0),
    coalesce(c.rows_touched, 0)
  from k
  left join s on s.user_id = k.user_id and s.day = k.day
  left join l on l.user_id = k.user_id and l.day = k.day
  left join c on c.user_id = k.user_id and c.day = k.day
  order by k.day desc, k.user_id;
$$;

revoke execute on function public.audit_activity_report(date, date, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.audit_activity_report(date, date, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) UMA LINHA POR PESSOA: o período, o período anterior e a vida inteira
-- -----------------------------------------------------------------------------
-- Traz TODAS as pessoas do recorte, inclusive quem não fez nada: "quem não
-- entrou" só aparece se quem não entrou estiver na lista.
drop function if exists public.audit_usage_people(date, date, uuid, text);

create function public.audit_usage_people(
  p_from date,
  p_to date,
  p_clinic uuid default null,
  p_role text default null
)
returns table (
  user_id uuid,
  is_active boolean,
  is_admin_master boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  first_access_at timestamptz,
  last_access_at timestamptz,
  last_activity_at timestamptz,
  roles jsonb,
  days_with_access integer,
  sessions integer,
  active_seconds bigint,
  total_seconds bigint,
  idle_logouts integer,
  actions integer,
  views integer,
  exports integer,
  inserts integer,
  updates integer,
  deletes integer,
  prev_days_with_access integer,
  prev_active_seconds bigint,
  prev_events integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with lim as (
    select
      p_from as de,
      least(p_to, p_from + 366) as ate,
      (least(p_to, p_from + 366) - p_from + 1) as n
    where public.is_admin_master()
      and p_from is not null and p_to is not null and p_to >= p_from
  ),
  quem as (
    select m.id as user_id
    from lim
    cross join public.audit_usage_members(p_clinic, p_role) as m(id)
  ),
  atual as (
    select
      r.user_id,
      (count(*) filter (where r.sessions > 0))::integer as days_with_access,
      sum(r.sessions)::integer as sessions,
      sum(r.active_seconds)::bigint as active_seconds,
      sum(r.total_seconds)::bigint as total_seconds,
      sum(r.idle_logouts)::integer as idle_logouts,
      sum(r.actions)::integer as actions,
      sum(r.views)::integer as views,
      sum(r.exports)::integer as exports,
      sum(r.inserts)::integer as inserts,
      sum(r.updates)::integer as updates,
      sum(r.deletes)::integer as deletes
    from lim
    cross join lateral public.audit_activity_report(lim.de, lim.ate, null, p_clinic, p_role) r
    group by r.user_id
  ),
  anterior as (
    -- O período imediatamente anterior, do MESMO tamanho.
    select
      r.user_id,
      (count(*) filter (where r.sessions > 0))::integer as days_with_access,
      sum(r.active_seconds)::bigint as active_seconds,
      sum(r.actions + r.inserts + r.updates + r.deletes)::integer as events
    from lim
    cross join lateral public.audit_activity_report(lim.de - lim.n, lim.de - 1, null, p_clinic, p_role) r
    group by r.user_id
  ),
  vida as (
    select
      a.user_id,
      min(a.started_at) as first_access_at,
      max(a.started_at) as last_access_at,
      max(a.last_activity_at) as last_activity_at
    from public.access_sessions a
    where a.user_id in (select q.user_id from quem q)
    group by a.user_id
  )
  select
    p.id,
    p.is_active,
    p.is_admin_master,
    p.created_at,
    u.last_sign_in_at,
    v.first_access_at,
    v.last_access_at,
    v.last_activity_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('c', r.clinic_id, 'r', r.role::text) order by r.created_at, r.id)
        from public.user_clinic_roles_all r
        where r.user_id = p.id
      ),
      '[]'::jsonb
    ),
    coalesce(a.days_with_access, 0),
    coalesce(a.sessions, 0),
    coalesce(a.active_seconds, 0)::bigint,
    coalesce(a.total_seconds, 0)::bigint,
    coalesce(a.idle_logouts, 0),
    coalesce(a.actions, 0),
    coalesce(a.views, 0),
    coalesce(a.exports, 0),
    coalesce(a.inserts, 0),
    coalesce(a.updates, 0),
    coalesce(a.deletes, 0),
    coalesce(b.days_with_access, 0),
    coalesce(b.active_seconds, 0)::bigint,
    coalesce(b.events, 0)
  from quem q
  join public.profiles p on p.id = q.user_id
  left join auth.users u on u.id = p.id
  left join vida v on v.user_id = p.id
  left join atual a on a.user_id = p.id
  left join anterior b on b.user_id = p.id
  order by p.id;
$$;

revoke execute on function public.audit_usage_people(date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.audit_usage_people(date, date, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) UMA LINHA POR DIA
-- -----------------------------------------------------------------------------
-- Só os dias COM movimento; a régua de dias vazios é montada na tela.
drop function if exists public.audit_usage_days(date, date, uuid, text);

create function public.audit_usage_days(
  p_from date,
  p_to date,
  p_clinic uuid default null,
  p_role text default null
)
returns table (
  day date,
  people integer,
  sessions integer,
  active_seconds bigint,
  total_seconds bigint,
  actions integer,
  changes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with lim as (
    select p_from as de, least(p_to, p_from + 366) as ate
    where public.is_admin_master()
      and p_from is not null and p_to is not null and p_to >= p_from
  )
  select
    r.day,
    (count(*) filter (where r.sessions > 0))::integer,
    sum(r.sessions)::integer,
    sum(r.active_seconds)::bigint,
    sum(r.total_seconds)::bigint,
    sum(r.actions)::integer,
    sum(r.inserts + r.updates + r.deletes)::integer
  from lim
  cross join lateral public.audit_activity_report(lim.de, lim.ate, null, p_clinic, p_role) r
  group by r.day
  order by r.day;
$$;

revoke execute on function public.audit_usage_days(date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.audit_usage_days(date, date, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) DIA DA SEMANA × HORA: quando o sistema é usado
-- -----------------------------------------------------------------------------
-- `dow`: 0 = domingo … 6 = sábado. Hora no relógio de Brasília.
-- `events` = ações nas telas + alterações; `sessions` = acessos INICIADOS.
drop function if exists public.audit_usage_hours(date, date, uuid, text);

create function public.audit_usage_hours(
  p_from date,
  p_to date,
  p_clinic uuid default null,
  p_role text default null
)
returns table (
  dow integer,
  hour integer,
  events integer,
  sessions integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with lim as (
    select p_from as de, least(p_to, p_from + 366) as ate
    where public.is_admin_master()
      and p_from is not null and p_to is not null and p_to >= p_from
  ),
  quem as (
    select m.id as user_id
    from public.audit_usage_members(p_clinic, p_role) as m(id)
    where p_clinic is not null or p_role is not null
  ),
  ev as (
    select g.created_at as t
    from public.audit_logs g
    cross join lim
    where g.created_at >= (lim.de::timestamp at time zone 'America/Sao_Paulo')
      and g.created_at < ((lim.ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and g.user_id is not null
      and g.action not in ('login', 'logout')
      and ((p_clinic is null and p_role is null) or g.user_id in (select q.user_id from quem q))
    union all
    select m.occurred_at as t
    from public.audit_changes m
    cross join lim
    where m.occurred_at >= (lim.de::timestamp at time zone 'America/Sao_Paulo')
      and m.occurred_at < ((lim.ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and m.user_id is not null
      and ((p_clinic is null and p_role is null) or m.user_id in (select q.user_id from quem q))
  ),
  e as (
    select
      extract(dow from (ev.t at time zone 'America/Sao_Paulo'))::integer as dow,
      extract(hour from (ev.t at time zone 'America/Sao_Paulo'))::integer as hour,
      count(*)::integer as n
    from ev
    group by 1, 2
  ),
  s as (
    select
      extract(dow from (a.started_at at time zone 'America/Sao_Paulo'))::integer as dow,
      extract(hour from (a.started_at at time zone 'America/Sao_Paulo'))::integer as hour,
      count(*)::integer as n
    from public.access_sessions a
    cross join lim
    where a.access_day between lim.de and lim.ate
      and a.user_id is not null
      and ((p_clinic is null and p_role is null) or a.user_id in (select q.user_id from quem q))
    group by 1, 2
  )
  select
    coalesce(e.dow, s.dow),
    coalesce(e.hour, s.hour),
    coalesce(e.n, 0),
    coalesce(s.n, 0)
  from e
  full join s on s.dow = e.dow and s.hour = e.hour
  order by 1, 2;
$$;

revoke execute on function public.audit_usage_hours(date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.audit_usage_hours(date, date, uuid, text) to authenticated;

notify pgrst, 'reload schema';
