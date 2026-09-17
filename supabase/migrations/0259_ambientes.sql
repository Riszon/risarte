-- =============================================================================
-- 0259 — TRÊS AMBIENTES, UM PONTO DE PARTIDA
-- -----------------------------------------------------------------------------
-- Decisão do dono (17/09/2026). O Risartano pode ter acesso a três lugares:
--
--   * `sistema`  — o riSZon real, o do dia a dia;
--   * `treino`   — o riSZon de treinamento (OUTRO banco, outro endereço);
--   * `academy`  — o Risarte Academy (mesmo banco daqui, schema `treinamento`).
--
-- O ponto de partida é sempre a tela de Início do sistema real: quem ainda não
-- foi liberado no real entra, vê só o Início, e de lá vai para o treino ou para
-- o Academy. "Todo Risartano recém-chegado passa primeiro pelo ambiente de
-- teste antes de ir para o real."
--
-- ⚠️ O QUE ESTE BANCO CONSEGUE GARANTIR, E O QUE NÃO CONSEGUE.
--   * `sistema` — garantido aqui: é este banco que responde.
--   * `academy` — o Academy divide ESTE banco (`auth.users` é comum), então a
--     marcação chega até ele; mas quem OBEDECE é o código do Academy, que mora
--     em outro repositório. Enquanto ele não ler esta tabela, a marcação
--     controla o atalho no Início, não a porta de lá.
--   * `treino`  — banco separado. Nenhuma linha aqui alcança o login de lá; o
--     que libera de verdade é o app criar a pessoa naquele banco (e o que
--     bloqueia é bani-la lá). Esta tabela guarda a DECISÃO; o app executa.
--
-- Idempotente.
-- =============================================================================

-- 1) Os ambientes e seus endereços -------------------------------------------
-- O endereço é configuração da REDE (uma linha por ambiente), não do código:
-- o Academy ainda não está publicado, e quando estiver ninguém deve precisar de
-- uma entrega nova para ligar o atalho.
create table if not exists public.environments (
  key text primary key,
  label text not null,
  descricao text,
  url text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

alter table public.environments drop constraint if exists environments_key_check;
alter table public.environments
  add constraint environments_key_check
  check (key in ('sistema', 'treino', 'academy'));

insert into public.environments (key, label, descricao, url, sort_order)
values
  ('sistema', 'riSZon',
   'O sistema do dia a dia: agenda, prontuário, jornada, financeiro.',
   null, 1),
  ('treino', 'riSZon Treino',
   'O mesmo sistema, com dados de mentira. É onde se aprende sem medo de errar.',
   'https://risarte-treino.vercel.app', 2),
  ('academy', 'Risarte Academy',
   'Cursos, vídeos, provas e certificados da rede.',
   null, 3)
on conflict (key) do nothing;

alter table public.environments enable row level security;

drop policy if exists environments_select on public.environments;
create policy environments_select on public.environments
  for select to authenticated using (true);
-- Sem policy de escrita de propósito: o endereço muda pela função abaixo.

-- 2) Quem pode entrar em cada ambiente ---------------------------------------
create table if not exists public.user_environments (
  user_id uuid not null references public.profiles (id) on delete cascade,
  environment text not null references public.environments (key),
  allowed boolean not null default true,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles (id),
  primary key (user_id, environment)
);

create index if not exists user_environments_user_idx
  on public.user_environments (user_id);

alter table public.user_environments enable row level security;

-- Vê quem é a própria pessoa, o Admin, e quem já enxerga o cadastro dela na
-- tela Risartanos (a mesma régua da 0080 — não uma segunda cópia dela).
drop policy if exists user_environments_select on public.user_environments;
create policy user_environments_select on public.user_environments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin_master()
    or exists (
      select 1
      from public.staff_members s
      where s.user_id = user_environments.user_id
        and public.can_see_staff(s.clinic_id, s.user_id)
    )
  );
-- Sem policy de escrita: só pela função abaixo, que tem a guarda.

-- 3) A regra do padrão -------------------------------------------------------
-- Sem linha na tabela:
--   * treino e academy ficam LIBERADOS — "estes acessos sempre estarão
--     disponíveis para os Risartanos, exceto se a franqueadora/Admin retirar";
--   * o sistema real fica FECHADO — ele é liberado de propósito, quando a
--     pessoa está pronta. É o único dos três cujo padrão é "não".
-- O Admin Master nunca se tranca para fora: senão a primeira execução desta
-- migração deixaria o dono sem sistema.
create or replace function public.environment_allowed(
  p_user_id uuid,
  p_environment text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select p.is_admin_master from public.profiles p where p.id = p_user_id), false)
      then true
    else coalesce(
      (select ue.allowed
         from public.user_environments ue
        where ue.user_id = p_user_id
          and ue.environment = p_environment),
      p_environment <> 'sistema'
    )
  end;
$$;

-- 4) Conceder e retirar ------------------------------------------------------
-- Só o Admin Master, como todo o resto do ACESSO (login, senha, função). A
-- tela mostra os três interruptores na ficha do Risartano.
create or replace function public.set_user_environment(
  p_user_id uuid,
  p_environment text,
  p_allowed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_environment not in ('sistema', 'treino', 'academy') then
    raise exception 'UNKNOWN_ENVIRONMENT';
  end if;

  insert into public.user_environments (user_id, environment, allowed, granted_by)
  values (p_user_id, p_environment, p_allowed, auth.uid())
  on conflict (user_id, environment) do update
    set allowed = excluded.allowed,
        granted_at = now(),
        granted_by = excluded.granted_by;
end $$;

-- 5) O endereço de cada ambiente ---------------------------------------------
create or replace function public.set_environment_url(p_key text, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.environments
     set url = nullif(btrim(coalesce(p_url, '')), ''),
         updated_at = now(),
         updated_by = auth.uid()
   where key = p_key;

  if not found then
    raise exception 'UNKNOWN_ENVIRONMENT';
  end if;
end $$;

-- 6) Backfill ----------------------------------------------------------------
-- Quem JÁ usa o sistema hoje continua usando. Sem isto, a migração trancaria
-- para fora toda a equipe no minuto em que subisse — o padrão "sistema fechado"
-- vale para quem chega depois, não para quem já está dentro.
insert into public.user_environments (user_id, environment, allowed)
select distinct ucr.user_id, 'sistema', true
from public.user_clinic_roles ucr
on conflict (user_id, environment) do nothing;

insert into public.user_environments (user_id, environment, allowed)
select p.id, 'sistema', true
from public.profiles p
where p.is_admin_master
on conflict (user_id, environment) do nothing;

grant execute on function public.environment_allowed(uuid, text) to authenticated;
grant execute on function public.set_user_environment(uuid, text, boolean) to authenticated;
grant execute on function public.set_environment_url(text, text) to authenticated;
