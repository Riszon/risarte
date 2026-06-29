-- =============================================================================
-- Risarte Odontologia — Migration 0050 (GR6: Planejamento Anual de Atendimento)
-- A Gerente (e Admin) planeja o ano: recessos, férias coletivas/individuais,
-- eventos, treinamentos e manutenções programadas. Os itens FECHAM a agenda no
-- período (férias individuais fecham só as pessoas); um dia avulso liberado passa
-- por cima do bloqueio. Edições só no futuro, com histórico.
-- Idempotente.
-- =============================================================================

do $$ begin
  create type public.plan_item_type as enum (
    'recess', 'collective_vacation', 'individual_vacation',
    'event', 'training', 'maintenance');
exception when duplicate_object then null; end $$;

create table if not exists public.agenda_plan_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  type public.plan_item_type not null,
  starts_date date not null,
  ends_date date not null,
  title text,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_date >= starts_date)
);
create index if not exists agenda_plan_items_clinic_idx
  on public.agenda_plan_items (clinic_id, starts_date);

create table if not exists public.agenda_plan_item_people (
  item_id uuid not null references public.agenda_plan_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (item_id, user_id)
);

create table if not exists public.agenda_plan_item_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.agenda_plan_items (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  edited_by uuid references public.profiles (id) on delete set null,
  edited_at timestamptz not null default now(),
  before jsonb not null,
  after jsonb not null
);
create index if not exists agenda_plan_item_history_idx
  on public.agenda_plan_item_history (item_id, edited_at desc);

alter table public.agenda_plan_items enable row level security;
alter table public.agenda_plan_item_people enable row level security;
alter table public.agenda_plan_item_history enable row level security;

drop policy if exists "agenda_plan_items_select" on public.agenda_plan_items;
create policy "agenda_plan_items_select" on public.agenda_plan_items
  for select to authenticated using (true);
drop policy if exists "agenda_plan_item_people_select" on public.agenda_plan_item_people;
create policy "agenda_plan_item_people_select" on public.agenda_plan_item_people
  for select to authenticated using (true);
drop policy if exists "agenda_plan_item_history_select" on public.agenda_plan_item_history;
create policy "agenda_plan_item_history_select" on public.agenda_plan_item_history
  for select to authenticated using (true);

create or replace function public.plan_item_snapshot(p_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'type', i.type,
    'starts_date', i.starts_date,
    'ends_date', i.ends_date,
    'title', i.title,
    'note', i.note,
    'user_ids', coalesce(
      (select jsonb_agg(user_id) from public.agenda_plan_item_people where item_id = i.id),
      '[]'::jsonb)
  )
  from public.agenda_plan_items i where i.id = p_id;
$$;

-- Notify the listed people about a plan item (used by create/update).
create or replace function public.notify_plan_people(
  p_clinic_id uuid, p_item_id uuid, p_user_ids uuid[], p_verb text,
  p_starts date, p_ends date
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select u, p_clinic_id, 'Planejamento de atendimento ' || p_verb,
    'Período de ' || to_char(p_starts, 'DD/MM/YYYY') || ' a '
      || to_char(p_ends, 'DD/MM/YYYY') || '.',
    '/agenda/planejamento-anual'
  from unnest(p_user_ids) as u;
end $$;

-- -----------------------------------------------------------------------------
-- create_plan_item
-- -----------------------------------------------------------------------------
create or replace function public.create_plan_item(
  p_clinic_id uuid,
  p_type public.plan_item_type,
  p_starts date,
  p_ends date,
  p_title text,
  p_note text,
  p_user_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_ends < p_starts then raise exception 'INVALID_PERIOD'; end if;
  if p_ends < current_date then raise exception 'PERIOD_IN_PAST'; end if;
  if p_type = 'individual_vacation'
     and (p_user_ids is null or array_length(p_user_ids, 1) is null) then
    raise exception 'PEOPLE_REQUIRED';
  end if;

  insert into public.agenda_plan_items
    (clinic_id, type, starts_date, ends_date, title, note, created_by)
  values (p_clinic_id, p_type, p_starts, p_ends,
          nullif(btrim(coalesce(p_title, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning id into v_id;

  if p_user_ids is not null and array_length(p_user_ids, 1) is not null then
    insert into public.agenda_plan_item_people (item_id, user_id)
    select v_id, u from unnest(p_user_ids) as u on conflict do nothing;
    perform public.notify_plan_people(p_clinic_id, v_id, p_user_ids,
      'adicionado', p_starts, p_ends);
  end if;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- update_plan_item (edita item futuro; histórico + notificação)
-- -----------------------------------------------------------------------------
create or replace function public.update_plan_item(
  p_id uuid,
  p_type public.plan_item_type,
  p_starts date,
  p_ends date,
  p_title text,
  p_note text,
  p_user_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_old_end date;
  v_before jsonb;
  v_after jsonb;
begin
  select clinic_id, ends_date into v_clinic, v_old_end
  from public.agenda_plan_items where id = p_id;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_old_end < current_date or p_ends < current_date then
    raise exception 'PERIOD_IN_PAST';
  end if;
  if p_ends < p_starts then raise exception 'INVALID_PERIOD'; end if;
  if p_type = 'individual_vacation'
     and (p_user_ids is null or array_length(p_user_ids, 1) is null) then
    raise exception 'PEOPLE_REQUIRED';
  end if;

  v_before := public.plan_item_snapshot(p_id);
  update public.agenda_plan_items
  set type = p_type, starts_date = p_starts, ends_date = p_ends,
      title = nullif(btrim(coalesce(p_title, '')), ''),
      note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;
  delete from public.agenda_plan_item_people where item_id = p_id;
  if p_user_ids is not null and array_length(p_user_ids, 1) is not null then
    insert into public.agenda_plan_item_people (item_id, user_id)
    select p_id, u from unnest(p_user_ids) as u on conflict do nothing;
  end if;
  v_after := public.plan_item_snapshot(p_id);
  insert into public.agenda_plan_item_history
    (item_id, clinic_id, edited_by, before, after)
  values (p_id, v_clinic, (select auth.uid()), v_before, v_after);

  perform public.notify_plan_people(v_clinic, p_id, p_user_ids,
    'alterado', p_starts, p_ends);
end $$;

-- -----------------------------------------------------------------------------
-- delete_plan_item (só futuro)
-- -----------------------------------------------------------------------------
create or replace function public.delete_plan_item(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_end date;
begin
  select clinic_id, ends_date into v_clinic, v_end
  from public.agenda_plan_items where id = p_id;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_end < current_date then raise exception 'PERIOD_IN_PAST'; end if;
  delete from public.agenda_plan_items where id = p_id;
end $$;
