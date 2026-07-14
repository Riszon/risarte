-- =============================================================================
-- 0126 — Chat Hub R4b: configurar quem conversa com quem (unidade ↔ franqueadora)
-- -----------------------------------------------------------------------------
-- O Admin define, POR FUNÇÃO, quais pares (função da franqueadora × função da
-- unidade) podem conversar por mensagem direta entre níveis. Ausência de regra =
-- permitido (padrão aberto). Conversas dentro da MESMA unidade sempre valem.
-- Idempotente.
-- =============================================================================

create table if not exists public.chat_contact_rules (
  franchisor_role public.user_role not null,
  unit_role public.user_role not null,
  allowed boolean not null default true,
  primary key (franchisor_role, unit_role)
);

alter table public.chat_contact_rules enable row level security;

drop policy if exists "chat_contact_rules_select" on public.chat_contact_rules;
create policy "chat_contact_rules_select" on public.chat_contact_rules
  for select to authenticated using (true);

drop policy if exists "chat_contact_rules_write" on public.chat_contact_rules;
create policy "chat_contact_rules_write" on public.chat_contact_rules
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Par permitido? (ausência de regra = permitido).
create or replace function public.chat_cross_level_allowed(
  p_fr public.user_role,
  p_unit public.user_role
) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select allowed from public.chat_contact_rules
     where franchisor_role = p_fr and unit_role = p_unit),
    true
  );
$$;
grant execute on function public.chat_cross_level_allowed(public.user_role, public.user_role) to authenticated;

-- Posso iniciar conversa direta com p_other?
create or replace function public.chat_can_dm(p_other uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select
    public.is_admin_master()
    -- mesma unidade (compartilham clínica) → sempre.
    or exists (
      select 1 from public.user_clinic_roles a
      join public.user_clinic_roles b on a.clinic_id = b.clinic_id
      where a.user_id = (select auth.uid()) and b.user_id = p_other
    )
    -- franqueadora → unidade (eu franqueadora, escopo cobre a unidade do outro).
    or exists (
      select 1
      from public.user_clinic_roles cf
      join public.clinics ccf on ccf.id = cf.clinic_id and ccf.type = 'franchisor'
      join public.user_clinic_roles ou on ou.user_id = p_other
      join public.clinics cou on cou.id = ou.clinic_id and cou.type = 'franchise_unit'
      where cf.user_id = (select auth.uid())
        and ou.clinic_id in (select public.user_full_access_clinic_ids())
        and public.chat_cross_level_allowed(cf.role, ou.role)
    )
    -- unidade → franqueadora (eu unidade, o outro franqueadora).
    or exists (
      select 1
      from public.user_clinic_roles cu
      join public.clinics ccu on ccu.id = cu.clinic_id and ccu.type = 'franchise_unit'
      join public.user_clinic_roles ofr on ofr.user_id = p_other
      join public.clinics cof on cof.id = ofr.clinic_id and cof.type = 'franchisor'
      where cu.user_id = (select auth.uid())
        and public.chat_cross_level_allowed(ofr.role, cu.role)
    );
$$;
grant execute on function public.chat_can_dm(uuid) to authenticated;

-- Contatos que posso iniciar conversa (para o seletor "Nova"), com nome/função/
-- unidade — aplica as regras acima. Admin fala com todos.
create or replace function public.chat_contacts()
returns table (user_id uuid, full_name text, role text, unit_name text)
language sql stable security definer set search_path = '' as $$
  with cand as (
    select b.user_id
    from public.user_clinic_roles a
    join public.user_clinic_roles b on a.clinic_id = b.clinic_id
    where a.user_id = (select auth.uid()) and b.user_id <> (select auth.uid())
    union
    select ou.user_id
    from public.user_clinic_roles cf
    join public.clinics ccf on ccf.id = cf.clinic_id and ccf.type = 'franchisor'
    join public.user_clinic_roles ou on ou.user_id <> (select auth.uid())
    join public.clinics cou on cou.id = ou.clinic_id and cou.type = 'franchise_unit'
    where cf.user_id = (select auth.uid())
      and ou.clinic_id in (select public.user_full_access_clinic_ids())
      and public.chat_cross_level_allowed(cf.role, ou.role)
    union
    select ofr.user_id
    from public.user_clinic_roles cu
    join public.clinics ccu on ccu.id = cu.clinic_id and ccu.type = 'franchise_unit'
    join public.user_clinic_roles ofr on ofr.user_id <> (select auth.uid())
    join public.clinics cof on cof.id = ofr.clinic_id and cof.type = 'franchisor'
    where cu.user_id = (select auth.uid())
      and public.chat_cross_level_allowed(ofr.role, cu.role)
    union
    select p2.id
    from public.profiles p2
    where public.is_admin_master() and p2.id <> (select auth.uid())
  )
  select distinct on (c.user_id)
    c.user_id, p.full_name, ucr.role::text, cl.name
  from (select distinct user_id from cand) c
  join public.profiles p on p.id = c.user_id
  left join public.user_clinic_roles ucr on ucr.user_id = c.user_id
  left join public.clinics cl on cl.id = ucr.clinic_id
  order by c.user_id, cl.type nulls last;
$$;
grant execute on function public.chat_contacts() to authenticated;

-- Passa a trava de contato para a criação de conversas diretas.
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
  if not public.chat_can_dm(p_other) then raise exception 'NOT_ALLOWED'; end if;

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
