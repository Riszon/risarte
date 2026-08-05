-- =============================================================================
-- 0196 — FIN4a: trava do extrato trocado + desfazer importação
-- -----------------------------------------------------------------------------
-- BUG relatado pelo dono (05/08/2026): importar o MESMO extrato em duas contas
-- bancárias diferentes duplicou os lançamentos.
--
-- Causa: a chave anti-duplicidade da 0195 é única por CONTA
-- (`bank_account_id, dedup_key`). Isso é certo para o caso normal — duas
-- contas podem ter movimentos legitimamente idênticos —, mas deixa passar o
-- erro real: escolher a conta errada na hora de importar. O resultado é o pior
-- possível no financeiro: o sistema mostra o dobro do dinheiro.
--
-- Correção em duas camadas:
--
--   1) O ARQUIVO DIZ DE QUAL CONTA É. O OFX traz `<BANKACCTFROM><ACCTID>`. Se
--      ele não bate com o número da conta cadastrada, a importação para.
--   2) MESMOS LANÇAMENTOS EM OUTRA CONTA. Se as chaves do arquivo já existem em
--      outra conta da mesma unidade, a importação para e diz em qual conta
--      estão. Vale também para CSV, que não identifica a conta.
--
-- Ambas podem ser forçadas (`p_force`), para o caso raro de movimento
-- legitimamente idêntico — mas aí é decisão consciente, não acidente.
--
-- E o caminho de volta: `delete_bank_import` desfaz uma importação inteira.
-- Só apaga linha PENDENTE — o que já foi conciliado exige desfazer a
-- conciliação antes, para nunca sumir com dinheiro conferido.
-- Idempotente.
-- =============================================================================

alter table public.bank_statement_imports
  add column if not exists statement_account_id text,
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_by uuid references public.profiles (id);

comment on column public.bank_statement_imports.statement_account_id is
  'Conta que o próprio arquivo declara (ACCTID do OFX). É o que impede '
  'importar o extrato de um banco na conta de outro.';

-- -----------------------------------------------------------------------------
-- 1) Importar, agora com as duas travas
-- -----------------------------------------------------------------------------
drop function if exists public.import_bank_transactions(uuid, text, text, jsonb);

create or replace function public.import_bank_transactions(
  p_bank_account_id uuid,
  p_format text,
  p_file_name text,
  p_rows jsonb,
  p_statement_account_id text default null,
  p_force boolean default false
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
  v_registered text;
  v_declared text;
  v_other text;
begin
  select * into v_acc from public.bank_accounts where id = p_bank_account_id;
  if v_acc.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if not public.can_reconcile(v_acc.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_format not in ('ofx', 'csv') then raise exception 'INVALID_FORMAT'; end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'NO_ROWS';
  end if;

  -- TRAVA 1: o arquivo diz de qual conta é.
  v_registered := regexp_replace(coalesce(v_acc.account_number, ''), '\D', '', 'g');
  v_declared := regexp_replace(coalesce(p_statement_account_id, ''), '\D', '', 'g');
  if not p_force and v_registered <> '' and v_declared <> ''
     and v_registered <> v_declared then
    raise exception 'ACCOUNT_MISMATCH: extrato da conta % , conta escolhida %',
      v_declared, v_registered;
  end if;

  select count(*)::integer,
         min((e->>'postedAt')::date),
         max((e->>'postedAt')::date)
    into v_rows, v_start, v_end
  from jsonb_array_elements(p_rows) e;

  -- As chaves que este arquivo geraria.
  create temporary table if not exists tmp_import_keys (
    posted_at date, amount_cents bigint, description text,
    fit_id text, dedup_key text
  ) on commit drop;
  delete from tmp_import_keys;

  insert into tmp_import_keys
  select p.posted_at, p.amount_cents, p.description, p.fit_id,
         coalesce(
           p.fit_id,
           md5(p.posted_at::text || '|' || p.amount_cents::text || '|'
               || p.description || '|' || p.occurrence::text))
  from (
    select
      (e->>'postedAt')::date as posted_at,
      (e->>'amountCents')::bigint as amount_cents,
      coalesce(e->>'description', '') as description,
      nullif(e->>'fitId', '') as fit_id,
      row_number() over (
        partition by (e->>'postedAt'), (e->>'amountCents'),
                     coalesce(e->>'description', '')
        order by ord
      ) as occurrence
    from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
  ) p
  where p.amount_cents <> 0;

  -- TRAVA 2: os mesmos lançamentos já estão em OUTRA conta da unidade?
  if not p_force then
    select string_agg(distinct a.alias, ', ') into v_other
    from public.bank_transactions bt
    join public.bank_accounts a on a.id = bt.bank_account_id
    join tmp_import_keys k on k.dedup_key = bt.dedup_key
    where a.clinic_id = v_acc.clinic_id
      and bt.bank_account_id <> p_bank_account_id;
    if v_other is not null then
      raise exception
        'ALREADY_IN_ANOTHER_ACCOUNT: estes lançamentos já estão em "%"', v_other;
    end if;
  end if;

  insert into public.bank_statement_imports (
    clinic_id, bank_account_id, file_name, format, period_start, period_end,
    row_count, statement_account_id, created_by
  ) values (
    v_acc.clinic_id, p_bank_account_id, nullif(btrim(p_file_name), ''),
    p_format, v_start, v_end, v_rows, nullif(v_declared, ''), (select auth.uid())
  )
  returning id into v_import_id;

  with ins as (
    insert into public.bank_transactions (
      clinic_id, bank_account_id, import_id, posted_at, amount_cents,
      description, fit_id, dedup_key
    )
    select v_acc.clinic_id, p_bank_account_id, v_import_id, k.posted_at,
           k.amount_cents, k.description, k.fit_id, k.dedup_key
    from tmp_import_keys k
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

grant execute on function public.import_bank_transactions(
  uuid, text, text, jsonb, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) DESFAZER uma importação inteira
-- -----------------------------------------------------------------------------
-- O caminho de volta para quem importou na conta errada. Só apaga linha
-- PENDENTE: linha já conciliada representa dinheiro conferido, e some junto
-- com o vínculo — quem quiser remover precisa desfazer a conciliação antes.
create or replace function public.delete_bank_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp record;
  v_reconciled integer;
  v_deleted integer;
begin
  select * into v_imp from public.bank_statement_imports where id = p_import_id;
  if v_imp.id is null then raise exception 'IMPORT_NOT_FOUND'; end if;
  if not public.can_reconcile(v_imp.clinic_id) then raise exception 'NOT_ALLOWED'; end if;

  select count(*)::integer into v_reconciled
  from public.bank_transactions
  where import_id = p_import_id and status = 'conciliado';
  if v_reconciled > 0 then
    raise exception
      'HAS_RECONCILED: % linha(s) já conciliada(s) — desfaça a conciliação antes',
      v_reconciled;
  end if;

  with del as (
    delete from public.bank_transactions
    where import_id = p_import_id and status <> 'conciliado'
    returning 1
  )
  select count(*)::integer into v_deleted from del;

  update public.bank_statement_imports
     set reverted_at = now(), reverted_by = (select auth.uid())
   where id = p_import_id;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

grant execute on function public.delete_bank_import(uuid) to authenticated;

select
  (select count(*) from public.bank_statement_imports) as importacoes,
  (select count(*) from public.bank_transactions) as linhas_de_extrato;
