-- =============================================================================
-- 0120 — Chat Hub (H4.9 Lote 1: texto)
-- -----------------------------------------------------------------------------
-- Conversas internas da equipe: canal da unidade (todos com acesso à unidade),
-- mensagens diretas 1:1, e a franqueadora conectada às unidades (vê/participa
-- dos canais das unidades pelo escopo de acesso). Tempo real via Supabase
-- Realtime. Recibo de leitura por chat_reads.last_read_at. Idempotente.
-- =============================================================================

create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('unit', 'direct')),
  clinic_id uuid references public.clinics (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
-- Um único canal por unidade.
create unique index if not exists chat_channels_unit_key
  on public.chat_channels (clinic_id) where kind = 'unit';

create table if not exists public.chat_channel_members (
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (channel_id, user_id)
);
create index if not exists chat_channel_members_user_idx
  on public.chat_channel_members (user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_channel_idx
  on public.chat_messages (channel_id, created_at);

create table if not exists public.chat_reads (
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.chat_channels enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;

-- Acesso a um canal: Admin, unidade (canal da unidade que o usuário enxerga —
-- inclui o escopo da franqueadora) ou membro (canal direto). SECURITY DEFINER
-- para evitar recursão de RLS. -------------------------------------------------
create or replace function public.can_access_chat_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel_id and (
      public.is_admin_master()
      or (
        c.kind = 'unit' and (
          c.clinic_id in (select public.user_clinic_ids())
          or c.clinic_id in (select public.user_full_access_clinic_ids())
        )
      )
      or (
        c.kind = 'direct' and exists (
          select 1 from public.chat_channel_members m
          where m.channel_id = c.id and m.user_id = (select auth.uid())
        )
      )
    )
  );
$$;
grant execute on function public.can_access_chat_channel(uuid) to authenticated;

-- Policies (criação de canal só por RPC SECURITY DEFINER; sem policy de insert).
drop policy if exists "chat_channels_select" on public.chat_channels;
create policy "chat_channels_select" on public.chat_channels
  for select to authenticated
  using (public.can_access_chat_channel(id));

drop policy if exists "chat_members_select" on public.chat_channel_members;
create policy "chat_members_select" on public.chat_channel_members
  for select to authenticated
  using (public.can_access_chat_channel(channel_id));

drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages
  for select to authenticated
  using (public.can_access_chat_channel(channel_id));

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.can_access_chat_channel(channel_id)
  );

drop policy if exists "chat_reads_all" on public.chat_reads;
create policy "chat_reads_all" on public.chat_reads
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Criação de canais -----------------------------------------------------------
create or replace function public.ensure_unit_chat_channel(p_clinic_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (
    public.is_admin_master()
    or p_clinic_id in (select public.user_clinic_ids())
    or p_clinic_id in (select public.user_full_access_clinic_ids())
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  select id into v_id from public.chat_channels
  where kind = 'unit' and clinic_id = p_clinic_id;
  if v_id is null then
    insert into public.chat_channels (kind, clinic_id, created_by)
    values ('unit', p_clinic_id, (select auth.uid()))
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function public.ensure_unit_chat_channel(uuid) to authenticated;

create or replace function public.ensure_direct_chat_channel(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_me uuid := (select auth.uid());
begin
  if p_other is null or p_other = v_me then raise exception 'INVALID'; end if;
  -- Pode conversar se: Admin; compartilham uma unidade; ou o chamador tem acesso
  -- pleno (franqueadora) a uma unidade onde o outro atua.
  if not (
    public.is_admin_master()
    or exists (
      select 1 from public.user_clinic_roles a
      join public.user_clinic_roles b on a.clinic_id = b.clinic_id
      where a.user_id = v_me and b.user_id = p_other
    )
    or exists (
      select 1 from public.user_clinic_roles b
      where b.user_id = p_other
        and b.clinic_id in (select public.user_full_access_clinic_ids())
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select c.id into v_id
  from public.chat_channels c
  where c.kind = 'direct'
    and exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = c.id and m.user_id = v_me
    )
    and exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = c.id and m.user_id = p_other
    )
    and (
      select count(*) from public.chat_channel_members m where m.channel_id = c.id
    ) = 2
  limit 1;

  if v_id is null then
    insert into public.chat_channels (kind, created_by)
    values ('direct', v_me) returning id into v_id;
    insert into public.chat_channel_members (channel_id, user_id)
    values (v_id, v_me), (v_id, p_other);
  end if;
  return v_id;
end $$;
grant execute on function public.ensure_direct_chat_channel(uuid) to authenticated;

-- Total de mensagens não lidas do usuário (para o badge do menu). -------------
create or replace function public.chat_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(count(*), 0)::int
  from public.chat_messages msg
  join public.chat_channels c on c.id = msg.channel_id
  where msg.sender_id <> (select auth.uid())
    and public.can_access_chat_channel(msg.channel_id)
    and msg.created_at > coalesce(
      (select r.last_read_at from public.chat_reads r
       where r.channel_id = msg.channel_id and r.user_id = (select auth.uid())),
      'epoch'::timestamptz
    );
$$;
grant execute on function public.chat_unread_total() to authenticated;

-- Realtime: publica inserts de mensagens para o Supabase Realtime.
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; when others then null; end $$;
