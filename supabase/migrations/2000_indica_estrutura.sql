-- =============================================================================
-- 2000 — Indica +Risos (IND0, parte 1): schema, tabelas, travas e RLS
-- -----------------------------------------------------------------------------
-- Programa permanente de indicação (docs/indica-mais-risos/). Schema PRÓPRIO
-- `indica`, faixa de migração 2000+ (core 0–999, Empresarial 1000+).
--
-- Decisões aprovadas pelo dono (28/09/2026):
--   * Nomes em português, como no documento de diretrizes.
--   * Ligações com o riSZon: clients, clinics, profiles (quem fez), appointments
--     (Compareceu), plan_negotiations + commercial_sales (Fechou), payables
--     (prêmio da equipe). NENHUMA ligação apaga em cascata; ligação opcional
--     fica vazia (set null) se o registro de origem sumir.
--   * O Embaixador NÃO ganha login: o portal (IND3) entra por link mágico,
--     validado no servidor. O "perfil embaixador" são funções que devolvem só
--     os dados daquele link (migração 2002), nunca acesso direto às tabelas.
--   * Venda direta (direct_sales) não conta como fechamento na 1ª versão.
--   * Sorteio: FORA do escopo (adiado).
--
-- INVARIANTES que este arquivo prende no BANCO (não na tela):
--   1. Saldo de Riso Coins = soma do extrato `pontos_lancamentos`. O extrato só
--      recebe linhas novas, e só pelas funções do motor.
--   2. Indicação só nasce e só muda de status pelas funções do motor
--      (`registrar_indicacao` / `avancar_status`), que gravam o evento.
--
-- >>> PASSO MANUAL DO DONO, UMA VEZ POR BANCO (produção e treino):
--     Supabase → Project Settings → API → "Exposed schemas" → adicionar
--     `indica` → Save. Sem isso a API não enxerga o schema.
--
-- Idempotente.
-- =============================================================================

create schema if not exists indica;

-- -----------------------------------------------------------------------------
-- 1) Perfis do programa, sobre os helpers que o riSZon já tem
-- -----------------------------------------------------------------------------
-- franqueadora    = Admin Master ou visão da rede (franchisor_staff).
-- gestor_unidade  = unit_manager / franchisee daquela unidade (+ franqueadora).
-- risartano       = qualquer papel na unidade, inclusive o alcance de unidades
--                   das funções da Franqueadora (SDR, consultor…).
-- embaixador      = sem acesso direto; ver funções portal_* na 2002.

create or replace function indica.eh_franqueadora()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_admin_master(), false)
      or coalesce(public.is_network_viewer(), false);
$$;

create or replace function indica.eh_gestor(p_unidade_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select indica.eh_franqueadora()
      or coalesce(public.has_role_in_clinic(
           p_unidade_id,
           array['unit_manager', 'franchisee']::public.user_role[]
         ), false);
$$;

create or replace function indica.eh_risartano(p_unidade_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select indica.eh_franqueadora()
      or p_unidade_id in (select public.user_clinic_ids())
      or p_unidade_id in (select public.user_full_access_clinic_ids());
$$;

-- Gestor de TODAS as unidades da lista (lista vazia = não é de unidade nenhuma).
create or replace function indica.eh_gestor_de_todas(p_unidades uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(cardinality(p_unidades), 0) > 0
     and coalesce((select bool_and(indica.eh_gestor(u)) from unnest(p_unidades) u), false);
$$;

create or replace function indica.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) Configuração em cascata Rede → Unidade (a Campanha fica em `campanhas`)
-- -----------------------------------------------------------------------------
-- Uma linha por (unidade, chave, vigente_desde): mudar um parâmetro é inserir
-- uma linha nova com a data em que passa a valer — o histórico fica.
-- `min`/`max`/`travado` só têm efeito na linha da REDE: é a franqueadora quem
-- trava o parâmetro ou define a faixa em que a unidade pode mexer.
create table if not exists indica.config (
  id uuid primary key default gen_random_uuid(),
  escopo text not null check (escopo in ('rede', 'unidade')),
  unidade_id uuid references public.clinics (id),
  grupo text not null default 'geral',
  chave text not null,
  valor jsonb not null,
  min numeric,
  max numeric,
  travado boolean not null default false,
  descricao text,
  vigente_desde timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  constraint config_escopo_coerente check ((escopo = 'rede') = (unidade_id is null)),
  constraint config_faixa_valida check (min is null or max is null or min <= max),
  constraint config_versao_unica unique nulls not distinct (unidade_id, chave, vigente_desde)
);
create index if not exists config_chave_idx
  on indica.config (chave, unidade_id, vigente_desde desc);

-- -----------------------------------------------------------------------------
-- 3) Níveis de Embaixador
-- -----------------------------------------------------------------------------
create table if not exists indica.niveis (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  ordem integer not null unique,
  criterio_conversoes integer not null check (criterio_conversoes >= 0),
  multiplicador numeric(4, 2) not null check (multiplicador > 0),
  beneficios text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4) Parceiros (vouchers e parceiros indicadores)
-- -----------------------------------------------------------------------------
create table if not exists indica.parceiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('voucher', 'indicador', 'ambos')),
  contato text,
  codigo text unique,
  regras jsonb not null default '{}'::jsonb,
  unidade_id uuid references public.clinics (id),          -- vazio = rede
  empresa_empresarial_id uuid references empresarial.companies (id) on delete set null,
  ativo boolean not null default true,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5) Campanhas (motor completo na IND4; a estrutura já nasce aqui porque a
--    indicação congela a regra da campanha no registro)
-- -----------------------------------------------------------------------------
create table if not exists indica.campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  arte_url text,
  escopo text not null check (escopo in ('rede', 'unidades')),
  unidades uuid[] not null default '{}',
  publico jsonb not null default '{}'::jsonb,
  especialidade text,
  inicio timestamptz not null,
  fim timestamptz not null,
  prazo_extra_dias integer not null default 0 check (prazo_extra_dias >= 0),
  regras jsonb not null default '{}'::jsonb,
  beneficio_indicado jsonb,
  orcamento_max_centavos bigint check (orcamento_max_centavos is null or orcamento_max_centavos >= 0),
  status text not null default 'rascunho'
    check (status in ('rascunho', 'agendada', 'ativa', 'pausada', 'encerrada', 'apurada')),
  regulamento_md text,
  versao integer not null default 1 check (versao >= 1),
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint campanhas_periodo check (fim > inicio),
  constraint campanhas_abrangencia check ((escopo = 'rede') = (cardinality(unidades) = 0))
);

-- -----------------------------------------------------------------------------
-- 6) Embaixadores (carteira ÚNICA na rede: um por cliente)
-- -----------------------------------------------------------------------------
create table if not exists indica.embaixadores (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null unique references public.clients (id),
  codigo text not null unique check (codigo ~ '^[A-Z0-9]{4,12}$'),
  nivel_id uuid not null references indica.niveis (id),
  status text not null default 'ativo' check (status in ('ativo', 'suspenso', 'encerrado')),
  aceite_regulamento_em timestamptz not null,
  versao_regulamento text not null,
  unidade_cadastro_id uuid not null references public.clinics (id),
  portal_token_hash bytea,
  portal_token_expira_em timestamptz,
  nivel_recalculado_em timestamptz,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists embaixadores_portal_token_uq
  on indica.embaixadores (portal_token_hash) where portal_token_hash is not null;

-- -----------------------------------------------------------------------------
-- 7) Indicações
-- -----------------------------------------------------------------------------
create sequence if not exists indica.indicacao_codigo_seq;

create table if not exists indica.indicacoes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('IND-' || lpad(nextval('indica.indicacao_codigo_seq')::text, 6, '0')),
  embaixador_id uuid references indica.embaixadores (id),
  parceiro_id uuid references indica.parceiros (id),
  -- Dados do indicado: o MÍNIMO (LGPD). Anonimizados pela rotina da IND3.
  indicado_nome text not null,
  indicado_telefone text,
  indicado_telefone_digitos text generated always as
    (nullif(regexp_replace(coalesce(indicado_telefone, ''), '\D', '', 'g'), '')) stored,
  indicado_cpf text,
  indicado_cpf_digitos text generated always as
    (nullif(regexp_replace(coalesce(indicado_cpf, ''), '\D', '', 'g'), '')) stored,
  indicado_email text,
  cliente_indicado_id uuid references public.clients (id) on delete set null,
  unidade_id uuid not null references public.clinics (id),
  canal text not null check (canal in ('link', 'agendamento', 'embaixador', 'qr', 'parceiro')),
  campanha_id uuid references indica.campanhas (id),
  status text not null default 'registrada'
    check (status in ('registrada', 'validada', 'agendada', 'compareceu', 'fechou',
                      'convertida', 'recusada', 'faltou', 'nao_fechou', 'cancelada',
                      'expirada')),
  risartano_origem_id uuid references public.profiles (id),
  risartano_conversao_id uuid references public.profiles (id),
  agendamento_id uuid references public.appointments (id) on delete set null,
  orcamento_id uuid references public.plan_negotiations (id) on delete set null,
  venda_id uuid references public.commercial_sales (id) on delete set null,
  valor_fechado_centavos bigint check (valor_fechado_centavos is null or valor_fechado_centavos >= 0),
  trava_ate timestamptz not null,
  -- A regra (base + campanha) vigente no REGISTRO. Os lançamentos usam esta,
  -- nunca a regra de hoje: regra muda só para o futuro.
  regra_congelada jsonb not null,
  consentimento_id uuid,
  desvinculada_em timestamptz,            -- o indicado pediu para não ser ligado a quem indicou
  registrada_em timestamptz not null default now(),
  validada_em timestamptz,
  agendada_em timestamptz,
  compareceu_em timestamptz,
  fechou_em timestamptz,
  convertida_em timestamptz,
  encerrada_em timestamptz,
  anonimizada_em timestamptz,
  criado_por uuid references public.profiles (id),
  atualizado_em timestamptz not null default now(),
  constraint indicacoes_uma_origem check ((embaixador_id is null) <> (parceiro_id is null)),
  constraint indicacoes_algum_contato check (
    indicado_telefone is not null or indicado_cpf is not null
    or cliente_indicado_id is not null or anonimizada_em is not null
  )
);

-- "Primeiro registro válido vence": enquanto houver indicação em aberto (nem
-- recusada, nem cancelada, nem expirada), a mesma pessoa não é indicada de
-- novo. A função confere antes e diz QUAL indicação chegou primeiro; o índice
-- é a rede de segurança contra dois cliques simultâneos.
create unique index if not exists indicacoes_telefone_aberta_uq
  on indica.indicacoes (indicado_telefone_digitos)
  where indicado_telefone_digitos is not null
    and status not in ('recusada', 'cancelada', 'expirada');
create unique index if not exists indicacoes_cpf_aberta_uq
  on indica.indicacoes (indicado_cpf_digitos)
  where indicado_cpf_digitos is not null
    and status not in ('recusada', 'cancelada', 'expirada');
create unique index if not exists indicacoes_cliente_aberta_uq
  on indica.indicacoes (cliente_indicado_id)
  where cliente_indicado_id is not null
    and status not in ('recusada', 'cancelada', 'expirada');
-- Uma venda gera no máximo uma conversão.
create unique index if not exists indicacoes_venda_uq
  on indica.indicacoes (venda_id) where venda_id is not null;

create index if not exists indicacoes_unidade_status_idx
  on indica.indicacoes (unidade_id, status);
create index if not exists indicacoes_embaixador_idx
  on indica.indicacoes (embaixador_id);
create index if not exists indicacoes_registrada_idx
  on indica.indicacoes (registrada_em);

-- -----------------------------------------------------------------------------
-- 8) Linha do tempo da indicação
-- -----------------------------------------------------------------------------
create table if not exists indica.indicacao_eventos (
  id bigint generated always as identity primary key,
  indicacao_id uuid not null references indica.indicacoes (id),
  status_de text,
  status_para text not null,
  motivo text,
  dados jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);
create index if not exists indicacao_eventos_indicacao_idx
  on indica.indicacao_eventos (indicacao_id, criado_em);

-- -----------------------------------------------------------------------------
-- 9) Catálogo e resgates (telas e fluxo na IND2)
-- -----------------------------------------------------------------------------
create table if not exists indica.catalogo_itens (
  id uuid primary key default gen_random_uuid(),
  tipo text not null
    check (tipo in ('credito_risarte', 'voucher_parceiro', 'produto', 'experiencia', 'doacao')),
  nome text not null,
  descricao text,
  custo_riso_coins integer not null check (custo_riso_coins > 0),
  valor_centavos bigint check (valor_centavos is null or valor_centavos >= 0),
  parceiro_id uuid references indica.parceiros (id),
  estoque integer check (estoque is null or estoque >= 0),
  unidades uuid[] not null default '{}',                 -- vazio = rede toda
  nivel_minimo_id uuid references indica.niveis (id),
  ativo boolean not null default true,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create sequence if not exists indica.resgate_codigo_seq;

create table if not exists indica.resgates (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('RES-' || lpad(nextval('indica.resgate_codigo_seq')::text, 6, '0')),
  embaixador_id uuid not null references indica.embaixadores (id),
  item_id uuid not null references indica.catalogo_itens (id),
  unidade_id uuid not null references public.clinics (id),
  riso_coins integer not null check (riso_coins > 0),
  status text not null default 'solicitado'
    check (status in ('solicitado', 'aprovado', 'entregue', 'recusado', 'cancelado')),
  codigo_voucher text,
  aprovado_por uuid references public.profiles (id),
  aprovado_em timestamptz,
  entregue_por uuid references public.profiles (id),
  entregue_em timestamptz,
  cedido_para_nome text,
  cedido_para_cpf text,
  cedido_para_telefone text,
  motivo text,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists resgates_embaixador_idx on indica.resgates (embaixador_id);

-- -----------------------------------------------------------------------------
-- 10) EXTRATO (ledger) — a única fonte do saldo
-- -----------------------------------------------------------------------------
-- Cada linha mexe em UM dos três saldos: disponível, pendente ou em carência.
-- Mudar de saldo (ex.: os 50 pendentes que liberam no comparecimento) são DUAS
-- linhas `liberacao`: −50 no pendente e +50 no disponível. Assim cada saldo é
-- uma soma simples, e nenhuma linha jamais é alterada.
create table if not exists indica.pontos_lancamentos (
  id bigint generated always as identity primary key,
  embaixador_id uuid not null references indica.embaixadores (id),
  indicacao_id uuid references indica.indicacoes (id),
  resgate_id uuid references indica.resgates (id),
  tipo text not null
    check (tipo in ('credito', 'pendente', 'carencia', 'liberacao', 'estorno',
                    'resgate', 'expiracao', 'ajuste')),
  saldo text not null check (saldo in ('disponivel', 'pendente', 'carencia')),
  riso_coins integer not null check (riso_coins <> 0),
  regra_aplicada jsonb not null,
  libera_em timestamptz,
  expira_em timestamptz,
  unidade_custo_id uuid references public.clinics (id),
  origem_id bigint references indica.pontos_lancamentos (id),
  motivo text,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  constraint lancamentos_sinal check (
    case
      when tipo in ('credito', 'pendente', 'carencia') then riso_coins > 0
      when tipo in ('estorno', 'resgate', 'expiracao') then riso_coins < 0
      else true
    end
  ),
  constraint lancamentos_saldo_do_tipo check (
    case
      when tipo = 'pendente' then saldo = 'pendente'
      when tipo = 'carencia' then saldo = 'carencia'
      when tipo in ('credito', 'resgate', 'expiracao', 'ajuste') then saldo = 'disponivel'
      else true
    end
  ),
  constraint lancamentos_ajuste_motivado check (tipo <> 'ajuste' or nullif(btrim(motivo), '') is not null)
);
create index if not exists lancamentos_embaixador_idx
  on indica.pontos_lancamentos (embaixador_id, saldo);
create index if not exists lancamentos_indicacao_idx
  on indica.pontos_lancamentos (indicacao_id);

-- -----------------------------------------------------------------------------
-- 11) Metas e apurações da equipe (IND4)
-- -----------------------------------------------------------------------------
create table if not exists indica.metas_equipe (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.clinics (id),
  campanha_id uuid references indica.campanhas (id),
  periodo_tipo text not null check (periodo_tipo in ('mes', 'trimestre', 'campanha')),
  periodo_inicio date not null,
  periodo_fim date not null,
  metrica text not null check (metrica in ('conversoes', 'riso_coins', 'receita_indicados')),
  faixas jsonb not null default '[]'::jsonb,
  trava_qualidade_comparecimento numeric(5, 2)
    check (trava_qualidade_comparecimento is null
           or trava_qualidade_comparecimento between 0 and 100),
  status text not null default 'rascunho' check (status in ('rascunho', 'ativa', 'encerrada')),
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint metas_periodo check (periodo_fim >= periodo_inicio)
);

create table if not exists indica.apuracoes (
  id uuid primary key default gen_random_uuid(),
  meta_id uuid not null references indica.metas_equipe (id),
  tipo text not null check (tipo in ('provisoria', 'final')),
  valor_apurado numeric not null,
  faixa_atingida text,
  taxa_comparecimento numeric(5, 2),
  status text not null default 'aguardando_aprovacao'
    check (status in ('aguardando_aprovacao', 'aprovada', 'reprovada', 'paga')),
  indicacoes_contadas uuid[] not null default '{}',
  aprovado_por uuid references public.profiles (id),
  aprovado_em timestamptz,
  conta_pagar_id uuid references public.payables (id) on delete set null,
  criado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 12) "Pedi indicação" (1 clique na ficha do cliente — IND1)
-- -----------------------------------------------------------------------------
create table if not exists indica.pedidos_indicacao (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clients (id),
  unidade_id uuid not null references public.clinics (id),
  risartano_id uuid not null default auth.uid() references public.profiles (id),
  momento text not null
    check (momento in ('fechamento', 'entrega_etapa', 'elogio', 'retorno', 'outro')),
  resultado text not null default 'pendente'
    check (resultado in ('pendente', 'indicou', 'recusou', 'vai_pensar')),
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists pedidos_unidade_idx on indica.pedidos_indicacao (unidade_id, criado_em);

-- -----------------------------------------------------------------------------
-- 13) Consentimento LGPD do indicado
-- -----------------------------------------------------------------------------
create table if not exists indica.consentimentos (
  id uuid primary key default gen_random_uuid(),
  indicacao_id uuid not null references indica.indicacoes (id),
  texto_versao text not null,
  canal text not null check (canal in ('link', 'whatsapp', 'presencial', 'portal')),
  ip inet,
  aceito_em timestamptz,
  revogado_em timestamptz,
  registrado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

do $$
begin
  alter table indica.indicacoes
    add constraint indicacoes_consentimento_fk
    foreign key (consentimento_id) references indica.consentimentos (id) on delete set null;
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 14) Alertas de fraude (regras na IND5)
-- -----------------------------------------------------------------------------
create table if not exists indica.alertas_fraude (
  id uuid primary key default gen_random_uuid(),
  indicacao_id uuid references indica.indicacoes (id),
  embaixador_id uuid references indica.embaixadores (id),
  unidade_id uuid references public.clinics (id),
  regra text not null,
  severidade text not null default 'media' check (severidade in ('baixa', 'media', 'alta')),
  detalhes jsonb not null default '{}'::jsonb,
  status text not null default 'aberto'
    check (status in ('aberto', 'em_analise', 'procedente', 'improcedente')),
  resolvido_por uuid references public.profiles (id),
  resolvido_em timestamptz,
  criado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 15) Gatilhos: atualizado_em e as duas TRAVAS do motor
-- -----------------------------------------------------------------------------
drop trigger if exists parceiros_atualizado_em on indica.parceiros;
create trigger parceiros_atualizado_em before update on indica.parceiros
  for each row execute function indica.tocar_atualizado_em();
drop trigger if exists campanhas_atualizado_em on indica.campanhas;
create trigger campanhas_atualizado_em before update on indica.campanhas
  for each row execute function indica.tocar_atualizado_em();
drop trigger if exists embaixadores_atualizado_em on indica.embaixadores;
create trigger embaixadores_atualizado_em before update on indica.embaixadores
  for each row execute function indica.tocar_atualizado_em();
drop trigger if exists indicacoes_atualizado_em on indica.indicacoes;
create trigger indicacoes_atualizado_em before update on indica.indicacoes
  for each row execute function indica.tocar_atualizado_em();
drop trigger if exists catalogo_atualizado_em on indica.catalogo_itens;
create trigger catalogo_atualizado_em before update on indica.catalogo_itens
  for each row execute function indica.tocar_atualizado_em();
drop trigger if exists resgates_atualizado_em on indica.resgates;
create trigger resgates_atualizado_em before update on indica.resgates
  for each row execute function indica.tocar_atualizado_em();
drop trigger if exists metas_atualizado_em on indica.metas_equipe;
create trigger metas_atualizado_em before update on indica.metas_equipe
  for each row execute function indica.tocar_atualizado_em();

-- TRAVA 1 — o extrato só cresce, e só pelo motor.
-- A RLS já não deixa ninguém escrever; esta trava vale também para a chave de
-- serviço e para o SQL Editor, que passam por cima da RLS. As funções do motor
-- abrem a porta com `set_config('indica.motor', 'sim', true)` e fecham ao sair.
-- (TRUNCATE não dispara gatilho de linha: a limpeza do banco de teste segue.)
create or replace function indica.so_cresce_pelo_motor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'INDICA_REGISTRO_IMUTAVEL: indica.% só recebe linhas novas. Para corrigir o extrato, lance um ajuste com motivo.', tg_table_name;
  end if;
  if coalesce(current_setting('indica.motor', true), '') <> 'sim' then
    raise exception 'INDICA_FORA_DO_MOTOR: indica.% só é gravada pelas funções do Indica +Risos.', tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists pontos_lancamentos_trava on indica.pontos_lancamentos;
create trigger pontos_lancamentos_trava
  before insert or update or delete on indica.pontos_lancamentos
  for each row execute function indica.so_cresce_pelo_motor();

-- TRAVA 2 — indicação nasce e muda só pelo motor (status, regra, trava, etc.).
create or replace function indica.indicacao_so_pelo_motor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'INDICA_INDICACAO_NAO_SE_APAGA: indicação encerra por status (recusada, cancelada, expirada), nunca é apagada.';
  end if;
  if coalesce(current_setting('indica.motor', true), '') <> 'sim' then
    raise exception 'INDICA_FORA_DO_MOTOR: indicação só nasce e muda pelas funções registrar_indicacao / avancar_status.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists indicacoes_trava on indica.indicacoes;
create trigger indicacoes_trava
  before insert or update or delete on indica.indicacoes
  for each row execute function indica.indicacao_so_pelo_motor();

-- A linha do tempo também é só do motor (é a auditoria da indicação).
drop trigger if exists indicacao_eventos_trava on indica.indicacao_eventos;
create trigger indicacao_eventos_trava
  before insert or update or delete on indica.indicacao_eventos
  for each row execute function indica.so_cresce_pelo_motor();

-- -----------------------------------------------------------------------------
-- 16) RLS — todas as tabelas
-- -----------------------------------------------------------------------------
alter table indica.config enable row level security;
alter table indica.niveis enable row level security;
alter table indica.parceiros enable row level security;
alter table indica.campanhas enable row level security;
alter table indica.embaixadores enable row level security;
alter table indica.indicacoes enable row level security;
alter table indica.indicacao_eventos enable row level security;
alter table indica.catalogo_itens enable row level security;
alter table indica.resgates enable row level security;
alter table indica.pontos_lancamentos enable row level security;
alter table indica.metas_equipe enable row level security;
alter table indica.apuracoes enable row level security;
alter table indica.pedidos_indicacao enable row level security;
alter table indica.consentimentos enable row level security;
alter table indica.alertas_fraude enable row level security;

-- config: todo Risartano lê (são regras, não dado pessoal). Grava: a rede, a
-- franqueadora; a unidade, o gestor dela. Sem update/delete: mudar = nova linha.
drop policy if exists config_ler on indica.config;
create policy config_ler on indica.config for select to authenticated using (true);
drop policy if exists config_gravar on indica.config;
create policy config_gravar on indica.config for insert to authenticated
  with check (case when unidade_id is null then indica.eh_franqueadora()
                   else indica.eh_gestor(unidade_id) end);

-- níveis: todos leem; franqueadora mantém.
drop policy if exists niveis_ler on indica.niveis;
create policy niveis_ler on indica.niveis for select to authenticated using (true);
drop policy if exists niveis_gravar on indica.niveis;
create policy niveis_gravar on indica.niveis for insert to authenticated
  with check (indica.eh_franqueadora());
drop policy if exists niveis_alterar on indica.niveis;
create policy niveis_alterar on indica.niveis for update to authenticated
  using (indica.eh_franqueadora()) with check (indica.eh_franqueadora());

-- parceiros: Risartanos leem; da rede = franqueadora, da unidade = gestor.
drop policy if exists parceiros_ler on indica.parceiros;
create policy parceiros_ler on indica.parceiros for select to authenticated
  using (unidade_id is null or indica.eh_risartano(unidade_id));
drop policy if exists parceiros_gravar on indica.parceiros;
create policy parceiros_gravar on indica.parceiros for insert to authenticated
  with check (case when unidade_id is null then indica.eh_franqueadora()
                   else indica.eh_gestor(unidade_id) end);
drop policy if exists parceiros_alterar on indica.parceiros;
create policy parceiros_alterar on indica.parceiros for update to authenticated
  using (case when unidade_id is null then indica.eh_franqueadora()
              else indica.eh_gestor(unidade_id) end)
  with check (case when unidade_id is null then indica.eh_franqueadora()
                   else indica.eh_gestor(unidade_id) end);

-- campanhas: de rede, todos leem; de unidades, quem é daquelas unidades.
drop policy if exists campanhas_ler on indica.campanhas;
create policy campanhas_ler on indica.campanhas for select to authenticated
  using (escopo = 'rede' or indica.eh_franqueadora()
         or exists (select 1 from unnest(unidades) u where indica.eh_risartano(u)));
drop policy if exists campanhas_gravar on indica.campanhas;
create policy campanhas_gravar on indica.campanhas for insert to authenticated
  with check (indica.eh_franqueadora()
              or (escopo = 'unidades' and indica.eh_gestor_de_todas(unidades)));
drop policy if exists campanhas_alterar on indica.campanhas;
create policy campanhas_alterar on indica.campanhas for update to authenticated
  using (indica.eh_franqueadora()
         or (escopo = 'unidades' and indica.eh_gestor_de_todas(unidades)))
  with check (indica.eh_franqueadora()
              or (escopo = 'unidades' and indica.eh_gestor_de_todas(unidades)));

-- embaixadores: quem enxerga o CLIENTE enxerga o Embaixador. A subconsulta em
-- public.clients roda com a RLS de quem pergunta — reusa a regra do riSZon
-- inteira (unidade, unidade preferida, histórico, compartilhamento).
-- Escrita só pelas funções do motor.
drop policy if exists embaixadores_ler on indica.embaixadores;
create policy embaixadores_ler on indica.embaixadores for select to authenticated
  using (indica.eh_franqueadora()
         or exists (select 1 from public.clients c where c.id = cliente_id));

-- indicações: Risartano da unidade. Escrita só pelo motor.
drop policy if exists indicacoes_ler on indica.indicacoes;
create policy indicacoes_ler on indica.indicacoes for select to authenticated
  using (indica.eh_risartano(unidade_id));

-- linha do tempo e consentimento: quem vê a indicação.
drop policy if exists indicacao_eventos_ler on indica.indicacao_eventos;
create policy indicacao_eventos_ler on indica.indicacao_eventos for select to authenticated
  using (exists (select 1 from indica.indicacoes i where i.id = indicacao_id));
drop policy if exists consentimentos_ler on indica.consentimentos;
create policy consentimentos_ler on indica.consentimentos for select to authenticated
  using (exists (select 1 from indica.indicacoes i where i.id = indicacao_id));

-- extrato: quem vê o Embaixador.
drop policy if exists lancamentos_ler on indica.pontos_lancamentos;
create policy lancamentos_ler on indica.pontos_lancamentos for select to authenticated
  using (exists (select 1 from indica.embaixadores e where e.id = embaixador_id));

-- catálogo: todos leem o da rede; o da unidade, quem é dela.
drop policy if exists catalogo_ler on indica.catalogo_itens;
create policy catalogo_ler on indica.catalogo_itens for select to authenticated
  using (cardinality(unidades) = 0 or indica.eh_franqueadora()
         or exists (select 1 from unnest(unidades) u where indica.eh_risartano(u)));
drop policy if exists catalogo_gravar on indica.catalogo_itens;
create policy catalogo_gravar on indica.catalogo_itens for insert to authenticated
  with check (indica.eh_franqueadora() or indica.eh_gestor_de_todas(unidades));
drop policy if exists catalogo_alterar on indica.catalogo_itens;
create policy catalogo_alterar on indica.catalogo_itens for update to authenticated
  using (indica.eh_franqueadora() or indica.eh_gestor_de_todas(unidades))
  with check (indica.eh_franqueadora() or indica.eh_gestor_de_todas(unidades));

-- resgates: Risartano da unidade de entrega, ou quem vê o Embaixador.
-- Escrita pelo fluxo de resgate (IND2).
drop policy if exists resgates_ler on indica.resgates;
create policy resgates_ler on indica.resgates for select to authenticated
  using (indica.eh_risartano(unidade_id)
         or exists (select 1 from indica.embaixadores e where e.id = embaixador_id));

-- metas: a equipe da unidade lê; o gestor mantém.
drop policy if exists metas_ler on indica.metas_equipe;
create policy metas_ler on indica.metas_equipe for select to authenticated
  using (indica.eh_risartano(unidade_id));
drop policy if exists metas_gravar on indica.metas_equipe;
create policy metas_gravar on indica.metas_equipe for insert to authenticated
  with check (indica.eh_gestor(unidade_id));
drop policy if exists metas_alterar on indica.metas_equipe;
create policy metas_alterar on indica.metas_equipe for update to authenticated
  using (indica.eh_gestor(unidade_id)) with check (indica.eh_gestor(unidade_id));

-- apurações: quem vê a meta. Aprovação pelo fluxo da IND4.
drop policy if exists apuracoes_ler on indica.apuracoes;
create policy apuracoes_ler on indica.apuracoes for select to authenticated
  using (exists (select 1 from indica.metas_equipe m where m.id = meta_id));

-- "pedi indicação": a equipe da unidade lê; cada um grava o SEU pedido, de
-- cliente que ele enxerga.
drop policy if exists pedidos_ler on indica.pedidos_indicacao;
create policy pedidos_ler on indica.pedidos_indicacao for select to authenticated
  using (indica.eh_risartano(unidade_id));
drop policy if exists pedidos_gravar on indica.pedidos_indicacao;
create policy pedidos_gravar on indica.pedidos_indicacao for insert to authenticated
  with check (risartano_id = auth.uid()
              and indica.eh_risartano(unidade_id)
              and exists (select 1 from public.clients c where c.id = cliente_id));
drop policy if exists pedidos_alterar on indica.pedidos_indicacao;
create policy pedidos_alterar on indica.pedidos_indicacao for update to authenticated
  using (risartano_id = auth.uid() or indica.eh_gestor(unidade_id))
  with check (indica.eh_risartano(unidade_id));

-- alertas de fraude: franqueadora e gestor da unidade leem; franqueadora trata.
drop policy if exists alertas_ler on indica.alertas_fraude;
create policy alertas_ler on indica.alertas_fraude for select to authenticated
  using (indica.eh_franqueadora() or (unidade_id is not null and indica.eh_gestor(unidade_id)));
drop policy if exists alertas_tratar on indica.alertas_fraude;
create policy alertas_tratar on indica.alertas_fraude for update to authenticated
  using (indica.eh_franqueadora()) with check (indica.eh_franqueadora());

-- -----------------------------------------------------------------------------
-- 17) Permissões. `anon` NÃO recebe nem o uso do schema.
-- -----------------------------------------------------------------------------
grant usage on schema indica to authenticated, service_role;
grant select, insert, update, delete on all tables in schema indica to authenticated;
grant all on all tables in schema indica to service_role;
grant usage, select on all sequences in schema indica to authenticated, service_role;

-- Funções: ninguém executa por padrão (AP15 — o Supabase dá EXECUTE a anon e
-- authenticated pelo nome). Os helpers de perfil são usados DENTRO das
-- políticas, então quem é avaliado por elas precisa executá-los.
revoke execute on all functions in schema indica from public, anon, authenticated;
grant execute on function indica.eh_franqueadora() to authenticated, service_role;
grant execute on function indica.eh_gestor(uuid) to authenticated, service_role;
grant execute on function indica.eh_risartano(uuid) to authenticated, service_role;
grant execute on function indica.eh_gestor_de_todas(uuid[]) to authenticated, service_role;
