-- =============================================================================
-- 0297 — AS FUNÇÕES DO FINANCEIRO DEIXAM DE EXECUTAR SEM LOGIN (AP16)
--
-- Próximo módulo da triagem do AP16 (o Comercial foi na 0295). Medido no
-- treino em 15/10/2026: 66 funções do Financeiro executavam para quem NÃO está
-- logado. Saem 60; ficam 6, que as REGRAS DE SEGURANÇA das tabelas chamam
-- (fechá-las faria consulta legítima falhar com "permission denied").
--
-- 🔴 DUAS ERAM BRECHA DE VERDADE, porque a guarda delas é "se HÁ usuário e ele
-- não pode, recusa" — sem login não há usuário, e a guarda deixa passar
-- (o desenho existe para a rotina agendada, que roda sem usuário):
--   - charge_fixed_network_fees: GERA as cobranças das taxas fixas da rede;
--   - cash_balance_before: devolve o saldo de caixa de qualquer unidade.
-- A rotina agendada roda como dono do banco e continua funcionando.
--
-- Nenhuma função muda de comportamento para quem está logado. Nada apaga.
-- Idempotente.
-- =============================================================================

revoke execute on function public.apply_acquirer_fee(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.apply_acquirer_fee(uuid, uuid, text, integer) to authenticated;

revoke execute on function public.approve_payable(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.approve_payable(uuid, boolean, text) to authenticated;

revoke execute on function public.assets_overview(uuid) from public, anon, authenticated;
grant execute on function public.assets_overview(uuid) to authenticated;

revoke execute on function public.breakeven_lines(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.breakeven_lines(uuid, date, date, uuid) to authenticated;

revoke execute on function public.brl(bigint) from public, anon, authenticated;
grant execute on function public.brl(bigint) to authenticated;

revoke execute on function public.budget_sign(text) from public, anon, authenticated;
grant execute on function public.budget_sign(text) to authenticated;

revoke execute on function public.budget_vs_actual(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.budget_vs_actual(uuid, integer, integer) to authenticated;

revoke execute on function public.cancel_payable(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_payable(uuid, text) to authenticated;

revoke execute on function public.card_modality_of(text, integer) from public, anon, authenticated;
grant execute on function public.card_modality_of(text, integer) to authenticated;

revoke execute on function public.cash_balance_before(uuid, date) from public, anon, authenticated;
grant execute on function public.cash_balance_before(uuid, date) to authenticated;

revoke execute on function public.cash_flow_detail(uuid, date, date) from public, anon, authenticated;
grant execute on function public.cash_flow_detail(uuid, date, date) to authenticated;

revoke execute on function public.cash_flow_series(uuid, date, date) from public, anon, authenticated;
grant execute on function public.cash_flow_series(uuid, date, date) to authenticated;

revoke execute on function public.cash_overdue(uuid) from public, anon, authenticated;
grant execute on function public.cash_overdue(uuid) to authenticated;

revoke execute on function public.charge_fixed_network_fees(integer, integer) from public, anon, authenticated;
grant execute on function public.charge_fixed_network_fees(integer, integer) to authenticated;

revoke execute on function public.check_finance_alerts(uuid) from public, anon, authenticated;
grant execute on function public.check_finance_alerts(uuid) to authenticated;

revoke execute on function public.clinic_overdue_rate(uuid) from public, anon, authenticated;
grant execute on function public.clinic_overdue_rate(uuid) to authenticated;

revoke execute on function public.close_fiscal_period(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.close_fiscal_period(uuid, integer, integer) to authenticated;

revoke execute on function public.close_payout_month(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.close_payout_month(uuid, date, numeric) to authenticated;

revoke execute on function public.consolidated_by_clinic(date, date, text, text) from public, anon, authenticated;
grant execute on function public.consolidated_by_clinic(date, date, text, text) to authenticated;

revoke execute on function public.consolidated_dre(date, date, text) from public, anon, authenticated;
grant execute on function public.consolidated_dre(date, date, text) to authenticated;

revoke execute on function public.copy_budget_year(uuid, integer, integer, numeric, boolean) from public, anon, authenticated;
grant execute on function public.copy_budget_year(uuid, integer, integer, numeric, boolean) to authenticated;

revoke execute on function public.create_entry_from_bank_transaction(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_entry_from_bank_transaction(uuid, text, uuid, text) to authenticated;

revoke execute on function public.delete_bank_import(uuid) from public, anon, authenticated;
grant execute on function public.delete_bank_import(uuid) to authenticated;

revoke execute on function public.delete_network_fee_type(text) from public, anon, authenticated;
grant execute on function public.delete_network_fee_type(text) to authenticated;

revoke execute on function public.depreciate_month(uuid, date) from public, anon, authenticated;
grant execute on function public.depreciate_month(uuid, date) to authenticated;

revoke execute on function public.dispose_asset(uuid, date, text) from public, anon, authenticated;
grant execute on function public.dispose_asset(uuid, date, text) to authenticated;

revoke execute on function public.dre_entries(uuid, date, date, text, uuid) from public, anon, authenticated;
grant execute on function public.dre_entries(uuid, date, date, text, uuid) to authenticated;

revoke execute on function public.dre_lines(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.dre_lines(uuid, date, date, uuid) to authenticated;

revoke execute on function public.fill_budget_from_actual(uuid, integer, integer, numeric, boolean) from public, anon, authenticated;
grant execute on function public.fill_budget_from_actual(uuid, integer, integer, numeric, boolean) to authenticated;

revoke execute on function public.fiscal_period_checklist(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.fiscal_period_checklist(uuid, integer, integer) to authenticated;

revoke execute on function public.fiscal_year_status(uuid, integer) from public, anon, authenticated;
grant execute on function public.fiscal_year_status(uuid, integer) to authenticated;

revoke execute on function public.generate_recurring_payables(uuid, date) from public, anon, authenticated;
grant execute on function public.generate_recurring_payables(uuid, date) to authenticated;

revoke execute on function public.ignore_bank_transaction(uuid, text) from public, anon, authenticated;
grant execute on function public.ignore_bank_transaction(uuid, text) to authenticated;

revoke execute on function public.import_bank_transactions(uuid, text, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.import_bank_transactions(uuid, text, text, jsonb, text, boolean) to authenticated;

revoke execute on function public.is_period_closed(uuid, date) from public, anon, authenticated;
grant execute on function public.is_period_closed(uuid, date) to authenticated;

revoke execute on function public.mark_installment_paid(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_installment_paid(uuid, boolean) to authenticated;

revoke execute on function public.network_fee_summary(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.network_fee_summary(uuid, integer, integer) to authenticated;

revoke execute on function public.network_monthly_revenue(integer) from public, anon, authenticated;
grant execute on function public.network_monthly_revenue(integer) to authenticated;

revoke execute on function public.network_panel(integer, integer) from public, anon, authenticated;
grant execute on function public.network_panel(integer, integer) to authenticated;

revoke execute on function public.network_receivables() from public, anon, authenticated;
grant execute on function public.network_receivables() to authenticated;

revoke execute on function public.network_units_summary(date, date) from public, anon, authenticated;
grant execute on function public.network_units_summary(date, date) to authenticated;

revoke execute on function public.order_reconciliation(uuid) from public, anon, authenticated;
grant execute on function public.order_reconciliation(uuid) to authenticated;

revoke execute on function public.payable_discounts(uuid) from public, anon, authenticated;
grant execute on function public.payable_discounts(uuid) to authenticated;

revoke execute on function public.profit_cash_bridge(uuid, date, date) from public, anon, authenticated;
grant execute on function public.profit_cash_bridge(uuid, date, date) to authenticated;

revoke execute on function public.reconcile_bank_transaction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reconcile_bank_transaction(uuid, uuid) to authenticated;

revoke execute on function public.register_boleto_issue(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.register_boleto_issue(uuid, uuid, date) to authenticated;

revoke execute on function public.register_payable_payment(uuid, bigint, date, text, bigint, bigint, text, text, uuid, bigint) from public, anon, authenticated;
grant execute on function public.register_payable_payment(uuid, bigint, date, text, bigint, bigint, text, text, uuid, bigint) to authenticated;

revoke execute on function public.register_payment_receipt(uuid, bigint, date, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.register_payment_receipt(uuid, bigint, date, text, text, text, uuid) to authenticated;

revoke execute on function public.reopen_fiscal_period(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.reopen_fiscal_period(uuid, integer, integer, text) to authenticated;

revoke execute on function public.reverse_payable_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_payable_payment(uuid, text) to authenticated;

revoke execute on function public.reverse_payment_receipt(uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_payment_receipt(uuid, text) to authenticated;

revoke execute on function public.save_alert_settings(uuid, boolean, numeric, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.save_alert_settings(uuid, boolean, numeric, integer, integer, bigint) to authenticated;

revoke execute on function public.save_budget_line(uuid, integer, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.save_budget_line(uuid, integer, integer, text, bigint) to authenticated;

revoke execute on function public.save_network_fee_type(text, text, text, text, text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.save_network_fee_type(text, text, text, text, text, boolean, integer, text) to authenticated;

revoke execute on function public.save_payable(uuid, uuid, text, uuid, text, bigint, date, date, text, text, uuid) from public, anon, authenticated;
grant execute on function public.save_payable(uuid, uuid, text, uuid, text, bigint, date, date, text, text, uuid) to authenticated;

revoke execute on function public.save_payment_schedule(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_payment_schedule(uuid, uuid, jsonb) to authenticated;

revoke execute on function public.set_clinic_ownership(uuid, text) from public, anon, authenticated;
grant execute on function public.set_clinic_ownership(uuid, text) to authenticated;

revoke execute on function public.set_payout_rate_for_level(uuid, uuid, uuid, bigint, date) from public, anon, authenticated;
grant execute on function public.set_payout_rate_for_level(uuid, uuid, uuid, bigint, date) to authenticated;

revoke execute on function public.suggested_avg_acquirer_fee(uuid, integer) from public, anon, authenticated;
grant execute on function public.suggested_avg_acquirer_fee(uuid, integer) to authenticated;

revoke execute on function public.unreconcile_bank_transaction(uuid) from public, anon, authenticated;
grant execute on function public.unreconcile_bank_transaction(uuid) to authenticated;
