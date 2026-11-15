-- =============================================================================
-- 4013 — ASA4, entrega 2 (parte 1): CARTÃO PARCELADO PELO ASAAS (spec 19.19 a
-- 19.22; plano revisado APROVADO pelo Jeferson em 14/11/2026, com ressalvas)
-- -----------------------------------------------------------------------------
-- O MEIO NOVO `cartao_parcelado_asaas`, separado da maquininha (`cartao_parcelado`).
-- O BLOCO: as parcelas da venda com esse meio formam UM parcelamento no Asaas
-- (`POST /payments` com `installmentCount` + `totalValue`). O Asaas faz valores
-- iguais com a sobra na ÚLTIMA e datas mês a mês no dia do 1º vencimento: o
-- riSZon confere isso ao salvar o parcelamento (`_card_block_check`).
-- UMA COBRANÇA DO riSZon POR PARCELA (`charges`), ligada à SUA parcela no Asaas:
-- o parcelamento nasce com a referência do bloco e o servidor troca a referência
-- de cada parcela pela da sua cobrança (`PUT /payments/{id}`, provado no sandbox,
-- 19.23). Assim o aviso, a baixa, a tarifa e o split de hoje valem parcela a
-- parcela. As cobranças do bloco ficam agrupadas por `installment_block`.
-- NASCE INTEIRO NA ASSINATURA (o cartão é cobrado uma vez), pela mesma marca
-- da entrega 1; também à mão (`charge_block_prepare`) e pela rotina diária.
-- A BAIXA: cada parcela no seu aviso, com o meio "cartão parcelado"; a tarifa
-- é a do parcelado (`credito_parcelado`); a 1ª fecha a venda (D21).
-- O SPLIT por parcela, pelo Método B com a parte fixa rateada (19.19.2):
-- q = p ÷ (1 − a); F = q × (b ÷ n cortado no centavo).
-- A TAXA "A RETER PELO SPLIT" (19.19.4): a da parcela que ainda não foi
-- creditada não vira conta a pagar (nasce retida, como hoje) e aparece à parte
-- no apurado do mês (`network_fee_summary.awaiting_cents`).
-- CANCELAR E ESTORNAR só o parcelamento inteiro (as portas por parcela recusam);
-- o pedido de estorno mostra antes o que a unidade perde (19.20, 2a).
-- Nenhum dado é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O MEIO NOVO (só acrescenta valores)
-- -----------------------------------------------------------------------------
alter table public.direct_sales drop constraint if exists direct_sales_payment_method_check;
alter table public.direct_sales add constraint direct_sales_payment_method_check
  check (payment_method is null or payment_method in
    ('pix', 'boleto', 'cartao', 'cartao_parcelado', 'cartao_parcelado_asaas', 'credito_recorrente',
     'deposito_avista', 'dinheiro', 'permuta'));

alter table public.payment_installments drop constraint if exists payment_installments_payment_method_check;
alter table public.payment_installments add constraint payment_installments_payment_method_check
  check (payment_method is null or payment_method in
    ('pix', 'boleto', 'cartao', 'cartao_parcelado', 'cartao_parcelado_asaas', 'credito_recorrente',
     'deposito_avista', 'dinheiro', 'permuta'));

alter table public.plan_negotiations drop constraint if exists plan_negotiations_payment_method_check;
alter table public.plan_negotiations add constraint plan_negotiations_payment_method_check
  check (payment_method is null or payment_method in
    ('pix', 'boleto', 'cartao', 'cartao_parcelado', 'cartao_parcelado_asaas', 'credito_recorrente', 'deposito_avista'));

-- A venda direta nova aceita o meio novo sempre (a maquininha continua pela chave).
create or replace function public._direct_sale_method_ok(p_method text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_method is null
      or p_method in ('pix', 'boleto', 'cartao', 'cartao_parcelado_asaas', 'dinheiro', 'permuta')
      or (p_method = 'cartao_parcelado'
          and coalesce((select s.card_machine_direct_sale from public.sale_method_settings s where s.id), false));
$$;
revoke execute on function public._direct_sale_method_ok(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A COBRANÇA DA PARCELA SABE DO PARCELAMENTO
-- -----------------------------------------------------------------------------
alter table public.charges add column if not exists installment_block uuid;
alter table public.charges add column if not exists installment_count smallint;
alter table public.charges add column if not exists installment_number smallint;
alter table public.charges add column if not exists asaas_installment_id text;
create index if not exists charges_installment_block_idx on public.charges (installment_block) where installment_block is not null;

alter table public.charges drop constraint if exists charges_installment_block_check;
alter table public.charges add constraint charges_installment_block_check check (
  (installment_block is null and installment_count is null and installment_number is null)
  or (installment_block is not null and installment_count between 2 and 21
      and installment_number between 1 and installment_count and billing_type = 'CREDIT_CARD'));

-- A parcela do bloco só nasce dentro do parcelamento (nunca sozinha, por engano).
create or replace function public.charges_card_block_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method text;
begin
  if new.payment_installment_id is null then return new; end if;
  select i.payment_method into v_method from public.payment_installments i where i.id = new.payment_installment_id;
  if v_method = 'cartao_parcelado_asaas' and new.installment_block is null and not coalesce(new.is_external, false) then
    raise exception 'USE_O_PARCELAMENTO';
  end if;
  if new.installment_block is not null and v_method is distinct from 'cartao_parcelado_asaas' then
    raise exception 'METHOD_NOT_SUPPORTED';
  end if;
  return new;
end;
$$;
revoke execute on function public.charges_card_block_rule() from public, anon, authenticated;
drop trigger if exists charges_card_block_rule on public.charges;
create trigger charges_card_block_rule
  before insert on public.charges
  for each row execute function public.charges_card_block_rule();

-- A baixa à mão não vale na parcela do parcelado pelo Asaas (só o aviso do Asaas).
create or replace function public.payment_receipts_card_block_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('risarte.baixa_do_asaas', true), '') = '1' then return new; end if;
  if new.reversal_of is not null then return new; end if;
  if exists (select 1 from public.payment_installments i
              where i.id = new.installment_id and i.payment_method = 'cartao_parcelado_asaas') then
    raise exception 'PARCELADO_ASAAS_SO_PELO_ASAAS';
  end if;
  return new;
end;
$$;
revoke execute on function public.payment_receipts_card_block_rule() from public, anon, authenticated;
drop trigger if exists payment_receipts_card_block_rule on public.payment_receipts;
create trigger payment_receipts_card_block_rule
  before insert on public.payment_receipts
  for each row execute function public.payment_receipts_card_block_rule();

-- -----------------------------------------------------------------------------
-- 3) O BLOCO: as parcelas, a conferência e a data de crédito
-- -----------------------------------------------------------------------------
create or replace function public._card_block_rows(p_negotiation_id uuid, p_direct_sale_id uuid)
returns setof public.payment_installments
language sql
stable
security definer
set search_path = ''
as $$
  select i.* from public.payment_installments i
   where i.payment_method = 'cartao_parcelado_asaas'
     and i.status <> 'cancelada' and i.renegotiation_id is null
     and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))
   order by i.due_date, i.seq;
$$;
revoke execute on function public._card_block_rows(uuid, uuid) from public, anon, authenticated;

-- O que o Asaas faz (provado no sandbox, 19.19.1): valores iguais, a sobra na
-- ÚLTIMA; vencimentos mês a mês, no mesmo dia do 1º. De 2 a 21 parcelas.
create or replace function public._card_block_check(p_negotiation_id uuid, p_direct_sale_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_total bigint;
  v_base bigint;
  v_first date;
  r record;
  k integer := 0;
begin
  select count(*), sum(i.amount_cents), min(i.due_date) into v_n, v_total, v_first
    from public._card_block_rows(p_negotiation_id, p_direct_sale_id) i;
  if coalesce(v_n, 0) = 0 then return; end if;
  if v_n < 2 then raise exception 'PARCELADO_ASAAS_MIN_2'; end if;
  if v_n > 21 then raise exception 'PARCELADO_ASAAS_MAX_21'; end if;
  if extract(day from v_first) > 28 then raise exception 'PARCELADO_ASAAS_DIA'; end if;
  v_base := floor(v_total::numeric / v_n);
  for r in select * from public._card_block_rows(p_negotiation_id, p_direct_sale_id) loop
    if r.due_date <> (v_first + make_interval(months => k))::date then
      raise exception 'PARCELADO_ASAAS_DATAS';
    end if;
    if r.amount_cents <> (case when k = v_n - 1 then v_total - v_base * (v_n - 1) else v_base end) then
      raise exception 'PARCELADO_ASAAS_VALORES';
    end if;
    k := k + 1;
  end loop;
end;
$$;
revoke execute on function public._card_block_check(uuid, uuid) from public, anon, authenticated;

-- A previsão de crédito: cerca de 30 dias depois de cada vencimento (19.19.1);
-- a data certa vem do Asaas na aprovação (`estimatedCreditDate`).
create or replace function public._card_block_project(p_negotiation_id uuid, p_direct_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_acq uuid;
begin
  perform public._card_block_check(p_negotiation_id, p_direct_sale_id);
  select i.clinic_id into v_clinic from public._card_block_rows(p_negotiation_id, p_direct_sale_id) i limit 1;
  if v_clinic is null then return; end if;
  select a.id into v_acq from public.card_acquirers a
    join public.gateway_accounts g on g.id = a.gateway_account_id
   where g.clinic_id = v_clinic and g.status = 'active' limit 1;
  update public.payment_installments i
     set expected_settlement_date = i.due_date + 30, acquirer_id = v_acq
   where i.id in (select b.id from public._card_block_rows(p_negotiation_id, p_direct_sale_id) b)
     and i.status in ('em_aberto', 'parcial');
end;
$$;
revoke execute on function public._card_block_project(uuid, uuid) from public, anon, authenticated;

-- A projeção de sempre (4011) e, depois, o bloco do parcelado pelo Asaas.
create or replace function public._settlement_projection_base(
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
  v_rule text;
  v_card_n integer;
begin
  if p_negotiation_id is not null then
    select n.clinic_id, n.payment_method, n.installments
      into v_clinic, v_method, v_installments
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.clinic_id, s.payment_method, s.installments, s.method_rule
      into v_clinic, v_method, v_installments, v_rule
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  if v_clinic is null then return; end if;

  -- 4011: venda direta nova — cada parcela pelo SEU meio. Só a de cartão
  -- parcelado (maquininha) ganha adquirente; o resto liquida no vencimento.
  -- Parcela já paga não muda.
  if p_direct_sale_id is not null and v_rule = 'asa4' then
    update public.payment_installments
       set expected_settlement_date = due_date, acquirer_id = null
     where direct_sale_id = p_direct_sale_id
       and status in ('em_aberto', 'parcial')
       and coalesce(payment_method, v_method, '') not in ('cartao_parcelado', 'cartao_parcelado_asaas');

    select count(*) into v_card_n from public.payment_installments
     where direct_sale_id = p_direct_sale_id
       and coalesce(payment_method, v_method) = 'cartao_parcelado'
       and status <> 'cancelada';
    if v_card_n = 0 then return; end if;

    select a.id into v_acquirer
    from public.card_acquirers a
    where a.active and public.acquirer_applies_to(a.id, v_clinic)
    order by (a.clinic_id is not null) desc, a.is_default desc, a.name
    limit 1;
    if v_acquirer is not null then
      select * into v_rate
      from public.acquirer_rate_for(v_acquirer, 'credito_parcelado', v_card_n, current_date);
    end if;
    update public.payment_installments
       set acquirer_id = v_acquirer,
           expected_settlement_date = case
             when v_rate.settlement_days is null then due_date
             when v_rate.settlement_business_days then public.add_business_days(due_date, v_rate.settlement_days)
             else due_date + v_rate.settlement_days
           end
     where direct_sale_id = p_direct_sale_id
       and status in ('em_aberto', 'parcial')
       and coalesce(payment_method, v_method) = 'cartao_parcelado';
    return;
  end if;

  v_modality := public.card_modality_of(v_method, v_installments);

  if v_modality is null then
    update public.payment_installments
       set expected_settlement_date = due_date, acquirer_id = null
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  select a.id into v_acquirer
  from public.card_acquirers a
  where a.active and public.acquirer_applies_to(a.id, v_clinic)
  order by (a.clinic_id is not null) desc, a.is_default desc, a.name
  limit 1;

  if v_acquirer is null then
    update public.payment_installments
       set expected_settlement_date = due_date
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  select * into v_rate
  from public.acquirer_rate_for(v_acquirer, v_modality, v_installments, current_date);

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
revoke execute on function public._settlement_projection_base(uuid, uuid) from public, anon, authenticated;

create or replace function public.apply_settlement_projection(
  p_negotiation_id uuid,
  p_direct_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._settlement_projection_base(p_negotiation_id, p_direct_sale_id);
  perform public._card_block_project(p_negotiation_id, p_direct_sale_id);
end;
$$;
revoke execute on function public.apply_settlement_projection(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) O PARCELAMENTO NASCE: a lista e as portas (servidor e à mão)
-- -----------------------------------------------------------------------------
-- O bloco que já tem cobrança viva (ou foi cancelado À MÃO) não entra de novo.
create or replace function public._card_block_has_charge(p_negotiation_id uuid, p_direct_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.charges c
      join public._card_block_rows(p_negotiation_id, p_direct_sale_id) i on i.id = c.payment_installment_id
     where c.installment_block is not null
       and (c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'paga', 'liquidada', 'em_contestacao')
            or (c.status = 'cancelada' and c.cancelled_by is not null)));
$$;
revoke execute on function public._card_block_has_charge(uuid, uuid) from public, anon, authenticated;

create or replace function public._card_blocks_due(
  p_clinic_id uuid, p_negotiation_id uuid, p_direct_sale_id uuid, p_limit integer
)
returns table (clinic_id uuid, negotiation_id uuid, direct_sale_id uuid, parcelas integer, total_cents bigint, origem text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.clinic_id, m.negotiation_id, m.direct_sale_id, k.n, k.total, m.source
    from public.sale_auto_charges m
    cross join lateral (
      select min(i.clinic_id::text)::uuid as clinic_id, count(*)::integer as n, sum(i.amount_cents)::bigint as total,
             bool_and(i.status = 'em_aberto') as abertas
        from public._card_block_rows(m.negotiation_id, m.direct_sale_id) i
    ) k
   where k.n >= 2 and k.abertas
     and not public._card_block_has_charge(m.negotiation_id, m.direct_sale_id)
     and public.central_is_ready(k.clinic_id)
     and (p_clinic_id is null or k.clinic_id = p_clinic_id)
     and (p_negotiation_id is null or m.negotiation_id = p_negotiation_id)
     and (p_direct_sale_id is null or m.direct_sale_id = p_direct_sale_id)
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke execute on function public._card_blocks_due(uuid, uuid, uuid, integer) from public, anon, authenticated;

-- Cria as cobranças do bloco (uma por parcela), todas "emitindo", com o mesmo
-- `installment_block`. A conferência de cada parcela é a da emissão manual
-- (`_charge_compute`: contrato assinado, unidade pronta, pagador); o valor é o
-- devido em dia (o cartão é cobrado na aprovação, antes de qualquer vencimento),
-- sem desconto, multa ou juros (o cartão não tem).
create or replace function public._card_block_insert(
  p_negotiation_id uuid, p_direct_sale_id uuid, p_actor uuid, p_origin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block uuid := gen_random_uuid();
  v_n integer;
  r record;
  v record;
  v_bal record;
  k integer := 0;
begin
  perform 1 from public.payment_installments i
   where i.id in (select b.id from public._card_block_rows(p_negotiation_id, p_direct_sale_id) b) for update;
  perform public._card_block_check(p_negotiation_id, p_direct_sale_id);
  select count(*) into v_n from public._card_block_rows(p_negotiation_id, p_direct_sale_id);
  if v_n < 2 then raise exception 'PARCELADO_ASAAS_MIN_2'; end if;
  if public._card_block_has_charge(p_negotiation_id, p_direct_sale_id) then raise exception 'CHARGE_ALREADY_ACTIVE'; end if;
  for r in select * from public._card_block_rows(p_negotiation_id, p_direct_sale_id) loop
    if r.status <> 'em_aberto' then raise exception 'PARCELADO_ASAAS_PARCELA_PAGA'; end if;
    select * into v from public._charge_compute(r.id, 'CREDIT_CARD', null);
    if v.error_code is not null then raise exception '%', v.error_code; end if;
    select * into v_bal from public.installment_balance(r.id, r.due_date);
    k := k + 1;
    insert into public.charges (
      clinic_id, gateway_account_id, source_type, payment_installment_id, client_id,
      payer_kind, payer_guardian_id, billing_type, value_cents, discount_cents,
      fine_percent, fine_cents, interest_percent, due_date, is_overdue_reissue, status, created_by, auto_origin,
      installment_block, installment_count, installment_number
    ) values (
      r.clinic_id, v.gateway_account_id, 'installment', r.id, v.client_id,
      v.payer_kind, v.payer_guardian_id, 'CREDIT_CARD', v_bal.principal_rem, 0,
      0, 0, 0, r.due_date, false, 'emitindo', p_actor, p_origin,
      v_block, v_n, k
    );
  end loop;
  return v_block;
end;
$$;
revoke execute on function public._card_block_insert(uuid, uuid, uuid, text) from public, anon, authenticated;

-- A porta SEM USUÁRIO (só o servidor): o bloco da venda marcada na assinatura.
create or replace function public._card_block_prepare_system(
  p_negotiation_id uuid, p_direct_sale_id uuid, p_origin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public._card_blocks_due(null, p_negotiation_id, p_direct_sale_id, 1000)) then
    raise exception 'NOT_DUE';
  end if;
  return public._card_block_insert(p_negotiation_id, p_direct_sale_id, null, p_origin);
end;
$$;
revoke execute on function public._card_block_prepare_system(uuid, uuid, text) from public, anon, authenticated;

-- À MÃO (venda assinada antes de ligar a unidade, ou depois de um erro): quem
-- pode emitir cobrança na unidade.
create or replace function public.charge_block_prepare(p_negotiation_id uuid, p_direct_sale_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  select i.clinic_id into v_clinic from public._card_block_rows(p_negotiation_id, p_direct_sale_id) i limit 1;
  if v_clinic is null then raise exception 'PARCELADO_ASAAS_SEM_BLOCO'; end if;
  if not public._charge_can('emit', v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  return public._card_block_insert(p_negotiation_id, p_direct_sale_id, (select auth.uid()), null);
end;
$$;
revoke execute on function public.charge_block_prepare(uuid, uuid) from public, anon, authenticated;
grant execute on function public.charge_block_prepare(uuid, uuid) to authenticated;

-- A emissão que falhou antes de chegar ao Asaas: as cobranças do bloco saem de
-- "emitindo" para "erro_emissao" (e podem ser criadas de novo).
create or replace function public._card_block_mark_error(p_block uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.charges set status = 'erro_emissao', error_code = left(coalesce(p_error, 'erro'), 200)
   where installment_block = p_block and status = 'emitindo';
end;
$$;
revoke execute on function public._card_block_mark_error(uuid, text) from public, anon, authenticated;

-- O parcelamento existe no Asaas: guarda o id do parcelamento em todas as cobranças.
create or replace function public._card_block_save_installment(p_block uuid, p_asaas_installment_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.charges set asaas_installment_id = p_asaas_installment_id where installment_block = p_block;
$$;
revoke execute on function public._card_block_save_installment(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) A BAIXA: meio "cartão parcelado" e a tarifa do parcelado
-- -----------------------------------------------------------------------------
create or replace function public._gateway_on_paid(p_charge_id uuid, p_event text, p_payment jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  i public.payment_installments%rowtype;
  v_pid text := p_payment->>'id';
  v_paid bigint := round(coalesce((p_payment->>'value')::numeric, 0) * 100);
  v_net bigint := round((p_payment->>'netValue')::numeric * 100);
  v_on date := coalesce((p_payment->>'clientPaymentDate')::date, (p_payment->>'paymentDate')::date,
                        (p_payment->>'confirmedDate')::date, public.today_br());
  v_credit date := coalesce((p_payment->>'creditDate')::date, (p_payment->>'estimatedCreditDate')::date);
  v_final text := case when p_event = 'PAYMENT_CONFIRMED' then 'paga' else 'liquidada' end;
  v_reason text;
  v_r record;
  v_method text;
  v_link text;
begin
  select * into c from public.charges ch where ch.id = p_charge_id for update;
  v_link := '/prontuarios/' || c.client_id::text;

  -- Já baixada por esta cobrança: só a liquidação (o dinheiro caiu).
  if c.receipt_id is not null then
    if v_final = 'liquidada' and c.status = 'paga' then
      update public.charges set status = 'liquidada', credit_date = coalesce(v_credit, credit_date), last_event_at = now()
       where id = c.id;
      if v_credit is not null then
        update public.payment_receipts set settlement_date = v_credit where id = c.receipt_id;
        update public.financial_entries set cash_date = v_credit, expected_settlement_date = v_credit
         where source_id = c.receipt_id and source_type in ('receipt_cash', 'acquirer_fee') and reversal_of is null;
      end if;
      return 'liquidada';
    end if;
    return 'ja_baixada';
  end if;

  select * into i from public.payment_installments pi where pi.id = c.payment_installment_id for update;

  -- Duplicidade (16.6): cobrança encerrada ou parcela já paga.
  v_reason := case
    when c.status = 'cancelada' or c.is_external then 'cobranca_cancelada'
    when c.status = 'estornada' then 'cobranca_estornada'
    when i.status in ('paga', 'cancelada', 'renegociada') then 'parcela_ja_paga'
    else null end;
  if v_reason is not null then
    insert into public.gateway_payment_surpluses
      (clinic_id, charge_id, installment_id, client_id, asaas_payment_id, amount_cents, paid_on, reason)
    values (c.clinic_id, c.id, c.payment_installment_id, c.client_id, v_pid, greatest(v_paid, 1), v_on, v_reason)
    on conflict (asaas_payment_id) do nothing;
    update public.charges set paid_cents = v_paid, paid_on = v_on, last_event_at = now() where id = c.id;
    perform public._gateway_notify(c.gateway_account_id, 'duplicidade', v_pid, c.clinic_id, true, true, false,
      'Pagamento em duplicidade',
      'Um pagamento pelo Asaas chegou para uma cobrança cancelada ou parcela já paga. Decida entre devolver ou abater em outra parcela.',
      v_link);
    return 'duplicidade';
  end if;

  -- D21: a confirmação do pagamento fecha a venda (antes da baixa).
  perform public._gateway_confirm_sale(i.id);

  -- 4013: a parcela do parcelado pelo Asaas recebe a baixa como "cartão parcelado".
  v_method := case when c.installment_block is not null then 'cartao_parcelado'
                   else case c.billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto' when 'CREDIT_CARD' then 'cartao' end end;
  select * into v_r from public._gateway_receipt(
    i.id, v_paid, v_on, v_method, 'Asaas ' || v_pid,
    md5('asaas-receipt:' || v_pid)::uuid,
    public._gateway_bank_account(c.gateway_account_id), true);

  if v_net is not null then
    perform public._gateway_apply_fee(v_r.receipt_id, v_paid - v_net, coalesce(v_credit, v_on), c.gateway_account_id,
      case when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end);
  end if;

  update public.charges
     set status = v_final, paid_cents = v_paid, paid_on = v_on, credit_date = v_credit,
         receipt_id = v_r.receipt_id, last_event_at = now()
   where id = c.id;

  if v_r.shortfall_cents > 0 then
    perform public._gateway_notify(c.gateway_account_id, 'pago_a_menor', v_pid, c.clinic_id, true, false, false,
      'Pagamento pelo Asaas abaixo do devido',
      'A parcela recebeu pelo Asaas um valor menor que o devido; o saldo ficou em aberto. Receba ou quite por valor menor.',
      v_link);
  end if;
  return 'baixa';
end;
$$;
revoke execute on function public._gateway_on_paid(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public._gateway_apply_fee(
  p_receipt_id uuid,
  p_fee_cents bigint,
  p_settle date,
  p_account_id uuid,
  p_billing_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.payment_receipts%rowtype;
  v_acq uuid;
  v_name text;
  v_modality text := case p_billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto'
                                         when 'CREDIT_CARD' then 'credito_avista'
                                         when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' else null end;
  v_fee bigint := greatest(coalesce(p_fee_cents, 0), 0);
  v_settle date;
begin
  select * into v_rec from public.payment_receipts r where r.id = p_receipt_id;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if v_rec.acquirer_id is not null or coalesce(v_rec.acquirer_fee_cents, 0) > 0 then return; end if;
  v_settle := coalesce(p_settle, v_rec.received_at);
  select a.id, a.name into v_acq, v_name from public.card_acquirers a where a.gateway_account_id = p_account_id limit 1;

  update public.payment_receipts set
    acquirer_id = v_acq,
    acquirer_modality = v_modality,
    acquirer_fee_cents = v_fee,
    acquirer_fixed_fee_cents = 0,
    acquirer_fee_percent = case when v_rec.amount_cents > 0 then round(v_fee * 100.0 / v_rec.amount_cents, 4) else 0 end,
    acquirer_fee_waived = false,
    acquirer_fee_charged_at_issue = false,
    settlement_date = v_settle
  where id = p_receipt_id;

  if v_fee > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, created_by
    ) values (
      v_rec.clinic_id, '2.4.01', v_rec.received_at, v_settle, v_settle, v_fee, 'outflow', 'settled',
      'acquirer_fee', p_receipt_id, 'Taxa do Asaas — ' || coalesce(v_modality, 'cobrança'), null
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee',
       'acquirer_fee', 'boleto_issue') do nothing;
  end if;

  update public.financial_entries
     set cash_date = v_settle, expected_settlement_date = v_settle
   where source_type = 'receipt_cash' and source_id = p_receipt_id;
end;
$$;
revoke execute on function public._gateway_apply_fee(uuid, bigint, date, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) O SPLIT POR PARCELA (Método B com a parte fixa rateada, 19.19.2)
-- -----------------------------------------------------------------------------
create or replace function public._charge_split_plan(p_charge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  a public.gateway_accounts%rowtype;
  v_type text;
  v_root public.gateway_accounts%rowtype;
  v_today date := public.today_br();
  t record;
  v_cfg record;
  v_dest public.gateway_accounts%rowtype;
  v_wallets jsonb := '{}'::jsonb;
  v_item jsonb;
  v_total numeric := 0;
  v_rates jsonb;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  select * into a from public.gateway_accounts where id = c.gateway_account_id;
  select type into v_type from public.clinics where id = c.clinic_id;

  if v_type is distinct from 'franchise_unit' then
    return jsonb_build_object('elegivel', false, 'motivo', 'franqueadora');
  end if;
  if a.split_enabled_declared_at is null and a.split_enabled_confirmed_at is null then
    return jsonb_build_object('elegivel', false, 'motivo', 'split_nao_habilitado');
  end if;

  select * into v_root from public.gateway_accounts g
   where g.owner_type = 'franchisor' and g.status = 'active' and g.environment = a.environment
     and g.wallet_id is not null
   order by g.created_at limit 1;

  for t in select key from public.network_fee_types where kind = 'percent' and active order by sort_order, key loop
    select * into v_cfg from public.network_fee_for(c.clinic_id, t.key, v_today);
    continue when v_cfg is null or not v_cfg.active or coalesce(v_cfg.percent, 0) <= 0;

    v_dest := null;
    select g.* into v_dest from public.network_fee_types ft
      join public.gateway_accounts g on g.id = ft.split_account_id
     where ft.key = t.key and g.status = 'active' and g.environment = a.environment
       and g.owner_type in ('franchisor', 'recipient') and g.wallet_id is not null;
    if v_dest.id is null then
      if exists (select 1 from public.network_fee_types where key = t.key and split_account_id is not null) then
        return jsonb_build_object('elegivel', false, 'motivo', 'sem_carteira');
      end if;
      v_dest := v_root;
    end if;
    if v_dest.id is null then
      return jsonb_build_object('elegivel', false, 'motivo', 'sem_carteira');
    end if;
    if v_dest.wallet_id = a.wallet_id then
      return jsonb_build_object('elegivel', false, 'motivo', 'carteira_propria');
    end if;

    v_item := coalesce(v_wallets->v_dest.wallet_id,
      jsonb_build_object('accountId', v_dest.id, 'walletId', v_dest.wallet_id, 'percent', 0, 'fees', '{}'::jsonb));
    v_item := jsonb_set(v_item, '{percent}', to_jsonb((v_item->>'percent')::numeric + v_cfg.percent));
    v_item := jsonb_set(v_item, array['fees', t.key], to_jsonb(v_cfg.percent));
    v_wallets := jsonb_set(v_wallets, array[v_dest.wallet_id], v_item);
    v_total := v_total + v_cfg.percent;
  end loop;

  if v_total <= 0 then
    return jsonb_build_object('elegivel', false, 'motivo', 'sem_taxa');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'modality', r.modality, 'fee_percent', r.fee_percent, 'fixed_fee_cents', r.fixed_fee_cents,
           'valid_from', r.valid_from, 'valid_to', r.valid_to, 'min_installments', r.min_installments,
           'max_installments', r.max_installments)), '[]'::jsonb)
    into v_rates
    from public.acquirer_rates r
    join public.card_acquirers q on q.id = r.acquirer_id
   where q.gateway_account_id = a.id;

  return jsonb_build_object(
    'elegivel', true,
    'carteiras', (select jsonb_agg(v) from jsonb_each(v_wallets) as x(k, v)),
    'tarifas', v_rates,
    'hoje', v_today,
    'vencimento', c.due_date,
    'valorCents', c.value_cents,
    'descontoCents', c.discount_cents,
    'meio', c.billing_type,
    'parcelas', coalesce(c.installment_count, 1));
end;
$$;
revoke execute on function public._charge_split_plan(uuid) from public, anon, authenticated;

create or replace function public._charge_split_inputs(p_charge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb := public._charge_split_plan(p_charge_id);
  c public.charges%rowtype;
  v_ate date;
  v_tar record;
  v_mods text[];
begin
  if not coalesce((v_plan->>'elegivel')::boolean, false) then
    return jsonb_build_object('elegivel', false, 'motivo', v_plan->>'motivo');
  end if;
  select * into c from public.charges where id = p_charge_id;
  v_ate := greatest(c.due_date, public.today_br());
  v_mods := case when coalesce(c.installment_count, 1) > 1 then array['credito_parcelado']
                 else case c.billing_type when 'PIX' then array['pix'] when 'BOLETO' then array['boleto', 'pix'] else array['credito_avista'] end end;
  select min(r.fee_percent) as a, min(r.fixed_fee_cents) as b into v_tar
    from public.acquirer_rates r
    join public.card_acquirers q on q.id = r.acquirer_id
   where q.gateway_account_id = c.gateway_account_id
     and r.modality = any (v_mods)
     and not (r.modality = 'credito_avista' and coalesce(r.min_installments, 1) > 1)
     and (coalesce(c.installment_count, 1) = 1
          or coalesce(c.installment_count, 1) between coalesce(r.min_installments, 1) and coalesce(r.max_installments, 99))
     and (r.valid_from is null or r.valid_from <= v_ate)
     and (r.valid_to is null or r.valid_to >= public.today_br());
  return jsonb_build_object(
    'elegivel', true,
    'carteiras', (select jsonb_agg(jsonb_build_object('walletId', x->>'walletId', 'percent', (x->>'percent')::numeric, 'fees', x->'fees')
                                   order by x->>'walletId')
                    from jsonb_array_elements(v_plan->'carteiras') x),
    'tarifa', jsonb_build_object('a', v_tar.a, 'b', floor(coalesce(v_tar.b, 0)::numeric / coalesce(c.installment_count, 1))));
end;
$$;
revoke execute on function public._charge_split_inputs(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) A TAXA "A RETER PELO SPLIT" no apurado do mês (19.19.4)
-- -----------------------------------------------------------------------------
-- Retida na baixa (nunca vira conta a pagar) e ainda não liquidada pelo Asaas:
-- o split da parcela está agendado (enviado ou bloqueado) e sem valor liquidado.
create or replace function public._split_charge_awaiting(p_split_charge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.split_charges sc
      join public.charge_splits cs on cs.charge_id = sc.charge_id and cs.fees ? sc.fee
     where sc.id = p_split_charge_id and sc.retained_cents > 0 and not sc.reversed
       and cs.status in ('enviado', 'bloqueado') and cs.settled_at is null);
$$;
revoke execute on function public._split_charge_awaiting(uuid) from public, anon, authenticated;

drop function if exists public.network_fee_summary(uuid, integer, integer);
create function public.network_fee_summary(p_clinic_id uuid, p_year integer, p_month integer)
returns table(fee text, label text, kind text, percent numeric, is_override boolean, campaign_name text,
              base_cents bigint, amount_cents bigint, receipts integer, payable_status text, retained_cents bigint,
              awaiting_cents bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  with period as (select make_date(p_year, p_month, 1) as p)
  select
    t.key,
    t.label,
    cfg.kind,
    cfg.percent,
    cfg.is_override,
    cfg.campaign_name,
    coalesce(s.base, 0)::bigint,
    case when cfg.kind = 'percent' then coalesce(s.total, 0)
         when cfg.active then cfg.amount_cents else 0 end::bigint,
    coalesce(s.n, 0)::integer,
    case when pay.status = 'cancelada' and coalesce(s.retido, 0) > 0 then null else pay.status end,
    coalesce(s.retido, 0)::bigint,
    coalesce(s.a_reter, 0)::bigint
  from public.network_fee_types t
  cross join period per
  left join lateral public.network_fee_for(p_clinic_id, t.key, per.p) cfg on true
  left join lateral (
    select sum(c.amount_cents) as total, sum(c.base_cents) as base,
           count(*) as n, sum(c.retained_cents) as retido,
           sum(case when public._split_charge_awaiting(c.id) then c.retained_cents else 0 end) as a_reter
    from public.split_charges c
    where c.clinic_id = p_clinic_id and c.fee = t.key
      and c.period_month = per.p and not c.reversed
  ) s on true
  left join public.payables pay
    on pay.clinic_id = p_clinic_id and pay.network_fee = t.key
   and pay.fee_period = per.p
  where public.can_see_clinic_finance(p_clinic_id)
  order by t.sort_order, t.key;
$fn$;
revoke execute on function public.network_fee_summary(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.network_fee_summary(uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) CANCELAR E ESTORNAR SÓ O PARCELAMENTO INTEIRO
-- -----------------------------------------------------------------------------
-- As portas por parcela recusam a parcela do bloco.
create or replace function public.charge_cancel_check(p_charge_id uuid, p_purpose text)
returns table (asaas_payment_id text, gateway_account_id uuid, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.charges%rowtype;
begin
  select * into v from public.charges c where c.id = p_charge_id;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if p_purpose not in ('cancel', 'counter') or not public._charge_can(p_purpose, v.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  -- 4013: a parcela do parcelado pelo Asaas só sai com o parcelamento inteiro.
  if v.installment_block is not null then raise exception 'USE_O_PARCELAMENTO'; end if;
  if v.is_external or v.status not in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
    raise exception 'CHARGE_NOT_CANCELLABLE';
  end if;
  return query select v.asaas_payment_id, v.gateway_account_id, v.status;
end;
$$;
revoke execute on function public.charge_cancel_check(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_cancel_check(uuid, text) to authenticated;

create or replace function public.charge_refund_check(p_charge_id uuid, p_reason text)
returns table (charge_id uuid, account_id uuid, asaas_payment_id text, billing_type text, clinic_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  p record;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_refund_can(c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  -- 4013: a parcela do parcelado pelo Asaas só é estornada com o parcelamento inteiro.
  if c.installment_block is not null then raise exception 'USE_O_PARCELAMENTO'; end if;
  if c.status not in ('paga', 'liquidada') or c.asaas_payment_id is null or c.is_external then
    raise exception 'NOT_REFUNDABLE';
  end if;
  if c.refund_state is not null or exists (select 1 from public.charge_refunds r where r.charge_id = c.id and r.status = 'pedido') then
    raise exception 'REFUND_PENDING';
  end if;
  if c.billing_type = 'BOLETO' then
    select * into p from public._charge_refund_payer(c.id);
    if not coalesce(p.termo_declarado, false) then raise exception 'PRIVACY_NOT_DECLARED'; end if;
    if p.asaas_customer_id is null or p.mobile is null then raise exception 'NO_MOBILE'; end if;
    if p.email is null then raise exception 'NO_EMAIL'; end if;
  end if;
  return query select c.id, c.gateway_account_id, c.asaas_payment_id, c.billing_type, c.clinic_id;
end;
$$;
revoke execute on function public.charge_refund_check(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_refund_check(uuid, text) to authenticated;

-- O bloco de uma venda (para as telas): as cobranças vivas mais recentes.
create or replace function public._card_block_of_charge(p_charge_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.installment_block from public.charges c where c.id = p_charge_id;
$$;
revoke execute on function public._card_block_of_charge(uuid) from public, anon, authenticated;

-- Cancelar o parcelamento NÃO pago: a mesma permissão do cancelar de hoje.
create or replace function public.card_block_cancel_check(p_block uuid, p_reason text)
returns table (account_id uuid, asaas_installment_id text, charge_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_account uuid;
  v_inst text;
  v_ids uuid[];
begin
  select min(c.clinic_id::text)::uuid, min(c.gateway_account_id::text)::uuid, min(c.asaas_installment_id), array_agg(c.id order by c.installment_number)
    into v_clinic, v_account, v_inst, v_ids
    from public.charges c where c.installment_block = p_block;
  if v_clinic is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_can('cancel', v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if exists (select 1 from public.charges c where c.installment_block = p_block
              and c.status not in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'cancelada')) then
    raise exception 'PARCELADO_ASAAS_PAGO_USE_ESTORNO';
  end if;
  return query select v_account, v_inst, v_ids;
end;
$$;
revoke execute on function public.card_block_cancel_check(uuid, text) from public, anon, authenticated;
grant execute on function public.card_block_cancel_check(uuid, text) to authenticated;

-- O que a unidade perde no estorno inteiro (19.20, 2a), ANTES de confirmar:
-- o valor devolvido, a tarifa do Asaas que não volta e a taxa da rede que
-- continua devida sobre o valor confirmado inteiro (só o Financeiro da
-- Franqueadora ou o Admin Master dispensam, à mão).
create or replace function public.card_block_refund_preview(p_block uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v jsonb;
begin
  select min(c.clinic_id::text)::uuid into v_clinic from public.charges c where c.installment_block = p_block;
  if v_clinic is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_refund_can(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  select jsonb_build_object(
    'parcelas', count(*),
    'creditadas', count(*) filter (where c.status = 'liquidada'),
    'a_creditar', count(*) filter (where c.status = 'paga'),
    'devolvido_cents', coalesce(sum(c.paid_cents), 0),
    'tarifa_que_nao_volta_cents', coalesce(sum(r.acquirer_fee_cents), 0),
    'taxa_devida_cents', coalesce(sum((select coalesce(sum(sc.amount_cents), 0) from public.split_charges sc
                                        where sc.receipt_id = c.receipt_id and sc.waived_at is null)), 0),
    'estornavel', bool_and(c.status in ('paga', 'liquidada')) and bool_and(c.refund_state is null))
    into v
    from public.charges c
    left join public.payment_receipts r on r.id = c.receipt_id
   where c.installment_block = p_block;
  return v;
end;
$$;
revoke execute on function public.card_block_refund_preview(uuid) from public, anon, authenticated;
grant execute on function public.card_block_refund_preview(uuid) to authenticated;

create or replace function public.card_block_refund_check(p_block uuid, p_reason text)
returns table (account_id uuid, asaas_installment_id text, charge_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_account uuid;
  v_inst text;
  v_ids uuid[];
begin
  select min(c.clinic_id::text)::uuid, min(c.gateway_account_id::text)::uuid, min(c.asaas_installment_id), array_agg(c.id order by c.installment_number)
    into v_clinic, v_account, v_inst, v_ids
    from public.charges c where c.installment_block = p_block;
  if v_clinic is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_refund_can(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if v_inst is null or exists (select 1 from public.charges c where c.installment_block = p_block
                                and (c.status not in ('paga', 'liquidada') or c.is_external)) then
    raise exception 'NOT_REFUNDABLE';
  end if;
  if exists (select 1 from public.charges c where c.installment_block = p_block
              and (c.refund_state is not null
                   or exists (select 1 from public.charge_refunds f where f.charge_id = c.id and f.status = 'pedido'))) then
    raise exception 'REFUND_PENDING';
  end if;
  return query select v_account, v_inst, v_ids;
end;
$$;
revoke execute on function public.card_block_refund_check(uuid, text) from public, anon, authenticated;
grant execute on function public.card_block_refund_check(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8b) O CUSTO DO PARCELAMENTO NO FECHAMENTO (19.19.7 item 1)
-- -----------------------------------------------------------------------------
-- As faixas vigentes hoje do cartão parcelado da conta Asaas da unidade e a soma
-- das taxas percentuais da rede. Para quem vê a unidade (o Consultor inclusive):
-- só tarifas e percentuais, nada do paciente.
create or replace function public.card_block_fee_table(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_faixas jsonb;
  v_rede numeric := 0;
  t record;
  v_cfg record;
begin
  if not (public.is_admin_master() or p_clinic_id in (select public.user_clinic_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'de', r.min_installments, 'ate', r.max_installments, 'pct', r.fee_percent, 'fixo', r.fixed_fee_cents)
           order by r.min_installments), '[]'::jsonb)
    into v_faixas
    from public.acquirer_rates r
    join public.card_acquirers q on q.id = r.acquirer_id
    join public.gateway_accounts g on g.id = q.gateway_account_id
   where g.clinic_id = p_clinic_id and g.status = 'active'
     and r.modality = 'credito_parcelado'
     and (r.valid_from is null or r.valid_from <= public.today_br())
     and (r.valid_to is null or r.valid_to >= public.today_br());
  for t in select key from public.network_fee_types where kind = 'percent' and active loop
    select * into v_cfg from public.network_fee_for(p_clinic_id, t.key, public.today_br());
    -- (um registro com algum campo nulo não é "is not null": confere pelo campo)
    if coalesce(v_cfg.active, false) then v_rede := v_rede + coalesce(v_cfg.percent, 0); end if;
  end loop;
  return jsonb_build_object('faixas', v_faixas, 'rede_percent', v_rede);
end;
$$;
revoke execute on function public.card_block_fee_table(uuid) from public, anon, authenticated;
grant execute on function public.card_block_fee_table(uuid) to authenticated;

-- "Tentar de novo" do parcelamento que falhou antes de chegar ao Asaas.
create or replace function public.charge_block_retry(p_block uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select min(c.clinic_id::text)::uuid into v_clinic from public.charges c where c.installment_block = p_block;
  if v_clinic is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_can('emit', v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from public.charges c where c.installment_block = p_block
              and c.status not in ('erro_emissao', 'emitindo', 'emitida')) then
    raise exception 'CHARGE_NOT_RETRYABLE';
  end if;
  update public.charges set status = 'emitindo', error_code = null
   where installment_block = p_block and status = 'erro_emissao';
  return p_block;
end;
$$;
revoke execute on function public.charge_block_retry(uuid) from public, anon, authenticated;
grant execute on function public.charge_block_retry(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8c) AS COBRANÇAS DA VENDA mostram o parcelamento (19.19.9)
-- -----------------------------------------------------------------------------
-- 4013: o resumo do parcelamento da venda para as Cobranças da venda: o bloco
-- vivo mais recente (ou nenhum), a situação, o link e o que dá para fazer.
create or replace function public._card_block_summary(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_total bigint;
  v_block uuid;
  v_clinic uuid;
  v jsonb;
begin
  select count(*), sum(i.amount_cents), min(i.clinic_id::text)::uuid into v_n, v_total, v_clinic
    from public._card_block_rows(p_negotiation_id, p_direct_sale_id) i;
  if coalesce(v_n, 0) = 0 then return null; end if;
  select c.installment_block into v_block
    from public.charges c
    join public._card_block_rows(p_negotiation_id, p_direct_sale_id) i on i.id = c.payment_installment_id
   where c.installment_block is not null
   order by (c.status = 'cancelada'), c.created_at desc limit 1;
  select jsonb_build_object(
    'block', v_block,
    'parcelas', v_n,
    'total', v_total,
    'situacao', case
       when v_block is null then 'sem_parcelamento'
       when bool_or(c.status = 'em_contestacao') then 'em_contestacao'
       when bool_or(c.refund_state is not null) then 'estorno_pedido'
       when bool_and(c.status = 'estornada') then 'estornado'
       when bool_and(c.status = 'cancelada') then 'cancelado'
       when bool_and(c.status in ('paga', 'liquidada')) then 'pago'
       when bool_or(c.status = 'erro_emissao') then 'erro'
       when bool_or(c.status = 'emitindo') then 'emitindo'
       when bool_or(c.status = 'vencida') then 'vencido'
       else 'aguardando' end,
    'link', (array_agg(c.invoice_url order by c.installment_number) filter (where c.invoice_url is not null))[1],
    'primeira', (array_agg(c.id order by c.installment_number))[1],
    'creditadas', count(*) filter (where c.status = 'liquidada'),
    'pode_gerar', v_block is null or bool_and(c.status = 'cancelada'),
    'pode_tentar_de_novo', v_block is not null and bool_or(c.status = 'erro_emissao')
                           and bool_and(c.status in ('erro_emissao', 'emitindo', 'emitida')),
    'pode_cancelar', v_block is not null and bool_and(c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')),
    'pode_estornar', v_block is not null and bool_and(c.status in ('paga', 'liquidada')) and bool_and(c.refund_state is null),
    'gerar_permitido', public._charge_can('emit', v_clinic),
    'cancelar_permitido', public._charge_can('cancel', v_clinic),
    'estornar_permitido', public._charge_refund_can(v_clinic))
    into v
    from (select 1) x
    left join public.charges c on c.installment_block = v_block;
  return v;
end;
$$;
revoke execute on function public._card_block_summary(uuid, uuid) from public, anon, authenticated;

create or replace function public.sale_charges_read(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer := public._auto_charge_window();
  v_closed timestamptz;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  if not public._sale_charges_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_negotiation_id is not null then
    select cs.closed_at into v_closed from public.commercial_sales cs where cs.negotiation_id = p_negotiation_id;
  else
    select s.closed_at into v_closed from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  return jsonb_build_object(
    'automatica', exists (select 1 from public.sale_auto_charges m
                           where (p_negotiation_id is not null and m.negotiation_id = p_negotiation_id)
                              or (p_direct_sale_id is not null and m.direct_sale_id = p_direct_sale_id)),
    'prazo', v_window,
    'venda_fechada_em', v_closed,
    -- 4013: o cartão parcelado pelo Asaas da venda (um bloco), se houver.
    'parcelamento', public._card_block_summary(p_negotiation_id, p_direct_sale_id),
    'parcelas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'installment_id', i.id, 'seq', i.seq, 'tipo', i.kind, 'vencimento', i.due_date,
               'valor', i.amount_cents, 'pago', coalesce(i.paid_amount_cents, 0), 'meio', i.payment_method,
               'situacao_parcela', i.status,
               'parcelado', i.payment_method = 'cartao_parcelado_asaas',
               'pelo_asaas', public._auto_charge_billing(i.id) is not null,
               'agendada_para', case when ch.id is null and i.status in ('em_aberto', 'parcial')
                                       and public._auto_charge_billing(i.id) is not null
                                     then greatest(public.today_br(), i.due_date - v_window) end,
               'cobranca', case when ch.id is null then null else jsonb_build_object(
                  'id', ch.id, 'status', ch.status, 'meio', ch.billing_type, 'valor', ch.value_cents,
                  'link', ch.invoice_url, 'boleto', ch.bank_slip_url, 'pix', ch.pix_copy_paste,
                  'linha', ch.identification_field, 'criada_em', ch.issued_at, 'origem', ch.auto_origin,
                  'enviada_pelo_asaas_em', ch.asaas_sent_at, 'aberta_em', ch.viewed_at, 'paga_em', ch.paid_on) end,
               'ultimo_envio', (select jsonb_build_object('canal', l.channel, 'quem', pr.full_name, 'quando', l.sent_at)
                                  from public.charge_link_sends l left join public.profiles pr on pr.id = l.sent_by
                                 where l.charge_id = ch.id order by l.sent_at desc limit 1))
             order by i.seq)
        from public.payment_installments i
        left join lateral (
          select c.* from public.charges c
           where c.payment_installment_id = i.id and c.status <> 'cancelada'
           order by c.created_at desc limit 1) ch on true
       where (p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
          or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id)), '[]')
  );
end;
$$;
revoke execute on function public.sale_charges_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sale_charges_read(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_card_block_rows', '_card_block_check', '_card_block_project', '_settlement_projection_base',
      '_card_blocks_due', '_card_block_insert', '_card_block_prepare_system', 'charge_block_prepare',
      'card_block_cancel_check', 'card_block_refund_preview', 'card_block_refund_check', '_split_charge_awaiting',
      'card_block_fee_table', 'charge_block_retry', '_card_block_summary')) as funcoes_novas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'charges'
      and column_name in ('installment_block', 'installment_count', 'installment_number', 'asaas_installment_id')) as colunas_novas,
  (select pg_get_constraintdef(oid) like '%cartao_parcelado_asaas%' from pg_constraint
    where conname = 'payment_installments_payment_method_check') as meio_novo,
  (select count(*) from public.charges where installment_block is not null) as cobrancas_de_parcelamento;
