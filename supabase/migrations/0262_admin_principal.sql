-- =============================================================================
-- 0262 — ADMIN PRINCIPAL: outros Admins, sempre abaixo do dono
-- =============================================================================
--
-- Pedido do dono (19/09/2026): poder colocar mais alguém como Admin, que fica
-- SEMPRE abaixo dele — nunca consegue alterar as funções, o acesso ou o Admin
-- do dono. Decisões dele na mesma conversa:
--   * só o Admin Principal dá ou tira o Admin de alguém;
--   * o acesso de QUALQUER Admin (senha, funções, ambientes, desativar) só o
--     Admin Principal altera — um Admin comum não mexe em outro Admin;
--   * a matriz de permissões continua editável por qualquer Admin.
--
-- O que esta migração faz:
--   1. `profiles.is_owner` — o Admin Principal. No máximo UM (índice único).
--      Marcado aqui só quando há exatamente um Admin Master ativo; senão, o
--      dono marca pelo SQL Editor (a migração não adivinha quem é o dono).
--   2. `is_owner()` — quem está logado é o Admin Principal?
--   3. As travas, no banco: pela tela (usuário logado), ninguém além do Admin
--      Principal (a) muda `is_admin_master`, (b) muda qualquer coisa no perfil,
--      nas funções, no escopo ou nos ambientes de OUTRO Admin. `is_owner` não
--      muda pela tela nem para o próprio dono: transferir o posto é ato de SQL
--      Editor, de propósito.
--   4. No treino (0260), `is_owner` também vem da produção e fica trancado.
--
-- O que o banco NÃO vê: senha e bloqueio de login passam pela chave de serviço
-- (auth), que não tem "quem está logado". Esses caminhos são guardados no
-- servidor (`acesso-actions.ts`, `podeMexerNoAcessoDe`).
-- =============================================================================

-- 1) O Admin Principal --------------------------------------------------------
alter table public.profiles
  add column if not exists is_owner boolean not null default false;

create unique index if not exists profiles_um_admin_principal
  on public.profiles ((true)) where is_owner;

-- Marca o dono quando não há dúvida: exatamente um Admin Master ativo.
update public.profiles p
   set is_owner = true
 where p.is_admin_master
   and p.is_active
   and (select count(*) from public.profiles q where q.is_admin_master and q.is_active) = 1
   and not exists (select 1 from public.profiles r where r.is_owner);

-- 2) Quem está logado é o Admin Principal? -----------------------------------
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_owner from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Pessoa logada pela tela? (mesma régua da 0260)
create or replace function public.gravacao_pela_tela()
returns boolean
language sql
stable
as $$
  select public.mirror_writer_role() in ('authenticated', 'anon');
$$;

-- 3a) Perfil ------------------------------------------------------------------
create or replace function public.proteger_admins_no_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.gravacao_pela_tela() then
    return new;
  end if;

  if new.is_owner is distinct from old.is_owner then
    raise exception 'OWNER_ONLY'
      using hint = 'O Admin Principal não se troca pela tela.';
  end if;

  if new.is_admin_master is distinct from old.is_admin_master
     and not public.is_owner() then
    raise exception 'OWNER_ONLY'
      using hint = 'Só o Admin Principal dá ou tira o Admin.';
  end if;

  -- O perfil de OUTRO Admin só o Admin Principal altera. O próprio perfil
  -- (nome, telefone) cada um continua editando.
  if old.is_admin_master
     and old.id is distinct from auth.uid()
     and not public.is_owner() then
    raise exception 'OWNER_ONLY'
      using hint = 'O cadastro de um Admin só o Admin Principal altera.';
  end if;

  return new;
end $$;

drop trigger if exists proteger_admins on public.profiles;
create trigger proteger_admins
  before update on public.profiles
  for each row execute function public.proteger_admins_no_perfil();

-- 3b) Funções, escopo e ambientes de um Admin --------------------------------
create or replace function public.alvo_e_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin_master from public.profiles p where p.id = p_user_id),
    false
  );
$$;

create or replace function public.proteger_acesso_de_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.gravacao_pela_tela() or public.is_owner() then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'role_unit_access' then
    select ucr.user_id into v_user
      from public.user_clinic_roles ucr
     where ucr.id = coalesce(new.user_clinic_role_id, old.user_clinic_role_id);
  else
    v_user := coalesce(new.user_id, old.user_id);
  end if;

  if v_user is not null and public.alvo_e_admin(v_user) then
    raise exception 'OWNER_ONLY'
      using hint = 'O acesso de um Admin só o Admin Principal altera.';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['user_clinic_roles', 'role_unit_access', 'user_environments'] loop
    execute format('drop trigger if exists proteger_admins on public.%I', t);
    execute format(
      'create trigger proteger_admins before insert or update or delete on public.%I
         for each row execute function public.proteger_acesso_de_admin()',
      t
    );
  end loop;
end $$;

-- 4) No treino, o Admin Principal também vem da produção ----------------------
create or replace function public.block_mirror_profile_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_mirror_db()
     and public.mirror_writer_role() in ('authenticated', 'anon')
     and (new.full_name is distinct from old.full_name
          or new.phone is distinct from old.phone
          or new.is_active is distinct from old.is_active
          or new.is_admin_master is distinct from old.is_admin_master
          or new.is_owner is distinct from old.is_owner) then
    raise exception 'MIRROR_READ_ONLY'
      using hint = 'No treino o cadastro das pessoas vem da produção. Altere lá.';
  end if;
  return new;
end $$;
