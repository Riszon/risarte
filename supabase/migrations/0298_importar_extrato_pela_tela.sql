-- =============================================================================
-- 0298 — A IMPORTAÇÃO DE EXTRATO VOLTA A FUNCIONAR PELA TELA (OC-00103)
--
-- Relato OC-00103 (Financeiro da Franqueadora, treino, 15/10/2026): o extrato
-- não importava, em OFX nem em CSV — só "Não foi possível importar o extrato."
--
-- CAUSA (provada pela API, no treino, sem gravar nada): a conexão da API do
-- Supabase carrega o `safeupdate`, que recusa DELETE sem WHERE. A função tinha
-- `delete from tmp_import_keys;` (esvaziar a tabela temporária da chamada) e
-- parava ali: "DELETE requires a WHERE clause". No SQL Editor e na conexão
-- direta dos testes o safeupdate não está carregado — por isso ela passava em
-- todo teste e quebrava na tela. Os arquivos do relato estão certos: 60
-- lançamentos cada, e o banco os aceita inteiros com o comando corrigido.
--
-- O QUE MUDA: só aquela linha, que vira `where true` (a tabela é temporária,
-- desta chamada só). O resto da função é a 0196, copiado por script. Mesma
-- assinatura e mesmo retorno; as permissões da 0297 são repostas no fim.
--
-- Nada apaga dado. Idempotente.
-- =============================================================================

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
  -- OC-00103: "where true" de propósito. A API do Supabase carrega o
  -- safeupdate, que recusa DELETE sem WHERE ("DELETE requires a WHERE
  -- clause") — e a importação inteira parava aqui, pela tela, sem nunca
  -- falhar no SQL Editor. A tabela é temporária, desta chamada só.
  delete from tmp_import_keys where true;

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

revoke execute on function public.import_bank_transactions(uuid, text, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.import_bank_transactions(uuid, text, text, jsonb, text, boolean) to authenticated;
