-- =============================================================================
-- 0197 — FIN4b: ADQUIRENTES (taxa do cartão e liquidação D+n)
-- -----------------------------------------------------------------------------
-- Dois erros que o sistema comete hoje, todo dia, com cartão:
--
--   • O VALOR. A cobrança registra o bruto, mas a adquirente desconta a taxa —
--     o que entra na conta é menos. Sem isso, a receita parece maior do que é.
--   • A DATA. O sistema trata como se o dinheiro caísse no vencimento; na
--     prática é D+1 no débito e D+30 no crédito. Sem isso, a projeção de
--     30/60/90 do DFC mente.
--
-- Decisão do dono (7.5 do briefing): a taxa é **despesa financeira variável da
-- UNIDADE** (conta 2.4.01), não da franqueadora — senão a unidade não tem
-- incentivo para negociar com a adquirente nem para puxar o cliente para o PIX.
--
-- A tabela de taxas tem VIGÊNCIA: renegociar a taxa com a adquirente não
-- reescreve o que já foi recebido. Mesma lógica das taxas congeladas da parcela.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ADQUIRENTES da unidade
-- -----------------------------------------------------------------------------
create table if not exists public.card_acquirers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null,
  -- A que o sistema sugere quando ninguém escolhe.
  is_default boolean not null default false,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create index if not exists card_acquirers_clinic_idx
  on public.card_acquirers (clinic_id, active, name);
-- Uma padrão por unidade.
create unique index if not exists card_acquirers_default_unique
  on public.card_acquirers (clinic_id) where is_default;

alter table public.card_acquirers enable row level security;

drop policy if exists "card_acquirers_select" on public.card_acquirers;
create policy "card_acquirers_select" on public.card_acquirers
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "card_acquirers_write" on public.card_acquirers;
create policy "card_acquirers_write" on public.card_acquirers
  for all to authenticated
  using (public.can_reconcile(clinic_id))
  with check (public.can_reconcile(clinic_id));

-- -----------------------------------------------------------------------------
-- 2) TAXAS E PRAZOS, com vigência
-- -----------------------------------------------------------------------------
create table if not exists public.acquirer_rates (
  id uuid primary key default gen_random_uuid(),
  acquirer_id uuid not null references public.card_acquirers (id) on delete cascade,
  modality text not null
    check (modality in ('debito', 'credito_avista', 'credito_parcelado',
                        'recorrente')),
  -- Faixa de parcelas (só faz sentido no parcelado; 1..1 nos demais).
  min_installments integer not null default 1 check (min_installments >= 1),
  max_installments integer not null default 1 check (max_installments >= 1),
  fee_percent numeric(6,3) not null check (fee_percent >= 0 and fee_percent <= 30),
  -- D+n: dias até o dinheiro cair na conta.
  settlement_days integer not null default 30 check (settlement_days >= 0),
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint acquirer_rates_range_check check (max_installments >= min_installments)
);

create index if not exists acquirer_rates_lookup_idx
  on public.acquirer_rates (acquirer_id, modality, valid_from);

comment on table public.acquirer_rates is
  'Taxa e prazo por modalidade, COM VIGÊNCIA: renegociar a taxa não reescreve '
  'o que já foi recebido.';

alter table public.acquirer_rates enable row level security;

drop policy if exists "acquirer_rates_select" on public.acquirer_rates;
create policy "acquirer_rates_select" on public.acquirer_rates
  for select to authenticated
  using (
    acquirer_id in (
      select id from public.card_acquirers
      where clinic_id in (select public.finance_visible_clinic_ids()))
  );

drop policy if exists "acquirer_rates_write" on public.acquirer_rates;
create policy "acquirer_rates_write" on public.acquirer_rates
  for all to authenticated
  using (
    exists (select 1 from public.card_acquirers a
            where a.id = acquirer_id and public.can_reconcile(a.clinic_id))
  )
  with check (
    exists (select 1 from public.card_acquirers a
            where a.id = acquirer_id and public.can_reconcile(a.clinic_id))
  );

-- A taxa vigente na data pedida. Mais específico primeiro: a faixa que contém
-- o número de parcelas, e entre elas a vigência mais recente.
create or replace function public.acquirer_rate_for(
  p_acquirer_id uuid,
  p_modality text,
  p_installments integer,
  p_date date default current_date
)
returns table (fee_percent numeric, settlement_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.fee_percent, r.settlement_days
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
-- 3) A cobrança guarda quando o dinheiro CAI de verdade
-- -----------------------------------------------------------------------------
alter table public.payment_installments
  add column if not exists acquirer_id uuid references public.card_acquirers (id),
  add column if not exists expected_settlement_date date;

comment on column public.payment_installments.expected_settlement_date is
  'Quando o dinheiro entra na conta (D+n da adquirente). No boleto e no PIX é '
  'o próprio vencimento; no cartão é bem depois — e é isso que a projeção de '
  'caixa precisa saber.';

-- Modalidade a partir do meio de pagamento da venda.
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
    else null
  end;
$$;

grant execute on function public.card_modality_of(text, integer) to authenticated;

-- Preenche a data de liquidação esperada de uma venda inteira.
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

  -- Sem cartão, o dinheiro cai no próprio vencimento.
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
    -- Sem adquirente cadastrada ainda: pelo menos não mente com a data.
    update public.payment_installments
       set expected_settlement_date = due_date
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  select * into v_rate
  from public.acquirer_rate_for(v_acquirer, v_modality, v_installments, current_date);

  update public.payment_installments
     set acquirer_id = v_acquirer,
         expected_settlement_date =
           due_date + coalesce(v_rate.settlement_days, 0)
   where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
end;
$$;

grant execute on function public.apply_settlement_projection(uuid, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A baixa no cartão: entra LÍQUIDO, taxa vira despesa da unidade
-- -----------------------------------------------------------------------------
alter table public.payment_receipts
  add column if not exists acquirer_id uuid references public.card_acquirers (id),
  add column if not exists acquirer_modality text,
  add column if not exists acquirer_fee_cents bigint not null default 0,
  add column if not exists acquirer_fee_percent numeric(6,3),
  add column if not exists settlement_date date;

comment on column public.payment_receipts.acquirer_fee_cents is
  'Taxa da adquirente sobre ESTE recebimento. O cliente pagou o bruto; a '
  'clínica recebe o líquido, e a diferença é despesa financeira da unidade.';

-- Registra a taxa e a data de liquidação de uma baixa feita no cartão.
-- Chamada logo após register_payment_receipt (que continua registrando o BRUTO
-- pago pelo cliente — é isso que quita a dívida dele).
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
  v_fee bigint;
  v_settle date;
begin
  select * into v_rec from public.payment_receipts where id = p_receipt_id;
  if v_rec.id is null then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if not public.can_receive_payment(v_rec.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_rec.acquirer_fee_cents > 0 then raise exception 'FEE_ALREADY_APPLIED'; end if;

  select * into v_acc from public.card_acquirers where id = p_acquirer_id;
  if v_acc.id is null then raise exception 'ACQUIRER_NOT_FOUND'; end if;
  if v_acc.clinic_id <> v_rec.clinic_id then raise exception 'CLINIC_MISMATCH'; end if;

  select * into v_rate
  from public.acquirer_rate_for(
    p_acquirer_id, p_modality, p_installments, v_rec.received_at);
  if v_rate.fee_percent is null then raise exception 'RATE_NOT_FOUND'; end if;

  -- Meio para cima, como todo arredondamento do módulo.
  v_fee := round(v_rec.amount_cents * v_rate.fee_percent / 100.0);
  v_settle := v_rec.received_at + coalesce(v_rate.settlement_days, 0);

  update public.payment_receipts set
    acquirer_id = p_acquirer_id,
    acquirer_modality = p_modality,
    acquirer_fee_cents = v_fee,
    acquirer_fee_percent = v_rate.fee_percent,
    settlement_date = v_settle
  where id = p_receipt_id;

  -- A taxa é despesa da UNIDADE (decisão do dono, 7.5): sem isso ela não tem
  -- incentivo para negociar a taxa nem para puxar o cliente para o PIX.
  if v_fee > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_rec.clinic_id, '2.4.01', v_rec.received_at, v_settle, v_settle,
      v_fee, 'outflow', 'settled', 'acquirer_fee', p_receipt_id,
      'Taxa de adquirente — ' || v_acc.name, (select auth.uid())
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee',
       'acquirer_fee') do nothing;
  end if;

  -- O dinheiro do cartão não cai hoje: a entrada de caixa passa a valer na
  -- data da liquidação, que é o que a projeção do DFC precisa enxergar.
  update public.financial_entries
     set cash_date = v_settle, expected_settlement_date = v_settle
   where source_type = 'receipt_cash' and source_id = p_receipt_id;

  return jsonb_build_object(
    'fee_cents', v_fee,
    'fee_percent', v_rate.fee_percent,
    'settlement_date', v_settle,
    'net_cents', v_rec.amount_cents - v_fee);
end;
$$;

grant execute on function public.apply_acquirer_fee(uuid, uuid, text, integer)
  to authenticated;

-- O razão aceita a origem nova.
drop index if exists public.financial_entries_source_unique;
create unique index if not exists financial_entries_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('installment_accrual', 'receipt_cash',
                        'receipt_benefit', 'receipt_late_fee',
                        'renegotiation_charges', 'renegotiation_benefit',
                        'renegotiation_discount', 'renegotiation_surcharge',
                        'payable_accrual', 'payable_cash', 'payable_late_fee',
                        'acquirer_fee');

-- -----------------------------------------------------------------------------
-- 5) A projeção entra no fluxo de salvar a venda
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
  v_locked int;
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

  select count(*) into v_locked
  from public.payment_installments i
  where ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))
    and (i.status in ('paga', 'parcial', 'renegociada')
         or coalesce(i.paid_amount_cents, 0) > 0
         or exists (select 1 from public.payment_receipts r
                    where r.installment_id = i.id));
  if v_locked > 0 then raise exception 'SCHEDULE_LOCKED'; end if;

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

  perform public.apply_sale_benefit_risk(p_negotiation_id, p_direct_sale_id);
  -- 0197: quando o dinheiro cai de verdade (D+n no cartão).
  perform public.apply_settlement_projection(p_negotiation_id, p_direct_sale_id);

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
-- 6) Reparo: cobranças que já existem ganham a data de liquidação
-- -----------------------------------------------------------------------------
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
  (select count(*) from public.card_acquirers) as adquirentes,
  (select count(*) from public.payment_installments
    where expected_settlement_date is not null) as parcelas_com_liquidacao;
