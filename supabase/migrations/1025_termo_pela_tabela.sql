-- =============================================================================
-- 1025 — O TERMO DA EMPRESA POR TITULAR CONGELA O "ANTES" (AP19)
-- -----------------------------------------------------------------------------
-- Decisão do dono (27/09/2026): na empresa POR TITULAR, quem passa do
-- contratado paga o PREÇO DA TABELA da empresa, com a faixa — o termo e o
-- boleto dão o mesmo número. Antes, o termo congelava um "preço do excedente"
-- próprio, e a mensalidade somava todo mundo pela tabela: o documento assinado
-- dizia um valor e o boleto cobrava outro.
--
-- Com a faixa, incluir gente pode mudar o preço de TODOS os titulares (a faixa
-- vale para o total). Então o termo mostra "de R$ X para R$ Y", e para isso
-- precisa guardar o ANTES: quantos titulares o contrato cobria e por quanto
-- cada um. Sem congelar, o documento seria recalculado com a tabela de hoje e
-- deixaria de ser o que a empresa aceitou.
--
-- Nulas nos termos antigos e nos de valor fixo: é por elas que a tela sabe que
-- o termo é "pela tabela".
--
-- Idempotente. Não apaga nada.
-- =============================================================================

alter table empresarial.company_inclusion_terms
  add column if not exists base_holders int,
  add column if not exists base_holder_fee_cents bigint;

alter table empresarial.company_inclusion_terms
  drop constraint if exists company_inclusion_terms_base_check;
alter table empresarial.company_inclusion_terms
  add constraint company_inclusion_terms_base_check
  check (
    (base_holders is null and base_holder_fee_cents is null)
    or (base_holders >= 0 and base_holder_fee_cents >= 0)
  );

comment on column empresarial.company_inclusion_terms.base_holders is
  'Termo de empresa POR TITULAR: quantos titulares o contrato cobria antes desta inclusão (1025). Nulo = termo de valor fixo ou anterior à regra.';
comment on column empresarial.company_inclusion_terms.base_holder_fee_cents is
  'Termo de empresa POR TITULAR: o preço de cada titular ANTES da inclusão, com a faixa daquele tamanho (1025).';

notify pgrst, 'reload schema';
