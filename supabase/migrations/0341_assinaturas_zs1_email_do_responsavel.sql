-- =============================================================================
-- 0341 — ASSINATURA DIGITAL (ZS1): e-mail do responsável legal
-- -----------------------------------------------------------------------------
-- Plano ZS0 §6 ("Colunas novas fora do módulo"). Quando o paciente é menor de
-- idade, quem assina é o responsável legal (`client_guardians`), e a ZapSign
-- precisa de telefone OU e-mail para entregar o link e o código de
-- autenticação. A tabela só tinha telefone. O campo na tela de cadastro do
-- responsável entra com o fluxo de envio (ZS2).
--
-- Idempotente. Não apaga dado.
-- =============================================================================

alter table public.client_guardians
  add column if not exists email text;

comment on column public.client_guardians.email is
  'ZS1 (0341): e-mail do responsável legal, para a assinatura digital quando o paciente é menor.';

-- Conferência
select count(*) as coluna_email
  from information_schema.columns
 where table_schema = 'public' and table_name = 'client_guardians' and column_name = 'email';
