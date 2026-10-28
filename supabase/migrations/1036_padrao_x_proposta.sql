-- =============================================================================
-- 1036 — PADRÃO × PROPOSTA NO DOCUMENTO
-- -----------------------------------------------------------------------------
-- Pedido do dono (28/10/2026): "caso a proposta for diferente do padrão,
-- ficar mais barato, deve aparecer o quanto a empresa estará economizando com
-- esta proposta. Mostrar o padrão e o que estamos propondo. deve ter a opção
-- de escolher se na proposta mostrar o padrão vs proposta".
--
-- A conta não precisa de banco: o padrão é o preço da rede (adhesion_pricing
-- com company_id nulo) e a proposta já está gravada. O que precisa morar aqui
-- é a ESCOLHA do consultor — mostrar ou não a comparação no documento.
--
-- Nasce marcada (decisão do plano aprovado): a proposta mais barata que o
-- padrão é argumento de venda. Mesmo marcada, o documento só mostra quando a
-- proposta sai mais barata.
--
-- Só acrescenta. Não apaga nada. Idempotente.
-- =============================================================================

alter table empresarial.lead_qualification
  add column if not exists show_standard_comparison boolean not null default true;

comment on column empresarial.lead_qualification.show_standard_comparison is
  'Mostrar no documento da proposta o preço padrão da rede ao lado do '
  'proposto, com a economia (1036). Só aparece quando a proposta sai mais '
  'barata que o padrão.';
