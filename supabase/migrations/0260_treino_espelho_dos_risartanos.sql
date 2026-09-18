-- =============================================================================
-- 0260 — O TREINO É ESPELHO DA PRODUÇÃO (Risartanos, acessos e permissões)
-- =============================================================================
--
-- Decisão do dono (18/09/2026): o ÚNICO lugar que cria e altera Risartanos,
-- logins, funções, ambientes e permissões é a PRODUÇÃO. O treino recebe uma
-- cópia de tudo e só deixa consultar — nem o Admin Master altera lá.
--
-- Quem copia é o servidor da produção, com a chave de serviço do treino
-- (`src/lib/espelho-treino.ts`). Esta migração roda NOS DOIS BANCOS e prepara:
--
--   1. `mirror_state` — uma linha só. No treino, `is_mirror = true` (quem liga
--      é a primeira sincronização); na produção fica `false` e guarda se há
--      cópia pendente, para a tela avisar.
--   2. `mirror_user_map` — no treino, qual login local corresponde a qual login
--      da produção (os ids nascem diferentes nos dois bancos; a ponte é o
--      e-mail, e fica gravada aqui).
--   3. `staff_members.mirrored_at` — marca o cadastro que veio da produção. No
--      treino a lista mostra só esses: os usuários de teste por função
--      continuam entrando, mas não aparecem como Risartanos.
--   4. A TRAVA: com `is_mirror = true`, nenhuma pessoa logada grava nas
--      tabelas de Risartanos, acessos e permissões. Só a chave de serviço (a
--      cópia) e o SQL Editor/scripts (sem usuário logado) passam.
--
-- Na PRODUÇÃO nada muda de comportamento: `is_mirror` fica falso e a trava
-- nunca dispara.
-- =============================================================================

-- 1) Estado do espelho --------------------------------------------------------
create table if not exists public.mirror_state (
  id boolean primary key default true check (id),
  is_mirror boolean not null default false,
  last_full_sync_at timestamptz,
  last_sync_at timestamptz,
  pending boolean not null default false,
  last_error text,
  last_error_at timestamptz,
  summary jsonb
);

insert into public.mirror_state (id) values (true) on conflict (id) do nothing;

alter table public.mirror_state enable row level security;

-- Só metadados (datas, contagens, a última mensagem de erro técnica sem dado
-- de pessoa): quem está logado pode ler, para a tela dizer "atualizado em…".
drop policy if exists mirror_state_select on public.mirror_state;
create policy mirror_state_select on public.mirror_state
  for select to authenticated using (true);
-- Sem policy de escrita: só a chave de serviço grava.

-- 2) Ponte entre os logins dos dois bancos ------------------------------------
create table if not exists public.mirror_user_map (
  source_id uuid primary key,
  local_id uuid not null unique references public.profiles (id) on delete cascade,
  synced_at timestamptz not null default now()
);

-- Os ambientes da pessoa COMO ESTÃO NA PRODUÇÃO ({sistema, treino, academy}).
-- No treino, "sistema" quer dizer o próprio treino; a ficha de lá mostra
-- estes valores para dizer a verdade sobre o sistema real.
alter table public.mirror_user_map
  add column if not exists source_environments jsonb;

alter table public.mirror_user_map enable row level security;

drop policy if exists mirror_user_map_select on public.mirror_user_map;
-- Só ids e marcações de ambiente, nenhum dado de pessoa: quem vê a ficha no
-- treino precisa ler os ambientes dela daqui.
create policy mirror_user_map_select on public.mirror_user_map
  for select to authenticated using (true);

-- 3) Marca do cadastro espelhado ---------------------------------------------
alter table public.staff_members
  add column if not exists mirrored_at timestamptz;

-- 4) A trava -----------------------------------------------------------------
create or replace function public.is_mirror_db()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select m.is_mirror from public.mirror_state m where m.id), false);
$$;

-- Quem está gravando? Pela API, o PostgREST põe o papel do token em
-- `request.jwt.claims`: 'authenticated'/'anon' = uma pessoa pela tela;
-- 'service_role' = o servidor com a chave de serviço (a cópia). No SQL Editor e
-- nos scripts por conexão direta não há token — e eles passam, de propósito.
create or replace function public.mirror_writer_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
$$;

create or replace function public.block_mirror_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_mirror_db()
     and public.mirror_writer_role() in ('authenticated', 'anon') then
    raise exception 'MIRROR_READ_ONLY'
      using hint = 'No treino os Risartanos, acessos e permissões são só para consulta. Altere na produção.';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'staff_members',
    'staff_member_changes',
    'staff_clinic_schedule',
    'user_clinic_roles',
    'role_unit_access',
    'user_environments',
    'permission_matrix'
  ] loop
    execute format('drop trigger if exists mirror_read_only on public.%I', t);
    execute format(
      'create trigger mirror_read_only before insert or update or delete on public.%I
         for each row execute function public.block_mirror_writes()',
      t
    );
  end loop;
end $$;

-- No perfil, a trava pega só o que vem da produção (nome, telefone, situação,
-- Admin Master). O resto do perfil segue livre no treino.
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
          or new.is_admin_master is distinct from old.is_admin_master) then
    raise exception 'MIRROR_READ_ONLY'
      using hint = 'No treino o cadastro das pessoas vem da produção. Altere lá.';
  end if;
  return new;
end $$;

drop trigger if exists mirror_read_only on public.profiles;
create trigger mirror_read_only
  before update on public.profiles
  for each row execute function public.block_mirror_profile_writes();
