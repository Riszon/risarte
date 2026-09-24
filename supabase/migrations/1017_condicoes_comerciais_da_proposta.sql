-- =============================================================================
-- 1017 — AS CONDIÇÕES COMERCIAIS DA PROPOSTA (OC-00083, H3)
--
-- Pedidos do dono (23/09/2026), todos na mesma tela:
--   · quantidade MÍNIMA e MÁXIMA de adesões, dizendo se vale para titulares,
--     dependentes ou ambos;
--   · VALOR MÍNIMO da proposta;
--   · FAIXAS DE PREÇO por quantidade ("para grandes quantidades tende a ficar
--     mais barato"), valendo também quando a cobrança é fixa por empresa;
--   · implantação FIXA ou POR ADESÃO;
--   · os preços de DEPENDENTE (individual, pacote familiar e extra)
--     configuráveis na proposta.
--
-- ⚠️ TUDO ANULÁVEL, e aqui isso é a regra e não o descuido (lição da 0230):
-- nulo significa "esta negociação não combinou nada disso", e é o que faz o
-- comportamento de hoje continuar valendo sozinho. Proposta antiga não muda de
-- preço por causa de coluna nova.
--
-- Idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Limites de adesão, valor mínimo e implantação
-- -----------------------------------------------------------------------------
alter table empresarial.lead_qualification
  add column if not exists min_adhesions int,
  add column if not exists max_adhesions int,
  add column if not exists adhesion_limit_target varchar(12),
  add column if not exists min_proposal_cents bigint,
  add column if not exists implantation_mode varchar(14),
  add column if not exists implantation_fixed_cents bigint;

comment on column empresarial.lead_qualification.adhesion_limit_target is
  'O que o mínimo/máximo conta: HOLDERS (só titulares), DEPENDENTS (só '
  'dependentes) ou BOTH (a soma). NULO quando não há limite combinado.';
comment on column empresarial.lead_qualification.min_proposal_cents is
  'Mensalidade mínima aceita nesta negociação. O sistema AVISA quando a '
  'simulação fica abaixo; quem decide é gente.';
comment on column empresarial.lead_qualification.implantation_mode is
  'PER_ADHESION (o de sempre: valor × titulares) ou FIXED (um valor só pela '
  'empresa). NULO = por adesão, que é o comportamento que já existia.';

do $$
begin
  alter table empresarial.lead_qualification
    add constraint lead_qualification_condicoes_comerciais
    check (
      (min_adhesions is null or min_adhesions >= 0)
      and (max_adhesions is null or max_adhesions >= 0)
      -- Máximo abaixo do mínimo é faixa vazia: nenhuma quantidade serviria, e
      -- a proposta nasceria impossível de cumprir.
      and (min_adhesions is null or max_adhesions is null or max_adhesions >= min_adhesions)
      and (adhesion_limit_target is null
           or adhesion_limit_target in ('HOLDERS','DEPENDENTS','BOTH'))
      and (min_proposal_cents is null or min_proposal_cents >= 0)
      and (implantation_mode is null
           or implantation_mode in ('PER_ADHESION','FIXED'))
      and (implantation_fixed_cents is null or implantation_fixed_cents >= 0)
    );
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Os preços de DEPENDENTE combinados nesta proposta
-- -----------------------------------------------------------------------------
--
-- Os três valores do exemplo do dono já existem no cadastro da empresa
-- (`adhesion_pricing`): individual, pacote familiar e extra. O que faltava era
-- poder DECIDI-LOS na negociação, antes de a empresa existir.
--
-- `dependent_mode` separa os dois jeitos de cobrar, e o padrão nulo é o de
-- hoje (um valor por dependente) — trocar o comportamento de propostas já
-- salvas seria mudar preço sem ninguém pedir.
alter table empresarial.lead_qualification
  add column if not exists dependent_mode varchar(16),
  add column if not exists dependent_family_fee_cents bigint,
  add column if not exists dependent_family_extra_fee_cents bigint,
  add column if not exists dependent_family_size int,
  add column if not exists holders_with_dependents int;

comment on column empresarial.lead_qualification.dependent_mode is
  'PER_DEPENDENT (um valor por dependente) ou FAMILY_PACKAGE (individual, '
  'pacote familiar até N, e extra acima disso). NULO = por dependente.';
comment on column empresarial.lead_qualification.dependent_family_size is
  'Quantos dependentes o pacote familiar cobre. O motor de cobrança usa 3 '
  'desde a 0097; aqui a negociação pode combinar outro número.';
comment on column empresarial.lead_qualification.holders_with_dependents is
  'Quantos TITULARES terão dependentes. Só serve à estimativa do pacote '
  'familiar — sem ele não dá para saber como os dependentes se distribuem, e '
  'a tela declara que a conta é estimativa.';

do $$
begin
  alter table empresarial.lead_qualification
    add constraint lead_qualification_dependentes
    check (
      (dependent_mode is null
       or dependent_mode in ('PER_DEPENDENT','FAMILY_PACKAGE'))
      and (dependent_family_fee_cents is null or dependent_family_fee_cents >= 0)
      and (dependent_family_extra_fee_cents is null or dependent_family_extra_fee_cents >= 0)
      -- Pacote que cobre zero dependente não é pacote.
      and (dependent_family_size is null or dependent_family_size >= 1)
      and (holders_with_dependents is null or holders_with_dependents >= 0)
    );
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 3) As faixas de preço por quantidade
-- -----------------------------------------------------------------------------
--
-- ⚠️ A FAIXA DO TOTAL VALE PARA TODOS (decisão do dono): chegou a 120 adesões,
-- as 120 custam o valor da faixa de 120. É simples de explicar ao cliente e de
-- conferir na fatura. A alternativa (progressiva, cada camada cobrando a parte
-- dela) tornaria o "valor por titular" uma média, nunca um preço de tabela.
--
-- O que a faixa significa depende da base de cobrança da proposta:
--   · por titular  → `price_cents` é a mensalidade DE CADA titular;
--   · valor fixo   → `price_cents` é a mensalidade DA EMPRESA.
-- Uma tabela serve às duas porque só uma base vale por proposta.
--
-- NENHUMA FAIXA É O CASO NORMAL: sem linha aqui, valem os valores combinados
-- na proposta, como sempre foi. Era o "poder assinalar também sem regras de
-- quantidade" do pedido.
create table if not exists empresarial.lead_price_tiers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references empresarial.commercial_leads (id) on delete cascade,
  -- A partir de quantas adesões esta faixa passa a valer.
  min_quantity int not null check (min_quantity >= 1),
  price_cents bigint not null check (price_cents >= 0),
  created_at timestamptz not null default now(),
  -- Duas faixas começando na mesma quantidade dariam dois preços para a mesma
  -- conta, e a resposta dependeria da ordem da consulta.
  unique (lead_id, min_quantity)
);
create index if not exists lead_price_tiers_lead_idx
  on empresarial.lead_price_tiers (lead_id, min_quantity);

alter table empresarial.lead_price_tiers enable row level security;

drop policy if exists lead_price_tiers_all on empresarial.lead_price_tiers;
create policy lead_price_tiers_all
  on empresarial.lead_price_tiers
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete on empresarial.lead_price_tiers to authenticated;
grant all on empresarial.lead_price_tiers to service_role;
