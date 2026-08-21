-- =============================================================================
-- 0233 — FIN8.1b: taxas como DADOS + campanhas por período
-- -----------------------------------------------------------------------------
-- Pedidos do dono (17/08/2026): cadastrar taxa nova, inativar/excluir taxa, e
-- lançar campanhas por período em que o franqueado paga menos.
--
-- TAXA VIRA DADO, NÃO ENUM. Na 0232 as seis taxas estavam presas no banco
-- (`check (fee in (...))`) com a conta contábil amarrada por dentro. Criar a
-- sétima exigiria migração. Agora seguem o mesmo caminho dos centros de custo:
-- "são DADOS, não enum — criar um novo é operação de tela".
--
-- AS CONTAS SÃO ESCOLHIDAS, NÃO INVENTADAS. Quem cadastra a taxa aponta a conta
-- de despesa da unidade e a de receita da franqueadora, entre as que já existem
-- no plano. Deixar o sistema criar conta contábil sozinho faz o plano crescer
-- sem ninguém olhar, e plano que ninguém olha vira relatório que ninguém
-- entende.
--
-- INATIVAR ≠ EXCLUIR. Inativar para de cobrar daqui para frente e preserva o
-- histórico — é o caminho normal. Excluir só quando a taxa NUNCA foi cobrada;
-- com cobrança, o banco recusa e manda inativar. Mesma regra do item de estoque
-- (0215). E as seis originais são `system`: nunca se apagam, só se inativam.
--
-- CAMPANHA GANHA DO ACORDO DA UNIDADE, QUE GANHA DO PADRÃO DA REDE. Três
-- níveis, e o mais específico vence — a campanha existe justamente para valer
-- por cima do que estava combinado, por um tempo.
--
-- O PERCENTUAL CONTINUA CONGELANDO NA BAIXA (`split_charges.percent`). Campanha
-- que termina não mexe em nada do que já foi cobrado; campanha lançada com data
-- retroativa não recalcula o passado. Quem cobra é o dia da baixa.
--
-- DUAS FORMAS DE CAMPANHA, e só duas:
--   • 'valor'    — troca o valor vigente (royalty a 3%; isenção = 0).
--   • 'desconto' — corta um percentual do valor vigente (metade do fundo).
-- Mais modos dariam a mesma coisa por caminhos diferentes, e cada caminho a
-- mais é um lugar onde a conta pode divergir.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O CATÁLOGO DE TAXAS
-- -----------------------------------------------------------------------------
create table if not exists public.network_fee_types (
  key text primary key,
  label text not null,
  kind text not null check (kind in ('percent', 'fixed')),
  -- Conta de DESPESA na unidade e de RECEITA na franqueadora.
  unit_account text not null references public.chart_of_accounts (code),
  franchisor_account text not null references public.chart_of_accounts (code),
  -- As seis originais: podem ser inativadas, nunca apagadas.
  system boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

alter table public.network_fee_types enable row level security;

drop policy if exists "network_fee_types_select" on public.network_fee_types;
create policy "network_fee_types_select" on public.network_fee_types
  for select to authenticated using (true);

drop policy if exists "network_fee_types_write" on public.network_fee_types;
create policy "network_fee_types_write" on public.network_fee_types
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

insert into public.network_fee_types
  (key, label, kind, unit_account, franchisor_account, system, sort_order)
values
  ('royalty',      'Royalty',                   'percent', '2.6.01', '1.3.01', true, 10),
  ('fundo',        'Fundo de propaganda',       'percent', '2.6.02', '1.3.03', true, 20),
  ('planejamento', 'Centro de planejamento',    'percent', '2.6.03', '1.3.05', true, 30),
  ('comercial',    'Comercial',                 'percent', '2.6.04', '1.3.06', true, 40),
  ('sistema',      'Taxa de sistema e suporte', 'fixed',   '2.6.05', '1.3.04', true, 50),
  ('sdr',          'SDR',                       'fixed',   '2.6.06', '1.3.07', true, 60)
on conflict (key) do nothing;

-- A trava de enum sai: agora quem manda é o catálogo.
do $$
begin
  alter table public.network_fees drop constraint if exists network_fees_fee_check;
exception when others then null;
end;
$$;

do $$
begin
  alter table public.network_fees
    add constraint network_fees_fee_fkey
    foreign key (fee) references public.network_fee_types (key) on delete cascade;
exception when duplicate_object then null;
end;
$$;

-- `split_charges.fee` fica TEXTO SOLTO de propósito: o rastro do que já foi
-- cobrado precisa sobreviver a uma taxa apagada. Histórico que some junto com o
-- cadastro é como uma conferência deixa de fechar.

-- -----------------------------------------------------------------------------
-- 2) CADASTRAR, INATIVAR, EXCLUIR
-- -----------------------------------------------------------------------------
create or replace function public.save_network_fee_type(
  p_key text,
  p_label text,
  p_kind text,
  p_unit_account text,
  p_franchisor_account text,
  p_active boolean default true,
  p_sort_order integer default 100,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_key text := lower(regexp_replace(coalesce(btrim(p_key), ''), '[^a-zA-Z0-9]+', '_', 'g'));
  v_existing record;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'LABEL_REQUIRED'; end if;
  if v_key = '' then raise exception 'KEY_REQUIRED'; end if;
  if p_kind not in ('percent', 'fixed') then raise exception 'INVALID_KIND'; end if;

  -- As duas contas precisam existir e ser analíticas: conta sintética não
  -- recebe lançamento, e a cobrança quebraria só na primeira baixa do mês.
  if not exists (select 1 from public.chart_of_accounts
                  where code = p_unit_account and is_analytic) then
    raise exception 'UNIT_ACCOUNT_INVALID';
  end if;
  if not exists (select 1 from public.chart_of_accounts
                  where code = p_franchisor_account and is_analytic) then
    raise exception 'FRANCHISOR_ACCOUNT_INVALID';
  end if;

  select * into v_existing from public.network_fee_types where key = v_key;

  -- Mudar a NATUREZA de uma taxa que já cobrou trocaria o significado do
  -- histórico: percentual virando fixo faria as baixas antigas não explicarem
  -- mais o valor cobrado.
  if v_existing.key is not null
     and v_existing.kind <> p_kind
     and exists (select 1 from public.split_charges where fee = v_key) then
    raise exception 'KIND_LOCKED';
  end if;

  insert into public.network_fee_types
    (key, label, kind, unit_account, franchisor_account, active, sort_order,
     note, updated_by)
  values
    (v_key, btrim(p_label), p_kind, p_unit_account, p_franchisor_account,
     coalesce(p_active, true), coalesce(p_sort_order, 100),
     nullif(btrim(p_note), ''), v_user)
  on conflict (key) do update
    set label = excluded.label,
        kind = excluded.kind,
        unit_account = excluded.unit_account,
        franchisor_account = excluded.franchisor_account,
        active = excluded.active,
        sort_order = excluded.sort_order,
        note = excluded.note,
        updated_at = now(),
        updated_by = v_user;

  -- Taxa nova nasce com a linha da rede zerada e desligada: o número é decisão
  -- de gente. Semear com percentual inventado faria a primeira baixa cobrar
  -- errado.
  insert into public.network_fees
    (clinic_id, fee, kind, percent, amount_cents, active)
  values (null, v_key, p_kind, 0, 0, false)
  on conflict do nothing;

  return v_key;
end;
$$;

revoke all on function public.save_network_fee_type(
  text, text, text, text, text, boolean, integer, text) from public;
grant execute on function public.save_network_fee_type(
  text, text, text, text, text, boolean, integer, text) to authenticated;

/**
 * Excluir só o que nunca cobrou. Com cobrança, o banco recusa e a tela manda
 * inativar — apagar levaria junto a explicação de dinheiro que já saiu.
 */
create or replace function public.delete_network_fee_type(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type record;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_type from public.network_fee_types where key = p_key;
  if v_type.key is null then return; end if;
  if v_type.system then raise exception 'FEE_IS_SYSTEM'; end if;

  if exists (select 1 from public.split_charges where fee = p_key)
     or exists (select 1 from public.payables where network_fee = p_key) then
    raise exception 'FEE_IN_USE';
  end if;

  -- As regras (rede e unidades) caem junto pelo `on delete cascade`.
  delete from public.network_fee_types where key = p_key;
end;
$$;

revoke all on function public.delete_network_fee_type(text) from public;
grant execute on function public.delete_network_fee_type(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) AS CAMPANHAS
-- -----------------------------------------------------------------------------
create table if not exists public.network_fee_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- NULL = vale para a rede inteira.
  clinic_id uuid references public.clinics (id) on delete cascade,
  -- NULL = vale para todas as taxas.
  fee text references public.network_fee_types (key) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  mode text not null check (mode in ('valor', 'desconto')),
  -- mode 'valor': o novo percentual (ou 0 para isenção).
  percent numeric(7,4) check (percent is null or (percent >= 0 and percent <= 100)),
  -- mode 'valor', taxa fixa: o novo valor mensal.
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  -- mode 'desconto': quanto cortar do valor vigente.
  discount_percent numeric(7,4)
    check (discount_percent is null
           or (discount_percent >= 0 and discount_percent <= 100)),
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint campaign_dates check (ends_on >= starts_on)
);

create index if not exists network_fee_campaigns_idx
  on public.network_fee_campaigns (clinic_id, fee, starts_on, ends_on, active);

alter table public.network_fee_campaigns enable row level security;

drop policy if exists "network_fee_campaigns_select" on public.network_fee_campaigns;
create policy "network_fee_campaigns_select" on public.network_fee_campaigns
  for select to authenticated
  using (
    clinic_id is null
    or clinic_id in (select public.finance_visible_clinic_ids())
  );

drop policy if exists "network_fee_campaigns_write" on public.network_fee_campaigns;
create policy "network_fee_campaigns_write" on public.network_fee_campaigns
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

-- -----------------------------------------------------------------------------
-- 4) A REGRA QUE VALE — agora com data e campanha
-- -----------------------------------------------------------------------------
-- Muda o retorno: `create or replace` não basta.
drop function if exists public.network_fee_for(uuid, text);
drop function if exists public.network_fee_accounts(text);
drop function if exists public.network_fee_label(text);

create or replace function public.network_fee_accounts(p_fee text)
returns table (unit_account text, franchisor_account text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.unit_account, t.franchisor_account
    from public.network_fee_types t where t.key = p_fee;
$$;

grant execute on function public.network_fee_accounts(text) to authenticated;

create or replace function public.network_fee_label(p_fee text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.label from public.network_fee_types t where t.key = p_fee),
    p_fee);
$$;

grant execute on function public.network_fee_label(text) to authenticated;

/**
 * O valor que vale para a unidade NAQUELE DIA.
 *
 * Três níveis, do mais específico para o mais genérico:
 *   campanha vigente  >  acordo da unidade  >  padrão da rede
 *
 * Entre campanhas, a da UNIDADE ganha da campanha da rede; empatou, a que
 * começou por último. Sem esse desempate, duas campanhas sobrepostas dariam
 * resultado diferente a cada consulta — e ninguém descobriria olhando a tela.
 */
create or replace function public.network_fee_for(
  p_clinic_id uuid,
  p_fee text,
  p_on date default null
)
returns table (
  kind text,
  percent numeric,
  amount_cents bigint,
  due_day integer,
  active boolean,
  is_override boolean,
  note text,
  campaign_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with dia as (select coalesce(p_on, public.today_br()) as d),
  base as (
    select f.kind, f.percent, f.amount_cents, f.due_day, f.active,
           f.clinic_id is not null as is_override, f.note
    from public.network_fees f
    where f.fee = p_fee
      and (f.clinic_id = p_clinic_id or f.clinic_id is null)
    order by (f.clinic_id is not null) desc
    limit 1
  ),
  camp as (
    select c.*
    from public.network_fee_campaigns c, dia
    where c.active
      and (c.clinic_id = p_clinic_id or c.clinic_id is null)
      and (c.fee = p_fee or c.fee is null)
      and dia.d between c.starts_on and c.ends_on
    order by (c.clinic_id is not null) desc,
             (c.fee is not null) desc,
             c.starts_on desc
    limit 1
  )
  select
    b.kind,
    case
      when c.id is null then b.percent
      when c.mode = 'valor' then coalesce(c.percent, b.percent)
      else round(b.percent * (1 - coalesce(c.discount_percent, 0) / 100.0), 4)
    end,
    case
      when c.id is null then b.amount_cents
      when c.mode = 'valor' then coalesce(c.amount_cents, b.amount_cents)
      else round(b.amount_cents
                 * (1 - coalesce(c.discount_percent, 0) / 100.0))::bigint
    end,
    b.due_day,
    -- Taxa inativada no catálogo não cobra de ninguém, campanha ou não.
    b.active and coalesce(
      (select t.active from public.network_fee_types t where t.key = p_fee),
      true),
    b.is_override,
    b.note,
    c.name
  from base b
  left join camp c on true;
$$;

grant execute on function public.network_fee_for(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) OS CONSUMIDORES, com a assinatura nova
-- -----------------------------------------------------------------------------
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
  -- A taxa fixa do mês vale pela regra do PRIMEIRO dia dele: campanha que
  -- começa no dia 15 não deve valer meio mês.
  select * into v_cfg from public.network_fee_for(p_clinic_id, p_fee, p_period);
  if v_cfg is null then return; end if;
  select * into v_acc from public.network_fee_accounts(p_fee);
  if v_acc is null then return; end if;

  if v_cfg.kind = 'percent' then
    select coalesce(sum(amount_cents), 0) into v_total
      from public.split_charges
     where clinic_id = p_clinic_id and fee = p_fee
       and period_month = p_period and not reversed;
  else
    v_total := case when v_cfg.active then v_cfg.amount_cents else 0 end;
  end if;

  v_due := (p_period + interval '1 month')::date
           + (coalesce(v_cfg.due_day, 10) - 1);

  select id into v_payable from public.payables
   where clinic_id = p_clinic_id and network_fee = p_fee
     and fee_period = p_period;

  if v_total <= 0 then
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
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
        || coalesce(' (' || v_cfg.campaign_name || ')', ''),
      p_period, v_due, v_total, 'aberta',
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

    update public.financial_entries set
      amount_cents = v_total, status = 'open', updated_at = now()
     where source_type = 'payable_accrual' and source_id = v_payable;

    perform public.post_payable_accrual(v_payable);
  end if;

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

create or replace function public.apply_receipt_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee record;
  v_cfg record;
  v_period date := date_trunc('month', new.received_at)::date;
  v_amount bigint;
  v_is_franchisor boolean;
begin
  if new.reversal_of is not null then
    return null;
  end if;

  -- RECEBER NUNCA PODE SER RECUSADO (ver 0232): se o mês da baixa já foi
  -- fechado, a taxa cai no mês aberto, como nota que chegou atrasada.
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
    return null;
  end if;

  -- Agora o catálogo manda: taxa nova entra no split sem migração.
  for v_fee in
    select key from public.network_fee_types
     where kind = 'percent' and active order by sort_order, key
  loop
    -- A regra vale pelo dia da BAIXA, não pelo de hoje: baixa lançada com
    -- atraso cobra o que valia quando o dinheiro entrou.
    select * into v_cfg
      from public.network_fee_for(new.clinic_id, v_fee.key, new.received_at);
    continue when v_cfg is null or not v_cfg.active or v_cfg.percent <= 0;

    if new.reversed then
      update public.split_charges set reversed = true
       where receipt_id = new.id and fee = v_fee.key;
    else
      v_amount := round(new.amount_cents * v_cfg.percent / 100.0)::bigint;
      if v_amount > 0 then
        insert into public.split_charges
          (clinic_id, receipt_id, fee, percent, base_cents, amount_cents,
           period_month)
        values
          (new.clinic_id, new.id, v_fee.key, v_cfg.percent, new.amount_cents,
           v_amount, v_period)
        on conflict (receipt_id, fee) do nothing;
      end if;
    end if;

    perform public.refresh_network_fee_payable(new.clinic_id, v_fee.key, v_period);
  end loop;

  return null;
end;
$$;

drop trigger if exists payment_receipts_split on public.payment_receipts;
create trigger payment_receipts_split
  after insert or update on public.payment_receipts
  for each row execute function public.apply_receipt_split();

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
  v_fee record;
  v_cfg record;
  v_count integer := 0;
begin
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
    for v_fee in
      select key from public.network_fee_types
       where kind = 'fixed' and active order by sort_order, key
    loop
      select * into v_cfg
        from public.network_fee_for(v_clinic.id, v_fee.key, v_period);
      continue when v_cfg is null or not v_cfg.active or v_cfg.amount_cents <= 0;
      perform public.refresh_network_fee_payable(v_clinic.id, v_fee.key, v_period);
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.charge_fixed_network_fees(integer, integer) from public;
grant execute on function public.charge_fixed_network_fees(integer, integer)
  to authenticated;

-- O extrato, agora vindo do catálogo e mostrando a campanha.
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
  campaign_name text,
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
    t.key,
    t.label,
    cfg.kind,
    cfg.percent,
    cfg.is_override,
    cfg.campaign_name,
    coalesce(s.base, 0)::bigint,
    case when cfg.kind = 'percent' then coalesce(s.total, 0)
         when cfg.active then cfg.amount_cents else 0 end::bigint,
    coalesce(s.n, 0)::integer,
    pay.status
  from public.network_fee_types t
  cross join period per
  left join lateral public.network_fee_for(p_clinic_id, t.key, per.p) cfg on true
  left join lateral (
    select sum(c.amount_cents) as total, sum(c.base_cents) as base,
           count(*) as n
    from public.split_charges c
    where c.clinic_id = p_clinic_id and c.fee = t.key
      and c.period_month = per.p and not c.reversed
  ) s on true
  left join public.payables pay
    on pay.clinic_id = p_clinic_id and pay.network_fee = t.key
   and pay.fee_period = per.p
  where public.can_see_clinic_finance(p_clinic_id)
  order by t.sort_order, t.key;
$$;

grant execute on function public.network_fee_summary(uuid, integer, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.network_fee_types) as taxas_no_catalogo,
  (select count(*) from public.network_fee_types where system) as taxas_de_sistema,
  (select count(*) from public.network_fee_campaigns where active)
    as campanhas_ativas,
  (select count(*) from public.split_charges) as splits_registrados;
