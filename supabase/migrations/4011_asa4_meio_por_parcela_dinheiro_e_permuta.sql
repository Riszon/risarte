-- =============================================================================
-- 4011 — ASA4, entrega 1 (parte 1): MEIO POR PARCELA, DINHEIRO, PERMUTA,
-- PAINEL DO DINHEIRO E "REGISTRAR DEPÓSITO" (spec 19.11 a 19.13; revisão
-- aprovada pelo Jeferson em 14/11/2026 — 19.16)
-- -----------------------------------------------------------------------------
-- VENDA DIRETA NOVA (`direct_sales.method_rule = 'asa4'`, marcada sozinha em
-- toda venda criada depois desta migração; as antigas ficam como estão):
--   * cada parcela diz COMO PAGA: Asaas (pix, boleto, cartão à vista),
--     dinheiro ou permuta; provisório: cartão parcelado na maquininha, só
--     enquanto a chave da rede `card_machine_direct_sale` estiver ligada
--     (desligada pelo Admin Master depois da entrega 2, 19.13);
--   * depósito à vista e crédito recorrente deixam de nascer na venda direta;
--   * à vista (1×) só em Pix, dinheiro ou permuta (o desconto à vista do
--     dinheiro é o do depósito à vista de hoje: a tela calcula, 19.11 ajuste B);
--   * baixa à mão só em dinheiro, permuta, ou cartão parcelado na parcela que
--     é de cartão parcelado; a baixa do Asaas não passa por esta trava;
--   * o adquirente só é gravado na parcela de cartão parcelado.
-- PERMUTA (todas as vendas): só o Gerente da unidade ou o Admin Master, com a
--   descrição obrigatória; entra na conta "Permutas" da unidade (fora do caixa,
--   do fluxo de caixa e da conciliação); não leva cota de benefício em risco;
--   categoria própria nos repasses.
-- FECHAMENTO: a baixa em dinheiro ou permuta de venda ainda não fechada faz o
--   que a confirmação do Asaas faz (`_gateway_confirm_sale`): confirma o
--   pagamento e, com o contrato assinado, FECHA a venda. Sem contrato assinado
--   a baixa é recusada (`CONTRACT_NOT_SIGNED`).
-- TROCA DE MEIO da parcela (`installment_set_method`), com auditoria.
-- DINHEIRO: painel do dinheiro ainda não depositado, aviso depois de N dias
--   úteis (padrão 2) ao Gerente e ao Financeiro da Franqueadora, e "Registrar
--   depósito" com comprovante obrigatório (pasta privada `depositos`).
-- Nenhum dado é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) OS MEIOS NOVOS (só acrescenta valores)
-- -----------------------------------------------------------------------------
alter table public.direct_sales drop constraint if exists direct_sales_payment_method_check;
alter table public.direct_sales add constraint direct_sales_payment_method_check
  check (payment_method is null or payment_method in
    ('pix', 'boleto', 'cartao', 'cartao_parcelado', 'credito_recorrente', 'deposito_avista', 'dinheiro', 'permuta'));

alter table public.payment_installments drop constraint if exists payment_installments_payment_method_check;
alter table public.payment_installments add constraint payment_installments_payment_method_check
  check (payment_method is null or payment_method in
    ('pix', 'boleto', 'cartao', 'cartao_parcelado', 'credito_recorrente', 'deposito_avista', 'dinheiro', 'permuta'));

alter table public.payment_receipts drop constraint if exists payment_receipts_payment_method_check;
alter table public.payment_receipts add constraint payment_receipts_payment_method_check
  check (payment_method is null or payment_method in
    ('pix', 'boleto', 'cartao', 'cartao_parcelado', 'credito_recorrente', 'deposito_avista', 'dinheiro', 'permuta'));

alter table public.bank_accounts drop constraint if exists bank_accounts_kind_check;
alter table public.bank_accounts add constraint bank_accounts_kind_check
  check (kind in ('corrente', 'poupanca', 'caixa', 'aplicacao', 'permuta'));

-- -----------------------------------------------------------------------------
-- 2) A MARCA DA VENDA DIRETA NOVA E A CONFIGURAÇÃO DA REDE
-- -----------------------------------------------------------------------------
-- Sem valor nas antigas (a coluna nasce vazia); toda venda nova nasce 'asa4'.
alter table public.direct_sales add column if not exists method_rule text;
alter table public.direct_sales drop constraint if exists direct_sales_method_rule_check;
alter table public.direct_sales add constraint direct_sales_method_rule_check
  check (method_rule is null or method_rule = 'asa4');
alter table public.direct_sales alter column method_rule set default 'asa4';
comment on column public.direct_sales.method_rule is
  'ASA4 (4011): ''asa4'' = venda direta com meio por parcela (Asaas, dinheiro, permuta). Vazio = venda anterior, regra antiga.';

create table if not exists public.sale_method_settings (
  id boolean primary key default true check (id),
  card_machine_direct_sale boolean not null default true,
  cash_stale_business_days integer not null default 2 check (cash_stale_business_days between 1 and 10),
  cash_panel_since date not null default public.today_br(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
comment on table public.sale_method_settings is
  'ASA4 (4011): maquininha no cartão parcelado da venda direta (provisório até a entrega 2), prazo do dinheiro parado (dias úteis) e a data em que o painel do dinheiro começa.';
insert into public.sale_method_settings (id) values (true) on conflict (id) do nothing;
alter table public.sale_method_settings enable row level security;
drop policy if exists sale_method_settings_select on public.sale_method_settings;
create policy sale_method_settings_select on public.sale_method_settings
  for select to authenticated using (true);

create or replace function public.sale_method_settings_set(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.sale_method_settings%rowtype;
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_old from public.sale_method_settings where id for update;
  update public.sale_method_settings set
    card_machine_direct_sale = coalesce((p ->> 'card_machine_direct_sale')::boolean, card_machine_direct_sale),
    cash_stale_business_days = coalesce((p ->> 'cash_stale_business_days')::integer, cash_stale_business_days),
    updated_at = now(), updated_by = (select auth.uid())
  where id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), null, 'update', 'sale_method_settings', 'rede',
          jsonb_build_object('antes', jsonb_build_object('card_machine_direct_sale', v_old.card_machine_direct_sale,
                                                         'cash_stale_business_days', v_old.cash_stale_business_days),
                             'pedido', p));
end;
$$;
revoke execute on function public.sale_method_settings_set(jsonb) from public, anon, authenticated;
grant execute on function public.sale_method_settings_set(jsonb) to authenticated;

create or replace function public._is_manager_or_admin(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[]);
$$;
revoke execute on function public._is_manager_or_admin(uuid) from public, anon, authenticated;

-- Os meios aceitos numa parcela da venda direta nova.
create or replace function public._direct_sale_method_ok(p_method text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_method is null
      or p_method in ('pix', 'boleto', 'cartao', 'dinheiro', 'permuta')
      or (p_method = 'cartao_parcelado'
          and coalesce((select s.card_machine_direct_sale from public.sale_method_settings s where s.id), false));
$$;
revoke execute on function public._direct_sale_method_ok(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) AS TRAVAS DA VENDA DIRETA NOVA (venda e parcela)
-- -----------------------------------------------------------------------------
create or replace function public.direct_sales_method_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.method_rule is distinct from 'asa4' then return new; end if;
  if tg_op = 'UPDATE'
     and new.payment_method is not distinct from old.payment_method
     and new.installments is not distinct from old.installments then
    return new;
  end if;
  if not public._direct_sale_method_ok(new.payment_method) then
    raise exception 'METHOD_NOT_ALLOWED';
  end if;
  -- À vista (1×): Pix, dinheiro ou permuta (19.11 ajuste B).
  if coalesce(new.installments, 0) = 1
     and new.payment_method is not null
     and new.payment_method not in ('pix', 'dinheiro', 'permuta') then
    raise exception 'CASH_METHOD_ONLY';
  end if;
  if new.payment_method = 'permuta' and (select auth.uid()) is not null
     and not public._is_manager_or_admin(new.clinic_id) then
    raise exception 'PERMUTA_NOT_ALLOWED';
  end if;
  return new;
end;
$$;
revoke execute on function public.direct_sales_method_rule() from public, anon, authenticated;

drop trigger if exists direct_sales_method_rule on public.direct_sales;
create trigger direct_sales_method_rule
  before insert or update on public.direct_sales
  for each row execute function public.direct_sales_method_rule();

create or replace function public.payment_installments_method_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule text;
begin
  if new.direct_sale_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.payment_method is not distinct from old.payment_method then return new; end if;
  select s.method_rule into v_rule from public.direct_sales s where s.id = new.direct_sale_id;
  if v_rule is distinct from 'asa4' then return new; end if;
  if not public._direct_sale_method_ok(new.payment_method) then
    raise exception 'METHOD_NOT_ALLOWED';
  end if;
  if new.payment_method = 'permuta' and (select auth.uid()) is not null
     and not public._is_manager_or_admin(new.clinic_id) then
    raise exception 'PERMUTA_NOT_ALLOWED';
  end if;
  return new;
end;
$$;
revoke execute on function public.payment_installments_method_rule() from public, anon, authenticated;

drop trigger if exists payment_installments_method_rule on public.payment_installments;
create trigger payment_installments_method_rule
  before insert or update of payment_method on public.payment_installments
  for each row execute function public.payment_installments_method_rule();

-- Dinheiro e permuta nunca viram cobrança no Asaas.
create or replace function public.charges_method_supported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_installment_id is null or new.is_external then return new; end if;
  if exists (select 1 from public.payment_installments i
              where i.id = new.payment_installment_id
                and i.payment_method in ('dinheiro', 'permuta')) then
    raise exception 'METHOD_NOT_SUPPORTED';
  end if;
  return new;
end;
$$;
revoke execute on function public.charges_method_supported() from public, anon, authenticated;

drop trigger if exists charges_method_supported on public.charges;
create trigger charges_method_supported
  before insert on public.charges
  for each row execute function public.charges_method_supported();

-- -----------------------------------------------------------------------------
-- 4) O ADQUIRENTE SÓ NA PARCELA DE CARTÃO PARCELADO (venda direta nova)
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
       and coalesce(payment_method, v_method, '') <> 'cartao_parcelado';

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
revoke execute on function public.apply_settlement_projection(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) A PERMUTA NÃO LEVA COTA DE BENEFÍCIO EM RISCO (19.11 ajuste C, item 5)
-- -----------------------------------------------------------------------------
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
       -- 0192: o cartão não corre risco (a adquirente garantiu o dinheiro).
       -- 4011: a permuta também não: vale o combinado, sem atraso.
       when coalesce(t.payment_method, v_method) in ('cartao', 'cartao_parcelado', 'permuta')
         then 0
       else floor(v_benefit::numeric * t.amount_cents / v_sum)
     end
   where ((p_negotiation_id is not null and t.negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and t.direct_sale_id = p_direct_sale_id))
     and t.status in ('em_aberto', 'parcial');

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
revoke execute on function public.apply_sale_benefit_risk(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) A CONTA "PERMUTAS" DA UNIDADE (fora do caixa e da conciliação)
-- -----------------------------------------------------------------------------
create unique index if not exists bank_accounts_one_permuta_per_clinic
  on public.bank_accounts (clinic_id) where kind = 'permuta' and active;

create or replace function public._permuta_account_for(p_clinic_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.bank_accounts
   where clinic_id = p_clinic_id and kind = 'permuta' and active
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.bank_accounts (clinic_id, alias, kind, opening_balance_cents, opening_date, active)
  values (p_clinic_id, 'Permutas', 'permuta', 0, public.today_br(), true)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.bank_accounts
     where clinic_id = p_clinic_id and kind = 'permuta' and active
     order by created_at limit 1;
  end if;
  return v_id;
end;
$$;
revoke execute on function public._permuta_account_for(uuid) from public, anon, authenticated;

-- 0317 + 4011: permuta → conta "Permutas"; a conta bancária "única" não conta
-- o Caixa nem a conta de permutas.
create or replace function public._default_bank_account(
  p_clinic_id uuid, p_method text, p_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer;
begin
  if p_method = 'dinheiro' then
    return public._cash_box_for(p_clinic_id, p_date);
  end if;
  if p_method = 'permuta' then
    return public._permuta_account_for(p_clinic_id);
  end if;
  select id into v_id from public.bank_accounts
   where clinic_id = p_clinic_id and is_default and active limit 1;
  if v_id is not null then return v_id; end if;
  select count(*), min(id::text)::uuid into v_n, v_id from public.bank_accounts
   where clinic_id = p_clinic_id and active and kind not in ('caixa', 'permuta');
  if v_n = 1 then return v_id; end if;
  return null;
end;
$$;
revoke execute on function public._default_bank_account(uuid, text, date) from public, anon, authenticated;

-- O FLUXO DE CAIXA não conta a permuta: ela não é dinheiro (nem realizada,
-- na conta "Permutas", nem prevista, na parcela de permuta). Mesmas funções da
-- 0230/0372, com esse filtro a mais.
create or replace function public.cash_flow_series_raw(
  p_clinic_id uuid,
  p_from date,
  p_to date
)
returns table (
  day date,
  kind text,
  activity text,
  inflow_cents bigint,
  outflow_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.cash_date,
    'realizado'::text,
    case
      when e.account_code like '5.1%' then 'investimento'
      when e.account_code like '5.3%'
        or e.account_code like '5.4%'   then 'financiamento'
      else 'operacional'
    end,
    sum(case when e.direction = 'inflow' then e.amount_cents else 0 end)::bigint,
    sum(case when e.direction = 'outflow' then e.amount_cents else 0 end)::bigint
  from public.financial_entries e
  where e.clinic_id = p_clinic_id
    and e.cash_date between p_from and p_to
    and e.status = 'settled'
    and e.reversal_of is null
    and not exists (select 1 from public.bank_accounts b where b.id = e.bank_account_id and b.kind = 'permuta')
  group by 1, 2, 3

  union all

  select
    coalesce(i.expected_settlement_date, i.due_date),
    'previsto'::text,
    'operacional'::text,
    sum(i.amount_cents - coalesce(i.paid_amount_cents, 0))::bigint,
    0::bigint
  from public.payment_installments i
  where i.clinic_id = p_clinic_id
    and i.status in ('em_aberto', 'parcial')
    and i.amount_cents > coalesce(i.paid_amount_cents, 0)
    and coalesce(i.payment_method, '') <> 'permuta'
    and coalesce(i.expected_settlement_date, i.due_date)
        between greatest(p_from, public.today_br()) and p_to
  group by 1, 2, 3

  union all

  select
    p.due_date,
    'previsto'::text,
    case
      when p.account_code like '5.1%' then 'investimento'
      when p.account_code like '5.3%'
        or p.account_code like '5.4%'   then 'financiamento'
      else 'operacional'
    end,
    0::bigint,
    sum(p.amount_cents - coalesce(p.paid_amount_cents, 0))::bigint
  from public.payables p
  where p.clinic_id = p_clinic_id
    and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
    and p.amount_cents > coalesce(p.paid_amount_cents, 0)
    and p.due_date between greatest(p_from, public.today_br()) and p_to
  group by 1, 2, 3;
$$;
revoke all on function public.cash_flow_series_raw(uuid, date, date) from public;

create or replace function public.cash_balance_before(
  p_clinic_id uuid,
  p_date date
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null
     and not public.can_see_clinic_finance(p_clinic_id) then 0
    else
      coalesce((
        select sum(b.opening_balance_cents)
          from public.bank_accounts b
         where b.clinic_id = p_clinic_id and b.active and b.kind <> 'permuta'
      ), 0)
      + coalesce((
        select sum(case when e.direction = 'inflow'
                        then e.amount_cents else -e.amount_cents end)
          from public.financial_entries e
         where e.clinic_id = p_clinic_id
           and e.cash_date is not null
           and e.cash_date < p_date
           and e.status = 'settled'
           and e.reversal_of is null
           and not exists (select 1 from public.bank_accounts b where b.id = e.bank_account_id and b.kind = 'permuta')
      ), 0)
  end::bigint;
$$;
revoke execute on function public.cash_balance_before(uuid, date) from public, anon, authenticated;
grant execute on function public.cash_balance_before(uuid, date) to authenticated;

create or replace function public.cash_flow_detail(
  p_clinic_id uuid,
  p_from date,
  p_to date
)
returns table (
  ref_date date,
  kind text,
  direction text,
  amount_cents bigint,
  description text,
  source_type text,
  source_id uuid,
  created_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select
      e.cash_date, 'realizado', e.direction, e.amount_cents,
      coalesce(e.description, e.source_type), e.source_type, e.source_id,
      (select pr.full_name from public.profiles pr where pr.id = e.created_by)
    from public.financial_entries e
    where e.clinic_id = p_clinic_id
      and e.cash_date between p_from and p_to
      and e.status = 'settled'
      and e.reversal_of is null
      and not exists (select 1 from public.bank_accounts b where b.id = e.bank_account_id and b.kind = 'permuta')
      and public.can_see_clinic_finance(p_clinic_id)

    union all

    select
      coalesce(i.expected_settlement_date, i.due_date), 'previsto', 'inflow',
      (i.amount_cents - coalesce(i.paid_amount_cents, 0))::bigint,
      case when i.kind = 'entrada' then 'Entrada da venda a receber'
           else 'Parcela ' || i.seq || ' a receber' end
        || case when coalesce(i.paid_amount_cents, 0) > 0
                then ' (saldo)' else '' end,
      'installment_expected', i.id,
      null::text
    from public.payment_installments i
    where i.clinic_id = p_clinic_id
      and i.status in ('em_aberto', 'parcial')
      and i.amount_cents > coalesce(i.paid_amount_cents, 0)
      and coalesce(i.payment_method, '') <> 'permuta'
      and coalesce(i.expected_settlement_date, i.due_date)
          between greatest(p_from, public.today_br()) and p_to
      and public.can_see_clinic_finance(p_clinic_id)

    union all

    select
      p.due_date, 'previsto', 'outflow',
      (p.amount_cents - coalesce(p.paid_amount_cents, 0))::bigint,
      p.description
        || case when p.status = 'aguardando_autorizacao'
                then ' (esperando autorização)' else '' end,
      'payable_expected', p.id,
      (select pr.full_name from public.profiles pr where pr.id = p.created_by)
    from public.payables p
    where p.clinic_id = p_clinic_id
      and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
      and p.amount_cents > coalesce(p.paid_amount_cents, 0)
      and p.due_date between greatest(p_from, public.today_br()) and p_to
      and public.can_see_clinic_finance(p_clinic_id)
  ) t
  order by 1, 2, 4 desc
  limit 300;
$$;
revoke execute on function public.cash_flow_detail(uuid, date, date) from public, anon, authenticated;
grant execute on function public.cash_flow_detail(uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) A BAIXA À MÃO: meio aceito, permuta e o fechamento da venda
-- -----------------------------------------------------------------------------
create or replace function public.payment_receipts_method_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.payment_installments%rowtype;
  v_rule text;
begin
  if new.reversal_of is not null then return new; end if;
  if coalesce(current_setting('risarte.baixa_do_asaas', true), '') = '1' then return new; end if;
  select * into v_inst from public.payment_installments where id = new.installment_id;
  if v_inst.id is null then return new; end if;

  if v_inst.direct_sale_id is not null then
    select s.method_rule into v_rule from public.direct_sales s where s.id = v_inst.direct_sale_id;
  end if;

  if v_rule = 'asa4' then
    if not (coalesce(new.payment_method, '') in ('dinheiro', 'permuta')
            or (new.payment_method = 'cartao_parcelado' and v_inst.payment_method = 'cartao_parcelado')) then
      raise exception 'RECEIPT_METHOD_NOT_ALLOWED';
    end if;
    -- Na venda nova, permuta só na parcela que É de permuta (a troca é pela
    -- porta própria, com o Gerente).
    if new.payment_method = 'permuta' and v_inst.payment_method is distinct from 'permuta' then
      raise exception 'PERMUTA_NEEDS_METHOD_CHANGE';
    end if;
  end if;

  if new.payment_method = 'permuta' then
    if (select auth.uid()) is not null and not public._is_manager_or_admin(new.clinic_id) then
      raise exception 'PERMUTA_NOT_ALLOWED';
    end if;
    if coalesce(btrim(new.notes), '') = '' then
      raise exception 'PERMUTA_DESCRIPTION_REQUIRED';
    end if;
    -- A permuta não entra em conta escolhida na tela: vai para "Permutas".
    perform set_config('risarte.conta_do_dinheiro', '', true);
  end if;
  return new;
end;
$$;
revoke execute on function public.payment_receipts_method_rule() from public, anon, authenticated;

drop trigger if exists payment_receipts_method_rule on public.payment_receipts;
create trigger payment_receipts_method_rule
  before insert on public.payment_receipts
  for each row execute function public.payment_receipts_method_rule();

-- O balcão confirma a venda como o Asaas confirma (19.11 ajuste C, item 4).
create or replace function public._counter_confirm_sale(
  p_installment_id uuid, p_source text, p_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_installments%rowtype;
  v_d public.direct_sales%rowtype;
  v_c public.commercial_sales%rowtype;
  v_closed boolean;
begin
  select * into v from public.payment_installments i where i.id = p_installment_id;
  if not found then raise exception 'INSTALLMENT_NOT_FOUND'; end if;

  if v.direct_sale_id is not null then
    select * into v_d from public.direct_sales s where s.id = v.direct_sale_id for update;
    if v_d.closed_at is not null then return true; end if;
    if v_d.cancelled then raise exception 'SALE_NOT_CLOSED'; end if;
    if not v_d.contract_signed then raise exception 'CONTRACT_NOT_SIGNED'; end if;
    update public.direct_sales
       set payment_confirmed = true,
           payment_confirmed_at = coalesce(payment_confirmed_at, now()),
           payment_confirmed_by = coalesce(payment_confirmed_by, p_user),
           payment_confirmed_source = coalesce(payment_confirmed_source, p_source),
           status = 'concluida', closed_at = now(), updated_at = now()
     where id = v_d.id;
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (p_user, v_d.clinic_id, 'update', 'direct_sale_close', v_d.id::text,
            jsonb_build_object('step', 'payment_confirmed', 'value', true, 'source', p_source, 'closed', true));
    return true;
  elsif v.negotiation_id is not null then
    select * into v_c from public.commercial_sales cs where cs.negotiation_id = v.negotiation_id for update;
    if v_c.id is not null and v_c.closed_at is not null then return true; end if;
    perform public._commercial_close_step_raw(v.negotiation_id, 'payment_confirmed', true, p_user, p_source, null);
    select cs.closed_at is not null into v_closed from public.commercial_sales cs where cs.negotiation_id = v.negotiation_id;
    if not coalesce(v_closed, false) then raise exception 'CONTRACT_NOT_SIGNED'; end if;
    update public.commercial_sales set payment_confirmed_source = coalesce(payment_confirmed_source, p_source)
     where negotiation_id = v.negotiation_id;
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public._counter_confirm_sale(uuid, text, uuid) from public, anon, authenticated;

-- 0203 + 4011: a regra de ouro continua (não se recebe por venda não fechada),
-- com uma porta: a baixa em DINHEIRO ou PERMUTA fecha a venda na mesma
-- transação, como a confirmação do Asaas. Sem contrato assinado, recusa.
create or replace function public.enforce_sale_closed_before_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_closed boolean;
begin
  if new.reversal_of is not null then return new; end if;

  select * into v_inst
  from public.payment_installments where id = new.installment_id;
  if v_inst.id is null then return new; end if;

  if v_inst.renegotiation_id is not null then return new; end if;

  if v_inst.direct_sale_id is not null then
    select s.closed_at is not null into v_closed
    from public.direct_sales s where s.id = v_inst.direct_sale_id;
  elsif v_inst.negotiation_id is not null then
    select cs.closed_at is not null into v_closed
    from public.commercial_sales cs
    where cs.negotiation_id = v_inst.negotiation_id;
  else
    return new;
  end if;

  if not coalesce(v_closed, false) then
    if coalesce(new.payment_method, '') in ('dinheiro', 'permuta')
       and coalesce(current_setting('risarte.baixa_do_asaas', true), '') <> '1' then
      perform public._counter_confirm_sale(
        new.installment_id,
        case when new.payment_method = 'permuta' then 'permuta' else 'balcao' end,
        (select auth.uid()));
      return new;
    end if;
    raise exception 'SALE_NOT_CLOSED';
  end if;

  return new;
end;
$$;
revoke execute on function public.enforce_sale_closed_before_receipt() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) A TROCA DE MEIO DA PARCELA (19.11 ajuste C)
-- -----------------------------------------------------------------------------
-- Cobrança ativa no Asaas: a tela cancela antes (cancelarNoAsaas); o banco
-- recusa a troca enquanto ela existir (CHARGE_ACTIVE, 4004).
create or replace function public.installment_set_method(
  p_installment_id uuid, p_method text, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_installments%rowtype;
  v_sale public.direct_sales%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into v from public.payment_installments where id = p_installment_id for update;
  if v.id is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if v.direct_sale_id is null then raise exception 'NOT_NEW_RULE'; end if;
  select * into v_sale from public.direct_sales where id = v.direct_sale_id;
  if v_sale.method_rule is distinct from 'asa4' then raise exception 'NOT_NEW_RULE'; end if;
  if not (public.can_receive_payment(v.clinic_id) or v_sale.created_by = v_user) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v.status not in ('em_aberto', 'parcial') then raise exception 'INSTALLMENT_CLOSED'; end if;
  if p_method is null or p_method not in ('pix', 'boleto', 'cartao', 'dinheiro', 'permuta') then
    raise exception 'METHOD_NOT_ALLOWED';
  end if;
  if p_method = 'permuta' and not public._is_manager_or_admin(v.clinic_id) then
    raise exception 'PERMUTA_NOT_ALLOWED';
  end if;
  if p_method = 'permuta' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'PERMUTA_DESCRIPTION_REQUIRED';
  end if;
  if v.payment_method is not distinct from p_method then return; end if;

  -- Só ESTA parcela muda: recalcular o rateio do benefício mexeria em parcela
  -- com cobrança ativa (CHARGE_ACTIVE, 4004). Na permuta, a cota sai.
  update public.payment_installments
     set payment_method = p_method,
         benefit_discount_cents = case when p_method = 'permuta' then 0 else benefit_discount_cents end,
         acquirer_id = null, expected_settlement_date = due_date
   where id = v.id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v.clinic_id, 'update', 'installment_method', v.id::text,
          jsonb_build_object('de', v.payment_method, 'para', p_method,
                             'motivo', nullif(btrim(p_reason), ''), 'venda_direta', v.direct_sale_id));
end;
$$;
revoke execute on function public.installment_set_method(uuid, text, text) from public, anon, authenticated;
grant execute on function public.installment_set_method(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) O DINHEIRO: depósitos e comprovantes
-- -----------------------------------------------------------------------------
create table if not exists public.cash_deposits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  kind text not null default 'manual' check (kind in ('manual')),
  bank_account_id uuid not null references public.bank_accounts (id),
  deposited_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  receipts_cents bigint not null check (receipts_cents > 0),
  difference_reason text,
  proof_path text not null,
  proof_name text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles (id),
  undo_reason text
);
comment on table public.cash_deposits is
  'ASA4 (4011): depósito do dinheiro do Caixa no banco, com comprovante (pasta privada `depositos`). Desfazer é lógico, com motivo.';
create index if not exists cash_deposits_clinic on public.cash_deposits (clinic_id, deposited_on desc);

create table if not exists public.cash_deposit_items (
  deposit_id uuid not null references public.cash_deposits (id) on delete restrict,
  receipt_id uuid not null references public.payment_receipts (id),
  amount_cents bigint not null check (amount_cents > 0),
  active boolean not null default true,
  primary key (deposit_id, receipt_id)
);
create unique index if not exists cash_deposit_items_one_active
  on public.cash_deposit_items (receipt_id) where active;

alter table public.cash_deposits enable row level security;
alter table public.cash_deposit_items enable row level security;
drop policy if exists cash_deposits_select on public.cash_deposits;
create policy cash_deposits_select on public.cash_deposits for select to authenticated
  using (public.can_receive_payment(clinic_id) or public.can_manage_payables(clinic_id));
drop policy if exists cash_deposit_items_select on public.cash_deposit_items;
create policy cash_deposit_items_select on public.cash_deposit_items for select to authenticated
  using (exists (select 1 from public.cash_deposits d where d.id = deposit_id
                  and (public.can_receive_payment(d.clinic_id) or public.can_manage_payables(d.clinic_id))));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('depositos', 'depositos', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.clinic_of_storage_path(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
revoke execute on function public.clinic_of_storage_path(text) from public, anon, authenticated;
grant execute on function public.clinic_of_storage_path(text) to authenticated;

-- VER = quem vê o dinheiro da unidade; ENVIAR = quem registra depósito;
-- APAGAR = ninguém (o comprovante é prova).
drop policy if exists "depositos_select" on storage.objects;
create policy "depositos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'depositos'
    and public.clinic_of_storage_path(name) is not null
    and (public.can_receive_payment(public.clinic_of_storage_path(name))
         or public.can_manage_payables(public.clinic_of_storage_path(name)))
  );
drop policy if exists "depositos_insert" on storage.objects;
create policy "depositos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'depositos'
    and public.clinic_of_storage_path(name) is not null
    and public.can_manage_payables(public.clinic_of_storage_path(name))
  );

-- O dinheiro que ainda não foi depositado: baixa em dinheiro que entrou no
-- Caixa, sem estorno, desde a data do painel, fora de depósito ativo.
create or replace function public._cash_pending(p_clinic_id uuid)
returns table (receipt_id uuid, received_at date, amount_cents bigint,
               installment_id uuid, client_id uuid, created_by uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.received_at, r.amount_cents::bigint, r.installment_id, i.client_id, r.created_by
    from public.payment_receipts r
    join public.payment_installments i on i.id = r.installment_id
   where r.clinic_id = p_clinic_id
     and r.payment_method = 'dinheiro'
     and r.reversal_of is null
     and not coalesce(r.reversed, false)
     and r.received_at >= (select s.cash_panel_since from public.sale_method_settings s where s.id)
     and exists (select 1 from public.financial_entries e
                   join public.bank_accounts b on b.id = e.bank_account_id
                  where e.source_type = 'receipt_cash' and e.source_id = r.id and b.kind = 'caixa')
     and not exists (select 1 from public.cash_deposit_items x where x.receipt_id = r.id and x.active);
$$;
revoke execute on function public._cash_pending(uuid) from public, anon, authenticated;

create or replace function public.cash_panel_read(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
  v_days integer;
  v_out jsonb;
begin
  if p_clinic_id is null or not (public.can_receive_payment(p_clinic_id) or public.can_manage_payables(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  select s.cash_stale_business_days into v_days from public.sale_method_settings s where s.id;

  select jsonb_build_object(
    'prazo_dias_uteis', v_days,
    'desde', (select s.cash_panel_since from public.sale_method_settings s where s.id),
    'pode_registrar', public.can_manage_payables(p_clinic_id),
    'pode_desfazer', public._is_manager_or_admin(p_clinic_id),
    'pendentes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'receipt_id', p.receipt_id, 'recebido_em', p.received_at, 'valor', p.amount_cents,
               'cliente', c.full_name, 'codigo', c.code, 'client_id', p.client_id,
               'parado', public._payout_add_business_days(p.received_at, v_days) < v_today,
               'quem', pr.full_name)
             order by p.received_at, c.full_name)
        from public._cash_pending(p_clinic_id) p
        left join public.clients c on c.id = p.client_id
        left join public.profiles pr on pr.id = p.created_by), '[]'),
    'depositos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'data', d.deposited_on, 'valor', d.amount_cents, 'recebimentos', d.receipts_cents,
               'diferenca_motivo', d.difference_reason, 'conta', b.alias, 'comprovante', d.proof_path,
               'comprovante_nome', d.proof_name, 'quem', pr.full_name, 'registrado_em', d.created_at,
               'desfeito_em', d.undone_at, 'motivo_desfazer', d.undo_reason,
               'itens', (select count(*) from public.cash_deposit_items x where x.deposit_id = d.id))
             order by d.deposited_on desc, d.created_at desc)
        from public.cash_deposits d
        join public.bank_accounts b on b.id = d.bank_account_id
        left join public.profiles pr on pr.id = d.created_by
       where d.clinic_id = p_clinic_id and d.deposited_on >= v_today - 90), '[]'),
    'contas', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'nome', b.alias, 'padrao', b.is_default) order by b.is_default desc, b.alias)
        from public.bank_accounts b
       where b.clinic_id = p_clinic_id and b.active and b.kind in ('corrente', 'poupanca')), '[]')
  ) into v_out;
  return v_out;
end;
$$;
revoke execute on function public.cash_panel_read(uuid) from public, anon, authenticated;
grant execute on function public.cash_panel_read(uuid) to authenticated;

create or replace function public.cash_deposit_register(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_clinic uuid := nullif(p ->> 'clinic_id', '')::uuid;
  v_bank uuid := nullif(p ->> 'bank_account_id', '')::uuid;
  v_date date := nullif(p ->> 'deposited_on', '')::date;
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint;
  v_path text := nullif(btrim(p ->> 'proof_path'), '');
  v_reason text := nullif(btrim(p ->> 'difference_reason'), '');
  v_ids uuid[];
  v_sum bigint;
  v_n integer;
  v_box uuid;
  v_id uuid;
begin
  if v_clinic is null or not public.can_manage_payables(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if v_date is null or v_date > public.today_br() then raise exception 'INVALID_DATE'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists (select 1 from public.bank_accounts b where b.id = v_bank and b.clinic_id = v_clinic
                    and b.active and b.kind in ('corrente', 'poupanca')) then
    raise exception 'BANK_ACCOUNT_INVALID';
  end if;
  if v_path is null or public.clinic_of_storage_path(v_path) is distinct from v_clinic
     or not exists (select 1 from storage.objects o where o.bucket_id = 'depositos' and o.name = v_path) then
    raise exception 'PROOF_REQUIRED';
  end if;
  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p -> 'receipt_ids', '[]')) x;
  if v_ids is null then raise exception 'RECEIPTS_REQUIRED'; end if;

  -- Trava os recebimentos e confere que todos estão pendentes nesta unidade.
  perform 1 from public.payment_receipts r where r.id = any (v_ids) for update;
  select count(*), coalesce(sum(p.amount_cents), 0) into v_n, v_sum
    from public._cash_pending(v_clinic) p where p.receipt_id = any (v_ids);
  if v_n <> array_length(v_ids, 1) then raise exception 'RECEIPT_NOT_PENDING'; end if;
  if v_amount <> v_sum and v_reason is null then raise exception 'DIFFERENCE_REASON_REQUIRED'; end if;

  insert into public.cash_deposits (clinic_id, bank_account_id, deposited_on, amount_cents, receipts_cents,
                                    difference_reason, proof_path, proof_name, created_by)
  values (v_clinic, v_bank, v_date, v_amount, v_sum, case when v_amount <> v_sum then v_reason end,
          v_path, nullif(btrim(p ->> 'proof_name'), ''), v_user)
  returning id into v_id;

  insert into public.cash_deposit_items (deposit_id, receipt_id, amount_cents)
  select v_id, r.id, r.amount_cents from public.payment_receipts r where r.id = any (v_ids);

  -- A transferência do Caixa para o banco (6.3.01, fora do resultado).
  v_box := public._cash_box_for(v_clinic, v_date);
  insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction,
                                        status, source_type, source_id, description, created_by, bank_account_id)
  values (v_clinic, '6.3.01', v_date, v_date, v_amount, 'outflow', 'settled', 'cash_deposit', v_id,
          'Depositado no banco', v_user, v_box),
         (v_clinic, '6.3.01', v_date, v_date, v_amount, 'inflow', 'settled', 'cash_deposit', v_id,
          'Depósito do dinheiro do Caixa', v_user, v_bank);

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'cash_deposit', v_id::text,
          jsonb_build_object('valor', v_amount, 'recebimentos', v_sum, 'qtd', v_n, 'data', v_date,
                             'conta', v_bank, 'diferenca_motivo', v_reason));
  return v_id;
end;
$$;
revoke execute on function public.cash_deposit_register(jsonb) from public, anon, authenticated;
grant execute on function public.cash_deposit_register(jsonb) to authenticated;

create or replace function public.cash_deposit_undo(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v public.cash_deposits%rowtype;
begin
  select * into v from public.cash_deposits where id = p_id for update;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public._is_manager_or_admin(v.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v.undone_at is not null then raise exception 'ALREADY_UNDONE'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  -- Já ligado a uma linha do extrato: desfaça a conciliação antes.
  if exists (select 1 from public.financial_entries e
              where e.source_type = 'cash_deposit' and e.source_id = v.id
                and (e.reconciled_at is not null
                     or exists (select 1 from public.bank_transaction_matches m where m.entry_id = e.id))) then
    raise exception 'DEPOSIT_RECONCILED';
  end if;

  insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction,
                                        status, source_type, source_id, description, reversal_of, reversal_reason,
                                        created_by, bank_account_id)
  select e.clinic_id, e.account_code, e.accrual_date, public.today_br(), e.amount_cents,
         case when e.direction = 'inflow' then 'outflow' else 'inflow' end, 'settled', 'cash_deposit', v.id,
         'Estorno — ' || coalesce(e.description, 'depósito'), e.id, btrim(p_reason), v_user, e.bank_account_id
    from public.financial_entries e
   where e.source_type = 'cash_deposit' and e.source_id = v.id and e.reversal_of is null and e.status = 'settled';
  update public.financial_entries set status = 'reversed'
   where source_type = 'cash_deposit' and source_id = v.id and reversal_of is null;

  update public.cash_deposit_items set active = false where deposit_id = v.id;
  update public.cash_deposits set undone_at = now(), undone_by = v_user, undo_reason = btrim(p_reason) where id = v.id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v.clinic_id, 'update', 'cash_deposit', v.id::text,
          jsonb_build_object('desfeito', true, 'motivo', btrim(p_reason), 'valor', v.amount_cents));
end;
$$;
revoke execute on function public.cash_deposit_undo(uuid, text) from public, anon, authenticated;
grant execute on function public.cash_deposit_undo(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10) O AVISO DO DINHEIRO PARADO (só banco: pg_cron, todo dia 09:00 BRT)
-- -----------------------------------------------------------------------------
create table if not exists public.cash_stale_notices (
  clinic_id uuid not null references public.clinics (id),
  day date not null,
  primary key (clinic_id, day)
);
alter table public.cash_stale_notices enable row level security;

create or replace function public.cash_stale_alerts_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
  v_days integer;
  v_c record;
  v_new boolean;
  v_n integer := 0;
  v_k integer;
begin
  select s.cash_stale_business_days into v_days from public.sale_method_settings s where s.id;
  for v_c in
    select k.id as clinic_id, k.name, x.qtd, x.total
      from public.clinics k
      cross join lateral (
        select count(*) as qtd, coalesce(sum(p.amount_cents), 0) as total
          from public._cash_pending(k.id) p
         where public._payout_add_business_days(p.received_at, v_days) < v_today) x
     where x.qtd > 0
  loop
    v_new := false;
    insert into public.cash_stale_notices (clinic_id, day) values (v_c.clinic_id, v_today)
    on conflict do nothing returning true into v_new;
    if not coalesce(v_new, false) then continue; end if;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct u.user_id, v_c.clinic_id, 'Dinheiro parado no caixa',
           v_c.name || ': ' || public.brl(v_c.total::bigint) || ' em ' || v_c.qtd || ' recebimento(s) há mais de '
             || v_days || ' dias úteis sem depósito.',
           '/financeiro/dinheiro?unidade=' || v_c.clinic_id::text
      from (select ucr.user_id from public.user_clinic_roles ucr
             where ucr.clinic_id = v_c.clinic_id and ucr.role = 'unit_manager'
            union
            select ucr.user_id from public.user_clinic_roles ucr where ucr.role = 'finance_franchisor') u;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.cash_stale_alerts_run() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('risarte-dinheiro-parado', '0 12 * * *', 'select public.cash_stale_alerts_run()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11) REPASSES: a PERMUTA tem categoria própria e lista para o Financeiro
-- -----------------------------------------------------------------------------
create or replace function public._franchise_payout_receipts(
  p_from date, p_to date, p_clinics uuid[], p_clinic uuid
)
returns table (
  receipt_id uuid, clinic_id uuid, received_at date, amount_cents bigint,
  category text, skip_reason text, due_cents bigint, retained_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.clinic_id, r.received_at,
         case when coalesce(r.reversed, false) then 0 else r.amount_cents end,
         case
           when coalesce(r.reversed, false) then 'estornado'
           when r.reference like 'Asaas %' then
             case when ch.split_applied then 'split' else 'asaas_sem_split' end
           when r.payment_method = 'permuta' then 'permuta'
           when exists (select 1 from public.charges x
                         where x.payment_installment_id = r.installment_id
                           and x.is_external and x.status <> 'cancelada') then 'externa'
           when r.payment_method = 'dinheiro' then 'dinheiro'
           when r.payment_method in ('cartao', 'cartao_parcelado', 'credito_recorrente') then 'cartao'
           when r.payment_method in ('pix', 'deposito_avista') then 'deposito_pix'
           else 'externa'
         end,
         case when r.reference like 'Asaas %' and not coalesce(ch.split_applied, false)
              then coalesce(ch.split_skip_reason, 'antes_do_split') end,
         coalesce((select sum(sc.amount_cents) from public.split_charges sc
                    where sc.source_type = 'receipt' and sc.source_id = r.id and not sc.reversed), 0)::bigint,
         coalesce((select sum(sc.retained_cents) from public.split_charges sc
                    where sc.source_type = 'receipt' and sc.source_id = r.id and not sc.reversed), 0)::bigint
    from public.payment_receipts r
    left join lateral (
      select c.split_applied, c.split_skip_reason from public.charges c
       where r.reference like 'Asaas %' and c.asaas_payment_id = substr(r.reference, 7)
       limit 1
    ) ch on true
   where r.reversal_of is null
     and (not coalesce(r.reversed, false) or exists (
           select 1 from public.split_charges k
            where k.source_type = 'receipt' and k.source_id = r.id and not k.reversed))
     and r.received_at between p_from and p_to
     and (p_clinic is null or r.clinic_id = p_clinic)
     and (p_clinics is null or r.clinic_id = any (p_clinics));
$$;
revoke execute on function public._franchise_payout_receipts(date, date, uuid[], uuid) from public, anon, authenticated;

create or replace function public.franchise_payouts_permutas(p_from date, p_to date, p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinics uuid[] := public._gateway_cap_clinics('modulo.repasses_franquia');
begin
  if v_clinics is not null and coalesce(array_length(v_clinics, 1), 0) = 0 then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_clinic_id is not null and v_clinics is not null and not (p_clinic_id = any (v_clinics)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_PERIOD'; end if;
  if p_to - p_from > 400 then raise exception 'PERIOD_TOO_LONG'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'receipt_id', r.id, 'clinic_id', r.clinic_id, 'unidade', k.name, 'data', r.received_at,
             'valor', case when coalesce(r.reversed, false) then 0 else r.amount_cents end,
             'estornado', coalesce(r.reversed, false),
             'descricao', r.notes, 'cliente', c.full_name, 'codigo', c.code, 'client_id', i.client_id,
             'quem', pr.full_name,
             'taxa', coalesce((select sum(sc.amount_cents) from public.split_charges sc
                                where sc.source_type = 'receipt' and sc.source_id = r.id and not sc.reversed), 0))
           order by r.received_at, k.name)
      from public.payment_receipts r
      join public.payment_installments i on i.id = r.installment_id
      join public.clinics k on k.id = r.clinic_id
      left join public.clients c on c.id = i.client_id
      left join public.profiles pr on pr.id = r.created_by
     where r.payment_method = 'permuta' and r.reversal_of is null
       and r.received_at between p_from and p_to
       and (p_clinic_id is null or r.clinic_id = p_clinic_id)
       and (v_clinics is null or r.clinic_id = any (v_clinics))), '[]');
end;
$$;
revoke execute on function public.franchise_payouts_permutas(date, date, uuid) from public, anon, authenticated;
grant execute on function public.franchise_payouts_permutas(date, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 12) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'installment_set_method', 'cash_panel_read', 'cash_deposit_register', 'cash_deposit_undo',
      'cash_stale_alerts_run', 'franchise_payouts_permutas', '_counter_confirm_sale',
      'payment_receipts_method_rule', 'direct_sales_method_rule', 'payment_installments_method_rule',
      'charges_method_supported')) as funcoes_novas,
  (select count(*) from public.direct_sales where method_rule = 'asa4') as vendas_novas,
  (select count(*) from public.direct_sales where method_rule is null) as vendas_antigas,
  (select card_machine_direct_sale from public.sale_method_settings where id) as maquininha_no_parcelado,
  (select cash_panel_since from public.sale_method_settings where id) as painel_desde,
  (select count(*) from cron.job where jobname = 'risarte-dinheiro-parado') as rotina_dinheiro_parado,
  (select not public from storage.buckets where id = 'depositos') as pasta_privada;
