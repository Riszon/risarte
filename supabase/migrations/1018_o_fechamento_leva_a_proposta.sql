-- =============================================================================
-- 1018 — O FECHAMENTO LEVA A PROPOSTA PARA A EMPRESA (OC-00083, H4)
--
-- Pedido do dono (23/09/2026): "o que for gerado na proposta da empresa e
-- aprovada e realizado o fechamento deve se tornar as informações da ficha da
-- empresa. e todos os benefícios deve ir para os Beneficiários que fazem parte
-- da empresa e estão cadastrados no programa."
--
-- Até aqui a proposta morria no funil: o consultor negociava preço, faixa,
-- carência e benefício, e no fechamento nascia uma empresa com os PADRÕES DA
-- REDE. O que tinha sido vendido precisava ser redigitado no cadastro — e é na
-- segunda digitação que o vendido e o cobrado divergem.
--
-- O que falta no CADASTRO para ele conseguir guardar o que foi vendido:
--
--   1) as FAIXAS de preço, que hoje só existem na proposta;
--   2) o tamanho do pacote familiar, que estava fixo em 3 desde a 0097;
--   3) os LIMITES de adesão, para o máximo valer de verdade na hora de
--      cadastrar titular.
--
-- Os benefícios não precisam de tabela nova: `procedure_benefits` já guarda o
-- que vale por empresa, e a 1016 lhe deu o "para quem vale".
--
-- Idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) As faixas de preço passam a existir também no CADASTRO
-- -----------------------------------------------------------------------------
--
-- Mesma forma de `lead_price_tiers`, de propósito: é a mesma regra ("a faixa
-- do total vale para todos"), e um segundo formato faria as duas divergirem no
-- dia em que alguém mexesse numa só.
--
-- ⚠️ A FAIXA VIVE NA EMPRESA, e não na cobrança do mês. A mensalidade é
-- recalculada a cada apuração com a quantidade daquele momento — foi isso que
-- a empresa comprou: "cresça e pague menos". Congelar a faixa no fechamento
-- faria a empresa crescer para 150 titulares e continuar pagando o preço de
-- 50, e ninguém entenderia por quê.
create table if not exists empresarial.company_price_tiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  min_quantity int not null check (min_quantity >= 1),
  price_cents bigint not null check (price_cents >= 0),
  created_at timestamptz not null default now(),
  unique (company_id, min_quantity)
);
create index if not exists company_price_tiers_company_idx
  on empresarial.company_price_tiers (company_id, min_quantity);

alter table empresarial.company_price_tiers enable row level security;

drop policy if exists company_price_tiers_select on empresarial.company_price_tiers;
create policy company_price_tiers_select
  on empresarial.company_price_tiers for select to authenticated
  -- Mesma forma das outras tabelas por empresa (0103, 1001): quem enxerga a
  -- empresa enxerga a faixa dela.
  using (company_id in (select empresarial.accessible_company_ids()));

drop policy if exists company_price_tiers_write on empresarial.company_price_tiers;
create policy company_price_tiers_write
  on empresarial.company_price_tiers for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

grant select, insert, update, delete
  on empresarial.company_price_tiers to authenticated;
grant all on empresarial.company_price_tiers to service_role;

-- -----------------------------------------------------------------------------
-- 2) O tamanho do pacote familiar deixa de ser um número escrito no código
-- -----------------------------------------------------------------------------
--
-- `dependentPlanCostCents` usava 3 desde a 0097 — número de negócio dentro de
-- uma função, que é como ele fica errado para a primeira empresa que negociar
-- diferente. NOT NULL com padrão 3 preserva exatamente o que já acontecia.
alter table empresarial.adhesion_pricing
  add column if not exists dependent_family_size int not null default 3
    check (dependent_family_size >= 1);

comment on column empresarial.adhesion_pricing.dependent_family_size is
  'Quantos dependentes o pacote familiar cobre antes de cobrar o extra. Era 3 '
  'escrito no código desde a 0097; a proposta pode negociar outro número.';

-- -----------------------------------------------------------------------------
-- 3) Os limites de adesão no cadastro da empresa
-- -----------------------------------------------------------------------------
--
-- ⚠️ ANULÁVEIS: nulo é "esta empresa não combinou limite", e é o que faz toda
-- empresa que já existe continuar sem trava nenhuma.
alter table empresarial.companies
  add column if not exists min_adhesions int,
  add column if not exists max_adhesions int,
  add column if not exists adhesion_limit_target varchar(12);

comment on column empresarial.companies.max_adhesions is
  'Máximo combinado na proposta. Acima dele o sistema RECUSA cadastrar, porque '
  'o máximo costuma ser capacidade de atendimento — prometer além é não '
  'entregar. O mínimo só avisa (decisão do dono, 23/09/2026).';

do $$
begin
  alter table empresarial.companies
    add constraint companies_limites_de_adesao
    check (
      (min_adhesions is null or min_adhesions >= 0)
      and (max_adhesions is null or max_adhesions >= 0)
      and (min_adhesions is null or max_adhesions is null or max_adhesions >= min_adhesions)
      and (adhesion_limit_target is null
           or adhesion_limit_target in ('HOLDERS','DEPENDENTS','BOTH'))
    );
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 4) De onde veio o que está no cadastro
-- -----------------------------------------------------------------------------
--
-- Sem isto, ninguém consegue responder "este preço saiu de qual negociação?"
-- seis meses depois — e a resposta é o que separa combinado de digitado.
alter table empresarial.companies
  add column if not exists origin_lead_id uuid
    references empresarial.commercial_leads (id) on delete set null;

comment on column empresarial.companies.origin_lead_id is
  'A negociação que originou este cadastro. É por aqui que se volta da ficha '
  'para a proposta que foi vendida.';
