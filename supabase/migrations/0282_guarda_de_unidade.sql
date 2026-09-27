-- =============================================================================
-- 0282 — GUARDA DE UNIDADE NAS FUNÇÕES DE CUSTO, REPASSE, ESTOQUE E FINANCEIRO
--        (AP16, item 3)
-- -----------------------------------------------------------------------------
-- Depois da 0280, nenhuma destas funções responde a quem não está logado. Mas
-- QUALQUER logado ainda pedia os números de QUALQUER unidade: a recepcionista
-- de Cambé, chamando a API direto, lia o custo, o repasse por nível, o estoque
-- e as configurações financeiras de Londrina. As telas nunca pedem outra
-- unidade — a brecha é a API.
--
-- ⚠️ COMO, SEM REESCREVER NENHUMA FUNÇÃO: cada uma das 17 é RENOMEADA
-- para `_<nome>_raw` (fechada para a API) e ganha, com o NOME, os PARÂMETROS e
-- o RETORNO de antes, uma PORTA que confere a unidade e chama a original. Quem
-- chama pelo nome — telas, outras funções — passa pela porta sem mudar nada.
--
-- A REGRA DA PORTA (`can_read_clinic_data`): passa quem enxerga a unidade —
-- Admin Master, quem vê a rede (Franqueadora/Rede), e quem tem acesso a ela
-- (função ali, ou escopo da Franqueadora sobre ela: `user_full_access_clinic_ids`).
-- Rotina sem usuário (`auth.uid()` nulo) passa, como sempre.
--
-- UNIDADE VAZIA: nas de configuração quer dizer "os valores da REDE" (o que o
-- Empresarial usa para montar a proposta) — passa. Em `ppr_refresh_delinquency`
-- e `recompute_client_activity` quer dizer "RODAR PARA TODAS" — só Admin ou
-- rotina.
--
-- FICAM SEM A PORTA, de propósito (BACKLOG, AP16): as que respondem "posso?"
-- sobre a própria pessoa; as usadas DENTRO de políticas (uma guarda que recusa
-- ali quebraria a consulta inteira); a busca por CPF do cadastro (cliente
-- único na rede); códigos e avisos (custo baixo, e a guarda arriscaria o
-- agendamento/cadastro em outra unidade feito pela SDR).
--
-- COMO DESFAZER uma função (SQL Editor), ex. `payout_matrix`:
--   drop function public.payout_matrix(uuid, date);
--   alter function public._payout_matrix_raw(uuid, date) rename to payout_matrix;
--   grant execute on function public.payout_matrix(uuid, date) to authenticated, service_role;
--
-- Idempotente.
-- =============================================================================

-- 1) A regra da porta ----------------------------------------------------------
create or replace function public.can_read_clinic_data(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
      or public.is_admin_master()
      or public.is_network_viewer()
      or p_clinic_id in (select public.user_full_access_clinic_ids());
$$;

-- É uma pergunta sobre QUEM CHAMA ("eu enxergo esta unidade?"): pode responder
-- a logado. Para anônimo, não.
revoke execute on function public.can_read_clinic_data(uuid) from public, anon, authenticated;
grant execute on function public.can_read_clinic_data(uuid) to authenticated, service_role;


-- cost_settings_for ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._cost_settings_for_raw(uuid)') is null then
    alter function public.cost_settings_for(p_clinic uuid) rename to _cost_settings_for_raw;
  end if;
end $$;
revoke execute on function public._cost_settings_for_raw(p_clinic uuid) from public, anon, authenticated;
grant execute on function public._cost_settings_for_raw(p_clinic uuid) to service_role;

create or replace function public.cost_settings_for(p_clinic uuid)
returns TABLE(chair_cost_per_hour_cents bigint, tax_percent numeric, avg_acquirer_fee_percent numeric, target_margin_percent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic is not null and not public.can_read_clinic_data(p_clinic) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._cost_settings_for_raw(p_clinic => p_clinic);
end;
$$;
revoke execute on function public.cost_settings_for(p_clinic uuid) from public, anon, authenticated;
grant execute on function public.cost_settings_for(p_clinic uuid) to authenticated, service_role;

-- estimated_direct_sale_payout ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._estimated_direct_sale_payout_raw(uuid)') is null then
    alter function public.estimated_direct_sale_payout(p_sale_id uuid) rename to _estimated_direct_sale_payout_raw;
  end if;
end $$;
revoke execute on function public._estimated_direct_sale_payout_raw(p_sale_id uuid) from public, anon, authenticated;
grant execute on function public._estimated_direct_sale_payout_raw(p_sale_id uuid) to service_role;

create or replace function public.estimated_direct_sale_payout(p_sale_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select s.clinic_id from public.direct_sales s where s.id = p_sale_id) is not null and not public.can_read_clinic_data((select s.clinic_id from public.direct_sales s where s.id = p_sale_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public._estimated_direct_sale_payout_raw(p_sale_id => p_sale_id);
end;
$$;
revoke execute on function public.estimated_direct_sale_payout(p_sale_id uuid) from public, anon, authenticated;
grant execute on function public.estimated_direct_sale_payout(p_sale_id uuid) to authenticated, service_role;

-- estimated_option_payout ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._estimated_option_payout_raw(uuid, uuid)') is null then
    alter function public.estimated_option_payout(p_option_id uuid, p_clinic_id uuid) rename to _estimated_option_payout_raw;
  end if;
end $$;
revoke execute on function public._estimated_option_payout_raw(p_option_id uuid, p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._estimated_option_payout_raw(p_option_id uuid, p_clinic_id uuid) to service_role;

create or replace function public.estimated_option_payout(p_option_id uuid, p_clinic_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public._estimated_option_payout_raw(p_option_id => p_option_id, p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.estimated_option_payout(p_option_id uuid, p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.estimated_option_payout(p_option_id uuid, p_clinic_id uuid) to authenticated, service_role;

-- estimated_purchase_cost ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._estimated_purchase_cost_raw(uuid, uuid)') is null then
    alter function public.estimated_purchase_cost(p_clinic_id uuid, p_item_id uuid) rename to _estimated_purchase_cost_raw;
  end if;
end $$;
revoke execute on function public._estimated_purchase_cost_raw(p_clinic_id uuid, p_item_id uuid) from public, anon, authenticated;
grant execute on function public._estimated_purchase_cost_raw(p_clinic_id uuid, p_item_id uuid) to service_role;

create or replace function public.estimated_purchase_cost(p_clinic_id uuid, p_item_id uuid)
returns TABLE(unit_cents bigint, source text, reference_date date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._estimated_purchase_cost_raw(p_clinic_id => p_clinic_id, p_item_id => p_item_id);
end;
$$;
revoke execute on function public.estimated_purchase_cost(p_clinic_id uuid, p_item_id uuid) from public, anon, authenticated;
grant execute on function public.estimated_purchase_cost(p_clinic_id uuid, p_item_id uuid) to authenticated, service_role;

-- finance_settings_for ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._finance_settings_for_raw(uuid)') is null then
    alter function public.finance_settings_for(p_clinic_id uuid) rename to _finance_settings_for_raw;
  end if;
end $$;
revoke execute on function public._finance_settings_for_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._finance_settings_for_raw(p_clinic_id uuid) to service_role;

create or replace function public.finance_settings_for(p_clinic_id uuid)
returns TABLE(late_fee_percent numeric, monthly_interest_percent numeric, grace_days integer, rounding_mode text, alerts_enabled boolean, alert_budget_percent numeric, alert_cash_days integer, alert_breakeven_days integer, alert_overdue_cents bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._finance_settings_for_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.finance_settings_for(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.finance_settings_for(p_clinic_id uuid) to authenticated, service_role;

-- material_costs_for_clinic ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._material_costs_for_clinic_raw(uuid)') is null then
    alter function public.material_costs_for_clinic(p_clinic_id uuid) rename to _material_costs_for_clinic_raw;
  end if;
end $$;
revoke execute on function public._material_costs_for_clinic_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._material_costs_for_clinic_raw(p_clinic_id uuid) to service_role;

create or replace function public.material_costs_for_clinic(p_clinic_id uuid)
returns TABLE(procedure_id uuid, materials_cents bigint, lab_cents bigint, from_kit boolean, kit_count integer, items_without_cost integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._material_costs_for_clinic_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.material_costs_for_clinic(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.material_costs_for_clinic(p_clinic_id uuid) to authenticated, service_role;

-- min_margin_percent ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._min_margin_percent_raw(uuid)') is null then
    alter function public.min_margin_percent(p_clinic uuid) rename to _min_margin_percent_raw;
  end if;
end $$;
revoke execute on function public._min_margin_percent_raw(p_clinic uuid) from public, anon, authenticated;
grant execute on function public._min_margin_percent_raw(p_clinic uuid) to service_role;

create or replace function public.min_margin_percent(p_clinic uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic is not null and not public.can_read_clinic_data(p_clinic) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public._min_margin_percent_raw(p_clinic => p_clinic);
end;
$$;
revoke execute on function public.min_margin_percent(p_clinic uuid) from public, anon, authenticated;
grant execute on function public.min_margin_percent(p_clinic uuid) to authenticated, service_role;

-- overstocked_items ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._overstocked_items_raw(uuid)') is null then
    alter function public.overstocked_items(p_clinic_id uuid) rename to _overstocked_items_raw;
  end if;
end $$;
revoke execute on function public._overstocked_items_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._overstocked_items_raw(p_clinic_id uuid) to service_role;

create or replace function public.overstocked_items(p_clinic_id uuid)
returns TABLE(item_id uuid, item_name text, stock_unit text, total_quantity numeric, max_quantity numeric, excess_quantity numeric, excess_cents bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._overstocked_items_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.overstocked_items(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.overstocked_items(p_clinic_id uuid) to authenticated, service_role;

-- packages_running_out ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._packages_running_out_raw(uuid, numeric)') is null then
    alter function public.packages_running_out(p_clinic_id uuid, p_threshold_percent numeric) rename to _packages_running_out_raw;
  end if;
end $$;
revoke execute on function public._packages_running_out_raw(p_clinic_id uuid, p_threshold_percent numeric) from public, anon, authenticated;
grant execute on function public._packages_running_out_raw(p_clinic_id uuid, p_threshold_percent numeric) to service_role;

create or replace function public.packages_running_out(p_clinic_id uuid, p_threshold_percent numeric DEFAULT 15)
returns TABLE(item_id uuid, item_name text, purchase_unit text, stock_unit text, in_use_quantity numeric, units_per_purchase numeric, percent_left numeric, closed_packages numeric, state text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._packages_running_out_raw(p_clinic_id => p_clinic_id, p_threshold_percent => p_threshold_percent);
end;
$$;
revoke execute on function public.packages_running_out(p_clinic_id uuid, p_threshold_percent numeric) from public, anon, authenticated;
grant execute on function public.packages_running_out(p_clinic_id uuid, p_threshold_percent numeric) to authenticated, service_role;

-- payout_matrix ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._payout_matrix_raw(uuid, date)') is null then
    alter function public.payout_matrix(p_clinic_id uuid, p_date date) rename to _payout_matrix_raw;
  end if;
end $$;
revoke execute on function public._payout_matrix_raw(p_clinic_id uuid, p_date date) from public, anon, authenticated;
grant execute on function public._payout_matrix_raw(p_clinic_id uuid, p_date date) to service_role;

create or replace function public.payout_matrix(p_clinic_id uuid, p_date date DEFAULT NULL::date)
returns TABLE(procedure_id uuid, level_id uuid, amount_cents bigint, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._payout_matrix_raw(p_clinic_id => p_clinic_id, p_date => p_date);
end;
$$;
revoke execute on function public.payout_matrix(p_clinic_id uuid, p_date date) from public, anon, authenticated;
grant execute on function public.payout_matrix(p_clinic_id uuid, p_date date) to authenticated, service_role;

-- ppr_refresh_delinquency ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._ppr_refresh_delinquency_raw(uuid)') is null then
    alter function public.ppr_refresh_delinquency(p_clinic_id uuid) rename to _ppr_refresh_delinquency_raw;
  end if;
end $$;
revoke execute on function public._ppr_refresh_delinquency_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._ppr_refresh_delinquency_raw(p_clinic_id uuid) to service_role;

create or replace function public.ppr_refresh_delinquency(p_clinic_id uuid DEFAULT NULL::uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_clinic_id is null then
    if auth.uid() is not null and not public.is_admin_master() then
      raise exception 'NOT_ALLOWED';
    end if;
  elsif not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public._ppr_refresh_delinquency_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.ppr_refresh_delinquency(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.ppr_refresh_delinquency(p_clinic_id uuid) to authenticated, service_role;

-- procedure_kits_detail ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._procedure_kits_detail_raw(uuid)') is null then
    alter function public.procedure_kits_detail(p_clinic_id uuid) rename to _procedure_kits_detail_raw;
  end if;
end $$;
revoke execute on function public._procedure_kits_detail_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._procedure_kits_detail_raw(p_clinic_id uuid) to service_role;

create or replace function public.procedure_kits_detail(p_clinic_id uuid)
returns TABLE(procedure_id uuid, kit_id uuid, kit_name text, kit_scope text, kit_cost_cents bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._procedure_kits_detail_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.procedure_kits_detail(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.procedure_kits_detail(p_clinic_id uuid) to authenticated, service_role;

-- recompute_client_activity ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._recompute_client_activity_raw(uuid)') is null then
    alter function public.recompute_client_activity(p_clinic_id uuid) rename to _recompute_client_activity_raw;
  end if;
end $$;
revoke execute on function public._recompute_client_activity_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._recompute_client_activity_raw(p_clinic_id uuid) to service_role;

create or replace function public.recompute_client_activity(p_clinic_id uuid DEFAULT NULL::uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_clinic_id is null then
    if auth.uid() is not null and not public.is_admin_master() then
      raise exception 'NOT_ALLOWED';
    end if;
  elsif not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public._recompute_client_activity_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.recompute_client_activity(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.recompute_client_activity(p_clinic_id uuid) to authenticated, service_role;

-- replenishment_list ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._replenishment_list_raw(uuid)') is null then
    alter function public.replenishment_list(p_clinic_id uuid) rename to _replenishment_list_raw;
  end if;
end $$;
revoke execute on function public._replenishment_list_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._replenishment_list_raw(p_clinic_id uuid) to service_role;

create or replace function public.replenishment_list(p_clinic_id uuid)
returns TABLE(item_id uuid, item_name text, brand text, purchase_unit text, stock_unit text, total_quantity numeric, min_quantity numeric, max_quantity numeric, suggested_packages numeric, avg_cost_cents numeric, estimated_cost_cents bigint, supplier_id uuid, state text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._replenishment_list_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.replenishment_list(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.replenishment_list(p_clinic_id uuid) to authenticated, service_role;

-- sessions_without_kit ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._sessions_without_kit_raw(uuid, integer)') is null then
    alter function public.sessions_without_kit(p_clinic_id uuid, p_days integer) rename to _sessions_without_kit_raw;
  end if;
end $$;
revoke execute on function public._sessions_without_kit_raw(p_clinic_id uuid, p_days integer) from public, anon, authenticated;
grant execute on function public._sessions_without_kit_raw(p_clinic_id uuid, p_days integer) to service_role;

create or replace function public.sessions_without_kit(p_clinic_id uuid, p_days integer DEFAULT 30)
returns TABLE(procedure_id uuid, procedure_name text, sessions integer, last_done date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._sessions_without_kit_raw(p_clinic_id => p_clinic_id, p_days => p_days);
end;
$$;
revoke execute on function public.sessions_without_kit(p_clinic_id uuid, p_days integer) from public, anon, authenticated;
grant execute on function public.sessions_without_kit(p_clinic_id uuid, p_days integer) to authenticated, service_role;

-- stock_expiring ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._stock_expiring_raw(uuid, integer)') is null then
    alter function public.stock_expiring(p_clinic_id uuid, p_days integer) rename to _stock_expiring_raw;
  end if;
end $$;
revoke execute on function public._stock_expiring_raw(p_clinic_id uuid, p_days integer) from public, anon, authenticated;
grant execute on function public._stock_expiring_raw(p_clinic_id uuid, p_days integer) to service_role;

create or replace function public.stock_expiring(p_clinic_id uuid, p_days integer DEFAULT 90)
returns TABLE(item_id uuid, item_name text, lot_code text, expires_at date, quantity numeric, days_left integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._stock_expiring_raw(p_clinic_id => p_clinic_id, p_days => p_days);
end;
$$;
revoke execute on function public.stock_expiring(p_clinic_id uuid, p_days integer) from public, anon, authenticated;
grant execute on function public.stock_expiring(p_clinic_id uuid, p_days integer) to authenticated, service_role;

-- stock_ledger_check ----------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._stock_ledger_check_raw(uuid)') is null then
    alter function public.stock_ledger_check(p_clinic_id uuid) rename to _stock_ledger_check_raw;
  end if;
end $$;
revoke execute on function public._stock_ledger_check_raw(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public._stock_ledger_check_raw(p_clinic_id uuid) to service_role;

create or replace function public.stock_ledger_check(p_clinic_id uuid)
returns TABLE(stock_value_cents bigint, ledger_value_cents bigint, difference_cents bigint, manual_entries integer, manual_entries_cents bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from public._stock_ledger_check_raw(p_clinic_id => p_clinic_id);
end;
$$;
revoke execute on function public.stock_ledger_check(p_clinic_id uuid) from public, anon, authenticated;
grant execute on function public.stock_ledger_check(p_clinic_id uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
