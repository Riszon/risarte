-- =============================================================================
-- 0123 — Chat Hub R2 (correções): nomes/pessoas via SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- A RLS de profiles impede um usuário da unidade de ler o nome de quem é da
-- franqueadora (Admin/Planner), então mensagens deles apareciam como "colega"/
-- sem nome. Estas funções resolvem nome + função + unidade de todos os membros
-- de um canal (só para quem tem acesso ao canal). Idempotente.
-- =============================================================================

-- Nomes de exibição de um conjunto de usuários (para títulos de conversas).
create or replace function public.chat_display_names(p_user_ids uuid[])
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.id = any (p_user_ids);
$$;
grant execute on function public.chat_display_names(uuid[]) to authenticated;

-- Pessoas de um canal com nome + função + unidade (só quem acessa o canal).
create or replace function public.chat_channel_people(p_channel_id uuid)
returns table (user_id uuid, full_name text, role text, unit_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_clinic uuid;
begin
  if not public.can_access_chat_channel(p_channel_id) then
    return;
  end if;
  select kind, clinic_id into v_kind, v_clinic
  from public.chat_channels where id = p_channel_id;

  if v_kind = 'unit' then
    return query
      -- Membros da equipe (função na unidade do canal).
      select ucr.user_id, p.full_name, ucr.role::text, c.name
      from public.user_clinic_roles ucr
      join public.profiles p on p.id = ucr.user_id
      join public.clinics c on c.id = ucr.clinic_id
      where ucr.clinic_id = v_clinic
      union
      -- Quem enviou mas não é da equipe (ex.: franqueadora): nome, sem função.
      select distinct m.sender_id, p2.full_name, null::text, null::text
      from public.chat_messages m
      join public.profiles p2 on p2.id = m.sender_id
      where m.channel_id = p_channel_id
        and not exists (
          select 1 from public.user_clinic_roles u2
          where u2.user_id = m.sender_id and u2.clinic_id = v_clinic
        );
  else
    return query
      select cm.user_id, p.full_name,
        (select ucr.role::text
           from public.user_clinic_roles ucr
           where ucr.user_id = cm.user_id
           limit 1),
        (select c.name
           from public.user_clinic_roles ucr
           join public.clinics c on c.id = ucr.clinic_id
           where ucr.user_id = cm.user_id
           limit 1)
      from public.chat_channel_members cm
      join public.profiles p on p.id = cm.user_id
      where cm.channel_id = p_channel_id;
  end if;
end $$;
grant execute on function public.chat_channel_people(uuid) to authenticated;
