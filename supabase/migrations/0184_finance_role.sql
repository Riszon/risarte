-- =============================================================================
-- 0184 — FIN0 (passo 1): papel "Financeiro da Franqueadora"
-- -----------------------------------------------------------------------------
-- Papel da Franqueadora, com escopo de unidades (como SDR/Consultor). É quem vê
-- o financeiro de todas as unidades do escopo, configura multa/juros, gerencia
-- centros de custo e faz renegociação junto com o Gerente da unidade.
--
-- Por que uma migração SÓ para isto: o Postgres não deixa ADICIONAR um valor de
-- enum e USAR esse mesmo valor na MESMA transação. A 0185 usa
-- 'finance_franchisor' nas policies e na regra de ambiente, então precisa que
-- este valor já esteja COMMITADO. Mesmo motivo da 0096/0097 (Empresarial).
--
-- ORDEM: rodar esta ANTES da 0185.
-- Idempotente ("if not exists").
-- =============================================================================

alter type public.user_role add value if not exists 'finance_franchisor';

comment on type public.user_role is
  'Papéis por clínica. finance_franchisor = Financeiro da Franqueadora (FIN0).';
