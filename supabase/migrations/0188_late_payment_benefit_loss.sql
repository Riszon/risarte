-- =============================================================================
-- 0188 — FIN1.1: pontualidade, detalhamento da baixa e multa/juros integrais
-- -----------------------------------------------------------------------------
-- Feedback do dono no teste do FIN1 (04/08/2026), em cinco pontos:
--
-- 1) A BAIXA não guardava o detalhamento. O diálogo sugeria o SALDO e o banco
--    recusava receber mais que ele (AMOUNT_OVER_BALANCE) — então o que o cliente
--    pagou de multa e juros não tinha onde entrar. Agora a baixa guarda
--    principal / benefício perdido / multa / juros, e o razão recebe uma linha
--    para cada natureza (multa e juros vão para 4.1.01, receita financeira).
--
-- 2) PERDA DO BENEFÍCIO POR FALTA DE PONTUALIDADE. Cliente de programa
--    (PPR+ / Risarte Empresarial) que paga por BOLETO ou por RECORRÊNCIA no
--    cartão só tem o desconto porque paga em dia. Atrasou → aquela parcela
--    volta a valer o preço sem benefício, e a multa e os juros incidem sobre
--    esse valor maior. No cartão parcelado e à vista a regra NÃO vale: o
--    dinheiro já entrou, não há risco de inadimplência.
--    Procedimento que ficou 100% gratuito NUNCA é cobrado — ele sai da base.
--
-- 3) MULTA E JUROS INTEGRAIS. Recebimento parcial estava reduzindo multa e
--    juros na mesma proporção (desconto disfarçado). A base da multa e dos
--    juros passa a ser o valor CHEIO da parcela (+ benefício perdido) até ela
--    ser quitada. Isto REVISA a decisão de 31/07/2026 ("juros sobre o que ainda
--    falta") — decisão do dono em 04/08/2026.
--
-- 4) Ordem de abatimento de um recebimento:
--    principal → benefício perdido → multa → juros.
--
-- 5) Sem desconto na baixa: só quita quem paga tudo. Valor menor vira baixa
--    PARCIAL, nunca quitação. Desconto é ato de RENEGOCIAÇÃO (FIN2) e cabe ao
--    Gerente da unidade, ao Financeiro da Franqueadora (com autorização do
--    Gerente) e ao Admin Master.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas novas
-- -----------------------------------------------------------------------------
alter table public.payment_installments
  -- Quanto de benefício ESTA parcela perde se atrasar. Congelado no fechamento
  -- da venda: mudar a regra do programa depois não reescreve cobrança antiga.
  -- Já nasce ZERO quando o meio de pagamento não corre risco (cartão/à vista).
  add column if not exists benefit_discount_cents bigint not null default 0,
  -- Espelho do que já foi recebido, por natureza (a soma das baixas ativas).
  add column if not exists paid_benefit_cents bigint not null default 0,
  add column if not exists paid_fee_cents bigint not null default 0,
  add column if not exists paid_interest_cents bigint not null default 0;

comment on column public.payment_installments.benefit_discount_cents is
  'Benefício de programa que esta parcela PERDE se atrasar (boleto e '
  'recorrência no cartão). Zero quando o meio de pagamento não corre risco ou '
  'quando o procedimento ficou 100% gratuito.';

alter table public.payment_receipts
  add column if not exists principal_cents bigint not null default 0,
  add column if not exists benefit_cents bigint not null default 0,
  add column if not exists late_fee_cents bigint not null default 0,
  add column if not exists interest_cents bigint not null default 0;

comment on column public.payment_receipts.principal_cents is
  'Composição da baixa: principal + benefício perdido + multa + juros = '
  'amount_cents. Sem isto o recebimento de uma parcela em atraso ficava '
  'registrado pelo valor original.';

-- Baixas antigas eram só principal (o banco recusava receber mais que o saldo).
update public.payment_receipts
   set principal_cents = amount_cents
 where principal_cents = 0
   and benefit_cents = 0
   and late_fee_cents = 0
   and interest_cents = 0;

-- -----------------------------------------------------------------------------
-- 2) Benefício recuperável de uma venda
-- -----------------------------------------------------------------------------
-- Soma dos descontos de programa dos procedimentos que NÃO ficaram de graça.
-- Exemplo do dono: Limpeza 350 → 0 (sai da base, nunca é cobrada);
-- Extração 400 → 250 (entra com 150); Canal 1.100 → 600 (entra com 500).
create or replace function public.sale_recoverable_benefit_cents(
  p_negotiation_id uuid,
  p_direct_sale_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint := 0;
begin
  if p_negotiation_id is not null then
    select coalesce(sum(ni.program_discount_cents), 0) into v_total
    from public.plan_negotiation_items ni
    join public.plan_negotiations n on n.id = ni.negotiation_id
    join public.treatment_plan_option_items i
      on i.id = ni.item_id and i.option_id = n.option_id
    where ni.negotiation_id = p_negotiation_id
      and ni.included
      and coalesce(ni.program_discount_cents, 0) > 0
      -- Item gratuito (desconto cobre o preço todo) fica de fora.
      and ni.program_discount_cents < i.quantity * i.unit_price_cents;
  elsif p_direct_sale_id is not null then
    select coalesce(sum(it.program_discount_cents), 0) into v_total
    from public.direct_sale_items it
    where it.sale_id = p_direct_sale_id
      and coalesce(it.program_discount_cents, 0) > 0
      and coalesce(it.final_cents, 0) > 0;
  end if;
  return coalesce(v_total, 0);
end;
$$;

grant execute on function public.sale_recoverable_benefit_cents(uuid, uuid)
  to authenticated;

-- Rateia o benefício recuperável entre as parcelas de UMA venda.
-- Proporcional ao valor de cada parcela, resíduo na última; parcelas cujo meio
-- de pagamento não corre risco (cartão/à vista) ficam com ZERO.
create or replace function public.apply_sale_benefit_risk(
  p_negotiation_id uuid,
  p_direct_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_benefit bigint;
  v_sum bigint;
  v_last uuid;
  v_diff bigint;
  v_method text;
begin
  v_benefit := public.sale_recoverable_benefit_cents(
    p_negotiation_id, p_direct_sale_id);

  if p_negotiation_id is not null then
    select n.payment_method into v_method
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.payment_method into v_method
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;

  select coalesce(sum(amount_cents), 0) into v_sum
  from public.payment_installments
  where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
     or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);

  if v_sum <= 0 then return; end if;

  update public.payment_installments t
     set benefit_discount_cents = case
       -- Só boleto e recorrência no cartão correm risco de atraso.
       when coalesce(t.payment_method, v_method)
            in ('boleto', 'credito_recorrente')
         then floor(v_benefit::numeric * t.amount_cents / v_sum)
       else 0
     end
   where (p_negotiation_id is not null and t.negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and t.direct_sale_id = p_direct_sale_id);

  -- Resíduo do rateio na última parcela que corre risco.
  select id into v_last
  from public.payment_installments
  where ((p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id))
    and benefit_discount_cents > 0
  order by seq desc limit 1;

  if v_last is null then return; end if;

  select v_benefit - coalesce(sum(benefit_discount_cents), 0) into v_diff
  from public.payment_installments
  where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
     or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);

  if v_diff <> 0 then
    update public.payment_installments
       set benefit_discount_cents = greatest(0, benefit_discount_cents + v_diff)
     where id = v_last;
  end if;
end;
$$;

grant execute on function public.apply_sale_benefit_risk(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) save_payment_schedule passa a congelar o benefício em risco
-- -----------------------------------------------------------------------------
create or replace function public.save_payment_schedule(
  p_negotiation_id uuid,
  p_direct_sale_id uuid,
  p_entries jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_final integer;
  v_sum integer;
  v_down integer;
  v_entradas int;
  v_user uuid := (select auth.uid());
  v_seq int := 0;
  v_e jsonb;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then
    raise exception 'ORIGIN_REQUIRED';
  end if;

  if p_negotiation_id is not null then
    select n.clinic_id, n.client_id, n.final_cents
      into v_clinic, v_client, v_final
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.clinic_id, s.client_id, s.final_cents
      into v_clinic, v_client, v_final
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  if v_clinic is null then raise exception 'SALE_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic,
         array['unit_manager','receptionist','sdr']::public.user_role[])
    or exists (
      select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p
      where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select coalesce(sum((e->>'amount_cents')::int), 0),
         count(*) filter (where e->>'kind' = 'entrada'),
         coalesce(sum((e->>'amount_cents')::int)
                  filter (where e->>'kind' = 'entrada'), 0)
    into v_sum, v_entradas, v_down
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e;

  if v_entradas > 1 then raise exception 'MULTIPLE_DOWN_PAYMENTS'; end if;
  if v_sum <> coalesce(v_final, 0) then raise exception 'TOTAL_MISMATCH'; end if;

  delete from public.payment_installments
   where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);

  for v_e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_seq := v_seq + 1;
    insert into public.payment_installments
      (clinic_id, client_id, negotiation_id, direct_sale_id, seq, kind,
       due_date, amount_cents, payment_method, created_by)
    values (
      v_clinic, v_client, p_negotiation_id, p_direct_sale_id, v_seq,
      coalesce(v_e->>'kind', 'parcela'),
      (v_e->>'due_date')::date,
      (v_e->>'amount_cents')::int,
      nullif(v_e->>'payment_method', ''),
      v_user
    );
  end loop;

  -- 0188: congela o benefício que cada parcela perde se atrasar.
  perform public.apply_sale_benefit_risk(p_negotiation_id, p_direct_sale_id);

  if p_negotiation_id is not null then
    update public.plan_negotiations
       set down_payment_cents = v_down, updated_at = now()
     where id = p_negotiation_id;
  else
    update public.direct_sales
       set down_payment_cents = v_down, updated_at = now()
     where id = p_direct_sale_id;
  end if;
end;
$$;

grant execute on function public.save_payment_schedule(uuid, uuid, jsonb)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A conta de uma parcela numa data — fonte única da verdade
-- -----------------------------------------------------------------------------
-- Devolve o devido, o pago e o que falta de CADA natureza. Multa e juros usam
-- como base o valor CHEIO da parcela (+ benefício perdido) — nunca o saldo.
create or replace function public.installment_balance(
  p_installment_id uuid,
  p_date date default current_date
)
returns table (
  days_late integer,
  principal_due bigint, principal_paid bigint, principal_rem bigint,
  benefit_due bigint,   benefit_paid bigint,   benefit_rem bigint,
  fee_due bigint,       fee_paid bigint,       fee_rem bigint,
  interest_due bigint,  interest_paid bigint,  interest_rem bigint,
  total_rem bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_days integer;
  v_base bigint;
  v_pp bigint; v_pb bigint; v_pf bigint; v_pi bigint;
  v_bd bigint; v_fd bigint; v_jd bigint;
begin
  select * into v from public.payment_installments where id = p_installment_id;
  if v.id is null then return; end if;

  select coalesce(sum(r.principal_cents), 0), coalesce(sum(r.benefit_cents), 0),
         coalesce(sum(r.late_fee_cents), 0),  coalesce(sum(r.interest_cents), 0)
    into v_pp, v_pb, v_pf, v_pi
  from public.payment_receipts r
  where r.installment_id = p_installment_id
    and not r.reversed and r.reversal_of is null;

  -- Cancelada/renegociada não cobra nada.
  if v.status in ('cancelada', 'renegociada') then
    days_late := 0;
    principal_due := v.amount_cents; principal_paid := v_pp; principal_rem := 0;
    benefit_due := 0;  benefit_paid := v_pb;  benefit_rem := 0;
    fee_due := 0;      fee_paid := v_pf;      fee_rem := 0;
    interest_due := 0; interest_paid := v_pi; interest_rem := 0;
    total_rem := 0;
    return next;
    return;
  end if;

  v_days := greatest(0, (coalesce(p_date, current_date) - v.due_date)
                        - coalesce(v.grace_days, 0));

  -- Perdeu a pontualidade → perde o benefício daquela parcela.
  v_bd := case when v_days > 0
               then coalesce(v.benefit_discount_cents, 0) else 0 end;

  -- Base INTEGRAL: baixa parcial não reduz multa nem juros.
  v_base := v.amount_cents + v_bd;

  if v_days > 0 then
    v_fd := round(v_base * coalesce(v.late_fee_percent, 2) / 100.0);
    v_jd := round(v_base * coalesce(v.monthly_interest_percent, 1)
                  / 100.0 / 30.0 * v_days);
  else
    v_fd := 0;
    v_jd := 0;
  end if;

  days_late := v_days;
  principal_due  := v.amount_cents;
  principal_paid := v_pp;
  principal_rem  := greatest(0, v.amount_cents - v_pp);
  benefit_due  := v_bd; benefit_paid  := v_pb; benefit_rem  := greatest(0, v_bd - v_pb);
  fee_due      := v_fd; fee_paid      := v_pf; fee_rem      := greatest(0, v_fd - v_pf);
  interest_due := v_jd; interest_paid := v_pi; interest_rem := greatest(0, v_jd - v_pi);
  total_rem := principal_rem + benefit_rem + fee_rem + interest_rem;
  return next;
end;
$$;

grant execute on function public.installment_balance(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Situação da parcela derivada das baixas (agora com as 4 naturezas)
-- -----------------------------------------------------------------------------
create or replace function public.refresh_installment_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.installment_id, old.installment_id);
  v_status text;
  v_ref date;
  v_bal record;
  v_last record;
  v_total_paid bigint;
begin
  select status into v_status
  from public.payment_installments where id = v_id;
  if v_status is null then return null; end if;

  -- A conta fecha na data em que o dinheiro entrou, não na de hoje: quem pagou
  -- em dia e teve a baixa lançada depois não deve multa.
  select max(received_at) into v_ref
  from public.payment_receipts
  where installment_id = v_id and not reversed and reversal_of is null;
  v_ref := coalesce(v_ref, current_date);

  select * into v_bal from public.installment_balance(v_id, v_ref);
  v_total_paid := coalesce(v_bal.principal_paid, 0) + coalesce(v_bal.benefit_paid, 0)
                + coalesce(v_bal.fee_paid, 0) + coalesce(v_bal.interest_paid, 0);

  if v_status in ('cancelada', 'renegociada') then
    update public.payment_installments set
      paid_amount_cents   = coalesce(v_bal.principal_paid, 0),
      paid_benefit_cents  = coalesce(v_bal.benefit_paid, 0),
      paid_fee_cents      = coalesce(v_bal.fee_paid, 0),
      paid_interest_cents = coalesce(v_bal.interest_paid, 0)
    where id = v_id;
    return null;
  end if;

  select received_at, created_by into v_last
  from public.payment_receipts
  where installment_id = v_id and not reversed and reversal_of is null
  order by created_at desc limit 1;

  update public.payment_installments set
    paid_amount_cents   = coalesce(v_bal.principal_paid, 0),
    paid_benefit_cents  = coalesce(v_bal.benefit_paid, 0),
    paid_fee_cents      = coalesce(v_bal.fee_paid, 0),
    paid_interest_cents = coalesce(v_bal.interest_paid, 0),
    -- Só quita quem paga TUDO: principal + benefício perdido + multa + juros.
    status = case
      when v_total_paid > 0 and coalesce(v_bal.total_rem, 0) <= 0 then 'paga'
      when v_total_paid > 0 then 'parcial'
      else 'em_aberto'
    end,
    paid_at = case when v_total_paid > 0 and coalesce(v_bal.total_rem, 0) <= 0
                   then coalesce(v_last.received_at::timestamptz, now())
                   else null end,
    paid_by = case when v_total_paid > 0 and coalesce(v_bal.total_rem, 0) <= 0
                   then v_last.created_by else null end
  where id = v_id;

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) O razão passa a separar principal, benefício perdido e multa/juros
-- -----------------------------------------------------------------------------
drop index if exists public.financial_entries_source_unique;
create unique index if not exists financial_entries_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('installment_accrual', 'receipt_cash',
                        'receipt_benefit', 'receipt_late_fee');

create or replace function public.post_installment_accrual(p_installment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_account text;
begin
  select * into v_inst from public.payment_installments where id = p_installment_id;
  if v_inst.id is null then return; end if;

  v_account := case
    when v_inst.direct_sale_id is not null then '1.1.02'
    else '1.1.01'
  end;

  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date,
    expected_settlement_date, amount_cents, direction, status,
    source_type, source_id, description, created_by
  )
  values (
    v_inst.clinic_id, v_account, coalesce(v_inst.created_at::date, current_date),
    null, v_inst.due_date, v_inst.amount_cents, 'inflow', 'open',
    'installment_accrual', v_inst.id,
    case when v_inst.kind = 'entrada' then 'Entrada da venda'
         else 'Parcela ' || v_inst.seq end,
    v_inst.created_by
  )
  on conflict (source_type, source_id) where source_type in
    ('installment_accrual', 'receipt_cash', 'receipt_benefit',
     'receipt_late_fee') do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) REGISTRAR BAIXA — com composição e sem desconto
-- -----------------------------------------------------------------------------
create or replace function public.register_payment_receipt(
  p_installment_id uuid,
  p_amount_cents bigint,
  p_received_at date default current_date,
  p_payment_method text default null,
  p_reference text default null,
  p_notes text default null,
  p_client_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_bal record;
  v_receipt_id uuid;
  v_rest bigint;
  v_p bigint; v_b bigint; v_f bigint; v_j bigint;
  v_account text;
  v_user uuid := (select auth.uid());
begin
  select * into v_inst from public.payment_installments where id = p_installment_id;
  if v_inst.id is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not public.can_receive_payment(v_inst.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_inst.status in ('cancelada', 'renegociada') then
    raise exception 'INSTALLMENT_CLOSED';
  end if;
  -- Quitada não recebe baixa nova: os juros pararam de correr no dia em que ela
  -- foi paga, e installment_balance calcula na data pedida.
  if v_inst.status = 'paga' then raise exception 'INSTALLMENT_SETTLED'; end if;

  -- Idempotência: mesma baixa reenviada devolve a que já existe.
  if p_client_token is not null then
    select id into v_receipt_id from public.payment_receipts
    where client_token = p_client_token;
    if v_receipt_id is not null then return v_receipt_id; end if;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_bal
  from public.installment_balance(
    p_installment_id, coalesce(p_received_at, current_date));
  if v_bal.total_rem is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if coalesce(v_bal.total_rem, 0) <= 0 then raise exception 'INSTALLMENT_SETTLED'; end if;
  if p_amount_cents > v_bal.total_rem then raise exception 'AMOUNT_OVER_BALANCE'; end if;

  -- Ordem de abatimento: principal → benefício perdido → multa → juros.
  v_rest := p_amount_cents;
  v_p := least(v_rest, v_bal.principal_rem); v_rest := v_rest - v_p;
  v_b := least(v_rest, v_bal.benefit_rem);   v_rest := v_rest - v_b;
  v_f := least(v_rest, v_bal.fee_rem);       v_rest := v_rest - v_f;
  v_j := v_rest;

  insert into public.payment_receipts (
    clinic_id, installment_id, amount_cents, received_at, payment_method,
    reference, notes, client_token, created_by,
    principal_cents, benefit_cents, late_fee_cents, interest_cents
  ) values (
    v_inst.clinic_id, p_installment_id, p_amount_cents,
    coalesce(p_received_at, current_date), nullif(p_payment_method, ''),
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''),
    p_client_token, v_user, v_p, v_b, v_f, v_j
  )
  returning id into v_receipt_id;

  v_account := case
    when v_inst.direct_sale_id is not null then '1.1.02' else '1.1.01' end;

  -- CAIXA no razão (DFC), uma linha por natureza — para a DRE separar receita
  -- de serviço de receita financeira.
  if v_p > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_inst.clinic_id, v_account,
      coalesce(v_inst.created_at::date, coalesce(p_received_at, current_date)),
      coalesce(p_received_at, current_date), v_p, 'inflow', 'settled',
      'receipt_cash', v_receipt_id, 'Recebimento de parcela', v_user
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee') do nothing;
  end if;

  if v_b > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_inst.clinic_id, v_account, coalesce(p_received_at, current_date),
      coalesce(p_received_at, current_date), v_b, 'inflow', 'settled',
      'receipt_benefit', v_receipt_id,
      'Benefício perdido por atraso', v_user
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee') do nothing;
  end if;

  if (v_f + v_j) > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_inst.clinic_id, '4.1.01', coalesce(p_received_at, current_date),
      coalesce(p_received_at, current_date), v_f + v_j, 'inflow', 'settled',
      'receipt_late_fee', v_receipt_id,
      'Multa e juros por atraso', v_user
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee') do nothing;
  end if;

  return v_receipt_id;
end;
$$;

grant execute on function public.register_payment_receipt(
  uuid, bigint, date, text, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) ESTORNAR — desfaz as três naturezas
-- -----------------------------------------------------------------------------
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
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description,
    reversal_of, reversal_reason, created_by
  )
  select e.clinic_id, e.account_code, e.accrual_date, current_date,
         e.amount_cents, 'outflow', 'settled', e.source_type, v_new_id,
         'Estorno — ' || coalesce(e.description, 'recebimento'),
         e.id, btrim(p_reason), v_user
  from public.financial_entries e
  where e.source_id = p_receipt_id
    and e.source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee')
    and e.reversal_of is null;

  update public.financial_entries set status = 'reversed'
   where source_id = p_receipt_id
     and source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee')
     and reversal_of is null;

  return v_new_id;
end;
$$;

grant execute on function public.reverse_payment_receipt(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) mark_installment_paid — baixa do total ATUALIZADO
-- -----------------------------------------------------------------------------
create or replace function public.mark_installment_paid(
  p_installment_id uuid,
  p_paid boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_bal record;
  v_rec uuid;
begin
  select * into v_inst from public.payment_installments where id = p_installment_id;
  if v_inst.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.can_receive_payment(v_inst.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_paid then
    select * into v_bal from public.installment_balance(p_installment_id, current_date);
    if coalesce(v_bal.total_rem, 0) > 0 then
      perform public.register_payment_receipt(
        p_installment_id, v_bal.total_rem, current_date, v_inst.payment_method,
        null, 'Baixa total', null);
    end if;
  else
    for v_rec in
      select id from public.payment_receipts
      where installment_id = p_installment_id
        and not reversed and reversal_of is null
    loop
      perform public.reverse_payment_receipt(v_rec, 'Baixa desfeita');
    end loop;
  end if;
end;
$$;

grant execute on function public.mark_installment_paid(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 10) Reparo retroativo
-- -----------------------------------------------------------------------------
-- Vendas que já têm cobrança ganham o benefício em risco congelado.
do $$
declare
  r record;
begin
  for r in
    select distinct negotiation_id, direct_sale_id
    from public.payment_installments
  loop
    perform public.apply_sale_benefit_risk(r.negotiation_id, r.direct_sale_id);
  end loop;
end $$;

-- Espelho do que já foi recebido por natureza.
update public.payment_installments i set
  paid_benefit_cents = coalesce(x.b, 0),
  paid_fee_cents = coalesce(x.f, 0),
  paid_interest_cents = coalesce(x.j, 0),
  paid_amount_cents = coalesce(x.p, 0)
from (
  select installment_id,
         sum(principal_cents) p, sum(benefit_cents) b,
         sum(late_fee_cents) f, sum(interest_cents) j
  from public.payment_receipts
  where not reversed and reversal_of is null
  group by installment_id
) x
where x.installment_id = i.id;

select count(*)::integer as parcelas_com_beneficio_em_risco
from public.payment_installments where benefit_discount_cents > 0;
