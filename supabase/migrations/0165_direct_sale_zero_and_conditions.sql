-- =============================================================================
-- Risarte Odontologia — Migration 0165 (Venda direta: R$ 0,00 fecha sozinha e
-- contrato/cobrança exigem as condições de pagamento)
--
-- Ajustes do teste do PPR5 (dono, 25/07/2026):
--   1) Procedimento ISENTO (total R$ 0,00, tipicamente por benefício do PPR+ ou
--      do Empresarial): contrato, cobrança e pagamento ficam AUTOMÁTICOS e a
--      venda já nasce CONCLUÍDA — não há o que assinar nem cobrar.
--   2) Venda COM valor: só dá para marcar "contrato assinado" e "cobrança
--      emitida" DEPOIS de definir a forma de pagamento (e o parcelamento).
--      Antes disso o sistema recusa com CONDITIONS_REQUIRED.
-- Idempotente.
-- =============================================================================

-- 1) Fechamento automático de venda sem valor a pagar -------------------------
create or replace function public.direct_sale_autoclose_zero()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só age quando a venda ficou sem valor a pagar e ainda está aberta.
  if new.cancelled is not true
     and new.closed_at is null
     and coalesce(new.final_cents, 0) <= 0
     and coalesce(new.status, '') <> 'concluida' then
    update public.direct_sales set
      contract_signed = true,
      contract_signed_at = coalesce(contract_signed_at, now()),
      payment_issued = true,
      payment_issued_at = coalesce(payment_issued_at, now()),
      payment_confirmed = true,
      payment_confirmed_at = coalesce(payment_confirmed_at, now()),
      status = 'concluida',
      closed_at = now(),
      updated_at = now()
    where id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_direct_sale_autoclose_zero on public.direct_sales;
create trigger trg_direct_sale_autoclose_zero
  after insert or update of final_cents, cancelled on public.direct_sales
  for each row execute function public.direct_sale_autoclose_zero();

-- Vendas antigas que ficaram abertas com valor zero.
update public.direct_sales set
  contract_signed = true,
  contract_signed_at = coalesce(contract_signed_at, updated_at),
  payment_issued = true,
  payment_issued_at = coalesce(payment_issued_at, updated_at),
  payment_confirmed = true,
  payment_confirmed_at = coalesce(payment_confirmed_at, updated_at),
  status = 'concluida',
  closed_at = coalesce(closed_at, updated_at)
where cancelled is not true and closed_at is null and coalesce(final_cents, 0) <= 0;

-- 2) Contrato/cobrança exigem as condições de pagamento -----------------------
create or replace function public.direct_sale_close_step(
  p_sale_id uuid,
  p_step text,      -- 'contract' | 'payment_issued' | 'payment_confirmed'
  p_value boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.direct_sales;
  v_user uuid := (select auth.uid());
  v_signed boolean;
  v_confirmed boolean;
  v_closed boolean := false;
begin
  select * into v_sale from public.direct_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.direct_sale_can_close(v_sale.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;
  if p_step not in ('contract','payment_issued','payment_confirmed') then
    raise exception 'INVALID_STEP';
  end if;

  -- Nada de assinar contrato ou emitir cobrança antes de definir COMO o cliente
  -- vai pagar (só quando há valor a pagar).
  if p_value
     and p_step in ('contract','payment_issued')
     and coalesce(v_sale.final_cents, 0) > 0
     and (v_sale.payment_method is null or coalesce(v_sale.installments, 0) < 1) then
    raise exception 'CONDITIONS_REQUIRED';
  end if;

  if p_step = 'contract' then
    update public.direct_sales set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end,
      updated_at = now()
    where id = p_sale_id;
  elsif p_step = 'payment_issued' then
    update public.direct_sales set
      payment_issued = p_value,
      payment_issued_at = case when p_value then now() else null end,
      payment_issued_by = case when p_value then v_user else null end,
      -- Valor zerado por programa: emitir já confirma o pagamento (§7.6).
      payment_confirmed = case when p_value and v_sale.final_cents <= 0 then true
                               else payment_confirmed end,
      payment_confirmed_at = case when p_value and v_sale.final_cents <= 0 then now()
                                  else payment_confirmed_at end,
      payment_confirmed_by = case when p_value and v_sale.final_cents <= 0 then v_user
                                  else payment_confirmed_by end,
      updated_at = now()
    where id = p_sale_id;
  else
    update public.direct_sales set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end,
      updated_at = now()
    where id = p_sale_id;
  end if;

  select contract_signed, payment_confirmed into v_signed, v_confirmed
  from public.direct_sales where id = p_sale_id;

  -- REGRA DE OURO: assinado + confirmado = venda concluída.
  if v_signed and v_confirmed then
    update public.direct_sales set
      status = 'concluida', closed_at = now(), updated_at = now()
    where id = p_sale_id;
    v_closed := true;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_close', p_sale_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed));

  return jsonb_build_object('signed', v_signed, 'confirmed', v_confirmed, 'closed', v_closed);
end;
$$;

revoke all on function public.direct_sale_close_step(uuid, text, boolean) from public;
grant execute on function public.direct_sale_close_step(uuid, text, boolean) to authenticated;
