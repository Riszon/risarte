-- =============================================================================
-- 0235 — FIN8.1c: desconto por pontualidade nas taxas da rede
-- -----------------------------------------------------------------------------
-- Pedido do dono: "desconto por pagamento na pontualidade para valores fixos".
--
-- FORMA ESCOLHIDA POR ELE (tela de perguntas): a conta NASCE CHEIA e o
-- abatimento entra na hora de pagar, se o pagamento for até o vencimento. Mais
-- conservador na projeção de caixa — reserva o valor cheio — em troca de
-- mostrar todo mês uma dívida um pouco maior que a real.
--
-- A ALTERNATIVA (conta nascendo com o desconto e perdendo se atrasar) espelharia
-- o benefício do PPR+, mas ele preferiu esta, e a escolha é dele.
--
-- ONDE MEXE, E POR QUE ISSO IMPORTA: o pagamento de conta é fluxo que já roda em
-- produção. Por isso o parâmetro do desconto entra com PADRÃO ZERO — toda
-- chamada existente continua idêntica, e `refresh_payable_payment` só muda de
-- comportamento quando existe desconto de verdade. Sem essa precaução, uma
-- entrega de taxa da franqueadora poderia quebrar o contas a pagar inteiro.
--
-- O DESCONTO É REDUÇÃO DE DESPESA, NÃO ENTRADA DE DINHEIRO. No razão ele entra
-- como um crédito na PRÓPRIA conta de despesa (`payable_discount`), então a DRE
-- passa a mostrar a despesa líquida e a ponte lucro × caixa continua fechando:
-- saiu menos dinheiro E custou menos. Lançá-lo como receita financeira faria a
-- unidade parecer ter ganhado algo por pagar em dia — ela apenas gastou menos.
--
-- E O OUTRO LADO TAMBÉM CAI. A franqueadora reconheceu a receita cheia quando a
-- conta nasceu; se a unidade paga com desconto, ela recebe menos. Sem o
-- contra-lançamento (`network_fee_discount`), a receita da rede ficaria inflada
-- exatamente no valor dos descontos concedidos.
--
-- SÓ VALE PARA CONTA DE TAXA DA REDE (`network_fee`). Conta de fornecedor tem
-- desconto negociado caso a caso, e inventar regra automática para ela seria
-- decidir no lugar de quem negocia.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O PERCENTUAL, na mesma cascata das taxas
-- -----------------------------------------------------------------------------
alter table public.network_fees
  add column if not exists punctuality_discount_percent numeric(7,4)
    not null default 0
    check (punctuality_discount_percent >= 0
           and punctuality_discount_percent <= 100);

comment on column public.network_fees.punctuality_discount_percent is
  'Abatimento concedido quando a conta desta taxa é paga ATÉ o vencimento. '
  'Zero = sem desconto. Segue a cascata: a linha da unidade sobrescreve a rede.';

-- Ganhou coluna no retorno: `create or replace` não basta.
drop function if exists public.network_fee_for(uuid, text, date);

create or replace function public.network_fee_for(
  p_clinic_id uuid,
  p_fee text,
  p_on date default null
)
returns table (
  kind text,
  percent numeric,
  amount_cents bigint,
  due_day integer,
  active boolean,
  is_override boolean,
  note text,
  campaign_name text,
  punctuality_discount_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with dia as (select coalesce(p_on, public.today_br()) as d),
  base as (
    select f.kind, f.percent, f.amount_cents, f.due_day, f.active,
           f.clinic_id is not null as is_override, f.note,
           f.punctuality_discount_percent
    from public.network_fees f
    where f.fee = p_fee
      and (f.clinic_id = p_clinic_id or f.clinic_id is null)
    order by (f.clinic_id is not null) desc
    limit 1
  ),
  camp as (
    select c.*
    from public.network_fee_campaigns c, dia
    where c.active
      and (c.clinic_id = p_clinic_id or c.clinic_id is null)
      and (c.fees is null or cardinality(c.fees) = 0 or p_fee = any(c.fees))
      and dia.d between c.starts_on and c.ends_on
    order by (c.clinic_id is not null) desc,
             (c.fees is not null and cardinality(c.fees) > 0) desc,
             c.starts_on desc
    limit 1
  )
  select
    b.kind,
    case
      when c.id is null then b.percent
      when c.mode = 'valor' then coalesce(c.percent, b.percent)
      else round(b.percent * (1 - coalesce(c.discount_percent, 0) / 100.0), 4)
    end,
    case
      when c.id is null then b.amount_cents
      when c.mode = 'valor' then coalesce(c.amount_cents, b.amount_cents)
      else round(b.amount_cents
                 * (1 - coalesce(c.discount_percent, 0) / 100.0))::bigint
    end,
    b.due_day,
    b.active and coalesce(
      (select t.active from public.network_fee_types t where t.key = p_fee),
      true),
    b.is_override,
    b.note,
    c.name,
    -- A campanha mexe no VALOR da taxa, não na pontualidade: são duas coisas
    -- diferentes (uma é preço, a outra é prêmio por pagar em dia), e somá-las
    -- num número só esconderia qual das duas está agindo.
    b.punctuality_discount_percent
  from base b
  left join camp c on true;
$$;

grant execute on function public.network_fee_for(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) QUANTO DE DESCONTO ESTA CONTA TEM, SE PAGA NESTA DATA
-- -----------------------------------------------------------------------------
create or replace function public.payable_punctuality_discount(
  p_payable_id uuid,
  p_paid_at date default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_cfg record;
  v_when date := coalesce(p_paid_at, public.today_br());
  v_paid bigint;
  v_saldo bigint;
begin
  select * into v_p from public.payables where id = p_payable_id;
  if v_p.id is null or v_p.network_fee is null then return 0; end if;
  if v_p.status in ('paga', 'cancelada', 'recusada') then return 0; end if;

  -- Depois do vencimento não há pontualidade a premiar.
  if v_when > v_p.due_date then return 0; end if;

  select * into v_cfg
    from public.network_fee_for(v_p.clinic_id, v_p.network_fee, v_p.fee_period);
  if v_cfg is null
     or coalesce(v_cfg.punctuality_discount_percent, 0) <= 0 then
    return 0;
  end if;

  -- O desconto vale sobre o que AINDA falta pagar: numa conta paga pela metade
  -- fora do prazo, premiar o valor cheio daria desconto sobre parcela atrasada.
  select coalesce(sum(amount_cents + coalesce(discount_cents, 0)), 0)
    into v_paid
  from public.payable_payments
  where payable_id = p_payable_id and not reversed and reversal_of is null;

  v_saldo := v_p.amount_cents - v_paid;
  if v_saldo <= 0 then return 0; end if;

  return round(v_saldo * v_cfg.punctuality_discount_percent / 100.0)::bigint;
end;
$$;

grant execute on function public.payable_punctuality_discount(uuid, date)
  to authenticated;

-- A lista para a tela de contas a pagar, de uma vez só.
create or replace function public.payable_discounts(p_clinic_id uuid)
returns table (payable_id uuid, discount_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.payable_punctuality_discount(p.id, public.today_br())
  from public.payables p
  where p.clinic_id = p_clinic_id
    and p.network_fee is not null
    and p.status in ('aberta', 'parcial')
    and p.due_date >= public.today_br()
    and public.can_see_clinic_finance(p_clinic_id);
$$;

grant execute on function public.payable_discounts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) O DESCONTO NA BAIXA
-- -----------------------------------------------------------------------------
alter table public.payable_payments
  add column if not exists discount_cents bigint not null default 0
    check (discount_cents >= 0);

-- Conta paga = dinheiro + desconto. Sem isto, a conta de R$ 1.000 paga com
-- R$ 900 e R$ 100 de desconto ficaria "parcial" para sempre.
create or replace function public.refresh_payable_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.payable_id, old.payable_id);
  v_paid bigint; v_fee bigint; v_int bigint; v_disc bigint;
  v_amount bigint; v_status text;
begin
  select coalesce(sum(p.amount_cents), 0), coalesce(sum(p.fee_cents), 0),
         coalesce(sum(p.interest_cents), 0),
         coalesce(sum(p.discount_cents), 0)
    into v_paid, v_fee, v_int, v_disc
  from public.payable_payments p
  where p.payable_id = v_id and not p.reversed and p.reversal_of is null;

  select amount_cents, status into v_amount, v_status
  from public.payables where id = v_id;

  update public.payables set
    paid_amount_cents = v_paid,
    paid_fee_cents = v_fee,
    paid_interest_cents = v_int,
    status = case
      when v_status in ('cancelada', 'recusada', 'aguardando_autorizacao')
        then v_status
      when v_paid + v_disc >= v_amount then 'paga'
      when v_paid > 0 then 'parcial'
      else 'aberta'
    end,
    updated_at = now()
  where id = v_id;

  return null;
end;
$$;

drop trigger if exists payable_payments_refresh on public.payable_payments;
create trigger payable_payments_refresh
  after insert or update or delete on public.payable_payments
  for each row execute function public.refresh_payable_payment();

-- A assinatura ganha um parâmetro: precisa DERRUBAR a antiga, senão as duas
-- ficam no banco e a chamada com nove argumentos vira ambígua.
drop function if exists public.register_payable_payment(
  uuid, bigint, date, text, bigint, bigint, text, text, uuid);

create or replace function public.register_payable_payment(
  p_payable_id uuid,
  p_amount_cents bigint,
  p_paid_at date default current_date,
  p_payment_method text default null,
  p_fee_cents bigint default 0,
  p_interest_cents bigint default 0,
  p_reference text default null,
  p_notes text default null,
  p_client_token uuid default null,
  p_discount_cents bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_paid bigint;
  v_saldo bigint;
  v_id uuid;
  v_fee bigint := greatest(0, coalesce(p_fee_cents, 0));
  v_int bigint := greatest(0, coalesce(p_interest_cents, 0));
  v_disc bigint := greatest(0, coalesce(p_discount_cents, 0));
  v_max bigint;
  v_franchisor uuid;
  v_acc record;
  v_user uuid := (select auth.uid());
begin
  select * into v_p from public.payables where id = p_payable_id;
  if v_p.id is null then raise exception 'PAYABLE_NOT_FOUND'; end if;
  if not public.can_manage_payables(v_p.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_p.status = 'aguardando_autorizacao' then raise exception 'NOT_APPROVED'; end if;
  if v_p.status in ('cancelada', 'recusada') then raise exception 'PAYABLE_CLOSED'; end if;

  if p_client_token is not null then
    select id into v_id from public.payable_payments
    where client_token = p_client_token;
    if v_id is not null then return v_id; end if;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- O desconto pedido não pode passar do que a regra concede: quem digita o
  -- valor é a tela, e tela é sugestão — a régua é esta.
  v_max := public.payable_punctuality_discount(
             p_payable_id, coalesce(p_paid_at, current_date));
  if v_disc > v_max then raise exception 'DISCOUNT_NOT_ALLOWED'; end if;

  select coalesce(sum(amount_cents + coalesce(discount_cents, 0)), 0)
    into v_paid
  from public.payable_payments
  where payable_id = p_payable_id and not reversed and reversal_of is null;

  v_saldo := v_p.amount_cents - v_paid;
  if p_amount_cents + v_disc > v_saldo then
    raise exception 'AMOUNT_OVER_BALANCE';
  end if;

  insert into public.payable_payments (
    clinic_id, payable_id, amount_cents, fee_cents, interest_cents,
    discount_cents, paid_at, payment_method, reference, notes, client_token,
    created_by
  ) values (
    v_p.clinic_id, p_payable_id, p_amount_cents, v_fee, v_int, v_disc,
    coalesce(p_paid_at, current_date), nullif(p_payment_method, ''),
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''),
    p_client_token, v_user
  )
  returning id into v_id;

  -- Caixa (DFC): saída na conta da despesa.
  insert into public.financial_entries (
    clinic_id, account_code, cost_center_id, accrual_date, cash_date,
    amount_cents, direction, status, source_type, source_id, description,
    created_by
  ) values (
    v_p.clinic_id, v_p.account_code, v_p.cost_center_id, v_p.accrual_date,
    coalesce(p_paid_at, current_date), p_amount_cents, 'outflow', 'settled',
    'payable_cash', v_id, 'Pagamento — ' || v_p.description, v_user
  )
  on conflict (source_type, source_id) where source_type in
    ('installment_accrual', 'receipt_cash', 'receipt_benefit',
     'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
     'renegotiation_discount', 'renegotiation_surcharge',
     'payable_accrual', 'payable_cash', 'payable_late_fee') do nothing;

  -- Multa e juros que NÓS pagamos: despesa financeira, não custo do serviço.
  if (v_fee + v_int) > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, cost_center_id, accrual_date, cash_date,
      amount_cents, direction, status, source_type, source_id, description,
      created_by
    ) values (
      v_p.clinic_id, '4.2.01', v_p.cost_center_id,
      coalesce(p_paid_at, current_date), coalesce(p_paid_at, current_date),
      v_fee + v_int, 'outflow', 'settled', 'payable_late_fee', v_id,
      'Multa e juros pagos — ' || v_p.description, v_user
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee') do nothing;
  end if;

  -- O DESCONTO: crédito na própria conta de despesa. A unidade não ganhou
  -- dinheiro por pagar em dia — ela gastou menos.
  if v_disc > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, cost_center_id, accrual_date, cash_date,
      amount_cents, direction, status, source_type, source_id, description,
      created_by
    ) values (
      v_p.clinic_id, v_p.account_code, v_p.cost_center_id, v_p.accrual_date,
      null, v_disc, 'inflow', 'open', 'payable_discount', v_id,
      'Desconto por pontualidade — ' || v_p.description, v_user
    )
    on conflict do nothing;

    -- E a franqueadora recebe menos do que reconheceu.
    if v_p.network_fee is not null then
      select id into v_franchisor from public.clinics
       where type = 'franchisor' limit 1;
      select * into v_acc from public.network_fee_accounts(v_p.network_fee);

      if v_franchisor is not null and v_acc.franchisor_account is not null
         and v_franchisor <> v_p.clinic_id then
        insert into public.financial_entries (
          clinic_id, account_code, accrual_date, cash_date, amount_cents,
          direction, status, source_type, source_id, description, created_by
        ) values (
          v_franchisor, v_acc.franchisor_account, v_p.accrual_date, null,
          v_disc, 'outflow', 'open', 'network_fee_discount', v_id,
          'Desconto por pontualidade — ' || v_p.description, v_user
        )
        on conflict do nothing;
      end if;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.register_payable_payment(
  uuid, bigint, date, text, bigint, bigint, text, text, uuid, bigint) from public;
grant execute on function public.register_payable_payment(
  uuid, bigint, date, text, bigint, bigint, text, text, uuid, bigint)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.network_fees
    where punctuality_discount_percent > 0) as taxas_com_desconto,
  (select count(*) from public.payable_payments where discount_cents > 0)
    as baixas_com_desconto,
  (select coalesce(sum(discount_cents), 0) / 100.0
     from public.payable_payments where not reversed) as reais_de_desconto,
  (select count(*) from public.financial_entries
    where source_type in ('payable_discount', 'network_fee_discount'))
    as lancamentos_de_desconto;
