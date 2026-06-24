-- =============================================================================
-- Risarte Odontologia — Migration 0048 (GR3: editar fechamento + histórico)
-- Permite EDITAR um fechamento de agenda, registrando o antes/depois (histórico)
-- e recalculando os agendamentos afetados. Não permite fechamento no passado.
-- Idempotente.
-- =============================================================================

create table if not exists public.agenda_closure_history (
  id uuid primary key default gen_random_uuid(),
  closure_id uuid not null references public.agenda_closures (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  edited_by uuid references public.profiles (id) on delete set null,
  edited_at timestamptz not null default now(),
  before jsonb not null,
  after jsonb not null
);
create index if not exists agenda_closure_history_idx
  on public.agenda_closure_history (closure_id, edited_at desc);

alter table public.agenda_closure_history enable row level security;
drop policy if exists "agenda_closure_history_select" on public.agenda_closure_history;
create policy "agenda_closure_history_select" on public.agenda_closure_history
  for select to authenticated using (true);

-- Snapshot of a closure (used for the before/after history).
create or replace function public.closure_snapshot(p_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'starts_at', c.starts_at,
    'ends_at', c.ends_at,
    'scope', c.scope,
    'reason', c.reason,
    'note', c.note,
    'room_ids', coalesce(
      (select jsonb_agg(room_id) from public.agenda_closure_rooms where closure_id = c.id),
      '[]'::jsonb),
    'provider_ids', coalesce(
      (select jsonb_agg(user_id) from public.agenda_closure_providers where closure_id = c.id),
      '[]'::jsonb)
  )
  from public.agenda_closures c where c.id = p_id;
$$;

-- Recompute needs_reschedule for a clinic's future appointments.
create or replace function public.recompute_closure_flags(p_clinic_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.appointments a
  set needs_reschedule = exists (
    select 1 from public.agenda_closures c
    where c.clinic_id = a.clinic_id
      and c.starts_at < a.ends_at and c.ends_at > a.starts_at
      and (
        c.scope = 'unit'
        or (c.scope = 'rooms' and exists (
              select 1 from public.agenda_closure_rooms cr
              where cr.closure_id = c.id and cr.room_id = a.room_id))
        or (c.scope = 'providers' and exists (
              select 1 from public.agenda_closure_providers cp
              where cp.closure_id = c.id and cp.user_id = a.provider_user_id))
      )
  )
  where a.clinic_id = p_clinic_id
    and a.status::text not in ('cancelled', 'no_show')
    and a.ends_at > now();
end $$;

-- -----------------------------------------------------------------------------
-- update_agenda_closure: edita um fechamento, grava o antes/depois e recalcula
-- os agendamentos afetados (+ notifica a recepção). Bloqueia período no passado.
-- -----------------------------------------------------------------------------
create or replace function public.update_agenda_closure(
  p_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason public.agenda_closure_reason,
  p_scope text,
  p_note text,
  p_room_ids uuid[],
  p_provider_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_before jsonb;
  v_after jsonb;
  v_count integer;
begin
  select clinic_id into v_clinic from public.agenda_closures where id = p_id;
  if v_clinic is null then
    raise exception 'NOT_FOUND';
  end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['receptionist', 'unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'INVALID_PERIOD';
  end if;
  if p_ends_at <= now() then
    raise exception 'PERIOD_IN_PAST';
  end if;
  if p_scope not in ('unit', 'rooms', 'providers') then
    raise exception 'INVALID_SCOPE';
  end if;
  if p_scope = 'rooms'
     and (p_room_ids is null or array_length(p_room_ids, 1) is null) then
    raise exception 'ROOMS_REQUIRED';
  end if;
  if p_scope = 'providers'
     and (p_provider_ids is null or array_length(p_provider_ids, 1) is null) then
    raise exception 'PROVIDERS_REQUIRED';
  end if;

  v_before := public.closure_snapshot(p_id);

  update public.agenda_closures
  set starts_at = p_starts_at,
      ends_at = p_ends_at,
      scope = p_scope,
      reason = p_reason,
      note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;

  delete from public.agenda_closure_rooms where closure_id = p_id;
  delete from public.agenda_closure_providers where closure_id = p_id;
  if p_scope = 'rooms' then
    insert into public.agenda_closure_rooms (closure_id, room_id)
    select p_id, r from unnest(p_room_ids) as r on conflict do nothing;
  elsif p_scope = 'providers' then
    insert into public.agenda_closure_providers (closure_id, user_id)
    select p_id, u from unnest(p_provider_ids) as u on conflict do nothing;
  end if;

  v_after := public.closure_snapshot(p_id);
  insert into public.agenda_closure_history
    (closure_id, clinic_id, edited_by, before, after)
  values (p_id, v_clinic, (select auth.uid()), v_before, v_after);

  perform public.recompute_closure_flags(v_clinic);

  select count(*) into v_count
  from public.appointments a
  where a.clinic_id = v_clinic
    and a.status::text not in ('cancelled', 'no_show')
    and a.ends_at > now()
    and a.starts_at < p_ends_at and a.ends_at > p_starts_at
    and (
      p_scope = 'unit'
      or (p_scope = 'rooms' and a.room_id = any(p_room_ids))
      or (p_scope = 'providers' and a.provider_user_id = any(p_provider_ids))
    );

  if v_count > 0 then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic,
      'Fechamento de agenda alterado — remarcar agendamentos',
      v_count || ' agendamento(s) no novo período precisam ser remarcados.',
      '/agenda?vista=dia&ref=' || to_char(p_starts_at, 'YYYY-MM-DD')
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('receptionist', 'unit_manager');
  end if;
end $$;
