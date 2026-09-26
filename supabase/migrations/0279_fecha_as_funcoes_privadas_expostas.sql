-- =============================================================================
-- 0279 — AS 17 FUNÇÕES "PRIVADAS" DEIXAM DE RESPONDER PELA API (AP15)
-- -----------------------------------------------------------------------------
-- O projeto inteiro usou `revoke all on function ... from public` achando que
-- deixava a função privada. No Supabase NÃO deixa: o padrão do banco
-- (`pg_default_acl`) dá EXECUTE de toda função nova, PELO NOME, a `anon`,
-- `authenticated` e `service_role`, e tirar de `public` não tira de quem
-- recebeu pelo nome.
--
-- Provado na produção em 26/09/2026, pela API, com a chave pública e SEM
-- LOGIN (só leitura, id inexistente): `cash_flow_series_raw` EXECUTOU — com o
-- id de uma unidade real, devolveria o fluxo de caixa dela.
--
-- ⚠️ POR QUE FECHAR NÃO QUEBRA NADA (conferido no banco e no código antes):
-- nenhuma destas 17 é chamada pelo app (rpc), por política de segurança, por
-- view ou por função INVOKER. Quem as chama são funções `security definer`
-- (rodam como `postgres`, que continua podendo) e a rotina agendada
-- `risarte-training-deadlines` (também `postgres`). Fechar tira só a porta da
-- rua; as portas de dentro continuam iguais.
--
-- `restore_training_access` recebeu `grant ... to authenticated` de propósito
-- na 0274, sem guarda ("a guarda está em quem as expõe") — mas expor a função
-- É expor. Só `close_training_campaign` a chama, por dentro.
--
-- A Regra 7 do `check-migrations` impede migração nova de repetir o erro.
--
-- Idempotente.
-- =============================================================================

-- Financeiro (0230, 0233): contas sem guarda e alertas.
revoke execute on function public.cash_flow_series_raw(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.breakeven_lines_raw(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function public.cash_first_negative(uuid, integer) from public, anon, authenticated;
revoke execute on function public.raise_finance_alert(uuid, text, text, text, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.clear_finance_alert(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.refresh_network_fee_payable(uuid, text, date) from public, anon, authenticated;

-- Compras (0241).
revoke execute on function public.materialize_round_allocations(uuid) from public, anon, authenticated;

-- Reciclagem (0274): suspender, restaurar e aplicar prazos.
revoke execute on function public.suspend_training_access(uuid) from public, anon, authenticated;
revoke execute on function public.restore_training_access(uuid) from public, anon, authenticated;
revoke execute on function public.apply_training_deadlines() from public, anon, authenticated;

-- Comercial e venda direta (0153–0158): peças internas do funil.
revoke execute on function public.commercial_can_manage(uuid) from public, anon, authenticated;
revoke execute on function public.commercial_is_team(uuid) from public, anon, authenticated;
revoke execute on function public.commercial_is_unit(uuid) from public, anon, authenticated;
revoke execute on function public.commercial_can_close(uuid) from public, anon, authenticated;
revoke execute on function public.direct_sale_can_close(uuid) from public, anon, authenticated;
revoke execute on function public.commercial_ensure_card(uuid) from public, anon, authenticated;
revoke execute on function public.commercial_log_card_event(uuid, uuid, uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
