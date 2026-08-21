-- =============================================================================
-- 0232 — FIN8.1: taxas da rede e split de pagamento
-- -----------------------------------------------------------------------------
-- O `docs/COMERCIAL.md` §8 já dizia: "todo recebimento da unidade sofre split".
-- Aqui ele existe.
--
-- A BASE É O DINHEIRO QUE ENTROU (decisão do dono, 17/08/2026), não a
-- competência. Cada BAIXA de parcela dispara o cálculo sobre o valor
-- efetivamente recebido. Três consequências que resolvem discussão antes de ela
-- existir:
--   • Desconto concedido já está embutido no que entrou — nada a tratar.
--   • Parcela que nunca foi paga não gera taxa.
--   • O franqueado confere olhando o extrato dele.
--
-- SEIS TAXAS, quatro percentuais (royalty, fundo, planejamento, comercial) e
-- duas fixas mensais (sistema, SDR). Percentual é custo VARIÁVEL da unidade —
-- acompanha o faturamento, e é assim que entra no ponto de equilíbrio; fixa é
-- custo fixo. A classificação segue editável no Plano de contas.
--
-- CASCATA, com exceção por unidade: uma unidade pode ter acordo diferente do
-- resto da rede, e a linha dela guarda o MOTIVO (`note`). Configuração que
-- diverge sem registro de por quê vira briga de memória seis meses depois.
--
-- O DINHEIRO ANDA PELO CONTAS A PAGAR, e isso é escolha. Cada recebimento grava
-- a sua parcela em `split_charges` (o rastro, recibo a recibo) e ALIMENTA UMA
-- conta a pagar do mês para aquela taxa — uma só, que cresce. A conta a pagar é
-- o caminho que já aparece no fluxo de caixa, entra na DRE e tem baixa com
-- histórico. Lançar o custo por fora criaria um SEGUNDO caminho para o mesmo
-- dinheiro, e dois caminhos é como eles passam a divergir.
--
-- LIMITE DECLARADO — O ASAAS NÃO ESTÁ PLUGADO (confirmado pelo dono): hoje o
-- split não é retido pela adquirente. A unidade recebe tudo e paga a rede pela
-- conta a pagar. Quando o ASAAS entrar, este mesmo cálculo vira o valor retido
-- e a conta a pagar nasce quitada — a conta não muda, só o momento do caixa.
--
-- LIMITE DECLARADO — do lado da FRANQUEADORA entra o lançamento de receita por
-- competência, sem cobrança formal com parcela. Tratar a unidade como cliente
-- mudaria mais coisa do que resolve agora; a baixa vem pela conciliação.
--
-- A FRANQUEADORA NÃO PAGA TAXA A SI MESMA. Unidade PRÓPRIA paga: a eliminação
-- do intercompany é assunto do consolidado (FIN8.2), não da cobrança.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) AS CONTAS
-- -----------------------------------------------------------------------------
insert into public.chart_of_accounts
  (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic)
values
  -- Unidade (custo intercompany).
  ('2.6.03', 'Centro de planejamento',    '2.6', 'expense', 'intercompany', 'variable', 'unit', true),
  ('2.6.04', 'Comercial (rede)',          '2.6', 'expense', 'intercompany', 'variable', 'unit', true),
  ('2.6.05', 'Taxa de sistema e suporte', '2.6', 'expense', 'intercompany', 'fixed',    'unit', true),
  ('2.6.06', 'SDR (rede)',                '2.6', 'expense', 'intercompany', 'fixed',    'unit', true),
  -- Franqueadora (receita intercompany).
  ('1.3.05', 'Centro de planejamento',    '1.3', 'revenue', 'intercompany', 'none', 'franchisor', true),
  ('1.3.06', 'Comercial (rede)',          '1.3', 'revenue', 'intercompany', 'none', 'franchisor', true),
  ('1.3.07', 'SDR (rede)',                '1.3', 'revenue', 'intercompany', 'none', 'franchisor', true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2) A CONFIGURAÇÃO — padrão da rede + exceção por unidade
-- -----------------------------------------------------------------------------
create table if not exists public.network_fees (
  id uuid primary key default gen_random_uuid(),
  -- NULL = padrão da rede.
  clinic_id uuid references public.clinics (id) on delete cascade,
  fee text not null check (fee in
    ('royalty', 'fundo', 'planejamento', 'comercial', 'sistema', 'sdr')),
  kind text not null check (kind in ('percent', 'fixed')),
  -- Percentual sobre o RECEBIDO (4 casas: 2,5% = 2.5000).
  percent numeric(7,4) not null default 0 check (percent >= 0 and percent <= 100),
  -- Valor fixo mensal, em centavos.
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  -- Dia do vencimento da conta no mês seguinte.
  due_day integer not null default 10 check (due_day between 1 and 28),
  -- Desligar a taxa PARA ESTA UNIDADE é um acordo válido — e fica explícito.
  active boolean not null default true,
  -- Por que esta unidade é diferente. Configuração que diverge sem registro de
  -- por quê vira briga de memória seis meses depois.
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint network_fees_unique unique nulls not distinct (clinic_id, fee)
);

create index if not exists network_fees_clinic_idx
  on public.network_fees (clinic_id, fee);

alter table public.network_fees enable row level security;

drop policy if exists "network_fees_select" on public.network_fees;
create policy "network_fees_select" on public.network_fees
  for select to authenticated
  using (
    clinic_id is null
    or clinic_id in (select public.finance_visible_clinic_ids())
  );

-- Só a Franqueadora configura: é ela quem cobra. Gerente e franqueado veem o
-- que pagam (pela policy de leitura acima) e não mexem.
drop policy if exists "network_fees_write" on public.network_fees;
create policy "network_fees_write" on public.network_fees
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

-- Padrão da rede em ZERO: taxa começa desligada até alguém decidir o número.
-- Semear com percentual inventado faria a primeira baixa cobrar errado.
insert into public.network_fees (clinic_id, fee, kind, percent, amount_cents)
values
  (null, 'royalty',      'percent', 0, 0),
  (null, 'fundo',        'percent', 0, 0),
  (null, 'planejamento', 'percent', 0, 0),
  (null, 'comercial',    'percent', 0, 0),
  (null, 'sistema',      'fixed',   0, 0),
  (null, 'sdr',          'fixed',   0, 0)
on conflict do nothing;

-- A conta de cada taxa, dos dois lados.
create or replace function public.network_fee_accounts(p_fee text)
returns table (unit_account text, franchisor_account text)
language sql
immutable
as $$
  select * from (values
    ('royalty',      '2.6.01', '1.3.01'),
    ('fundo',        '2.6.02', '1.3.03'),
    ('planejamento', '2.6.03', '1.3.05'),
    ('comercial',    '2.6.04', '1.3.06'),
    ('sistema',      '2.6.05', '1.3.04'),
    ('sdr',          '2.6.06', '1.3.07')
  ) as t(fee, unit_account, franchisor_account)
  where t.fee = p_fee;
$$;

grant execute on function public.network_fee_accounts(text) to authenticated;

/** Nome da taxa para a tela e para o histórico da conta a pagar. */
create or replace function public.network_fee_label(p_fee text)
returns text
language sql
immutable
as $$
  select case p_fee
    when 'royalty'      then 'Royalty'
    when 'fundo'        then 'Fundo de propaganda'
    when 'planejamento' then 'Centro de planejamento'
    when 'comercial'    then 'Comercial'
    when 'sistema'      then 'Taxa de sistema e suporte'
    when 'sdr'          then 'SDR'
    else p_fee end;
$$;

grant execute on function public.network_fee_label(text) to authenticated;

-- A regra que VALE para a unidade: a dela, senão a da rede.
create or replace function public.network_fee_for(
  p_clinic_id uuid,
  p_fee text
)
returns table (
  kind text,
  percent numeric,
  amount_cents bigint,
  due_day integer,
  active boolean,
  is_override boolean,
  note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.kind, f.percent, f.amount_cents, f.due_day, f.active,
         f.clinic_id is not null, f.note
  from public.network_fees f
  where f.fee = p_fee
    and (f.clinic_id = p_clinic_id or f.clinic_id is null)
  -- A linha da UNIDADE ganha da rede. Mesmo empate do `payout_rate_for` (0212).
  order by (f.clinic_id is not null) desc
  limit 1;
$$;

grant execute on function public.network_fee_for(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) O RASTRO: uma linha por recebimento e taxa
-- -----------------------------------------------------------------------------
create table if not exists public.split_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  receipt_id uuid not null references public.payment_receipts (id)
    on delete cascade,
  fee text not null,
  -- Congelados no momento da baixa: mudar a regra depois NÃO recalcula o
  -- passado. Mesma lei do repasse (0209) e da alçada (0194).
  percent numeric(7,4) not null,
  base_cents bigint not null,
  amount_cents bigint not null,
  period_month date not null,
  reversed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint split_charges_unique unique (receipt_id, fee)
);

create index if not exists split_charges_period_idx
  on public.split_charges (clinic_id, fee, period_month, reversed);

alter table public.split_charges enable row level security;

drop policy if exists "split_charges_select" on public.split_charges;
create policy "split_charges_select" on public.split_charges
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- -----------------------------------------------------------------------------
-- 4) A CONTA A PAGAR DO MÊS, POR TAXA
-- -----------------------------------------------------------------------------
alter table public.payables
  add column if not exists network_fee text,
  add column if not exists fee_period date;

create unique index if not exists payables_network_fee_unique
  on public.payables (clinic_id, network_fee, fee_period)
  where network_fee is not null;

-- O lançamento de receita da franqueadora também é único por conta.
create unique index if not exists financial_entries_network_fee_unique
  on public.financial_entries (source_type, source_id)
  where source_type = 'network_fee_revenue';

-- Recalcula a conta do mês a partir do rastro e espelha na franqueadora.
-- Uma função só para os dois lados: se cada um tivesse a própria conta, um dia
-- eles discordariam e ninguém saberia qual está certo.
create or replace function public.refresh_network_fee_payable(
  p_clinic_id uuid,
  p_fee text,
  p_period date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg record;
  v_acc record;
  v_total bigint;
  v_payable uuid;
  v_due date;
  v_franchisor uuid;
  v_label text := public.network_fee_label(p_fee);
begin
  select * into v_cfg from public.network_fee_for(p_clinic_id, p_fee);
  if v_cfg is null then return; end if;
  select * into v_acc from public.network_fee_accounts(p_fee);
  if v_acc is null then return; end if;

  if v_cfg.kind = 'percent' then
    select coalesce(sum(amount_cents), 0) into v_total
      from public.split_charges
     where clinic_id = p_clinic_id and fee = p_fee
       and period_month = p_period and not reversed;
  else
    -- Fixa: o valor é o da configuração, e só existe se a taxa está ligada.
    v_total := case when v_cfg.active then v_cfg.amount_cents else 0 end;
  end if;

  v_due := (p_period + interval '1 month')::date
           + (coalesce(v_cfg.due_day, 10) - 1);

  select id into v_payable from public.payables
   where clinic_id = p_clinic_id and network_fee = p_fee
     and fee_period = p_period;

  if v_total <= 0 then
    -- Zerou (estorno de todas as baixas, ou taxa desligada): a conta some do
    -- caminho, mas não é apagada — cancelar preserva o histórico.
    if v_payable is not null then
      update public.payables set status = 'cancelada',
        cancel_reason = 'Sem valor apurado no mês', updated_at = now()
       where id = v_payable and status <> 'paga';
      update public.financial_entries set status = 'cancelled'
       where source_type = 'payable_accrual' and source_id = v_payable;
      update public.financial_entries set status = 'cancelled'
       where source_type = 'network_fee_revenue' and source_id = v_payable;
    end if;
    return;
  end if;

  if v_payable is null then
    insert into public.payables (
      clinic_id, account_code, description, accrual_date, due_date,
      amount_cents, status, approval_mode, requires_approval,
      network_fee, fee_period, notes
    ) values (
      p_clinic_id, v_acc.unit_account,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY'),
      p_period, v_due, v_total, 'aberta',
      -- Taxa contratada: nem autorização, nem teto. Pedir aprovação para uma
      -- obrigação do contrato só cria fila.
      'sem_autorizacao', false,
      p_fee, p_period,
      'Apurado automaticamente sobre os recebimentos do mês.'
    ) returning id into v_payable;

    perform public.post_payable_accrual(v_payable);
  else
    update public.payables set
      amount_cents = v_total, due_date = v_due,
      status = case when status = 'cancelada' then 'aberta' else status end,
      updated_at = now()
     where id = v_payable;

    -- O razão precisa acompanhar: `post_payable_accrual` não reescreve
    -- lançamento que já existe (`on conflict do nothing`), então o valor
    -- ficaria congelado no primeiro recebimento do mês.
    update public.financial_entries set
      amount_cents = v_total, status = 'open', updated_at = now()
     where source_type = 'payable_accrual' and source_id = v_payable;

    perform public.post_payable_accrual(v_payable);
  end if;

  -- O outro lado: receita da franqueadora, por competência.
  select id into v_franchisor from public.clinics
   where type = 'franchisor' limit 1;

  if v_franchisor is not null and v_franchisor <> p_clinic_id then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description
    ) values (
      v_franchisor, v_acc.franchisor_account, p_period, null, v_due,
      v_total, 'inflow', 'open', 'network_fee_revenue', v_payable,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
    )
    on conflict (source_type, source_id)
      where source_type = 'network_fee_revenue'
    do update set amount_cents = excluded.amount_cents,
                  expected_settlement_date = excluded.expected_settlement_date,
                  status = 'open',
                  updated_at = now();
  end if;
end;
$$;

revoke all on function public.refresh_network_fee_payable(uuid, text, date)
  from public;

-- -----------------------------------------------------------------------------
-- 5) O SPLIT, no momento da baixa
-- -----------------------------------------------------------------------------
create or replace function public.apply_receipt_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee text;
  v_cfg record;
  v_period date := date_trunc('month', new.received_at)::date;
  v_amount bigint;
  v_is_franchisor boolean;
begin
  -- Contra-lançamento de estorno não gera taxa: quem paga a conta é a baixa
  -- original, e ela é quem some quando o estorno acontece.
  if new.reversal_of is not null then
    return null;
  end if;

  -- RECEBER NUNCA PODE SER RECUSADO. A taxa é um lançamento de COMPETÊNCIA, e
  -- se o mês da baixa já foi fechado (FIN7.4) o razão a recusaria — derrubando
  -- junto o registro do recebimento, que é o oposto da regra do fechamento.
  -- Nesse caso a taxa cai no mês ABERTO, como nota que chegou atrasada.
  if exists (
    select 1 from public.fiscal_periods p
     where p.clinic_id = new.clinic_id
       and p.status = 'closed'
       and p.year = extract(year from v_period)::integer
       and p.month = extract(month from v_period)::integer
  ) then
    v_period := date_trunc('month', public.today_br())::date;
  end if;

  select (c.type = 'franchisor') into v_is_franchisor
    from public.clinics c where c.id = new.clinic_id;
  if coalesce(v_is_franchisor, false) then
    return null;  -- a franqueadora não paga taxa a si mesma
  end if;

  foreach v_fee in array array['royalty', 'fundo', 'planejamento', 'comercial']
  loop
    select * into v_cfg from public.network_fee_for(new.clinic_id, v_fee);
    continue when v_cfg is null or not v_cfg.active or v_cfg.percent <= 0;

    if new.reversed then
      update public.split_charges set reversed = true
       where receipt_id = new.id and fee = v_fee;
    else
      v_amount := round(new.amount_cents * v_cfg.percent / 100.0)::bigint;
      if v_amount > 0 then
        insert into public.split_charges
          (clinic_id, receipt_id, fee, percent, base_cents, amount_cents,
           period_month)
        values
          (new.clinic_id, new.id, v_fee, v_cfg.percent, new.amount_cents,
           v_amount, v_period)
        on conflict (receipt_id, fee) do nothing;
      end if;
    end if;

    perform public.refresh_network_fee_payable(new.clinic_id, v_fee, v_period);
  end loop;

  return null;
end;
$$;

-- INSERT também, e não só UPDATE: a baixa nasce pronta, não é criada e depois
-- confirmada. Foi o buraco que custou 68 repasses na venda direta (0218).
drop trigger if exists payment_receipts_split on public.payment_receipts;
create trigger payment_receipts_split
  after insert or update on public.payment_receipts
  for each row execute function public.apply_receipt_split();

-- -----------------------------------------------------------------------------
-- 6) AS TAXAS FIXAS, uma vez por mês
-- -----------------------------------------------------------------------------
create or replace function public.charge_fixed_network_fees(
  p_year integer default null,
  p_month integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date;
  v_clinic record;
  v_fee text;
  v_cfg record;
  v_count integer := 0;
begin
  -- Chamada manual precisa ser da Franqueadora; o cron roda sem usuário.
  if (select auth.uid()) is not null
     and not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;

  v_period := case
    when p_year is null or p_month is null
      then date_trunc('month', public.today_br())::date
    else make_date(p_year, p_month, 1)
  end;

  for v_clinic in
    select c.id from public.clinics c
     where c.type <> 'franchisor' and c.is_active
  loop
    foreach v_fee in array array['sistema', 'sdr'] loop
      select * into v_cfg from public.network_fee_for(v_clinic.id, v_fee);
      continue when v_cfg is null or not v_cfg.active or v_cfg.amount_cents <= 0;
      perform public.refresh_network_fee_payable(v_clinic.id, v_fee, v_period);
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.charge_fixed_network_fees(integer, integer) from public;
grant execute on function public.charge_fixed_network_fees(integer, integer)
  to authenticated;

-- Todo dia 1º, 9h de Brasília.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('risarte-fixed-network-fees');
exception when others then null;
end;
$$;
do $$
begin
  perform cron.schedule(
    'risarte-fixed-network-fees', '0 12 1 * *',
    'select public.charge_fixed_network_fees()'
  );
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) O EXTRATO DAS TAXAS (para a tela)
-- -----------------------------------------------------------------------------
create or replace function public.network_fee_summary(
  p_clinic_id uuid,
  p_year integer,
  p_month integer
)
returns table (
  fee text,
  label text,
  kind text,
  percent numeric,
  is_override boolean,
  base_cents bigint,
  amount_cents bigint,
  receipts integer,
  payable_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with period as (select make_date(p_year, p_month, 1) as p)
  select
    f.fee,
    public.network_fee_label(f.fee),
    cfg.kind,
    cfg.percent,
    cfg.is_override,
    coalesce(s.base, 0)::bigint,
    case when cfg.kind = 'percent' then coalesce(s.total, 0)
         when cfg.active then cfg.amount_cents else 0 end::bigint,
    coalesce(s.n, 0)::integer,
    p.status
  from (select unnest(array['royalty', 'fundo', 'planejamento', 'comercial',
                            'sistema', 'sdr']) as fee) f
  cross join period per
  left join lateral public.network_fee_for(p_clinic_id, f.fee) cfg on true
  left join lateral (
    select sum(c.amount_cents) as total, sum(c.base_cents) as base,
           count(*) as n
    from public.split_charges c
    where c.clinic_id = p_clinic_id and c.fee = f.fee
      and c.period_month = per.p and not c.reversed
  ) s on true
  left join public.payables p
    on p.clinic_id = p_clinic_id and p.network_fee = f.fee
   and p.fee_period = per.p
  where public.can_see_clinic_finance(p_clinic_id);
$$;

grant execute on function public.network_fee_summary(uuid, integer, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.network_fees where clinic_id is null)
    as taxas_padrao_da_rede,
  (select count(*) from public.network_fees where clinic_id is not null)
    as excecoes_por_unidade,
  (select count(*) from public.split_charges) as splits_registrados,
  (select count(*) from public.chart_of_accounts
    where code in ('2.6.03','2.6.04','2.6.05','2.6.06',
                   '1.3.05','1.3.06','1.3.07')) as contas_novas,
  (select count(*) from pg_trigger where tgname = 'payment_receipts_split')
    as gatilho_do_split;
