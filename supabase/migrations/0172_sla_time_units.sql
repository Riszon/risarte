-- =============================================================================
-- 0172 — I3: prazos em minutos / horas / dias / meses
-- -----------------------------------------------------------------------------
-- Até aqui o SLA só aceitava HORAS e as regras de ativo/inativo só DIAS. Agora
-- cada prazo guarda uma quantidade + uma unidade (minutos, horas, dias, meses)
-- e o sistema converte tudo para MINUTOS (`total_minutes`), que passa a ser a
-- medida oficial das comparações.
--
-- As colunas antigas continuam existindo e são mantidas em dia por gatilho
-- (`sla_settings.hours` e `inactivity_settings.value_days`), para nada que
-- ainda as leia quebrar. 1 mês = 30 dias.
-- Idempotente.
-- =============================================================================

-- 1) SLA ----------------------------------------------------------------------
alter table public.sla_settings
  add column if not exists amount integer,
  add column if not exists unit text,
  add column if not exists total_minutes integer;

do $$
begin
  alter table public.sla_settings
    add constraint sla_settings_unit_check
    check (unit is null or unit in ('minutes','hours','days','months'));
exception when duplicate_object then null;
end $$;

update public.sla_settings
   set amount = coalesce(amount, hours),
       unit = coalesce(unit, 'hours'),
       total_minutes = coalesce(total_minutes, hours * 60)
 where amount is null or unit is null or total_minutes is null;

create or replace function public.sla_settings_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_factor integer;
begin
  if new.unit is null then
    new.unit := 'hours';
  end if;
  if new.amount is null then
    new.amount := greatest(1, coalesce(new.hours, 1));
    new.unit := 'hours';
  end if;
  v_factor := case new.unit
                when 'minutes' then 1
                when 'hours' then 60
                when 'days' then 1440
                when 'months' then 43200   -- 1 mês = 30 dias
                else 60
              end;
  new.total_minutes := greatest(1, new.amount * v_factor);
  -- Compatibilidade: mantém `hours` coerente (arredondando para cima).
  new.hours := greatest(1, ceil(new.total_minutes / 60.0)::int);
  return new;
end;
$$;

drop trigger if exists sla_settings_normalize_trg on public.sla_settings;
create trigger sla_settings_normalize_trg
  before insert or update on public.sla_settings
  for each row execute function public.sla_settings_normalize();

-- 2) Ativo / inativo ----------------------------------------------------------
alter table public.inactivity_settings
  add column if not exists amount integer,
  add column if not exists unit text,
  add column if not exists total_minutes integer;

do $$
begin
  alter table public.inactivity_settings
    add constraint inactivity_settings_unit_check
    check (unit is null or unit in ('minutes','hours','days','months'));
exception when duplicate_object then null;
end $$;

update public.inactivity_settings
   set amount = coalesce(amount, value_days),
       unit = coalesce(unit, 'days'),
       total_minutes = coalesce(total_minutes, value_days * 1440)
 where amount is null or unit is null or total_minutes is null;

create or replace function public.inactivity_settings_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_factor integer;
begin
  if new.unit is null then
    new.unit := 'days';
  end if;
  if new.amount is null then
    new.amount := greatest(1, coalesce(new.value_days, 1));
    new.unit := 'days';
  end if;
  v_factor := case new.unit
                when 'minutes' then 1
                when 'hours' then 60
                when 'days' then 1440
                when 'months' then 43200
                else 1440
              end;
  new.total_minutes := greatest(1, new.amount * v_factor);
  new.value_days := greatest(1, ceil(new.total_minutes / 1440.0)::int);
  return new;
end;
$$;

drop trigger if exists inactivity_settings_normalize_trg on public.inactivity_settings;
create trigger inactivity_settings_normalize_trg
  before insert or update on public.inactivity_settings
  for each row execute function public.inactivity_settings_normalize();

-- 3) Limite efetivo em MINUTOS (unidade sobrescreve a rede) -------------------
create or replace function public.inactivity_threshold_minutes(
  p_clinic uuid,
  p_key text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select total_minutes from public.inactivity_settings
       where clinic_id = p_clinic and setting_key = p_key),
    (select total_minutes from public.inactivity_settings
       where clinic_id is null and setting_key = p_key)
  );
$$;

create or replace function public.sla_minutes(p_clinic uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select total_minutes from public.sla_settings
       where clinic_id = p_clinic and sla_key = p_key),
    (select total_minutes from public.sla_settings
       where clinic_id is null and sla_key = p_key)
  );
$$;

grant execute on function public.inactivity_threshold_minutes(uuid, text) to authenticated;
grant execute on function public.sla_minutes(uuid, text) to authenticated;

-- 4) Ativo/inativo passa a comparar MINUTOS -----------------------------------
-- Mesma lógica da 0020, trocando "diferença em dias inteiros" por "diferença em
-- minutos", que é o que permite prazos menores que um dia.
create or replace function public.recompute_client_activity(p_clinic_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clients c
  set status = case when (
    case c.journey_phase
      when 'acquisition' then
        extract(epoch from (now() - c.phase_entered_at)) / 60
          > public.inactivity_threshold_minutes(c.clinic_id, 'phase1_max_days')
      when 'clinical_conversion' then
        extract(epoch from (now() - c.phase_entered_at)) / 60
          > public.inactivity_threshold_minutes(c.clinic_id, 'phase2_max_days')
      when 'commercial_conversion' then
        extract(epoch from (now() - c.phase_entered_at)) / 60
          > public.inactivity_threshold_minutes(c.clinic_id, 'phase4_max_days')
      when 'treatment_start' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select extract(epoch from (now() - max(a.starts_at))) / 60
             from public.appointments a where a.client_id = c.id), 99999999)
          > public.inactivity_threshold_minutes(c.clinic_id, 'phase5_6_no_appt_days')
      when 'reevaluation' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select extract(epoch from (now() - max(a.starts_at))) / 60
             from public.appointments a where a.client_id = c.id), 99999999)
          > public.inactivity_threshold_minutes(c.clinic_id, 'phase5_6_no_appt_days')
      when 'planning_center' then
        coalesce(
          (select extract(epoch from (now() - max(a.starts_at))) / 60
             from public.appointments a
             where a.client_id = c.id
               and (a.status = 'completed' or a.attendance = 'done')),
          extract(epoch from (now() - c.created_at)) / 60)
          > public.inactivity_threshold_minutes(c.clinic_id, 'no_attendance_days')
      when 'follow_up' then
        coalesce(
          (select extract(epoch from (now() - max(a.starts_at))) / 60
             from public.appointments a where a.client_id = c.id),
          extract(epoch from (now() - c.created_at)) / 60)
          > public.inactivity_threshold_minutes(c.clinic_id, 'phase7_inactivity_days')
      else false
    end
  ) then 'inactive'::public.client_status else 'active'::public.client_status end
  where c.status <> 'anonymized'
    and (p_clinic_id is null or c.clinic_id = p_clinic_id);
$$;
