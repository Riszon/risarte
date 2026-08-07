-- =============================================================================
-- 0204 — FIN4c: O ESTORNO TAMBÉM DESFAZ A TAXA DA ADQUIRENTE
-- -----------------------------------------------------------------------------
-- Descoberto ao ligar a taxa do cartão na baixa (06/08/2026). O estorno
-- revertia três naturezas — principal, benefício e multa/juros — e **deixava a
-- taxa da adquirente lá**. A unidade ficava com a despesa de um recebimento que
-- não existe mais, e o 2.4.01 nunca fechava com o extrato.
--
-- Duas correções na mesma função:
--
--   1) 'acquirer_fee' entra na reversão.
--   2) O contra-lançamento passa a inverter a DIREÇÃO do lançamento original.
--      Antes era 'outflow' fixo — o que funcionava porque as três naturezas
--      antigas são todas entrada. A taxa é SAÍDA: revertê-la com outra saída
--      dobraria a despesa em vez de anulá-la.
--
-- A taxa de EMISSÃO de boleto (`boleto_issue`) NÃO entra aqui de propósito:
-- ela não pertence ao recebimento e sim ao documento gerado — o banco cobrou
-- por emitir, e isso não volta porque a baixa foi estornada.
-- Idempotente.
-- =============================================================================

create or replace function public.reverse_payment_receipt(
  p_receipt_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
  v_new_id uuid;
  v_user uuid := (select auth.uid());
begin
  select * into v_rec from public.payment_receipts where id = p_receipt_id;
  if v_rec.id is null then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if v_rec.reversed then raise exception 'ALREADY_REVERSED'; end if;
  if v_rec.reversal_of is not null then raise exception 'CANNOT_REVERSE_REVERSAL'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  -- Estorno é ato de conferência: recepção não estorna.
  if not (
    public.is_admin_master() or public.is_finance_franchisor()
    or public.has_role_in_clinic(
         v_rec.clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.payment_receipts set reversed = true where id = p_receipt_id;

  insert into public.payment_receipts (
    clinic_id, installment_id, amount_cents, received_at, payment_method,
    reference, reversal_of, reversal_reason, reversed, created_by,
    principal_cents, benefit_cents, late_fee_cents, interest_cents
  ) values (
    v_rec.clinic_id, v_rec.installment_id, v_rec.amount_cents, current_date,
    v_rec.payment_method, v_rec.reference, p_receipt_id, btrim(p_reason),
    true, v_user,
    v_rec.principal_cents, v_rec.benefit_cents,
    v_rec.late_fee_cents, v_rec.interest_cents
  )
  returning id into v_new_id;

  -- Contra-lançamento de CADA linha do razão (o original continua lá).
  -- 0204: a direção é a INVERSA da original — entrada volta como saída, e a
  -- taxa (saída) volta como entrada.
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description,
    reversal_of, reversal_reason, created_by
  )
  select e.clinic_id, e.account_code, e.accrual_date, current_date,
         e.amount_cents,
         case when e.direction = 'inflow' then 'outflow' else 'inflow' end,
         'settled', e.source_type, v_new_id,
         'Estorno — ' || coalesce(e.description, 'recebimento'),
         e.id, btrim(p_reason), v_user
  from public.financial_entries e
  where e.source_id = p_receipt_id
    and e.source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee',
                          'acquirer_fee')
    and e.reversal_of is null;

  update public.financial_entries set status = 'reversed'
   where source_id = p_receipt_id
     and source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee',
                         'acquirer_fee')
     and reversal_of is null;

  return v_new_id;
end;
$$;

grant execute on function public.reverse_payment_receipt(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.financial_entries
    where source_type = 'acquirer_fee') as taxas_de_baixa_no_razao,
  (select count(*) from public.financial_entries
    where source_type = 'boleto_issue') as taxas_de_emissao_no_razao,
  (select coalesce(sum(amount_cents), 0) from public.financial_entries
    where account_code = '2.4.01' and status = 'settled') as total_2_4_01_centavos;
