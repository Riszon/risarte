-- =============================================================================
-- 0289 — RELATÓRIO DE ATIVIDADE POR PESSOA E POR DIA (auditoria, etapa 3 de 3)
-- -----------------------------------------------------------------------------
-- Pedido do dono (09/10/2026): "enxergar o que cada usuário fez e alterou.
-- Tempo de atividade ou inatividade no sistema [...] ficando registrado cada
-- dia que fez o acesso."
--
-- As etapas 1 (0287) e 2 (0288) passaram a GUARDAR: cada acesso, cada ação e
-- cada alteração. Esta junta os três num número por pessoa e por dia: quando
-- entrou, a última atividade, quantos acessos, quanto tempo em uso e quanto
-- parado, quantas vezes foi desconectada por inatividade, quantas ações fez
-- nas telas e quantas inclusões, alterações e exclusões.
--
-- POR QUE A CONTA MORA NO BANCO: um mês de uma equipe são milhares de linhas
-- nas três trilhas, e a tela só lê mil por vez. Somar no navegador mostraria
-- um total cortado sem avisar — número errado com cara de certo.
--
-- O DIA É O DIA BRASILEIRO. O acesso já guarda a data civil (`access_day`); a
-- ação e a alteração guardam o instante, e aqui ele é lido no fuso de São
-- Paulo. Sem isso, o que alguém fez às 22h cairia no dia seguinte.
--
-- A CONTA DO TEMPO É A MESMA DA TELA (`temposDoAcesso`, em `acesso.ts`): o
-- acesso dura do início até a saída — ou até a ÚLTIMA ATIVIDADE, se ainda está
-- aberto (contar até "agora" faria a aba esquecida virar horas de trabalho) —
-- e o tempo em uso nunca passa da duração. A função devolve o tempo em uso e o
-- total; "parado" é a diferença.
--
-- SÓ O ADMIN MASTER (mesma regra das trilhas). Para qualquer outra pessoa a
-- função devolve vazio; sem login, nem responde.
--
-- Só cria 1 função. Não cria tabela, não altera dado. Idempotente.
-- =============================================================================

drop function if exists public.audit_activity_report(date, date, uuid);

create function public.audit_activity_report(
  p_from date,
  p_to date,
  p_user uuid default null
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
  sess as (
    select
      a.user_id,
      a.access_day as day,
      greatest(0, round(extract(epoch from (coalesce(a.ended_at, a.last_activity_at) - a.started_at))))::bigint as total_s,
      greatest(0, a.active_seconds)::bigint as active_s,
      a.started_at,
      a.last_activity_at,
      a.end_reason
    from public.access_sessions a
    cross join lim
    where a.access_day between lim.de and lim.ate
      and a.user_id is not null
      and (p_user is null or a.user_id = p_user)
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

revoke execute on function public.audit_activity_report(date, date, uuid) from public, anon, authenticated;
grant execute on function public.audit_activity_report(date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
