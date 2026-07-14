-- =============================================================================
-- 0125 — Chat Hub R3: reações + responder mensagem específica
-- -----------------------------------------------------------------------------
-- chat_reactions: emoji por (mensagem, usuário). chat_messages.reply_to: aponta
-- para a mensagem que está sendo respondida (citação). Idempotente.
-- =============================================================================

alter table public.chat_messages
  add column if not exists reply_to uuid
  references public.chat_messages (id) on delete set null;

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_reactions_msg_idx
  on public.chat_reactions (message_id);

alter table public.chat_reactions enable row level security;

-- Leitura: quem acessa o canal da mensagem. Escrita: a própria reação.
drop policy if exists "chat_reactions_select" on public.chat_reactions;
create policy "chat_reactions_select" on public.chat_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and public.can_access_chat_channel(m.channel_id)
    )
  );

drop policy if exists "chat_reactions_insert" on public.chat_reactions;
create policy "chat_reactions_insert" on public.chat_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and public.can_access_chat_channel(m.channel_id)
    )
  );

drop policy if exists "chat_reactions_delete" on public.chat_reactions;
create policy "chat_reactions_delete" on public.chat_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Realtime das reações (aparecem na hora).
do $$ begin
  alter publication supabase_realtime add table public.chat_reactions;
exception when duplicate_object then null; when others then null; end $$;
