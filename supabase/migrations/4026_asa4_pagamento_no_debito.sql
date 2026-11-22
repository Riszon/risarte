-- 4026 — O PAGAMENTO NO CARTÃO DE DÉBITO (Asaas 0.26.0; aprovada pelo dono em 21/11/2026, opções 1 + 3)
--
-- A fatura de uma cobrança de cartão oferece o débito quando a conta tem o
-- débito habilitado. O split vai na emissão, calculado pela tarifa do CRÉDITO
-- (Método B); pago no débito, a tarifa é menor e o mesmo percentual repassa à
-- rede MAIS do que o devido (R$ 0,86 numa cobrança de R$ 1.000,00), contra a
-- unidade. A regra aprovada é o contrário: centavos, sempre a favor da unidade.
--
-- O que esta migração faz:
--   1. O RECONHECIMENTO: o aviso do Asaas com `billingType = DEBIT_CARD` grava o
--      meio usado (`charges.paid_billing_type`); a baixa usa a tarifa e o prazo
--      do débito (modalidade `debito`, D+3 pelo crédito previsto do aviso).
--   2. A CORREÇÃO NA HORA (opção 1): o pagamento no débito entra numa fila
--      própria (`charge_debit_fixes`). O servidor manda o split novo ao Asaas
--      assim que o aviso chega e tenta de novo a cada 10 minutos, até o Asaas
--      recusar ou o dinheiro cair. O split novo usa as MESMAS taxas da emissão,
--      só com a tarifa do débito.
--   3. A DEVOLUÇÃO (opção 3): se a correção não saiu (recusada, fora do prazo,
--      cobrança antecipada), o que o Asaas repassou a mais é da unidade. Vira
--      CRÉDITO (`split_excess_credits`), fora da receita da franqueadora (e da
--      base da nota dos royalties): no razão, "a receber da franqueadora" na
--      unidade (6.4.01) e "a devolver à unidade" na franqueadora (6.4.02), as
--      duas fora do resultado. Entra na cobrança mensal seguinte; se for maior
--      que a cobrança, o saldo passa para o mês seguinte.
--   4. AS EXCEÇÕES: débito em cobrança parcelada TRAVA (a Conferência das taxas
--      mostra o split a mais e o Financeiro é avisado; nada é corrigido
--      sozinho). Débito na conta da franqueadora (cobrança mensal, Empresarial)
--      só avisa: lá o débito continua desabilitado.
--   5. A PRONTIDÃO: "débito desabilitado" vira "débito conferido" — a unidade
--      escolhe deixar desabilitado ou habilitar.
--
-- Nenhuma chamada ao Asaas sai do banco. Idempotente. Não apaga dado.

-- ---------------------------------------------------------------------------
-- 1) AS COLUNAS E AS TABELAS
-- ---------------------------------------------------------------------------
alter table public.charges add column if not exists paid_billing_type text;
alter table public.charges add column if not exists paid_anticipated boolean;
comment on column public.charges.paid_billing_type is
  '4026: o meio que o pagador usou, quando difere do emitido (hoje só DEBIT_CARD, numa cobrança de cartão).';
comment on column public.charges.paid_anticipated is '4026: o Asaas avisou que o pagamento foi antecipado.';
alter table public.charges add column if not exists paid_debit_signal text;
comment on column public.charges.paid_debit_signal is
  '4026: como o débito foi reconhecido: aviso_e_valor, so_aviso (valor inconclusivo), divergente_valor (só o valor líquido diz débito) ou divergente_aviso (o aviso diz débito e o valor, crédito).';

alter table public.gateway_accounts add column if not exists debit_enabled_declared_at timestamptz;
alter table public.gateway_accounts add column if not exists debit_enabled_declared_by uuid references public.profiles(id);
comment on column public.gateway_accounts.debit_enabled_declared_at is
  '4026: a unidade declarou que HABILITOU o débito no painel do Asaas (a outra escolha é debit_disabled_declared_at).';

create table if not exists public.charge_debit_fixes (
  charge_id uuid primary key references public.charges(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  account_id uuid not null references public.gateway_accounts(id),
  status text not null,
  credit_date date,
  attempts integer not null default 0,
  next_try_at timestamptz,
  last_error text,
  before_entries jsonb,
  after_entries jsonb,
  before_cents bigint,
  after_cents bigint,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.charge_debit_fixes drop constraint if exists charge_debit_fixes_status_check;
alter table public.charge_debit_fixes add constraint charge_debit_fixes_status_check
  check (status in ('pendente', 'corrigido', 'sem_mudanca', 'recusado', 'prazo', 'liquidado_antes',
                    'antecipada', 'parcelado_travado', 'conta_da_franqueadora', 'sem_split', 'divergente'));
comment on table public.charge_debit_fixes is
  '4026: a correção do split de cada pagamento no débito (a fila do servidor e o resultado).';
create index if not exists charge_debit_fixes_pending on public.charge_debit_fixes (next_try_at) where status = 'pendente';
alter table public.charge_debit_fixes enable row level security;
drop policy if exists "charge_debit_fixes_select" on public.charge_debit_fixes;
create policy "charge_debit_fixes_select" on public.charge_debit_fixes for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor()
         or public.has_role_in_clinic(clinic_id, array['unit_manager', 'franchisee']::public.user_role[]));

create table if not exists public.split_excess_credits (
  id uuid primary key default gen_random_uuid(),
  charge_split_id uuid not null unique references public.charge_splits(id),
  charge_id uuid not null references public.charges(id),
  clinic_id uuid not null references public.clinics(id),
  hq_clinic_id uuid references public.clinics(id),
  fee text not null references public.network_fee_types(key),
  amount_cents bigint not null check (amount_cents >= 0),
  used_cents bigint not null default 0 check (used_cents >= 0),
  reason text not null default 'debito_nao_corrigido' check (reason in ('debito_nao_corrigido')),
  status text not null default 'a_devolver' check (status in ('a_devolver', 'creditado', 'cancelado')),
  origin_month date not null,
  settled_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (used_cents <= amount_cents)
);
comment on table public.split_excess_credits is
  '4026: o que o Asaas repassou a mais à rede num pagamento no débito sem a correção do split. É da unidade: crédito na cobrança mensal.';
alter table public.split_excess_credits enable row level security;
drop policy if exists "split_excess_credits_select" on public.split_excess_credits;
create policy "split_excess_credits_select" on public.split_excess_credits for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor()
         or public.has_role_in_clinic(clinic_id, array['unit_manager', 'franchisee']::public.user_role[]));

alter table public.franchise_monthly_items add column if not exists split_excess_credit_id uuid references public.split_excess_credits(id);

-- As contas do razão (fora do resultado: família 6).
insert into public.chart_of_accounts (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic, active) values
  ('6.4', 'Créditos entre a unidade e a franqueadora', '6', 'expense', 'asset', 'none', 'both', false, true),
  ('6.4.01', 'Split a mais a receber da franqueadora', '6.4', 'expense', 'asset', 'none', 'unit', true, true),
  ('6.4.02', 'Split a mais a devolver às unidades', '6.4', 'expense', 'asset', 'none', 'franchisor', true, true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2) O RECONHECIMENTO: pelo aviso E pelo valor líquido
-- ---------------------------------------------------------------------------
-- Duas formas, independentes: (a) o aviso diz `billingType = DEBIT_CARD`;
-- (b) a tarifa cobrada (pago − líquido) bate com a tarifa do débito da conta, e
-- não com a do crédito à vista (tolerância de 1 centavo). Só na cobrança de
-- cartão à vista (no parcelado a tarifa é outra; lá vale só o aviso, e trava).
--   * as duas dizem débito, ou o aviso diz e o valor não decide → débito;
--   * DISCORDAM (só o valor diz débito, ou o aviso diz débito e o valor diz
--     crédito) → marca como débito, mas NÃO corrige sozinho: avisa o
--     Financeiro, e a Conferência das taxas mostra o split a mais.
create or replace function public._gateway_debit_detect(p_charge_id uuid, p_payment jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.charges%rowtype;
  v_paid bigint := round(coalesce((p_payment->>'value')::numeric, 0) * 100);
  v_net bigint := round((p_payment->>'netValue')::numeric * 100);
  v_fee bigint;
  v_deb bigint;
  v_cred bigint;
  v_marca boolean := upper(coalesce(p_payment->>'billingType', '')) = 'DEBIT_CARD';
  v_valor_deb boolean := false;
  v_valor_cred boolean := false;
  v_sinal text;
  v_today date := public.today_br();
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or c.billing_type <> 'CREDIT_CARD' then return null; end if;
  if c.installment_block is null and v_net is not null and v_paid > 0 then
    v_fee := v_paid - v_net;
    select round(r.fee_percent / 100.0 * v_paid + r.fixed_fee_cents)::bigint into v_deb
      from public.acquirer_rates r join public.card_acquirers q on q.id = r.acquirer_id
     where q.gateway_account_id = c.gateway_account_id and r.modality = 'debito'
       and r.valid_from <= v_today and (r.valid_to is null or r.valid_to >= v_today)
     order by r.valid_from desc limit 1;
    select round(r.fee_percent / 100.0 * v_paid + r.fixed_fee_cents)::bigint into v_cred
      from public.acquirer_rates r join public.card_acquirers q on q.id = r.acquirer_id
     where q.gateway_account_id = c.gateway_account_id and r.modality = 'credito_avista' and coalesce(r.min_installments, 1) <= 1
       and r.valid_from <= v_today and (r.valid_to is null or r.valid_to >= v_today)
     order by r.valid_from desc limit 1;
    v_valor_deb := v_deb is not null and abs(v_fee - v_deb) <= 1 and (v_cred is null or abs(v_fee - v_cred) > 1);
    v_valor_cred := v_cred is not null and abs(v_fee - v_cred) <= 1 and (v_deb is null or abs(v_fee - v_deb) > 1);
  end if;
  if not v_marca and not v_valor_deb then return null; end if;
  v_sinal := case
    when v_marca and v_valor_deb then 'aviso_e_valor'
    when v_marca and v_valor_cred then 'divergente_aviso'
    when v_marca then 'so_aviso'
    else 'divergente_valor' end;
  update public.charges set paid_billing_type = 'DEBIT_CARD', paid_debit_signal = v_sinal,
         paid_anticipated = coalesce(paid_anticipated, false) or coalesce((p_payment->>'anticipated')::boolean, false)
   where id = c.id;
  return v_sinal;
end;
$$;
revoke execute on function public._gateway_debit_detect(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b) O PAGAMENTO NO DÉBITO ENTRA NA FILA DA CORREÇÃO (ou numa exceção)
-- ---------------------------------------------------------------------------
create or replace function public._gateway_debit_on_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a public.gateway_accounts%rowtype;
  v_status text;
  v_link text := case when new.client_id is not null then '/prontuarios/' || new.client_id::text end;
begin
  if exists (select 1 from public.charge_debit_fixes where charge_id = new.id) then return new; end if;
  select * into a from public.gateway_accounts where id = new.gateway_account_id;
  v_status := case
    when a.owner_type is distinct from 'unit' then 'conta_da_franqueadora'
    when not coalesce(new.split_applied, false)
      or not exists (select 1 from public.charge_splits s where s.charge_id = new.id) then 'sem_split'
    when new.installment_block is not null then 'parcelado_travado'
    when coalesce(new.paid_debit_signal, '') like 'divergente%' then 'divergente'
    when coalesce(new.paid_anticipated, false) then 'antecipada'
    else 'pendente' end;
  insert into public.charge_debit_fixes (charge_id, clinic_id, account_id, status, credit_date, next_try_at, done_at)
  values (new.id, new.clinic_id, new.gateway_account_id, v_status,
          coalesce(new.credit_date, coalesce(new.paid_on, public.today_br()) + 3),
          case when v_status = 'pendente' then now() end,
          case when v_status <> 'pendente' then now() end)
  on conflict (charge_id) do nothing;

  if v_status = 'conta_da_franqueadora' then
    perform public._gateway_notify(new.gateway_account_id, 'debito_na_franqueadora', new.id::text, new.clinic_id, false, true, true,
      'Pagamento no débito na conta da franqueadora',
      'Uma cobrança da conta da franqueadora foi paga no cartão de débito. Nessa conta o débito deve ficar desabilitado: confira no painel do Asaas (Minha conta › Configurações › Configurações do sistema).',
      v_link);
  elsif v_status = 'divergente' then
    perform public._gateway_notify(new.gateway_account_id, 'debito_divergente', new.id::text, new.clinic_id, false, true, true,
      'Débito sem confirmação: confira o split',
      case when new.paid_debit_signal = 'divergente_valor'
        then 'O valor líquido de um pagamento de cartão bate com a tarifa do DÉBITO, mas o aviso do Asaas não diz débito. O riSZon não corrigiu o split sozinho: confira no Asaas e na Conferência das taxas.'
        else 'O aviso do Asaas diz que um pagamento foi no débito, mas o valor líquido bate com a tarifa do CRÉDITO. O riSZon não corrigiu o split sozinho: confira no Asaas e na Conferência das taxas.' end,
      v_link);
  elsif v_status = 'parcelado_travado' then
    perform public._gateway_notify(new.gateway_account_id, 'debito_no_parcelado', new.id::text, new.clinic_id, true, true, true,
      'Débito numa cobrança parcelada',
      'Uma parcela do cartão parcelado foi paga no cartão de débito. O riSZon não corrige o split sozinho nesse caso: a Conferência das taxas fica aberta até o Financeiro tratar.',
      v_link);
  end if;
  return new;
end;
$$;
revoke execute on function public._gateway_debit_on_paid() from public, anon, authenticated;
drop trigger if exists charges_debit_paid on public.charges;
create trigger charges_debit_paid after update of status, receipt_id on public.charges
  for each row when (new.paid_billing_type = 'DEBIT_CARD' and new.status in ('paga', 'liquidada'))
  execute function public._gateway_debit_on_paid();

-- O plano do split corrigido: as MESMAS carteiras e taxas da emissão, o valor
-- pago e a tarifa do débito (a conta é do servidor, `decidirSplit`).
create or replace function public._gateway_debit_fix_plan(p_charge_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.charges%rowtype;
  v_rates jsonb;
  v_wallets jsonb;
begin
  select * into c from public.charges where id = p_charge_id;
  select coalesce(jsonb_agg(jsonb_build_object('accountId', s.destination_account_id, 'walletId', s.wallet_id,
                                               'percent', s.percent, 'fees', s.fees) order by s.wallet_id), '[]'::jsonb)
    into v_wallets from public.charge_splits s where s.charge_id = c.id and s.status = 'enviado';
  select coalesce(jsonb_agg(jsonb_build_object(
           'modality', r.modality, 'fee_percent', r.fee_percent, 'fixed_fee_cents', r.fixed_fee_cents,
           'valid_from', r.valid_from, 'valid_to', r.valid_to, 'min_installments', r.min_installments,
           'max_installments', r.max_installments)), '[]'::jsonb)
    into v_rates
    from public.acquirer_rates r join public.card_acquirers q on q.id = r.acquirer_id
   where q.gateway_account_id = c.gateway_account_id and r.modality = 'debito';
  if jsonb_array_length(v_wallets) = 0 then return jsonb_build_object('elegivel', false, 'motivo', 'sem_taxa'); end if;
  return jsonb_build_object(
    'elegivel', true, 'carteiras', v_wallets, 'tarifas', v_rates,
    'hoje', coalesce(c.paid_on, public.today_br()), 'vencimento', coalesce(c.paid_on, public.today_br()),
    'valorCents', coalesce(c.paid_cents, c.value_cents), 'descontoCents', 0, 'meio', 'DEBIT_CARD', 'parcelas', 1);
end;
$$;
revoke execute on function public._gateway_debit_fix_plan(uuid) from public, anon, authenticated;

-- A fila (o servidor chama no aviso e a cada 10 minutos). O que passou do
-- prazo, ou cujo split já foi liquidado, sai da fila (o crédito cobre).
create or replace function public._gateway_debit_fix_queue(p_account_id uuid default null, p_limit integer default 20)
returns table (charge_id uuid, account_id uuid, asaas_payment_id text, plan jsonb, current_entries jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  update public.charge_debit_fixes f set status = 'liquidado_antes', done_at = now(), next_try_at = null
   where f.status = 'pendente'
     and exists (select 1 from public.charge_splits s where s.charge_id = f.charge_id and s.status <> 'enviado');
  update public.charge_debit_fixes f set status = 'prazo', done_at = now(), next_try_at = null
   where f.status = 'pendente' and f.credit_date is not null and public.today_br() >= f.credit_date;

  return query
    select f.charge_id, f.account_id, c.asaas_payment_id, public._gateway_debit_fix_plan(f.charge_id),
           (select coalesce(jsonb_agg(jsonb_build_object('walletId', s.wallet_id, 'percentualValue', s.percentual_value,
                                                         'fixedCents', s.fixed_cents)), '[]'::jsonb)
              from public.charge_splits s where s.charge_id = f.charge_id)
      from public.charge_debit_fixes f join public.charges c on c.id = f.charge_id
     where f.status = 'pendente' and coalesce(f.next_try_at, now()) <= now()
       and c.asaas_payment_id is not null
       and (p_account_id is null or f.account_id = p_account_id)
     order by f.created_at
     limit greatest(coalesce(p_limit, 20), 1);
end;
$$;
revoke execute on function public._gateway_debit_fix_queue(uuid, integer) from public, anon, authenticated;

-- O resultado: 'corrigido' (o Asaas aceitou o split novo), 'sem_mudanca' (já
-- estava certo), 'recusado' (o Asaas recusou: o crédito cobre) ou erro de
-- passagem (tenta de novo em 10 minutos).
create or replace function public._gateway_debit_fix_done(p_charge_id uuid, p_outcome text, p_entries jsonb,
                                                          p_detail jsonb, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f public.charge_debit_fixes%rowtype;
  v_before jsonb;
  x jsonb;
begin
  select * into f from public.charge_debit_fixes where charge_id = p_charge_id for update;
  if not found or f.status <> 'pendente' then return; end if;
  if p_outcome not in ('corrigido', 'sem_mudanca', 'recusado', 'erro') then raise exception 'INVALID_OUTCOME'; end if;

  if p_outcome = 'erro' then
    update public.charge_debit_fixes set attempts = attempts + 1, last_error = left(p_error, 200),
           next_try_at = now() + interval '10 minutes'
     where charge_id = f.charge_id;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('walletId', s.wallet_id, 'percentualValue', s.percentual_value,
                                               'fixedCents', s.fixed_cents) order by s.wallet_id), '[]'::jsonb)
    into v_before from public.charge_splits s where s.charge_id = f.charge_id;

  if p_outcome = 'corrigido' then
    for x in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
      update public.charge_splits s set
        percentual_value = (x->>'percentualValue')::numeric, fixed_cents = (x->>'fixedCents')::bigint,
        tariff_percent = (x->>'tariffPercent')::numeric, tariff_fixed_cents = (x->>'tariffFixedCents')::bigint,
        asaas_split_id = coalesce(nullif(x->>'asaasSplitId', ''), s.asaas_split_id), updated_at = now()
       where s.charge_id = f.charge_id and s.wallet_id = x->>'walletId' and s.status = 'enviado';
    end loop;
    insert into public.charge_split_updates (charge_id, reasons, outcome, before_entries, after_entries, actor)
    values (f.charge_id, array['pago_no_debito'], 'atualizado', v_before, p_entries, null);
  end if;

  update public.charge_debit_fixes set
    status = p_outcome, attempts = attempts + 1, last_error = case when p_outcome = 'recusado' then left(p_error, 200) end,
    before_entries = v_before, after_entries = case when p_outcome = 'corrigido' then p_entries end,
    before_cents = nullif(p_detail->>'antesCents', '')::bigint, after_cents = nullif(p_detail->>'depoisCents', '')::bigint,
    next_try_at = null, done_at = now()
   where charge_id = f.charge_id;

  if p_outcome = 'recusado' then
    perform public._gateway_notify(f.account_id, 'debito_correcao_recusada', f.charge_id::text, f.clinic_id, false, true, false,
      'Split do débito não corrigido',
      'O Asaas recusou a correção do split de um pagamento no cartão de débito. O que for repassado a mais à rede volta para a unidade como crédito na cobrança mensal seguinte.',
      null);
  end if;
end;
$$;
revoke execute on function public._gateway_debit_fix_done(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) O CRÉDITO DA UNIDADE (quando a correção não saiu)
-- ---------------------------------------------------------------------------
-- O razão do crédito: a unidade tem a receber, a franqueadora tem a devolver.
-- Fora do resultado (família 6): não é receita da rede nem despesa da unidade.
create or replace function public._split_excess_ledger(p_credit_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.split_excess_credits%rowtype;
  c public.charges%rowtype;
  v_status text;
  v_dest uuid;
  v_bank_hq uuid;
  v_label text;
begin
  select * into x from public.split_excess_credits where id = p_credit_id;
  if not found then return; end if;
  select * into c from public.charges where id = x.charge_id;
  v_status := case when x.status = 'cancelado' or x.amount_cents <= 0 then 'cancelled' else 'settled' end;
  v_label := 'Split a mais no débito (crédito da unidade) — ' || to_char(coalesce(x.settled_on, x.origin_month), 'DD/MM/YYYY');
  select s.destination_account_id into v_dest from public.charge_splits s where s.id = x.charge_split_id;
  select b.id into v_bank_hq from public.bank_accounts b
   where b.id = public._gateway_bank_account(v_dest) and b.clinic_id = x.hq_clinic_id;

  update public.financial_entries set amount_cents = greatest(x.amount_cents, 1), status = v_status,
         cash_date = case when v_status = 'settled' then x.settled_on end, updated_at = now()
   where source_type = 'split_excess_unit' and source_id = x.id;
  if not found and v_status = 'settled' then
    insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, bank_account_id)
    values (x.clinic_id, '6.4.01', coalesce(x.settled_on, x.origin_month), x.settled_on, x.settled_on,
      x.amount_cents, 'outflow', 'settled', 'split_excess_unit', x.id, v_label, public._gateway_bank_account(c.gateway_account_id));
  end if;
  if x.hq_clinic_id is not null and x.hq_clinic_id <> x.clinic_id then
    update public.financial_entries set amount_cents = greatest(x.amount_cents, 1), status = v_status,
           cash_date = case when v_status = 'settled' then x.settled_on end, updated_at = now()
     where source_type = 'split_excess_hq' and source_id = x.id;
    if not found and v_status = 'settled' then
      insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
        amount_cents, direction, status, source_type, source_id, description, bank_account_id)
      values (x.hq_clinic_id, '6.4.02', coalesce(x.settled_on, x.origin_month), x.settled_on, x.settled_on,
        x.amount_cents, 'inflow', 'settled', 'split_excess_hq', x.id, v_label, v_bank_hq);
    end if;
  end if;
end;
$$;
revoke execute on function public._split_excess_ledger(uuid) from public, anon, authenticated;

-- A marca do split a mais (4018a) muda → o crédito acompanha.
create or replace function public._gateway_debit_excess_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.charges%rowtype;
  f public.charge_debit_fixes%rowtype;
  x public.split_excess_credits%rowtype;
  v_amt bigint;
  v_fee text;
  v_on date;
begin
  select * into c from public.charges where id = new.charge_id;
  if c.paid_billing_type is distinct from 'DEBIT_CARD' then return new; end if;
  select * into f from public.charge_debit_fixes where charge_id = c.id;
  if f.charge_id is null or f.status in ('parcelado_travado', 'conta_da_franqueadora', 'sem_split', 'divergente') then return new; end if;
  if f.status = 'pendente' and new.status <> 'enviado' then
    update public.charge_debit_fixes set status = 'liquidado_antes', done_at = now(), next_try_at = null where charge_id = c.id;
  end if;

  v_amt := case when new.status = 'liquidado' then greatest(coalesce(new.excess_cents, 0), 0) else 0 end;
  v_on := (coalesce(new.settled_at, now()) at time zone 'America/Sao_Paulo')::date;
  select * into x from public.split_excess_credits where charge_split_id = new.id for update;

  if v_amt > 0 then
    if x.id is null then
      select t.key into v_fee from public.network_fee_types t where new.fees ? t.key order by t.sort_order, t.key limit 1;
      insert into public.split_excess_credits (charge_split_id, charge_id, clinic_id, hq_clinic_id, fee, amount_cents,
                                               origin_month, settled_on)
      values (new.id, c.id, c.clinic_id, public._franchise_hq(), coalesce(v_fee, 'royalty'), v_amt,
              date_trunc('month', coalesce(c.paid_on, v_on))::date, v_on)
      returning * into x;
      perform public._gateway_notify(c.gateway_account_id, 'credito_split_debito', x.id::text, c.clinic_id, true, true, false,
        'Crédito para a unidade: split a mais no débito',
        'Num pagamento no cartão de débito, o Asaas repassou à rede ' || to_char(v_amt / 100.0, 'FM999G999G990D00')
        || ' acima do devido. O valor é da unidade e entra como crédito na cobrança mensal seguinte.',
        null);
    elsif x.used_cents = 0 and x.status in ('a_devolver', 'cancelado') and (x.amount_cents <> v_amt or x.status = 'cancelado') then
      update public.split_excess_credits set amount_cents = v_amt, status = 'a_devolver', settled_on = v_on, updated_at = now()
       where id = x.id;
    end if;
    perform public._split_excess_ledger(x.id);
  elsif x.id is not null and x.status = 'a_devolver' and x.used_cents = 0 then
    update public.split_excess_credits set status = 'cancelado', updated_at = now() where id = x.id;
    perform public._split_excess_ledger(x.id);
  end if;
  return new;
end;
$$;
revoke execute on function public._gateway_debit_excess_sync() from public, anon, authenticated;
drop trigger if exists charge_splits_debit_excess on public.charge_splits;
create trigger charge_splits_debit_excess after update of status, excess_cents on public.charge_splits
  for each row execute function public._gateway_debit_excess_sync();

-- A baixa da cobrança mensal: a parte de uma conta de taxa paga com o crédito.
-- A unidade paga a taxa (despesa) e a franqueadora recebe (receita), sem caixa:
-- o dinheiro já tinha ido no split.
create or replace function public._split_excess_pay_payable(p_batch_id uuid, p_payable_id uuid, p_amount bigint, p_paid_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.payables%rowtype;
  v_hq uuid := public._franchise_hq();
  v_id uuid := md5('split-excess-comp:' || p_batch_id::text || ':' || p_payable_id::text)::uuid;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  select * into p from public.payables where id = p_payable_id;
  insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
    source_type, source_id, description)
  select p.clinic_id, p.account_code, p.accrual_date, p_paid_on, p_amount, 'outflow', 'settled', 'split_excess_comp_unit', v_id,
         'Pagamento com o crédito do split a mais no débito — ' || p.description
   where not exists (select 1 from public.financial_entries f where f.source_type = 'split_excess_comp_unit' and f.source_id = v_id);
  if v_hq is not null and v_hq <> p.clinic_id then
    insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
      source_type, source_id, description)
    select v_hq, (select a.franchisor_account from public.network_fee_accounts(p.network_fee) a), p.accrual_date, p_paid_on,
           p_amount, 'inflow', 'settled', 'split_excess_comp_hq', v_id,
           'Recebimento com o crédito do split a mais no débito — ' || p.description
     where not exists (select 1 from public.financial_entries f where f.source_type = 'split_excess_comp_hq' and f.source_id = v_id);
  end if;
end;
$$;
revoke execute on function public._split_excess_pay_payable(uuid, uuid, bigint, date) from public, anon, authenticated;

-- O crédito usado, na ordem em que nasceu: sai do "a receber" da unidade e do
-- "a devolver" da franqueadora. O que sobrar continua para o mês seguinte.
create or replace function public._split_excess_consume(p_batch_id uuid, p_clinic_id uuid, p_amount bigint, p_paid_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_rest bigint := coalesce(p_amount, 0);
  v_use bigint;
  v_id uuid;
begin
  for r in
    select x.* from public.franchise_monthly_items i join public.split_excess_credits x on x.id = i.split_excess_credit_id
     where i.batch_id = p_batch_id and i.status in ('ativo', 'contestado') and x.amount_cents > x.used_cents
     order by x.created_at for update of x
  loop
    exit when v_rest <= 0;
    v_use := least(v_rest, r.amount_cents - r.used_cents);
    v_rest := v_rest - v_use;
    update public.split_excess_credits set used_cents = used_cents + v_use,
           status = case when used_cents + v_use >= amount_cents then 'creditado' else status end, updated_at = now()
     where id = r.id;
    v_id := md5('split-excess-used:' || p_batch_id::text || ':' || r.id::text)::uuid;
    insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
      source_type, source_id, description)
    select r.clinic_id, '6.4.01', p_paid_on, p_paid_on, v_use, 'inflow', 'settled', 'split_excess_used_unit', v_id,
           'Crédito do split a mais no débito usado na cobrança mensal'
     where not exists (select 1 from public.financial_entries f where f.source_type = 'split_excess_used_unit' and f.source_id = v_id);
    if r.hq_clinic_id is not null and r.hq_clinic_id <> r.clinic_id then
      insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
        source_type, source_id, description)
      select r.hq_clinic_id, '6.4.02', p_paid_on, p_paid_on, v_use, 'outflow', 'settled', 'split_excess_used_hq', v_id,
             'Crédito do split a mais no débito devolvido na cobrança mensal'
       where not exists (select 1 from public.financial_entries f where f.source_type = 'split_excess_used_hq' and f.source_id = v_id);
    end if;
  end loop;
end;
$$;
revoke execute on function public._split_excess_consume(uuid, uuid, bigint, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) O QUE A UNIDADE E O FINANCEIRO VEEM
-- ---------------------------------------------------------------------------
-- Os casos do débito no período (Painel de repasses), com o motivo e o valor.
create or replace function public.split_debit_cases_read(p_from date, p_to date, p_clinic_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_clinics uuid[] := public._gateway_cap_clinics('modulo.repasses_franquia');
begin
  if v_clinics is not null and coalesce(array_length(v_clinics, 1), 0) = 0 then raise exception 'NOT_ALLOWED'; end if;
  if p_clinic_id is not null and v_clinics is not null and not (p_clinic_id = any (v_clinics)) then raise exception 'NOT_ALLOWED'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_PERIOD'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'chargeId', c.id, 'clinicId', c.clinic_id, 'clinicName', cl.name, 'paidOn', c.paid_on, 'paidCents', c.paid_cents,
      'status', f.status,
      'motivo', case
        when f.status = 'corrigido' then 'split corrigido — pago no débito'
        when x.id is not null and x.status <> 'cancelado' then 'crédito — split a mais no débito'
        when f.status = 'parcelado_travado' then 'débito em cobrança parcelada — com o Financeiro'
        when f.status = 'divergente' then 'débito sem confirmação (aviso e valor discordam) — com o Financeiro'
        when f.status = 'pendente' then 'pago no débito — correção do split em andamento'
        when f.status = 'conta_da_franqueadora' then 'pago no débito na conta da franqueadora'
        else 'pago no débito' end,
      'valorCents', case
        when f.status = 'corrigido' then greatest(coalesce(f.before_cents, 0) - coalesce(f.after_cents, 0), 0)
        when x.id is not null and x.status <> 'cancelado' then x.amount_cents
        else null end,
      'creditoStatus', x.status, 'creditoUsadoCents', x.used_cents) order by c.paid_on desc, c.id)
      from public.charge_debit_fixes f
      join public.charges c on c.id = f.charge_id
      join public.clinics cl on cl.id = c.clinic_id
      left join lateral (select y.* from public.split_excess_credits y where y.charge_id = c.id order by y.created_at limit 1) x on true
     where c.paid_on between p_from and p_to
       and (p_clinic_id is null or c.clinic_id = p_clinic_id)
       and (v_clinics is null or c.clinic_id = any (v_clinics))), '[]'::jsonb);
end;
$$;
revoke execute on function public.split_debit_cases_read(date, date, uuid) from public, anon;
grant execute on function public.split_debit_cases_read(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) A ESCOLHA DA UNIDADE NA PRONTIDÃO (débito desabilitado OU habilitado)
-- ---------------------------------------------------------------------------
create or replace function public.gateway_declare_debit(p_account_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.gateway_accounts%rowtype;
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  select * into a from public.gateway_accounts where id = p_account_id;
  if a.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  -- Na conta da franqueadora o débito fica desabilitado (cobrança mensal e Empresarial).
  if coalesce(p_enabled, false) and a.owner_type <> 'unit' then raise exception 'DEBIT_ONLY_UNITS'; end if;
  if coalesce(p_enabled, false) then
    update public.gateway_accounts set debit_enabled_declared_at = now(), debit_enabled_declared_by = (select auth.uid()),
           debit_disabled_declared_at = null, debit_disabled_declared_by = null, updated_at = now()
     where id = p_account_id;
  else
    update public.gateway_accounts set debit_disabled_declared_at = now(), debit_disabled_declared_by = (select auth.uid()),
           debit_enabled_declared_at = null, debit_enabled_declared_by = null, updated_at = now()
     where id = p_account_id;
  end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), a.clinic_id, 'update',
          case when coalesce(p_enabled, false) then 'gateway_debit_enabled' else 'gateway_debit_disabled' end,
          p_account_id::text, jsonb_build_object('conta', a.label));
end;
$$;
revoke execute on function public.gateway_declare_debit(uuid, boolean) from public, anon;
grant execute on function public.gateway_declare_debit(uuid, boolean) to authenticated;

-- As tabelas novas entram na auditoria de alterações (como as da 4023).
select public.audit_attach_all();


-- AS TROCAS POR ÂNCORA (cada âncora numa linha só: a produção pode ter quebra de linha do Windows).

do $do$
declare d text := pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  update public.gateway_webhook_events set charge_id = c.id where id = e.id; -- 4026: o meio que o pagador USOU (pelo aviso e pelo valor líquido)
  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    perform public._gateway_debit_detect(c.id, p);
  end if;$n1$ in d) = 0 then
    if position($v1$  update public.gateway_webhook_events set charge_id = c.id where id = e.id;$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _gateway_apply_event (1)'; end if;
    d := replace(d, $v1$  update public.gateway_webhook_events set charge_id = c.id where id = e.id;$v1$, $n1$  update public.gateway_webhook_events set charge_id = c.id where id = e.id; -- 4026: o meio que o pagador USOU (pelo aviso e pelo valor líquido)
  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    perform public._gateway_debit_detect(c.id, p);
  end if;$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._gateway_apply_fee(uuid,bigint,date,uuid,text)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' when 'DEBIT_CARD' then 'debito' else null end; -- 4026$n1$ in d) = 0 then
    if position($v1$when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' else null end;$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _gateway_apply_fee (1)'; end if;
    d := replace(d, $v1$when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' else null end;$v1$, $n1$when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' when 'DEBIT_CARD' then 'debito' else null end; -- 4026$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._gateway_on_paid(uuid,text,jsonb)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$      case when c.paid_billing_type = 'DEBIT_CARD' then 'DEBIT_CARD' when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end); -- 4026$n1$ in d) = 0 then
    if position($v1$      case when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end);$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _gateway_on_paid (1)'; end if;
    d := replace(d, $v1$      case when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end);$v1$, $n1$      case when c.paid_billing_type = 'DEBIT_CARD' then 'DEBIT_CARD' when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end); -- 4026$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._gateway_split_retention(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$      if v_excess > v_tol and w.excess_cents is distinct from v_excess and coalesce(c.paid_billing_type, '') <> 'DEBIT_CARD' then -- 4026: o débito tem o caminho dele$n1$ in d) = 0 then
    if position($v1$      if v_excess > v_tol and w.excess_cents is distinct from v_excess then$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _gateway_split_retention (1)'; end if;
    d := replace(d, $v1$      if v_excess > v_tol and w.excess_cents is distinct from v_excess then$v1$, $n1$      if v_excess > v_tol and w.excess_cents is distinct from v_excess and coalesce(c.paid_billing_type, '') <> 'DEBIT_CARD' then -- 4026: o débito tem o caminho dele$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_monthly_build(uuid,date,uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  -- 4026 D) O CRÉDITO DO SPLIT A MAIS NO DÉBITO: o que o Asaas repassou a mais à
  -- rede num pagamento no débito sem a correção do split. É da unidade: entra
  -- como crédito; o que sobrar depois da cobrança paga entra no mês seguinte.
  for r in
    select x.id, x.fee, x.origin_month, x.amount_cents - x.used_cents as resta, ch.paid_on
      from public.split_excess_credits x join public.charges ch on ch.id = x.charge_id
     where x.clinic_id = p_clinic_id and x.status = 'a_devolver' and x.amount_cents - x.used_cents > 0
       and x.origin_month <= p_period
       and not exists (select 1 from public.franchise_monthly_items i join public.franchise_monthly_batches bb on bb.id = i.batch_id
                        where i.split_excess_credit_id = x.id and bb.id <> v_batch
                          and public._franchise_batch_holds(bb.status) and bb.settled_at is null)
     order by x.created_at
  loop
    insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, received_on, method,
      amount_cents, description, split_excess_credit_id)
    values (v_batch, p_clinic_id, 'credito', r.fee, r.origin_month, r.paid_on, 'cartao_debito', -r.resta,
      'Crédito — split a mais no débito', r.id);
  end loop;

  -- C) O SALDO ANTERIOR (20.15.1)$n1$ in d) = 0 then
    if position($v1$  -- C) O SALDO ANTERIOR (20.15.1)$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_monthly_build (1)'; end if;
    d := replace(d, $v1$  -- C) O SALDO ANTERIOR (20.15.1)$v1$, $n1$  -- 4026 D) O CRÉDITO DO SPLIT A MAIS NO DÉBITO: o que o Asaas repassou a mais à
  -- rede num pagamento no débito sem a correção do split. É da unidade: entra
  -- como crédito; o que sobrar depois da cobrança paga entra no mês seguinte.
  for r in
    select x.id, x.fee, x.origin_month, x.amount_cents - x.used_cents as resta, ch.paid_on
      from public.split_excess_credits x join public.charges ch on ch.id = x.charge_id
     where x.clinic_id = p_clinic_id and x.status = 'a_devolver' and x.amount_cents - x.used_cents > 0
       and x.origin_month <= p_period
       and not exists (select 1 from public.franchise_monthly_items i join public.franchise_monthly_batches bb on bb.id = i.batch_id
                        where i.split_excess_credit_id = x.id and bb.id <> v_batch
                          and public._franchise_batch_holds(bb.status) and bb.settled_at is null)
     order by x.created_at
  loop
    insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, received_on, method,
      amount_cents, description, split_excess_credit_id)
    values (v_batch, p_clinic_id, 'credito', r.fee, r.origin_month, r.paid_on, 'cartao_debito', -r.resta,
      'Crédito — split a mais no débito', r.id);
  end loop;

  -- C) O SALDO ANTERIOR (20.15.1)$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_monthly_settle(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  v_method text;
  v_excess bigint := 0; v_comp_x bigint := 0; v_x_total bigint := 0; -- 4026$n1$ in d) = 0 then
    if position($v1$  v_method text;$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_monthly_settle (1)'; end if;
    d := replace(d, $v1$  v_method text;$v1$, $n1$  v_method text;
  v_excess bigint := 0; v_comp_x bigint := 0; v_x_total bigint := 0; -- 4026$n1$);
  end if;
  if position($n2$   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is null;
  -- 4026: o crédito do split a mais no débito é usado por último, e tem o razão dele.
  select coalesce(-sum(amount_cents), 0) into v_excess from public.franchise_monthly_items
   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is not null;$n2$ in d) = 0 then
    if position($v2$   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0;$v2$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_monthly_settle (2)'; end if;
    d := replace(d, $v2$   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0;$v2$, $n2$   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is null;
  -- 4026: o crédito do split a mais no débito é usado por último, e tem o razão dele.
  select coalesce(-sum(amount_cents), 0) into v_excess from public.franchise_monthly_items
   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is not null;$n2$);
  end if;
  if position($n3$    v_comp := least(r.amt, v_credit + v_excess); -- 4026
    v_comp_x := greatest(v_comp - v_credit, 0);
    v_excess := v_excess - v_comp_x;
    v_x_total := v_x_total + v_comp_x;
    if v_comp_x > 0 then perform public._split_excess_pay_payable(b.id, r.payable_id, v_comp_x, b.paid_on); end if;$n3$ in d) = 0 then
    if position($v3$    v_comp := least(r.amt, v_credit);$v3$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_monthly_settle (3)'; end if;
    d := replace(d, $v3$    v_comp := least(r.amt, v_credit);$v3$, $n3$    v_comp := least(r.amt, v_credit + v_excess); -- 4026
    v_comp_x := greatest(v_comp - v_credit, 0);
    v_excess := v_excess - v_comp_x;
    v_x_total := v_x_total + v_comp_x;
    if v_comp_x > 0 then perform public._split_excess_pay_payable(b.id, r.payable_id, v_comp_x, b.paid_on); end if;$n3$);
  end if;
  if position($n4$    v_credit := v_credit - (v_comp - v_comp_x); -- 4026$n4$ in d) = 0 then
    if position($v4$    v_credit := v_credit - v_comp;$v4$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_monthly_settle (4)'; end if;
    d := replace(d, $v4$    v_credit := v_credit - v_comp;$v4$, $n4$    v_credit := v_credit - (v_comp - v_comp_x); -- 4026$n4$);
  end if;
  if position($n5$  -- 4026: o crédito usado sai do "a receber da franqueadora" (o que sobrar fica para o mês seguinte).
  if v_x_total > 0 then perform public._split_excess_consume(b.id, b.clinic_id, v_x_total, b.paid_on); end if;

  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.$n5$ in d) = 0 then
    if position($v5$  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.$v5$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_monthly_settle (5)'; end if;
    d := replace(d, $v5$  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.$v5$, $n5$  -- 4026: o crédito usado sai do "a receber da franqueadora" (o que sobrar fica para o mês seguinte).
  if v_x_total > 0 then perform public._split_excess_consume(b.id, b.clinic_id, v_x_total, b.paid_on); end if;

  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.$n5$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_reconcile_found(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol and not exists (select 1 from public.split_excess_credits x where x.charge_split_id = cs.id and x.status <> 'cancelado') -- 4026: virou crédito da unidade$n1$ in d) = 0 then
    if position($v1$     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_reconcile_found (1)'; end if;
    d := replace(d, $v1$     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol$v1$, $n1$     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol and not exists (select 1 from public.split_excess_credits x where x.charge_split_id = cs.id and x.status <> 'cancelado') -- 4026: virou crédito da unidade$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._central_readiness_raw(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  select 'debito_conferido', -- 4026: a unidade escolhe (desabilitado ou habilitado)$n1$ in d) = 0 then
    if position($v1$  select 'debito_desabilitado',$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _central_readiness_raw (1)'; end if;
    d := replace(d, $v1$  select 'debito_desabilitado',$v1$, $n1$  select 'debito_conferido', -- 4026: a unidade escolhe (desabilitado ou habilitado)$n1$);
  end if;
  if position($n2$or v_acc.debit_disabled_declared_at is not null or v_acc.debit_enabled_declared_at is not null), false),$n2$ in d) = 0 then
    if position($v2$or v_acc.debit_disabled_declared_at is not null), false),$v2$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _central_readiness_raw (2)'; end if;
    d := replace(d, $v2$or v_acc.debit_disabled_declared_at is not null), false),$v2$, $n2$or v_acc.debit_disabled_declared_at is not null or v_acc.debit_enabled_declared_at is not null), false),$n2$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_charges_list(uuid,text[],text[],text,date,date,boolean)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$         pi.seq, coalesce(ch.paid_billing_type, ch.billing_type), ch.status, ch.is_overdue_reissue, -- 4026: o meio usado$n1$ in d) = 0 then
    if position($v1$         pi.seq, ch.billing_type, ch.status, ch.is_overdue_reissue,$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: gateway_charges_list (1)'; end if;
    d := replace(d, $v1$         pi.seq, ch.billing_type, ch.status, ch.is_overdue_reissue,$v1$, $n1$         pi.seq, coalesce(ch.paid_billing_type, ch.billing_type), ch.status, ch.is_overdue_reissue, -- 4026: o meio usado$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_month_invoiced(uuid,date)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$     and i.status in ('ativo', 'contestado') and i.split_excess_credit_id is null -- 4026: o crédito do débito não é taxa (é o 6.4.01)
     and public._franchise_batch_holds(b.status);$n1$ in d) = 0 then
    if position($v1$     and i.status in ('ativo', 'contestado') and public._franchise_batch_holds(b.status);$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: _franchise_month_invoiced (1)'; end if;
    d := replace(d, $v1$     and i.status in ('ativo', 'contestado') and public._franchise_batch_holds(b.status);$v1$, $n1$     and i.status in ('ativo', 'contestado') and i.split_excess_credit_id is null -- 4026: o crédito do débito não é taxa (é o 6.4.01)
     and public._franchise_batch_holds(b.status);$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

create or replace function public.gateway_asaas_migrations()
returns table (code text, label text, applied boolean, sort_order integer)
language sql stable security definer set search_path = '' as $$
  with m(code, label, kind, obj, sort_order) as (values
    ('4000', 'Fundação: contas e Vault', 'table', 'gateway_settings', 1),
    ('4001', 'Tarifas no adquirente', 'fn', '_gateway_sync_fees', 2),
    ('4002', 'Prontidão, histórico e verificação', 'table', 'central_unit_readiness', 3),
    ('4003', 'Responsável financeiro e carência', 'col', 'client_guardians.is_financial', 4),
    ('4004', 'Cobranças, travas e dispensa', 'table', 'gateway_customers', 5),
    ('4005', 'O aviso vira baixa', 'table', 'gateway_payment_surpluses', 6),
    ('4006', 'Selo em atraso e painel de cobranças', 'fn', '_overdue_badge_business_days', 7),
    ('4007', 'A régua de avisos', 'table', 'gateway_notification_rules', 8),
    ('4008', 'O split na emissão', 'table', 'gateway_split_settings', 9),
    ('4009', 'A fila do split e o estorno', 'table', 'charge_split_updates', 10),
    ('4010', 'Repasses da franquia', 'fn', '_franchise_payout_charge_fees', 11),
    ('4011', 'Meio por parcela, dinheiro e permuta', 'table', 'sale_method_settings', 12),
    ('4012', 'Cobrança na assinatura e rotina', 'table', 'gateway_auto_charge_settings', 13),
    ('4013', 'Cartão parcelado', 'fn', 'charges_card_block_rule', 14),
    ('4014', 'Parcelado: devolução, contestação e avisos', 'table', 'card_block_returns', 15),
    ('4015', 'Todos os boletos agora', 'table', 'gateway_carne_customers', 16),
    ('4015a', 'Recusa de cancelar venda com acordo aberto', 'fn', '_sale_open_agreements', 17),
    ('4017', 'Renegociação assinada', 'table', 'payment_renegotiation_events', 18),
    ('4017a', 'Exceção: cancelar venda com acordo', 'table', 'sale_cancel_exceptions', 19),
    ('4018', 'Mensalidades pelo Asaas', 'table', 'charge_source_types', 20),
    ('4018a', 'A marca do split a mais', 'body', '_gateway_split_retention|4018a', 21),
    ('4018b', 'A conta cancelada à mão', 'body', 'refresh_network_fee_payable|Sem valor apurado', 22),
    ('4018c', 'A taxa retida no razão', 'fn', '_split_charges_after_born', 23),
    ('4020', 'Distrato com checklist', 'table', 'distrato_requests', 24),
    ('4020a', 'Estorno de parte pelo Asaas', 'table', 'refund_requests', 25),
    ('4021', 'Cobrança mensal da rede', 'table', 'franchise_billing_settings', 26),
    ('4021a', 'Conferência das taxas', 'table', 'reconciliation_issues', 27),
    ('4022', 'As peças do piloto', 'table', 'gateway_charge_issues', 28),
    ('4023', 'O Empresarial pelo Asaas', 'table', 'corporate_gateway_settings', 29),
    ('4024', 'A antecipação vira alerta', 'body', '_central_readiness_raw|antecipacao_conferida', 30),
    ('4025', 'A conta da RisLife só para quem a cadastrou', 'col', 'gateway_accounts.visible_only_to', 31),
    ('4026', 'O pagamento no cartão de débito', 'col', 'charges.paid_billing_type', 32)
  )
  select m.code, m.label,
         case m.kind
           when 'table' then exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = m.obj)
           when 'fn' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.obj)
           when 'col' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                                     and c.table_name = split_part(m.obj, '.', 1) and c.column_name = split_part(m.obj, '.', 2))
           when 'body' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public' and p.proname = split_part(m.obj, '|', 1)
                                       and position(split_part(m.obj, '|', 2) in p.prosrc) > 0)
         end,
         m.sort_order
    from m order by m.sort_order;
$$;
revoke execute on function public.gateway_asaas_migrations() from public, anon, authenticated;

notify pgrst, 'reload schema';

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and position('4026' in p.prosrc) > 0
      and p.proname in ('_gateway_apply_event', '_gateway_apply_fee', '_gateway_on_paid', '_gateway_split_retention',
                        '_franchise_monthly_build', '_franchise_monthly_settle', '_franchise_reconcile_found',
                        '_central_readiness_raw', 'gateway_charges_list', '_franchise_month_invoiced')) as funcoes_trocadas,
  (select count(*) from pg_trigger where tgname in ('charges_debit_paid', 'charge_splits_debit_excess') and not tgisinternal) as gatilhos,
  (select count(*) from public.chart_of_accounts where code in ('6.4', '6.4.01', '6.4.02')) as contas,
  (select applied from public.gateway_asaas_migrations() where code = '4026') as na_lista;
