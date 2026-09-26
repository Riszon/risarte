-- =============================================================================
-- 0271 — O PORTÃO DE CERTIFICAÇÃO (Etapa 1: a configuração)
-- -----------------------------------------------------------------------------
-- Decisão do dono (25/09/2026), a partir do documento "Avaliação no riSZon
-- teste": ninguém toca no sistema REAL antes de provar competência mensurável
-- no ambiente de TREINO.
--
-- ⚠️ A TRANCA JÁ EXISTE DESDE A 0259. O riSZon real nasce FECHADO para todo
-- Risartano novo (`environment_allowed` devolve `false` para 'sistema' quando
-- não há linha). O que faltava não era a tranca — era a CHAVE que gira sozinha
-- quando a pessoa cumpre a missão. Esta migração guarda a definição da missão;
-- a medição e a liberação vêm nas etapas 2 e 3.
--
-- ⚠️ PADRÃO ÚNICO DA REDE, SEM AJUSTE POR UNIDADE (ordem do dono, 25/09/2026).
-- É a única configuração do sistema que NÃO segue a cascata rede→unidade, e é
-- de propósito: o documento pede "o padrão único de entrada para o sistema
-- real". Unidade que pudesse baixar a própria régua transformaria o portão em
-- sugestão — e a unidade com mais pressa para operar seria justamente a que
-- mais baixaria. Por isso não existe `clinic_id` aqui: a ausência da coluna é a
-- regra, e não um esquecimento.
--
-- O CATÁLOGO DE INDICADORES MORA NO CÓDIGO (`src/lib/certificacao.ts`), não
-- numa tabela. Cada indicador precisa de uma consulta própria ao banco de
-- TREINO para ser contado; uma tabela de indicadores prometeria "cadastre o
-- seu" e a promessa seria falsa — o indicador novo ficaria eternamente em zero,
-- sem nada na tela explicando por quê. Aqui ficam só as METAS.
--
-- Idempotente.
-- =============================================================================

-- 1) As metas mínimas por função --------------------------------------------
create table if not exists public.training_requirements (
  role public.user_role not null,
  indicator text not null,
  minimum_count integer not null check (minimum_count > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  primary key (role, indicator)
);

-- ⚠️ META ZERO NÃO EXISTE — a linha é APAGADA (mesma lei do orçamento, 0229).
-- "Zero cadastros" e "não pedimos cadastros" são a mesma coisa para quem lê a
-- tela; guardar as duas mostraria uma exigência de zero, que ninguém entende.
-- O `check (minimum_count > 0)` é o que impede a linha inútil de nascer.

comment on table public.training_requirements is
  'Metas mínimas de treino por função. Padrão ÚNICO da rede: sem clinic_id de propósito (0271).';

alter table public.training_requirements enable row level security;

-- Todo mundo LÊ: na etapa 2 cada Risartano precisa ver a própria missão, e
-- esconder a régua de quem é medido por ela seria avaliação secreta.
drop policy if exists training_requirements_select on public.training_requirements;
create policy training_requirements_select on public.training_requirements
  for select to authenticated using (true);
-- Sem policy de escrita: só pela função abaixo, que tem a guarda.

-- 2) As duas regras de liberação --------------------------------------------
-- Os dois eixos do documento, independentes entre si:
--   escopo  — de quem depende a liberação (só de mim, ou da equipe toda);
--   gatilho — o que acontece ao cumprir (abre sozinho, ou avisa o Admin).
create table if not exists public.training_settings (
  id boolean primary key default true check (id),
  release_scope text not null default 'individual'
    check (release_scope in ('individual', 'coletiva')),
  release_trigger text not null default 'aprovacao'
    check (release_trigger in ('automatica', 'aprovacao')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

-- ⚠️ OS PADRÕES SÃO OS MAIS CAUTELOSOS DOS QUATRO, de propósito: individual
-- (ninguém fica preso esperando colega) + aprovação do Admin (nada abre
-- sozinho sem alguém ter olhado). Quem quiser automático escolhe automático; o
-- caminho contrário — descobrir depois que abriu sozinho — não tem volta.
insert into public.training_settings (id) values (true) on conflict (id) do nothing;

comment on table public.training_settings is
  'Os dois eixos de liberação do portão de certificação. Linha única, da rede (0271).';

alter table public.training_settings enable row level security;

drop policy if exists training_settings_select on public.training_settings;
create policy training_settings_select on public.training_settings
  for select to authenticated using (true);

-- 3) Gravar — só o Admin Master ---------------------------------------------
-- A régua de entrada no sistema real é decisão da REDE. Gerente de unidade
-- fora: seria o avaliado escolhendo a própria nota.
create or replace function public.save_training_requirements(
  p_role public.user_role,
  p_metas jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_indicator text;
  v_minimo integer;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Troca a missão INTEIRA daquela função numa transação: apagar e regravar
  -- deixa a tela ser a verdade. Gravar só o que mudou exigiria que a tela
  -- soubesse o que havia antes, e ela não sabe — o indicador retirado ficaria
  -- valendo para sempre, invisível.
  delete from public.training_requirements where role = p_role;

  for v_indicator, v_minimo in
    select key, (value #>> '{}')::integer from jsonb_each(coalesce(p_metas, '{}'::jsonb))
  loop
    -- Meta zero (ou negativa) não vira linha: é a ausência de exigência.
    if v_minimo is not null and v_minimo > 0 then
      insert into public.training_requirements (role, indicator, minimum_count, updated_by)
      values (p_role, v_indicator, v_minimo, auth.uid());
    end if;
  end loop;
end;
$$;

revoke all on function public.save_training_requirements(public.user_role, jsonb) from public;
grant execute on function public.save_training_requirements(public.user_role, jsonb) to authenticated;

create or replace function public.save_training_settings(
  p_scope text,
  p_trigger text
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

  update public.training_settings
     set release_scope = p_scope,
         release_trigger = p_trigger,
         updated_at = now(),
         updated_by = auth.uid()
   where id = true;
end;
$$;

revoke all on function public.save_training_settings(text, text) from public;
grant execute on function public.save_training_settings(text, text) to authenticated;
