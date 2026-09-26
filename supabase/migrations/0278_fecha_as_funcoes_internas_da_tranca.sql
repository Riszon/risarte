-- =============================================================================
-- 0278 — AS FUNÇÕES INTERNAS DA TRANCA DEIXAM DE RESPONDER PELA API
-- -----------------------------------------------------------------------------
-- A 0277 escreveu `revoke all ... from public` achando que isso deixava as três
-- funções internas privadas. NÃO DEIXA, no Supabase: o banco tem um padrão
-- (`pg_default_acl`) que dá EXECUTE de toda função nova, NOMINALMENTE, a
-- `anon`, `authenticated` e `service_role`. Tirar de `public` não tira de quem
-- recebeu pelo nome.
--
-- Provado na produção em 26/09/2026, pela API, com a chave pública e SEM
-- LOGIN: `_system_access_raw` executou. Ela não tem guarda (é interna) e diria
-- a qualquer pessoa na internet, para qualquer usuário, em quais unidades ele
-- trabalha e por que está liberado ou não.
--
-- A régua que pegou foi a conferência da própria 0277 ("a regra sem guarda NÃO
-- está exposta à API") — por isso ela existe.
--
-- As mesmas funções continuam funcionando por dentro: quem as chama é a porta
-- com guarda (`system_access_by_clinic`) e os gatilhos, que rodam como donos.
--
-- ⚠️ O MESMO DEFEITO EM 16 FUNÇÕES ANTIGAS (financeiro, comercial, compras,
-- reciclagem) está no BACKLOG como AP15 — fora desta migração de propósito.
--
-- Idempotente.
-- =============================================================================

revoke execute on function public._system_access_raw(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_system_closed(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_system_closed_all() from public, anon, authenticated;

-- Os gatilhos também não são para a API (o Postgres recusaria a chamada direta
-- de qualquer jeito, mas não há por que listá-los como executáveis).
revoke execute on function public.trg_refresh_system_closed_user() from public, anon, authenticated;
revoke execute on function public.trg_refresh_system_closed_profile() from public, anon, authenticated;
revoke execute on function public.trg_refresh_system_closed_all() from public, anon, authenticated;

notify pgrst, 'reload schema';
