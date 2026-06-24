-- =============================================================================
-- Risarte Odontologia — Migration 0047 (LOTE G — G5: dias avulsos + feriados)
-- * agenda_open_days: dias avulsos liberados pela Gerente (ex.: um sábado), com
--   os profissionais escalados (notificados).
-- * clinic_holiday_decisions: decisão da Gerente para cada feriado (haverá
--   atendimento ou não). Feriados são conhecidos pelo app (lib/holidays.ts).
-- Idempotente.
-- =============================================================================

create table if not exists public.agenda_open_days (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  date date not null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (clinic_id, date)
);
create index if not exists agenda_open_days_clinic_idx
  on public.agenda_open_days (clinic_id, date);

create table if not exists public.agenda_open_day_staff (
  open_day_id uuid not null references public.agenda_open_days (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (open_day_id, user_id)
);

create table if not exists public.clinic_holiday_decisions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  holiday_date date not null,
  will_attend boolean not null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  unique (clinic_id, holiday_date)
);

-- RLS: leitura para autenticado; escrita só pelas funções SECURITY DEFINER.
alter table public.agenda_open_days enable row level security;
alter table public.agenda_open_day_staff enable row level security;
alter table public.clinic_holiday_decisions enable row level security;

drop policy if exists "agenda_open_days_select" on public.agenda_open_days;
create policy "agenda_open_days_select" on public.agenda_open_days
  for select to authenticated using (true);

drop policy if exists "agenda_open_day_staff_select" on public.agenda_open_day_staff;
create policy "agenda_open_day_staff_select" on public.agenda_open_day_staff
  for select to authenticated using (true);

drop policy if exists "clinic_holiday_decisions_select" on public.clinic_holiday_decisions;
create policy "clinic_holiday_decisions_select" on public.clinic_holiday_decisions
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- open_special_days: libera um ou mais dias avulsos e escala (notifica) staff.
-- -----------------------------------------------------------------------------
create or replace function public.open_special_days(
  p_clinic_id uuid,
  p_dates date[],
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

  foreach v_date in array p_dates loop
    insert into public.agenda_open_days (clinic_id, date, note, created_by)
    values (p_clinic_id, v_date, nullif(btrim(coalesce(p_note, '')), ''),
            (select auth.uid()))
    on conflict (clinic_id, date) do update set note = excluded.note
    returning id into v_open_id;

    if p_staff_ids is not null and array_length(p_staff_ids, 1) is not null then
      insert into public.agenda_open_day_staff (open_day_id, user_id)
      select v_open_id, u from unnest(p_staff_ids) as u
      on conflict do nothing;

      insert into public.notifications (user_id, clinic_id, title, body, link)
      select u, p_clinic_id, 'Atendimento em dia avulso',
        'Você foi escalado para atender em ' || to_char(v_date, 'DD/MM/YYYY') || '.',
        '/agenda?vista=dia&ref=' || to_char(v_date, 'YYYY-MM-DD')
      from unnest(p_staff_ids) as u;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- remove_special_day: remove um dia avulso liberado.
-- -----------------------------------------------------------------------------
create or replace function public.remove_special_day(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.agenda_open_days where id = p_id;
  if v_clinic is null then
    raise exception 'NOT_FOUND';
  end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  delete from public.agenda_open_days where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
-- decide_holiday: a Gerente confirma se haverá atendimento num feriado.
-- -----------------------------------------------------------------------------
create or replace function public.decide_holiday(
  p_clinic_id uuid,
  p_date date,
  p_will_attend boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  insert into public.clinic_holiday_decisions
    (clinic_id, holiday_date, will_attend, decided_by, decided_at)
  values (p_clinic_id, p_date, p_will_attend, (select auth.uid()), now())
  on conflict (clinic_id, holiday_date) do update
    set will_attend = excluded.will_attend,
        decided_by = excluded.decided_by,
        decided_at = now();
end $$;

-- -----------------------------------------------------------------------------
-- notify_pending_holidays: cria (de forma idempotente) uma notificação para a
-- Gerente sobre feriados próximos ainda não decididos. O app sabe quais datas
-- são feriado (lib/holidays.ts) e passa as listas.
-- -----------------------------------------------------------------------------
create or replace function public.notify_pending_holidays(
  p_clinic_id uuid,
  p_dates date[],
  p_names text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i integer;
  v_link text;
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])
  ) then
    return; -- silencioso: só gerência/admin disparam
  end if;
  if p_dates is null or array_length(p_dates, 1) is null then
    return;
  end if;

  for i in 1..array_length(p_dates, 1) loop
    if exists (
      select 1 from public.clinic_holiday_decisions d
      where d.clinic_id = p_clinic_id and d.holiday_date = p_dates[i]
    ) then
      continue;
    end if;
    v_link := '/agenda?vista=dia&ref=' || to_char(p_dates[i], 'YYYY-MM-DD');
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, p_clinic_id,
      'Feriado a confirmar — ' || p_names[i],
      'Haverá atendimento no feriado ' || to_char(p_dates[i], 'DD/MM/YYYY')
        || ' (' || p_names[i] || ')? Confirme na agenda.',
      v_link
    from public.user_clinic_roles ucr
    where ucr.clinic_id = p_clinic_id and ucr.role = 'unit_manager'
      and not exists (
        select 1 from public.notifications n
        where n.user_id = ucr.user_id
          and n.link = v_link
          and n.title like 'Feriado a confirmar%'
      );
  end loop;
end $$;
