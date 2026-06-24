-- =============================================================================
-- Risarte Odontologia — Migration 0046 (LOTE G — G4: fechar agenda)
-- Bloqueios de agenda (compromisso pessoal, evento, manutenção, treinamento)
-- por período, com abrangência: unidade toda / salas específicas / profissionais
-- específicos. Bloqueia novos agendamentos (validado no app) e SINALIZA os
-- agendamentos já existentes no período (needs_reschedule) + notifica a recepção.
-- Quem pode fechar: Admin, Gerente de Unidade ou Recepcionista da unidade.
-- Idempotente.
-- =============================================================================

do $$ begin
  create type public.agenda_closure_reason as enum
    ('personal', 'event', 'maintenance', 'training', 'other');
exception when duplicate_object then null; end $$;

create table if not exists public.agenda_closures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  scope text not null default 'unit',           -- 'unit' | 'rooms' | 'providers'
  reason public.agenda_closure_reason not null default 'other',
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (scope in ('unit', 'rooms', 'providers'))
);
create index if not exists agenda_closures_clinic_idx
  on public.agenda_closures (clinic_id, starts_at);

create table if not exists public.agenda_closure_rooms (
  closure_id uuid not null references public.agenda_closures (id) on delete cascade,
  room_id uuid not null references public.clinic_rooms (id) on delete cascade,
  primary key (closure_id, room_id)
);

create table if not exists public.agenda_closure_providers (
  closure_id uuid not null references public.agenda_closures (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (closure_id, user_id)
);

alter table public.appointments
  add column if not exists needs_reschedule boolean not null default false;

-- -----------------------------------------------------------------------------
-- RLS: leitura para qualquer autenticado (é agenda, não dado de paciente).
-- Escrita só pelas funções SECURITY DEFINER abaixo (sem policy de insert/delete).
-- -----------------------------------------------------------------------------
alter table public.agenda_closures enable row level security;
alter table public.agenda_closure_rooms enable row level security;
alter table public.agenda_closure_providers enable row level security;

drop policy if exists "agenda_closures_select" on public.agenda_closures;
create policy "agenda_closures_select" on public.agenda_closures
  for select to authenticated using (true);

drop policy if exists "agenda_closure_rooms_select" on public.agenda_closure_rooms;
create policy "agenda_closure_rooms_select" on public.agenda_closure_rooms
  for select to authenticated using (true);

drop policy if exists "agenda_closure_providers_select" on public.agenda_closure_providers;
create policy "agenda_closure_providers_select" on public.agenda_closure_providers
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- create_agenda_closure: cria o bloqueio + abrangência, sinaliza agendamentos
-- afetados (needs_reschedule) e notifica recepção/gerência da unidade.
-- -----------------------------------------------------------------------------
create or replace function public.create_agenda_closure(
  p_clinic_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason public.agenda_closure_reason,
  p_scope text,
  p_note text,
  p_room_ids uuid[],
  p_provider_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count integer;
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         p_clinic_id, array['receptionist', 'unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'INVALID_PERIOD';
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

  insert into public.agenda_closures
    (clinic_id, starts_at, ends_at, reason, scope, note, created_by)
  values
    (p_clinic_id, p_starts_at, p_ends_at, p_reason, p_scope,
     nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning id into v_id;

  if p_scope = 'rooms' then
    insert into public.agenda_closure_rooms (closure_id, room_id)
    select v_id, r from unnest(p_room_ids) as r
    on conflict do nothing;
  elsif p_scope = 'providers' then
    insert into public.agenda_closure_providers (closure_id, user_id)
    select v_id, u from unnest(p_provider_ids) as u
    on conflict do nothing;
  end if;

  with affected as (
    update public.appointments a set needs_reschedule = true
    where a.clinic_id = p_clinic_id
      and a.status::text not in ('cancelled', 'no_show')
      and a.ends_at > now()
      and a.starts_at < p_ends_at and a.ends_at > p_starts_at
      and (
        p_scope = 'unit'
        or (p_scope = 'rooms' and a.room_id = any(p_room_ids))
        or (p_scope = 'providers' and a.provider_user_id = any(p_provider_ids))
      )
    returning a.id
  )
  select count(*) into v_count from affected;

  if v_count > 0 then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, p_clinic_id,
      'Fechamento de agenda — remarcar agendamentos',
      v_count || ' agendamento(s) no período fechado precisam ser remarcados.',
      '/agenda?vista=dia&ref=' || to_char(p_starts_at, 'YYYY-MM-DD')
    from public.user_clinic_roles ucr
    where ucr.clinic_id = p_clinic_id
      and ucr.role in ('receptionist', 'unit_manager');
  end if;

  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- delete_agenda_closure: remove o bloqueio e recalcula needs_reschedule dos
-- agendamentos futuros da unidade (limpa os que não estão mais em nenhum bloqueio).
-- -----------------------------------------------------------------------------
create or replace function public.delete_agenda_closure(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
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

  delete from public.agenda_closures where id = p_id;

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
  where a.clinic_id = v_clinic
    and a.status::text not in ('cancelled', 'no_show')
    and a.ends_at > now();
end $$;
