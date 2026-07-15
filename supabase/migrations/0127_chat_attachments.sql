-- =============================================================================
-- 0127 — Chat Hub Lote 2: anexos (áudio + arquivos)
-- -----------------------------------------------------------------------------
-- Uma mensagem pode ter um anexo (arquivo/imagem/áudio). Os bytes ficam no
-- bucket privado 'chat-media' (link assinado); caminho: <channel_id>/<uuid>-nome.
-- Idempotente.
-- =============================================================================

alter table public.chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_kind text;

do $$ begin
  alter table public.chat_messages
    add constraint chat_messages_attachment_kind_chk
    check (attachment_kind is null or attachment_kind in ('file', 'image', 'audio'));
exception when duplicate_object then null; end $$;

-- Uma mensagem pode ter só anexo (sem texto): o body deixa de ser obrigatório.
alter table public.chat_messages alter column body drop not null;

-- Bucket privado do chat.
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

-- Leitura/escrita: quem tem acesso ao canal (1º segmento do caminho = channel_id).
drop policy if exists "chat_media_select" on storage.objects;
create policy "chat_media_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and public.can_access_chat_channel((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "chat_media_insert" on storage.objects;
create policy "chat_media_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and public.can_access_chat_channel((storage.foldername(name))[1]::uuid)
  );

-- Remoção: só quem enviou o arquivo.
drop policy if exists "chat_media_delete" on storage.objects;
create policy "chat_media_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-media' and owner = (select auth.uid()));
