-- =============================================================================
-- 0187 — FIN1: CONTAS A RECEBER (baixa, baixa parcial e razão)
-- -----------------------------------------------------------------------------
-- A parcela (`payment_installments`, criada no I9) continua sendo o DOCUMENTO
-- de cobrança. O que muda aqui: ela passa a nascer com as taxas congeladas e a
-- gerar LANÇAMENTO no razão (`financial_entries`), para a aba do cliente ser uma
-- *visão* sobre a base contábil — nunca uma base paralela (regra do FIN0).
--
--   • Competência (DRE): a parcela gera 1 lançamento com accrual_date na
--     criação e cash_date VAZIO. É a receita reconhecida.
--   • Caixa (DFC): cada BAIXA gera 1 lançamento com cash_date preenchido.
--
-- BAIXA PARCIAL: paciente pagando metade da parcela é rotina em clínica. Por
-- isso a baixa virou tabela (`payment_receipts`) e a situação da parcela passou
-- a ser DERIVADA da soma das baixas — nunca digitada.
--
-- ESTORNO, nunca edição: baixa errada gera contra-lançamento com motivo.
-- IDEMPOTÊNCIA: a baixa leva um token; duplo clique não vira dois recebimentos.
--
-- Quem dá baixa: Recepção, Gerente, Admin Master e Financeiro da Franqueadora
-- (decisão do dono, 31/07/2026 — a recepção recebe no balcão).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A parcela ganha taxas CONGELADAS e o quanto já foi pago
-- -----------------------------------------------------------------------------
alter table public.payment_installments
  add column if not exists late_fee_percent numeric(5,2),
  add column if not exists monthly_interest_percent numeric(5,2),
  add column if not exists grace_days integer,
  add column if not exists paid_amount_cents bigint not null default 0,
  -- FIN2 vai usar: parcela substituída por renegociação.
  add column if not exists renegotiation_id uuid,
  add column if not exists was_overdue boolean not null default false;

comment on column public.payment_installments.late_fee_percent is
  'Multa vigente QUANDO a parcela nasceu. Mudar a configuração da rede não '
  'reescreve cobrança antiga.';
comment on column public.payment_installments.was_overdue is
  'A parcela já esteve em atraso. Sobrevive à renegociação — senão renegociar '
  'viraria forma de zerar a inadimplência da unidade (indicador 9.28).';

-- Situação: em aberto → parcial → paga. "renegociada" entra no FIN2.
alter table public.payment_installments
  drop constraint if exists payment_installments_status_check;
alter table public.payment_installments
  add constraint payment_installments_status_check
  check (status in ('em_aberto', 'parcial', 'paga', 'cancelada', 'renegociada'));

-- Preenche as taxas de quem nasce agora, a partir da configuração da unidade.
create or replace function public.freeze_installment_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg record;
begin
  if new.late_fee_percent is null then
    select * into v_cfg from public.finance_settings_for(new.clinic_id);
    new.late_fee_percent := coalesce(v_cfg.late_fee_percent, 2);
    new.monthly_interest_percent := coalesce(v_cfg.monthly_interest_percent, 1);
    new.grace_days := coalesce(v_cfg.grace_days, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists payment_installments_freeze_terms on public.payment_installments;
create trigger payment_installments_freeze_terms
  before insert on public.payment_installments
  for each row execute function public.freeze_installment_terms();

-- -----------------------------------------------------------------------------
-- 2) O razão: lançamento de COMPETÊNCIA de cada parcela
-- -----------------------------------------------------------------------------
-- Um lançamento por parcela, criado junto com ela. O índice único garante que
-- rodar de novo não duplica receita.
create unique index if not exists financial_entries_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('installment_accrual', 'receipt_cash');

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

  -- Origem da venda define a conta de receita.
  v_account := case
    when v_inst.direct_sale_id is not null then '1.1.02'  -- venda direta
    else '1.1.01'                                          -- plano de tratamento
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
    ('installment_accrual', 'receipt_cash') do nothing;
end;
$$;

create or replace function public.installment_accrual_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_installment_accrual(new.id);
  return new;
end;
$$;

drop trigger if exists payment_installments_accrual on public.payment_installments;
create trigger payment_installments_accrual
  after insert on public.payment_installments
  for each row execute function public.installment_accrual_trigger();

-- -----------------------------------------------------------------------------
-- 3) BAIXAS (recebimentos) — a tabela que permite a baixa parcial
-- -----------------------------------------------------------------------------
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  installment_id uuid not null references public.payment_installments (id)
    on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  received_at date not null default current_date,
  payment_method text
    check (payment_method is null or payment_method in
      ('pix','boleto','cartao','cartao_parcelado','credito_recorrente','deposito_avista','dinheiro')),
  -- Comprovante: número/autenticação e, se houver, link do arquivo.
  reference text,
  receipt_url text,
  notes text,
  -- Estorno: a baixa errada NÃO é apagada; nasce um estorno apontando para ela.
  reversal_of uuid references public.payment_receipts (id),
  reversal_reason text,
  reversed boolean not null default false,
  -- Idempotência: duplo clique não vira dois recebimentos.
  client_token uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create unique index if not exists payment_receipts_token_unique
  on public.payment_receipts (client_token) where client_token is not null;
create index if not exists payment_receipts_installment_idx
  on public.payment_receipts (installment_id, created_at);
create index if not exists payment_receipts_clinic_idx
  on public.payment_receipts (clinic_id, received_at);

alter table public.payment_receipts enable row level security;

drop policy if exists "payment_receipts_select" on public.payment_receipts;
create policy "payment_receipts_select" on public.payment_receipts
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or clinic_id in (select public.user_full_access_clinic_ids())
  );

-- Escrita só pelas funções (que validam saldo e permissão).
drop policy if exists "payment_receipts_write" on public.payment_receipts;

-- Quem pode dar baixa (a recepção recebe no balcão — decisão do dono).
create or replace function public.can_receive_payment(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or public.has_role_in_clinic(
           p_clinic_id,
           array['unit_manager','receptionist']::public.user_role[]);
$$;

grant execute on function public.can_receive_payment(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) Situação da parcela DERIVADA das baixas (nunca digitada)
-- -----------------------------------------------------------------------------
create or replace function public.refresh_installment_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.installment_id, old.installment_id);
  v_paid bigint;
  v_amount bigint;
  v_status text;
  v_last record;
begin
  select coalesce(sum(r.amount_cents), 0) into v_paid
  from public.payment_receipts r
  where r.installment_id = v_id and not r.reversed and r.reversal_of is null;

  select amount_cents, status into v_amount, v_status
  from public.payment_installments where id = v_id;

  -- Cancelada/renegociada não volta para o fluxo por causa de baixa.
  if v_status in ('cancelada', 'renegociada') then
    update public.payment_installments
       set paid_amount_cents = v_paid where id = v_id;
    return null;
  end if;

  select received_at, created_by into v_last
  from public.payment_receipts
  where installment_id = v_id and not reversed and reversal_of is null
  order by created_at desc limit 1;

  update public.payment_installments set
    paid_amount_cents = v_paid,
    status = case
      when v_paid >= v_amount then 'paga'
      when v_paid > 0 then 'parcial'
      else 'em_aberto'
    end,
    paid_at = case when v_paid >= v_amount
                   then coalesce(v_last.received_at::timestamptz, now())
                   else null end,
    paid_by = case when v_paid >= v_amount then v_last.created_by else null end
  where id = v_id;

  return null;
end;
$$;

drop trigger if exists payment_receipts_refresh on public.payment_receipts;
create trigger payment_receipts_refresh
  after insert or update or delete on public.payment_receipts
  for each row execute function public.refresh_installment_payment();

-- Marca que a parcela JÁ ESTEVE em atraso (sobrevive à renegociação).
create or replace function public.mark_overdue_installments()
returns integer
language sql
security definer
set search_path = ''
as $$
  with upd as (
    update public.payment_installments i
       set was_overdue = true
      from public.finance_settings_for(i.clinic_id) cfg
     where i.status in ('em_aberto', 'parcial')
       and not i.was_overdue
       and current_date > i.due_date + coalesce(i.grace_days, cfg.grace_days, 0)
    returning 1
  )
  select count(*)::integer from upd;
$$;

grant execute on function public.mark_overdue_installments() to authenticated;

-- -----------------------------------------------------------------------------
-- 5) REGISTRAR BAIXA (total ou parcial) — e o caixa no razão
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
  v_paid bigint;
  v_saldo bigint;
  v_receipt_id uuid;
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

  -- Idempotência: mesma baixa reenviada devolve a que já existe.
  if p_client_token is not null then
    select id into v_receipt_id from public.payment_receipts
    where client_token = p_client_token;
    if v_receipt_id is not null then return v_receipt_id; end if;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
  from public.payment_receipts
  where installment_id = p_installment_id and not reversed and reversal_of is null;
  v_saldo := v_inst.amount_cents - v_paid;
  if p_amount_cents > v_saldo then raise exception 'AMOUNT_OVER_BALANCE'; end if;

  insert into public.payment_receipts (
    clinic_id, installment_id, amount_cents, received_at, payment_method,
    reference, notes, client_token, created_by
  ) values (
    v_inst.clinic_id, p_installment_id, p_amount_cents, p_received_at,
    nullif(p_payment_method, ''), nullif(btrim(p_reference), ''),
    nullif(btrim(p_notes), ''), p_client_token, v_user
  )
  returning id into v_receipt_id;

  -- CAIXA no razão (DFC): competência na data da parcela, caixa na do recebimento.
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description, created_by
  ) values (
    v_inst.clinic_id,
    case when v_inst.direct_sale_id is not null then '1.1.02' else '1.1.01' end,
    coalesce(v_inst.created_at::date, p_received_at), p_received_at,
    p_amount_cents, 'inflow', 'settled', 'receipt_cash', v_receipt_id,
    'Recebimento de parcela', v_user
  )
  on conflict (source_type, source_id) where source_type in
    ('installment_accrual', 'receipt_cash') do nothing;

  return v_receipt_id;
end;
$$;

grant execute on function public.register_payment_receipt(
  uuid, bigint, date, text, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) ESTORNAR baixa — contra-lançamento, nunca exclusão
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
    reference, reversal_of, reversal_reason, reversed, created_by
  ) values (
    v_rec.clinic_id, v_rec.installment_id, v_rec.amount_cents, current_date,
    v_rec.payment_method, v_rec.reference, p_receipt_id, btrim(p_reason),
    true, v_user
  )
  returning id into v_new_id;

  -- Contra-lançamento no razão (o original continua lá, para auditoria).
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description,
    reversal_of, reversal_reason, created_by
  )
  select e.clinic_id, e.account_code, e.accrual_date, current_date,
         e.amount_cents, 'outflow', 'settled', 'receipt_cash', v_new_id,
         'Estorno de recebimento', e.id, btrim(p_reason), v_user
  from public.financial_entries e
  where e.source_type = 'receipt_cash' and e.source_id = p_receipt_id
  limit 1;

  update public.financial_entries set status = 'reversed'
   where source_type = 'receipt_cash' and source_id = p_receipt_id;

  -- Recalcula a parcela (o gatilho da tabela de baixas cuida do resto).
  update public.payment_receipts set reversed = true where id = p_receipt_id;
  return v_new_id;
end;
$$;

grant execute on function public.reverse_payment_receipt(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) mark_installment_paid continua funcionando — agora via baixa
-- -----------------------------------------------------------------------------
-- Telas antigas (I9) chamavam esta função. Em vez de duas verdades, ela passa a
-- registrar/estornar uma BAIXA do valor cheio.
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
  v_saldo bigint;
  v_rec uuid;
begin
  select * into v_inst from public.payment_installments where id = p_installment_id;
  if v_inst.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.can_receive_payment(v_inst.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_paid then
    v_saldo := v_inst.amount_cents - coalesce(v_inst.paid_amount_cents, 0);
    if v_saldo > 0 then
      perform public.register_payment_receipt(
        p_installment_id, v_saldo, current_date, v_inst.payment_method,
        null, 'Baixa total', null);
    end if;
  else
    -- Desfazer: estorna as baixas ativas da parcela.
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
-- 8) Reparo: parcelas que já existem ganham taxas e lançamento de competência
-- -----------------------------------------------------------------------------
update public.payment_installments i
   set late_fee_percent = cfg.late_fee_percent,
       monthly_interest_percent = cfg.monthly_interest_percent,
       grace_days = cfg.grace_days
  from public.finance_settings_for(i.clinic_id) cfg
 where i.late_fee_percent is null;

update public.payment_installments i
   set paid_amount_cents = case when i.status = 'paga' then i.amount_cents else 0 end
 where i.paid_amount_cents = 0 and i.status = 'paga';

do $$
declare
  r record;
begin
  for r in select id from public.payment_installments loop
    perform public.post_installment_accrual(r.id);
  end loop;
end $$;

select public.mark_overdue_installments();
