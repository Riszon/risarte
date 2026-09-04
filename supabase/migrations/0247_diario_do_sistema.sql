-- =============================================================================
-- 0247 — O DIÁRIO DO SISTEMA: problemas relatados pela equipe
-- -----------------------------------------------------------------------------
-- O manual de treinamento declarava, na seção 9.6, uma lacuna:
--
--     "Não identificado no código analisado: não existe canal de suporte,
--      telefone ou e-mail configurado no sistema."
--
-- Esta migração fecha essa lacuna DENTRO do sistema. E não é só conveniência:
-- a seção 9.4 do manual mandava a pessoa COPIAR um formulário de doze linhas e
-- preencher à mão (data, hora, usuário, papel, unidade, tela, versão…). Nenhum
-- balcão cheio faz isso. O que chega hoje é "a agenda não deixou marcar", sem
-- nada do que faz o problema ser encontrável — e aí o relato vira uma conversa
-- de reconstituição, dias depois, com a memória de todo mundo já apagada.
--
-- Aqui o SISTEMA preenche o que o sistema sabe (quem, função, unidade, tela,
-- versão, navegador) e a pessoa escreve só o que ela sabe: o que aconteceu.
--
-- ⚠️ NÃO É TABELA DE ERRO AUTOMÁTICO. Cada linha aqui nasce de alguém decidindo
-- relatar. Captura automática de exceção entra depois, com limite de repetição:
-- um erro em laço geraria milhares de linhas e afogaria justamente o relato de
-- gente, que é o que tem contexto.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os tipos
-- -----------------------------------------------------------------------------
-- Enum novo pode ser criado e usado na mesma transação (a restrição do Postgres
-- é para ACRESCENTAR valor a enum existente — a lição da 0184 e da 0238).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'system_report_kind') then
    create type public.system_report_kind as enum ('erro', 'duvida', 'sugestao');
  end if;
  if not exists (select 1 from pg_type where typname = 'system_report_status') then
    create type public.system_report_status as enum
      ('aberto', 'em_analise', 'resolvido', 'nao_e_defeito');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2) A tabela
-- -----------------------------------------------------------------------------
create sequence if not exists public.system_report_code_seq;

create table if not exists public.system_reports (
  id uuid primary key default gen_random_uuid(),
  -- "O CÓDIGO DO DOCUMENTO NUNCA SOME" (regra do dono, 07/08/2026). É por ele
  -- que se conversa sobre uma ocorrência sem descrever o caso inteiro de novo.
  code text unique,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,

  -- O papel CONGELADO no momento do relato. Ler o papel atual seria mentir
  -- sobre o passado: quem relatou como recepcionista e virou gerente em outubro
  -- apareceria como gerente num problema que ela viu no balcão. Mesma lei do
  -- repasse (0209) e do percentual da taxa (0232).
  reporter_role text,

  kind public.system_report_kind not null default 'erro',
  severity text not null default 'media'
    check (severity in ('baixa', 'media', 'alta')),

  title text not null check (btrim(title) <> ''),
  what_happened text not null check (btrim(what_happened) <> ''),
  expected text,

  -- O que o sistema sabe e a pessoa não deveria ter de digitar.
  screen text,
  app_version text,
  -- Preenchido quando o relato nasce da tela de erro: é o código que o Next.js
  -- gera para a exceção e o que liga este relato ao registro do servidor.
  error_digest text,
  user_agent text,

  status public.system_report_status not null default 'aberto',
  answer text,
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  -- "Corrigido na versão 0.226.0" — fecha o ciclo com o registro de novidades.
  resolved_version text,

  created_at timestamptz not null default now()
);

comment on table public.system_reports is
  'Problemas, dúvidas e sugestões relatados pela equipe. Aberto na tela /sistema. O sistema preenche o contexto; a pessoa escreve o que aconteceu.';

create index if not exists system_reports_clinic_idx
  on public.system_reports (clinic_id, status, created_at desc);
create index if not exists system_reports_reporter_idx
  on public.system_reports (reporter_id, created_at desc);

-- O código nasce em gatilho, nunca na tela: contador atribuído pelo aplicativo
-- repete número quando duas pessoas relatam no mesmo segundo.
create or replace function public.system_report_set_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := 'OC-' ||
      lpad(nextval('public.system_report_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists system_report_code on public.system_reports;
create trigger system_report_code
  before insert on public.system_reports
  for each row execute function public.system_report_set_code();

-- -----------------------------------------------------------------------------
-- 3) Quem vê o quê (decisão do dono, 04/09/2026)
-- -----------------------------------------------------------------------------
-- A UNIDADE inteira enxerga os relatos da unidade. A alternativa — cada um vê
-- só o seu — faria cinco pessoas abrirem o mesmo problema na mesma manhã, e a
-- resposta dada à primeira não chegaria às outras quatro. A alternativa oposta
-- — a rede inteira vê tudo — exporia a operação de uma unidade às demais sem
-- necessidade nenhuma.
alter table public.system_reports enable row level security;

drop policy if exists "system_reports_select" on public.system_reports;
create policy "system_reports_select" on public.system_reports
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_clinic_ids())
    or reporter_id = (select auth.uid())
  );

-- Qualquer pessoa relata, e só em nome dela mesma, numa clínica que é dela.
-- Sem a checagem de `reporter_id` alguém poderia registrar um problema no nome
-- de outra pessoa — e o relato é usado para decidir o que consertar primeiro.
drop policy if exists "system_reports_insert" on public.system_reports;
create policy "system_reports_insert" on public.system_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (
      public.is_admin_master()
      or clinic_id in (select public.user_clinic_ids())
    )
  );

-- Responder e mudar situação é do Admin Master. Deixar quem relatou mudar o
-- status transformaria a fila numa lista que se resolve sozinha.
drop policy if exists "system_reports_update" on public.system_reports;
create policy "system_reports_update" on public.system_reports
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- -----------------------------------------------------------------------------
-- 4) A porta da resposta
-- -----------------------------------------------------------------------------
-- Uma função só, em vez de a tela escrever coluna a coluna: situação, resposta,
-- quem respondeu e quando andam JUNTAS. Separadas, uma falha de rede deixaria
-- o relato marcado como resolvido sem a explicação — que é a parte que a pessoa
-- que relatou vai ler.
create or replace function public.answer_system_report(
  p_report_id uuid,
  p_status public.system_report_status,
  p_answer text,
  p_resolved_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Encerrar sem dizer por quê é o que faz a equipe parar de relatar: ela
  -- registra, o item some da fila e ninguém nunca soube o que aconteceu.
  if p_status in ('resolvido', 'nao_e_defeito')
     and (p_answer is null or btrim(p_answer) = '') then
    raise exception 'ANSWER_REQUIRED';
  end if;

  update public.system_reports
     set status = p_status,
         answer = nullif(btrim(coalesce(p_answer, '')), ''),
         answered_by = v_user,
         answered_at = now(),
         resolved_version =
           nullif(btrim(coalesce(p_resolved_version, '')), '')
   where id = p_report_id;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) from public;
grant execute on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) As capacidades novas na matriz (0246)
-- -----------------------------------------------------------------------------
-- Capacidade nova sem semente aqui apareceria como "ninguém tem" na tela de
-- permissões, e o item sumiria do menu de todo mundo menos do Admin Master.
--
-- As duas nascem para TODA a operação, de propósito: manual que só alguns leem
-- não é manual, e canal de suporte que só alguns alcançam devolve o problema
-- para o WhatsApp — que é de onde ele está saindo.
insert into public.permission_matrix (capability, role) values
  ('menu.manual','receptionist'),('menu.manual','sdr'),
  ('menu.manual','clinical_coordinator'),('menu.manual','planner_dentist'),
  ('menu.manual','dentist'),('menu.manual','commercial_consultant'),
  ('menu.manual','commercial_assistant'),('menu.manual','unit_manager'),
  ('menu.manual','franchisor_staff'),('menu.manual','franchisee'),
  ('menu.manual','tsb'),('menu.manual','asb'),
  ('menu.manual','rislife_consultant'),('menu.manual','finance_franchisor'),
  ('menu.manual','purchaser'),

  ('menu.sistema','receptionist'),('menu.sistema','sdr'),
  ('menu.sistema','clinical_coordinator'),('menu.sistema','planner_dentist'),
  ('menu.sistema','dentist'),('menu.sistema','commercial_consultant'),
  ('menu.sistema','commercial_assistant'),('menu.sistema','unit_manager'),
  ('menu.sistema','franchisor_staff'),('menu.sistema','franchisee'),
  ('menu.sistema','tsb'),('menu.sistema','asb'),
  ('menu.sistema','rislife_consultant'),('menu.sistema','finance_franchisor'),
  ('menu.sistema','purchaser')
on conflict (capability, role) do nothing;
