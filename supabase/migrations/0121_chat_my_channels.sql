-- =============================================================================
-- 0121 — Chat Hub R1: "meus canais" consistentes (corrige o contador fantasma)
-- -----------------------------------------------------------------------------
-- O badge de não lidas contava TODOS os canais que o usuário podia acessar
-- (para a franqueadora/admin isso incluía canais de unidades que ele nem lista),
-- gerando "30 não lidas" sem mensagens à vista. Agora o badge e a lista usam o
-- MESMO conjunto: minhas equipes (unidades onde tenho função) + escopo da
-- franqueadora (exceto Admin, que escolhe a unidade) + conversas diretas +
-- conversas já abertas. Idempotente.
-- =============================================================================

create or replace function public.chat_my_channel_ids()
returns table (channel_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  -- Canais das minhas equipes (unidades onde tenho função).
  select c.id
  from public.chat_channels c
  where c.kind = 'unit'
    and c.clinic_id in (select public.user_clinic_ids())
  union
  -- Unidades sob responsabilidade da franqueadora (Admin escolhe a unidade, por
  -- isso não entra automaticamente aqui).
  select c.id
  from public.chat_channels c
  where c.kind = 'unit'
    and not public.is_admin_master()
    and c.clinic_id in (select public.user_full_access_clinic_ids())
  union
  -- Conversas diretas em que sou membro.
  select m.channel_id
  from public.chat_channel_members m
  where m.user_id = (select auth.uid())
  union
  -- Qualquer canal já aberto por mim (ex.: unidade que o Admin abriu).
  select r.channel_id
  from public.chat_reads r
  where r.user_id = (select auth.uid());
$$;
grant execute on function public.chat_my_channel_ids() to authenticated;

create or replace function public.chat_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(count(*), 0)::int
  from public.chat_messages msg
  where msg.channel_id in (select channel_id from public.chat_my_channel_ids())
    and msg.sender_id <> (select auth.uid())
    and msg.created_at > coalesce(
      (select r.last_read_at from public.chat_reads r
       where r.channel_id = msg.channel_id and r.user_id = (select auth.uid())),
      'epoch'::timestamptz
    );
$$;
grant execute on function public.chat_unread_total() to authenticated;

-- Foto no chat: a leitura das fotos de colaboradores (bucket staff-photos) passa
-- a valer para qualquer usuário autenticado (uso interno; não é dado de
-- paciente). Escrita/edição/remoção seguem restritas (0077). Idempotente.
drop policy if exists "risarte_staff_photos_select" on storage.objects;
create policy "risarte_staff_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-photos');
