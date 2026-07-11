-- =============================================================================
-- 0096 — Módulo Risarte Empresarial (Fase 0, passo 1): papel novo
-- -----------------------------------------------------------------------------
-- Consultor Comercial Empresarial (RisLife). É um papel da Franqueadora, com
-- escopo de unidades (como SDR/Consultor comum). Vive no cardápio de papéis
-- (enum public.user_role).
--
-- Por que uma migração SÓ para isto: o Postgres não deixa ADICIONAR um valor de
-- enum e USAR esse mesmo valor na MESMA transação. A 0097 (que já usa
-- 'rislife_consultant' na regra de ambiente) precisa que este valor já esteja
-- COMMITADO antes. Por isso o dono aplica a 0096 primeiro e a 0097 depois.
-- Idempotente: "if not exists".
-- =============================================================================

alter type public.user_role add value if not exists 'rislife_consultant';
