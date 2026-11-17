-- 0419 — FUNÇÕES DE APOIO, F4: o painel "Equipe e coberturas" e os avisos à
-- Franqueadora (plano aprovado em 16/11/2026, docs/equipe/FUNCOES-DE-APOIO-PLANO.md,
-- seção 10 e D12–D15).
--
-- Nenhuma tabela de negócio nova: os números saem do que já é gravado
-- (`role_coverages`, `user_clinic_roles_all`, `access_sessions`, o horário da
-- agenda). A única tabela nova é técnica: `coverage_notices`, "este aviso já
-- saiu", para o mesmo alerta não se repetir todo dia (como `ortho_case_notices`).
--
-- Quem vê (D12): o Admin Master, a Franqueadora/Rede e o Financeiro da
-- Franqueadora veem a rede inteira; o Gerente e o Franqueado, só a própria
-- unidade. A conta mora nas funções `_raw` (internas); as portas só decidem as
-- unidades.
--
-- ⚠️ O limite honesto: tempo ativo e horário de acesso indicam carga, NÃO são
-- ponto eletrônico. E `access_sessions` não tem unidade: quem trabalha em duas
-- unidades soma o tempo das duas.

-- 1) Quem vê quais unidades (D12) ---------------------------------------------
create or replace function public._coverage_visible_clinics()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then '{}'::uuid[]
    when public.is_admin_master() or public.is_network_viewer() or public.is_finance_franchisor()
      then coalesce((select array_agg(c.id) from public.clinics c where c.is_active), '{}')
    else coalesce((
      select array_agg(distinct u.clinic_id)
        from public.user_clinic_roles_all u
        join public.profiles p on p.id = u.user_id and p.is_active
       where u.user_id = (select auth.uid())
         and u.role in ('unit_manager', 'franchisee')
    ), '{}')
  end;
$$;
revoke execute on function public._coverage_visible_clinics() from public, anon, authenticated;

-- 2) Os dias de cada cobertura que já COMEÇOU ----------------------------------
-- Só conta o que aconteceu: do início ao fim real (encerrada antes = o dia em
-- que encerrou), nunca depois de hoje.
create or replace function public._coverage_effective_days(p_hoje date)
returns table (
  id uuid, user_id uuid, clinic_id uuid, role public.user_role, kind text,
  status text, reason_category text, eff_start date, eff_end date
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.user_id, c.clinic_id, c.role, c.kind, c.status, c.reason_category,
         c.starts_on,
         least(
           coalesce(c.ends_on, p_hoje),
           case when c.status = 'encerrada'
                then coalesce((c.ended_at at time zone 'America/Sao_Paulo')::date, c.ends_on, p_hoje)
                else p_hoje end,
           p_hoje
         )
    from public.role_coverages c
   where c.status in ('ativa', 'encerrada')
     and c.activated_at is not null;
$$;
revoke execute on function public._coverage_effective_days(date) from public, anon, authenticated;

-- 3) A unidade: os sinais de equipe enxuta (10.2) ------------------------------
create or replace function public._coverage_panel_units_raw(
  p_de date, p_ate date, p_clinic_ids uuid[]
)
returns table (
  clinic_id uuid,
  clinic_name text,
  team_size integer,
  people_in_support integer,
  active_now integer,
  scheduled integer,
  person_days integer,
  days_in_period integer,
  uncovered_roles jsonb,
  role_days jsonb,
  longest_chain_days integer,
  chains_over_60 integer,
  fixed_review_overdue integer,
  max_review_overdue_days integer,
  forecast_overdue integer,
  reasons jsonb,
  max_simultaneous integer,
  max_team_percent integer,
  enforce_limits boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with hoje as (select public.today_br() as d),
  lim as (select least(p_ate, (select d from hoje)) as fim),
  cov as (
    select e.*,
           greatest(e.eff_start, p_de) as ini,
           least(e.eff_end, (select fim from lim)) as fim
      from public._coverage_effective_days((select d from hoje)) e
     where e.clinic_id = any (p_clinic_ids)
  ),
  cov_mes as (select * from cov where fim >= ini),
  dias_funcao as (
    select x.clinic_id, x.role, count(distinct x.dia)::integer as dias
      from (
        select cm.clinic_id, cm.role, generate_series(cm.ini, cm.fim, interval '1 day')::date as dia
          from cov_mes cm
      ) x
     group by x.clinic_id, x.role
  ),
  sem_titular as (
    select a.clinic_id, a.role, min(a.starts_on) as desde
      from public.role_coverages a
     where a.status = 'ativa'
       and a.clinic_id = any (p_clinic_ids)
       and not exists (
         select 1 from public.user_clinic_roles_all u
           join public.profiles p on p.id = u.user_id and p.is_active
          where u.clinic_id = a.clinic_id and u.role = a.role
            and u.assignment_kind = 'principal'
       )
     group by a.clinic_id, a.role
  ),
  emendas as (
    select a.clinic_id,
           public._coverage_chain_days(a.user_id, a.clinic_id, a.role, a.starts_on, a.ends_on,
             (public._coverage_settings_for(a.clinic_id)).chain_gap_days) as dias
      from public.role_coverages a
     where a.status = 'ativa' and a.kind = 'temporaria'
       and a.clinic_id = any (p_clinic_ids)
  )
  select c.id,
         c.name,
         (select count(distinct u.user_id)::integer
            from public.user_clinic_roles_all u
            join public.profiles p on p.id = u.user_id and p.is_active
           where u.clinic_id = c.id and u.assignment_kind = 'principal'),
         (select count(distinct a.user_id)::integer from public.role_coverages a
           where a.clinic_id = c.id and a.status = 'ativa'),
         (select count(*)::integer from public.role_coverages a
           where a.clinic_id = c.id and a.status = 'ativa'),
         (select count(*)::integer from public.role_coverages a
           where a.clinic_id = c.id and a.status = 'agendada'),
         coalesce((select sum(cm.fim - cm.ini + 1)::integer from cov_mes cm where cm.clinic_id = c.id), 0),
         greatest(0, (select fim from lim) - p_de + 1)::integer,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'role', s.role, 'since', s.desde,
                    'days', (select d from hoje) - s.desde + 1)
                  order by s.desde)
             from sem_titular s where s.clinic_id = c.id
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object('role', f.role, 'days', f.dias) order by f.dias desc)
             from dias_funcao f where f.clinic_id = c.id
         ), '[]'::jsonb),
         coalesce((select max(m.dias) from emendas m where m.clinic_id = c.id), 0),
         (select count(*)::integer from emendas m where m.clinic_id = c.id and m.dias > 60),
         (select count(*)::integer from public.role_coverages a
           where a.clinic_id = c.id and a.status = 'ativa' and a.kind = 'fixa'
             and a.review_due_on < (select d from hoje)),
         coalesce((select max((select d from hoje) - a.review_due_on)::integer
                     from public.role_coverages a
                    where a.clinic_id = c.id and a.status = 'ativa' and a.kind = 'fixa'
                      and a.review_due_on < (select d from hoje)), 0),
         (select count(*)::integer from public.role_coverages a
           where a.clinic_id = c.id and a.status = 'ativa'
             and a.reason_category = 'desligamento'
             and a.hiring_forecast < (select d from hoje)),
         coalesce((
           select jsonb_object_agg(r.cat, r.n)
             from (select cm.reason_category as cat, count(*)::integer as n
                     from cov_mes cm where cm.clinic_id = c.id
                    group by cm.reason_category) r
         ), '{}'::jsonb),
         (public._coverage_settings_for(c.id)).max_simultaneous,
         (public._coverage_settings_for(c.id)).max_team_percent,
         (public._coverage_settings_for(c.id)).enforce_limits
    from public.clinics c
   where c.id = any (p_clinic_ids) and c.is_active
   order by c.name;
$$;
revoke execute on function public._coverage_panel_units_raw(date, date, uuid[]) from public, anon, authenticated;

-- 4) A pessoa: os sinais de sobrecarga (10.2) ----------------------------------
-- Antes = os 30 dias anteriores à primeira cobertura do período; durante = os
-- dias de cobertura dentro do período. Média dos dias em que a pessoa entrou.
create or replace function public._coverage_panel_people_raw(
  p_de date, p_ate date, p_clinic_ids uuid[]
)
returns table (
  clinic_id uuid,
  user_id uuid,
  full_name text,
  roles text[],
  first_start date,
  support_now integer,
  before_avg_seconds integer,
  during_avg_seconds integer,
  during_days integer,
  after_hours_days integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with hoje as (select public.today_br() as d),
  cov as (
    select e.*,
           greatest(e.eff_start, p_de) as ini,
           least(e.eff_end, p_ate, (select d from hoje)) as fim
      from public._coverage_effective_days((select d from hoje)) e
     where e.clinic_id = any (p_clinic_ids)
  ),
  cov_mes as (select * from cov where fim >= ini),
  pessoas as (
    select cm.clinic_id, cm.user_id,
           array_agg(distinct cm.role::text) as roles,
           min(cm.eff_start) as primeiro
      from cov_mes cm
     group by cm.clinic_id, cm.user_id
  ),
  dias as (
    select distinct cm.clinic_id, cm.user_id,
           generate_series(cm.ini, cm.fim, interval '1 day')::date as dia
      from cov_mes cm
  ),
  uso as (
    select s.user_id, s.access_day, sum(s.active_seconds)::bigint as seg,
           min((s.started_at at time zone 'America/Sao_Paulo')::time) as primeira,
           max((coalesce(s.last_activity_at, s.started_at) at time zone 'America/Sao_Paulo')::time) as ultima
      from public.access_sessions s
     where s.user_id in (select pp.user_id from pessoas pp)
       and s.access_day >= (select min(pp.primeiro) from pessoas pp) - 30
     group by s.user_id, s.access_day
  ),
  horario as (
    select pp.clinic_id,
           coalesce(
             (select a.open_time from public.clinic_agenda_settings a where a.clinic_id = pp.clinic_id),
             (select a.open_time from public.clinic_agenda_settings a where a.clinic_id is null),
             time '08:00') as abre,
           coalesce(
             (select a.close_time from public.clinic_agenda_settings a where a.clinic_id = pp.clinic_id),
             (select a.close_time from public.clinic_agenda_settings a where a.clinic_id is null),
             time '18:00') as fecha
      from (select distinct clinic_id from pessoas) pp
  )
  select pp.clinic_id,
         pp.user_id,
         pr.full_name,
         pp.roles,
         pp.primeiro,
         (select count(*)::integer from public.role_coverages a
           where a.clinic_id = pp.clinic_id and a.user_id = pp.user_id and a.status = 'ativa'),
         (select avg(u.seg)::integer from uso u
           where u.user_id = pp.user_id
             and u.access_day between pp.primeiro - 30 and pp.primeiro - 1),
         (select avg(u.seg)::integer from uso u
            join dias d on d.user_id = u.user_id and d.dia = u.access_day and d.clinic_id = pp.clinic_id
           where u.user_id = pp.user_id),
         (select count(*)::integer from uso u
            join dias d on d.user_id = u.user_id and d.dia = u.access_day and d.clinic_id = pp.clinic_id
           where u.user_id = pp.user_id),
         (select count(*)::integer from uso u
            join dias d on d.user_id = u.user_id and d.dia = u.access_day and d.clinic_id = pp.clinic_id
            join horario h on h.clinic_id = pp.clinic_id
           where u.user_id = pp.user_id
             and (u.primeira < h.abre or u.ultima > h.fecha))
    from pessoas pp
    join public.profiles pr on pr.id = pp.user_id
   order by pp.clinic_id, pr.full_name;
$$;
revoke execute on function public._coverage_panel_people_raw(date, date, uuid[]) from public, anon, authenticated;

-- 5) As portas da tela ------------------------------------------------------------
create or replace function public.coverage_panel_units(p_de date, p_ate date)
returns table (
  clinic_id uuid, clinic_name text, team_size integer, people_in_support integer,
  active_now integer, scheduled integer, person_days integer, days_in_period integer,
  uncovered_roles jsonb, role_days jsonb, longest_chain_days integer, chains_over_60 integer,
  fixed_review_overdue integer, max_review_overdue_days integer, forecast_overdue integer,
  reasons jsonb, max_simultaneous integer, max_team_percent integer, enforce_limits boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 370 then
    raise exception 'INVALID_PERIOD';
  end if;
  return query
    select * from public._coverage_panel_units_raw(p_de, p_ate, public._coverage_visible_clinics());
end;
$$;
revoke execute on function public.coverage_panel_units(date, date) from public, anon, authenticated;
grant execute on function public.coverage_panel_units(date, date) to authenticated;

create or replace function public.coverage_panel_people(p_de date, p_ate date)
returns table (
  clinic_id uuid, user_id uuid, full_name text, roles text[], first_start date,
  support_now integer, before_avg_seconds integer, during_avg_seconds integer,
  during_days integer, after_hours_days integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 370 then
    raise exception 'INVALID_PERIOD';
  end if;
  return query
    select * from public._coverage_panel_people_raw(p_de, p_ate, public._coverage_visible_clinics());
end;
$$;
revoke execute on function public.coverage_panel_people(date, date) from public, anon, authenticated;
grant execute on function public.coverage_panel_people(date, date) to authenticated;

-- 6) Os avisos (10.3): um por assunto e por fato ------------------------------------
create table if not exists public.coverage_notices (
  kind text not null,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (kind, key)
);
comment on table public.coverage_notices is
  'Funções de apoio (0419): "este aviso já saiu" — o mesmo alerta não se repete todo dia.';
alter table public.coverage_notices enable row level security;
-- Sem regra de leitura nem de escrita: só a rotina (security definer) mexe.

insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'coverage_notices', 'Registro técnico dos avisos já enviados (0419).')
on conflict do nothing;

-- Quem recebe: Admin Master, Franqueadora/Rede (a rede inteira) e o Gerente e o
-- Franqueado da unidade (D12).
create or replace function public._coverage_recipients(p_clinic_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select p.id as x from public.profiles p
     where p.is_admin_master and p.is_active and coalesce(p.kind, 'person') <> 'agent'
    union
    select u.user_id from public.user_clinic_roles_all u
      join public.profiles p on p.id = u.user_id and p.is_active
      join public.clinics c on c.id = u.clinic_id
     where c.type = 'franchisor' and u.role = 'franchisor_staff'
    union
    select u.user_id from public.user_clinic_roles_all u
      join public.profiles p on p.id = u.user_id and p.is_active
     where u.clinic_id = p_clinic_id and u.role in ('unit_manager', 'franchisee')
  ) t where x is not null;
$$;
revoke execute on function public._coverage_recipients(uuid) from public, anon, authenticated;

-- Grava "já saiu" e, se for a primeira vez, avisa. Devolve se avisou.
create or replace function public._coverage_notify(
  p_kind text, p_key text, p_clinic_id uuid, p_title text, p_body text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.coverage_notices (kind, key) values (p_kind, p_key)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select r, p_clinic_id, p_title, p_body, '/risartanos/coberturas'
    from unnest(public._coverage_recipients(p_clinic_id)) as r;
  return true;
end;
$$;
revoke execute on function public._coverage_notify(text, text, uuid, text, text) from public, anon, authenticated;

-- Os cinco avisos. Os números são os mesmos da tela (as funções `_raw`).
create or replace function public._coverage_network_notices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.today_br();
  v_de date := date_trunc('month', public.today_br())::date;
  v_mes text := to_char(public.today_br(), 'YYYY-MM');
  v_todas uuid[];
  u record;
  p record;
  a record;
  j jsonb;
  v_sent integer := 0;
  v_semana integer;
  v_atraso integer;
begin
  select coalesce(array_agg(c.id), '{}') into v_todas from public.clinics c where c.is_active;

  for u in select * from public._coverage_panel_units_raw(v_de, v_hoje, v_todas) loop
    -- Função sem titular há mais de 30 dias.
    for j in select * from jsonb_array_elements(u.uncovered_roles) loop
      if (j ->> 'days')::integer > 30 then
        if public._coverage_notify('sem_titular',
             u.clinic_id || ':' || (j ->> 'role') || ':' || (j ->> 'since'),
             u.clinic_id,
             'Equipe: ' || public._role_label((j ->> 'role')::public.user_role) || ' sem titular em '
               || u.clinic_name,
             'Há ' || (j ->> 'days') || ' dias a função é feita só por apoio. Vale ver se a vaga está sendo preenchida.')
        then v_sent := v_sent + 1; end if;
      end if;
    end loop;

    -- Unidade acima do limite (uma vez por mês e por limite).
    if u.active_now > u.max_simultaneous then
      if public._coverage_notify('limite', u.clinic_id || ':' || v_mes || ':simultaneas', u.clinic_id,
           'Equipe: ' || u.clinic_name || ' acima do limite de coberturas',
           u.active_now || ' coberturas ao mesmo tempo; o limite da rede é ' || u.max_simultaneous || '.')
      then v_sent := v_sent + 1; end if;
    end if;
    if u.team_size > 0 and u.people_in_support * 100 > u.max_team_percent * u.team_size then
      if public._coverage_notify('limite', u.clinic_id || ':' || v_mes || ':equipe', u.clinic_id,
           'Equipe: ' || u.clinic_name || ' com muita gente em acúmulo',
           u.people_in_support || ' de ' || u.team_size || ' pessoas com função de apoio; o limite da rede é '
             || u.max_team_percent || '%.')
      then v_sent := v_sent + 1; end if;
    end if;
  end loop;

  -- Cobertura emendada passando de 60 dias contínuos (uma vez por cobertura).
  for a in
    select c.id, c.code, c.clinic_id, c.role, cl.name as clinic_name,
           public._coverage_chain_days(c.user_id, c.clinic_id, c.role, c.starts_on, c.ends_on,
             (public._coverage_settings_for(c.clinic_id)).chain_gap_days) as dias
      from public.role_coverages c
      join public.clinics cl on cl.id = c.clinic_id
     where c.status = 'ativa' and c.kind = 'temporaria'
  loop
    if a.dias > 60 then
      if public._coverage_notify('emendada', a.id::text, a.clinic_id,
           'Equipe: cobertura emendada passa de 60 dias (' || coalesce(a.code, '') || ')',
           public._role_label(a.role) || ' em ' || a.clinic_name || ': ' || a.dias
             || ' dias seguidos somando as emendas. Pode ser uma vaga fixa disfarçada.')
      then v_sent := v_sent + 1; end if;
    end if;
  end loop;

  -- Acúmulo fixo com a revisão vencida (D14): avisa no vencimento e, passados
  -- 15 dias sem revisão, de novo a cada semana.
  for a in
    select c.id, c.code, c.clinic_id, c.role, c.review_due_on, cl.name as clinic_name
      from public.role_coverages c
      join public.clinics cl on cl.id = c.clinic_id
     where c.status = 'ativa' and c.kind = 'fixa' and c.review_due_on < v_hoje
  loop
    v_atraso := v_hoje - a.review_due_on;
    v_semana := case when v_atraso <= 15 then 0 else 1 + (v_atraso - 16) / 7 end;
    if public._coverage_notify('revisao', a.id || ':' || a.review_due_on || ':' || v_semana, a.clinic_id,
         'Equipe: revisão do acúmulo fixo vencida (' || coalesce(a.code, '') || ')',
         public._role_label(a.role) || ' em ' || a.clinic_name || ': a revisão venceu em '
           || to_char(a.review_due_on, 'DD/MM/YYYY') || '. Abra a ficha e marque Revisado.')
    then v_sent := v_sent + 1; end if;
  end loop;

  -- Pessoa em sobrecarga (no mês): tempo ativo 30% acima do de antes, ou
  -- acesso fora do horário em 5 dias ou mais.
  for p in
    select x.*, cl.name as clinic_name
      from public._coverage_panel_people_raw(v_de, v_hoje, v_todas) x
      join public.clinics cl on cl.id = x.clinic_id
  loop
    if (coalesce(p.before_avg_seconds, 0) > 0 and p.during_days >= 5
        and p.during_avg_seconds * 100 > p.before_avg_seconds * 130)
       or p.after_hours_days >= 5 then
      if public._coverage_notify('sobrecarga', p.user_id || ':' || p.clinic_id || ':' || v_mes, p.clinic_id,
           'Equipe: possível sobrecarga de ' || coalesce(p.full_name, 'uma pessoa') || ' em ' || p.clinic_name,
           'Na cobertura deste mês: ' || coalesce(p.during_avg_seconds / 3600, 0) || 'h'
             || lpad((coalesce(p.during_avg_seconds, 0) % 3600 / 60)::text, 2, '0') || ' por dia no sistema'
             || case when coalesce(p.before_avg_seconds, 0) > 0
                     then ' (antes: ' || (p.before_avg_seconds / 3600) || 'h'
                          || lpad((p.before_avg_seconds % 3600 / 60)::text, 2, '0') || ')' else '' end
             || '; ' || p.after_hours_days || ' dia(s) com acesso fora do horário. Não é ponto: confira na folha.')
      then v_sent := v_sent + 1; end if;
    end if;
  end loop;

  return v_sent;
end;
$$;
revoke execute on function public._coverage_network_notices() from public, anon, authenticated;

-- 7) A rotina diária (0414) passa a chamar os avisos -------------------------------
-- Copiada da 0414; a única mudança é o bloco da F4 antes do `return`.
create or replace function public.role_coverage_daily()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.today_br();
  r record;
  v_n integer := 0;
begin
  -- Começa as agendadas do dia (ou atrasadas, se a rotina falhou).
  for r in
    select id from public.role_coverages
     where status = 'agendada' and starts_on <= v_hoje
       and (ends_on is null or ends_on >= v_hoje)
  loop
    perform public._role_coverage_activate(r.id);
    v_n := v_n + 1;
  end loop;

  -- Agendada que passou inteira sem começar: cancelada.
  for r in
    select id from public.role_coverages
     where status = 'agendada' and ends_on < v_hoje
  loop
    perform public._role_coverage_finish(r.id, 'cancelada', null, 'Período passou sem começar (automático).');
    v_n := v_n + 1;
  end loop;

  -- Encerra as vencidas: no dia seguinte ao último.
  for r in
    select id from public.role_coverages
     where status = 'ativa' and ends_on is not null and ends_on < v_hoje
  loop
    perform public._role_coverage_finish(r.id, 'encerrada', null, 'Fim do período.');
    v_n := v_n + 1;
  end loop;

  -- Aviso 2 dias antes do fim: à pessoa e a quem deu.
  begin
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct x.uid, c.clinic_id,
           'Cobertura termina em 2 dias: ' || public._role_label(c.role),
           c.code || ' · até ' || to_char(c.ends_on, 'DD/MM'),
           '/'
      from public.role_coverages c
      cross join lateral (select c.user_id as uid union select c.granted_by) x
     where c.status = 'ativa' and c.ends_on = v_hoje + 2 and x.uid is not null;
  exception when others then
    raise warning 'role_coverage_daily aviso: %', sqlerrm;
  end;


  -- F4 (0419): os avisos à Franqueadora (10.3). Blindado: nunca derruba a rotina.
  begin
    v_n := v_n + public._coverage_network_notices();
  exception when others then
    raise warning 'role_coverage_daily avisos da rede: %', sqlerrm;
  end;

  return v_n;
end;
$$;
revoke execute on function public.role_coverage_daily() from public, anon, authenticated;
grant execute on function public.role_coverage_daily() to service_role;

select public.audit_attach_all();
