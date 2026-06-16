-- =============================================================================
-- Risarte Odontologia — Migration 0020 (Lote Base da Jornada, passo 6)
-- Automatic active/inactive rules, with thresholds configurable in the Prazos
-- screen (network default + per-unit override, like SLAs). recompute_client_
-- activity() applies them; a daily pg_cron job runs it (best-effort).
-- Idempotent: safe to run more than once.
-- =============================================================================

create table if not exists public.inactivity_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete cascade,
  setting_key text not null,
  value_days integer not null check (value_days > 0),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (clinic_id, setting_key)
);

drop trigger if exists inactivity_settings_set_updated_at on public.inactivity_settings;
create trigger inactivity_settings_set_updated_at
  before update on public.inactivity_settings
  for each row execute function public.set_updated_at();

alter table public.inactivity_settings enable row level security;

drop policy if exists "inactivity_settings_select_all" on public.inactivity_settings;
create policy "inactivity_settings_select_all"
  on public.inactivity_settings for select to authenticated using (true);
drop policy if exists "inactivity_settings_insert_admin" on public.inactivity_settings;
create policy "inactivity_settings_insert_admin"
  on public.inactivity_settings for insert to authenticated with check (public.is_admin_master());
drop policy if exists "inactivity_settings_update_admin" on public.inactivity_settings;
create policy "inactivity_settings_update_admin"
  on public.inactivity_settings for update to authenticated using (public.is_admin_master()) with check (public.is_admin_master());
drop policy if exists "inactivity_settings_delete_admin" on public.inactivity_settings;
create policy "inactivity_settings_delete_admin"
  on public.inactivity_settings for delete to authenticated using (public.is_admin_master());

-- Network defaults (days; 12 months = 365 days). Skip if already present.
insert into public.inactivity_settings (clinic_id, setting_key, value_days) values
  (null, 'phase1_max_days', 60),
  (null, 'phase2_max_days', 90),
  (null, 'phase4_max_days', 90),
  (null, 'phase5_6_no_appt_days', 90),
  (null, 'phase7_inactivity_days', 365),
  (null, 'no_attendance_days', 365)
on conflict do nothing;

-- Effective threshold for a clinic (unit override > network default).
create or replace function public.inactivity_threshold(p_clinic uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select value_days from public.inactivity_settings
       where clinic_id = p_clinic and setting_key = p_key),
    (select value_days from public.inactivity_settings
       where clinic_id is null and setting_key = p_key)
  );
$$;

-- -----------------------------------------------------------------------------
-- Recompute active/inactive for all (or one clinic's) non-anonymized clients.
-- Whole-day differences via date subtraction (integer days).
-- -----------------------------------------------------------------------------
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
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase1_max_days')
      when 'clinical_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase2_max_days')
      when 'commercial_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase4_max_days')
      when 'treatment_start' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'reevaluation' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'planning_center' then
        coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a
             where a.client_id = c.id
               and (a.status = 'completed' or a.attendance = 'done')),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'no_attendance_days')
      when 'follow_up' then
        coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'phase7_inactivity_days')
      else false
    end
  ) then 'inactive'::public.client_status
    else 'active'::public.client_status end
  where c.status <> 'anonymized'
    and (p_clinic_id is null or c.clinic_id = p_clinic_id);
$$;

-- Best-effort daily job (skipped silently if pg_cron is not available).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('risarte-recompute-activity');
exception when others then null;
end;
$$;
do $$
begin
  perform cron.schedule(
    'risarte-recompute-activity', '0 3 * * *',
    'select public.recompute_client_activity()'
  );
exception when others then null;
end;
$$;

-- Run once now so the field reflects the rules immediately.
select public.recompute_client_activity();
