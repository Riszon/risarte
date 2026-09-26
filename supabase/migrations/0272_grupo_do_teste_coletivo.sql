-- =============================================================================
-- 0272 — QUEM PARTICIPA DO TESTE COLETIVO
-- -----------------------------------------------------------------------------
-- Ordem do dono (25/09/2026): *"ao escolher a liberação pelo meio coletivo
-- (ou seja, todos devem finalizar seus desafios para liberar o sistema real),
-- deve ter como selecionar quais são os cargos ou quais são os usuários que
-- estão participando do teste coletivo."*
--
-- ⚠️ POR QUE A LISTA PRECISA EXISTIR — e não é detalhe de tela.
--
-- "Coletiva" sem lista significa "TODO MUNDO da unidade". Numa unidade real
-- isso inclui quem está de férias, quem entrou ontem, quem acumula função e
-- quem nem vai usar o sistema. Bastaria UMA pessoa nessas condições para a
-- unidade inteira ficar travada para sempre, sem ninguém entender por quê — e
-- o portão, que existe para preparar a equipe, viraria o motivo de ela não
-- trabalhar. A lista é o que torna a liberação coletiva utilizável.
--
-- DOIS MODOS, porque as duas perguntas são diferentes:
--   * `papeis`  — "toda recepcionista e todo coordenador da unidade";
--   * `pessoas` — "estas cinco pessoas, nominalmente".
-- O modo escolhido decide qual lista vale. As duas ficam guardadas: trocar de
-- modo para conferir e voltar não pode apagar o que já foi montado.
--
-- ⚠️ A AVALIAÇÃO CONTINUA SENDO POR UNIDADE. A lista diz QUEM conta; a
-- unidade de cada um diz ONDE o sistema real abre. Cambé não fica esperando
-- Londrina — seria a mesma armadilha do "todo mundo", num tamanho maior.
--
-- Idempotente.
-- =============================================================================

-- 1) O modo, na mesma linha única de configuração -----------------------------
alter table public.training_settings
  add column if not exists cohort_mode text not null default 'papeis';

alter table public.training_settings drop constraint if exists training_settings_cohort_mode_check;
alter table public.training_settings
  add constraint training_settings_cohort_mode_check
  check (cohort_mode in ('papeis', 'pessoas'));

-- 2) A lista por CARGO --------------------------------------------------------
create table if not exists public.training_cohort_roles (
  role public.user_role primary key,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles (id)
);

alter table public.training_cohort_roles enable row level security;

-- Todo mundo LÊ: quem é medido precisa saber de quem a liberação depende.
-- Numa liberação coletiva, descobrir que se depende de um colega é justamente
-- o que faz a equipe se cobrar — esconder isso tira o efeito do modelo.
drop policy if exists training_cohort_roles_select on public.training_cohort_roles;
create policy training_cohort_roles_select on public.training_cohort_roles
  for select to authenticated using (true);

-- 3) A lista por PESSOA -------------------------------------------------------
create table if not exists public.training_cohort_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles (id)
);

-- ⚠️ `on delete cascade` é o certo AQUI, e só aqui: a linha não é um registro
-- do que a pessoa fez — é a lista de quem está participando agora. Risartano
-- excluído do sistema não pode continuar travando a unidade dos outros de
-- dentro de uma lista que ninguém mais consegue abrir para editar.

alter table public.training_cohort_members enable row level security;

drop policy if exists training_cohort_members_select on public.training_cohort_members;
create policy training_cohort_members_select on public.training_cohort_members
  for select to authenticated using (true);

-- 4) Gravar — só o Admin Master ----------------------------------------------
create or replace function public.save_training_cohort(
  p_mode text,
  p_roles text[],
  p_members uuid[]
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

  if p_mode is null or p_mode not in ('papeis', 'pessoas') then
    raise exception 'INVALID_MODE';
  end if;

  update public.training_settings
     set cohort_mode = p_mode, updated_at = now(), updated_by = auth.uid()
   where id = true;

  -- ⚠️ NULO = NÃO MEXER; LISTA (mesmo VAZIA) = TROCAR POR ESTA.
  --
  -- A distinção é o que mantém a promessa do cabeçalho: as duas listas ficam
  -- guardadas, e trocar de modo para conferir não apaga o que já foi montado.
  -- A tela só mostra as caixas do modo ativo, então ela manda NULO para o
  -- outro — "não estou editando isto agora". Se nulo fosse tratado como lista
  -- vazia, abrir a tela no modo `pessoas` e salvar apagaria em silêncio a
  -- seleção de cargos, e o Admin só descobriria ao voltar.
  --
  -- Esvaziar de propósito continua possível: basta estar NAQUELE modo e
  -- desmarcar tudo — aí chega uma lista vazia, que é uma decisão, não um
  -- efeito colateral.
  if p_roles is not null then
    delete from public.training_cohort_roles;
    insert into public.training_cohort_roles (role, added_by)
    select distinct r::public.user_role, auth.uid()
      from unnest(p_roles) as r
     where r is not null and r <> '';
  end if;

  if p_members is not null then
    delete from public.training_cohort_members;
    -- Só entra quem EXISTE e está ativo: id solto viraria uma trava que
    -- ninguém consegue satisfazer, porque não há pessoa para cumprir a missão.
    insert into public.training_cohort_members (user_id, added_by)
    select distinct m, auth.uid()
      from unnest(p_members) as m
      join public.profiles p on p.id = m and p.is_active;
  end if;
end;
$$;

revoke all on function public.save_training_cohort(text, text[], uuid[]) from public;
grant execute on function public.save_training_cohort(text, text[], uuid[]) to authenticated;
