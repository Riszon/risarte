-- =============================================================================
-- 0080 — Risartano multi-unidade + permissões corretas — H4.1 (ajustes)
-- -----------------------------------------------------------------------------
-- Um Risartano é UMA pessoa (um cadastro de RH), mesmo trabalhando em várias
-- unidades. O cargo em cada unidade vem do ACESSO (user_clinic_roles do login
-- vinculado). Portanto o cadastro precisa ser:
--   * VISÍVEL a quem gere QUALQUER unidade onde a pessoa tem acesso (não só a
--     unidade "de origem" do cadastro);
--   * EDITÁVEL por Admin, Gerente/Franqueado da unidade e Franqueadora/RH com
--     acesso — em qualquer unidade vinculada.
-- Também dá suporte a "não criar dois Risartanos" (busca por CPF na rede).
-- Idempotente. (cpf_digits já existe na 0078.)
-- =============================================================================

-- 1) Pode VER este cadastro de Risartano? ---------------------------------------
-- Vê se: admin; OU a unidade de origem está no seu acesso amplo; OU o login
-- vinculado tem papel numa unidade do seu acesso amplo.
create or replace function public.can_see_staff(p_clinic_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_master()
    or p_clinic_id in (select public.user_full_access_clinic_ids())
    or (p_user_id is not null and exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.user_id = p_user_id
        and ucr.clinic_id in (select public.user_full_access_clinic_ids())
    ));
$$;

-- 2) Pode GERIR (cadastrar/editar) este cadastro? -------------------------------
-- Admin; OU gere a unidade de origem (Gerente/Franqueado, ou Franqueadora/RH com
-- acesso); OU gere alguma unidade onde o login vinculado tem papel.
create or replace function public.can_manage_staff_record(p_clinic_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_admin_master() then
    return true;
  end if;
  if public.has_role_in_clinic(
       p_clinic_id, array['unit_manager','franchisee']::public.user_role[]) then
    return true;
  end if;
  if exists (
    select 1 from public.providers_with_access(p_clinic_id, 'franchisor_staff') p
    where p.user_id = (select auth.uid())
  ) then
    return true;
  end if;
  if p_user_id is not null and exists (
    select 1 from public.user_clinic_roles ucr
    where ucr.user_id = p_user_id
      and (
        public.has_role_in_clinic(
          ucr.clinic_id, array['unit_manager','franchisee']::public.user_role[])
        or exists (
          select 1 from public.providers_with_access(ucr.clinic_id, 'franchisor_staff') p2
          where p2.user_id = (select auth.uid())
        )
      )
  ) then
    return true;
  end if;
  return false;
end $$;

-- Versão por id (usada pelas server actions de edição).
create or replace function public.can_manage_staff(p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members s
    where s.id = p_staff_id
      and public.can_manage_staff_record(s.clinic_id, s.user_id)
  );
$$;

-- 3) Busca por CPF na rede inteira (para "não criar dois Risartanos") -----------
create or replace function public.find_staff_by_cpf(p_cpf text)
returns table (
  staff_id uuid,
  clinic_name text,
  full_name text,
  visible boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, c.name, s.full_name, public.can_see_staff(s.clinic_id, s.user_id)
  from public.staff_members s
  join public.clinics c on c.id = s.clinic_id
  where public.cpf_digits(p_cpf) is not null
    and public.cpf_digits(s.cpf) = public.cpf_digits(p_cpf)
  order by s.created_at asc
  limit 1;
$$;

-- 4) RLS: leitura e escrita passam a usar os helpers acima ----------------------
drop policy if exists "staff_members_select" on public.staff_members;
create policy "staff_members_select" on public.staff_members
  for select to authenticated
  using (public.can_see_staff(clinic_id, user_id));

drop policy if exists "staff_members_write" on public.staff_members;
create policy "staff_members_write" on public.staff_members
  for all to authenticated
  using (public.can_manage_staff_record(clinic_id, user_id))
  with check (public.can_manage_staff_record(clinic_id, user_id));

drop policy if exists "staff_member_changes_insert" on public.staff_member_changes;
create policy "staff_member_changes_insert" on public.staff_member_changes
  for insert to authenticated
  with check (public.can_manage_staff(staff_member_changes.staff_member_id));

grant execute on function public.can_see_staff(uuid, uuid) to authenticated;
grant execute on function public.can_manage_staff_record(uuid, uuid) to authenticated;
grant execute on function public.can_manage_staff(uuid) to authenticated;
grant execute on function public.find_staff_by_cpf(text) to authenticated;
