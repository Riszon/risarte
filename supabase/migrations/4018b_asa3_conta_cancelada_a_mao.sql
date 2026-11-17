-- =============================================================================
-- 4018b — a conta de taxa da rede cancelada À MÃO não volta sozinha (17/11/2026)
-- -----------------------------------------------------------------------------
-- O defeito (achado no teste da 4021): `refresh_network_fee_payable` refazia a
-- conta a pagar de taxa da rede e, se ela estivesse cancelada, a reabria
-- ("aberta") com os lançamentos. Quem a chama: o botão "Gerar taxas fixas do
-- mês", a rotina do dia 1º e cada recebimento do mês. Na produção, as 8 contas
-- de SDR e tecnologia de 10 e 11/2026 de Cambé e Londrina, canceladas a pedido
-- do dono em 16/11, voltariam se alguém usasse o botão para esses meses.
--
-- A correção: a conta cancelada à mão (qualquer motivo diferente de "Sem valor
-- apurado no mês") fica como está. Nada mais muda na função.
--
-- Só redefine uma função. Não mexe em dado. Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_network_fee_payable(p_clinic_id uuid, p_fee text, p_period date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cfg record;
  v_acc record;
  v_total bigint;
  v_payable uuid;
  v_due date;
  v_franchisor uuid;
  v_label text := public.network_fee_label(p_fee);
begin
  select * into v_cfg from public.network_fee_for(p_clinic_id, p_fee, p_period);
  if v_cfg is null then return; end if;
  select * into v_acc from public.network_fee_accounts(p_fee);
  if v_acc is null then return; end if;

  if v_cfg.kind = 'percent' then
    -- ASA3: o que o split reteve na origem não é cobrado de novo.
    select coalesce(sum(amount_cents - retained_cents), 0) into v_total
      from public.split_charges
     where clinic_id = p_clinic_id and fee = p_fee
       and period_month = p_period and not reversed;
  else
    v_total := case when v_cfg.active then v_cfg.amount_cents else 0 end;
  end if;

  v_due := (p_period + interval '1 month')::date
           + (coalesce(v_cfg.due_day, 10) - 1);

  select id into v_payable from public.payables
   where clinic_id = p_clinic_id and network_fee = p_fee
     and fee_period = p_period;

  -- 4018b: a conta cancelada À MÃO (por quem decide, com o motivo) não volta
  -- sozinha — nem pelo "Gerar taxas fixas do mês", nem pela apuração de um
  -- recebimento. Só a cancelada pela própria apuração ("Sem valor apurado no
  -- mês") é refeita.
  if v_payable is not null and exists (
       select 1 from public.payables x where x.id = v_payable and x.status = 'cancelada'
          and coalesce(x.cancel_reason, '') <> 'Sem valor apurado no mês') then
    return;
  end if;

  if v_total <= 0 then
    if v_payable is not null then
      update public.payables set status = 'cancelada',
        cancel_reason = 'Sem valor apurado no mês', updated_at = now()
       where id = v_payable and status <> 'paga';
      update public.financial_entries set status = 'cancelled'
       where source_type = 'payable_accrual' and source_id = v_payable;
      update public.financial_entries set status = 'cancelled'
       where source_type = 'network_fee_revenue' and source_id = v_payable;
    end if;
    return;
  end if;

  if v_payable is null then
    insert into public.payables (
      clinic_id, account_code, description, accrual_date, due_date,
      amount_cents, status, approval_mode, requires_approval,
      network_fee, fee_period, notes
    ) values (
      p_clinic_id, v_acc.unit_account,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
        || coalesce(' (' || v_cfg.campaign_name || ')', ''),
      p_period, v_due, v_total, 'aberta',
      'sem_autorizacao', false,
      p_fee, p_period,
      'Apurado automaticamente sobre os recebimentos do mês.'
    ) returning id into v_payable;

    perform public.post_payable_accrual(v_payable);
  else
    update public.payables set
      amount_cents = v_total, due_date = v_due,
      status = case when status = 'cancelada' then 'aberta' else status end,
      updated_at = now()
     where id = v_payable;

    update public.financial_entries set
      amount_cents = v_total, status = 'open', updated_at = now()
     where source_type = 'payable_accrual' and source_id = v_payable;

    perform public.post_payable_accrual(v_payable);
  end if;

  select id into v_franchisor from public.clinics
   where type = 'franchisor' limit 1;

  if v_franchisor is not null and v_franchisor <> p_clinic_id then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description
    ) values (
      v_franchisor, v_acc.franchisor_account, p_period, null, v_due,
      v_total, 'inflow', 'open', 'network_fee_revenue', v_payable,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
    )
    on conflict (source_type, source_id)
      where source_type = 'network_fee_revenue'
    do update set amount_cents = excluded.amount_cents,
                  expected_settlement_date = excluded.expected_settlement_date,
                  status = 'open',
                  updated_at = now();
  end if;
end;
$function$;

revoke execute on function public.refresh_network_fee_payable(uuid, text, date) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Conferência: a regra nova ligada, e as 8 contas canceladas à mão continuam canceladas.
select
  position('4018b' in pg_get_functiondef('public.refresh_network_fee_payable(uuid, text, date)'::regprocedure)) > 0 as regra_nova,
  (select count(*) from public.payables
    where cancel_reason = 'Cancelada a pedido do dono (16/11/2026): as taxas fixas começam em 12/2026.'
      and status = 'cancelada') as canceladas_a_mao;
