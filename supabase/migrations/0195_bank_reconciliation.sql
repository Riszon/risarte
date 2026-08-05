-- =============================================================================
-- 0195 — FIN4a: CONCILIAÇÃO BANCÁRIA
-- -----------------------------------------------------------------------------
-- Até aqui o sistema sabia o que DEVERIA entrar e sair. Não sabia o que de
-- fato caiu na conta. Enquanto isso não fecha, o saldo do sistema é opinião —
-- e a projeção de caixa do FIN6 mente.
--
-- COMO FUNCIONA: o extrato do banco vira linhas (`bank_transactions`). Cada
-- linha tem três destinos possíveis:
--   • casa com um lançamento do razão → conciliado, com autor e data;
--   • não existe no sistema → cria o lançamento na hora, já classificado;
--   • não pertence a esta conciliação (transferência entre contas próprias)
--     → ignorada, com motivo, e fica FORA do saldo do banco.
--
-- DUPLICIDADE: no OFX o banco manda o `FITID`, identificador único do
-- lançamento — reimportar o mesmo arquivo não duplica nada. No CSV não existe
-- FITID, então a chave é data + valor + descrição + a ordem da repetição
-- dentro do arquivo (dois pagamentos idênticos no mesmo dia são legítimos e
-- precisam continuar sendo dois).
--
-- Quem concilia: Gerente da unidade, Financeiro da Franqueadora e Admin Master
-- — a mesma régua das contas a pagar. Recepção não entra.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CONTAS BANCÁRIAS
-- -----------------------------------------------------------------------------
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  alias text not null,
  bank_name text,
  bank_code text,
  agency text,
  account_number text,
  kind text not null default 'corrente'
    check (kind in ('corrente', 'poupanca', 'caixa', 'aplicacao')),
  -- Ponto de partida da conciliação: o saldo no dia em que a unidade começou
  -- a usar o sistema. Sem isso, a diferença nunca fecha em zero.
  opening_balance_cents bigint not null default 0,
  opening_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create index if not exists bank_accounts_clinic_idx
  on public.bank_accounts (clinic_id, active, alias);

alter table public.bank_accounts enable row level security;

drop policy if exists "bank_accounts_select" on public.bank_accounts;
create policy "bank_accounts_select" on public.bank_accounts
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- Mesma régua das contas a pagar: recepção não mexe em banco.
create or replace function public.can_reconcile(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_payables(p_clinic_id);
$$;

grant execute on function public.can_reconcile(uuid) to authenticated;

drop policy if exists "bank_accounts_write" on public.bank_accounts;
create policy "bank_accounts_write" on public.bank_accounts
  for all to authenticated
  using (public.can_reconcile(clinic_id))
  with check (public.can_reconcile(clinic_id));

-- -----------------------------------------------------------------------------
-- 2) IMPORTAÇÕES (o histórico dos arquivos que entraram)
-- -----------------------------------------------------------------------------
create table if not exists public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  file_name text,
  format text not null check (format in ('ofx', 'csv')),
  period_start date,
  period_end date,
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists bank_statement_imports_account_idx
  on public.bank_statement_imports (bank_account_id, created_at desc);

alter table public.bank_statement_imports enable row level security;

drop policy if exists "bank_statement_imports_select" on public.bank_statement_imports;
create policy "bank_statement_imports_select" on public.bank_statement_imports
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- -----------------------------------------------------------------------------
-- 3) LINHAS DO EXTRATO
-- -----------------------------------------------------------------------------
create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  import_id uuid references public.bank_statement_imports (id),
  posted_at date not null,
  -- COM SINAL: negativo = saída da conta.
  amount_cents bigint not null check (amount_cents <> 0),
  description text not null default '',
  fit_id text,
  -- Chave anti-duplicidade (FITID no OFX; data+valor+texto+ordem no CSV).
  dedup_key text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'conciliado', 'ignorado')),
  matched_entry_id uuid references public.financial_entries (id),
  matched_at timestamptz,
  matched_by uuid references public.profiles (id),
  ignore_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists bank_transactions_dedup_unique
  on public.bank_transactions (bank_account_id, dedup_key);
create index if not exists bank_transactions_account_idx
  on public.bank_transactions (bank_account_id, posted_at, status);
create unique index if not exists bank_transactions_entry_unique
  on public.bank_transactions (matched_entry_id)
  where matched_entry_id is not null;

comment on index public.bank_transactions_entry_unique is
  'Um lançamento do razão só concilia com UMA linha do extrato — senão o mesmo '
  'dinheiro fecharia duas vezes.';

alter table public.bank_transactions enable row level security;

drop policy if exists "bank_transactions_select" on public.bank_transactions;
create policy "bank_transactions_select" on public.bank_transactions
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- Escrita só pelas funções (que validam duplicidade e permissão).
drop policy if exists "bank_transactions_write" on public.bank_transactions;

-- O razão sabe que já foi conferido no banco.
alter table public.financial_entries
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by uuid references public.profiles (id);

-- -----------------------------------------------------------------------------
-- 4) IMPORTAR o extrato
-- -----------------------------------------------------------------------------
-- p_rows = [{ "postedAt":"2026-08-04", "amountCents":-15000,
--             "description":"PAGAMENTO", "fitId":"123" }, ...]
create or replace function public.import_bank_transactions(
  p_bank_account_id uuid,
  p_format text,
  p_file_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc record;
  v_import_id uuid;
  v_rows integer;
  v_inserted integer;
  v_start date;
  v_end date;
begin
  select * into v_acc from public.bank_accounts where id = p_bank_account_id;
  if v_acc.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if not public.can_reconcile(v_acc.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_format not in ('ofx', 'csv') then raise exception 'INVALID_FORMAT'; end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'NO_ROWS';
  end if;

  select count(*)::integer,
         min((e->>'postedAt')::date),
         max((e->>'postedAt')::date)
    into v_rows, v_start, v_end
  from jsonb_array_elements(p_rows) e;

  insert into public.bank_statement_imports (
    clinic_id, bank_account_id, file_name, format, period_start, period_end,
    row_count, created_by
  ) values (
    v_acc.clinic_id, p_bank_account_id, nullif(btrim(p_file_name), ''),
    p_format, v_start, v_end, v_rows, (select auth.uid())
  )
  returning id into v_import_id;

  with parsed as (
    select
      (e->>'postedAt')::date as posted_at,
      (e->>'amountCents')::bigint as amount_cents,
      coalesce(e->>'description', '') as description,
      nullif(e->>'fitId', '') as fit_id,
      -- Dois lançamentos idênticos no mesmo arquivo são legítimos: a ordem da
      -- repetição entra na chave para os dois sobreviverem, e para o mesmo
      -- arquivo reimportado gerar as MESMAS chaves.
      row_number() over (
        partition by (e->>'postedAt'), (e->>'amountCents'),
                     coalesce(e->>'description', '')
        order by ord
      ) as occurrence
    from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
  ),
  ins as (
    insert into public.bank_transactions (
      clinic_id, bank_account_id, import_id, posted_at, amount_cents,
      description, fit_id, dedup_key
    )
    select v_acc.clinic_id, p_bank_account_id, v_import_id, p.posted_at,
           p.amount_cents, p.description, p.fit_id,
           coalesce(
             p.fit_id,
             md5(p.posted_at::text || '|' || p.amount_cents::text || '|'
                 || p.description || '|' || p.occurrence::text))
    from parsed p
    where p.amount_cents <> 0
    on conflict (bank_account_id, dedup_key) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from ins;

  update public.bank_statement_imports
     set inserted_count = v_inserted,
         duplicate_count = v_rows - v_inserted
   where id = v_import_id;

  return jsonb_build_object(
    'import_id', v_import_id,
    'rows', v_rows,
    'inserted', v_inserted,
    'duplicates', v_rows - v_inserted);
end;
$$;

grant execute on function public.import_bank_transactions(uuid, text, text, jsonb)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) CONCILIAR / DESFAZER / IGNORAR
-- -----------------------------------------------------------------------------
create or replace function public.reconcile_bank_transaction(
  p_transaction_id uuid,
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
  v_entry record;
  v_user uuid := (select auth.uid());
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_tx.status = 'conciliado' then raise exception 'ALREADY_RECONCILED'; end if;

  select * into v_entry from public.financial_entries where id = p_entry_id;
  if v_entry.id is null then raise exception 'ENTRY_NOT_FOUND'; end if;
  if v_entry.clinic_id <> v_tx.clinic_id then raise exception 'CLINIC_MISMATCH'; end if;

  -- O valor tem de bater EXATAMENTE: conciliação não aproxima. No razão o
  -- valor é sempre positivo e o sinal vem da direção.
  if v_entry.amount_cents <> abs(v_tx.amount_cents)
     or (v_tx.amount_cents < 0) <> (v_entry.direction = 'outflow') then
    raise exception 'AMOUNT_MISMATCH';
  end if;

  update public.bank_transactions set
    status = 'conciliado', matched_entry_id = p_entry_id,
    matched_at = now(), matched_by = v_user, ignore_reason = null
  where id = p_transaction_id;

  update public.financial_entries set
    reconciled_at = now(), reconciled_by = v_user
  where id = p_entry_id;
end;
$$;

grant execute on function public.reconcile_bank_transaction(uuid, uuid) to authenticated;

create or replace function public.unreconcile_bank_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;

  if v_tx.matched_entry_id is not null then
    update public.financial_entries
       set reconciled_at = null, reconciled_by = null
     where id = v_tx.matched_entry_id;
  end if;

  update public.bank_transactions set
    status = 'pendente', matched_entry_id = null, matched_at = null,
    matched_by = null, ignore_reason = null
  where id = p_transaction_id;
end;
$$;

grant execute on function public.unreconcile_bank_transaction(uuid) to authenticated;

create or replace function public.ignore_bank_transaction(
  p_transaction_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if v_tx.status = 'conciliado' then raise exception 'ALREADY_RECONCILED'; end if;

  update public.bank_transactions set
    status = 'ignorado', ignore_reason = btrim(p_reason),
    matched_entry_id = null, matched_at = null, matched_by = null
  where id = p_transaction_id;
end;
$$;

grant execute on function public.ignore_bank_transaction(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) CRIAR o lançamento que faltava, a partir da linha do extrato
-- -----------------------------------------------------------------------------
-- É o caminho de saída para tarifa bancária, rendimento e saque que ninguém
-- lançou. Nasce já classificado e já conciliado.
create or replace function public.create_entry_from_bank_transaction(
  p_transaction_id uuid,
  p_account_code text,
  p_cost_center_id uuid default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
  v_entry_id uuid;
  v_analytic boolean;
  v_user uuid := (select auth.uid());
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_tx.status = 'conciliado' then raise exception 'ALREADY_RECONCILED'; end if;

  select is_analytic into v_analytic
  from public.chart_of_accounts where code = p_account_code;
  if v_analytic is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if not v_analytic then raise exception 'ACCOUNT_NOT_ANALYTIC'; end if;

  insert into public.financial_entries (
    clinic_id, account_code, cost_center_id, accrual_date, cash_date,
    amount_cents, direction, status, source_type, source_id, description,
    created_by, reconciled_at, reconciled_by
  ) values (
    v_tx.clinic_id, p_account_code, p_cost_center_id, v_tx.posted_at,
    v_tx.posted_at, abs(v_tx.amount_cents),
    case when v_tx.amount_cents < 0 then 'outflow' else 'inflow' end,
    'settled', 'bank_transaction', p_transaction_id,
    coalesce(nullif(btrim(p_description), ''), v_tx.description),
    v_user, now(), v_user
  )
  returning id into v_entry_id;

  update public.bank_transactions set
    status = 'conciliado', matched_entry_id = v_entry_id,
    matched_at = now(), matched_by = v_user
  where id = p_transaction_id;

  return v_entry_id;
end;
$$;

grant execute on function public.create_entry_from_bank_transaction(
  uuid, text, uuid, text) to authenticated;

select
  (select count(*) from public.bank_accounts) as contas_bancarias,
  (select count(*) from public.bank_transactions) as linhas_de_extrato;
