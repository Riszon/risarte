-- =============================================================================
-- 0128 — Chat Hub Lote 3: mensagem IMPORTANTE (insistência até visualizar)
-- -----------------------------------------------------------------------------
-- Quem envia pode marcar a mensagem como "importante". Enquanto o destinatário
-- não abrir a conversa (não marcar como lida), o sistema o reavisa: faixa fixa
-- no chat + pop-up/som repetidos a cada ~60s em qualquer tela. Para na hora que
-- ele abre a conversa. Idempotente.
-- =============================================================================

-- Sinaliza a mensagem como importante (padrão = normal).
alter table public.chat_messages
  add column if not exists important boolean not null default false;

-- Importantes não lidas por canal (para a faixa fixa e o marcador na lista):
-- só as que OUTROS enviaram e que chegaram depois da minha última leitura.
create or replace function public.chat_important_unread()
returns table (channel_id uuid, cnt integer, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    msg.channel_id,
    count(*)::int as cnt,
    max(msg.created_at) as last_at
  from public.chat_messages msg
  where msg.important = true
    and msg.channel_id in (select channel_id from public.chat_my_channel_ids())
    and msg.sender_id <> (select auth.uid())
    and msg.created_at > coalesce(
      (select r.last_read_at from public.chat_reads r
       where r.channel_id = msg.channel_id and r.user_id = (select auth.uid())),
      'epoch'::timestamptz
    )
  group by msg.channel_id;
$$;
grant execute on function public.chat_important_unread() to authenticated;

-- Total de importantes não lidas (o gatilho do reaviso insistente na sidebar).
create or replace function public.chat_important_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(count(*), 0)::int
  from public.chat_messages msg
  where msg.important = true
    and msg.channel_id in (select channel_id from public.chat_my_channel_ids())
    and msg.sender_id <> (select auth.uid())
    and msg.created_at > coalesce(
      (select r.last_read_at from public.chat_reads r
       where r.channel_id = msg.channel_id and r.user_id = (select auth.uid())),
      'epoch'::timestamptz
    );
$$;
grant execute on function public.chat_important_unread_total() to authenticated;
