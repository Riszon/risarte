-- =============================================================================
-- 0301 — CONCILIAÇÃO: TRANSFERÊNCIA ENTRE CONTAS E UMA LINHA COM VÁRIOS LANÇAMENTOS (OC-00108)
--
-- Relato OC-00108 (Financeiro da Franqueadora, treino, 16/10/2026): na
-- conciliação "não há opção para baixa do crédito", "ignorar" tira o valor
-- do saldo, e o receio de duplicar a baixa do boleto do paciente. O dono pediu
-- pesquisa a fundo. O que se achou (treino, conta do relato: 33 entradas
-- pendentes — 25 Pix, 6 depósitos da maquininha, 2 resgates de aplicação):
--
--   - REGRA, que segue: "Conciliar" casa a linha com um lançamento que JÁ
--     EXISTE; "Lançar o que faltava" CRIA um. O recebimento do paciente nasce
--     na baixa da parcela (Recebíveis) e no banco só se casa — lançar de novo
--     duplicaria. A tela vai avisar (código, não banco).
--   - A conta estava na FRANQUEADORA, que só oferece receitas da franqueadora.
--     O dono disse que ela é da Cambé: mudança de dado feita no treino (a
--     produção não tem conta bancária).
--   - LACUNA 1 — cartão: o banco deposita o LÍQUIDO, às vezes de várias vendas
--     juntas, e a conciliação só casava UMA linha com UM lançamento de MESMO
--     valor. Nunca casaria.
--   - LACUNA 2 — resgate/aplicação/transferência entre contas próprias não é
--     receita nem despesa; a única saída era "Ignorar", que tira a linha do
--     saldo do banco.
--
-- O QUE MUDA (decisões do dono, 16/10/2026):
--   1. Conta 6.3.01 "Aplicações e transferências entre contas próprias"
--      (ativo): como todo grupo 6, fica FORA da DRE, do orçamento, do ponto de
--      equilíbrio e do consolidado (as funções excluem '6%'); no fluxo de caixa
--      conta como INVESTIMENTO (resgate não é dinheiro gerado pela operação).
--      A tela lança nela pelo caminho de sempre (create_entry_from_bank_transaction).
--   2. `bank_transaction_matches` + `reconcile_bank_transaction_multi()`: uma
--      linha casa com VÁRIOS lançamentos, se a soma (entradas − saídas) bater
--      no centavo. É o depósito da maquininha: recebimentos + taxas.
--   3. `reconcile_bank_transaction()` passa a recusar lançamento já
--      conciliado; `unreconcile_bank_transaction()` solta os vários.
--
-- Funções 2 e 3 vêm do banco (definição em uso), com trocas pontuais; mesma
-- assinatura e retorno. Tabela nova entra na auditoria. Nada apaga dado.
-- Idempotente.
-- =============================================================================

-- 1) A conta das aplicações e transferências ----------------------------------
insert into public.chart_of_accounts (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic) values
  ('6.3',    'Aplicações e transferências',                        '6',   'expense', 'asset', 'none', 'both', false),
  ('6.3.01', 'Aplicações e transferências entre contas próprias',  '6.3', 'expense', 'asset', 'none', 'both', true)
on conflict (code) do nothing;

CREATE OR REPLACE FUNCTION public.cash_flow_series_raw(p_clinic_id uuid, p_from date, p_to date)
 RETURNS TABLE(day date, kind text, activity text, inflow_cents bigint, outflow_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    e.cash_date,
    'realizado'::text,
    case
      when e.account_code like '5.1%' or e.account_code like '6.3%' then 'investimento'
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
    and coalesce(i.expected_settlement_date, i.due_date)
        between greatest(p_from, public.today_br()) and p_to
  group by 1, 2, 3

  union all

  select
    p.due_date,
    'previsto'::text,
    case
      when p.account_code like '5.1%' or p.account_code like '6.3%' then 'investimento'
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
$function$;

-- 2) Uma linha, vários lançamentos ---------------------------------------------
create table if not exists public.bank_transaction_matches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  transaction_id uuid not null references public.bank_transactions (id) on delete cascade,
  entry_id uuid not null references public.financial_entries (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- Um lançamento concilia com UMA linha só — senão o mesmo dinheiro fecharia duas vezes.
create unique index if not exists bank_transaction_matches_entry_unique
  on public.bank_transaction_matches (entry_id);
create index if not exists bank_transaction_matches_tx_idx
  on public.bank_transaction_matches (transaction_id);

alter table public.bank_transaction_matches enable row level security;

drop policy if exists bank_transaction_matches_select on public.bank_transaction_matches;
create policy bank_transaction_matches_select on public.bank_transaction_matches
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));
-- Escrita só pela função (que confere a soma e a permissão).

create or replace function public.reconcile_bank_transaction_multi(
  p_transaction_id uuid,
  p_entry_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
  v_user uuid := (select auth.uid());
  v_qtd int;
  v_ok int;
  v_soma bigint;
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_tx.status = 'conciliado' then raise exception 'ALREADY_RECONCILED'; end if;

  select count(distinct x) into v_qtd from unnest(p_entry_ids) x;
  if coalesce(v_qtd, 0) < 2 then raise exception 'NEED_TWO_OR_MORE'; end if;

  -- Todos existem, são desta unidade, têm caixa e ainda não foram conciliados.
  select count(*)::int,
         coalesce(sum(case when e.direction = 'inflow' then e.amount_cents else -e.amount_cents end), 0)::bigint
    into v_ok, v_soma
  from public.financial_entries e
  where e.id = any(p_entry_ids)
    and e.clinic_id = v_tx.clinic_id
    and e.cash_date is not null
    and e.status <> 'cancelled'
    and e.reconciled_at is null;
  if v_ok <> v_qtd then raise exception 'ENTRY_NOT_AVAILABLE'; end if;

  -- A soma tem de bater EXATAMENTE: conciliação não aproxima.
  if v_soma <> v_tx.amount_cents then raise exception 'AMOUNT_MISMATCH'; end if;

  insert into public.bank_transaction_matches (clinic_id, transaction_id, entry_id, created_by)
  select v_tx.clinic_id, p_transaction_id, x, v_user
  from (select distinct unnest(p_entry_ids) as x) s;

  update public.financial_entries
     set reconciled_at = now(), reconciled_by = v_user
   where id = any(p_entry_ids);

  update public.bank_transactions set
    status = 'conciliado', matched_entry_id = null,
    matched_at = now(), matched_by = v_user, ignore_reason = null
  where id = p_transaction_id;
end;
$$;

revoke execute on function public.reconcile_bank_transaction_multi(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reconcile_bank_transaction_multi(uuid, uuid[]) to authenticated;

-- 3) Conciliar um a um e desfazer ---------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_bank_transaction(p_transaction_id uuid, p_entry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- OC-00108: um lançamento concilia com UMA linha só — inclusive quando ele
  -- já entrou numa conciliação de VÁRIOS lançamentos.
  if v_entry.reconciled_at is not null then raise exception 'ENTRY_ALREADY_RECONCILED'; end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.unreconcile_bank_transaction(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- OC-00108: a linha casada com VÁRIOS lançamentos solta todos eles.
  update public.financial_entries e
     set reconciled_at = null, reconciled_by = null
    from public.bank_transaction_matches m
   where m.transaction_id = p_transaction_id and e.id = m.entry_id;
  delete from public.bank_transaction_matches where transaction_id = p_transaction_id;

  update public.bank_transactions set
    status = 'pendente', matched_entry_id = null, matched_at = null,
    matched_by = null, ignore_reason = null
  where id = p_transaction_id;
end;
$function$;

revoke execute on function public.reconcile_bank_transaction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reconcile_bank_transaction(uuid, uuid) to authenticated;
revoke execute on function public.unreconcile_bank_transaction(uuid) from public, anon, authenticated;
grant execute on function public.unreconcile_bank_transaction(uuid) to authenticated;

-- A tabela nova entra na auditoria (regra 7 do CLAUDE.md).
select public.audit_attach_all();
