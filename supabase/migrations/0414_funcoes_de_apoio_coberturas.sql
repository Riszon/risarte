-- =============================================================================
-- 0414 — FUNÇÕES DE APOIO, ENTREGA F2: AS COBERTURAS NO BANCO
--
-- Plano aprovado pelo dono em 16/11/2026 (D1–D15 como recomendado):
-- docs/equipe/FUNCOES-DE-APOIO-PLANO.md. A F1 (0413) deixou os leitores
-- prontos; esta entrega cria o modelo. AINDA SEM BOTÃO NA TELA (F3).
--
--   1. `role_coverages` — a cobertura (CB-00001): quem, onde, qual função,
--      temporária ou fixa, datas, motivo (lista fechada + texto, D15), revisão
--      do acúmulo fixo (D14). Nada se apaga: é o histórico (e a prova do
--      período, D11).
--   2. A função de apoio é uma LINHA de verdade em `user_clinic_roles_all`
--      (`assignment_kind = 'apoio'`, `coverage_id`, `ends_at`) enquanto a
--      cobertura está ativa — as 130 regras e o app obedecem sem reescrita.
--   3. Sai `unique (user_id, clinic_id)`; entra `unique (user_id, clinic_id,
--      role)`. Travas no banco: até 2 de apoio (D3), combinações proibidas
--      (D4), apoio só com a principal na unidade.
--   4. Limites da rede (D13): começam SÓ AVISANDO (`enforce_limits = false`).
--   5. Portas (só o Admin Master, D1): dar, encerrar, cancelar e revisar.
--   6. D6: a temporária libera o sistema real daquela função pelo período
--      (sem missão); a fixa passa pelo portão. D7: a temporária não entra em
--      turma de certificação.
--   7. A rotina diária (00:05 de Brasília): começa as agendadas, avisa 2 dias
--      antes do fim e encerra as vencidas (D10). E a janela `user_clinic_roles`
--      esconde a linha vencida mesmo se a rotina falhar uma noite.
--
-- Idempotente. Nada apaga dado de negócio.
-- =============================================================================

-- 1) As configurações: combinações proibidas e limites --------------------------
create table if not exists public.role_incompatibilities (
  role_a public.user_role not null,
  role_b public.user_role not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (role_a, role_b),
  check (role_a < role_b)
);

comment on table public.role_incompatibilities is
  'Combinações de função que a mesma pessoa não pode ter na mesma unidade (funções de apoio, D4). role_a < role_b.';

alter table public.role_incompatibilities enable row level security;
drop policy if exists role_incompatibilities_select on public.role_incompatibilities;
create policy role_incompatibilities_select on public.role_incompatibilities
  for select to authenticated using (true);

-- D4: quem compra não paga (controle interno; roles.ts).
insert into public.role_incompatibilities (role_a, role_b, reason)
select least('finance_franchisor'::public.user_role, 'purchaser'::public.user_role),
       greatest('finance_franchisor'::public.user_role, 'purchaser'::public.user_role),
       'Quem compra não é quem paga (controle interno).'
on conflict do nothing;

create table if not exists public.coverage_settings (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = padrão da rede; com unidade, vale para ela (cascata, como o SLA).
  clinic_id uuid references public.clinics (id),
  max_simultaneous integer not null default 2 check (max_simultaneous >= 0),
  max_team_percent integer not null default 30 check (max_team_percent between 0 and 100),
  -- D13: nos primeiros meses os limites só avisam.
  enforce_limits boolean not null default false,
  temp_max_days integer not null default 90 check (temp_max_days > 0),
  chain_gap_days integer not null default 7 check (chain_gap_days >= 0),
  fixed_review_days integer not null default 90 check (fixed_review_days > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  unique nulls not distinct (clinic_id)
);

comment on table public.coverage_settings is
  'Limites das funções de apoio (D2, D13, D14): rede (clinic_id nulo) → unidade.';

alter table public.coverage_settings enable row level security;
drop policy if exists coverage_settings_select on public.coverage_settings;
create policy coverage_settings_select on public.coverage_settings
  for select to authenticated using (true);

insert into public.coverage_settings (clinic_id) values (null) on conflict do nothing;

create or replace function public._coverage_settings_for(p_clinic_id uuid)
returns public.coverage_settings
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
    from public.coverage_settings s
   where s.clinic_id = p_clinic_id or s.clinic_id is null
   order by (s.clinic_id is not null) desc
   limit 1;
$$;

revoke execute on function public._coverage_settings_for(uuid) from public, anon, authenticated;

-- 2) A cobertura ----------------------------------------------------------------
create sequence if not exists public.role_coverage_code_seq;

create table if not exists public.role_coverages (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  user_id uuid not null references public.profiles (id),
  clinic_id uuid not null references public.clinics (id),
  role public.user_role not null,
  kind text not null check (kind in ('temporaria', 'fixa')),
  starts_on date not null,
  ends_on date,
  reason_category text not null check (reason_category in (
    'ferias', 'licenca', 'falta', 'desligamento', 'sem_funcao', 'outro')),
  reason text not null check (length(btrim(reason)) > 0),
  -- D15: "desligamento (vaga aberta)" pede a previsão de contratação.
  hiring_forecast date,
  status text not null default 'agendada'
    check (status in ('agendada', 'ativa', 'encerrada', 'cancelada')),
  -- D14: o acúmulo fixo é revisto a cada N dias.
  review_due_on date,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles (id),
  end_reason text,
  check (kind = 'fixa' or ends_on is not null),
  check (kind = 'temporaria' or ends_on is null),
  check (ends_on is null or ends_on >= starts_on),
  check (reason_category <> 'desligamento' or hiring_forecast is not null)
);

comment on table public.role_coverages is
  'Funções de apoio (0414): a cobertura temporária ou o acúmulo fixo de uma função por quem já tem outra na unidade. Nunca se apaga — é o histórico.';

create index if not exists role_coverages_clinic_idx on public.role_coverages (clinic_id, status);
create index if not exists role_coverages_user_idx on public.role_coverages (user_id, clinic_id, role);

create or replace function public.set_role_coverage_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.code is null then
    new.code := 'CB-' || lpad(nextval('public.role_coverage_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;
revoke execute on function public.set_role_coverage_code() from public, anon, authenticated;

drop trigger if exists role_coverages_code on public.role_coverages;
create trigger role_coverages_code before insert on public.role_coverages
  for each row execute function public.set_role_coverage_code();

alter table public.role_coverages enable row level security;
drop policy if exists role_coverages_select on public.role_coverages;
create policy role_coverages_select on public.role_coverages
  for select to authenticated
  using (
    public.is_admin_master()
    or user_id = (select auth.uid())
    or public.can_see_staff(clinic_id, user_id)
  );
-- Sem política de escrita: só as portas abaixo gravam.

-- 3) A linha de função ganha a cobertura e o fim ----------------------------------
alter table public.user_clinic_roles_all
  add column if not exists coverage_id uuid references public.role_coverages (id),
  add column if not exists ends_at timestamptz;

alter table public.user_clinic_roles_all
  drop constraint if exists user_clinic_roles_support_needs_coverage;
alter table public.user_clinic_roles_all
  add constraint user_clinic_roles_support_needs_coverage
  check ((assignment_kind = 'apoio') = (coverage_id is not null));

-- A trava antiga sai; a mesma função duas vezes, nunca.
alter table public.user_clinic_roles_all
  drop constraint if exists user_clinic_roles_user_clinic_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_clinic_roles_user_clinic_role_key') then
    alter table public.user_clinic_roles_all
      add constraint user_clinic_roles_user_clinic_role_key unique (user_id, clinic_id, role);
  end if;
end $$;

-- As travas da função de apoio (D3, D4, principal na unidade).
create or replace function public._support_role_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := 2; -- D3
  v_n integer;
begin
  if new.assignment_kind <> 'apoio' then
    return new;
  end if;

  if not exists (
    select 1 from public.user_clinic_roles_all u
     where u.user_id = new.user_id and u.clinic_id = new.clinic_id
       and u.assignment_kind = 'principal'
  ) then
    raise exception 'NO_PRINCIPAL_ROLE';
  end if;

  select count(*) into v_n
    from public.user_clinic_roles_all u
   where u.user_id = new.user_id and u.clinic_id = new.clinic_id
     and u.assignment_kind = 'apoio'
     and u.id is distinct from new.id;
  if v_n >= v_max then
    raise exception 'TOO_MANY_SUPPORT_ROLES';
  end if;

  if exists (
    select 1
      from public.user_clinic_roles_all u
      join public.role_incompatibilities i
        on (i.role_a = least(u.role, new.role) and i.role_b = greatest(u.role, new.role))
     where u.user_id = new.user_id and u.clinic_id = new.clinic_id
       and u.id is distinct from new.id
  ) then
    raise exception 'ROLE_COMBINATION_NOT_ALLOWED';
  end if;

  return new;
end;
$$;
revoke execute on function public._support_role_guard() from public, anon, authenticated;

drop trigger if exists user_clinic_roles_support_guard on public.user_clinic_roles_all;
create trigger user_clinic_roles_support_guard
  before insert or update on public.user_clinic_roles_all
  for each row execute function public._support_role_guard();

-- 4) A janela: esconde também a linha vencida (rede de segurança da rotina) ----
create or replace view public.user_clinic_roles
with (security_invoker = true) as
  select *
    from public.user_clinic_roles_all r
   where (r.ends_at is null or r.ends_at > now())
     and (
       r.user_id is distinct from auth.uid()
       or not exists (
         select 1 from public.system_closed_clinics c
          where c.user_id = r.user_id
            and c.clinic_id = r.clinic_id
            and c.role = r.role
       )
     );

comment on view public.user_clinic_roles is
  'Janela sobre user_clinic_roles_all: esconde de QUEM CHAMA as funções fechadas para ela (0277; por função desde a 0413) e, de todos, a função de apoio vencida (0414). Estrutura mexe-se em user_clinic_roles_all.';

alter view public.user_clinic_roles alter column id set default gen_random_uuid();
alter view public.user_clinic_roles alter column created_at set default now();
alter view public.user_clinic_roles alter column assignment_kind set default 'principal';

grant select, insert, update, delete on public.user_clinic_roles to anon, authenticated, service_role;

-- 5) A liberação da cobertura temporária (D6) -----------------------------------
alter table public.system_clinic_access
  drop constraint if exists system_clinic_access_source_check;
alter table public.system_clinic_access
  add constraint system_clinic_access_source_check
  check (source in ('anterior', 'manual', 'cobertura'));

-- 6) As peças internas -----------------------------------------------------------
-- O fim da cobertura no relógio de Brasília: a meia-noite seguinte ao último dia.
create or replace function public._coverage_end_instant(p_ends_on date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when p_ends_on is null then null
              else ((p_ends_on + 1)::timestamp at time zone 'America/Sao_Paulo') end;
$$;
revoke execute on function public._coverage_end_instant(date) from public, anon, authenticated;

-- Quantos dias seguidos a pessoa cobre esta função nesta unidade, contando as
-- temporárias "emendadas" (a seguinte começa até N dias depois do fim da
-- anterior) — a temporária não vira fixa por emenda (D2).
create or replace function public._coverage_chain_days(
  p_user uuid, p_clinic uuid, p_role public.user_role,
  p_starts date, p_ends date, p_gap integer, p_exclude uuid default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ini date := p_starts;
  v_fim date := p_ends;
  v date;
begin
  loop
    select min(c.starts_on) into v
      from public.role_coverages c
     where c.user_id = p_user and c.clinic_id = p_clinic and c.role = p_role
       and c.kind = 'temporaria' and c.status <> 'cancelada'
       and c.id is distinct from p_exclude
       and c.starts_on < v_ini
       and least(c.ends_on, coalesce((c.ended_at at time zone 'America/Sao_Paulo')::date, c.ends_on))
           >= v_ini - p_gap - 1;
    exit when v is null;
    v_ini := v;
  end loop;
  loop
    select max(c.ends_on) into v
      from public.role_coverages c
     where c.user_id = p_user and c.clinic_id = p_clinic and c.role = p_role
       and c.kind = 'temporaria' and c.status <> 'cancelada'
       and c.id is distinct from p_exclude
       and c.ends_on > v_fim
       and c.starts_on <= v_fim + p_gap + 1;
    exit when v is null;
    v_fim := v;
  end loop;
  return v_fim - v_ini + 1;
end;
$$;
revoke execute on function public._coverage_chain_days(uuid, uuid, public.user_role, date, date, integer, uuid) from public, anon, authenticated;

-- Começa a cobertura: a linha de apoio nasce; a temporária libera o sistema
-- real da função pelo período (D6).
create or replace function public._role_coverage_activate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.role_coverages;
begin
  select * into c from public.role_coverages where id = p_id for update;
  if not found or c.status <> 'agendada' then
    return;
  end if;

  insert into public.user_clinic_roles_all
    (user_id, clinic_id, role, assignment_kind, coverage_id, ends_at)
  values
    (c.user_id, c.clinic_id, c.role, 'apoio', c.id, public._coverage_end_instant(c.ends_on));

  if c.kind = 'temporaria' then
    insert into public.system_clinic_access (user_id, clinic_id, role, source, note, granted_by)
    values (c.user_id, c.clinic_id, c.role, 'cobertura',
            'Cobertura ' || c.code || ' até ' || to_char(c.ends_on, 'DD/MM/YYYY'), c.granted_by)
    on conflict (user_id, clinic_id, role) do update
      set source = 'cobertura', note = excluded.note, granted_at = now(),
          granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
      -- Liberação que a pessoa já tinha (manual ou anterior) fica como está.
      where public.system_clinic_access.revoked_at is not null
         or public.system_clinic_access.source = 'cobertura';
  end if;

  update public.role_coverages
     set status = 'ativa', activated_at = now()
   where id = c.id;

  begin
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select c.user_id, c.clinic_id,
           'Você está cobrindo ' || public._role_label(c.role),
           coalesce(cl.name, 'Unidade')
             || case when c.ends_on is not null then ' · até ' || to_char(c.ends_on, 'DD/MM') else ' · acúmulo fixo' end
             || ' · ' || c.reason,
           '/'
      from public.clinics cl where cl.id = c.clinic_id;
  exception when others then
    raise warning '_role_coverage_activate aviso: %', sqlerrm;
  end;
end;
$$;
revoke execute on function public._role_coverage_activate(uuid) from public, anon, authenticated;

-- Encerra (ou cancela) a cobertura: a linha de apoio sai, a liberação da
-- cobertura é tirada; o registro fica.
create or replace function public._role_coverage_finish(
  p_id uuid, p_status text, p_by uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.role_coverages;
begin
  select * into c from public.role_coverages where id = p_id for update;
  if not found or c.status in ('encerrada', 'cancelada') then
    return;
  end if;

  delete from public.user_clinic_roles_all where coverage_id = c.id;

  update public.system_clinic_access
     set revoked_at = now(), revoked_by = p_by
   where user_id = c.user_id and clinic_id = c.clinic_id and role = c.role
     and source = 'cobertura' and revoked_at is null;

  update public.role_coverages
     set status = p_status, ended_at = now(), ended_by = p_by,
         end_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = c.id;

  if c.status = 'ativa' then
    begin
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct x.uid, c.clinic_id,
             'Cobertura encerrada: ' || public._role_label(c.role),
             c.code || ' · ' || coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'fim do período'),
             '/'
        from (select c.user_id as uid union select c.granted_by) x
       where x.uid is not null;
    exception when others then
      raise warning '_role_coverage_finish aviso: %', sqlerrm;
    end;
  end if;
end;
$$;
revoke execute on function public._role_coverage_finish(uuid, text, uuid, text) from public, anon, authenticated;

-- O nome da função para os avisos (o mesmo de roles.ts).
create or replace function public._role_label(p_role public.user_role)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_role::text
    when 'receptionist' then 'Recepção'
    when 'sdr' then 'Encantador(a) (SDR)'
    when 'clinical_coordinator' then 'Coordenação Clínica'
    when 'planner_dentist' then 'Dentista Planner'
    when 'dentist' then 'Dentista'
    when 'commercial_consultant' then 'Consultor Comercial'
    when 'commercial_assistant' then 'Assistente Comercial'
    when 'unit_manager' then 'Gerência da Unidade'
    when 'franchisor_staff' then 'Franqueadora/Rede'
    when 'franchisee' then 'Franqueado'
    when 'tsb' then 'TSB'
    when 'asb' then 'ASB'
    when 'rislife_consultant' then 'Consultor RisLife'
    when 'finance_franchisor' then 'Financeiro da Franqueadora'
    when 'purchaser' then 'Compras da Franqueadora'
    else p_role::text
  end;
$$;
revoke execute on function public._role_label(public.user_role) from public, anon, authenticated;

-- 7) As portas (D1: só o Admin Master) -------------------------------------------
create or replace function public.grant_role_coverage(
  p_user_id uuid,
  p_clinic_id uuid,
  p_role public.user_role,
  p_kind text,
  p_starts_on date,
  p_ends_on date,
  p_reason_category text,
  p_reason text,
  p_hiring_forecast date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.coverage_settings;
  v_id uuid;
  v_hoje date := public.today_br();
  v_simult integer;
  v_equipe integer;
  v_apoio integer;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_kind not in ('temporaria', 'fixa') then
    raise exception 'INVALID_KIND';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED';
  end if;
  if p_starts_on is null or p_starts_on < v_hoje then
    raise exception 'START_IN_THE_PAST';
  end if;
  if p_kind = 'temporaria' and (p_ends_on is null or p_ends_on < p_starts_on) then
    raise exception 'END_REQUIRED';
  end if;
  if p_reason_category = 'desligamento' and p_hiring_forecast is null then
    raise exception 'HIRING_FORECAST_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_user_id and p.is_active
  ) then
    raise exception 'PERSON_INACTIVE';
  end if;
  if not exists (
    select 1 from public.user_clinic_roles_all u
     where u.user_id = p_user_id and u.clinic_id = p_clinic_id
       and u.assignment_kind = 'principal'
  ) then
    raise exception 'NO_PRINCIPAL_ROLE';
  end if;
  if exists (
    select 1 from public.user_clinic_roles_all u
     where u.user_id = p_user_id and u.clinic_id = p_clinic_id and u.role = p_role
  ) or exists (
    select 1 from public.role_coverages c
     where c.user_id = p_user_id and c.clinic_id = p_clinic_id and c.role = p_role
       and c.status in ('agendada', 'ativa')
       and (c.ends_on is null or c.ends_on >= p_starts_on)
       and (p_ends_on is null or c.starts_on <= p_ends_on)
  ) then
    raise exception 'ALREADY_HAS_ROLE';
  end if;

  s := public._coverage_settings_for(p_clinic_id);

  -- D2: a temporária, somadas as emendas, não passa do máximo.
  if p_kind = 'temporaria'
     and public._coverage_chain_days(p_user_id, p_clinic_id, p_role, p_starts_on, p_ends_on,
                                     s.chain_gap_days) > s.temp_max_days then
    raise exception 'TEMPORARY_TOO_LONG';
  end if;

  -- D13: os limites da unidade. Só travam com `enforce_limits`.
  if s.enforce_limits then
    select count(*) into v_simult
      from public.role_coverages c
     where c.clinic_id = p_clinic_id and c.status in ('agendada', 'ativa')
       and (c.ends_on is null or c.ends_on >= p_starts_on)
       and (p_ends_on is null or c.starts_on <= p_ends_on);
    if v_simult >= s.max_simultaneous then
      raise exception 'UNIT_COVERAGE_LIMIT';
    end if;
    select count(distinct u.user_id) filter (where u.assignment_kind = 'principal'),
           count(distinct u.user_id) filter (where u.assignment_kind = 'apoio')
      into v_equipe, v_apoio
      from public.user_clinic_roles_all u
     where u.clinic_id = p_clinic_id;
    if v_equipe > 0
       and (v_apoio + case when exists (
              select 1 from public.user_clinic_roles_all u
               where u.clinic_id = p_clinic_id and u.user_id = p_user_id
                 and u.assignment_kind = 'apoio') then 0 else 1 end) * 100
           > s.max_team_percent * v_equipe then
      raise exception 'UNIT_TEAM_PERCENT_LIMIT';
    end if;
  end if;

  insert into public.role_coverages
    (user_id, clinic_id, role, kind, starts_on, ends_on, reason_category, reason,
     hiring_forecast, review_due_on, granted_by)
  values
    (p_user_id, p_clinic_id, p_role, p_kind, p_starts_on,
     case when p_kind = 'temporaria' then p_ends_on end,
     p_reason_category, btrim(p_reason), p_hiring_forecast,
     case when p_kind = 'fixa' then p_starts_on + s.fixed_review_days end,
     auth.uid())
  returning id into v_id;

  if p_starts_on <= v_hoje then
    perform public._role_coverage_activate(v_id);
  end if;

  return v_id;
end;
$$;
revoke execute on function public.grant_role_coverage(uuid, uuid, public.user_role, text, date, date, text, text, date) from public, anon, authenticated;
grant execute on function public.grant_role_coverage(uuid, uuid, public.user_role, text, date, date, text, text, date) to authenticated, service_role;

create or replace function public.end_role_coverage(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED';
  end if;
  if not exists (select 1 from public.role_coverages where id = p_id and status = 'ativa') then
    raise exception 'NOT_ACTIVE';
  end if;
  perform public._role_coverage_finish(p_id, 'encerrada', auth.uid(), p_reason);
end;
$$;
revoke execute on function public.end_role_coverage(uuid, text) from public, anon, authenticated;
grant execute on function public.end_role_coverage(uuid, text) to authenticated, service_role;

create or replace function public.cancel_role_coverage(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED';
  end if;
  if not exists (select 1 from public.role_coverages where id = p_id and status = 'agendada') then
    raise exception 'NOT_SCHEDULED';
  end if;
  perform public._role_coverage_finish(p_id, 'cancelada', auth.uid(), p_reason);
end;
$$;
revoke execute on function public.cancel_role_coverage(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_role_coverage(uuid, text) to authenticated, service_role;

-- D14: revisar o acúmulo fixo empurra a próxima revisão.
create or replace function public.review_role_coverage(p_id uuid)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.role_coverages;
  v_proxima date;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into c from public.role_coverages where id = p_id;
  if not found or c.kind <> 'fixa' or c.status not in ('agendada', 'ativa') then
    raise exception 'NOT_REVIEWABLE';
  end if;
  v_proxima := public.today_br() + (public._coverage_settings_for(c.clinic_id)).fixed_review_days;
  update public.role_coverages
     set reviewed_at = now(), reviewed_by = auth.uid(), review_due_on = v_proxima
   where id = p_id;
  return v_proxima;
end;
$$;
revoke execute on function public.review_role_coverage(uuid) from public, anon, authenticated;
grant execute on function public.review_role_coverage(uuid) to authenticated, service_role;

-- 8) Quem sai da unidade (ou da equipe) encerra as coberturas -------------------
create or replace function public._coverage_end_on_principal_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if old.assignment_kind <> 'principal' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.clinic_id = old.clinic_id
     and new.assignment_kind = 'principal' then
    return new;
  end if;
  begin
    for r in
      select c.id from public.role_coverages c
       where c.user_id = old.user_id and c.clinic_id = old.clinic_id
         and c.status in ('agendada', 'ativa')
    loop
      perform public._role_coverage_finish(r.id,
        case when (select status from public.role_coverages where id = r.id) = 'agendada'
             then 'cancelada' else 'encerrada' end,
        (select auth.uid()), 'Deixou a função principal nesta unidade (automático).');
    end loop;
  exception when others then
    raise warning '_coverage_end_on_principal_loss: %', sqlerrm;
  end;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public._coverage_end_on_principal_loss() from public, anon, authenticated;

drop trigger if exists coverage_end_on_principal_loss on public.user_clinic_roles_all;
create trigger coverage_end_on_principal_loss
  after update or delete on public.user_clinic_roles_all
  for each row execute function public._coverage_end_on_principal_loss();

create or replace function public._coverage_end_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if coalesce(old.is_active, false) and not coalesce(new.is_active, false) then
    begin
      for r in
        select c.id, c.status from public.role_coverages c
         where c.user_id = new.id and c.status in ('agendada', 'ativa')
      loop
        perform public._role_coverage_finish(r.id,
          case when r.status = 'agendada' then 'cancelada' else 'encerrada' end,
          (select auth.uid()), 'Desligada da equipe (automático).');
      end loop;
    exception when others then
      raise warning '_coverage_end_on_deactivation: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke execute on function public._coverage_end_on_deactivation() from public, anon, authenticated;

drop trigger if exists coverage_end_on_deactivation on public.profiles;
create trigger coverage_end_on_deactivation
  after update of is_active on public.profiles
  for each row execute function public._coverage_end_on_deactivation();

-- 9) A rotina diária (D10) --------------------------------------------------------
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

  return v_n;
end;
$$;
revoke execute on function public.role_coverage_daily() from public, anon, authenticated;
grant execute on function public.role_coverage_daily() to service_role;

do $$
begin
  perform cron.schedule(
    'risarte-coverage-daily', '5 3 * * *',
    'select public.role_coverage_daily()'
  );
exception when others then null;
end;
$$;

-- 10) D7: a cobertura temporária não entra em turma de certificação ------------
create or replace function public.training_candidates_multi(
  p_clinic_ids uuid[],
  p_kind text
)
returns table (
  clinic_id uuid,
  clinic_name text,
  user_id uuid,
  full_name text,
  role public.user_role,
  ja_certificado boolean,
  turma_aberta text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  with com_missao as (
    select distinct r.role from public.training_requirements r
  ),
  gente as (
    -- A MESMA FUNÇÃO EM DUAS UNIDADES É UMA MISSÃO SÓ (0275).
    select distinct on (ucr.user_id, ucr.role)
           ucr.clinic_id, ucr.user_id, ucr.role
      from public.user_clinic_roles ucr
      join public.profiles p on p.id = ucr.user_id and p.is_active
      join com_missao cm on cm.role = ucr.role
     where ucr.clinic_id = any(p_clinic_ids)
       -- 0414 (D7): a cobertura TEMPORÁRIA não entra em turma; a fixa entra.
       and (ucr.assignment_kind = 'principal'
            or exists (select 1 from public.role_coverages rc
                        where rc.id = ucr.coverage_id and rc.kind = 'fixa'))
       and not coalesce(p.is_admin_master, false)
       and (
         not exists (select 1 from public.training_cohort_roles)
         or exists (
           select 1 from public.training_cohort_roles f where f.role = ucr.role
         )
       )
     order by ucr.user_id, ucr.role, ucr.clinic_id
  )
  select
    g.clinic_id,
    cl.name::text,
    g.user_id,
    coalesce(pr.full_name, pr.email)::text,
    g.role,
    exists (
      select 1 from public.training_certifications c
       where c.user_id = g.user_id and c.role = g.role
    ),
    -- 0411: já convocada nesta função numa turma aberta do mesmo tipo.
    (
      select coalesce(tc.code, 'aberta')
        from public.training_enrollments e
        join public.training_campaigns tc on tc.id = e.campaign_id
       where tc.status = 'aberta'
         and tc.kind = p_kind
         and e.user_id = g.user_id
         and e.role = g.role
         and e.status <> 'dispensado'
       order by tc.created_at
       limit 1
    )::text
  from gente g
  join public.profiles pr on pr.id = g.user_id
  join public.clinics cl on cl.id = g.clinic_id
  where
    case when p_kind = 'reciclagem' then true
    else not exists (
      select 1 from public.training_certifications c
       where c.user_id = g.user_id and c.role = g.role
    ) end
  order by cl.name, 4;
end;
$$;

revoke execute on function public.training_candidates_multi(uuid[], text) from public, anon, authenticated;
grant execute on function public.training_candidates_multi(uuid[], text) to authenticated, service_role;

-- 11) Tabelas novas na auditoria (0288) ------------------------------------------
select public.audit_attach_all();
