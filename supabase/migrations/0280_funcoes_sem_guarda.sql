-- =============================================================================
-- 0280 — FUNÇÕES SEM GUARDA DEIXAM DE RESPONDER SEM LOGIN (AP16)
-- -----------------------------------------------------------------------------
-- Medindo o AP15, apareceram 107 funções `security definer` SEM NENHUM
-- sinal de guarda que executavam para quem não está logado. Provado na
-- produção em 26/09/2026, pela API, com a chave pública e sem login (sem tocar
-- em dado real):
--   * `find_client_basic_by_cpf` — nome, nascimento e telefone do PACIENTE
--     pelo CPF (LGPD). Executou (CPF inexistente, 0 linhas).
--   * `empresarial.settle_billing` — dá BAIXA numa cobrança. Executou até
--     "cobrança não encontrada" (id inexistente, nada gravado).
--
-- TRÊS CAMADAS, decididas lendo QUEM CHAMA cada uma (app, políticas, funções
-- INVOKER, views — levantado no banco e no código em 26/09/2026):
--
--   1. INTERNAS (63): só funções do próprio banco as chamam (e
--      essas rodam como dono). Fecham para quem não está logado E para logado.
--   2. USADAS pelo app/políticas (42): continuam para quem está
--      logado; fecham para quem NÃO está. (A busca por CPF é do cadastro — o
--      cliente é único na rede, por decisão de produto.)
--   3. GUARDA no começo de 5 que GRAVAM dinheiro, situação ou dado pessoal e
--      que o app chama: baixa de cobrança, suspensão por atraso, retenção
--      (anonimização — o prazo vem por parâmetro), ativar/restaurar titular.
--      A definição é a ATUAL do banco com a guarda acrescentada; nada mais
--      muda. Sem usuário (webhook, rotina agendada) passa, como antes.
--
-- FICAM ABERTAS, de propósito: `environment_allowed` e `is_mirror_db` — o
-- Risarte Academy (outro sistema, MESMO banco) pode lê-las, e não expõem nada
-- sensível. Fechar os schemas inteiros para quem não está logado depende de
-- conferir o Academy (BACKLOG, AP16 — pendente do dono).
--
-- Idempotente.
-- =============================================================================

-- 1) Internas: fecham para anon e para logado ---------------------------------
--    (a chave de serviço continua: é ela que os webhooks — ASAAS, ZapSign — usam)
revoke execute on function empresarial.attach_usage_appointment(uuid) from public, anon, authenticated;
grant execute on function empresarial.attach_usage_appointment(uuid) to service_role;
revoke execute on function empresarial.mark_contract_signed(character varying,timestamp with time zone) from public, anon, authenticated;
grant execute on function empresarial.mark_contract_signed(character varying,timestamp with time zone) to service_role;
revoke execute on function empresarial.member_role_for(uuid,uuid) from public, anon, authenticated;
grant execute on function empresarial.member_role_for(uuid,uuid) to service_role;
revoke execute on function empresarial.record_benefit_usage(uuid) from public, anon, authenticated;
grant execute on function empresarial.record_benefit_usage(uuid) to service_role;
revoke execute on function empresarial.refresh_client_badge(uuid) from public, anon, authenticated;
grant execute on function empresarial.refresh_client_badge(uuid) to service_role;
revoke execute on function empresarial.refresh_company_suspension(uuid) from public, anon, authenticated;
grant execute on function empresarial.refresh_company_suspension(uuid) to service_role;
revoke execute on function empresarial.refresh_dependent_plan(uuid) from public, anon, authenticated;
grant execute on function empresarial.refresh_dependent_plan(uuid) to service_role;
revoke execute on function empresarial.register_direct_sale_usage(uuid) from public, anon, authenticated;
grant execute on function empresarial.register_direct_sale_usage(uuid) to service_role;
revoke execute on function empresarial.register_negotiation_usage(uuid) from public, anon, authenticated;
grant execute on function empresarial.register_negotiation_usage(uuid) to service_role;
revoke execute on function public.acquirer_applies_to(uuid,uuid) from public, anon, authenticated;
grant execute on function public.acquirer_applies_to(uuid,uuid) to service_role;
revoke execute on function public.acquirer_rate_for(uuid,text,integer,date) from public, anon, authenticated;
grant execute on function public.acquirer_rate_for(uuid,text,integer,date) to service_role;
revoke execute on function public.acquirer_rate_usage(uuid) from public, anon, authenticated;
grant execute on function public.acquirer_rate_usage(uuid) to service_role;
revoke execute on function public.alvo_e_admin(uuid) from public, anon, authenticated;
grant execute on function public.alvo_e_admin(uuid) to service_role;
revoke execute on function public.apply_renegotiation(uuid) from public, anon, authenticated;
grant execute on function public.apply_renegotiation(uuid) to service_role;
revoke execute on function public.apply_sale_benefit_risk(uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_sale_benefit_risk(uuid,uuid) to service_role;
revoke execute on function public.apply_settlement_projection(uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_settlement_projection(uuid,uuid) to service_role;
revoke execute on function public.asset_book_value(uuid) from public, anon, authenticated;
grant execute on function public.asset_book_value(uuid) to service_role;
revoke execute on function public.cancellation_penalty_percent(uuid) from public, anon, authenticated;
grant execute on function public.cancellation_penalty_percent(uuid) to service_role;
revoke execute on function public.chat_cross_level_allowed(user_role,user_role) from public, anon, authenticated;
grant execute on function public.chat_cross_level_allowed(user_role,user_role) to service_role;
revoke execute on function public.closure_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.closure_snapshot(uuid) to service_role;
revoke execute on function public.commercial_cash_discount_percent(uuid) from public, anon, authenticated;
grant execute on function public.commercial_cash_discount_percent(uuid) to service_role;
revoke execute on function public.commercial_min_installment_cents(uuid,text) from public, anon, authenticated;
grant execute on function public.commercial_min_installment_cents(uuid,text) to service_role;
revoke execute on function public.empresarial_client_conditions(uuid) from public, anon, authenticated;
grant execute on function public.empresarial_client_conditions(uuid) to service_role;
revoke execute on function public.estimated_direct_sale_material(uuid) from public, anon, authenticated;
grant execute on function public.estimated_direct_sale_material(uuid) to service_role;
revoke execute on function public.estimated_option_material(uuid,uuid) from public, anon, authenticated;
grant execute on function public.estimated_option_material(uuid,uuid) to service_role;
revoke execute on function public.followup_parked_by_commercial(uuid) from public, anon, authenticated;
grant execute on function public.followup_parked_by_commercial(uuid) to service_role;
revoke execute on function public.inactivity_threshold_minutes(uuid,text) from public, anon, authenticated;
grant execute on function public.inactivity_threshold_minutes(uuid,text) to service_role;
revoke execute on function public.inactivity_threshold(uuid,text) from public, anon, authenticated;
grant execute on function public.inactivity_threshold(uuid,text) to service_role;
revoke execute on function public.installment_balance(uuid,date) from public, anon, authenticated;
grant execute on function public.installment_balance(uuid,date) to service_role;
revoke execute on function public.kit_cost_cents(uuid,uuid) from public, anon, authenticated;
grant execute on function public.kit_cost_cents(uuid,uuid) to service_role;
revoke execute on function public.kits_for(uuid,uuid) from public, anon, authenticated;
grant execute on function public.kits_for(uuid,uuid) to service_role;
revoke execute on function public.mark_overdue_installments() from public, anon, authenticated;
grant execute on function public.mark_overdue_installments() to service_role;
revoke execute on function public.material_cost_for(uuid,uuid) from public, anon, authenticated;
grant execute on function public.material_cost_for(uuid,uuid) to service_role;
revoke execute on function public.network_fee_accounts(text) from public, anon, authenticated;
grant execute on function public.network_fee_accounts(text) to service_role;
revoke execute on function public.network_fee_for(uuid,text,date) from public, anon, authenticated;
grant execute on function public.network_fee_for(uuid,text,date) to service_role;
revoke execute on function public.network_fee_label(text) from public, anon, authenticated;
grant execute on function public.network_fee_label(text) to service_role;
revoke execute on function public.next_asset_code() from public, anon, authenticated;
grant execute on function public.next_asset_code() to service_role;
revoke execute on function public.next_cancellation_code() from public, anon, authenticated;
grant execute on function public.next_cancellation_code() to service_role;
revoke execute on function public.next_sale_code(text) from public, anon, authenticated;
grant execute on function public.next_sale_code(text) to service_role;
revoke execute on function public.next_stock_item_code() from public, anon, authenticated;
grant execute on function public.next_stock_item_code() to service_role;
revoke execute on function public.notify_plan_people(uuid,uuid,uuid[],text,date,date) from public, anon, authenticated;
grant execute on function public.notify_plan_people(uuid,uuid,uuid[],text,date,date) to service_role;
revoke execute on function public.open_day_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.open_day_snapshot(uuid) to service_role;
revoke execute on function public.option_session_rows(uuid,uuid) from public, anon, authenticated;
grant execute on function public.option_session_rows(uuid,uuid) to service_role;
revoke execute on function public.overdue_limit_percent(uuid) from public, anon, authenticated;
grant execute on function public.overdue_limit_percent(uuid) to service_role;
revoke execute on function public.payable_approval_for(uuid,text) from public, anon, authenticated;
grant execute on function public.payable_approval_for(uuid,text) to service_role;
revoke execute on function public.payable_punctuality_discount(uuid,date) from public, anon, authenticated;
grant execute on function public.payable_punctuality_discount(uuid,date) to service_role;
revoke execute on function public.payout_rate_by_level(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.payout_rate_by_level(uuid,uuid,uuid,date) to service_role;
revoke execute on function public.payout_rate_for(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.payout_rate_for(uuid,uuid,uuid,date) to service_role;
revoke execute on function public.plan_item_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.plan_item_snapshot(uuid) to service_role;
revoke execute on function public.post_installment_accrual(uuid) from public, anon, authenticated;
grant execute on function public.post_installment_accrual(uuid) to service_role;
revoke execute on function public.post_payable_accrual(uuid) from public, anon, authenticated;
grant execute on function public.post_payable_accrual(uuid) to service_role;
revoke execute on function public.ppr_client_conditions(uuid) from public, anon, authenticated;
grant execute on function public.ppr_client_conditions(uuid) to service_role;
revoke execute on function public.ppr_client_tier_percent(uuid,integer) from public, anon, authenticated;
grant execute on function public.ppr_client_tier_percent(uuid,integer) to service_role;
revoke execute on function public.ppr_effective_settings(uuid) from public, anon, authenticated;
grant execute on function public.ppr_effective_settings(uuid) to service_role;
revoke execute on function public.procedure_cost_breakdown(uuid,uuid) from public, anon, authenticated;
grant execute on function public.procedure_cost_breakdown(uuid,uuid) to service_role;
revoke execute on function public.recompute_client_activity_one(uuid) from public, anon, authenticated;
grant execute on function public.recompute_client_activity_one(uuid) to service_role;
revoke execute on function public.recompute_closure_flags(uuid) from public, anon, authenticated;
grant execute on function public.recompute_closure_flags(uuid) to service_role;
revoke execute on function public.resolve_supplier_items(text,text[],text[]) from public, anon, authenticated;
grant execute on function public.resolve_supplier_items(text,text[],text[]) to service_role;
revoke execute on function public.sale_recoverable_benefit_cents(uuid,uuid) from public, anon, authenticated;
grant execute on function public.sale_recoverable_benefit_cents(uuid,uuid) to service_role;
revoke execute on function public.session_consumption(uuid) from public, anon, authenticated;
grant execute on function public.session_consumption(uuid) to service_role;
revoke execute on function public.settle_treatment_sessions(uuid) from public, anon, authenticated;
grant execute on function public.settle_treatment_sessions(uuid) to service_role;
revoke execute on function public.sla_minutes(uuid,text) from public, anon, authenticated;
grant execute on function public.sla_minutes(uuid,text) to service_role;
revoke execute on function public.training_candidates(uuid,text) from public, anon, authenticated;
grant execute on function public.training_candidates(uuid,text) to service_role;

-- 2) Usadas pelo app/políticas: fecham só para quem não está logado -----------
--    (tira de todos e DEVOLVE a quem está logado e à chave de serviço — o
--    formato que a Regra 7 do check-migrations exige: sem ambiguidade)
revoke execute on function empresarial.mark_overdue_and_suspend(integer) from public, anon, authenticated;
grant execute on function empresarial.mark_overdue_and_suspend(integer) to authenticated, service_role;
revoke execute on function empresarial.restore_employee(uuid) from public, anon, authenticated;
grant execute on function empresarial.restore_employee(uuid) to authenticated, service_role;
revoke execute on function empresarial.run_retention(integer) from public, anon, authenticated;
grant execute on function empresarial.run_retention(integer) to authenticated, service_role;
revoke execute on function empresarial.set_employee_active(uuid,boolean,text) from public, anon, authenticated;
grant execute on function empresarial.set_employee_active(uuid,boolean,text) to authenticated, service_role;
revoke execute on function empresarial.settle_billing(uuid,timestamp with time zone) from public, anon, authenticated;
grant execute on function empresarial.settle_billing(uuid,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.acquirer_rates_usage(uuid[]) from public, anon, authenticated;
grant execute on function public.acquirer_rates_usage(uuid[]) to authenticated, service_role;
revoke execute on function public.acquirer_visible_to_me(uuid) from public, anon, authenticated;
grant execute on function public.acquirer_visible_to_me(uuid) to authenticated, service_role;
revoke execute on function public.can_manage_staff(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_staff(uuid) to authenticated, service_role;
revoke execute on function public.can_reconcile(uuid) from public, anon, authenticated;
grant execute on function public.can_reconcile(uuid) to authenticated, service_role;
revoke execute on function public.chat_channel_people(uuid) from public, anon, authenticated;
grant execute on function public.chat_channel_people(uuid) to authenticated, service_role;
revoke execute on function public.chat_display_names(uuid[]) from public, anon, authenticated;
grant execute on function public.chat_display_names(uuid[]) to authenticated, service_role;
revoke execute on function public.cost_settings_for(uuid) from public, anon, authenticated;
grant execute on function public.cost_settings_for(uuid) to authenticated, service_role;
revoke execute on function public.estimated_direct_sale_payout(uuid) from public, anon, authenticated;
grant execute on function public.estimated_direct_sale_payout(uuid) to authenticated, service_role;
revoke execute on function public.estimated_option_payout(uuid,uuid) from public, anon, authenticated;
grant execute on function public.estimated_option_payout(uuid,uuid) to authenticated, service_role;
revoke execute on function public.estimated_purchase_cost(uuid,uuid) from public, anon, authenticated;
grant execute on function public.estimated_purchase_cost(uuid,uuid) to authenticated, service_role;
revoke execute on function public.fill_history_access(uuid) from public, anon, authenticated;
grant execute on function public.fill_history_access(uuid) to authenticated, service_role;
revoke execute on function public.finance_settings_for(uuid) from public, anon, authenticated;
grant execute on function public.finance_settings_for(uuid) to authenticated, service_role;
revoke execute on function public.find_client_basic_by_cpf(text) from public, anon, authenticated;
grant execute on function public.find_client_basic_by_cpf(text) to authenticated, service_role;
revoke execute on function public.find_duplicate_client(text,text,date) from public, anon, authenticated;
grant execute on function public.find_duplicate_client(text,text,date) to authenticated, service_role;
revoke execute on function public.find_prospect_by_cpf(text) from public, anon, authenticated;
grant execute on function public.find_prospect_by_cpf(text) to authenticated, service_role;
revoke execute on function public.find_staff_by_cpf(text) from public, anon, authenticated;
grant execute on function public.find_staff_by_cpf(text) to authenticated, service_role;
revoke execute on function public.finish_clinical_attendance(uuid) from public, anon, authenticated;
grant execute on function public.finish_clinical_attendance(uuid) to authenticated, service_role;
revoke execute on function public.material_costs_for_clinic(uuid) from public, anon, authenticated;
grant execute on function public.material_costs_for_clinic(uuid) to authenticated, service_role;
revoke execute on function public.min_margin_percent(uuid) from public, anon, authenticated;
grant execute on function public.min_margin_percent(uuid) to authenticated, service_role;
revoke execute on function public.next_client_code_prefixed(uuid,text) from public, anon, authenticated;
grant execute on function public.next_client_code_prefixed(uuid,text) to authenticated, service_role;
revoke execute on function public.next_client_code(uuid) from public, anon, authenticated;
grant execute on function public.next_client_code(uuid) to authenticated, service_role;
revoke execute on function public.next_procedure_code() from public, anon, authenticated;
grant execute on function public.next_procedure_code() to authenticated, service_role;
revoke execute on function public.notify_protocol_decision(uuid) from public, anon, authenticated;
grant execute on function public.notify_protocol_decision(uuid) to authenticated, service_role;
revoke execute on function public.notify_protocol_proposal(uuid) from public, anon, authenticated;
grant execute on function public.notify_protocol_proposal(uuid) to authenticated, service_role;
revoke execute on function public.notify_provider_cross_unit(uuid) from public, anon, authenticated;
grant execute on function public.notify_provider_cross_unit(uuid) to authenticated, service_role;
revoke execute on function public.overstocked_items(uuid) from public, anon, authenticated;
grant execute on function public.overstocked_items(uuid) to authenticated, service_role;
revoke execute on function public.packages_running_out(uuid,numeric) from public, anon, authenticated;
grant execute on function public.packages_running_out(uuid,numeric) to authenticated, service_role;
revoke execute on function public.payout_matrix(uuid,date) from public, anon, authenticated;
grant execute on function public.payout_matrix(uuid,date) to authenticated, service_role;
revoke execute on function public.ppr_refresh_delinquency(uuid) from public, anon, authenticated;
grant execute on function public.ppr_refresh_delinquency(uuid) to authenticated, service_role;
revoke execute on function public.procedure_kits_detail(uuid) from public, anon, authenticated;
grant execute on function public.procedure_kits_detail(uuid) to authenticated, service_role;
revoke execute on function public.providers_with_access(uuid,user_role) from public, anon, authenticated;
grant execute on function public.providers_with_access(uuid,user_role) to authenticated, service_role;
revoke execute on function public.recompute_client_activity(uuid) from public, anon, authenticated;
grant execute on function public.recompute_client_activity(uuid) to authenticated, service_role;
revoke execute on function public.replenishment_list(uuid) from public, anon, authenticated;
grant execute on function public.replenishment_list(uuid) to authenticated, service_role;
revoke execute on function public.role_allowed_for_clinic(user_role,uuid) from public, anon, authenticated;
grant execute on function public.role_allowed_for_clinic(user_role,uuid) to authenticated, service_role;
revoke execute on function public.sessions_without_kit(uuid,integer) from public, anon, authenticated;
grant execute on function public.sessions_without_kit(uuid,integer) to authenticated, service_role;
revoke execute on function public.stock_expiring(uuid,integer) from public, anon, authenticated;
grant execute on function public.stock_expiring(uuid,integer) to authenticated, service_role;
revoke execute on function public.stock_ledger_check(uuid) from public, anon, authenticated;
grant execute on function public.stock_ledger_check(uuid) to authenticated, service_role;

-- 3) As 5 guardas (definição atual + guarda no começo) -------------------------
CREATE OR REPLACE FUNCTION empresarial.settle_billing(p_billing_id uuid, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_bill record;
  v_rules record;
  v_risarte_pct numeric(5,2);
  v_risarte bigint;
begin
  -- AP16: só o gestor do programa (ou o Admin) dá baixa. Sem usuário (webhook
  -- do ASAAS, rotina) passa: quem chega sem login pela API já não executa.
  if auth.uid() is not null
     and not (public.is_admin_master() or empresarial.is_program_manager()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_bill from empresarial.adhesion_billing where id = p_billing_id;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;
  if v_bill.status = 'PAID' then return; end if;

  select * into v_rules
  from empresarial.split_rules
  where company_id = v_bill.company_id or company_id is null
  order by (company_id = v_bill.company_id) desc
  limit 1;

  v_risarte_pct := case
    when v_bill.billing_type = 'IMPLANTATION'
      then coalesce(v_rules.first_payment_risarte_pct, 0)
    else coalesce(v_rules.recurring_risarte_pct, 50)
  end;
  v_risarte := round(v_bill.total_amount_cents * v_risarte_pct / 100.0);

  update empresarial.adhesion_billing
    set status = 'PAID',
        paid_at = p_paid_at,
        split_risarte_cents = v_risarte,
        split_rislife_cents = v_bill.total_amount_cents - v_risarte
  where id = p_billing_id;

  -- Pagou: se não há mais atraso, a empresa volta a ficar ativa.
  perform empresarial.refresh_company_suspension(v_bill.company_id);
end $$;

CREATE OR REPLACE FUNCTION empresarial.mark_overdue_and_suspend(p_grace_days integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_suspended int := 0;
begin
  -- AP16: suspender empresa por atraso é ato do gestor do programa (ou rotina).
  if auth.uid() is not null
     and not (public.is_admin_master() or empresarial.is_program_manager()) then
    raise exception 'NOT_ALLOWED';
  end if;

  update empresarial.adhesion_billing
    set status = 'OVERDUE'
  where status = 'PENDING'
    and due_date is not null
    and due_date < current_date;

  with overdue as (
    select distinct b.company_id
    from empresarial.adhesion_billing b
    where b.status = 'OVERDUE'
      and b.due_date is not null
      and b.due_date < current_date - p_grace_days
  )
  update empresarial.companies c
    set status = 'SUSPENDED',
        auto_suspended_at = now()
  from overdue o
  where c.id = o.company_id and c.status = 'ACTIVE';
  get diagnostics v_suspended = row_count;

  return v_suspended;
end $$;

CREATE OR REPLACE FUNCTION empresarial.run_retention(p_years integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_count int := 0;
  v_cut timestamptz := now() - make_interval(years => p_years);
begin
  -- AP16: ANONIMIZA dados pessoais, e o prazo vem por parâmetro — chamada com
  -- 0 anos apagaria na hora o nome de todo colaborador inativo. Só o Admin
  -- (a tela) ou a rotina agendada.
  if auth.uid() is not null and not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Colaboradores que saíram há mais de N anos → anonimiza dados pessoais.
  update empresarial.employees
    set cpf = 'ANON' || left(md5(id::text), 8),
        full_name = 'Colaborador anonimizado',
        phone = '',
        email = null
  where status = 'INACTIVE'
    and left_at is not null
    and left_at < v_cut
    and full_name <> 'Colaborador anonimizado';
  get diagnostics v_count = row_count;

  -- Dependentes desses colaboradores → anonimiza também.
  update empresarial.dependents d
    set cpf = 'ANON' || left(md5(d.id::text), 8),
        full_name = 'Dependente anonimizado',
        phone = null
  from empresarial.employees e
  where d.employee_id = e.id
    and e.left_at is not null
    and e.left_at < v_cut
    and d.full_name is distinct from 'Dependente anonimizado';

  return v_count;
end $$;

CREATE OR REPLACE FUNCTION empresarial.set_employee_active(p_employee_id uuid, p_active boolean, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_emp record;
  v_dep record;
begin
  -- AP16: a mesma régua da política employees_write, para ESTE titular.
  if auth.uid() is not null and not exists (
    select 1 from empresarial.employees e
     where e.id = p_employee_id
       and (public.is_admin_master() or public.is_network_viewer()
            or empresarial.is_program_manager() or public.is_sdr()
            or e.clinic_id in (select public.user_full_access_clinic_ids()))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_emp from empresarial.employees where id = p_employee_id;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;

  update empresarial.employees
    set status = case when p_active then 'ACTIVE' else 'INACTIVE' end,
        left_at = case when p_active then null else now() end,
        left_reason = case when p_active then null else p_reason end
  where id = p_employee_id;

  if not p_active then
    -- Fecha o histórico do titular.
    update empresarial.membership_history
      set ended_at = now()
    where client_id = v_emp.client_id and company_id = v_emp.company_id
      and member_role = 'HOLDER' and ended_at is null;

    -- Titular sai → dependentes saem.
    for v_dep in
      select * from empresarial.dependents where employee_id = p_employee_id and status = 'ACTIVE'
    loop
      update empresarial.dependents set status = 'INACTIVE' where id = v_dep.id;
      update empresarial.membership_history
        set ended_at = now()
      where client_id = v_dep.client_id and company_id = v_emp.company_id
        and member_role = 'DEPENDENT' and ended_at is null;
      if v_dep.client_id is not null then
        perform empresarial.refresh_client_badge(v_dep.client_id);
      end if;
    end loop;
  end if;

  if v_emp.client_id is not null then
    perform empresarial.refresh_client_badge(v_emp.client_id);
  end if;
end $$;

CREATE OR REPLACE FUNCTION empresarial.restore_employee(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_emp record;
begin
  -- AP16: a mesma régua da política employees_write, para ESTE titular.
  if auth.uid() is not null and not exists (
    select 1 from empresarial.employees e
     where e.id = p_employee_id
       and (public.is_admin_master() or public.is_network_viewer()
            or empresarial.is_program_manager() or public.is_sdr()
            or e.clinic_id in (select public.user_full_access_clinic_ids()))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_emp from empresarial.employees where id = p_employee_id;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
  if v_emp.status <> 'DELETED' then return; end if;

  update empresarial.employees
    set status = 'INACTIVE', deleted_at = null, deleted_by = null
  where id = p_employee_id;

  if v_emp.client_id is not null then
    perform empresarial.refresh_client_badge(v_emp.client_id);
  end if;
end $$;

notify pgrst, 'reload schema';
