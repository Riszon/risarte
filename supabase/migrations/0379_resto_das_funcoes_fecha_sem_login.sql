-- =============================================================================
-- 0379 — O RESTO DAS FUNÇÕES DEIXA DE EXECUTAR SEM LOGIN (AP16, 10/11/2026)
--
-- Fecha a triagem do AP16 (Comercial na 0295, Financeiro na 0297): Estoque e
-- Compras, Agenda e Clínico, Chat, Ocorrências, Treinamento e Empresarial.
--
-- MEDIDO NO TREINO em 10/11/2026: 159 funções (fora gatilhos) ainda executavam
-- para quem NÃO está logado. Saem 118. Ficam 41, de propósito:
--   • 32 que as REGRAS DE SEGURANÇA das tabelas (ou um valor padrão de coluna)
--     chamam — fechá-las faria consulta legítima falhar com "permission
--     denied" em vez de devolver vazio;
--   • 9 ajudantes puros (formatar CPF, somar dia útil, dizer se o banco é o
--     espelho): não leem dado de negócio, e gatilhos de outros papéis do
--     banco podem chamá-los.
--
-- ⚠️ NENHUMA das 118 é chamada antes do login: o que o riSZon chama sem
-- sessão (`access_session_check`, `access_session_end`) já estava fechado
-- para anon e continua como está. Conferido no código: fora de `(app)` só
-- esses dois `rpc` existem.
--
-- Receita da 0297: `revoke ... from public, anon, authenticated` e
-- `grant ... to authenticated` (e à chave de serviço, que já tinha). Para
-- quem está LOGADO nada muda. Nada apaga. Idempotente.
--
-- Gerada a partir do catálogo do banco (assinaturas exatas), não de memória.
-- =============================================================================

revoke execute on function public.add_planning_supplement(uuid, text) from public, anon, authenticated;
grant execute on function public.add_planning_supplement(uuid, text) to authenticated, service_role;

revoke execute on function public.add_system_report_attachment(uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.add_system_report_attachment(uuid, uuid, text, text, text, bigint, text) to authenticated, service_role;

revoke execute on function public.add_system_report_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.add_system_report_comment(uuid, text) to authenticated, service_role;

revoke execute on function public.answer_decision(uuid, decision_answer) from public, anon, authenticated;
grant execute on function public.answer_decision(uuid, decision_answer) to authenticated, service_role;

revoke execute on function public.apply_stock_count(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_stock_count(uuid, text) to authenticated, service_role;

revoke execute on function public.apply_stock_movement(uuid, uuid, text, numeric, numeric, date, text, text, uuid, numeric, bigint, text, date, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_stock_movement(uuid, uuid, text, numeric, numeric, date, text, text, uuid, numeric, bigint, text, date, uuid, text) to authenticated, service_role;

revoke execute on function public.award_round_item(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.award_round_item(uuid, uuid, numeric, text) to authenticated, service_role;

revoke execute on function public.can_consume_stock(uuid) from public, anon, authenticated;
grant execute on function public.can_consume_stock(uuid) to authenticated, service_role;

revoke execute on function public.can_receive_payment(uuid) from public, anon, authenticated;
grant execute on function public.can_receive_payment(uuid) to authenticated, service_role;

revoke execute on function public.chat_can_dm(uuid) from public, anon, authenticated;
grant execute on function public.chat_can_dm(uuid) to authenticated, service_role;

revoke execute on function public.chat_contacts() from public, anon, authenticated;
grant execute on function public.chat_contacts() to authenticated, service_role;

revoke execute on function public.chat_important_unread() from public, anon, authenticated;
grant execute on function public.chat_important_unread() to authenticated, service_role;

revoke execute on function public.chat_important_unread_total() from public, anon, authenticated;
grant execute on function public.chat_important_unread_total() to authenticated, service_role;

revoke execute on function public.chat_my_channel_ids() from public, anon, authenticated;
grant execute on function public.chat_my_channel_ids() to authenticated, service_role;

revoke execute on function public.chat_unread_total() from public, anon, authenticated;
grant execute on function public.chat_unread_total() to authenticated, service_role;

revoke execute on function public.check_in_appointment(uuid) from public, anon, authenticated;
grant execute on function public.check_in_appointment(uuid) to authenticated, service_role;

revoke execute on function public.close_training_campaign(uuid) from public, anon, authenticated;
grant execute on function public.close_training_campaign(uuid) to authenticated, service_role;

revoke execute on function public.create_agenda_closure(uuid, timestamp with time zone, timestamp with time zone, agenda_closure_reason, text, text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.create_agenda_closure(uuid, timestamp with time zone, timestamp with time zone, agenda_closure_reason, text, text, uuid[], uuid[]) to authenticated, service_role;

revoke execute on function public.create_clinical_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_clinical_request(uuid, text, text) to authenticated, service_role;

revoke execute on function public.create_network_plan_item(plan_item_type, date, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_network_plan_item(plan_item_type, date, date, text, text, boolean) to authenticated, service_role;

revoke execute on function public.create_plan_item(uuid, plan_item_type, date, date, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.create_plan_item(uuid, plan_item_type, date, date, text, text, uuid[]) to authenticated, service_role;

revoke execute on function public.decide_holiday(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.decide_holiday(uuid, date, boolean) to authenticated, service_role;

revoke execute on function public.delete_agenda_closure(uuid) from public, anon, authenticated;
grant execute on function public.delete_agenda_closure(uuid) to authenticated, service_role;

revoke execute on function public.delete_network_plan_item(uuid) from public, anon, authenticated;
grant execute on function public.delete_network_plan_item(uuid) to authenticated, service_role;

revoke execute on function public.delete_plan_item(uuid) from public, anon, authenticated;
grant execute on function public.delete_plan_item(uuid) to authenticated, service_role;

revoke execute on function public.delete_specialty(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_specialty(uuid, text) to authenticated, service_role;

revoke execute on function public.delete_stock_item(uuid) from public, anon, authenticated;
grant execute on function public.delete_stock_item(uuid) to authenticated, service_role;

revoke execute on function public.discard_plan_cancellation(uuid) from public, anon, authenticated;
grant execute on function public.discard_plan_cancellation(uuid) to authenticated, service_role;

revoke execute on function public.discard_stock_count(uuid) from public, anon, authenticated;
grant execute on function public.discard_stock_count(uuid) to authenticated, service_role;

revoke execute on function public.empresarial_client_family(uuid) from public, anon, authenticated;
grant execute on function public.empresarial_client_family(uuid) to authenticated, service_role;

revoke execute on function public.end_client_share(uuid) from public, anon, authenticated;
grant execute on function public.end_client_share(uuid) to authenticated, service_role;

revoke execute on function public.ensure_direct_chat_channel(uuid) from public, anon, authenticated;
grant execute on function public.ensure_direct_chat_channel(uuid) to authenticated, service_role;

revoke execute on function public.ensure_unit_chat_channel(uuid) from public, anon, authenticated;
grant execute on function public.ensure_unit_chat_channel(uuid) to authenticated, service_role;

revoke execute on function public.grant_clinic_access(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.grant_clinic_access(uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.link_appointment_sessions(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.link_appointment_sessions(uuid, uuid[]) to authenticated, service_role;

revoke execute on function public.link_supplier_item(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.link_supplier_item(text, text, uuid, text, text) to authenticated, service_role;

revoke execute on function public.log_plan_edited_event(uuid) from public, anon, authenticated;
grant execute on function public.log_plan_edited_event(uuid) to authenticated, service_role;

revoke execute on function public.log_plan_event(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_plan_event(uuid, uuid, text, text, uuid) to authenticated, service_role;

revoke execute on function public.lookup_risartano_by_cpf(text) from public, anon, authenticated;
grant execute on function public.lookup_risartano_by_cpf(text) to authenticated, service_role;

revoke execute on function public.mark_planning_supplements_seen(uuid) from public, anon, authenticated;
grant execute on function public.mark_planning_supplements_seen(uuid) to authenticated, service_role;

revoke execute on function public.mark_system_report_seen(uuid) from public, anon, authenticated;
grant execute on function public.mark_system_report_seen(uuid) to authenticated, service_role;

revoke execute on function public.mark_system_reports_seen() from public, anon, authenticated;
grant execute on function public.mark_system_reports_seen() to authenticated, service_role;

revoke execute on function public.move_client_phase(uuid, journey_phase) from public, anon, authenticated;
grant execute on function public.move_client_phase(uuid, journey_phase) to authenticated, service_role;

revoke execute on function public.notify_appointment_overrun(uuid) from public, anon, authenticated;
grant execute on function public.notify_appointment_overrun(uuid) to authenticated, service_role;

revoke execute on function public.notify_appointment_participants(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.notify_appointment_participants(uuid, uuid[]) to authenticated, service_role;

revoke execute on function public.notify_attendance_alerts(uuid) from public, anon, authenticated;
grant execute on function public.notify_attendance_alerts(uuid) to authenticated, service_role;

revoke execute on function public.notify_birthday_clients(uuid, date[], date) from public, anon, authenticated;
grant execute on function public.notify_birthday_clients(uuid, date[], date) to authenticated, service_role;

revoke execute on function public.notify_insistent_requests(uuid) from public, anon, authenticated;
grant execute on function public.notify_insistent_requests(uuid) to authenticated, service_role;

revoke execute on function public.notify_pending_holidays(uuid, date[], text[]) from public, anon, authenticated;
grant execute on function public.notify_pending_holidays(uuid, date[], text[]) to authenticated, service_role;

revoke execute on function public.notify_treatment_alerts(uuid) from public, anon, authenticated;
grant execute on function public.notify_treatment_alerts(uuid) to authenticated, service_role;

revoke execute on function public.notify_weekly_forecast() from public, anon, authenticated;
grant execute on function public.notify_weekly_forecast() to authenticated, service_role;

revoke execute on function public.open_new_evaluation(uuid, uuid, clinical_evaluation_kind, text) from public, anon, authenticated;
grant execute on function public.open_new_evaluation(uuid, uuid, clinical_evaluation_kind, text) to authenticated, service_role;

revoke execute on function public.open_purchase_round(uuid[], text) from public, anon, authenticated;
grant execute on function public.open_purchase_round(uuid[], text) to authenticated, service_role;

revoke execute on function public.open_special_days(uuid, date[], time without time zone, time without time zone, uuid[], text) from public, anon, authenticated;
grant execute on function public.open_special_days(uuid, date[], time without time zone, time without time zone, uuid[], text) to authenticated, service_role;

revoke execute on function public.open_stock_count(uuid, boolean) from public, anon, authenticated;
grant execute on function public.open_stock_count(uuid, boolean) to authenticated, service_role;

revoke execute on function public.open_stock_package(uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.open_stock_package(uuid, uuid, integer, boolean) to authenticated, service_role;

revoke execute on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean) from public, anon, authenticated;
grant execute on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean) to authenticated, service_role;

revoke execute on function public.order_pending_items(uuid) from public, anon, authenticated;
grant execute on function public.order_pending_items(uuid) to authenticated, service_role;

revoke execute on function public.post_stock_movement(uuid, uuid, text, numeric, numeric, date, text, text, uuid, numeric, bigint, text, date, uuid, text) from public, anon, authenticated;
grant execute on function public.post_stock_movement(uuid, uuid, text, numeric, numeric, date, text, text, uuid, numeric, bigint, text, date, uuid, text) to authenticated, service_role;

revoke execute on function public.ppr_generate_charges(date, uuid) from public, anon, authenticated;
grant execute on function public.ppr_generate_charges(date, uuid) to authenticated, service_role;

revoke execute on function public.ppr_mark_charge_paid(uuid, boolean) from public, anon, authenticated;
grant execute on function public.ppr_mark_charge_paid(uuid, boolean) to authenticated, service_role;

revoke execute on function public.procedure_real_stats(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.procedure_real_stats(uuid, uuid[]) to authenticated, service_role;

revoke execute on function public.provider_cross_unit_check(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.provider_cross_unit_check(uuid, uuid, date) to authenticated, service_role;

revoke execute on function public.provider_multi_unit_agenda(timestamp with time zone, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.provider_multi_unit_agenda(timestamp with time zone, timestamp with time zone) to authenticated, service_role;

revoke execute on function public.provider_procedure_minutes(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.provider_procedure_minutes(uuid, uuid[]) to authenticated, service_role;

revoke execute on function public.purchase_leakage(date, date, uuid) from public, anon, authenticated;
grant execute on function public.purchase_leakage(date, date, uuid) to authenticated, service_role;

revoke execute on function public.purchase_savings(date, date, uuid) from public, anon, authenticated;
grant execute on function public.purchase_savings(date, date, uuid) to authenticated, service_role;

revoke execute on function public.purchase_suppliers(date, date, uuid) from public, anon, authenticated;
grant execute on function public.purchase_suppliers(date, date, uuid) to authenticated, service_role;

revoke execute on function public.purchase_top_items(date, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.purchase_top_items(date, date, uuid, integer) to authenticated, service_role;

revoke execute on function public.receive_purchase_order(uuid, text, date, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.receive_purchase_order(uuid, text, date, jsonb, jsonb, text) to authenticated, service_role;

revoke execute on function public.register_stock_purchase(uuid, uuid, text, date, jsonb, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.register_stock_purchase(uuid, uuid, text, date, jsonb, jsonb, uuid, text, text, text) to authenticated, service_role;

revoke execute on function public.remove_special_day(uuid) from public, anon, authenticated;
grant execute on function public.remove_special_day(uuid) to authenticated, service_role;

revoke execute on function public.remove_system_report_attachment(uuid) from public, anon, authenticated;
grant execute on function public.remove_system_report_attachment(uuid) to authenticated, service_role;

revoke execute on function public.rename_specialty(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_specialty(uuid, text) to authenticated, service_role;

revoke execute on function public.reopen_system_report(uuid, text) from public, anon, authenticated;
grant execute on function public.reopen_system_report(uuid, text) to authenticated, service_role;

revoke execute on function public.request_item_scheduling(uuid) from public, anon, authenticated;
grant execute on function public.request_item_scheduling(uuid) to authenticated, service_role;

revoke execute on function public.request_quality_scheduling(uuid) from public, anon, authenticated;
grant execute on function public.request_quality_scheduling(uuid) to authenticated, service_role;

revoke execute on function public.request_session_scheduling(uuid) from public, anon, authenticated;
grant execute on function public.request_session_scheduling(uuid) to authenticated, service_role;

revoke execute on function public.resolve_clinical_request(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_clinical_request(uuid, text) to authenticated, service_role;

revoke execute on function public.revoke_clinic_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_clinic_access(uuid, uuid) to authenticated, service_role;

revoke execute on function public.round_allocation(uuid) from public, anon, authenticated;
grant execute on function public.round_allocation(uuid) to authenticated, service_role;

revoke execute on function public.round_items_view(uuid) from public, anon, authenticated;
grant execute on function public.round_items_view(uuid) to authenticated, service_role;

revoke execute on function public.round_pending_approvals(uuid) from public, anon, authenticated;
grant execute on function public.round_pending_approvals(uuid) to authenticated, service_role;

revoke execute on function public.save_purchase_quote(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.save_purchase_quote(uuid, uuid, integer, text, text) to authenticated, service_role;

revoke execute on function public.save_quote_price(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.save_quote_price(uuid, uuid, bigint) to authenticated, service_role;

revoke execute on function public.save_stock_item(uuid, text, text, text, text, numeric, text, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_stock_item(uuid, text, text, text, text, numeric, text, text, boolean, boolean, boolean) to authenticated, service_role;

revoke execute on function public.save_stock_kit(uuid, uuid, text, text, jsonb, uuid[], boolean, text) from public, anon, authenticated;
grant execute on function public.save_stock_kit(uuid, uuid, text, text, jsonb, uuid[], boolean, text) to authenticated, service_role;

revoke execute on function public.save_training_requirements(user_role, jsonb) from public, anon, authenticated;
grant execute on function public.save_training_requirements(user_role, jsonb) to authenticated, service_role;

revoke execute on function public.save_training_settings(text, text) from public, anon, authenticated;
grant execute on function public.save_training_settings(text, text) to authenticated, service_role;

revoke execute on function public.sdr_accessible_client_ids() from public, anon, authenticated;
grant execute on function public.sdr_accessible_client_ids() to authenticated, service_role;

revoke execute on function public.search_clients(text, integer) from public, anon, authenticated;
grant execute on function public.search_clients(text, integer) to authenticated, service_role;

revoke execute on function public.send_to_planning_followup(uuid) from public, anon, authenticated;
grant execute on function public.send_to_planning_followup(uuid) to authenticated, service_role;

revoke execute on function public.set_appointment_participants(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_appointment_participants(uuid, uuid[]) to authenticated, service_role;

revoke execute on function public.set_environment_url(text, text) from public, anon, authenticated;
grant execute on function public.set_environment_url(text, text) to authenticated, service_role;

revoke execute on function public.set_journey_status(uuid, journey_status) from public, anon, authenticated;
grant execute on function public.set_journey_status(uuid, journey_status) to authenticated, service_role;

revoke execute on function public.set_permission(text, user_role[]) from public, anon, authenticated;
grant execute on function public.set_permission(text, user_role[]) to authenticated, service_role;

revoke execute on function public.set_plan_item_quality(uuid, text, text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_plan_item_quality(uuid, text, text, uuid, text, uuid, text) to authenticated, service_role;

revoke execute on function public.set_plan_lifecycle(uuid, treatment_plan_lifecycle, text) from public, anon, authenticated;
grant execute on function public.set_plan_lifecycle(uuid, treatment_plan_lifecycle, text) to authenticated, service_role;

revoke execute on function public.set_stock_item_settings(uuid, uuid, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.set_stock_item_settings(uuid, uuid, numeric, numeric, text, uuid) to authenticated, service_role;

revoke execute on function public.set_stock_min(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_stock_min(uuid, uuid, numeric) to authenticated, service_role;

revoke execute on function public.set_treatment_pillar(uuid, methodology_pillar) from public, anon, authenticated;
grant execute on function public.set_treatment_pillar(uuid, methodology_pillar) to authenticated, service_role;

revoke execute on function public.set_user_environment(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_user_environment(uuid, text, boolean) to authenticated, service_role;

revoke execute on function public.share_client_with_unit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.share_client_with_unit(uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.sign_plan_cancellation(uuid, boolean) from public, anon, authenticated;
grant execute on function public.sign_plan_cancellation(uuid, boolean) to authenticated, service_role;

revoke execute on function public.start_clinical_attendance(uuid) from public, anon, authenticated;
grant execute on function public.start_clinical_attendance(uuid) to authenticated, service_role;

revoke execute on function public.supplier_price_divergence(date, date) from public, anon, authenticated;
grant execute on function public.supplier_price_divergence(date, date) to authenticated, service_role;

revoke execute on function public.system_access_by_clinic(uuid) from public, anon, authenticated;
grant execute on function public.system_access_by_clinic(uuid) to authenticated, service_role;

revoke execute on function public.system_reports_dashboard(date, date, uuid) from public, anon, authenticated;
grant execute on function public.system_reports_dashboard(date, date, uuid) to authenticated, service_role;

revoke execute on function public.system_reports_pending() from public, anon, authenticated;
grant execute on function public.system_reports_pending() to authenticated, service_role;

revoke execute on function public.touch_presence() from public, anon, authenticated;
grant execute on function public.touch_presence() to authenticated, service_role;

revoke execute on function public.training_candidates_multi(uuid[], text) from public, anon, authenticated;
grant execute on function public.training_candidates_multi(uuid[], text) to authenticated, service_role;

revoke execute on function public.transfer_client(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.transfer_client(uuid, uuid, boolean) to authenticated, service_role;

revoke execute on function public.unit_scheduling_staff(uuid) from public, anon, authenticated;
grant execute on function public.unit_scheduling_staff(uuid) to authenticated, service_role;

revoke execute on function public.update_agenda_closure(uuid, timestamp with time zone, timestamp with time zone, agenda_closure_reason, text, text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.update_agenda_closure(uuid, timestamp with time zone, timestamp with time zone, agenda_closure_reason, text, text, uuid[], uuid[]) to authenticated, service_role;

revoke execute on function public.update_attendance(uuid, attendance_status) from public, anon, authenticated;
grant execute on function public.update_attendance(uuid, attendance_status) to authenticated, service_role;

revoke execute on function public.update_network_plan_item(uuid, plan_item_type, date, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.update_network_plan_item(uuid, plan_item_type, date, date, text, text, boolean) to authenticated, service_role;

revoke execute on function public.update_plan_item(uuid, plan_item_type, date, date, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.update_plan_item(uuid, plan_item_type, date, date, text, text, uuid[]) to authenticated, service_role;

revoke execute on function public.update_special_day(uuid, date, time without time zone, time without time zone, uuid[], text) from public, anon, authenticated;
grant execute on function public.update_special_day(uuid, date, time without time zone, time without time zone, uuid[], text) to authenticated, service_role;

-- CONFERÊNCIA (só leitura). Esperado: fechadas = 118, sem_login = 0,
-- logado = 118, chave_de_servico = 118; e ainda_abertas_no_banco = 41.
select
  count(*) filter (where n.nspname || '.' || p.proname in (
    'public.add_planning_supplement',
    'public.add_system_report_attachment',
    'public.add_system_report_comment',
    'public.answer_decision',
    'public.apply_stock_count',
    'public.apply_stock_movement',
    'public.award_round_item',
    'public.can_consume_stock',
    'public.can_receive_payment',
    'public.chat_can_dm',
    'public.chat_contacts',
    'public.chat_important_unread',
    'public.chat_important_unread_total',
    'public.chat_my_channel_ids',
    'public.chat_unread_total',
    'public.check_in_appointment',
    'public.close_training_campaign',
    'public.create_agenda_closure',
    'public.create_clinical_request',
    'public.create_network_plan_item',
    'public.create_plan_item',
    'public.decide_holiday',
    'public.delete_agenda_closure',
    'public.delete_network_plan_item',
    'public.delete_plan_item',
    'public.delete_specialty',
    'public.delete_stock_item',
    'public.discard_plan_cancellation',
    'public.discard_stock_count',
    'public.empresarial_client_family',
    'public.end_client_share',
    'public.ensure_direct_chat_channel',
    'public.ensure_unit_chat_channel',
    'public.grant_clinic_access',
    'public.link_appointment_sessions',
    'public.link_supplier_item',
    'public.log_plan_edited_event',
    'public.log_plan_event',
    'public.lookup_risartano_by_cpf',
    'public.mark_planning_supplements_seen',
    'public.mark_system_report_seen',
    'public.mark_system_reports_seen',
    'public.move_client_phase',
    'public.notify_appointment_overrun',
    'public.notify_appointment_participants',
    'public.notify_attendance_alerts',
    'public.notify_birthday_clients',
    'public.notify_insistent_requests',
    'public.notify_pending_holidays',
    'public.notify_treatment_alerts',
    'public.notify_weekly_forecast',
    'public.open_new_evaluation',
    'public.open_purchase_round',
    'public.open_special_days',
    'public.open_stock_count',
    'public.open_stock_package',
    'public.open_training_campaign',
    'public.order_pending_items',
    'public.post_stock_movement',
    'public.ppr_generate_charges',
    'public.ppr_mark_charge_paid',
    'public.procedure_real_stats',
    'public.provider_cross_unit_check',
    'public.provider_multi_unit_agenda',
    'public.provider_procedure_minutes',
    'public.purchase_leakage',
    'public.purchase_savings',
    'public.purchase_suppliers',
    'public.purchase_top_items',
    'public.receive_purchase_order',
    'public.register_stock_purchase',
    'public.remove_special_day',
    'public.remove_system_report_attachment',
    'public.rename_specialty',
    'public.reopen_system_report',
    'public.request_item_scheduling',
    'public.request_quality_scheduling',
    'public.request_session_scheduling',
    'public.resolve_clinical_request',
    'public.revoke_clinic_access',
    'public.round_allocation',
    'public.round_items_view',
    'public.round_pending_approvals',
    'public.save_purchase_quote',
    'public.save_quote_price',
    'public.save_stock_item',
    'public.save_stock_kit',
    'public.save_training_requirements',
    'public.save_training_settings',
    'public.sdr_accessible_client_ids',
    'public.search_clients',
    'public.send_to_planning_followup',
    'public.set_appointment_participants',
    'public.set_environment_url',
    'public.set_journey_status',
    'public.set_permission',
    'public.set_plan_item_quality',
    'public.set_plan_lifecycle',
    'public.set_stock_item_settings',
    'public.set_stock_min',
    'public.set_treatment_pillar',
    'public.set_user_environment',
    'public.share_client_with_unit',
    'public.sign_plan_cancellation',
    'public.start_clinical_attendance',
    'public.supplier_price_divergence',
    'public.system_access_by_clinic',
    'public.system_reports_dashboard',
    'public.system_reports_pending',
    'public.touch_presence',
    'public.training_candidates_multi',
    'public.transfer_client',
    'public.unit_scheduling_staff',
    'public.update_agenda_closure',
    'public.update_attendance',
    'public.update_network_plan_item',
    'public.update_plan_item',
    'public.update_special_day'
  )) as fechadas,
  count(*) filter (where has_function_privilege('anon', p.oid, 'execute') and n.nspname || '.' || p.proname in (
    'public.add_planning_supplement',
    'public.add_system_report_attachment',
    'public.add_system_report_comment',
    'public.answer_decision',
    'public.apply_stock_count',
    'public.apply_stock_movement',
    'public.award_round_item',
    'public.can_consume_stock',
    'public.can_receive_payment',
    'public.chat_can_dm',
    'public.chat_contacts',
    'public.chat_important_unread',
    'public.chat_important_unread_total',
    'public.chat_my_channel_ids',
    'public.chat_unread_total',
    'public.check_in_appointment',
    'public.close_training_campaign',
    'public.create_agenda_closure',
    'public.create_clinical_request',
    'public.create_network_plan_item',
    'public.create_plan_item',
    'public.decide_holiday',
    'public.delete_agenda_closure',
    'public.delete_network_plan_item',
    'public.delete_plan_item',
    'public.delete_specialty',
    'public.delete_stock_item',
    'public.discard_plan_cancellation',
    'public.discard_stock_count',
    'public.empresarial_client_family',
    'public.end_client_share',
    'public.ensure_direct_chat_channel',
    'public.ensure_unit_chat_channel',
    'public.grant_clinic_access',
    'public.link_appointment_sessions',
    'public.link_supplier_item',
    'public.log_plan_edited_event',
    'public.log_plan_event',
    'public.lookup_risartano_by_cpf',
    'public.mark_planning_supplements_seen',
    'public.mark_system_report_seen',
    'public.mark_system_reports_seen',
    'public.move_client_phase',
    'public.notify_appointment_overrun',
    'public.notify_appointment_participants',
    'public.notify_attendance_alerts',
    'public.notify_birthday_clients',
    'public.notify_insistent_requests',
    'public.notify_pending_holidays',
    'public.notify_treatment_alerts',
    'public.notify_weekly_forecast',
    'public.open_new_evaluation',
    'public.open_purchase_round',
    'public.open_special_days',
    'public.open_stock_count',
    'public.open_stock_package',
    'public.open_training_campaign',
    'public.order_pending_items',
    'public.post_stock_movement',
    'public.ppr_generate_charges',
    'public.ppr_mark_charge_paid',
    'public.procedure_real_stats',
    'public.provider_cross_unit_check',
    'public.provider_multi_unit_agenda',
    'public.provider_procedure_minutes',
    'public.purchase_leakage',
    'public.purchase_savings',
    'public.purchase_suppliers',
    'public.purchase_top_items',
    'public.receive_purchase_order',
    'public.register_stock_purchase',
    'public.remove_special_day',
    'public.remove_system_report_attachment',
    'public.rename_specialty',
    'public.reopen_system_report',
    'public.request_item_scheduling',
    'public.request_quality_scheduling',
    'public.request_session_scheduling',
    'public.resolve_clinical_request',
    'public.revoke_clinic_access',
    'public.round_allocation',
    'public.round_items_view',
    'public.round_pending_approvals',
    'public.save_purchase_quote',
    'public.save_quote_price',
    'public.save_stock_item',
    'public.save_stock_kit',
    'public.save_training_requirements',
    'public.save_training_settings',
    'public.sdr_accessible_client_ids',
    'public.search_clients',
    'public.send_to_planning_followup',
    'public.set_appointment_participants',
    'public.set_environment_url',
    'public.set_journey_status',
    'public.set_permission',
    'public.set_plan_item_quality',
    'public.set_plan_lifecycle',
    'public.set_stock_item_settings',
    'public.set_stock_min',
    'public.set_treatment_pillar',
    'public.set_user_environment',
    'public.share_client_with_unit',
    'public.sign_plan_cancellation',
    'public.start_clinical_attendance',
    'public.supplier_price_divergence',
    'public.system_access_by_clinic',
    'public.system_reports_dashboard',
    'public.system_reports_pending',
    'public.touch_presence',
    'public.training_candidates_multi',
    'public.transfer_client',
    'public.unit_scheduling_staff',
    'public.update_agenda_closure',
    'public.update_attendance',
    'public.update_network_plan_item',
    'public.update_plan_item',
    'public.update_special_day'
  )) as sem_login,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute') and n.nspname || '.' || p.proname in (
    'public.add_planning_supplement',
    'public.add_system_report_attachment',
    'public.add_system_report_comment',
    'public.answer_decision',
    'public.apply_stock_count',
    'public.apply_stock_movement',
    'public.award_round_item',
    'public.can_consume_stock',
    'public.can_receive_payment',
    'public.chat_can_dm',
    'public.chat_contacts',
    'public.chat_important_unread',
    'public.chat_important_unread_total',
    'public.chat_my_channel_ids',
    'public.chat_unread_total',
    'public.check_in_appointment',
    'public.close_training_campaign',
    'public.create_agenda_closure',
    'public.create_clinical_request',
    'public.create_network_plan_item',
    'public.create_plan_item',
    'public.decide_holiday',
    'public.delete_agenda_closure',
    'public.delete_network_plan_item',
    'public.delete_plan_item',
    'public.delete_specialty',
    'public.delete_stock_item',
    'public.discard_plan_cancellation',
    'public.discard_stock_count',
    'public.empresarial_client_family',
    'public.end_client_share',
    'public.ensure_direct_chat_channel',
    'public.ensure_unit_chat_channel',
    'public.grant_clinic_access',
    'public.link_appointment_sessions',
    'public.link_supplier_item',
    'public.log_plan_edited_event',
    'public.log_plan_event',
    'public.lookup_risartano_by_cpf',
    'public.mark_planning_supplements_seen',
    'public.mark_system_report_seen',
    'public.mark_system_reports_seen',
    'public.move_client_phase',
    'public.notify_appointment_overrun',
    'public.notify_appointment_participants',
    'public.notify_attendance_alerts',
    'public.notify_birthday_clients',
    'public.notify_insistent_requests',
    'public.notify_pending_holidays',
    'public.notify_treatment_alerts',
    'public.notify_weekly_forecast',
    'public.open_new_evaluation',
    'public.open_purchase_round',
    'public.open_special_days',
    'public.open_stock_count',
    'public.open_stock_package',
    'public.open_training_campaign',
    'public.order_pending_items',
    'public.post_stock_movement',
    'public.ppr_generate_charges',
    'public.ppr_mark_charge_paid',
    'public.procedure_real_stats',
    'public.provider_cross_unit_check',
    'public.provider_multi_unit_agenda',
    'public.provider_procedure_minutes',
    'public.purchase_leakage',
    'public.purchase_savings',
    'public.purchase_suppliers',
    'public.purchase_top_items',
    'public.receive_purchase_order',
    'public.register_stock_purchase',
    'public.remove_special_day',
    'public.remove_system_report_attachment',
    'public.rename_specialty',
    'public.reopen_system_report',
    'public.request_item_scheduling',
    'public.request_quality_scheduling',
    'public.request_session_scheduling',
    'public.resolve_clinical_request',
    'public.revoke_clinic_access',
    'public.round_allocation',
    'public.round_items_view',
    'public.round_pending_approvals',
    'public.save_purchase_quote',
    'public.save_quote_price',
    'public.save_stock_item',
    'public.save_stock_kit',
    'public.save_training_requirements',
    'public.save_training_settings',
    'public.sdr_accessible_client_ids',
    'public.search_clients',
    'public.send_to_planning_followup',
    'public.set_appointment_participants',
    'public.set_environment_url',
    'public.set_journey_status',
    'public.set_permission',
    'public.set_plan_item_quality',
    'public.set_plan_lifecycle',
    'public.set_stock_item_settings',
    'public.set_stock_min',
    'public.set_treatment_pillar',
    'public.set_user_environment',
    'public.share_client_with_unit',
    'public.sign_plan_cancellation',
    'public.start_clinical_attendance',
    'public.supplier_price_divergence',
    'public.system_access_by_clinic',
    'public.system_reports_dashboard',
    'public.system_reports_pending',
    'public.touch_presence',
    'public.training_candidates_multi',
    'public.transfer_client',
    'public.unit_scheduling_staff',
    'public.update_agenda_closure',
    'public.update_attendance',
    'public.update_network_plan_item',
    'public.update_plan_item',
    'public.update_special_day'
  )) as logado,
  count(*) filter (where has_function_privilege('service_role', p.oid, 'execute') and n.nspname || '.' || p.proname in (
    'public.add_planning_supplement',
    'public.add_system_report_attachment',
    'public.add_system_report_comment',
    'public.answer_decision',
    'public.apply_stock_count',
    'public.apply_stock_movement',
    'public.award_round_item',
    'public.can_consume_stock',
    'public.can_receive_payment',
    'public.chat_can_dm',
    'public.chat_contacts',
    'public.chat_important_unread',
    'public.chat_important_unread_total',
    'public.chat_my_channel_ids',
    'public.chat_unread_total',
    'public.check_in_appointment',
    'public.close_training_campaign',
    'public.create_agenda_closure',
    'public.create_clinical_request',
    'public.create_network_plan_item',
    'public.create_plan_item',
    'public.decide_holiday',
    'public.delete_agenda_closure',
    'public.delete_network_plan_item',
    'public.delete_plan_item',
    'public.delete_specialty',
    'public.delete_stock_item',
    'public.discard_plan_cancellation',
    'public.discard_stock_count',
    'public.empresarial_client_family',
    'public.end_client_share',
    'public.ensure_direct_chat_channel',
    'public.ensure_unit_chat_channel',
    'public.grant_clinic_access',
    'public.link_appointment_sessions',
    'public.link_supplier_item',
    'public.log_plan_edited_event',
    'public.log_plan_event',
    'public.lookup_risartano_by_cpf',
    'public.mark_planning_supplements_seen',
    'public.mark_system_report_seen',
    'public.mark_system_reports_seen',
    'public.move_client_phase',
    'public.notify_appointment_overrun',
    'public.notify_appointment_participants',
    'public.notify_attendance_alerts',
    'public.notify_birthday_clients',
    'public.notify_insistent_requests',
    'public.notify_pending_holidays',
    'public.notify_treatment_alerts',
    'public.notify_weekly_forecast',
    'public.open_new_evaluation',
    'public.open_purchase_round',
    'public.open_special_days',
    'public.open_stock_count',
    'public.open_stock_package',
    'public.open_training_campaign',
    'public.order_pending_items',
    'public.post_stock_movement',
    'public.ppr_generate_charges',
    'public.ppr_mark_charge_paid',
    'public.procedure_real_stats',
    'public.provider_cross_unit_check',
    'public.provider_multi_unit_agenda',
    'public.provider_procedure_minutes',
    'public.purchase_leakage',
    'public.purchase_savings',
    'public.purchase_suppliers',
    'public.purchase_top_items',
    'public.receive_purchase_order',
    'public.register_stock_purchase',
    'public.remove_special_day',
    'public.remove_system_report_attachment',
    'public.rename_specialty',
    'public.reopen_system_report',
    'public.request_item_scheduling',
    'public.request_quality_scheduling',
    'public.request_session_scheduling',
    'public.resolve_clinical_request',
    'public.revoke_clinic_access',
    'public.round_allocation',
    'public.round_items_view',
    'public.round_pending_approvals',
    'public.save_purchase_quote',
    'public.save_quote_price',
    'public.save_stock_item',
    'public.save_stock_kit',
    'public.save_training_requirements',
    'public.save_training_settings',
    'public.sdr_accessible_client_ids',
    'public.search_clients',
    'public.send_to_planning_followup',
    'public.set_appointment_participants',
    'public.set_environment_url',
    'public.set_journey_status',
    'public.set_permission',
    'public.set_plan_item_quality',
    'public.set_plan_lifecycle',
    'public.set_stock_item_settings',
    'public.set_stock_min',
    'public.set_treatment_pillar',
    'public.set_user_environment',
    'public.share_client_with_unit',
    'public.sign_plan_cancellation',
    'public.start_clinical_attendance',
    'public.supplier_price_divergence',
    'public.system_access_by_clinic',
    'public.system_reports_dashboard',
    'public.system_reports_pending',
    'public.touch_presence',
    'public.training_candidates_multi',
    'public.transfer_client',
    'public.unit_scheduling_staff',
    'public.update_agenda_closure',
    'public.update_attendance',
    'public.update_network_plan_item',
    'public.update_plan_item',
    'public.update_special_day'
  )) as chave_de_servico,
  count(*) filter (where has_function_privilege('anon', p.oid, 'execute')
    and p.prorettype <> 'pg_catalog.trigger'::regtype) as ainda_abertas_no_banco
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'empresarial', 'indica', 'rita') and p.prokind = 'f'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
