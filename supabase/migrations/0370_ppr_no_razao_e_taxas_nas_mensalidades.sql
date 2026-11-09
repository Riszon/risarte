-- =============================================================================
-- 0370 — PPR+ NO RAZÃO E TAXAS DA REDE NAS MENSALIDADES (AP69, etapa 1; 09/11/2026)
--
-- AP69: a mensalidade do PPR+ não entrava no Financeiro da unidade — DRE,
-- fluxo de caixa, margem e ponto de equilíbrio não a enxergavam. A conta
-- `1.2.01 PPR+ — mensalidades` já existia no plano de contas; faltava a
-- ligação.
--
-- DECISÕES DO DONO (09/11/2026):
--   (1) o PPR+ entra no razão da UNIDADE, na 1.2.01, do mesmo jeito que a
--       Ortodontia (0329/0335): um lançamento por cobrança, na competência do
--       mês de referência (DRE); a baixa põe `cash_date` e `settled` (caixa);
--       desfazer volta a `open`; cancelar vira `cancelled`;
--   (3) royalty, fundo de propaganda, planejamento, comercial e as demais
--       taxas PERCENTUAIS da rede incidem sobre TODA receita da unidade —
--       inclusive a mensalidade do PPR+ e a da Ortodontia (mensalidade e
--       contenção). A conta é a MESMA das parcelas de tratamento (0232/0233):
--       base = o dinheiro que entrou, regra do dia da baixa, campanha
--       incluída, e alimenta a conta a pagar do mês de cada taxa.
--   (A etapa 2 — o Empresarial na Franqueadora — vem na 1040.)
--
-- O RASTRO DAS TAXAS GANHA ORIGEM. `split_charges` só conhecia a baixa de
-- parcela (`receipt_id`). Agora cada linha diz de onde veio (`source_type` +
-- `source_id`): 'receipt', 'ortho_charge' ou 'ppr_charge'. A conta das taxas
-- mora numa função só (`_apply_fee_split`), chamada pela baixa de parcela e
-- pelas duas mensalidades — mudou a regra, muda para as três.
--
-- DESFAZER E PAGAR DE NOVO. A baixa de parcela é imutável (estorno gera outra
-- linha), mas a mensalidade volta a `em_aberto` e pode ser paga de novo: a
-- taxa da mensalidade é marcada como estornada no desfazer e REATIVADA (com a
-- regra do novo dia) no pagamento seguinte.
--
-- O GUARDA DO MÊS FECHADO (0231) recusava TROCAR a situação de um lançamento
-- de mês fechado — e a baixa de uma mensalidade de mês já fechado só troca
-- `open` por `settled`. Com o PPR+ no razão, pagar uma mensalidade atrasada
-- de mês fechado passaria a FALHAR. Agora o guarda deixa passar exatamente
-- isso: só a situação entre `open` e `settled` (e a data de caixa), com valor,
-- conta, sentido, competência e centro de custo iguais. A DRE conta `open` e
-- `settled` igualmente (`_dre_lines_raw`): o resultado do mês fechado não
-- muda. (A baixa da Ortodontia COM desconto de pontualidade muda o valor e
-- continua barrada em mês fechado — achado registrado no backlog.)
--
-- PARA TRÁS: na produção não há cobrança de PPR+ nem de Ortodontia
-- (conferido em 09/11/2026). O treino ganha os lançamentos do PPR+ que já
-- existem (não duplica). Taxas NÃO são cobradas para trás: valem das baixas
-- feitas depois desta migração.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O guarda do mês fechado deixa a baixa passar
-- -----------------------------------------------------------------------------
create or replace function public.fiscal_period_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dates date[];
  v_d date;
begin
  -- Liquidação não é competência (ver o cabeçalho da 0231).
  if new.source_type in ('receipt_cash', 'payable_cash') then
    return new;
  end if;
  -- Patrimônio não é resultado: estoque e bens seguem entrando.
  if new.account_code like '6%' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Nada que mude dinheiro? Deixa passar (conciliação, por exemplo).
    if new.amount_cents is not distinct from old.amount_cents
       and new.direction is not distinct from old.direction
       and new.account_code is not distinct from old.account_code
       and new.accrual_date is not distinct from old.accrual_date
       and new.status is not distinct from old.status
       and new.cost_center_id is not distinct from old.cost_center_id then
      return new;
    end if;
    -- 0370: só a BAIXA (ou o desfazer) de um lançamento de lançamento único
    -- (mensalidades): a DRE conta 'open' e 'settled' igual, o mês fechado não
    -- muda de resultado — só o caixa, que não é competência.
    if old.status in ('open', 'settled') and new.status in ('open', 'settled')
       and new.amount_cents is not distinct from old.amount_cents
       and new.direction is not distinct from old.direction
       and new.account_code is not distinct from old.account_code
       and new.accrual_date is not distinct from old.accrual_date
       and new.cost_center_id is not distinct from old.cost_center_id then
      return new;
    end if;
    -- Tirar um lançamento de um mês fechado é tão proibido quanto pôr.
    v_dates := array[new.accrual_date, old.accrual_date];
  else
    v_dates := array[new.accrual_date];
  end if;

  foreach v_d in array v_dates loop
    if v_d is not null and exists (
      select 1 from public.fiscal_periods p
       where p.clinic_id = new.clinic_id
         and p.status = 'closed'
         and p.year = extract(year from v_d)::integer
         and p.month = extract(month from v_d)::integer
    ) then
      raise exception 'PERIOD_CLOSED';
    end if;
  end loop;

  return new;
end;
$$;
revoke execute on function public.fiscal_period_guard() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) O rastro das taxas ganha origem
-- -----------------------------------------------------------------------------
alter table public.split_charges
  add column if not exists source_type text not null default 'receipt',
  add column if not exists source_id uuid;

alter table public.split_charges alter column receipt_id drop not null;

update public.split_charges set source_id = receipt_id
 where source_id is null and receipt_id is not null;

alter table public.split_charges alter column source_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'split_charges_source_ok'
                    and conrelid = 'public.split_charges'::regclass) then
    alter table public.split_charges add constraint split_charges_source_ok check (
      source_type in ('receipt', 'ortho_charge', 'ppr_charge')
      and ((source_type = 'receipt') = (receipt_id is not null))
      and (source_type <> 'receipt' or source_id = receipt_id)
    );
  end if;
end $$;

create unique index if not exists split_charges_source_unique
  on public.split_charges (source_type, source_id, fee);

comment on column public.split_charges.source_type is
  '0370: de onde veio o dinheiro que pagou a taxa — receipt (baixa de parcela), ortho_charge ou ppr_charge (mensalidades).';

-- -----------------------------------------------------------------------------
-- 3) A conta das taxas, num lugar só
-- -----------------------------------------------------------------------------
-- O MESMO corpo da `apply_receipt_split` (0233), agora com a origem: período
-- do mês do dinheiro (mês fechado → mês aberto), franqueadora não paga a si
-- mesma, catálogo de taxas percentuais, regra do dia da baixa, campanha.
create or replace function public._apply_fee_split(
  p_clinic_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_amount_cents bigint,
  p_on date,
  p_reversed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee record;
  v_cfg record;
  v_period date := date_trunc('month', p_on)::date;
  v_old_period date;
  v_amount bigint;
  v_is_franchisor boolean;
begin
  -- RECEBER NUNCA PODE SER RECUSADO (0232): mês da baixa fechado → a taxa cai
  -- no mês aberto, como nota que chegou atrasada.
  if exists (
    select 1 from public.fiscal_periods p
     where p.clinic_id = p_clinic_id
       and p.status = 'closed'
       and p.year = extract(year from v_period)::integer
       and p.month = extract(month from v_period)::integer
  ) then
    v_period := date_trunc('month', public.today_br())::date;
  end if;

  select (c.type = 'franchisor') into v_is_franchisor
    from public.clinics c where c.id = p_clinic_id;
  if coalesce(v_is_franchisor, false) then
    return;  -- a franqueadora não paga taxa a si mesma
  end if;

  for v_fee in
    select key from public.network_fee_types
     where kind = 'percent' and active order by sort_order, key
  loop
    -- O mês em que a taxa desta origem estava (se já existia): ao estornar ou
    -- ao pagar de novo noutro mês, a conta a pagar do mês antigo é refeita.
    select period_month into v_old_period
      from public.split_charges
     where source_type = p_source_type and source_id = p_source_id and fee = v_fee.key;

    if p_reversed then
      update public.split_charges set reversed = true
       where source_type = p_source_type and source_id = p_source_id and fee = v_fee.key;
    else
      select * into v_cfg
        from public.network_fee_for(p_clinic_id, v_fee.key, p_on);
      continue when v_cfg is null or not v_cfg.active or v_cfg.percent <= 0;
      v_amount := round(p_amount_cents * v_cfg.percent / 100.0)::bigint;
      continue when v_amount <= 0;

      if p_source_type = 'receipt' then
        -- A baixa de parcela é imutável: a taxa dela nasce uma vez.
        insert into public.split_charges
          (clinic_id, receipt_id, source_type, source_id, fee, percent,
           base_cents, amount_cents, period_month)
        values
          (p_clinic_id, p_source_id, 'receipt', p_source_id, v_fee.key,
           v_cfg.percent, p_amount_cents, v_amount, v_period)
        on conflict do nothing;
      else
        -- A mensalidade pode ser paga de novo depois de desfeita: a taxa
        -- volta a valer, com a regra do novo dia.
        insert into public.split_charges
          (clinic_id, receipt_id, source_type, source_id, fee, percent,
           base_cents, amount_cents, period_month, reversed)
        values
          (p_clinic_id, null, p_source_type, p_source_id, v_fee.key,
           v_cfg.percent, p_amount_cents, v_amount, v_period, false)
        on conflict (source_type, source_id, fee) do update
           set percent = excluded.percent,
               base_cents = excluded.base_cents,
               amount_cents = excluded.amount_cents,
               period_month = excluded.period_month,
               reversed = false;
      end if;
    end if;

    perform public.refresh_network_fee_payable(p_clinic_id, v_fee.key, v_period);
    if v_old_period is not null and v_old_period <> v_period then
      perform public.refresh_network_fee_payable(p_clinic_id, v_fee.key, v_old_period);
    end if;
  end loop;
end;
$$;
revoke execute on function public._apply_fee_split(uuid, text, uuid, bigint, date, boolean)
  from public, anon, authenticated;

-- A baixa de parcela passa a usar a conta única (mesmo comportamento da 0233).
create or replace function public.apply_receipt_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Contra-lançamento de estorno não gera taxa: quem paga a conta é a baixa
  -- original, e ela é quem some quando o estorno acontece.
  if new.reversal_of is not null then
    return null;
  end if;
  perform public._apply_fee_split(
    new.clinic_id, 'receipt', new.id, new.amount_cents, new.received_at,
    coalesce(new.reversed, false)
  );
  return null;
end;
$$;
revoke execute on function public.apply_receipt_split() from public, anon, authenticated;

drop trigger if exists payment_receipts_split on public.payment_receipts;
create trigger payment_receipts_split
  after insert or update on public.payment_receipts
  for each row execute function public.apply_receipt_split();

-- -----------------------------------------------------------------------------
-- 4) As taxas nas mensalidades (Ortodontia e PPR+)
-- -----------------------------------------------------------------------------
create or replace function public.ortho_charge_fee_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paga' and (tg_op = 'INSERT' or old.status <> 'paga') then
    perform public._apply_fee_split(
      new.clinic_id, 'ortho_charge', new.id,
      coalesce(new.paid_amount_cents, new.amount_cents),
      coalesce(new.paid_on, (new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br()),
      false
    );
  elsif tg_op = 'UPDATE' and old.status = 'paga' and new.status <> 'paga' then
    perform public._apply_fee_split(
      new.clinic_id, 'ortho_charge', new.id, 0, public.today_br(), true
    );
  end if;
  return null;
end;
$$;
revoke execute on function public.ortho_charge_fee_split() from public, anon, authenticated;

drop trigger if exists ortho_charges_fee_split on public.ortho_charges;
create trigger ortho_charges_fee_split
  after insert or update on public.ortho_charges
  for each row execute function public.ortho_charge_fee_split();

create or replace function public.ppr_charge_fee_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paga' and (tg_op = 'INSERT' or old.status <> 'paga') then
    perform public._apply_fee_split(
      new.clinic_id, 'ppr_charge', new.id, new.amount_cents,
      coalesce((new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br()),
      false
    );
  elsif tg_op = 'UPDATE' and old.status = 'paga' and new.status <> 'paga' then
    perform public._apply_fee_split(
      new.clinic_id, 'ppr_charge', new.id, 0, public.today_br(), true
    );
  end if;
  return null;
end;
$$;
revoke execute on function public.ppr_charge_fee_split() from public, anon, authenticated;

drop trigger if exists ppr_charges_fee_split on public.ppr_charges;
create trigger ppr_charges_fee_split
  after insert or update on public.ppr_charges
  for each row execute function public.ppr_charge_fee_split();

-- -----------------------------------------------------------------------------
-- 5) A mensalidade do PPR+ no razão (conta 1.2.01) — como a Ortodontia
-- -----------------------------------------------------------------------------
create unique index if not exists financial_entries_ppr_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type = 'ppr_charge';

create or replace function public.ppr_charge_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash date;
begin
  if tg_op = 'INSERT' then
    if new.status = 'cancelada' then return null; end if;
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description
    ) values (
      new.clinic_id, '1.2.01', new.reference_month,
      case when new.status = 'paga'
           then coalesce((new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br()) end,
      new.due_date, new.amount_cents, 'inflow',
      case when new.status = 'paga' then 'settled' else 'open' end,
      'ppr_charge', new.id,
      'Mensalidade PPR+ ' || to_char(new.reference_month, 'MM/YYYY')
    )
    on conflict (source_type, source_id) where source_type = 'ppr_charge' do nothing;
    return null;
  end if;

  -- UPDATE
  if new.status = 'paga' and old.status <> 'paga' then
    v_cash := coalesce((new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br());
    update public.financial_entries
       set status = 'settled', cash_date = v_cash, updated_at = now()
     where source_type = 'ppr_charge' and source_id = new.id and status in ('open', 'cancelled');
  elsif old.status = 'paga' and new.status <> 'paga' then
    update public.financial_entries
       set status = case when new.status = 'cancelada' then 'cancelled' else 'open' end,
           cash_date = null,
           reversal_reason = case when new.status = 'cancelada' then 'Mensalidade cancelada' else 'Baixa desfeita' end,
           updated_at = now()
     where source_type = 'ppr_charge' and source_id = new.id and status = 'settled';
  elsif new.status = 'cancelada' and old.status <> 'cancelada' then
    update public.financial_entries
       set status = 'cancelled', updated_at = now()
     where source_type = 'ppr_charge' and source_id = new.id and status = 'open';
  elsif old.status = 'cancelada' and new.status <> 'cancelada' then
    update public.financial_entries
       set status = 'open', updated_at = now()
     where source_type = 'ppr_charge' and source_id = new.id and status = 'cancelled';
  end if;

  if new.amount_cents <> old.amount_cents then
    update public.financial_entries
       set amount_cents = new.amount_cents, updated_at = now()
     where source_type = 'ppr_charge' and source_id = new.id and status = 'open';
  end if;
  return null;
end;
$$;
revoke execute on function public.ppr_charge_ledger() from public, anon, authenticated;

drop trigger if exists ppr_charges_ledger on public.ppr_charges;
create trigger ppr_charges_ledger
  after insert or update on public.ppr_charges
  for each row execute function public.ppr_charge_ledger();

-- As mensalidades que já existem (só no treino: a produção tem zero). Mês
-- fechado fica de fora — o guarda recusaria, e inventar receita em mês
-- fechado é exatamente o que ele impede.
insert into public.financial_entries (
  clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
  amount_cents, direction, status, source_type, source_id, description
)
select c.clinic_id, '1.2.01', c.reference_month,
       case when c.status = 'paga'
            then coalesce((c.paid_at at time zone 'America/Sao_Paulo')::date, c.due_date) end,
       c.due_date, c.amount_cents, 'inflow',
       case when c.status = 'paga' then 'settled' else 'open' end,
       'ppr_charge', c.id,
       'Mensalidade PPR+ ' || to_char(c.reference_month, 'MM/YYYY')
  from public.ppr_charges c
 where c.status <> 'cancelada'
   and not exists (
     select 1 from public.fiscal_periods p
      where p.clinic_id = c.clinic_id and p.status = 'closed'
        and p.year = extract(year from c.reference_month)::integer
        and p.month = extract(month from c.reference_month)::integer)
on conflict (source_type, source_id) where source_type = 'ppr_charge' do nothing;

notify pgrst, 'reload schema';

-- Conferência (só leitura): esperado 2 · 0 · true · true · true · true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'split_charges'
      and column_name in ('source_type', 'source_id')) as colunas_2,
  (select count(*) from public.split_charges where source_id is null) as sem_origem_0,
  exists (select 1 from pg_trigger where tgname = 'ppr_charges_ledger') as razao_do_ppr,
  exists (select 1 from pg_trigger where tgname = 'ppr_charges_fee_split') as taxas_do_ppr,
  exists (select 1 from pg_trigger where tgname = 'ortho_charges_fee_split') as taxas_da_orto,
  not has_function_privilege('anon',
    'public._apply_fee_split(uuid,text,uuid,bigint,date,boolean)', 'execute') as sem_login_fechado;
