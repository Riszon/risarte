-- =============================================================================
-- Risarte Odontologia — Migration 0049 (GR4: dia avulso com horário + almoço)
-- * agenda_open_days ganha horário de início/fim; histórico de edições.
-- * clinic_agenda_settings ganha horário de almoço (opcional).
-- * open_special_days passa a receber horário; update_special_day edita (com
--   histórico) e remove_special_day/edição bloqueiam dias passados.
-- Idempotente.
-- =============================================================================

alter table public.agenda_open_days
  add column if not exists start_time time not null default '08:00',
  add column if not exists end_time time not null default '18:00';

alter table public.clinic_agenda_settings
  add column if not exists lunch_enabled boolean not null default false,
  add column if not exists lunch_start time not null default '12:00',
  add column if not exists lunch_end time not null default '13:00';

create table if not exists public.agenda_open_day_history (
  id uuid primary key default gen_random_uuid(),
  open_day_id uuid not null references public.agenda_open_days (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  edited_by uuid references public.profiles (id) on delete set null,
  edited_at timestamptz not null default now(),
  before jsonb not null,
  after jsonb not null
);
create index if not exists agenda_open_day_history_idx
  on public.agenda_open_day_history (open_day_id, edited_at desc);
alter table public.agenda_open_day_history enable row level security;
drop policy if exists "agenda_open_day_history_select" on public.agenda_open_day_history;
create policy "agenda_open_day_history_select" on public.agenda_open_day_history
  for select to authenticated using (true);

create or replace function public.open_day_snapshot(p_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'date', d.date,
    'start_time', d.start_time,
    'end_time', d.end_time,
    'note', d.note,
    'staff_ids', coalesce(
      (select jsonb_agg(user_id) from public.agenda_open_day_staff where open_day_id = d.id),
      '[]'::jsonb)
  )
  from public.agenda_open_days d where d.id = p_id;
$$;

-- -----------------------------------------------------------------------------
-- open_special_days (com horário). Substitui a versão sem horário (0047).
-- -----------------------------------------------------------------------------
drop function if exists public.open_special_days(uuid, date[], uuid[], text);
create or replace function public.open_special_days(
  p_clinic_id uuid,
  p_dates date[],
  p_start_time time,
  p_end_time time,
  p_staff_ids uuid[],
  p_note text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
  v_open_id uuid;
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_dates is null or array_length(p_dates, 1) is null then
    raise exception 'DATES_REQUIRED';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'INVALID_PERIOD';
  end if;

  foreach v_date in array p_dates loop
    if v_date < current_date then
      continue; -- nunca libera dia no passado
    end if;
    insert into public.agenda_open_days
      (clinic_id, date, note, start_time, end_time, created_by)
    values (p_clinic_id, v_date, nullif(btrim(coalesce(p_note, '')), ''),
            p_start_time, p_end_time, (select auth.uid()))
    on conflict (clinic_id, date) do update
      set note = excluded.note,
          start_time = excluded.start_time,
          end_time = excluded.end_time
    returning id into v_open_id;

    if p_staff_ids is not null and array_length(p_staff_ids, 1) is not null then
      insert into public.agenda_open_day_staff (open_day_id, user_id)
      select v_open_id, u from unnest(p_staff_ids) as u on conflict do nothing;

      insert into public.notifications (user_id, clinic_id, title, body, link)
      select u, p_clinic_id, 'Atendimento em dia avulso',
        'Você foi escalado para atender em ' || to_char(v_date, 'DD/MM/YYYY')
          || ' (' || to_char(p_start_time, 'HH24:MI') || '–'
          || to_char(p_end_time, 'HH24:MI') || ').',
        '/agenda?vista=dia&ref=' || to_char(v_date, 'YYYY-MM-DD')
      from unnest(p_staff_ids) as u;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- update_special_day: edita um dia avulso FUTURO (com histórico + notificação).
-- -----------------------------------------------------------------------------
create or replace function public.update_special_day(
  p_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_staff_ids uuid[],
  p_note text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_old_date date;
  v_before jsonb;
  v_after jsonb;
begin
  select clinic_id, date into v_clinic, v_old_date
  from public.agenda_open_days where id = p_id;
  if v_clinic is null then
    raise exception 'NOT_FOUND';
  end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_old_date < current_date or p_date < current_date then
    raise exception 'PAST_DAY';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'INVALID_PERIOD';
  end if;

  v_before := public.open_day_snapshot(p_id);
  update public.agenda_open_days
  set date = p_date,
      start_time = p_start_time,
      end_time = p_end_time,
      note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;

  delete from public.agenda_open_day_staff where open_day_id = p_id;
  if p_staff_ids is not null and array_length(p_staff_ids, 1) is not null then
    insert into public.agenda_open_day_staff (open_day_id, user_id)
    select p_id, u from unnest(p_staff_ids) as u on conflict do nothing;
  end if;

  v_after := public.open_day_snapshot(p_id);
  insert into public.agenda_open_day_history
    (open_day_id, clinic_id, edited_by, before, after)
  values (p_id, v_clinic, (select auth.uid()), v_before, v_after);

  if p_staff_ids is not null and array_length(p_staff_ids, 1) is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select u, v_clinic, 'Dia avulso alterado',
      'O atendimento em ' || to_char(p_date, 'DD/MM/YYYY') || ' foi atualizado ('
        || to_char(p_start_time, 'HH24:MI') || '–'
        || to_char(p_end_time, 'HH24:MI') || ').',
      '/agenda?vista=dia&ref=' || to_char(p_date, 'YYYY-MM-DD')
    from unnest(p_staff_ids) as u;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- remove_special_day: agora bloqueia dia passado (vira histórico).
-- -----------------------------------------------------------------------------
create or replace function public.remove_special_day(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_date date;
begin
  select clinic_id, date into v_clinic, v_date
  from public.agenda_open_days where id = p_id;
  if v_clinic is null then
    raise exception 'NOT_FOUND';
  end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_date < current_date then
    raise exception 'PAST_DAY';
  end if;
  delete from public.agenda_open_days where id = p_id;
end $$;
