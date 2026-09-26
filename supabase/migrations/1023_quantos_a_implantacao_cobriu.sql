-- =============================================================================
-- 1023 — QUANTOS TITULARES CADA IMPLANTAÇÃO COBRIU (AP12)
-- -----------------------------------------------------------------------------
-- Regra do dono (26/09/2026): *"sempre que for acrescentado novos titulares o
-- primeiro pagamento é a implantação (...) uma empresa com 100 colaboradores
-- fez a adesão de 80 em uma primeira etapa, e uma segunda etapa dos 20
-- restantes, será cobrado a implantação nas duas vezes, proporcional à
-- quantidade."*
--
-- Cada titular paga implantação UMA vez. Para a segunda etapa cobrar só os 20
-- novos, o sistema precisa saber que a primeira cobriu 80 — e isso não estava
-- guardado em lugar nenhum. A conta começava do zero, e os 80 pagavam de novo.
--
-- A coluna é preenchida pelo sistema ao GERAR a implantação, com a quantidade
-- que ela cobrou. A próxima cobra: base de hoje − soma do que as implantações
-- VIVAS já cobriram (canceladas não contam: foram desfeitas).
--
-- ⚠️ IMPLANTAÇÃO ANTIGA FICA NULA — de propósito. Não há como saber quantos
-- titulares uma implantação gerada antes desta migração cobriu, e qualquer
-- número posto aqui seria palpite com cara de dado. Nulo quer dizer "não sei",
-- e a tela avisa quando encontra uma. Na produção, em 26/09/2026, não havia
-- cobrança nenhuma — então isso só acontece no banco de treino.
--
-- Mensalidade não usa esta coluna (fica nula).
--
-- Idempotente. Não apaga nem altera nenhuma cobrança.
-- =============================================================================

alter table empresarial.adhesion_billing
  add column if not exists holders_covered integer;

alter table empresarial.adhesion_billing
  drop constraint if exists adhesion_billing_holders_covered_check;
alter table empresarial.adhesion_billing
  add constraint adhesion_billing_holders_covered_check
  check (holders_covered is null or holders_covered >= 0);

comment on column empresarial.adhesion_billing.holders_covered is
  'Implantação: quantos titulares ela cobriu. A próxima cobra só a diferença (AP12, 1023). Nulo = gerada antes da 1023, sem registro.';
