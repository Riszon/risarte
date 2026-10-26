-- =============================================================================
-- 1032 — OS DEPENDENTES NA PROPOSTA E NA COBRANÇA
-- -----------------------------------------------------------------------------
-- Pedido do dono (26/10/2026): na proposta, um quadro de "quantos titulares
-- terão quantos dependentes" (3 sem dependentes, 4 com 1, 2 com 2…) para já
-- calcular um valor aproximado para iniciar o programa. Sem saber a
-- distribuição, a proposta pode calcular como individual ou não calcular.
--
-- Três decisões dele, na mesma conversa:
--   1. A COBRANÇA SEGUE A PROPOSTA. A escolha "individual × plano familiar"
--      nunca chegava à empresa: o boleto sempre cobrava o pacote a partir de
--      2 dependentes. Agora o fechamento leva o modo (`dependent_mode`).
--   2. O documento mostra titulares + dependentes estimados = total.
--   3. A IMPLANTAÇÃO TEM OPÇÃO: cobrar só os titulares ou titulares e
--      dependentes. Antes dependia do caminho — com todos cadastrados o boleto
--      somava os dependentes; pela quantidade contratada, não somava.
--
-- O padrão de tudo preserva o que já existe: empresa antiga continua no
-- pacote familiar e com implantação só dos titulares (a regra escrita no
-- Bloco K). Só acrescenta colunas. Não apaga nada. Idempotente.
-- =============================================================================

-- ---- 1) O preço da empresa sabe como cobrar os dependentes ------------------
alter table empresarial.adhesion_pricing
  add column if not exists dependent_mode varchar(16) not null default 'FAMILY_PACKAGE';

alter table empresarial.adhesion_pricing
  drop constraint if exists adhesion_pricing_dependent_mode;
alter table empresarial.adhesion_pricing
  add constraint adhesion_pricing_dependent_mode
    check (dependent_mode in ('PER_DEPENDENT', 'FAMILY_PACKAGE'));

comment on column empresarial.adhesion_pricing.dependent_mode is
  'PER_DEPENDENT: cada dependente paga o valor individual. FAMILY_PACKAGE: 1 '
  'dependente paga o individual, a partir de 2 vale o pacote, acima do pacote '
  'o extra. Vem da proposta no fechamento (1032).';

-- ---- 2) A proposta: como calcular os dependentes e o quadro -----------------
alter table empresarial.lead_qualification
  add column if not exists dependents_calc_mode varchar(16),
  add column if not exists dependents_distribution jsonb,
  add column if not exists implantation_includes_dependents boolean;

alter table empresarial.lead_qualification
  drop constraint if exists lead_qualification_calculo_dos_dependentes;
alter table empresarial.lead_qualification
  add constraint lead_qualification_calculo_dos_dependentes
    check (
      (dependents_calc_mode is null
       or dependents_calc_mode in ('DISTRIBUTION', 'AS_INDIVIDUAL', 'NONE'))
      and (dependents_distribution is null
           or jsonb_typeof(dependents_distribution) = 'array')
    );

comment on column empresarial.lead_qualification.dependents_calc_mode is
  'DISTRIBUTION: pelo quadro titulares × dependentes. AS_INDIVIDUAL: a '
  'estimativa de dependentes × o valor individual. NONE: a proposta só explica '
  'a tabela. Nulo = NONE (o que valia antes da 1032).';
comment on column empresarial.lead_qualification.dependents_distribution is
  'O quadro: [{"dependentes": 2, "titulares": 4}, …] — 4 titulares com 2 '
  'dependentes cada.';
comment on column empresarial.lead_qualification.implantation_includes_dependents is
  'A implantação (1º pagamento) cobra também os dependentes. Nulo = não.';

-- ---- 3) A empresa: a regra da implantação, vinda da proposta ----------------
alter table empresarial.companies
  add column if not exists implantation_includes_dependents boolean not null default false,
  add column if not exists implantation_dependents_cents bigint;

alter table empresarial.companies
  drop constraint if exists companies_implantacao_dos_dependentes;
alter table empresarial.companies
  add constraint companies_implantacao_dos_dependentes
    check (implantation_dependents_cents is null or implantation_dependents_cents >= 0);

comment on column empresarial.companies.implantation_includes_dependents is
  'A implantação cobra também os dependentes (opção da proposta, 1032).';
comment on column empresarial.companies.implantation_dependents_cents is
  'A estimativa mensal dos dependentes que a proposta calculou, congelada no '
  'fechamento. É o que a 1ª implantação cobra dos dependentes enquanto os '
  'cadastros não estão completos — como a quantidade contratada faz com os '
  'titulares.';
