-- =============================================================================
-- 1040 — O EMPRESARIAL NO RAZÃO DA FRANQUEADORA (AP69, etapa 2; 09/11/2026)
--
-- AP69: a cobrança do Risarte Empresarial não entrava no Financeiro. A conta
-- `1.2.02 Risarte Empresarial — adesão e mensalidade` (escopo Franqueadora)
-- já existia; faltava a ligação.
--
-- DECISÕES DO DONO (09/11/2026):
--   • a MENSALIDADE paga entra INTEIRA como receita da Franqueadora (1.2.02);
--   • a parte da RisLife entra como CUSTO COMERCIAL do Programa Empresarial
--     (conta nova 2.5.02), no mesmo mês da receita;
--   • a IMPLANTAÇÃO é 100% da RisLife e fica FORA do razão (paga ou não, ela
--     já aparece na aba de cobranças de cada empresa);
--   • o split com a RisLife vai ser feito pelo ASAAS (sessão própria): quando
--     o pagamento vier com o split retido na fonte, o custo nasce QUITADO; com
--     baixa manual (a Risarte recebeu tudo), o custo vira CONTA A PAGAR à
--     RisLife, vencendo no dia 10 do mês seguinte ao pagamento.
--
-- QUANDO ENTRA: na BAIXA (a cobrança vira PAID), com competência no mês de
-- referência — receita e custo juntos, o "valor pago" da decisão. Antes do
-- pagamento nada entra. Mês de referência já fechado no Financeiro → cai no
-- mês aberto (a mesma regra das taxas da rede: receber nunca é recusado).
--
-- DESFAZER: estorno da baixa, cancelamento ou exclusão da cobrança cancelam
-- a receita e o custo; a conta a pagar à RisLife ainda não paga é cancelada
-- junto (a já paga fica, com a nota — devolver é combinar com a RisLife).
-- Pagar de novo reativa tudo com os valores do novo pagamento.
--
-- A MARCA DO ASAAS: `adhesion_billing.split_at_source` (falso por padrão). A
-- integração do ASAAS liga a marca ANTES (ou junto) da baixa quando o split
-- foi retido; nada mais precisa saber de razão.
--
-- PARA TRÁS: a produção tem 0 cobranças do Empresarial (09/11/2026). O treino
-- ganha os lançamentos das mensalidades já pagas.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A conta do custo e as ligações
-- -----------------------------------------------------------------------------
insert into public.chart_of_accounts
  (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic)
values
  ('2.5.02', 'Comissão RisLife — Programa Empresarial', '2.5', 'expense', 'operational', 'variable', 'franchisor', true)
on conflict (code) do nothing;

alter table empresarial.adhesion_billing
  add column if not exists split_at_source boolean not null default false;

comment on column empresarial.adhesion_billing.split_at_source is
  '1040: o pagamento veio com o split da RisLife retido na fonte (ASAAS). Ligado pela integração; com ele o custo da RisLife nasce quitado. Falso = baixa manual: o custo vira conta a pagar à RisLife.';

alter table public.payables
  add column if not exists empresarial_billing_id uuid;

create unique index if not exists payables_empresarial_billing_unique
  on public.payables (empresarial_billing_id)
  where empresarial_billing_id is not null;

comment on column public.payables.empresarial_billing_id is
  '1040: a cobrança do Empresarial cuja parte da RisLife esta conta paga (baixa manual).';

create unique index if not exists financial_entries_emp_billing_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('emp_billing', 'emp_rislife');

-- -----------------------------------------------------------------------------
-- 2) O lançamento
-- -----------------------------------------------------------------------------
create or replace function empresarial._billing_ledger_undo(p_billing_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payable record;
begin
  update public.financial_entries
     set status = 'cancelled', reversal_reason = p_reason, updated_at = now()
   where source_type in ('emp_billing', 'emp_rislife') and source_id = p_billing_id
     and status <> 'cancelled';

  select id, status into v_payable from public.payables where empresarial_billing_id = p_billing_id;
  if v_payable.id is not null and v_payable.status not in ('paga', 'cancelada') then
    update public.payables
       set status = 'cancelada', cancel_reason = p_reason, updated_at = now()
     where id = v_payable.id;
    update public.financial_entries set status = 'cancelled', updated_at = now()
     where source_type = 'payable_accrual' and source_id = v_payable.id and status <> 'cancelled';
  elsif v_payable.id is not null and v_payable.status = 'paga' then
    update public.payables
       set notes = coalesce(notes || E'\n', '') || 'A cobrança da empresa foi desfeita depois desta conta paga: '
                   || p_reason || ' — devolução a combinar com a RisLife.',
           updated_at = now()
     where id = v_payable.id;
  end if;
end;
$$;
revoke execute on function empresarial._billing_ledger_undo(uuid, text) from public, anon, authenticated;

create or replace function empresarial._billing_ledger_post(p_billing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_franq uuid;
  v_paid date;
  v_accrual date;
  v_empresa text;
  v_mes text;
  v_rislife bigint;
  v_payable uuid;
  v_due date;
begin
  select b.*, coalesce(c.trade_name, c.legal_name) as empresa
    into v_bill
    from empresarial.adhesion_billing b
    join empresarial.companies c on c.id = b.company_id
   where b.id = p_billing_id;
  if v_bill.id is null or v_bill.billing_type <> 'MONTHLY' or v_bill.status <> 'PAID' then
    return;  -- implantação fica fora (100% RisLife); só a mensalidade paga entra
  end if;

  -- A Franqueadora da rede (uma só na produção). Sem ela não há onde lançar.
  select id into v_franq from public.clinics
   where type = 'franchisor' and is_active order by created_at limit 1;
  if v_franq is null then
    raise exception 'FRANCHISOR_NOT_FOUND';
  end if;

  v_paid := coalesce((v_bill.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br());
  v_accrual := date_trunc('month', coalesce(v_bill.reference_month, v_paid))::date;
  -- Mês de referência fechado → o mês aberto (receber nunca é recusado).
  if exists (
    select 1 from public.fiscal_periods p
     where p.clinic_id = v_franq and p.status = 'closed'
       and p.year = extract(year from v_accrual)::integer
       and p.month = extract(month from v_accrual)::integer
  ) then
    v_accrual := date_trunc('month', public.today_br())::date;
  end if;
  v_empresa := left(coalesce(v_bill.empresa, 'empresa'), 120);
  v_mes := to_char(coalesce(v_bill.reference_month, v_accrual), 'MM/YYYY');
  v_rislife := coalesce(v_bill.split_rislife_cents, 0);

  -- Receita: o valor INTEIRO pago pela empresa.
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
    amount_cents, direction, status, source_type, source_id, description
  ) values (
    v_franq, '1.2.02', v_accrual, v_paid, v_bill.due_date,
    v_bill.total_amount_cents, 'inflow', 'settled', 'emp_billing', v_bill.id,
    'Empresarial — ' || v_empresa || ' — mensalidade ' || v_mes
  )
  on conflict (source_type, source_id) where source_type in ('emp_billing', 'emp_rislife')
  do update set accrual_date = excluded.accrual_date, cash_date = excluded.cash_date,
                amount_cents = excluded.amount_cents, status = 'settled',
                reversal_reason = null, updated_at = now();

  if v_rislife <= 0 then
    return;
  end if;

  if v_bill.split_at_source then
    -- Split retido na fonte (ASAAS): o custo nasce quitado no dia do pagamento.
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description
    ) values (
      v_franq, '2.5.02', v_accrual, v_paid, v_paid,
      v_rislife, 'outflow', 'settled', 'emp_rislife', v_bill.id,
      'Comissão RisLife — ' || v_empresa || ' — ' || v_mes || ' (retida no pagamento)'
    )
    on conflict (source_type, source_id) where source_type in ('emp_billing', 'emp_rislife')
    do update set accrual_date = excluded.accrual_date, cash_date = excluded.cash_date,
                  amount_cents = excluded.amount_cents, status = 'settled',
                  reversal_reason = null, updated_at = now();
  else
    -- Baixa manual: a Risarte recebeu tudo e repassa — conta a pagar à RisLife.
    v_due := (date_trunc('month', v_paid) + interval '1 month')::date + 9;
    select id into v_payable from public.payables where empresarial_billing_id = v_bill.id;
    if v_payable is null then
      insert into public.payables (
        clinic_id, account_code, description, accrual_date, due_date, amount_cents,
        status, approval_mode, requires_approval, notes, empresarial_billing_id
      ) values (
        v_franq, '2.5.02',
        'Comissão RisLife — ' || v_empresa || ' — ' || v_mes,
        v_accrual, v_due, v_rislife, 'aberta', 'sem_autorizacao', false,
        'Parte da RisLife na mensalidade do Programa Empresarial (baixa manual; sem split no pagamento).',
        v_bill.id
      ) returning id into v_payable;
    else
      update public.payables
         set amount_cents = v_rislife, accrual_date = v_accrual, due_date = v_due,
             status = case when status = 'cancelada' then 'aberta' else status end,
             cancel_reason = case when status = 'cancelada' then null else cancel_reason end,
             updated_at = now()
       where id = v_payable and status <> 'paga';
      update public.financial_entries set status = 'open', amount_cents = v_rislife, updated_at = now()
       where source_type = 'payable_accrual' and source_id = v_payable and status = 'cancelled';
    end if;
    perform public.post_payable_accrual(v_payable);
  end if;
end;
$$;
revoke execute on function empresarial._billing_ledger_post(uuid) from public, anon, authenticated;

create or replace function empresarial.billing_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform empresarial._billing_ledger_undo(old.id, 'Cobrança excluída');
    return null;
  end if;

  if new.status = 'PAID' and (tg_op = 'INSERT' or old.status <> 'PAID') then
    perform empresarial._billing_ledger_post(new.id);
  elsif tg_op = 'UPDATE' and old.status = 'PAID' and new.status <> 'PAID' then
    perform empresarial._billing_ledger_undo(
      new.id,
      case when new.status = 'CANCELLED' then 'Cobrança cancelada'
           else 'Baixa estornada' || coalesce(': ' || new.reversal_reason, '') end
    );
  elsif tg_op = 'UPDATE' and new.status = 'PAID'
        and (new.split_at_source is distinct from old.split_at_source
             or new.split_rislife_cents is distinct from old.split_rislife_cents
             or new.total_amount_cents is distinct from old.total_amount_cents) then
    -- A integração marcou o split depois da baixa (ou o valor mudou): refaz.
    perform empresarial._billing_ledger_undo(new.id, 'Refeito: forma do split mudou');
    perform empresarial._billing_ledger_post(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function empresarial.billing_ledger() from public, anon, authenticated;

drop trigger if exists adhesion_billing_ledger on empresarial.adhesion_billing;
create trigger adhesion_billing_ledger
  after insert or update or delete on empresarial.adhesion_billing
  for each row execute function empresarial.billing_ledger();

-- As mensalidades já pagas (só no treino: a produção tem zero).
do $$
declare r record;
begin
  for r in
    select b.id from empresarial.adhesion_billing b
     where b.status = 'PAID' and b.billing_type = 'MONTHLY'
       and not exists (select 1 from public.financial_entries e
                        where e.source_type = 'emp_billing' and e.source_id = b.id)
  loop
    perform empresarial._billing_ledger_post(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Conferência (só leitura): esperado 1 · 1 · 1 · true · true
select
  (select count(*) from public.chart_of_accounts where code = '2.5.02') as conta_2_5_02,
  (select count(*) from information_schema.columns
    where table_schema = 'empresarial' and table_name = 'adhesion_billing'
      and column_name = 'split_at_source') as marca_do_asaas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'payables'
      and column_name = 'empresarial_billing_id') as ligacao_da_conta,
  exists (select 1 from pg_trigger where tgname = 'adhesion_billing_ledger') as gatilho,
  not has_function_privilege('anon', 'empresarial._billing_ledger_post(uuid)', 'execute') as sem_login_fechado;
