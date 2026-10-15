-- =============================================================================
-- 0295 — AS FUNÇÕES DO COMERCIAL DEIXAM DE EXECUTAR SEM LOGIN (AP43)
--
-- Achado conferindo a 0293 na produção (14/10/2026): commercial_set_stage
-- executava para quem NÃO estava logado — a guarda recusava (NOT_ALLOWED), mas
-- a função rodava até ela. Medido no treino em 15/10/2026: 21 funções do
-- Comercial (funil, follow-up, negociação, venda direta, renegociação) no mesmo
-- estado. Todas têm guarda; nenhuma é usada por regra de segurança (RLS), por
-- rotina agendada ou por tela pública — só por telas de quem está logado e por
-- outras funções (que rodam como dono do banco e não dependem disto).
--
-- É o caminho da 0280 (AP16): tira de quem não está logado, mantém para quem
-- está. Nenhuma função muda de comportamento. Nada apaga. Idempotente.
-- =============================================================================

revoke execute on function public.accept_negotiation(uuid) from public, anon, authenticated;
grant execute on function public.accept_negotiation(uuid) to authenticated;

revoke execute on function public.authorize_renegotiation(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.authorize_renegotiation(uuid, boolean, text) to authenticated;

revoke execute on function public.can_renegotiate(uuid) from public, anon, authenticated;
grant execute on function public.can_renegotiate(uuid) to authenticated;

revoke execute on function public.cancel_direct_sale(uuid) from public, anon, authenticated;
grant execute on function public.cancel_direct_sale(uuid) to authenticated;

revoke execute on function public.commercial_close_step(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.commercial_close_step(uuid, text, boolean) to authenticated;

revoke execute on function public.commercial_log_followup_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.commercial_log_followup_attempt(uuid, text, text, text) to authenticated;

revoke execute on function public.commercial_set_stage(uuid, text, text) from public, anon, authenticated;
grant execute on function public.commercial_set_stage(uuid, text, text) to authenticated;

revoke execute on function public.commercial_start_followup(uuid) from public, anon, authenticated;
grant execute on function public.commercial_start_followup(uuid) to authenticated;

revoke execute on function public.commercial_transfer_followup(uuid, boolean) from public, anon, authenticated;
grant execute on function public.commercial_transfer_followup(uuid, boolean) to authenticated;

revoke execute on function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text) to authenticated;

revoke execute on function public.direct_sale_close_step(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.direct_sale_close_step(uuid, text, boolean) to authenticated;

revoke execute on function public.direct_sale_set_conditions(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.direct_sale_set_conditions(uuid, text, integer, integer, integer) to authenticated;

revoke execute on function public.evaluate_negotiation_rules(uuid, boolean) from public, anon, authenticated;
grant execute on function public.evaluate_negotiation_rules(uuid, boolean) to authenticated;

revoke execute on function public.log_presentation_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_presentation_event(uuid, text, text) to authenticated;

revoke execute on function public.notify_commercial_presentation(uuid) from public, anon, authenticated;
grant execute on function public.notify_commercial_presentation(uuid) to authenticated;

revoke execute on function public.renegotiation_close_step(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.renegotiation_close_step(uuid, text, boolean) to authenticated;

revoke execute on function public.request_commercial_scheduling(uuid) from public, anon, authenticated;
grant execute on function public.request_commercial_scheduling(uuid) to authenticated;

revoke execute on function public.request_presentation_scheduling(uuid, text) from public, anon, authenticated;
grant execute on function public.request_presentation_scheduling(uuid, text) to authenticated;

revoke execute on function public.return_commercial_to_planning(uuid, text) from public, anon, authenticated;
grant execute on function public.return_commercial_to_planning(uuid, text) to authenticated;

revoke execute on function public.review_negotiation(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_negotiation(uuid, boolean, text) to authenticated;

revoke execute on function public.save_renegotiation(uuid, uuid[], jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.save_renegotiation(uuid, uuid[], jsonb, text, numeric) to authenticated;
