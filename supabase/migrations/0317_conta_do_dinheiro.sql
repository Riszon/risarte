-- 0317 — AP51: EM QUAL CONTA O DINHEIRO ENTROU OU SAIU.
--
-- Plano e decisões do dono (L1–L4, 22/10/2026): docs/Financeiro/AP51-PLANO.md.
--
-- O "saldo pelo sistema" da Conciliação somava TODO o dinheiro da unidade em
-- cada conta bancária (com duas contas, as duas erravam), e o recebimento EM
-- DINHEIRO no balcão aparecia como diferença contra o extrato do banco. A
-- causa era uma só: o razão não guardava onde o dinheiro está.
--
-- O que esta migração faz:
--   1. `financial_entries.bank_account_id` — onde o dinheiro está — e a conta
--      PRINCIPAL da unidade (`bank_accounts.is_default`, uma por unidade).
--   2. O CAIXA (dinheiro em espécie) é uma conta do tipo `caixa` (que o
--      cadastro já aceitava), criada SOZINHA na primeira vez que precisar (L1).
--   3. UM GATILHO decide a conta de todo lançamento com dinheiro — assim
--      nenhum caminho fica de fora: estorno = a conta do original; a escolha
--      da tela; a linha do extrato; a taxa da adquirente = a do recebimento;
--      sem escolha, dinheiro → Caixa e o resto → a principal (L2).
--   4. CASAR com uma linha do extrato leva o lançamento para a conta da linha:
--      o extrato é a prova de onde o dinheiro está.
--   5. Portas com a conta para as baixas (receber, pagar, pagar a nota) — as
--      funções antigas continuam valendo, com a regra padrão.
--   6. "Transferência do Caixa": depósito (ou saque) entre o Caixa e o banco,
--      pela conta 6.3.01, fora do resultado (L4).
--   7. O que já existe: o extrato manda; dinheiro antigo vai para o Caixa; o
--      resto, para a principal (L3).
--
-- Nada muda na DRE, no Fluxo de caixa nem no Painel da rede: eles somam todas
-- as contas, como antes. Nenhum valor, data ou conta contábil é alterado.
-- Rodar de novo é seguro.

-- -----------------------------------------------------------------------------
-- 1) COLUNAS
-- -----------------------------------------------------------------------------
alter table public.bank_accounts
  add column if not exists is_default boolean not null default false;

-- Uma principal por unidade, e um Caixa ativo por unidade (o gatilho cria o
-- Caixa sozinho; dois cliques ao mesmo tempo não podem criar dois).
create unique index if not exists bank_accounts_one_default
  on public.bank_accounts (clinic_id) where is_default;
create unique index if not exists bank_accounts_one_cash_box
  on public.bank_accounts (clinic_id) where kind = 'caixa' and active;

alter table public.financial_entries
  add column if not exists bank_account_id uuid references public.bank_accounts (id);
create index if not exists financial_entries_bank_account_idx
  on public.financial_entries (bank_account_id) where bank_account_id is not null;

-- -----------------------------------------------------------------------------
-- 2) O CAIXA E A CONTA PADRÃO
-- -----------------------------------------------------------------------------
create or replace function public._cash_box_for(p_clinic_id uuid, p_since date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.bank_accounts
   where clinic_id = p_clinic_id and kind = 'caixa' and active
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.bank_accounts
    (clinic_id, alias, kind, opening_balance_cents, opening_date, active, created_by)
  values
    (p_clinic_id, 'Caixa (dinheiro)', 'caixa', 0,
     least(coalesce(p_since, public.today_br()), public.today_br()), true, auth.uid())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.bank_accounts
     where clinic_id = p_clinic_id and kind = 'caixa' and active
     order by created_at limit 1;
  end if;
  return v_id;
end;
$$;
revoke execute on function public._cash_box_for(uuid, date) from public, anon, authenticated;

-- A conta que vem sozinha quando ninguém escolheu (L2): dinheiro → Caixa;
-- o resto → a principal; sem principal, a única conta bancária; senão, nada.
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
  select id into v_id from public.bank_accounts
   where clinic_id = p_clinic_id and is_default and active limit 1;
  if v_id is not null then return v_id; end if;
  select count(*), min(id::text)::uuid into v_n, v_id from public.bank_accounts
   where clinic_id = p_clinic_id and active and kind <> 'caixa';
  if v_n = 1 then return v_id; end if;
  return null;
end;
$$;
revoke execute on function public._default_bank_account(uuid, text, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) O GATILHO: toda entrada de dinheiro no razão ganha a sua conta
-- -----------------------------------------------------------------------------
create or replace function public.financial_entry_bank_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_choice text;
  v_method text;
  v_rev uuid;
  v_id uuid;
begin
  -- Competência pura não tem dinheiro se movendo.
  if new.cash_date is null then return new; end if;

  if new.bank_account_id is not null then
    if not exists (
      select 1 from public.bank_accounts b
       where b.id = new.bank_account_id and b.clinic_id = new.clinic_id
    ) then
      raise exception 'BANK_ACCOUNT_INVALID';
    end if;
    return new;
  end if;

  -- Estorno volta pela MESMA conta do original.
  if new.reversal_of is not null then
    select e.bank_account_id into new.bank_account_id
      from public.financial_entries e where e.id = new.reversal_of;
    return new;
  end if;

  -- A escolha da tela, pela porta da baixa (vale só nesta transação).
  v_choice := nullif(btrim(coalesce(current_setting('risarte.conta_do_dinheiro', true), '')), '');
  if v_choice is not null then
    if v_choice = 'caixa' then
      new.bank_account_id := public._cash_box_for(new.clinic_id, new.cash_date);
    else
      begin
        v_id := v_choice::uuid;
      exception when others then
        raise exception 'BANK_ACCOUNT_INVALID';
      end;
      if not exists (
        select 1 from public.bank_accounts b
         where b.id = v_id and b.clinic_id = new.clinic_id and b.active
      ) then
        raise exception 'BANK_ACCOUNT_INVALID';
      end if;
      new.bank_account_id := v_id;
    end if;
    return new;
  end if;

  if new.source_type = 'bank_transaction' then
    select t.bank_account_id into new.bank_account_id
      from public.bank_transactions t where t.id = new.source_id;

  elsif new.source_type = 'acquirer_fee' then
    -- A taxa sai de onde o recebimento entrou.
    select e.bank_account_id into new.bank_account_id
      from public.financial_entries e
     where e.source_type = 'receipt_cash' and e.source_id = new.source_id
     order by e.created_at limit 1;

  elsif new.source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee') then
    select r.payment_method, r.reversal_of into v_method, v_rev
      from public.payment_receipts r where r.id = new.source_id;
    if v_rev is not null then
      select e.bank_account_id into new.bank_account_id
        from public.financial_entries e
       where e.source_type = 'receipt_cash' and e.source_id = v_rev
       order by e.created_at limit 1;
    else
      new.bank_account_id := public._default_bank_account(new.clinic_id, v_method, new.cash_date);
    end if;

  elsif new.source_type in ('payable_cash', 'payable_late_fee') then
    select p.payment_method, p.reversal_of into v_method, v_rev
      from public.payable_payments p where p.id = new.source_id;
    if v_rev is not null then
      select e.bank_account_id into new.bank_account_id
        from public.financial_entries e
       where e.source_type = 'payable_cash' and e.source_id = v_rev
       order by e.created_at limit 1;
    else
      new.bank_account_id := public._default_bank_account(new.clinic_id, v_method, new.cash_date);
    end if;

  else
    new.bank_account_id := public._default_bank_account(new.clinic_id, null, new.cash_date);
  end if;

  return new;
end;
$$;
revoke execute on function public.financial_entry_bank_account() from public, anon, authenticated;

drop trigger if exists financial_entries_bank_account on public.financial_entries;
create trigger financial_entries_bank_account
  before insert on public.financial_entries
  for each row execute function public.financial_entry_bank_account();

-- -----------------------------------------------------------------------------
-- 4) CASAR COM O EXTRATO LEVA O LANÇAMENTO PARA A CONTA DA LINHA
-- -----------------------------------------------------------------------------
create or replace function public.bank_match_moves_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if tg_table_name = 'bank_transactions' then
    if new.matched_entry_id is null
       or new.matched_entry_id is not distinct from old.matched_entry_id then
      return new;
    end if;
    update public.financial_entries
       set bank_account_id = new.bank_account_id
     where id = new.matched_entry_id
       and bank_account_id is distinct from new.bank_account_id;
  else
    select t.bank_account_id into v_account
      from public.bank_transactions t where t.id = new.transaction_id;
    update public.financial_entries
       set bank_account_id = v_account
     where id = new.entry_id
       and bank_account_id is distinct from v_account;
  end if;
  return new;
end;
$$;
revoke execute on function public.bank_match_moves_entry() from public, anon, authenticated;

drop trigger if exists bank_transactions_match_moves_entry on public.bank_transactions;
create trigger bank_transactions_match_moves_entry
  after update of matched_entry_id on public.bank_transactions
  for each row execute function public.bank_match_moves_entry();

drop trigger if exists bank_transaction_matches_moves_entry on public.bank_transaction_matches;
create trigger bank_transaction_matches_moves_entry
  after insert on public.bank_transaction_matches
  for each row execute function public.bank_match_moves_entry();

-- -----------------------------------------------------------------------------
-- 5) AS PORTAS DA BAIXA COM A CONTA ESCOLHIDA
-- -----------------------------------------------------------------------------
-- `p_conta`: o id de uma conta da unidade, 'caixa', ou vazio (= a regra padrão).
-- Cada porta só marca a escolha e chama a função de sempre, que continua
-- conferindo permissão, saldo e situação.

create or replace function public.register_payment_receipt_to(
  p_conta text,
  p_installment_id uuid,
  p_amount_cents bigint,
  p_received_at date,
  p_payment_method text,
  p_reference text,
  p_notes text,
  p_client_token uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform set_config('risarte.conta_do_dinheiro', coalesce(p_conta, ''), true);
  v_id := public.register_payment_receipt(
    p_installment_id, p_amount_cents, p_received_at, p_payment_method,
    p_reference, p_notes, p_client_token
  );
  -- A escolha vale só para ESTA baixa: o que vier depois, na mesma
  -- transação, segue a regra padrão.
  perform set_config('risarte.conta_do_dinheiro', '', true);
  return v_id;
end;
$$;
revoke execute on function public.register_payment_receipt_to(text, uuid, bigint, date, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.register_payment_receipt_to(text, uuid, bigint, date, text, text, text, uuid) to authenticated;

create or replace function public.register_payable_payment_from(
  p_conta text,
  p_payable_id uuid,
  p_amount_cents bigint,
  p_paid_at date,
  p_payment_method text,
  p_fee_cents bigint,
  p_interest_cents bigint,
  p_reference text,
  p_notes text,
  p_client_token uuid,
  p_discount_cents bigint
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform set_config('risarte.conta_do_dinheiro', coalesce(p_conta, ''), true);
  v_id := public.register_payable_payment(
    p_payable_id, p_amount_cents, p_paid_at, p_payment_method, p_fee_cents,
    p_interest_cents, p_reference, p_notes, p_client_token, p_discount_cents
  );
  perform set_config('risarte.conta_do_dinheiro', '', true);
  return v_id;
end;
$$;
revoke execute on function public.register_payable_payment_from(text, uuid, bigint, date, text, bigint, bigint, text, text, uuid, bigint) from public, anon, authenticated;
grant execute on function public.register_payable_payment_from(text, uuid, bigint, date, text, bigint, bigint, text, text, uuid, bigint) to authenticated;

create or replace function public.pay_stock_purchase_from(
  p_conta text,
  p_purchase_id uuid,
  p_paid_at date,
  p_payment_method text,
  p_reference text,
  p_notes text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_r jsonb;
begin
  perform set_config('risarte.conta_do_dinheiro', coalesce(p_conta, ''), true);
  v_r := public.pay_stock_purchase(
    p_purchase_id, p_paid_at, p_payment_method, p_reference, p_notes
  );
  perform set_config('risarte.conta_do_dinheiro', '', true);
  return v_r;
end;
$$;
revoke execute on function public.pay_stock_purchase_from(text, uuid, date, text, text, text) from public, anon, authenticated;
grant execute on function public.pay_stock_purchase_from(text, uuid, date, text, text, text) to authenticated;

-- A conta principal da unidade (uma só): marcar uma desmarca as outras.
create or replace function public.set_default_bank_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acc record;
begin
  select * into v_acc from public.bank_accounts where id = p_account_id;
  if v_acc.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if not coalesce(public.can_reconcile(v_acc.clinic_id), false) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_acc.kind = 'caixa' then raise exception 'CASH_BOX_NOT_DEFAULT'; end if;
  if not v_acc.active then raise exception 'ACCOUNT_INACTIVE'; end if;

  update public.bank_accounts set is_default = false
   where clinic_id = v_acc.clinic_id and is_default and id <> p_account_id;
  update public.bank_accounts set is_default = true,
         updated_at = now(), updated_by = auth.uid()
   where id = p_account_id;
end;
$$;
revoke execute on function public.set_default_bank_account(uuid) from public, anon, authenticated;
grant execute on function public.set_default_bank_account(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) TRANSFERÊNCIA DO CAIXA (L4)
-- -----------------------------------------------------------------------------
-- A linha do extrato (depósito ou saque) vira as DUAS pontas da transferência:
-- o lado do banco, pela porta de sempre (que já casa a linha), e o lado do
-- Caixa, no sentido contrário. Conta 6.3.01 (ativo): fora do resultado.
create or replace function public.transfer_bank_transaction_with_cash_box(
  p_transaction_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
  v_bank_entry uuid;
  v_box uuid;
  v_box_kind text;
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not coalesce(public.can_reconcile(v_tx.clinic_id), false) then
    raise exception 'NOT_ALLOWED';
  end if;
  select kind into v_box_kind from public.bank_accounts where id = v_tx.bank_account_id;
  if v_box_kind = 'caixa' then raise exception 'ALREADY_CASH_BOX'; end if;

  v_bank_entry := public.create_entry_from_bank_transaction(
    p_transaction_id, '6.3.01', null,
    case when v_tx.amount_cents >= 0 then 'Depósito do dinheiro do Caixa'
         else 'Saque para o Caixa' end
  );

  v_box := public._cash_box_for(v_tx.clinic_id, v_tx.posted_at);
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents, direction,
    status, source_type, source_id, description, created_by, bank_account_id
  ) values (
    v_tx.clinic_id, '6.3.01', v_tx.posted_at, v_tx.posted_at,
    abs(v_tx.amount_cents),
    case when v_tx.amount_cents >= 0 then 'outflow' else 'inflow' end,
    'settled', 'cash_box_transfer', p_transaction_id,
    case when v_tx.amount_cents >= 0 then 'Depositado no banco'
         else 'Sacado do banco' end,
    auth.uid(), v_box
  );

  return v_bank_entry;
end;
$$;
revoke execute on function public.transfer_bank_transaction_with_cash_box(uuid) from public, anon, authenticated;
grant execute on function public.transfer_bank_transaction_with_cash_box(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O QUE JÁ EXISTE (L3)
-- -----------------------------------------------------------------------------
-- a) Unidade com UMA conta bancária (fora o Caixa) e nenhuma principal: ela
--    vira a principal.
update public.bank_accounts b
   set is_default = true
 where b.active and b.kind <> 'caixa'
   and not exists (select 1 from public.bank_accounts x
                    where x.clinic_id = b.clinic_id and x.is_default)
   and (select count(*) from public.bank_accounts y
         where y.clinic_id = b.clinic_id and y.active and y.kind <> 'caixa') = 1;

-- b) O extrato manda: lançamento criado pela linha, ou casado com ela, fica na
--    conta da linha.
update public.financial_entries e
   set bank_account_id = t.bank_account_id
  from public.bank_transactions t
 where e.bank_account_id is null and e.cash_date is not null
   and e.source_type = 'bank_transaction' and e.source_id = t.id;
update public.financial_entries e
   set bank_account_id = t.bank_account_id
  from public.bank_transactions t
 where e.bank_account_id is null and e.cash_date is not null
   and t.matched_entry_id = e.id;
update public.financial_entries e
   set bank_account_id = t.bank_account_id
  from public.bank_transaction_matches m
  join public.bank_transactions t on t.id = m.transaction_id
 where e.bank_account_id is null and e.cash_date is not null
   and m.entry_id = e.id;

-- c) Dinheiro em espécie (recebido ou pago) vai para o Caixa, criado desde o
--    primeiro movimento da unidade.
do $$
declare
  r record;
begin
  for r in
    select x.clinic_id, min(x.cash_date) as desde
      from (
        select e.clinic_id, e.cash_date
          from public.financial_entries e
          join public.payment_receipts pr on pr.id = e.source_id
         where e.source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee')
           and e.bank_account_id is null and e.cash_date is not null
           and pr.payment_method = 'dinheiro'
        union all
        select e.clinic_id, e.cash_date
          from public.financial_entries e
          join public.payable_payments pp on pp.id = e.source_id
         where e.source_type in ('payable_cash', 'payable_late_fee')
           and e.bank_account_id is null and e.cash_date is not null
           and pp.payment_method = 'dinheiro'
      ) x
     group by x.clinic_id
  loop
    perform public._cash_box_for(r.clinic_id, r.desde);
  end loop;
end $$;

update public.financial_entries e
   set bank_account_id = b.id
  from public.payment_receipts pr, public.bank_accounts b
 where e.source_type in ('receipt_cash', 'receipt_benefit', 'receipt_late_fee')
   and e.source_id = pr.id and pr.payment_method = 'dinheiro'
   and e.bank_account_id is null and e.cash_date is not null
   and b.clinic_id = e.clinic_id and b.kind = 'caixa' and b.active;
update public.financial_entries e
   set bank_account_id = b.id
  from public.payable_payments pp, public.bank_accounts b
 where e.source_type in ('payable_cash', 'payable_late_fee')
   and e.source_id = pp.id and pp.payment_method = 'dinheiro'
   and e.bank_account_id is null and e.cash_date is not null
   and b.clinic_id = e.clinic_id and b.kind = 'caixa' and b.active;

-- d) Estorno acompanha o original.
update public.financial_entries e
   set bank_account_id = o.bank_account_id
  from public.financial_entries o
 where e.reversal_of = o.id
   and e.bank_account_id is null and e.cash_date is not null
   and o.bank_account_id is not null;

-- e) A taxa da adquirente acompanha o recebimento.
update public.financial_entries e
   set bank_account_id = r.bank_account_id
  from public.financial_entries r
 where e.source_type = 'acquirer_fee' and e.bank_account_id is null
   and e.cash_date is not null
   and r.source_type = 'receipt_cash' and r.source_id = e.source_id
   and r.bank_account_id is not null;

-- f) O resto, na principal (onde houver).
update public.financial_entries e
   set bank_account_id = b.id
  from public.bank_accounts b
 where e.bank_account_id is null and e.cash_date is not null
   and b.clinic_id = e.clinic_id and b.is_default and b.active;
