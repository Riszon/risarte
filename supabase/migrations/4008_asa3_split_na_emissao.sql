-- =============================================================================
-- 4008 — ASA3, ENTREGA 1: O SPLIT NA EMISSÃO
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/integracao-asaas.md, seção 18.
--
--   * PARA ONDE VAI CADA TAXA (S7): `network_fee_types.split_account_id` aponta
--     a carteira de destino (uma conta em `gateway_accounts` do tipo
--     franqueadora ou recebedora). Vazio = a conta raiz (franqueadora) do mesmo
--     ambiente. O fundo de propaganda pode ter carteira própria (D6).
--   * O QUE FOI ENVIADO (`charge_splits`): uma linha por carteira em cada
--     cobrança, com o percentual somado, o `percentualValue` e o `fixedValue`
--     enviados (método B, 18.2), o rateio por taxa, o id do split no Asaas e o
--     VALOR LIQUIDADO que chega no aviso `PAYMENT_SPLIT_DONE` (ajuste 2).
--   * RETIDO NA ORIGEM: `split_charges.retained_cents`. O que o split reteve
--     sai da conta a pagar de taxa (nada em dobro) e entra no razão como
--     despesa da unidade e receita da franqueadora, por taxa, liquidado quando
--     o Asaas avisa. Diferença a menor até a TOLERÂNCIA da rede (S5, padrão
--     R$ 0,10 por cobrança) é absorvida; acima, o que faltou volta para a conta
--     a pagar. Repasse a maior vira aviso de divergência ao Financeiro.
--   * OS AVISOS DE SPLIT (`PAYMENT_SPLIT_*`), que a 4005 só guardava, passam a
--     valer — inclusive os já guardados.
--   * O primeiro split aceito pelo Asaas CONFIRMA o "split habilitado" (S6).
--   * S4: NÃO EXISTE desconto de pontualidade nas taxas da franquia. O campo é
--     zerado e travado em zero. Pagamentos já registrados não mudam.
--   * Configuração da rede (`gateway_split_settings`): a tolerância da S5 e a
--     multa e os juros da cobrança mensal à unidade (ASA6), em branco até o
--     dono preencher conforme o contrato (em branco = sem multa e sem juros).
--   * O histórico da aba Taxas da franquia em `central_history`.
--
-- ⚠️ Nenhuma chamada ao Asaas sai do banco: o servidor monta e envia o split
-- (`src/lib/asaas/split.ts`) com o plano que o banco devolve.
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) S4: SEM DESCONTO DE PONTUALIDADE NAS TAXAS DA FRANQUIA
-- -----------------------------------------------------------------------------
-- Só o percentual configurado é zerado (na produção já era zero em 13/11/2026).
-- `payable_payments.discount_cents` (o que já foi pago com desconto) fica como
-- está: o razão não é reescrito.
update public.network_fees
   set punctuality_discount_percent = 0, updated_at = now()
 where punctuality_discount_percent <> 0;

alter table public.network_fees drop constraint if exists network_fees_sem_pontualidade;
alter table public.network_fees
  add constraint network_fees_sem_pontualidade check (punctuality_discount_percent = 0);

-- -----------------------------------------------------------------------------
-- 2) A CONFIGURAÇÃO DA REDE
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_split_settings (
  id boolean primary key default true check (id),
  -- S5: diferença a menor por cobrança que é absorvida (centavos).
  tolerance_cents integer not null default 10 check (tolerance_cents between 0 and 1000),
  -- ASA6: multa (%) e juros (% ao mês) da cobrança mensal à unidade. Em branco
  -- = sem multa e sem juros (o dono define conforme o contrato de franquia).
  unit_charge_fine_percent numeric(7,4) check (unit_charge_fine_percent between 0 and 100),
  unit_charge_interest_percent numeric(7,4) check (unit_charge_interest_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
alter table public.gateway_split_settings enable row level security;
insert into public.gateway_split_settings (id) values (true) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 3) PARA ONDE VAI CADA TAXA (S7)
-- -----------------------------------------------------------------------------
alter table public.network_fee_types
  add column if not exists split_account_id uuid references public.gateway_accounts (id);
comment on column public.network_fee_types.split_account_id is
  'ASA3: a carteira que recebe esta taxa no split. Vazio = a conta raiz (franqueadora) do mesmo ambiente.';

-- -----------------------------------------------------------------------------
-- 4) O SPLIT DE CADA COBRANÇA
-- -----------------------------------------------------------------------------
alter table public.charges
  add column if not exists split_applied boolean not null default false,
  add column if not exists split_skip_reason text;
comment on column public.charges.split_skip_reason is
  'ASA3: por que a cobrança saiu SEM split (franqueadora, split_nao_habilitado, sem_carteira, sem_taxa, sem_tarifa). Nulo com split.';

create table if not exists public.charge_splits (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges (id) on delete cascade,
  destination_account_id uuid not null references public.gateway_accounts (id),
  wallet_id text not null,
  percent numeric(9,4) not null check (percent > 0),
  percentual_value numeric(9,4) not null check (percentual_value > 0 and percentual_value < 100),
  fixed_cents bigint not null default 0 check (fixed_cents >= 0),
  -- O rateio por taxa: {"royalty": 6.37, "comercial": 5.44, ...}
  fees jsonb not null,
  tariff_percent numeric(7,4) not null,
  tariff_fixed_cents bigint not null,
  asaas_split_id text,
  status text not null default 'enviado'
    check (status in ('enviado', 'liquidado', 'cancelado', 'recusado', 'bloqueado')),
  settled_cents bigint,
  settled_at timestamptz,
  excess_cents bigint not null default 0,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (charge_id, wallet_id)
);
create index if not exists charge_splits_asaas_split_idx on public.charge_splits (asaas_split_id) where asaas_split_id is not null;
alter table public.charge_splits enable row level security;

-- -----------------------------------------------------------------------------
-- 5) RETIDO NA ORIGEM
-- -----------------------------------------------------------------------------
alter table public.split_charges
  add column if not exists retained_cents bigint not null default 0,
  add column if not exists charge_id uuid references public.charges (id);
alter table public.split_charges drop constraint if exists split_charges_retained_check;
alter table public.split_charges
  add constraint split_charges_retained_check check (retained_cents >= 0 and retained_cents <= amount_cents);
create index if not exists split_charges_charge_idx on public.split_charges (charge_id) where charge_id is not null;

-- Um lançamento de cada lado por linha de taxa retida.
create unique index if not exists financial_entries_split_retained_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('split_retained', 'split_retained_revenue');

-- A conta a pagar de taxa: só o que NÃO foi retido pelo split. Mesmo corpo da
-- função viva (0233/0370), trocando `amount_cents` por `amount_cents - retained_cents`.
create or replace function public.refresh_network_fee_payable(p_clinic_id uuid, p_fee text, p_period date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke execute on function public.refresh_network_fee_payable(uuid, text, date) from public, anon, authenticated;

-- O razão de UMA linha de taxa retida: despesa da unidade e receita da
-- franqueadora. Aberto até o Asaas liquidar; cancelado se nada foi retido.
create or replace function public._gateway_split_ledger(p_split_charge_id uuid, p_settled_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.split_charges%rowtype;
  r public.payment_receipts%rowtype;
  v_acc record;
  v_franchisor uuid;
  v_label text;
  v_accrual date;
  v_status text;
  v_expected date;
  c public.charges%rowtype;
  v_root uuid;
begin
  select * into s from public.split_charges where id = p_split_charge_id;
  if not found then return; end if;
  select * into r from public.payment_receipts where id = s.receipt_id;
  select * into c from public.charges where id = s.charge_id;
  select * into v_acc from public.network_fee_accounts(s.fee);
  if v_acc is null then return; end if;
  select id into v_franchisor from public.clinics where type = 'franchisor' limit 1;
  v_label := public.network_fee_label(s.fee) || ' retido no split — ' || to_char(s.period_month, 'MM/YYYY');
  -- O mês da taxa (que pode ter ido para o mês aberto, 0232).
  v_accrual := case when date_trunc('month', coalesce(r.received_at, s.period_month)) = s.period_month
                    then coalesce(r.received_at, s.period_month) else s.period_month end;
  v_status := case when s.retained_cents <= 0 or s.reversed then 'cancelled'
                   when p_settled_on is not null then 'settled' else 'open' end;
  v_expected := coalesce(p_settled_on, c.credit_date, r.settlement_date, r.received_at);
  select g.id into v_root from public.gateway_accounts g
   where g.owner_type = 'franchisor' and g.status = 'active'
     and g.environment = (select environment from public.gateway_accounts where id = c.gateway_account_id)
   order by g.created_at limit 1;

  -- Unidade: a despesa da taxa, paga na origem.
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
    amount_cents, direction, status, source_type, source_id, description, bank_account_id
  ) values (
    s.clinic_id, v_acc.unit_account, v_accrual,
    case when v_status = 'settled' then p_settled_on end, v_expected,
    greatest(s.retained_cents, 1), 'outflow', v_status, 'split_retained', s.id, v_label,
    public._gateway_bank_account(c.gateway_account_id)
  )
  on conflict (source_type, source_id) where source_type in ('split_retained', 'split_retained_revenue')
  do update set amount_cents = excluded.amount_cents, status = excluded.status,
                cash_date = excluded.cash_date, expected_settlement_date = excluded.expected_settlement_date,
                updated_at = now();

  -- Franqueadora: a receita, que chega pelo split.
  if v_franchisor is not null and v_franchisor <> s.clinic_id then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, bank_account_id
    ) values (
      v_franchisor, v_acc.franchisor_account, v_accrual,
      case when v_status = 'settled' then p_settled_on end, v_expected,
      greatest(s.retained_cents, 1), 'inflow', v_status, 'split_retained_revenue', s.id, v_label,
      case when v_root is not null then public._gateway_bank_account(v_root) end
    )
    on conflict (source_type, source_id) where source_type in ('split_retained', 'split_retained_revenue')
    do update set amount_cents = excluded.amount_cents, status = excluded.status,
                  cash_date = excluded.cash_date, expected_settlement_date = excluded.expected_settlement_date,
                  updated_at = now();
  end if;
end;
$$;
revoke execute on function public._gateway_split_ledger(uuid, date) from public, anon, authenticated;

-- QUANTO O SPLIT RETEVE de cada taxa desta cobrança (S5). Chamada quando a
-- baixa nasce e a cada aviso de split.
create or replace function public._gateway_split_retention(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_tol bigint;
  v_short bigint := 0;
  s record;
  w record;
  v_new bigint;
  v_settled date;
  v_touched text[] := '{}';
  v_key text;
  v_frozen boolean;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or c.receipt_id is null or not c.split_applied then return; end if;
  select tolerance_cents into v_tol from public.gateway_split_settings where id;
  v_tol := coalesce(v_tol, 10);

  update public.split_charges set charge_id = c.id
   where source_type = 'receipt' and source_id = c.receipt_id and charge_id is distinct from c.id;

  -- O esperado de cada carteira: a soma das taxas dela, pela regra do dia do
  -- pagamento (`split_charges`, D4). A falta somada da cobrança decide (S5).
  for w in
    select cs.*,
           (select coalesce(sum(sc.amount_cents), 0) from public.split_charges sc
             where sc.charge_id = c.id and not sc.reversed and cs.fees ? sc.fee) as expected
      from public.charge_splits cs where cs.charge_id = c.id
  loop
    if w.status = 'liquidado' and w.settled_cents is not null then
      v_short := v_short + greatest(w.expected - w.settled_cents, 0);
      if w.settled_cents > w.expected and w.excess_cents is distinct from (w.settled_cents - w.expected) then
        update public.charge_splits set excess_cents = w.settled_cents - w.expected, updated_at = now() where id = w.id;
        perform public._gateway_notify(c.gateway_account_id, 'repasse_a_maior', w.id::text, c.clinic_id, false, true, true,
          'Split: repasse acima do devido',
          'Uma cobrança repassou à rede mais do que as taxas vigentes no dia do pagamento (provável mudança de taxa com a cobrança em aberto). Confira no Painel de repasses e decida entre abater ou dispensar.',
          '/prontuarios/' || c.client_id::text);
      end if;
    end if;
  end loop;

  for s in
    select sc.*, cs.status as w_status, cs.settled_cents as w_settled, cs.settled_at as w_settled_at,
           (select coalesce(sum(x.amount_cents), 0) from public.split_charges x
             where x.charge_id = c.id and not x.reversed and cs.fees ? x.fee) as w_expected
      from public.split_charges sc
      left join public.charge_splits cs on cs.charge_id = c.id and cs.fees ? sc.fee
     where sc.charge_id = c.id
  loop
    -- CONGELADA: a carteira já liquidada tem o razão liquidado, que não muda de
    -- valor (0185). O aviso de OUTRA carteira, que chega depois, decide só
    -- sobre a própria carteira: a falta já absorvida não passa da tolerância.
    v_frozen := s.w_status = 'liquidado' and exists (
      select 1 from public.financial_entries f
       where f.source_type = 'split_retained' and f.source_id = s.id and f.status = 'settled');
    continue when v_frozen;
    v_new := case
      when s.reversed or s.w_status is null then 0                      -- taxa que não foi no split
      when s.w_status in ('cancelado', 'recusado') then 0               -- split desfeito: volta à conta a pagar
      when s.w_status = 'liquidado' and s.w_settled is not null and v_short > v_tol and s.w_expected > 0
        then floor(s.amount_cents * least(s.w_settled, s.w_expected)::numeric / s.w_expected)::bigint
      else s.amount_cents                                                -- enviado, bloqueado ou dentro da tolerância
    end;
    v_settled := case when s.w_status = 'liquidado' then (s.w_settled_at at time zone 'America/Sao_Paulo')::date end;
    if v_new is distinct from s.retained_cents then
      update public.split_charges set retained_cents = v_new where id = s.id;
      v_key := s.fee || '|' || s.period_month::text;
      if not (v_key = any (v_touched)) then v_touched := v_touched || v_key; end if;
    end if;
    if v_new > 0 or exists (select 1 from public.financial_entries f where f.source_type = 'split_retained' and f.source_id = s.id) then
      perform public._gateway_split_ledger(s.id, v_settled);
    end if;
  end loop;

  foreach v_key in array v_touched loop
    perform public.refresh_network_fee_payable(c.clinic_id, split_part(v_key, '|', 1), split_part(v_key, '|', 2)::date);
  end loop;
end;
$$;
revoke execute on function public._gateway_split_retention(uuid) from public, anon, authenticated;

-- A baixa pelo Asaas nasce (`charges.receipt_id`): a retenção é calculada.
create or replace function public._gateway_charge_split_on_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.split_applied and new.receipt_id is not null and old.receipt_id is distinct from new.receipt_id then
    perform public._gateway_split_retention(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public._gateway_charge_split_on_receipt() from public, anon, authenticated;

drop trigger if exists charges_split_on_receipt on public.charges;
create trigger charges_split_on_receipt
  after update of receipt_id on public.charges
  for each row execute function public._gateway_charge_split_on_receipt();

-- A TAXA JÁ NASCE PAGA (pedido do dono, 13/11/2026): a baixa de uma cobrança
-- com split nasce com a taxa RETIDA, para a conta a pagar do mês nem ser criada
-- (antes ela nascia e era cancelada logo depois, "sem valor apurado", dando a
-- impressão de que o custo não existia). O custo está no razão, liquidado.
-- A cobrança é achada pela referência da baixa ("Asaas <id>", 4005), porque
-- `charges.receipt_id` só é gravado depois.
create or replace function public._split_charge_born_retained()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
  v_charge uuid;
begin
  if new.source_type <> 'receipt' or new.receipt_id is null or new.reversed then return new; end if;
  select r.reference into v_ref from public.payment_receipts r where r.id = new.receipt_id;
  if v_ref is null or v_ref not like 'Asaas %' then return new; end if;
  select ch.id into v_charge
    from public.charges ch
   where ch.asaas_payment_id = substr(v_ref, 7) and ch.split_applied
     and exists (select 1 from public.charge_splits cs
                  where cs.charge_id = ch.id and cs.fees ? new.fee
                    and cs.status not in ('cancelado', 'recusado'))
   limit 1;
  if v_charge is not null then
    new.charge_id := v_charge;
    new.retained_cents := new.amount_cents;
  end if;
  return new;
end;
$$;
revoke execute on function public._split_charge_born_retained() from public, anon, authenticated;

drop trigger if exists split_charges_born_retained on public.split_charges;
create trigger split_charges_born_retained
  before insert on public.split_charges
  for each row execute function public._split_charge_born_retained();

-- O apurado do mês da tela de taxas mostra quanto foi PAGO NO SPLIT (retido na
-- origem) ao lado da conta a pagar. Ganha coluna no retorno: drop + create.
drop function if exists public.network_fee_summary(uuid, integer, integer);
create or replace function public.network_fee_summary(p_clinic_id uuid, p_year integer, p_month integer)
returns table(fee text, label text, kind text, percent numeric, is_override boolean, campaign_name text,
              base_cents bigint, amount_cents bigint, receipts integer, payable_status text, retained_cents bigint)
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
    coalesce(s.retido, 0)::bigint
  from public.network_fee_types t
  cross join period per
  left join lateral public.network_fee_for(p_clinic_id, t.key, per.p) cfg on true
  left join lateral (
    select sum(c.amount_cents) as total, sum(c.base_cents) as base,
           count(*) as n, sum(c.retained_cents) as retido
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
-- 6) OS AVISOS DE SPLIT
-- -----------------------------------------------------------------------------
create or replace function public._gateway_on_split_event(p_event_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.gateway_webhook_events%rowtype;
  p jsonb;
  v_sid text;
  v_el jsonb;
  v_ref text;
  c public.charges%rowtype;
  cs public.charge_splits%rowtype;
  v_status text;
begin
  select * into e from public.gateway_webhook_events where id = p_event_id;
  if not found or e.event not like 'PAYMENT_SPLIT_%' then return null; end if;
  p := e.payload->'payment';
  v_sid := coalesce(e.payload->'additionalInfo'->>'splitId', e.payload->'split'->>'id');
  select x into v_el from jsonb_array_elements(
           case when jsonb_typeof(p->'split') = 'array' then p->'split' else '[]'::jsonb end) x
   where x->>'id' = v_sid limit 1;
  if v_el is null and jsonb_typeof(e.payload->'split') = 'object' then v_el := e.payload->'split'; end if;

  v_ref := p->>'externalReference';
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'split_fora_do_riszon';
  end if;
  select * into c from public.charges where id = v_ref::uuid and gateway_account_id = e.account_id;
  if not found then return 'split_sem_cobranca'; end if;

  select * into cs from public.charge_splits
   where charge_id = c.id
     and (asaas_split_id = v_sid or (asaas_split_id is null and wallet_id = v_el->>'walletId'))
   order by (asaas_split_id = v_sid) desc nulls last limit 1;
  if not found then return 'split_sem_registro'; end if;

  v_status := case e.event
    when 'PAYMENT_SPLIT_DONE' then 'liquidado'
    when 'PAYMENT_SPLIT_CANCELLED' then 'cancelado'
    when 'PAYMENT_SPLIT_DIVERGENCE_BLOCK' then 'bloqueado'
    when 'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED' then 'cancelado'
    else cs.status end;

  update public.charge_splits set
    asaas_split_id = coalesce(asaas_split_id, v_sid),
    status = v_status,
    settled_cents = case when v_status = 'liquidado' and (v_el->>'totalValue') is not null
                         then round((v_el->>'totalValue')::numeric * 100)::bigint else settled_cents end,
    settled_at = case when v_status = 'liquidado' then coalesce(settled_at, now()) else settled_at end,
    status_reason = coalesce(nullif(v_el->>'cancellationReason', ''), nullif(v_el->>'refusalReason', ''), status_reason),
    updated_at = now()
   where id = cs.id;

  if v_status = 'liquidado' then
    update public.gateway_accounts set split_enabled_confirmed_at = coalesce(split_enabled_confirmed_at, now())
     where id = e.account_id;
  elsif v_status = 'bloqueado' then
    perform public._gateway_notify(c.gateway_account_id, 'split_bloqueado', cs.id::text, c.clinic_id, true, true, true,
      'Split bloqueado pelo Asaas',
      'O Asaas bloqueou o split de uma cobrança por divergência de valor. Há 2 dias úteis para corrigir; depois disso o split é cancelado e a taxa volta para a conta a pagar da unidade.',
      '/prontuarios/' || c.client_id::text);
  elsif v_status = 'cancelado' then
    perform public._gateway_notify(c.gateway_account_id, 'split_cancelado', cs.id::text, c.clinic_id, false, true, true,
      'Split cancelado pelo Asaas',
      'O Asaas cancelou o split de uma cobrança. A taxa daquela cobrança volta para a conta a pagar da unidade.',
      '/prontuarios/' || c.client_id::text);
  end if;

  perform public._gateway_split_retention(c.id);
  return 'split_' || v_status;
end;
$$;
revoke execute on function public._gateway_on_split_event(bigint) from public, anon, authenticated;

-- A 4005 marca o aviso de split como processado ('registrado_asa3'); aqui ele
-- passa a valer. Erro aqui desfaz o processamento: o aviso é tentado de novo.
create or replace function public._gateway_event_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r text;
begin
  v_r := public._gateway_on_split_event(new.id);
  if v_r is not null then
    update public.gateway_webhook_events set result = v_r where id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public._gateway_event_split() from public, anon, authenticated;

drop trigger if exists gateway_webhook_events_split on public.gateway_webhook_events;
create trigger gateway_webhook_events_split
  after update of processed_at on public.gateway_webhook_events
  for each row
  when (old.processed_at is null and new.processed_at is not null and new.event like 'PAYMENT_SPLIT_%')
  execute function public._gateway_event_split();

-- Os já guardados (sem cobrança com split no riSZon: só ganham o resultado).
do $$
declare v_id bigint; v_r text;
begin
  for v_id in select id from public.gateway_webhook_events
               where event like 'PAYMENT_SPLIT_%' and processed_at is not null and result = 'registrado_asa3'
               order by received_at, id
  loop
    v_r := public._gateway_on_split_event(v_id);
    if v_r is not null then update public.gateway_webhook_events set result = v_r where id = v_id; end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) A EMISSÃO (só o servidor): o plano, o que foi enviado, o motivo de não ir
-- -----------------------------------------------------------------------------
-- O PLANO do split de uma cobrança "emitindo": se pode ir (S6) e, se pode, as
-- carteiras com os percentuais da regra de HOJE (a fila da entrega 2 corrige
-- mudança de taxa; até lá, cai na S5) e as tarifas da conta para a janela.
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
           'valid_from', r.valid_from, 'valid_to', r.valid_to, 'min_installments', r.min_installments)), '[]'::jsonb)
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
    'meio', c.billing_type);
end;
$$;
revoke execute on function public._charge_split_plan(uuid) from public, anon, authenticated;

-- Por que saiu sem split (aparece para o Financeiro no Painel, entrega 3).
create or replace function public._charge_mark_split_skipped(p_charge_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.charges set split_applied = false, split_skip_reason = left(p_reason, 40)
   where id = p_charge_id and status = 'emitindo';
$$;
revoke execute on function public._charge_mark_split_skipped(uuid, text) from public, anon, authenticated;

-- O que foi enviado e aceito pelo Asaas. O primeiro split aceito confirma o
-- "split habilitado" da conta (S6).
create or replace function public._charge_save_split(p_charge_id uuid, p_entries jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  x jsonb;
begin
  select * into c from public.charges where id = p_charge_id for update;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'SPLIT_EMPTY';
  end if;
  for x in select * from jsonb_array_elements(p_entries) loop
    insert into public.charge_splits (
      charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents,
      fees, tariff_percent, tariff_fixed_cents, asaas_split_id)
    values (
      c.id, (x->>'accountId')::uuid, x->>'walletId', (x->>'percent')::numeric,
      (x->>'percentualValue')::numeric, (x->>'fixedCents')::bigint, x->'fees',
      (x->>'tariffPercent')::numeric, (x->>'tariffFixedCents')::bigint, nullif(x->>'asaasSplitId', ''))
    on conflict (charge_id, wallet_id) do update set
      percent = excluded.percent, percentual_value = excluded.percentual_value,
      fixed_cents = excluded.fixed_cents, fees = excluded.fees,
      tariff_percent = excluded.tariff_percent, tariff_fixed_cents = excluded.tariff_fixed_cents,
      asaas_split_id = coalesce(excluded.asaas_split_id, charge_splits.asaas_split_id),
      updated_at = now();
  end loop;
  update public.charges set split_applied = true, split_skip_reason = null where id = c.id;
  update public.gateway_accounts set split_enabled_confirmed_at = coalesce(split_enabled_confirmed_at, now())
   where id = c.gateway_account_id;
end;
$$;
revoke execute on function public._charge_save_split(uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) AS PORTAS DA ABA TAXAS DA FRANQUIA (Admin Master e Financeiro da Franqueadora)
-- -----------------------------------------------------------------------------
create or replace function public.gateway_split_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.gateway_split_settings s where s.id),
    'destinos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'fee', t.key, 'label', t.label, 'accountId', t.split_account_id) order by t.sort_order), '[]'::jsonb)
                   from public.network_fee_types t where t.kind = 'percent' and t.active),
    'carteiras', (select coalesce(jsonb_agg(jsonb_build_object(
                     'accountId', g.id, 'label', g.label, 'ownerType', g.owner_type,
                     'environment', g.environment, 'temCarteira', g.wallet_id is not null) order by g.owner_type, g.label), '[]'::jsonb)
                    from public.gateway_accounts g
                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active'));
end;
$$;
revoke execute on function public.gateway_split_read() from public, anon, authenticated;
grant execute on function public.gateway_split_read() to authenticated;

create or replace function public.gateway_split_save(
  p_tolerance_cents integer,
  p_fine_percent numeric,
  p_interest_percent numeric,
  p_destinos jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_acc uuid;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.gateway_split_settings set
    tolerance_cents = p_tolerance_cents,
    unit_charge_fine_percent = p_fine_percent,
    unit_charge_interest_percent = p_interest_percent,
    updated_at = now(), updated_by = (select auth.uid())
   where id
     and (tolerance_cents, unit_charge_fine_percent, unit_charge_interest_percent)
         is distinct from (p_tolerance_cents, p_fine_percent, p_interest_percent);

  for x in select * from jsonb_array_elements(coalesce(p_destinos, '[]'::jsonb)) loop
    v_acc := nullif(x->>'accountId', '')::uuid;
    if v_acc is not null and not exists (
      select 1 from public.gateway_accounts g
       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active') then
      raise exception 'DESTINATION_INVALID';
    end if;
    update public.network_fee_types set split_account_id = v_acc, updated_at = now(), updated_by = (select auth.uid())
     where key = x->>'fee' and kind = 'percent' and split_account_id is distinct from v_acc;
  end loop;
end;
$$;
revoke execute on function public.gateway_split_save(integer, numeric, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.gateway_split_save(integer, numeric, numeric, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) O HISTÓRICO DA ABA (central_history ganha 'taxas')
-- -----------------------------------------------------------------------------
create or replace function public.central_history(p_tab text, p_clinic_id uuid)
returns table (
  id bigint,
  occurred_at timestamptz,
  user_id uuid,
  user_name text,
  actor text,
  table_name text,
  op text,
  changes jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tab not in ('conta', 'financeiro', 'comercial', 'cobranca', 'taxas') then
    raise exception 'TAB_UNKNOWN';
  end if;

  if p_tab = 'comercial' then
    if not public.is_admin_master() then
      return;
    end if;
  elsif p_tab = 'cobranca' then
    if p_clinic_id is null then
      if not public._gateway_regua_can_edit() then return; end if;
    elsif not public._gateway_regua_can_see_unit(p_clinic_id) then
      return;
    end if;
  elsif p_tab = 'taxas' and p_clinic_id is null then
    if not (public.is_admin_master() or public.is_finance_franchisor()) then
      return;
    end if;
  elsif p_clinic_id is null then
    if not (public.is_admin_master() or public.is_finance_franchisor()) then
      return;
    end if;
  elsif not public.central_can_see(p_clinic_id) then
    return;
  end if;

  if p_tab = 'conta' then
    return query
    select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
           a.table_name, a.op, a.changes
      from public.audit_changes a
      left join public.profiles pr on pr.id = a.user_id
     where a.schema_name = 'public'
       and (
         (a.table_name = 'gateway_accounts' and a.row_id in (
            select g.id::text from public.gateway_accounts g
             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient'))
                or g.clinic_id = p_clinic_id))
         or (p_clinic_id is not null
             and a.table_name = 'central_unit_readiness'
             and a.row_id = p_clinic_id::text)
         or (a.table_name = 'card_acquirers' and a.row_id in (
            select c.id::text
              from public.card_acquirers c
              join public.gateway_accounts g on g.id = c.gateway_account_id
             where (p_clinic_id is null and g.owner_type = 'franchisor')
                or g.clinic_id = p_clinic_id))
         or (a.table_name = 'acquirer_rates' and a.row_id in (
            select r.id::text
              from public.acquirer_rates r
              join public.card_acquirers c on c.id = r.acquirer_id
              join public.gateway_accounts g on g.id = c.gateway_account_id
             where (p_clinic_id is null and g.owner_type = 'franchisor')
                or g.clinic_id = p_clinic_id))
       )
     order by a.occurred_at desc, a.id desc
     limit 200;
    return;
  end if;

  if p_tab = 'taxas' then
    -- ASA3 (4008): a aba Taxas da franquia — as taxas, os destinos do split,
    -- as campanhas e a configuração da rede; na unidade, o acordo dela.
    return query
    select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
           a.table_name, a.op, a.changes
      from public.audit_changes a
      left join public.profiles pr on pr.id = a.user_id
     where a.schema_name = 'public'
       and (
         (p_clinic_id is null and (
            a.table_name in ('network_fee_types', 'gateway_split_settings')
            or (a.table_name in ('network_fees', 'network_fee_campaigns') and a.clinic_id is null)))
         or (p_clinic_id is not null and a.table_name in ('network_fees', 'network_fee_campaigns')
             and a.clinic_id = p_clinic_id)
       )
     order by a.occurred_at desc, a.id desc
     limit 200;
    return;
  end if;

  if p_tab = 'cobranca' then
    return query
    select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
           a.table_name, a.op, a.changes
      from public.audit_changes a
      left join public.profiles pr on pr.id = a.user_id
     where a.schema_name = 'public'
       and (
         (p_clinic_id is null and a.table_name in ('gateway_notification_rules', 'gateway_notification_settings'))
         or (p_clinic_id is not null and a.table_name = 'gateway_notification_units'
             and a.row_id = p_clinic_id::text)
       )
     order by a.occurred_at desc, a.id desc
     limit 200;
    return;
  end if;

  return query
  select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
         a.table_name, a.op, a.changes
    from public.audit_changes a
    left join public.profiles pr on pr.id = a.user_id
   where a.schema_name = 'public'
     and a.table_name = any (
       case when p_tab = 'financeiro'
            then array['finance_settings']
            else array['commercial_rules', 'commercial_followup_settings'] end)
     and a.clinic_id is not distinct from p_clinic_id
   order by a.occurred_at desc, a.id desc
   limit 200;
end;
$$;

revoke execute on function public.central_history(text, uuid) from public, anon, authenticated;
grant execute on function public.central_history(text, uuid) to authenticated;

-- A trilha de auditoria nas tabelas novas.
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (o dono vê esta linha no SQL Editor)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.network_fees where punctuality_discount_percent <> 0) as taxas_com_pontualidade,
  (select tolerance_cents from public.gateway_split_settings where id) as tolerancia_centavos,
  (select unit_charge_fine_percent is null and unit_charge_interest_percent is null
     from public.gateway_split_settings where id) as multa_e_juros_em_branco,
  (select count(*) from public.network_fee_types where kind = 'percent' and active) as taxas_no_split,
  (select count(*) from public.charge_splits) as splits_enviados,
  (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('gateway_split_read', 'gateway_split_save')) as portas;
