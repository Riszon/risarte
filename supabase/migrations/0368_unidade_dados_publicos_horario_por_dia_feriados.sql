-- =============================================================================
-- 0368 — Dados públicos da unidade, horário por dia e feriados
--        (Rita, Fase 0A.4, parte core)
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.4 (decisões 9, 41 e DA8).
--
-- O QUE CRIA (tudo no `public`: é dado da unidade, outras telas vão ler)
--   * `clinic_public_info` — o que se pode dizer a um paciente sobre a unidade:
--     nome público, ponto de referência, link do mapa, estacionamento,
--     acessibilidade, WhatsApp da unidade e a idade mínima para atender
--     criança (decisão 41: vazia = a Rita não promete e passa para a equipe).
--   * `clinic_service_areas` — cidades/bairros que a unidade atende.
--   * `clinic_weekday_hours` — o horário de funcionamento POR DIA DA SEMANA,
--     em cascata (`clinic_id` nulo = padrão da rede; a unidade sobrescreve).
--     Semente: a mesma conta da agenda de hoje (`resolveAgendaSettings`).
--     ⚠️ DA8: a AGENDA DA EQUIPE NÃO LÊ ESTA TABELA ainda (Fase 1). Por
--     enquanto ela serve à Rita e às telas.
--   * `holidays` — feriados nacionais (semente 2026–2029, da mesma função
--     `src/lib/holidays.ts`), estaduais e municipais. A decisão de atender ou
--     não continua em `clinic_holiday_decisions` (0047), como sempre.
--
-- Quem grava: Admin Master (tudo) e o Gerente da unidade (o da unidade dele;
-- feriado estadual/municipal só do estado/cidade dele). Todos leem.
-- Idempotente. Não muda nada que já existe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Dados públicos
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_public_info (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  public_name text check (public_name is null or length(btrim(public_name)) between 2 and 120),
  landmark text check (landmark is null or length(landmark) <= 300),
  maps_url text check (maps_url is null or maps_url ~ '^https://[^ ]{8,}$'),
  parking text check (parking is null or length(parking) <= 300),
  accessibility text check (accessibility is null or length(accessibility) <= 300),
  whatsapp_e164 text check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+55[1-9][1-9][0-9]{8,9}$'),
  min_child_age smallint check (min_child_age is null or min_child_age between 0 and 17),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create table if not exists public.clinic_service_areas (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'),
  city text not null check (length(btrim(city)) between 2 and 80),
  neighborhood text check (neighborhood is null or length(btrim(neighborhood)) between 2 and 80),
  created_at timestamptz not null default now(),
  constraint clinic_service_areas_unique unique nulls not distinct (clinic_id, state, city, neighborhood)
);

-- -----------------------------------------------------------------------------
-- 2) Horário por dia da semana (cascata)
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_weekday_hours (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = padrão da rede.
  clinic_id uuid references public.clinics (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = domingo
  closed boolean not null default false,
  open_time time,
  close_time time,
  lunch_start time,
  lunch_end time,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint clinic_weekday_hours_unique unique nulls not distinct (clinic_id, weekday),
  constraint clinic_weekday_hours_valid check (
    closed
    or (open_time is not null and close_time is not null and open_time < close_time)
  ),
  constraint clinic_weekday_hours_lunch check (
    (lunch_start is null and lunch_end is null)
    or (lunch_start is not null and lunch_end is not null and lunch_start < lunch_end
        and (closed or (lunch_start >= open_time and lunch_end <= close_time)))
  )
);

-- Semente: a mesma conta de `resolveAgendaSettings` (unidade > rede > padrão
-- do código: 08:00–18:00, segunda a sábado, sem almoço). A rede ganha 7 dias;
-- cada unidade COM configuração própria na agenda ganha as suas 7.
do $$
declare
  r record;
  d smallint;
begin
  for r in
    select null::uuid as clinic_id,
           coalesce(s.open_time, '08:00'::time) as open_time,
           coalesce(s.close_time, '18:00'::time) as close_time,
           coalesce(nullif(s.weekdays, '{}'), '{1,2,3,4,5,6}') as weekdays,
           coalesce(s.lunch_enabled, false) as lunch_on,
           coalesce(s.lunch_start, '12:00'::time) as lunch_start,
           coalesce(s.lunch_end, '13:00'::time) as lunch_end
    from (select 1) um
    left join public.clinic_agenda_settings s on s.clinic_id is null
    union all
    select s.clinic_id, s.open_time, s.close_time,
           coalesce(nullif(s.weekdays, '{}'), '{1,2,3,4,5,6}'),
           coalesce(s.lunch_enabled, false),
           coalesce(s.lunch_start, '12:00'::time),
           coalesce(s.lunch_end, '13:00'::time)
    from public.clinic_agenda_settings s
    where s.clinic_id is not null
  loop
    for d in 0..6 loop
      insert into public.clinic_weekday_hours
        (clinic_id, weekday, closed, open_time, close_time, lunch_start, lunch_end)
      values (
        r.clinic_id, d,
        not (d = any (r.weekdays)),
        case when d = any (r.weekdays) then r.open_time end,
        case when d = any (r.weekdays) then r.close_time end,
        case when d = any (r.weekdays) and r.lunch_on
              and r.lunch_start >= r.open_time and r.lunch_end <= r.close_time
              and r.lunch_start < r.lunch_end then r.lunch_start end,
        case when d = any (r.weekdays) and r.lunch_on
              and r.lunch_start >= r.open_time and r.lunch_end <= r.close_time
              and r.lunch_start < r.lunch_end then r.lunch_end end
      )
      on conflict on constraint clinic_weekday_hours_unique do nothing;
    end loop;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3) Feriados
-- -----------------------------------------------------------------------------
create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null check (length(btrim(name)) between 2 and 80),
  scope text not null check (scope in ('national', 'state', 'city')),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  city text check (city is null or length(btrim(city)) between 2 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint holidays_scope_fields check (
    (scope = 'national' and state is null and city is null)
    or (scope = 'state' and state is not null and city is null)
    or (scope = 'city' and state is not null and city is not null)
  ),
  constraint holidays_unique unique nulls not distinct (holiday_date, scope, state, city)
);

create index if not exists holidays_date on public.holidays (holiday_date);

-- Semente: os 12 nacionais de 2026 a 2029, gerados por `nationalHolidays()`.
insert into public.holidays (holiday_date, name, scope)
select v.d, v.n, 'national'
from (values
  (date '2026-01-01', 'Confraternização Universal'),
  (date '2026-02-17', 'Carnaval'),
  (date '2026-04-03', 'Sexta-feira Santa'),
  (date '2026-04-21', 'Tiradentes'),
  (date '2026-05-01', 'Dia do Trabalho'),
  (date '2026-06-04', 'Corpus Christi'),
  (date '2026-09-07', 'Independência do Brasil'),
  (date '2026-10-12', 'Nossa Senhora Aparecida'),
  (date '2026-11-02', 'Finados'),
  (date '2026-11-15', 'Proclamação da República'),
  (date '2026-11-20', 'Consciência Negra'),
  (date '2026-12-25', 'Natal'),
  (date '2027-01-01', 'Confraternização Universal'),
  (date '2027-02-09', 'Carnaval'),
  (date '2027-03-26', 'Sexta-feira Santa'),
  (date '2027-04-21', 'Tiradentes'),
  (date '2027-05-01', 'Dia do Trabalho'),
  (date '2027-05-27', 'Corpus Christi'),
  (date '2027-09-07', 'Independência do Brasil'),
  (date '2027-10-12', 'Nossa Senhora Aparecida'),
  (date '2027-11-02', 'Finados'),
  (date '2027-11-15', 'Proclamação da República'),
  (date '2027-11-20', 'Consciência Negra'),
  (date '2027-12-25', 'Natal'),
  (date '2028-01-01', 'Confraternização Universal'),
  (date '2028-02-29', 'Carnaval'),
  (date '2028-04-14', 'Sexta-feira Santa'),
  (date '2028-04-21', 'Tiradentes'),
  (date '2028-05-01', 'Dia do Trabalho'),
  (date '2028-06-15', 'Corpus Christi'),
  (date '2028-09-07', 'Independência do Brasil'),
  (date '2028-10-12', 'Nossa Senhora Aparecida'),
  (date '2028-11-02', 'Finados'),
  (date '2028-11-15', 'Proclamação da República'),
  (date '2028-11-20', 'Consciência Negra'),
  (date '2028-12-25', 'Natal'),
  (date '2029-01-01', 'Confraternização Universal'),
  (date '2029-02-13', 'Carnaval'),
  (date '2029-03-30', 'Sexta-feira Santa'),
  (date '2029-04-21', 'Tiradentes'),
  (date '2029-05-01', 'Dia do Trabalho'),
  (date '2029-05-31', 'Corpus Christi'),
  (date '2029-09-07', 'Independência do Brasil'),
  (date '2029-10-12', 'Nossa Senhora Aparecida'),
  (date '2029-11-02', 'Finados'),
  (date '2029-11-15', 'Proclamação da República'),
  (date '2029-11-20', 'Consciência Negra'),
  (date '2029-12-25', 'Natal')
) as v(d, n)
on conflict on constraint holidays_unique do nothing;

-- -----------------------------------------------------------------------------
-- 4) Quem lê e quem grava
-- -----------------------------------------------------------------------------
-- O Gerente pode cadastrar feriado do estado/cidade de uma unidade que ele gere.
create or replace function public.can_manage_holiday(p_scope text, p_state text, p_city text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
    or (
      p_scope in ('state', 'city')
      and exists (
        select 1 from public.clinics c
        where public.has_role_in_clinic(c.id, array['unit_manager']::public.user_role[])
          and upper(btrim(coalesce(c.state, ''))) = p_state
          and (p_scope = 'state'
               or lower(btrim(coalesce(c.city, ''))) = lower(btrim(coalesce(p_city, ''))))
      )
    );
$$;

revoke execute on function public.can_manage_holiday(text, text, text) from public, anon, authenticated;
grant execute on function public.can_manage_holiday(text, text, text) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['clinic_public_info', 'clinic_service_areas', 'clinic_weekday_hours', 'holidays'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
  end loop;
end $$;

-- Dados públicos e áreas: Admin ou o Gerente da unidade.
do $$
declare
  t text;
begin
  foreach t in array array['clinic_public_info', 'clinic_service_areas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_admin_master() or public.has_role_in_clinic(clinic_id, array[''unit_manager'']::public.user_role[])) '
      'with check (public.is_admin_master() or public.has_role_in_clinic(clinic_id, array[''unit_manager'']::public.user_role[]))',
      t || '_write', t);
  end loop;
end $$;

-- Horário por dia: a linha da REDE só o Admin; a da unidade, Admin ou Gerente.
drop policy if exists clinic_weekday_hours_write on public.clinic_weekday_hours;
create policy clinic_weekday_hours_write on public.clinic_weekday_hours
  for all to authenticated
  using (
    public.is_admin_master()
    or (clinic_id is not null
        and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[]))
  )
  with check (
    public.is_admin_master()
    or (clinic_id is not null
        and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[]))
  );

-- Feriados: Admin (todos) ou Gerente (estadual/municipal da unidade dele).
drop policy if exists holidays_write on public.holidays;
create policy holidays_write on public.holidays
  for all to authenticated
  using (public.can_manage_holiday(scope, state, city))
  with check (public.can_manage_holiday(scope, state, city));

grant select, insert, update, delete
  on public.clinic_public_info, public.clinic_service_areas,
     public.clinic_weekday_hours, public.holidays
  to authenticated;

select public.audit_attach_all();

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Conferência (rodar depois; esperado: 4 · 48 · 7 · 0)
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from information_schema.tables where table_schema = 'public'
--     and table_name in ('clinic_public_info', 'clinic_service_areas',
--                        'clinic_weekday_hours', 'holidays')) as tabelas,
--   (select count(*) from public.holidays where scope = 'national'
--     and holiday_date between '2026-01-01' and '2029-12-31') as feriados_nacionais,
--   (select count(*) from public.clinic_weekday_hours where clinic_id is null) as dias_da_rede,
--   (select count(*) from public.clinic_public_info) as dados_publicos;
