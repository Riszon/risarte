-- =============================================================================
-- 0124 — Chat Hub: recibo de leitura visível ao remetente
-- -----------------------------------------------------------------------------
-- A policy anterior deixava cada usuário LER só a própria marca de leitura
-- (chat_reads), então o remetente nunca via que o outro leu → o "Lida" (azul)
-- nunca aparecia. Agora a LEITURA das marcas é liberada para quem participa do
-- canal (via can_access_chat_channel); a ESCRITA continua restrita à própria
-- linha. Idempotente.
-- =============================================================================

drop policy if exists "chat_reads_all" on public.chat_reads;

drop policy if exists "chat_reads_select" on public.chat_reads;
create policy "chat_reads_select" on public.chat_reads
  for select to authenticated
  using (public.can_access_chat_channel(channel_id));

drop policy if exists "chat_reads_insert" on public.chat_reads;
create policy "chat_reads_insert" on public.chat_reads
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "chat_reads_update" on public.chat_reads;
create policy "chat_reads_update" on public.chat_reads
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "chat_reads_delete" on public.chat_reads;
create policy "chat_reads_delete" on public.chat_reads
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Realtime opcional para as marcas de leitura (recibo instantâneo).
do $$ begin
  alter publication supabase_realtime add table public.chat_reads;
exception when duplicate_object then null; when others then null; end $$;
