-- =============================================================================
-- 0198 — FIN4b.1: taxa fixa, franquia mensal, dias úteis e todos os meios
-- -----------------------------------------------------------------------------
-- O dono trouxe a tabela real do Asaas e ela mostrou três buracos no modelo da
-- 0197:
--
--   1) TAXA FIXA POR TRANSAÇÃO. "2,39% + R$ 0,29", "R$ 1,99 por boleto",
--      "R$ 1,49 por PIX". Só percentual não representa a realidade — e numa
--      cobrança pequena a parte fixa é a maior parte do custo.
--   2) BOLETO E PIX TAMBÉM CUSTAM. A 0197 só tinha modalidades de cartão, o
--      que fazia o sistema tratar boleto e PIX como grátis.
--   3) FRANQUIA MENSAL. "100 recebimentos gratuitos por mês" no PIX.
--
-- E o prazo: "1 dia útil" (boleto) é diferente de "32 dias" (cartão). Agora a
-- faixa diz qual dos dois é.
--
-- LIMITE CONHECIDO: dia útil aqui pula sábado e domingo, mas NÃO pula feriado —
-- o sistema não tem calendário de feriados. Em janeiro e no carnaval a data
-- projetada sai otimista. Está na fila para quando houver calendário.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Modalidades novas + campos que faltavam
-- -----------------------------------------------------------------------------
alter table public.acquirer_rates
  drop constraint if exists acquirer_rates_modality_check;
alter table public.acquirer_rates
  add constraint acquirer_rates_modality_check
  check (modality in ('debito', 'credito_avista', 'credito_parcelado',
                      'recorrente', 'boleto', 'pix', 'cartao_voucher'));

alter table public.acquirer_rates
  -- Os R$ 0,29 / R$ 1,99 / R$ 1,49 por transação.
  add column if not exists fixed_fee_cents bigint not null default 0
    check (fixed_fee_cents >= 0),
  -- "1 dia útil" × "32 dias": prazos diferentes de verdade.
  add column if not exists settlement_business_days boolean not null default false,
  -- "100 recebimentos gratuitos por mês". Nulo = sem franquia.
  add column if not exists free_monthly_count integer
    check (free_monthly_count is null or free_monthly_count > 0);

comment on column public.acquirer_rates.fixed_fee_cents is
  'Parte FIXA da taxa, por transação. Numa cobrança pequena ela pesa mais que '
  'o percentual — ignorar isso subestima o custo do meio de pagamento.';
comment on column public.acquirer_rates.settlement_business_days is
  'Prazo em dias ÚTEIS (pula fim de semana). Feriado NÃO é considerado: o '
  'sistema ainda não tem calendário de feriados.';

-- -----------------------------------------------------------------------------
-- 2) Dias úteis (sem feriado — ver limite no cabeçalho)
-- -----------------------------------------------------------------------------
create or replace function public.add_business_days(p_date date, p_days integer)
returns date
language plpgsql
immutable
as $$
declare
  v_date date := p_date;
  v_left integer := greatest(0, coalesce(p_days, 0));
begin
  while v_left > 0 loop
    v_date := v_date + 1;
    -- 0 = domingo, 6 = sábado.
    if extract(dow from v_date) not in (0, 6) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_date;
end;
$$;

grant execute on function public.add_business_days(date, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A taxa vigente agora devolve tudo
-- -----------------------------------------------------------------------------
drop function if exists public.acquirer_rate_for(uuid, text, integer, date);

create or replace function public.acquirer_rate_for(
  p_acquirer_id uuid,
  p_modality text,
  p_installments integer,
  p_date date default current_date
)
returns table (
  fee_percent numeric,
  fixed_fee_cents bigint,
  settlement_days integer,
  settlement_business_days boolean,
  free_monthly_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.fee_percent, r.fixed_fee_cents, r.settlement_days,
         r.settlement_business_days, r.free_monthly_count
  from public.acquirer_rates r
  where r.acquirer_id = p_acquirer_id
    and r.modality = p_modality
    and coalesce(p_installments, 1) between r.min_installments and r.max_installments
    and r.valid_from <= coalesce(p_date, current_date)
    and (r.valid_to is null or r.valid_to >= coalesce(p_date, current_date))
  order by r.valid_from desc
  limit 1;
$$;

grant execute on function public.acquirer_rate_for(uuid, text, integer, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A modalidade cobre boleto e PIX (não só cartão)
-- -----------------------------------------------------------------------------
create or replace function public.card_modality_of(
  p_payment_method text,
  p_installments integer
)
returns text
language sql
immutable
as $$
  select case
    when p_payment_method = 'credito_recorrente' then 'recorrente'
    when p_payment_method = 'cartao_parcelado' then 'credito_parcelado'
    when p_payment_method = 'cartao' then
      case when coalesce(p_installments, 1) > 1
           then 'credito_parcelado' else 'credito_avista' end
    when p_payment_method = 'boleto' then 'boleto'
    when p_payment_method = 'pix' then 'pix'
    else null
  end;
$$;

-- -----------------------------------------------------------------------------
-- 5) A baixa: percentual + fixa, franquia do mês e prazo em dias úteis
-- -----------------------------------------------------------------------------
alter table public.payment_receipts
  add column if not exists acquirer_fixed_fee_cents bigint not null default 0,
  add column if not exists acquirer_fee_waived boolean not null default false;

comment on column public.payment_receipts.acquirer_fee_waived is
  'A taxa fixa caiu na franquia gratuita do mês (ex.: os 100 PIX do Asaas).';

create or replace function public.apply_acquirer_fee(
  p_receipt_id uuid,
  p_acquirer_id uuid,
  p_modality text,
  p_installments integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
  v_acc record;
  v_rate record;
  v_percent_fee bigint;
  v_fixed bigint;
  v_fee bigint;
  v_settle date;
  v_used integer;
  v_waived boolean := false;
begin
  select * into v_rec from public.payment_receipts where id = p_receipt_id;
  if v_rec.id is null then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if not public.can_receive_payment(v_rec.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_rec.acquirer_id is not null then raise exception 'FEE_ALREADY_APPLIED'; end if;

  select * into v_acc from public.card_acquirers where id = p_acquirer_id;
  if v_acc.id is null then raise exception 'ACQUIRER_NOT_FOUND'; end if;
  if v_acc.clinic_id <> v_rec.clinic_id then raise exception 'CLINIC_MISMATCH'; end if;

  select * into v_rate
  from public.acquirer_rate_for(
    p_acquirer_id, p_modality, p_installments, v_rec.received_at);
  if v_rate.fee_percent is null then raise exception 'RATE_NOT_FOUND'; end if;

  -- Franquia do mês: quantas já usaram esta modalidade nesta adquirente.
  if v_rate.free_monthly_count is not null then
    select count(*)::integer into v_used
    from public.payment_receipts r
    where r.acquirer_id = p_acquirer_id
      and r.acquirer_modality = p_modality
      and not r.reversed and r.reversal_of is null
      and date_trunc('month', r.received_at)
          = date_trunc('month', v_rec.received_at);
    if v_used < v_rate.free_monthly_count then v_waived := true; end if;
  end if;

  v_percent_fee := round(v_rec.amount_cents * v_rate.fee_percent / 100.0);
  v_fixed := case when v_waived then 0 else coalesce(v_rate.fixed_fee_cents, 0) end;
  v_fee := v_percent_fee + v_fixed;

  v_settle := case
    when v_rate.settlement_business_days
      then public.add_business_days(v_rec.received_at,
                                    coalesce(v_rate.settlement_days, 0))
    else v_rec.received_at + coalesce(v_rate.settlement_days, 0)
  end;

  update public.payment_receipts set
    acquirer_id = p_acquirer_id,
    acquirer_modality = p_modality,
    acquirer_fee_cents = v_fee,
    acquirer_fixed_fee_cents = v_fixed,
    acquirer_fee_percent = v_rate.fee_percent,
    acquirer_fee_waived = v_waived,
    settlement_date = v_settle
  where id = p_receipt_id;

  if v_fee > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_rec.clinic_id, '2.4.01', v_rec.received_at, v_settle, v_settle,
      v_fee, 'outflow', 'settled', 'acquirer_fee', p_receipt_id,
      'Taxa de ' || v_acc.name || ' — ' || p_modality, (select auth.uid())
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee',
       'acquirer_fee') do nothing;
  end if;

  update public.financial_entries
     set cash_date = v_settle, expected_settlement_date = v_settle
   where source_type = 'receipt_cash' and source_id = p_receipt_id;

  return jsonb_build_object(
    'fee_cents', v_fee,
    'percent_fee_cents', v_percent_fee,
    'fixed_fee_cents', v_fixed,
    'fee_percent', v_rate.fee_percent,
    'waived', v_waived,
    'settlement_date', v_settle,
    'net_cents', v_rec.amount_cents - v_fee);
end;
$$;

grant execute on function public.apply_acquirer_fee(uuid, uuid, text, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6) A projeção também respeita dias úteis
-- -----------------------------------------------------------------------------
create or replace function public.apply_settlement_projection(
  p_negotiation_id uuid,
  p_direct_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_method text;
  v_installments integer;
  v_modality text;
  v_acquirer uuid;
  v_rate record;
begin
  if p_negotiation_id is not null then
    select n.clinic_id, n.payment_method, n.installments
      into v_clinic, v_method, v_installments
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.clinic_id, s.payment_method, s.installments
      into v_clinic, v_method, v_installments
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  if v_clinic is null then return; end if;

  v_modality := public.card_modality_of(v_method, v_installments);

  if v_modality is null then
    update public.payment_installments
       set expected_settlement_date = due_date, acquirer_id = null
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  select id into v_acquirer from public.card_acquirers
  where clinic_id = v_clinic and active and is_default limit 1;
  if v_acquirer is null then
    select id into v_acquirer from public.card_acquirers
    where clinic_id = v_clinic and active order by name limit 1;
  end if;

  if v_acquirer is null then
    update public.payment_installments
       set expected_settlement_date = due_date
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  select * into v_rate
  from public.acquirer_rate_for(v_acquirer, v_modality, v_installments, current_date);

  -- Sem taxa cadastrada para esta modalidade, o dinheiro cai no vencimento —
  -- melhor não inventar prazo do que projetar errado.
  if v_rate.settlement_days is null then
    update public.payment_installments
       set acquirer_id = v_acquirer, expected_settlement_date = due_date
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  update public.payment_installments
     set acquirer_id = v_acquirer,
         expected_settlement_date = case
           when v_rate.settlement_business_days
             then public.add_business_days(due_date, v_rate.settlement_days)
           else due_date + v_rate.settlement_days
         end
   where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
end;
$$;

-- Reavalia as cobranças em aberto com o modelo novo.
do $$
declare
  r record;
begin
  for r in
    select distinct negotiation_id, direct_sale_id
    from public.payment_installments
    where status in ('em_aberto', 'parcial')
  loop
    perform public.apply_settlement_projection(r.negotiation_id, r.direct_sale_id);
  end loop;
end $$;

select
  (select count(*) from public.acquirer_rates) as faixas_de_taxa,
  (select count(*) from public.payment_installments
    where expected_settlement_date is not null) as parcelas_com_liquidacao;
