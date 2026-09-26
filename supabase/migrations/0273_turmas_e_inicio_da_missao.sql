-- =============================================================================
-- 0273 — A TURMA, O CERTIFICADO E O CLIQUE QUE COMEÇA A MISSÃO
-- -----------------------------------------------------------------------------
-- Ordem do dono (26/09/2026):
--
--   *"Quando selecionar uma unidade ou um indivíduo para fazer o
--   treinamento/missão, só deve contar a partir de quando o usuário clicar ou
--   aceitar iniciar a missão. Isso deve existir pois o usuário pode estar
--   testando e aprendendo a utilizar o sistema, mas não iniciou a missão. (...)
--   Primeiro os usuários vão se ambientar no sistema no ambiente teste, e
--   depois é liberado para eles fazerem as missões."*
--
-- ⚠️ ESTA É A DIFERENÇA ENTRE APRENDER E SER MEDIDO, e é a razão de tudo o que
-- está abaixo. Sem o marco do clique, a contagem pegaria o período em que a
-- pessoa estava explorando — errando de propósito, testando botão, criando
-- paciente de mentira para ver o que acontece. Isso é aprendizado, não prova.
-- Medir esse período tornaria a certificação fácil e sem sentido: bastaria
-- brincar bastante para "passar".
--
-- TRÊS COISAS NOVAS:
--   1. `training_certifications` — o certificado, que é FATO HISTÓRICO;
--   2. `training_campaigns`      — a turma/convocação de uma unidade;
--   3. `training_enrollments`    — a matrícula, que guarda o `started_at`.
--
-- ⚠️ POR QUE O CERTIFICADO É TABELA E NÃO CONTA.
-- A contagem vive no banco de TREINO, e o treino é limpo de vez em quando. Se
-- "estar certificado" fosse uma contagem, uma limpeza descertificaria quem já
-- tinha passado, e a pessoa seria barrada sem ter feito nada errado. O
-- certificado é um acontecimento: aconteceu, ficou. Guarda os números
-- atingidos no momento (`snapshot`) para que ninguém precise recontar depois.
--
-- ⚠️ RECICLAGEM NÃO TIRA O ACESSO (decisão do dono, 26/09/2026). Quando o
-- sistema mudar muito e todos forem reconvocados, quem já era certificado
-- CONTINUA trabalhando no sistema real enquanto refaz a missão. Tirar o acesso
-- de uma unidade inteira de uma vez pararia o atendimento, e o risco de alguém
-- usar o fluxo novo sem reciclar é menor que o de parar a clínica. Por isso
-- nada aqui mexe em `user_environments`.
--
-- Idempotente.
-- =============================================================================

-- 1) O CERTIFICADO ------------------------------------------------------------
create table if not exists public.training_certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.user_role not null,
  clinic_id uuid references public.clinics (id),
  campaign_id uuid,
  certified_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id),
  snapshot jsonb not null default '{}'::jsonb
);

-- ⚠️ A CERTIFICAÇÃO É POR FUNÇÃO, não por pessoa. Quem acumula recepção e
-- gerência aprendeu duas coisas diferentes, e ser boa numa não prova nada
-- sobre a outra. Sem a função aqui, mudar de cargo herdaria uma certificação
-- que nunca foi feita.
create index if not exists training_certifications_user_idx
  on public.training_certifications (user_id, role, certified_at desc);

-- SEM índice único de propósito: a reciclagem cria uma certificação NOVA, e a
-- antiga fica. Vale a mais recente; o histórico conta quantas vezes a pessoa
-- passou, que é informação de gente, não lixo.

alter table public.training_certifications enable row level security;

drop policy if exists training_certifications_select on public.training_certifications;
create policy training_certifications_select on public.training_certifications
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin_master()
    or exists (
      select 1 from public.staff_members s
       where s.user_id = training_certifications.user_id
         and public.can_see_staff(s.clinic_id, s.user_id)
    )
  );
-- Sem policy de escrita: certificado não se digita.

-- 2) A TURMA ------------------------------------------------------------------
create sequence if not exists public.training_campaign_code_seq;

create table if not exists public.training_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  clinic_id uuid not null references public.clinics (id),
  kind text not null default 'novatos' check (kind in ('novatos', 'reciclagem')),
  status text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id)
);

-- O código nunca some (regra do dono, 07/08/2026): é ele que liga a turma à
-- matrícula, ao certificado e ao histórico.
create or replace function public.set_training_campaign_code()
returns trigger language plpgsql as $$
begin
  if new.code is null then
    new.code := 'TR-' ||
      lpad(nextval('public.training_campaign_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists training_campaigns_code on public.training_campaigns;
create trigger training_campaigns_code before insert on public.training_campaigns
  for each row execute function public.set_training_campaign_code();

alter table public.training_campaigns enable row level security;

drop policy if exists training_campaigns_select on public.training_campaigns;
create policy training_campaigns_select on public.training_campaigns
  for select to authenticated using (true);

-- 3) A MATRÍCULA — e o marco que começa a contagem ----------------------------
create table if not exists public.training_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.training_campaigns (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.user_role not null,
  status text not null default 'convocado'
    check (status in ('convocado', 'em_andamento', 'concluido', 'dispensado')),
  invited_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (campaign_id, user_id)
);

-- ⚠️ `started_at` É O CORAÇÃO DESTA MIGRAÇÃO.
-- A contagem da Etapa 2 vai ser `... where created_at >= started_at`. Enquanto
-- for nulo, NADA conta — a pessoa está se ambientando, e é para isso que o
-- treino existe. O campo é nulo por padrão de propósito: matrícula nasce
-- CONVOCADA, não iniciada.
--
-- E a `role` é CONGELADA na convocação: se a pessoa mudar de função no meio,
-- a missão que ela aceitou continua sendo a que ela aceitou. Missão que muda
-- sozinha embaixo de quem está fazendo é o oposto de uma prova.

create index if not exists training_enrollments_user_idx
  on public.training_enrollments (user_id, status);

alter table public.training_enrollments enable row level security;

drop policy if exists training_enrollments_select on public.training_enrollments;
create policy training_enrollments_select on public.training_enrollments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin_master()
    or exists (
      select 1 from public.staff_members s
       where s.user_id = training_enrollments.user_id
         and public.can_see_staff(s.clinic_id, s.user_id)
    )
  );

-- 4) QUEM ENTRARIA NA TURMA — a prévia, antes de convocar ---------------------
-- O Admin precisa VER a lista antes de criar a turma. Convocar às cegas e
-- descobrir depois quem foi chamado é como se convoca a pessoa errada.
create or replace function public.training_candidates(
  p_clinic_id uuid,
  p_kind text
)
returns table (
  user_id uuid,
  full_name text,
  role public.user_role,
  ja_certificado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with com_missao as (
    select distinct r.role from public.training_requirements r
  ),
  gente as (
    select distinct ucr.user_id, ucr.role
      from public.user_clinic_roles ucr
      join public.profiles p on p.id = ucr.user_id and p.is_active
      join com_missao cm on cm.role = ucr.role
     where ucr.clinic_id = p_clinic_id
       and not coalesce(p.is_admin_master, false)
       -- Filtro por cargo da 0272: quando o Admin escolheu cargos, só eles
       -- entram. Tabela VAZIA = sem filtro (todos os cargos que têm missão) —
       -- e não "ninguém", que trancaria a convocação em silêncio.
       and (
         not exists (select 1 from public.training_cohort_roles)
         or exists (
           select 1 from public.training_cohort_roles f where f.role = ucr.role
         )
       )
  )
  select
    g.user_id,
    coalesce(pr.full_name, pr.email) as full_name,
    g.role,
    exists (
      select 1 from public.training_certifications c
       where c.user_id = g.user_id and c.role = g.role
    ) as ja_certificado
  from gente g
  join public.profiles pr on pr.id = g.user_id
  where
    -- 'novatos' pula quem já passou; 'reciclagem' chama todo mundo.
    case when p_kind = 'reciclagem' then true
    else not exists (
      select 1 from public.training_certifications c
       where c.user_id = g.user_id and c.role = g.role
    ) end
  order by full_name;
$$;

revoke all on function public.training_candidates(uuid, text) from public;
grant execute on function public.training_candidates(uuid, text) to authenticated;

-- 5) ABRIR A TURMA ------------------------------------------------------------
create or replace function public.open_training_campaign(
  p_clinic_id uuid,
  p_kind text,
  p_note text default null,
  p_only_users uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n int;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_kind not in ('novatos', 'reciclagem') then
    raise exception 'INVALID_KIND';
  end if;

  -- Uma turma ABERTA por unidade. Duas ao mesmo tempo deixariam a pessoa com
  -- duas missões e nenhuma resposta sobre qual libera o quê.
  if exists (
    select 1 from public.training_campaigns
     where clinic_id = p_clinic_id and status = 'aberta'
  ) then
    raise exception 'CAMPAIGN_ALREADY_OPEN';
  end if;

  insert into public.training_campaigns (clinic_id, kind, note, created_by)
  values (p_clinic_id, p_kind, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  -- Matricula a lista da prévia. `p_only_users` deixa o Admin tirar alguém
  -- antes de convocar (férias, afastamento) sem precisar de outra tela.
  insert into public.training_enrollments (campaign_id, user_id, role)
  select v_id, c.user_id, c.role
    from public.training_candidates(p_clinic_id, p_kind) c
   where p_only_users is null or c.user_id = any(p_only_users);

  get diagnostics v_n = row_count;

  -- ⚠️ TURMA SEM NINGUÉM É ERRO, NÃO SUCESSO SILENCIOSO. Sem isto, o Admin
  -- veria "turma criada" e ficaria esperando por gente que nunca foi chamada.
  if v_n = 0 then
    raise exception 'NOBODY_TO_ENROLL';
  end if;

  return v_id;
end;
$$;

revoke all on function public.open_training_campaign(uuid, text, text, uuid[]) from public;
grant execute on function public.open_training_campaign(uuid, text, text, uuid[]) to authenticated;

-- 6) ⚠️ O CLIQUE QUE COMEÇA A MISSÃO -----------------------------------------
-- Só a PRÓPRIA PESSOA inicia. Não é formalidade: o marco só significa alguma
-- coisa se ela souber que a partir dali está sendo medida. Admin iniciando
-- pelos outros devolveria o problema que esta migração existe para resolver.
create or replace function public.start_training_mission(p_enrollment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started timestamptz;
  v_user uuid;
  v_status text;
begin
  select e.user_id, e.status, e.started_at
    into v_user, v_status, v_started
    from public.training_enrollments e
   where e.id = p_enrollment_id;

  if v_user is null then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  -- ⚠️ `IS DISTINCT FROM`, NUNCA `<>` — achado por sonda em 26/09/2026.
  --
  -- A primeira versão usava `v_user <> auth.uid()`. Quando `auth.uid()` é NULO
  -- (chamada sem sessão: chave de serviço, conexão direta, tarefa agendada),
  -- `<>` devolve NULO, não VERDADEIRO — e o `if` simplesmente não dispara. A
  -- trava mais importante desta migração estava aberta para quem não estivesse
  -- logado, e a função é `security definer`, então rodaria como dona do banco.
  --
  -- `is distinct from` trata o nulo como valor: nulo ≠ id da pessoa, então a
  -- chamada sem sessão é RECUSADA, que é o que se quer.
  if v_user is distinct from auth.uid() then
    raise exception 'ONLY_THE_PERSON_STARTS';
  end if;

  -- Já começou: devolve o marco original em vez de reiniciar. Reiniciar
  -- apagaria o que a pessoa já fez desde que aceitou — o clique duplo não
  -- pode custar uma semana de trabalho dela.
  if v_started is not null then
    return v_started;
  end if;

  if v_status = 'dispensado' then
    raise exception 'ENROLLMENT_DISMISSED';
  end if;

  update public.training_enrollments
     set started_at = now(), status = 'em_andamento'
   where id = p_enrollment_id
  returning started_at into v_started;

  return v_started;
end;
$$;

revoke all on function public.start_training_mission(uuid) from public;
grant execute on function public.start_training_mission(uuid) to authenticated;

-- 7) ENCERRAR A TURMA ---------------------------------------------------------
create or replace function public.close_training_campaign(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.training_campaigns
     set status = 'encerrada', closed_at = now(), closed_by = auth.uid()
   where id = p_id and status = 'aberta';
end;
$$;

revoke all on function public.close_training_campaign(uuid) from public;
grant execute on function public.close_training_campaign(uuid) to authenticated;
