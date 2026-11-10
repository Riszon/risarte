-- =============================================================================
-- 0372 — FINANCEIRO: QUEM LANÇOU E QUEM DEU BAIXA, NO PRÓPRIO LANÇAMENTO
-- -----------------------------------------------------------------------------
-- Pedido do dono (09/11/2026): "No Financeiro todo o registro de baixa,
-- lançamento de contas a pagar, recebimento etc. deve ficar registrado no
-- próprio lançamento; deve ter como ver quem lançou."
--
-- O QUE JÁ EXISTIA: quase todo ato do Financeiro já guardava autor e hora
-- (created_by/created_at, approved_by, matched_by, closed_by...). Faltava
-- mostrar. TRÊS atos não guardavam no próprio registro — só a auditoria geral
-- (`audit_changes`, 0288), que só o Admin Master lê:
--   1. CANCELAR conta a pagar: ficava só o motivo.
--   2. IGNORAR linha do extrato: ficava só o motivo.
--   3. DESFAZER conciliação: APAGAVA quem tinha casado e não dizia quem desfez.
--
-- O QUE ESTA MIGRAÇÃO FAZ:
--   a) colunas novas: payables.cancelled_by/at; bank_transactions.ignored_by/at
--      e undone_by/at (a ÚLTIMA vez que alguém desfez);
--   b) as três funções passam a gravá-las;
--   c) PREENCHE os antigos com o que a auditoria geral guardou (desde
--      09/10/2026). O que aconteceu antes disso fica sem autor — a tela diz
--      "autor não registrado" (decisão do dono, 09/11/2026);
--   d) relatórios que já existiam devolvem o nome de quem lançou: detalhe da
--      DRE (`dre_entries`), detalhe do caixa (`cash_flow_detail`) e quem
--      reabriu o mês (`fiscal_year_status`);
--   e) `finance_history(tipo, id)`: o histórico de UM lançamento, tirado da
--      auditoria geral, para quem já enxerga o Financeiro daquela unidade
--      (decisão do dono, 09/11/2026) — mesmo desenho do `supplier_history`
--      (0371).
--
-- Não apaga nem altera dado existente além de preencher as colunas novas.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) COLUNAS NOVAS
-- -----------------------------------------------------------------------------
alter table public.payables
  add column if not exists cancelled_by uuid references public.profiles (id),
  add column if not exists cancelled_at timestamptz;

alter table public.bank_transactions
  add column if not exists ignored_by uuid references public.profiles (id),
  add column if not exists ignored_at timestamptz,
  add column if not exists undone_by uuid references public.profiles (id),
  add column if not exists undone_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2) CANCELAR CONTA A PAGAR grava quem e quando
-- -----------------------------------------------------------------------------
create or replace function public.cancel_payable(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_user uuid := (select auth.uid());
begin
  select * into v_p from public.payables where id = p_id;
  if v_p.id is null then raise exception 'PAYABLE_NOT_FOUND'; end if;
  if not public.can_manage_payables(v_p.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if coalesce(v_p.paid_amount_cents, 0) > 0 then
    raise exception 'ALREADY_PAID';
  end if;

  update public.payables set
    status = 'cancelada', cancel_reason = btrim(p_reason),
    cancelled_by = v_user, cancelled_at = now(),
    updated_at = now()
  where id = p_id;

  -- O lançamento de competência é cancelado junto (a despesa não existiu).
  update public.financial_entries set status = 'cancelled'
   where source_type = 'payable_accrual' and source_id = p_id;
end;
$$;

revoke execute on function public.cancel_payable(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_payable(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) IGNORAR LINHA DO EXTRATO grava quem e quando
-- -----------------------------------------------------------------------------
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
    ignored_by = (select auth.uid()), ignored_at = now(),
    matched_entry_id = null, matched_at = null, matched_by = null
  where id = p_transaction_id;
end;
$$;

revoke execute on function public.ignore_bank_transaction(uuid, text) from public, anon, authenticated;
grant execute on function public.ignore_bank_transaction(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) DESFAZER CONCILIAÇÃO grava quem desfez e quando
-- -----------------------------------------------------------------------------
-- Quem tinha casado continua apagado da linha (ela volta a "pendente"), mas o
-- "desfeita por" fica — e o histórico do lançamento mostra o casamento antigo.
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
    matched_by = null, ignore_reason = null,
    ignored_by = null, ignored_at = null,
    undone_by = (select auth.uid()), undone_at = now()
  where id = p_transaction_id;
end;
$function$;

revoke execute on function public.unreconcile_bank_transaction(uuid) from public, anon, authenticated;
grant execute on function public.unreconcile_bank_transaction(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) OS ANTIGOS: preenche com o que a auditoria geral guardou
-- -----------------------------------------------------------------------------
-- Só onde a coluna nova está vazia; pega a ÚLTIMA vez que o ato aconteceu.
-- `user_id` nulo (rotina/serviço) fica nulo: a tela diz "pelo sistema".
update public.payables p
   set cancelled_by = a.user_id, cancelled_at = a.occurred_at
  from (
    select distinct on (row_id) row_id, user_id, occurred_at
      from public.audit_changes
     where schema_name = 'public' and table_name = 'payables' and op = 'U'
       and changes -> 'status' ->> 'depois' = 'cancelada'
     order by row_id, occurred_at desc
  ) a
 where p.id::text = a.row_id
   and p.status = 'cancelada'
   and p.cancelled_at is null;

update public.bank_transactions t
   set ignored_by = a.user_id, ignored_at = a.occurred_at
  from (
    select distinct on (row_id) row_id, user_id, occurred_at
      from public.audit_changes
     where schema_name = 'public' and table_name = 'bank_transactions' and op = 'U'
       and changes -> 'status' ->> 'depois' = 'ignorado'
     order by row_id, occurred_at desc
  ) a
 where t.id::text = a.row_id
   and t.status = 'ignorado'
   and t.ignored_at is null;

update public.bank_transactions t
   set undone_by = a.user_id, undone_at = a.occurred_at
  from (
    select distinct on (row_id) row_id, user_id, occurred_at
      from public.audit_changes
     where schema_name = 'public' and table_name = 'bank_transactions' and op = 'U'
       and changes -> 'status' ->> 'depois' = 'pendente'
       and changes -> 'status' ->> 'antes' in ('conciliado', 'ignorado')
     order by row_id, occurred_at desc
  ) a
 where t.id::text = a.row_id
   and t.undone_at is null;

-- -----------------------------------------------------------------------------
-- 6) QUEM REABRIU O MÊS (o retorno muda: drop antes)
-- -----------------------------------------------------------------------------
drop function if exists public.fiscal_year_status(uuid, integer);

create or replace function public.fiscal_year_status(
  p_clinic_id uuid,
  p_year integer
)
returns table (
  month integer,
  status text,
  closed_at timestamptz,
  closed_by_name text,
  reopened_at timestamptz,
  reopen_reason text,
  entries integer,
  reopened_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.month,
    coalesce(p.status, 'open'),
    p.closed_at,
    prof.full_name,
    p.reopened_at,
    p.reopen_reason,
    (select count(*) from public.financial_entries e
      where e.clinic_id = p_clinic_id
        and extract(year from e.accrual_date)::integer = p_year
        and extract(month from e.accrual_date)::integer = m.month
        and e.status in ('settled', 'open'))::integer,
    reo.full_name
  from (select generate_series(1, 12) as month) m
  left join public.fiscal_periods p
    on p.clinic_id = p_clinic_id and p.year = p_year and p.month = m.month
  left join public.profiles prof on prof.id = p.closed_by
  left join public.profiles reo on reo.id = p.reopened_by
  where public.can_see_clinic_finance(p_clinic_id)
  order by m.month;
$$;

revoke execute on function public.fiscal_year_status(uuid, integer) from public, anon, authenticated;
grant execute on function public.fiscal_year_status(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) DETALHE DA DRE: quem lançou e quando (o retorno muda: drop antes)
-- -----------------------------------------------------------------------------
drop function if exists public.dre_entries(uuid, date, date, text, uuid);

create or replace function public.dre_entries(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_account_code text,
  p_cost_center_id uuid default null
)
returns table (
  entry_id uuid,
  accrual_date date,
  amount_cents bigint,
  direction text,
  status text,
  source_type text,
  source_id uuid,
  description text,
  cost_center_name text,
  created_at timestamptz,
  created_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id, e.accrual_date,
    case when e.direction = 'inflow'
         then e.amount_cents else -e.amount_cents end,
    e.direction, e.status, e.source_type, e.source_id, e.description,
    c.name,
    e.created_at,
    pr.full_name
  from public.financial_entries e
  left join public.cost_centers c on c.id = e.cost_center_id
  left join public.profiles pr on pr.id = e.created_by
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    and e.account_code = p_account_code
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
    and public.can_see_clinic_finance(p_clinic_id)
  order by e.accrual_date desc, e.created_at desc
  limit 300;
$$;

revoke execute on function public.dre_entries(uuid, date, date, text, uuid) from public, anon, authenticated;
grant execute on function public.dre_entries(uuid, date, date, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) DETALHE DO CAIXA: quem lançou (o retorno muda: drop antes)
-- -----------------------------------------------------------------------------
-- Realizado = quem registrou o movimento; previsto de conta a pagar = quem
-- lançou a conta; previsto de parcela = vazio (nasce da venda, não de um
-- lançamento do Financeiro).
drop function if exists public.cash_flow_detail(uuid, date, date);

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
-- 9) O HISTÓRICO DE UM LANÇAMENTO (a trilha da auditoria, só dele)
-- -----------------------------------------------------------------------------
-- `audit_changes` é só do Admin Master. Esta janela devolve apenas as linhas
-- do lançamento pedido — e só a quem enxerga o Financeiro da unidade dele.
--   'payable'          → a conta + os pagamentos e estornos dela
--   'bank_transaction' → a linha do extrato + os casamentos (inclusive os
--                        desfeitos, que a auditoria guardou ao apagar)
--   'installment'      → a parcela + os recebimentos e estornos dela
create or replace function public.finance_history(p_kind text, p_id uuid)
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
declare
  v_clinic uuid;
begin
  if p_kind = 'payable' then
    select clinic_id into v_clinic from public.payables where payables.id = p_id;
  elsif p_kind = 'bank_transaction' then
    select clinic_id into v_clinic from public.bank_transactions where bank_transactions.id = p_id;
  elsif p_kind = 'installment' then
    select clinic_id into v_clinic from public.payment_installments where payment_installments.id = p_id;
  else
    raise exception 'KIND_UNKNOWN';
  end if;

  if v_clinic is null or not public.can_see_clinic_finance(v_clinic) then
    return;
  end if;

  return query
  select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
         a.table_name, a.op, a.changes
    from public.audit_changes a
    left join public.profiles pr on pr.id = a.user_id
   where a.schema_name = 'public'
     and (
       (p_kind = 'payable' and (
          (a.table_name = 'payables' and a.row_id = p_id::text)
          or (a.table_name = 'payable_payments' and a.row_id in (
                select pp.id::text from public.payable_payments pp where pp.payable_id = p_id))))
       or (p_kind = 'bank_transaction' and (
          (a.table_name = 'bank_transactions' and a.row_id = p_id::text)
          or (a.table_name = 'bank_transaction_matches'
              and a.changes ->> 'transaction_id' = p_id::text)))
       or (p_kind = 'installment' and (
          (a.table_name = 'payment_installments' and a.row_id = p_id::text)
          or (a.table_name = 'payment_receipts' and a.row_id in (
                select r.id::text from public.payment_receipts r where r.installment_id = p_id))))
     )
   order by a.occurred_at desc, a.id desc
   limit 300;
end;
$$;

revoke execute on function public.finance_history(text, uuid) from public, anon, authenticated;
grant execute on function public.finance_history(text, uuid) to authenticated;

-- Nenhuma tabela nova; mantém a regra da 0288 em dia.
select public.audit_attach_all();
