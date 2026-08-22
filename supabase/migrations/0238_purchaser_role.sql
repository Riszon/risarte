-- =============================================================================
-- 0238 — Compras (passo 1): papel "Comprador da Franqueadora"
-- -----------------------------------------------------------------------------
-- Decisão do dono (retomada do plano congelado, docs/COMPRAS.md): papel NOVO, em
-- vez de o Financeiro da Franqueadora acumular. **Quem compra não é quem paga** —
-- a mesma pessoa escolhendo o fornecedor e liberando o pagamento é a porta
-- aberta clássica, e separá-las é controle interno básico.
--
-- POR QUE UMA MIGRAÇÃO SÓ PARA ISTO: o Postgres não deixa ADICIONAR um valor de
-- enum e USAR esse mesmo valor na MESMA transação. A 0239 usa 'purchaser' nas
-- policies, então precisa que este valor já esteja COMMITADO. Mesmo motivo da
-- 0184 (Financeiro da Franqueadora) e da 0096 (Empresarial).
--
-- ORDEM: rodar esta ANTES da 0239.
-- Idempotente ("if not exists").
-- =============================================================================

alter type public.user_role add value if not exists 'purchaser';

comment on type public.user_role is
  'Papéis por clínica. finance_franchisor = Financeiro da Franqueadora (FIN0); '
  'purchaser = Comprador da Franqueadora (Compras C1) — negocia com fornecedor, '
  'e de propósito NÃO é quem paga.';
