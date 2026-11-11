-- =============================================================================
-- 0393 — REPASSE DOS DENTISTAS, ETAPA 4: O PAGAMENTO PELO RELATÓRIO
--
-- Plano e decisões do dono: docs/Financeiro/REPASSE-PLANO.md. Desta etapa
-- (10/11/2026, as seis como recomendado):
--   P1) a conta a pagar nasce por um BOTÃO do Financeiro da Franqueadora (não
--       sozinha a cada aprovação parcial);
--   P2) a competência é o mês do relatório;
--   P3) vencimento no dia 15: liberado até o dia 10 vence no dia 15 do mesmo
--       mês; liberado depois, no dia 15 do mês seguinte;
--   P4) a conta do repasse NÃO passa pela alçada das contas a pagar (o
--       aprovador e o dentista já aprovaram);
--   P5) o "Fechar o mês" antigo sai;
--   P6) o desconto por falha do dentista fica para a etapa 4B.
--
-- COMO FUNCIONA
--   • `payout_report_bill(relatório)` junta as linhas LIBERADAS (`released`)
--     que ainda não foram para uma conta e cria UMA conta a pagar (2.1.01),
--     lançada no resultado pelo mês de competência (`post_payable_accrual` —
--     o fechamento antigo não lançava). Aprovação parcial = mais de uma conta
--     por relatório, cada linha em uma só.
--   • O pagamento continua em Contas a pagar. "Pago" NÃO é uma marca copiada:
--     é lido da própria conta a pagar (estornou o pagamento, deixa de estar
--     pago — não há duas verdades).
--   • Cancelar a conta (só sem baixa, regra que já existia) devolve as linhas
--     para "liberada", para uma conta nova.
--
-- AS TRAVAS
--   • `payout_report_items.payment_id`: a linha em uma conta não muda de
--     valor, não sai do relatório e não entra em outra conta
--     (`payout_report_items_payment_lock`);
--   • só entra em conta a linha liberada, incluída e ativa, e em conta do
--     MESMO relatório;
--   • a linha continua `active` → o índice `payout_report_items_one_active`
--     (0390) segue impedindo o procedimento de entrar em outro relatório;
--   • `payout_payments` não se apaga nem muda de valor; só passa de ativa a
--     cancelada.
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONTA DO REPASSE (a ligação relatório ↔ conta a pagar)
-- -----------------------------------------------------------------------------
create table if not exists public.payout_payments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.payout_reports (id) on delete restrict,
  clinic_id uuid not null references public.clinics (id),
  provider_id uuid not null references public.profiles (id),
  payable_id uuid not null references public.payables (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  item_count integer not null check (item_count > 0),
  accrual_date date not null,
  due_date date not null,
  status text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text,
  constraint payout_payments_payable_unique unique (payable_id)
);

create index if not exists payout_payments_report_idx
  on public.payout_payments (report_id);
create index if not exists payout_payments_clinic_idx
  on public.payout_payments (clinic_id, created_at);

comment on table public.payout_payments is
  'Conta a pagar gerada de um relatório de repasse (0393). Uma por geração; as linhas do relatório apontam para ela em payout_report_items.payment_id.';

alter table public.payout_payments enable row level security;

drop policy if exists "payout_payments_select" on public.payout_payments;
create policy "payout_payments_select" on public.payout_payments
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));
-- Sem regra de escrita: só as funções gravam.

alter table public.payout_report_items
  add column if not exists payment_id uuid references public.payout_payments (id);

create index if not exists payout_report_items_payment_idx
  on public.payout_report_items (payment_id) where payment_id is not null;

comment on column public.payout_report_items.payment_id is
  'A conta do repasse em que esta linha está (0393). Preenchida, a linha não muda mais. Nula = ainda não foi para uma conta.';

-- -----------------------------------------------------------------------------
-- 2) TRAVAS
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_items_payment_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.payment_id is not null then raise exception 'ITEM_IN_PAYMENT'; end if;
    return old;
  end if;

  if old.payment_id is not null then
    if new.payment_id is distinct from old.payment_id then
      -- Só sai da conta quando a conta foi cancelada; nunca troca de conta.
      if new.payment_id is not null or not exists (
        select 1 from public.payout_payments p
         where p.id = old.payment_id and p.status = 'cancelada'
      ) then
        raise exception 'ITEM_IN_PAYMENT';
      end if;
    end if;
    if new.amount_cents is distinct from old.amount_cents
       or new.status is distinct from old.status
       or new.active is distinct from old.active
       or new.released is distinct from old.released
       or new.payout_id is distinct from old.payout_id
       or new.report_id is distinct from old.report_id then
      raise exception 'ITEM_IN_PAYMENT';
    end if;
  elsif new.payment_id is not null then
    if not (coalesce(new.released, false) and new.status = 'incluido' and new.active) then
      raise exception 'ITEM_NOT_RELEASED';
    end if;
    if not exists (
      select 1 from public.payout_payments p
       where p.id = new.payment_id and p.report_id = new.report_id and p.status = 'ativa'
    ) then
      raise exception 'INVALID_PAYMENT';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.payout_report_items_payment_lock() from public, anon, authenticated;

drop trigger if exists payout_report_items_payment_lock on public.payout_report_items;
create trigger payout_report_items_payment_lock
  before update or delete on public.payout_report_items
  for each row execute function public.payout_report_items_payment_lock();

create or replace function public.payout_payments_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'PAYMENT_LOCKED'; end if;
  if new.report_id is distinct from old.report_id
     or new.payable_id is distinct from old.payable_id
     or new.provider_id is distinct from old.provider_id
     or new.clinic_id is distinct from old.clinic_id
     or new.amount_cents is distinct from old.amount_cents
     or new.item_count is distinct from old.item_count
     or (old.status = 'cancelada' and new.status is distinct from old.status) then
    raise exception 'PAYMENT_LOCKED';
  end if;
  return new;
end;
$$;
revoke execute on function public.payout_payments_lock() from public, anon, authenticated;

drop trigger if exists payout_payments_lock on public.payout_payments;
create trigger payout_payments_lock
  before update or delete on public.payout_payments
  for each row execute function public.payout_payments_lock();

-- -----------------------------------------------------------------------------
-- 3) O VENCIMENTO (P3): dia 15, com corte no dia 10
-- -----------------------------------------------------------------------------
create or replace function public._payout_due_date(p_released date, p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select greatest(
    case when extract(day from p_released) <= 10
         then (date_trunc('month', p_released))::date + 14
         else (date_trunc('month', p_released) + interval '1 month')::date + 14
    end,
    -- Conta gerada depois do dia 15 que valia: vence no dia em que nasce.
    p_today);
$$;
revoke execute on function public._payout_due_date(date, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) GERAR A CONTA A PAGAR de um relatório
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_bill(p_report_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_today date := public.today_br();
  v_ids uuid[];
  v_total bigint;
  v_count integer;
  v_released date;
  v_due date;
  v_accrual date;
  v_name text;
  v_payable uuid;
  v_payment uuid;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Quem recebe não gera a própria conta.
  if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_r.status not in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado') then
    raise exception 'WRONG_STAGE';
  end if;

  select array_agg(x.id), coalesce(sum(x.amount_cents), 0)::bigint, count(*)::integer,
         max((x.released_at at time zone 'America/Sao_Paulo')::date)
    into v_ids, v_total, v_count, v_released
    from (
      select i.id, i.amount_cents, i.released_at
        from public.payout_report_items i
       where i.report_id = p_report_id
         and i.status = 'incluido' and i.active and i.released
         and i.payment_id is null
       for update
    ) x;

  if coalesce(v_count, 0) = 0 then raise exception 'NOTHING_TO_BILL'; end if;
  -- Conta a pagar é sempre positiva. (Saldo negativo só existirá com o
  -- desconto da etapa 4B, que o leva para o relatório seguinte.)
  if v_total <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  v_due := public._payout_due_date(coalesce(v_released, v_today), v_today);

  -- P2: competência = mês do relatório. Mês já fechado na contabilidade não
  -- recebe lançamento: a conta entra na data de hoje.
  v_accrual := v_r.period_month;
  if exists (
    select 1 from public.fiscal_periods fp
     where fp.clinic_id = v_r.clinic_id and fp.status = 'closed'
       and fp.year = extract(year from v_accrual)::integer
       and fp.month = extract(month from v_accrual)::integer
  ) then
    v_accrual := v_today;
  end if;

  select full_name into v_name from public.profiles where id = v_r.provider_id;

  -- P4: nasce aberta, sem alçada — o aprovador e o dentista já aprovaram.
  insert into public.payables
    (clinic_id, account_code, description, reference, accrual_date, due_date,
     amount_cents, status, approval_mode, requires_approval, notes, created_by)
  values (
    v_r.clinic_id, '2.1.01',
    'Repasse — ' || coalesce(v_name, 'profissional') || ' · ' || v_r.code
      || ' · ' || to_char(v_r.period_month, 'MM/YYYY'),
    v_r.code, v_accrual, v_due, v_total, 'aberta', 'automatica', false,
    'Gerada do relatório de repasse ' || v_r.code || ' (' || v_count
      || ' procedimento(s)). Aprovada pelo aprovador da unidade e pelo dentista.',
    v_user)
  returning id into v_payable;

  -- A despesa entra no resultado pelo mês de competência.
  perform public.post_payable_accrual(v_payable);

  insert into public.payout_payments
    (report_id, clinic_id, provider_id, payable_id, amount_cents, item_count,
     accrual_date, due_date, created_by)
  values (p_report_id, v_r.clinic_id, v_r.provider_id, v_payable, v_total, v_count,
          v_accrual, v_due, v_user)
  returning id into v_payment;

  update public.payout_report_items set payment_id = v_payment
   where id = any (v_ids);

  perform public._payout_report_event(p_report_id, null, v_r.clinic_id, 'conta_gerada',
    v_count || ' procedimento(s), ' || public.brl(v_total) || ', vence em '
      || to_char(v_due, 'DD/MM/YYYY'));
  perform public._payout_report_notify(
    array[v_r.provider_id], v_r.clinic_id,
    'Pagamento do repasse programado — ' || v_r.code,
    public.brl(v_total) || ' com pagamento previsto para ' || to_char(v_due, 'DD/MM/YYYY') || '.',
    '/repasses/' || p_report_id);

  return v_payment;
end;
$$;
revoke execute on function public.payout_report_bill(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_bill(uuid) to authenticated;

-- Todos os relatórios da unidade que têm algo liberado e ainda sem conta.
create or replace function public.payout_reports_bill_all(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  if p_clinic_id is null then raise exception 'NOT_FOUND'; end if;

  for r in
    select pr.id
      from public.payout_reports pr
     where pr.clinic_id = p_clinic_id
       and pr.status in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado')
       and pr.provider_id is distinct from (select auth.uid())
       and (select coalesce(sum(i.amount_cents), 0)
              from public.payout_report_items i
             where i.report_id = pr.id and i.status = 'incluido' and i.active
               and i.released and i.payment_id is null) > 0
     order by pr.created_at
  loop
    perform public.payout_report_bill(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.payout_reports_bill_all(uuid) from public, anon, authenticated;
grant execute on function public.payout_reports_bill_all(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A CONTA A PAGAR MUDA → o relatório acompanha
--    cancelada → as linhas voltam para "liberada" (conta nova depois);
--    paga      → registro na linha do tempo e aviso ao dentista;
--    estorno   → registro na linha do tempo.
-- -----------------------------------------------------------------------------
create or replace function public.payables_payout_payment_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pp public.payout_payments%rowtype;
  v_code text;
begin
  select * into v_pp from public.payout_payments
   where payable_id = new.id and status = 'ativa';
  if not found then return null; end if;
  select code into v_code from public.payout_reports where id = v_pp.report_id;

  if new.status in ('cancelada', 'recusada') then
    update public.payout_payments
       set status = 'cancelada', cancelled_by = (select auth.uid()),
           cancelled_at = now(), cancel_reason = new.cancel_reason
     where id = v_pp.id;
    update public.payout_report_items set payment_id = null
     where payment_id = v_pp.id;
    perform public._payout_report_event(v_pp.report_id, null, v_pp.clinic_id, 'conta_cancelada',
      public.brl(v_pp.amount_cents) || coalesce(' — ' || new.cancel_reason, ''));
    perform public._payout_report_notify(
      array(select public._payout_finance_users()), v_pp.clinic_id,
      'Conta do repasse cancelada — ' || v_code,
      'Os procedimentos voltaram para "liberado": gere uma conta nova no relatório.',
      '/financeiro/repasses/relatorios/' || v_pp.report_id);

  elsif new.status = 'paga' and old.status is distinct from 'paga' then
    perform public._payout_report_event(v_pp.report_id, null, v_pp.clinic_id, 'pago',
      public.brl(v_pp.amount_cents));
    perform public._payout_report_notify(
      array[v_pp.provider_id], v_pp.clinic_id,
      'Repasse pago — ' || v_code,
      'O pagamento de ' || public.brl(v_pp.amount_cents) || ' foi registrado.',
      '/repasses/' || v_pp.report_id);

  elsif old.status = 'paga' and new.status in ('aberta', 'parcial') then
    perform public._payout_report_event(v_pp.report_id, null, v_pp.clinic_id, 'pagamento_estornado',
      public.brl(v_pp.amount_cents));
  end if;
  return null;
end;
$$;
revoke execute on function public.payables_payout_payment_sync() from public, anon, authenticated;

drop trigger if exists payables_payout_payment_sync on public.payables;
create trigger payables_payout_payment_sync
  after update on public.payables
  for each row
  when (old.status is distinct from new.status)
  execute function public.payables_payout_payment_sync();

-- -----------------------------------------------------------------------------
-- 6) LEITURAS
-- -----------------------------------------------------------------------------
-- Quem lê o pagamento de um relatório: quem já lê o relatório, ou o dentista
-- dele (depois que o aprovador enviou).
create or replace function public._payout_report_can_read_payment(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._payout_report_can_read(p_report_id)
      or exists (
        select 1 from public.payout_reports r
         where r.id = p_report_id
           and r.provider_id = (select auth.uid())
           and r.status in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado'));
$$;
revoke execute on function public._payout_report_can_read_payment(uuid) from public, anon, authenticated;

-- 6a) As contas de um relatório. `state`: programado | parcial | pago | cancelado.
--     O dentista não vê as canceladas nem o nome de quem gerou.
drop function if exists public.payout_report_payments(uuid);
create function public.payout_report_payments(p_report_id uuid)
returns table (
  payment_id uuid,
  payable_id uuid,
  amount_cents bigint,
  item_count integer,
  accrual_date date,
  due_date date,
  state text,
  paid_cents bigint,
  paid_on date,
  created_at timestamptz,
  created_by_name text,
  cancel_reason text,
  item_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_internal boolean := public._payout_report_can_read(p_report_id);
begin
  if not public._payout_report_can_read_payment(p_report_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select pp.id, pp.payable_id, pp.amount_cents, pp.item_count, pp.accrual_date,
         pa.due_date,
         case when pp.status = 'cancelada' then 'cancelado'
              when pa.status = 'paga' then 'pago'
              when pa.status = 'parcial' then 'parcial'
              else 'programado' end::text,
         coalesce(pa.paid_amount_cents, 0)::bigint,
         case when pa.status = 'paga' then (
           select max(x.paid_at) from public.payable_payments x
            where x.payable_id = pa.id and not x.reversed and x.reversal_of is null)
         end,
         pp.created_at,
         case when v_internal then cb.full_name end,
         case when v_internal then pp.cancel_reason end,
         coalesce(array(select i.id from public.payout_report_items i
                         where i.payment_id = pp.id), array[]::uuid[])
    from public.payout_payments pp
    join public.payables pa on pa.id = pp.payable_id
    left join public.profiles cb on cb.id = pp.created_by
   where pp.report_id = p_report_id
     and (v_internal or pp.status = 'ativa')
   order by pp.created_at;
end;
$$;
revoke execute on function public.payout_report_payments(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_payments(uuid) to authenticated;

-- 6b) O resumo do pagamento de vários relatórios (as listas).
drop function if exists public.payout_report_billing(uuid[]);
create function public.payout_report_billing(p_report_ids uuid[])
returns table (
  report_id uuid,
  to_bill_cents bigint,
  to_bill_count integer,
  scheduled_cents bigint,
  paid_cents bigint,
  next_due date,
  last_paid_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then return; end if;
  return query
  select r.id,
         coalesce((select sum(i.amount_cents) from public.payout_report_items i
                    where i.report_id = r.id and i.status = 'incluido' and i.active
                      and i.released and i.payment_id is null), 0)::bigint,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'incluido' and i.active
             and i.released and i.payment_id is null)::integer,
         coalesce((select sum(pp.amount_cents) from public.payout_payments pp
                     join public.payables pa on pa.id = pp.payable_id
                    where pp.report_id = r.id and pp.status = 'ativa'
                      and pa.status <> 'paga'), 0)::bigint,
         coalesce((select sum(pp.amount_cents) from public.payout_payments pp
                     join public.payables pa on pa.id = pp.payable_id
                    where pp.report_id = r.id and pp.status = 'ativa'
                      and pa.status = 'paga'), 0)::bigint,
         (select min(pa.due_date) from public.payout_payments pp
            join public.payables pa on pa.id = pp.payable_id
           where pp.report_id = r.id and pp.status = 'ativa' and pa.status <> 'paga'),
         (select max(x.paid_at) from public.payout_payments pp
            join public.payables pa on pa.id = pp.payable_id and pa.status = 'paga'
            join public.payable_payments x on x.payable_id = pa.id
                 and not x.reversed and x.reversal_of is null
           where pp.report_id = r.id and pp.status = 'ativa')
    from public.payout_reports r
   where r.id = any (coalesce(p_report_ids, array[]::uuid[]))
     and public._payout_report_can_read_payment(r.id);
end;
$$;
revoke execute on function public.payout_report_billing(uuid[]) from public, anon, authenticated;
grant execute on function public.payout_report_billing(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O "FECHAR O MÊS" ANTIGO SAI (P5)
--    Os meses já fechados por ele continuam como estão. A função fica só para
--    recusar com um motivo claro (o código antigo ainda pode chamá-la entre a
--    migração e a publicação).
-- -----------------------------------------------------------------------------
create or replace function public.close_payout_month(
  p_clinic_id uuid,
  p_month date,
  p_bonus_percent numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'PAYOUT_CLOSING_RETIRED';
end;
$$;
revoke execute on function public.close_payout_month(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.close_payout_month(uuid, date, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) Auditoria
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- Conferência (só leitura) ------------------------------------------------------
-- Esperado: tabela = 1 · coluna_da_linha = 1 · travas = 3 · funcoes = 4 ·
-- regras_de_escrita = 0 · fechar_o_mes_aposentado = true · contas_do_repasse = 0
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'payout_payments') as tabela,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'payout_report_items'
      and column_name = 'payment_id') as coluna_da_linha,
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgname in ('payout_report_items_payment_lock', 'payout_payments_lock',
                     'payables_payout_payment_sync')) as travas,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('payout_report_bill', 'payout_reports_bill_all',
                      'payout_report_payments', 'payout_report_billing')) as funcoes,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'payout_payments'
      and cmd <> 'SELECT') as regras_de_escrita,
  (select prosrc ilike '%PAYOUT_CLOSING_RETIRED%' from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'close_payout_month') as fechar_o_mes_aposentado,
  (select count(*) from public.payout_payments) as contas_do_repasse;
