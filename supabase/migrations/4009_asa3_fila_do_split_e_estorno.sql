-- =============================================================================
-- 4009 — ASA3, ENTREGA 2: AS COBRANÇAS EM ABERTO, O ESTORNO E O WEBHOOK
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/integracao-asaas.md, 18.7 a 18.7.5.
--
--   * A FILA DO SPLIT (U1–U5): o que o split de cada cobrança em aberto deveria
--     ser HOJE (as taxas e a menor tarifa da janela) fica guardado no envio
--     (`charges.split_inputs`). Quando isso muda — taxa, acordo, campanha,
--     destino, tarifa, split habilitado, ou a virada do dia —, a cobrança entra
--     na fila; o servidor refaz a conta e manda SÓ o split ao Asaas (provado:
--     não muda nada para o pagador). Vencidas e de vencimento mais próximo
--     primeiro; 150 por conta a cada rodada. Nunca tira o split sozinho (U4);
--     todas as taxas em zero só com a confirmação do Financeiro ou do Admin.
--   * Diferença causada só por TARIFA do Asaas, em cobrança paga enquanto
--     esperava na fila, é absorvida (18.7.2).
--   * O ESTORNO (18.7.1, 18.7.4, U6): o pedido nasce no riSZon (quem a unidade
--     indicou; por padrão o Franqueado), fica "aguardando autorização" (Pix e
--     cartão) ou "aguardando o pagador" (boleto); o aviso de estorno concluído
--     desfaz o retido no razão e a taxa volta à conta a pagar (D13).
--   * SALDO da conta que recebe o split: negativo e abaixo do mínimo da rede
--     avisam o Financeiro.
--   * O WEBHOOK se corrige sozinho (18.7.5): a lista de avisos assinados tem
--     versão; desatualizado derruba a prontidão.
--
-- ⚠️ Nenhuma chamada ao Asaas sai do banco. Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O ESTADO DE CADA COBRANÇA
-- -----------------------------------------------------------------------------
alter table public.charges
  add column if not exists split_inputs jsonb,
  add column if not exists split_pending_since timestamptz,
  add column if not exists split_pending_reasons text[],
  add column if not exists split_next_try_at timestamptz,
  add column if not exists split_attempts integer not null default 0,
  add column if not exists split_error text,
  add column if not exists split_zero_pending boolean not null default false,
  add column if not exists split_zero_confirmed_at timestamptz,
  add column if not exists split_zero_confirmed_by uuid references public.profiles (id),
  add column if not exists split_absorb_tariff boolean not null default false,
  add column if not exists refund_state text check (refund_state in ('aguardando_autorizacao', 'aguardando_pagador'));
comment on column public.charges.split_inputs is
  'ASA3 (4009): as taxas por carteira e a menor tarifa da janela usadas no último split enviado. A fila compara com as de hoje.';
comment on column public.charges.refund_state is
  'ASA3 (4009): estorno pedido pelo riSZon e ainda não concluído. A cobrança continua paga até o aviso de estorno.';

create index if not exists charges_split_queue_idx on public.charges (gateway_account_id, split_next_try_at)
  where split_pending_since is not null;
create index if not exists charges_refund_state_idx on public.charges (refund_state) where refund_state is not null;

alter table public.charge_splits drop constraint if exists charge_splits_status_check;
alter table public.charge_splits add constraint charge_splits_status_check
  check (status in ('enviado', 'liquidado', 'cancelado', 'recusado', 'bloqueado', 'estornado'));

-- O histórico do split de cada cobrança (ajuste 7): quando e por quê.
create table if not exists public.charge_split_updates (
  id bigint generated always as identity primary key,
  charge_id uuid not null references public.charges (id) on delete cascade,
  at timestamptz not null default now(),
  reasons text[] not null,
  outcome text not null check (outcome in ('atualizado', 'acrescentado', 'removido', 'fora_da_janela', 'teto', 'reduzido_bloqueio')),
  before_entries jsonb,
  after_entries jsonb,
  actor uuid references public.profiles (id)
);
create index if not exists charge_split_updates_charge_idx on public.charge_split_updates (charge_id, at desc);
alter table public.charge_split_updates enable row level security;

-- -----------------------------------------------------------------------------
-- 2) O QUE O SPLIT DEVERIA SER HOJE
-- -----------------------------------------------------------------------------
-- As carteiras do plano (4008) + a MENOR tarifa da janela hoje→vencimento
-- (a mesma regra de `split.ts`). Ordenado, para comparar.
create or replace function public._charge_split_inputs(p_charge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb := public._charge_split_plan(p_charge_id);
  c public.charges%rowtype;
  v_ate date;
  v_tar record;
  v_mods text[];
begin
  if not coalesce((v_plan->>'elegivel')::boolean, false) then
    return jsonb_build_object('elegivel', false, 'motivo', v_plan->>'motivo');
  end if;
  select * into c from public.charges where id = p_charge_id;
  v_ate := greatest(c.due_date, public.today_br());
  v_mods := case c.billing_type when 'PIX' then array['pix'] when 'BOLETO' then array['boleto', 'pix'] else array['credito_avista'] end;
  select min(r.fee_percent) as a, min(r.fixed_fee_cents) as b into v_tar
    from public.acquirer_rates r
    join public.card_acquirers q on q.id = r.acquirer_id
   where q.gateway_account_id = c.gateway_account_id
     and r.modality = any (v_mods)
     and not (r.modality = 'credito_avista' and coalesce(r.min_installments, 1) > 1)
     and (r.valid_from is null or r.valid_from <= v_ate)
     and (r.valid_to is null or r.valid_to >= public.today_br());
  return jsonb_build_object(
    'elegivel', true,
    'carteiras', (select jsonb_agg(jsonb_build_object('walletId', x->>'walletId', 'percent', (x->>'percent')::numeric, 'fees', x->'fees')
                                   order by x->>'walletId')
                    from jsonb_array_elements(v_plan->'carteiras') x),
    'tarifa', jsonb_build_object('a', v_tar.a, 'b', v_tar.b));
end;
$$;
revoke execute on function public._charge_split_inputs(uuid) from public, anon, authenticated;

-- A emissão (4008) passa a guardar o que foi a base do split.
create or replace function public._charge_save_split(p_charge_id uuid, p_entries jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  x jsonb;
begin
  select * into c from public.charges where id = p_charge_id for update;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'SPLIT_EMPTY';
  end if;
  for x in select * from jsonb_array_elements(p_entries) loop
    insert into public.charge_splits (
      charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents,
      fees, tariff_percent, tariff_fixed_cents, asaas_split_id)
    values (
      c.id, (x->>'accountId')::uuid, x->>'walletId', (x->>'percent')::numeric,
      (x->>'percentualValue')::numeric, (x->>'fixedCents')::bigint, x->'fees',
      (x->>'tariffPercent')::numeric, (x->>'tariffFixedCents')::bigint, nullif(x->>'asaasSplitId', ''))
    on conflict (charge_id, wallet_id) do update set
      percent = excluded.percent, percentual_value = excluded.percentual_value,
      fixed_cents = excluded.fixed_cents, fees = excluded.fees,
      tariff_percent = excluded.tariff_percent, tariff_fixed_cents = excluded.tariff_fixed_cents,
      asaas_split_id = coalesce(excluded.asaas_split_id, charge_splits.asaas_split_id),
      updated_at = now();
  end loop;
  update public.charges
     set split_applied = true, split_skip_reason = null,
         split_inputs = public._charge_split_inputs(c.id)
   where id = c.id;
  update public.gateway_accounts set split_enabled_confirmed_at = coalesce(split_enabled_confirmed_at, now())
   where id = c.gateway_account_id;
end;
$$;
revoke execute on function public._charge_save_split(uuid, jsonb) from public, anon, authenticated;

-- As de antes (só treino): ganham a base de hoje, para a fila não as refazer à toa.
update public.charges c set split_inputs = public._charge_split_inputs(c.id)
 where c.split_applied and c.split_inputs is null and c.status in ('emitida', 'vencida');

-- -----------------------------------------------------------------------------
-- 3) PÔR NA FILA
-- -----------------------------------------------------------------------------
-- As cobranças que ainda podem mudar o split: em aberto (emitida ou vencida)
-- e o cartão já confirmado ainda longe do crédito (o Asaas só deixa até 1 dia
-- útil antes; folga de 2 dias corridos aqui — fora disso, a S5).
create or replace function public._charge_split_open(c public.charges)
returns boolean
language sql
stable
set search_path = ''
as $$
  select c.asaas_payment_id is not null and c.refund_state is null and (
    c.status in ('emitida', 'vencida')
    or (c.status = 'paga' and c.billing_type = 'CREDIT_CARD' and c.receipt_id is null
        and c.credit_date is not null and c.credit_date > public.today_br() + 2)
  );
$$;
revoke execute on function public._charge_split_open(public.charges) from public, anon, authenticated;

-- Compara a base de hoje com a do envio e marca as que mudaram. p_clinic nulo
-- = todas as unidades. Devolve quantas entraram na fila.
create or replace function public._gateway_split_enqueue(p_clinic_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_new jsonb;
  v_reason text;
  v_n integer := 0;
  v_zero_clinics uuid[] := '{}';
begin
  for c in
    select ch.* from public.charges ch
      join public.clinics k on k.id = ch.clinic_id and k.type = 'franchise_unit'
     where (p_clinic_id is null or ch.clinic_id = p_clinic_id)
       and ch.status in ('emitida', 'vencida', 'paga')
       and public._charge_split_open(ch)
  loop
    v_new := public._charge_split_inputs(c.id);
    if not coalesce((v_new->>'elegivel')::boolean, false) then
      -- U4: nunca tirar o split sozinho. Todas as taxas em zero: espera a
      -- confirmação do Financeiro ou do Admin; o resto: aviso.
      if c.split_applied then
        if v_new->>'motivo' = 'sem_taxa' then
          if not c.split_zero_pending then
            update public.charges set split_zero_pending = true where id = c.id;
            v_zero_clinics := v_zero_clinics || c.clinic_id;
          end if;
        else
          perform public._gateway_notify(c.gateway_account_id, 'split_perdido', public.today_br()::text, c.clinic_id, false, true, true,
            'Split: a unidade deixou de poder ter split',
            'Há cobranças em aberto com split numa unidade que deixou de cumprir o necessário (' || coalesce(v_new->>'motivo', '?') || '). O riSZon não tira o split sozinho; confira na Central.',
            '/central/rede/taxas');
        end if;
      end if;
      continue;
    end if;
    if c.split_inputs is not null and c.split_inputs = v_new then continue; end if;

    -- O motivo: só a tarifa mudou (carteiras iguais) ou as taxas/destinos.
    v_reason := case
      when not c.split_applied then 'split_habilitado'
      when c.split_inputs->'carteiras' = v_new->'carteiras' then 'tarifa'
      when p_reason in ('taxa', 'campanha', 'destino') then p_reason
      else 'taxa' end;
    update public.charges set
      split_pending_since = clock_timestamp(),
      split_pending_reasons = (select array(select distinct x from unnest(coalesce(split_pending_reasons, '{}') || v_reason) x)),
      split_next_try_at = coalesce(split_next_try_at, now()),
      split_zero_pending = false
     where id = c.id;
    v_n := v_n + 1;
  end loop;

  if coalesce(array_length(v_zero_clinics, 1), 0) > 0 then
    perform public._gateway_notify(public._gateway_account_of(x), 'split_zero', public.today_br()::text, x, false, true, true,
      'Split: todas as taxas em zero',
      'Todas as taxas da unidade foram a zero. O split das cobranças em aberto só é retirado com a confirmação do Financeiro ou do Admin, na aba Taxas da franquia.',
      '/central/unidades/' || x::text || '/taxas')
      from (select distinct unnest(v_zero_clinics) x) z;
  end if;
  return v_n;
end;
$$;
revoke execute on function public._gateway_split_enqueue(uuid, text) from public, anon, authenticated;

-- Os gatilhos (U1). Cada um diz a unidade afetada (nula = a rede toda).
create or replace function public._gateway_split_enqueue_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_reason text;
begin
  if tg_table_name = 'network_fees' then
    v_clinic := coalesce(new.clinic_id, old.clinic_id);
    v_reason := 'taxa';
    if tg_op = 'UPDATE' and new.clinic_id is not distinct from old.clinic_id and new.fee = old.fee
       and new.percent is not distinct from old.percent and new.active is not distinct from old.active
       and new.kind is not distinct from old.kind then
      return null;
    end if;
  elsif tg_table_name = 'network_fee_campaigns' then
    v_clinic := coalesce(new.clinic_id, old.clinic_id);
    v_reason := 'campanha';
  elsif tg_table_name = 'network_fee_types' then
    if tg_op = 'UPDATE' and new.split_account_id is not distinct from old.split_account_id
       and new.active is not distinct from old.active and new.kind is not distinct from old.kind then
      return null;
    end if;
    v_clinic := null;
    v_reason := 'destino';
  elsif tg_table_name = 'acquirer_rates' then
    select g.clinic_id into v_clinic
      from public.card_acquirers q join public.gateway_accounts g on g.id = q.gateway_account_id
     where q.id = coalesce(new.acquirer_id, old.acquirer_id);
    if v_clinic is null then return null; end if;
    v_reason := 'tarifa';
  elsif tg_table_name = 'gateway_accounts' then
    if new.clinic_id is null or (
         new.split_enabled_declared_at is not distinct from old.split_enabled_declared_at
         and new.split_enabled_confirmed_at is not distinct from old.split_enabled_confirmed_at) then
      return null;
    end if;
    v_clinic := new.clinic_id;
    v_reason := 'split_habilitado';
  else
    return null;
  end if;
  perform public._gateway_split_enqueue(v_clinic, v_reason);
  return null;
end;
$$;
revoke execute on function public._gateway_split_enqueue_trg() from public, anon, authenticated;

drop trigger if exists network_fees_split_queue on public.network_fees;
create trigger network_fees_split_queue after insert or update or delete on public.network_fees
  for each row execute function public._gateway_split_enqueue_trg();
drop trigger if exists network_fee_campaigns_split_queue on public.network_fee_campaigns;
create trigger network_fee_campaigns_split_queue after insert or update or delete on public.network_fee_campaigns
  for each row execute function public._gateway_split_enqueue_trg();
drop trigger if exists network_fee_types_split_queue on public.network_fee_types;
create trigger network_fee_types_split_queue after update on public.network_fee_types
  for each row execute function public._gateway_split_enqueue_trg();
drop trigger if exists acquirer_rates_split_queue on public.acquirer_rates;
create trigger acquirer_rates_split_queue after insert or update or delete on public.acquirer_rates
  for each row execute function public._gateway_split_enqueue_trg();
drop trigger if exists gateway_accounts_split_queue on public.gateway_accounts;
create trigger gateway_accounts_split_queue after update on public.gateway_accounts
  for each row execute function public._gateway_split_enqueue_trg();

-- A virada do dia (U2): campanha que começa ou acaba hoje, promoção que acaba.
create or replace function public._gateway_split_enqueue_daily()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public._gateway_split_enqueue(null, 'diaria');
$$;
revoke execute on function public._gateway_split_enqueue_daily() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) A FILA: tirar e devolver
-- -----------------------------------------------------------------------------
-- Até p_per_account por conta: VENCIDAS primeiro, depois o vencimento mais
-- próximo (ajuste 2). Também as de "todas as taxas em zero" já confirmadas.
create or replace function public._gateway_split_queue(p_per_account integer, p_clinic_id uuid default null)
returns table (charge_id uuid, account_id uuid, asaas_payment_id text, billing_type text, mode text,
               reasons text[], plan jsonb, inputs jsonb, started_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  with fila as (
    select ch.*, row_number() over (
             partition by ch.gateway_account_id
             order by (ch.status = 'vencida') desc, ch.due_date, ch.split_pending_since) as n
      from public.charges ch
     where (p_clinic_id is null or ch.clinic_id = p_clinic_id)
       and public._charge_split_open(ch)
       and ((ch.split_pending_since is not null and coalesce(ch.split_next_try_at, now()) <= now())
            or (ch.split_zero_pending and ch.split_zero_confirmed_at is not null))
  )
  select f.id, f.gateway_account_id, f.asaas_payment_id, f.billing_type,
         case when f.split_zero_pending and f.split_zero_confirmed_at is not null then 'remover' else 'atualizar' end,
         coalesce(f.split_pending_reasons, array['taxa']),
         public._charge_split_plan(f.id),
         public._charge_split_inputs(f.id),
         clock_timestamp()
    from fila f
   where f.n <= greatest(coalesce(p_per_account, 150), 1);
$$;
revoke execute on function public._gateway_split_queue(integer, uuid) from public, anon, authenticated;

-- O resultado de uma cobrança. Só limpa a fila se nada mudou desde o início.
create or replace function public._gateway_split_done(
  p_charge_id uuid,
  p_outcome text,
  p_entries jsonb,
  p_inputs jsonb,
  p_reasons text[],
  p_started_at timestamptz,
  p_error text,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_before jsonb;
  x jsonb;
begin
  select * into c from public.charges where id = p_charge_id for update;
  if not found then return; end if;

  if p_error is not null then
    update public.charges set
      split_attempts = split_attempts + 1,
      split_error = left(p_error, 120),
      split_next_try_at = now() + least(interval '6 hours', interval '10 minutes' * power(4, least(split_attempts, 4)))
     where id = c.id;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('walletId', s.wallet_id, 'percentualValue', s.percentual_value, 'fixedCents', s.fixed_cents)
                            order by s.wallet_id), '[]'::jsonb)
    into v_before from public.charge_splits s where s.charge_id = c.id;

  if p_outcome in ('atualizado', 'acrescentado', 'reduzido_bloqueio') then
    -- O que não foi mais enviado sai (cobrança em aberto: nada liquidado ainda).
    delete from public.charge_splits s
     where s.charge_id = c.id and s.status = 'enviado'
       and not exists (select 1 from jsonb_array_elements(p_entries) e where e->>'walletId' = s.wallet_id);
    for x in select * from jsonb_array_elements(p_entries) loop
      insert into public.charge_splits (
        charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents,
        fees, tariff_percent, tariff_fixed_cents, asaas_split_id)
      values (
        c.id, (x->>'accountId')::uuid, x->>'walletId', (x->>'percent')::numeric,
        (x->>'percentualValue')::numeric, (x->>'fixedCents')::bigint, x->'fees',
        (x->>'tariffPercent')::numeric, (x->>'tariffFixedCents')::bigint, nullif(x->>'asaasSplitId', ''))
      on conflict (charge_id, wallet_id) do update set
        percent = excluded.percent, percentual_value = excluded.percentual_value,
        fixed_cents = excluded.fixed_cents, fees = excluded.fees,
        tariff_percent = excluded.tariff_percent, tariff_fixed_cents = excluded.tariff_fixed_cents,
        asaas_split_id = coalesce(excluded.asaas_split_id, charge_splits.asaas_split_id),
        updated_at = now();
    end loop;
    update public.charges set split_applied = true, split_skip_reason = null where id = c.id;
  elsif p_outcome = 'removido' then
    delete from public.charge_splits s where s.charge_id = c.id and s.status = 'enviado';
    update public.charges set split_applied = false, split_skip_reason = 'sem_taxa',
           split_zero_pending = false where id = c.id;
  end if;

  -- 'igual': a conta refeita deu o mesmo split — sai da fila sem chamar o
  -- Asaas e sem linha no histórico.
  if p_outcome <> 'igual' then
    insert into public.charge_split_updates (charge_id, reasons, outcome, before_entries, after_entries, actor)
    values (c.id, coalesce(p_reasons, '{}'), p_outcome, v_before,
            case when p_outcome = 'removido' then '[]'::jsonb else p_entries end, p_actor);
  end if;

  update public.charges set
    split_inputs = coalesce(p_inputs, split_inputs),
    split_attempts = 0, split_error = null,
    split_pending_since = case when split_pending_since <= p_started_at then null else split_pending_since end,
    split_pending_reasons = case when split_pending_since <= p_started_at then null else split_pending_reasons end,
    split_next_try_at = case when split_pending_since <= p_started_at then null else now() end
   where id = c.id;
end;
$$;
revoke execute on function public._gateway_split_done(uuid, text, jsonb, jsonb, text[], timestamptz, text, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) PAGA ENQUANTO ESPERAVA A FILA (18.7.2) e o BLOQUEIO (U7)
-- -----------------------------------------------------------------------------
-- Paga com a fila pendente só por TARIFA: a falta é absorvida. A baixa nasce.
create or replace function public._gateway_charge_split_on_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.split_applied and new.receipt_id is not null and old.receipt_id is distinct from new.receipt_id then
    if new.split_pending_since is not null and new.split_pending_reasons <@ array['tarifa', 'diaria'] then
      update public.charges set split_absorb_tariff = true where id = new.id;
    end if;
    perform public._gateway_split_retention(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public._gateway_charge_split_on_receipt() from public, anon, authenticated;

-- A retenção (4008) com a tarifa absorvida: mesmo corpo, mais uma condição.
create or replace function public._gateway_split_retention(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_tol bigint;
  v_short bigint := 0;
  s record;
  w record;
  v_new bigint;
  v_settled date;
  v_touched text[] := '{}';
  v_key text;
  v_frozen boolean;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or c.receipt_id is null or not c.split_applied then return; end if;
  select tolerance_cents into v_tol from public.gateway_split_settings where id;
  v_tol := coalesce(v_tol, 10);

  update public.split_charges set charge_id = c.id
   where source_type = 'receipt' and source_id = c.receipt_id and charge_id is distinct from c.id;

  for w in
    select cs.*,
           (select coalesce(sum(sc.amount_cents), 0) from public.split_charges sc
             where sc.charge_id = c.id and not sc.reversed and cs.fees ? sc.fee) as expected
      from public.charge_splits cs where cs.charge_id = c.id
  loop
    if w.status = 'liquidado' and w.settled_cents is not null then
      v_short := v_short + greatest(w.expected - w.settled_cents, 0);
      if w.settled_cents > w.expected and w.excess_cents is distinct from (w.settled_cents - w.expected) then
        update public.charge_splits set excess_cents = w.settled_cents - w.expected, updated_at = now() where id = w.id;
        perform public._gateway_notify(c.gateway_account_id, 'repasse_a_maior', w.id::text, c.clinic_id, false, true, true,
          'Split: repasse acima do devido',
          'Uma cobrança repassou à rede mais do que as taxas vigentes no dia do pagamento (provável mudança de taxa com a cobrança em aberto). Confira no Painel de repasses e decida entre abater ou dispensar.',
          '/prontuarios/' || c.client_id::text);
      end if;
    end if;
  end loop;
  -- 18.7.2: paga enquanto esperava a fila só por tarifa — a falta é absorvida.
  if c.split_absorb_tariff then v_short := 0; end if;

  for s in
    select sc.*, cs.status as w_status, cs.settled_cents as w_settled, cs.settled_at as w_settled_at,
           (select coalesce(sum(x.amount_cents), 0) from public.split_charges x
             where x.charge_id = c.id and not x.reversed and cs.fees ? x.fee) as w_expected
      from public.split_charges sc
      left join public.charge_splits cs on cs.charge_id = c.id and cs.fees ? sc.fee
     where sc.charge_id = c.id
  loop
    v_frozen := s.w_status = 'liquidado' and exists (
      select 1 from public.financial_entries f
       where f.source_type = 'split_retained' and f.source_id = s.id and f.status = 'settled');
    continue when v_frozen;
    v_new := case
      when s.reversed or s.w_status is null then 0
      when s.w_status in ('cancelado', 'recusado', 'estornado') then 0
      when s.w_status = 'liquidado' and s.w_settled is not null and v_short > v_tol and s.w_expected > 0
        then floor(s.amount_cents * least(s.w_settled, s.w_expected)::numeric / s.w_expected)::bigint
      else s.amount_cents
    end;
    v_settled := case when s.w_status = 'liquidado' then (s.w_settled_at at time zone 'America/Sao_Paulo')::date end;
    if v_new is distinct from s.retained_cents then
      update public.split_charges set retained_cents = v_new where id = s.id;
      v_key := s.fee || '|' || s.period_month::text;
      if not (v_key = any (v_touched)) then v_touched := v_touched || v_key; end if;
    end if;
    if v_new > 0 or exists (select 1 from public.financial_entries f where f.source_type = 'split_retained' and f.source_id = s.id) then
      perform public._gateway_split_ledger(s.id, v_settled);
    end if;
  end loop;

  foreach v_key in array v_touched loop
    perform public.refresh_network_fee_payable(c.clinic_id, split_part(v_key, '|', 1), split_part(v_key, '|', 2)::date);
  end loop;
end;
$$;
revoke execute on function public._gateway_split_retention(uuid) from public, anon, authenticated;

-- O bloqueio por divergência (U7): o servidor pega estas cobranças e reenvia
-- o split reduzido ao líquido real. A falta segue a S5 na liquidação.
create or replace function public._gateway_split_blocked()
returns table (charge_id uuid, account_id uuid, asaas_payment_id text, plan jsonb, started_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select distinct ch.id, ch.gateway_account_id, ch.asaas_payment_id, public._charge_split_plan(ch.id), clock_timestamp()
    from public.charges ch
    join public.charge_splits cs on cs.charge_id = ch.id and cs.status = 'bloqueado'
   where ch.asaas_payment_id is not null
     and not exists (select 1 from public.charge_split_updates u
                      where u.charge_id = ch.id and u.outcome = 'reduzido_bloqueio' and u.at > cs.updated_at);
$$;
revoke execute on function public._gateway_split_blocked() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) O ESTORNO (18.7.1, 18.7.4, U6)
-- -----------------------------------------------------------------------------
-- Quem a unidade indica como tendo o acesso de autorização do Asaas.
alter table public.gateway_accounts
  add column if not exists refund_roles public.user_role[] not null default array['franchisee']::public.user_role[];
alter table public.gateway_accounts drop constraint if exists gateway_accounts_refund_roles_check;
alter table public.gateway_accounts add constraint gateway_accounts_refund_roles_check
  check (refund_roles <@ array['franchisee', 'unit_manager']::public.user_role[]);

create table if not exists public.charge_refunds (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges (id),
  clinic_id uuid not null references public.clinics (id),
  kind text not null check (kind in ('pix', 'cartao', 'boleto')),
  reason text not null check (length(btrim(reason)) >= 5),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  request_url text,
  asaas_status text,
  status text not null default 'pedido'
    check (status in ('pedido', 'concluido', 'negado', 'cancelado', 'falhou')),
  finished_at timestamptz,
  status_note text,
  late_notice_at timestamptz
);
create index if not exists charge_refunds_charge_idx on public.charge_refunds (charge_id);
create unique index if not exists charge_refunds_one_open on public.charge_refunds (charge_id) where status = 'pedido';
alter table public.charge_refunds enable row level security;

-- A permissão nova (nasce com o Admin Master; o teto e o padrão de fábrica
-- deixam o Franqueado e o Gerente — e a UNIDADE escolhe quais, na Central).
create or replace function public._gateway_cap_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'acao.cobranca.selo_atraso' then array['unit_manager','franchisee']::public.user_role[]
    when 'modulo.painel_cobrancas' then '{}'::public.user_role[]
    when 'acao.cobranca.estorno' then array['franchisee','unit_manager']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._gateway_cap_default_roles(text) from public, anon, authenticated;

create or replace function public._gateway_cap_ceiling(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'acao.cobranca.selo_atraso' then
      array['unit_manager','franchisee','receptionist','commercial_consultant',
            'commercial_assistant','finance_franchisor']::public.user_role[]
    when 'modulo.painel_cobrancas' then
      array['unit_manager','franchisee','finance_franchisor']::public.user_role[]
    when 'acao.cobranca.estorno' then
      array['franchisee','unit_manager']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._gateway_cap_ceiling(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select 'acao.cobranca.estorno', r from unnest(public._gateway_cap_default_roles('acao.cobranca.estorno')) r
    on conflict (capability, role) do nothing;
  end if;
end;
$$;
insert into public.permission_defaults (capability, roles)
values ('acao.cobranca.estorno', public._gateway_cap_default_roles('acao.cobranca.estorno'))
on conflict (capability) do nothing;

-- Pode pedir o estorno nesta unidade? Admin Master sempre; os demais: a
-- permissão (matriz) E o papel indicado pela unidade.
create or replace function public._charge_refund_can(p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_roles public.user_role[];
  v_clinics uuid[];
begin
  if public.is_admin_master() then return true; end if;
  v_clinics := public._gateway_cap_clinics('acao.cobranca.estorno');
  if v_clinics is not null and not (p_clinic_id = any (v_clinics)) then return false; end if;
  select g.refund_roles into v_roles from public.gateway_accounts g where g.id = public._gateway_account_of(p_clinic_id);
  return exists (
    select 1 from public.user_clinic_roles ucr
     where ucr.user_id = (select auth.uid()) and ucr.clinic_id = p_clinic_id
       and ucr.role = any (coalesce(v_roles, '{}')));
end;
$$;
revoke execute on function public._charge_refund_can(uuid) from public, anon, authenticated;

-- A PORTA: confere e devolve o que o servidor precisa para pedir ao Asaas.
create or replace function public.charge_refund_check(p_charge_id uuid, p_reason text)
returns table (charge_id uuid, account_id uuid, asaas_payment_id text, billing_type text, clinic_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_refund_can(c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if c.status not in ('paga', 'liquidada') or c.asaas_payment_id is null or c.is_external then
    raise exception 'NOT_REFUNDABLE';
  end if;
  if c.refund_state is not null or exists (select 1 from public.charge_refunds r where r.charge_id = c.id and r.status = 'pedido') then
    raise exception 'REFUND_PENDING';
  end if;
  return query select c.id, c.gateway_account_id, c.asaas_payment_id, c.billing_type, c.clinic_id;
end;
$$;
revoke execute on function public.charge_refund_check(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_refund_check(uuid, text) to authenticated;

-- O pedido aceito pelo Asaas (só o servidor grava).
create or replace function public._charge_refund_requested(
  p_charge_id uuid, p_actor uuid, p_reason text, p_kind text, p_asaas_status text, p_request_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_id uuid;
begin
  select * into c from public.charges where id = p_charge_id for update;
  insert into public.charge_refunds (charge_id, clinic_id, kind, reason, requested_by, request_url, asaas_status)
  values (c.id, c.clinic_id, p_kind, btrim(p_reason), p_actor, p_request_url, p_asaas_status)
  returning id into v_id;
  update public.charges set
    refund_state = case when p_kind = 'boleto' then 'aguardando_pagador' else 'aguardando_autorizacao' end
   where id = c.id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_actor, c.clinic_id, 'create', 'charge_refund', c.id::text,
          jsonb_build_object('reason', btrim(p_reason), 'kind', p_kind, 'asaas_status', p_asaas_status));
  return v_id;
end;
$$;
revoke execute on function public._charge_refund_requested(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Fim do pedido SEM estorno (negado, cancelado, falhou): a cobrança volta a
-- "Paga" e avisa quem pediu (e o Financeiro, quando negado ou com falha).
create or replace function public._charge_refund_closed(p_charge_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.charge_refunds%rowtype;
  c public.charges%rowtype;
  v_title text;
begin
  select * into r from public.charge_refunds where charge_id = p_charge_id and status = 'pedido' for update;
  if not found then return; end if;
  select * into c from public.charges where id = p_charge_id;
  update public.charge_refunds set status = p_status, finished_at = now(), status_note = left(p_note, 200) where id = r.id;
  update public.charges set refund_state = null where id = p_charge_id;
  v_title := case p_status when 'negado' then 'Estorno negado pelo Asaas'
                           when 'cancelado' then 'Pedido de estorno cancelado'
                           else 'Estorno não concluído' end;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  values (r.requested_by, c.clinic_id, v_title,
          'O estorno pedido não aconteceu (' || coalesce(p_note, p_status) || '). A cobrança continua paga.',
          '/prontuarios/' || c.client_id::text);
  if p_status in ('negado', 'falhou') then
    perform public._gateway_notify(c.gateway_account_id, 'estorno_' || p_status, r.id::text, c.clinic_id, false, true, false,
      v_title, 'O estorno pedido no riSZon não aconteceu (' || coalesce(p_note, p_status) || '). A cobrança continua paga.',
      '/prontuarios/' || c.client_id::text);
  end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (null, c.clinic_id, 'update', 'charge_refund', c.id::text, jsonb_build_object('result', p_status, 'note', p_note));
end;
$$;
revoke execute on function public._charge_refund_closed(uuid, text, text) from public, anon, authenticated;

-- U6: o estorno concluído de uma cobrança COM split. O Asaas devolveu o split
-- (a franqueadora devolveu à unidade): o retido já liquidado é estornado no
-- razão e a taxa volta à conta a pagar (D13). Chamado pelo aviso.
create or replace function public._gateway_split_refunded(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  s record;
  v_touched text[] := '{}';
  v_key text;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or not c.split_applied then return; end if;
  update public.charge_splits set status = 'estornado', updated_at = now()
   where charge_id = c.id and status in ('enviado', 'liquidado', 'bloqueado');
  for s in select * from public.split_charges where charge_id = c.id and retained_cents > 0 loop
    -- O razão liquidado não muda: lança a contrapartida (0185).
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date, amount_cents,
      direction, status, source_type, source_id, description, reversal_of, reversal_reason, bank_account_id)
    select f.clinic_id, f.account_code, public.today_br(), public.today_br(), public.today_br(), f.amount_cents,
           case when f.direction = 'inflow' then 'outflow' else 'inflow' end,
           'settled', f.source_type || '_estorno', s.id,
           'Estorno do split — ' || coalesce(f.description, ''), f.id, 'Estorno da cobrança no Asaas', f.bank_account_id
      from public.financial_entries f
     where f.source_type in ('split_retained', 'split_retained_revenue') and f.source_id = s.id
       and f.status = 'settled' and f.reversal_of is null
       and not exists (select 1 from public.financial_entries x where x.reversal_of = f.id);
    update public.financial_entries set status = 'cancelled'
     where source_type in ('split_retained', 'split_retained_revenue') and source_id = s.id and status = 'open';
    update public.split_charges set retained_cents = 0 where id = s.id;
    v_key := s.fee || '|' || s.period_month::text;
    if not (v_key = any (v_touched)) then v_touched := v_touched || v_key; end if;
  end loop;
  foreach v_key in array v_touched loop
    perform public.refresh_network_fee_payable(c.clinic_id, split_part(v_key, '|', 1), split_part(v_key, '|', 2)::date);
  end loop;
  -- A conta que recebeu o split precisa ter o saldo conferido (18.7.4).
  update public.gateway_accounts g set balance_checked_at = null
   where g.id in (select destination_account_id from public.charge_splits where charge_id = c.id);
end;
$$;
revoke execute on function public._gateway_split_refunded(uuid) from public, anon, authenticated;

-- Os avisos do estorno (o processador da 4005 já desfez a baixa no REFUNDED).
create or replace function public._gateway_event_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_ref text := new.payload->'payment'->>'externalReference';
begin
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  select * into c from public.charges where id = v_ref::uuid and gateway_account_id = new.account_id;
  if not found then return null; end if;
  if new.event = 'PAYMENT_REFUNDED' then
    perform public._gateway_split_refunded(c.id);
    update public.charge_refunds set status = 'concluido', finished_at = now(), asaas_status = 'DONE'
     where charge_id = c.id and status = 'pedido';
    update public.charges set refund_state = null where id = c.id;
    update public.gateway_webhook_events set result = coalesce(result, '') || '+split' where id = new.id and c.split_applied;
  elsif new.event = 'PAYMENT_REFUND_DENIED' then
    perform public._charge_refund_closed(c.id, 'negado', 'negado pelo Asaas');
    update public.gateway_webhook_events set result = 'estorno_negado' where id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public._gateway_event_refund() from public, anon, authenticated;

drop trigger if exists gateway_webhook_events_refund on public.gateway_webhook_events;
create trigger gateway_webhook_events_refund
  after update of processed_at on public.gateway_webhook_events
  for each row
  when (old.processed_at is null and new.processed_at is not null
        and new.event in ('PAYMENT_REFUNDED', 'PAYMENT_REFUND_DENIED'))
  execute function public._gateway_event_refund();

-- Os pedidos que a rotina diária consulta no Asaas.
create or replace function public._charge_refunds_open()
returns table (charge_id uuid, account_id uuid, asaas_payment_id text, kind text, requested_at timestamptz,
               late boolean, late_notice_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.charge_id, c.gateway_account_id, c.asaas_payment_id, r.kind, r.requested_at,
         public.add_business_days((r.requested_at at time zone 'America/Sao_Paulo')::date, 1) < public.today_br(),
         r.late_notice_at
    from public.charge_refunds r join public.charges c on c.id = r.charge_id
   where r.status = 'pedido';
$$;
revoke execute on function public._charge_refunds_open() from public, anon, authenticated;

-- Aviso de pedido parado há mais de 1 dia útil (uma vez).
create or replace function public._charge_refund_late(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.charge_refunds%rowtype;
  c public.charges%rowtype;
begin
  select * into r from public.charge_refunds where charge_id = p_charge_id and status = 'pedido' and late_notice_at is null for update;
  if not found then return; end if;
  select * into c from public.charges where id = p_charge_id;
  update public.charge_refunds set late_notice_at = now() where id = r.id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  values (r.requested_by, c.clinic_id, 'Estorno parado no Asaas',
          case when r.kind = 'boleto' then 'O pagador ainda não informou os dados bancários no link do Asaas. Envie o link de novo ou cancele no painel do Asaas.'
               else 'O estorno pedido ainda espera a autorização no Asaas (o código do titular da conta). Autorize ou cancele no painel do Asaas.' end,
          '/prontuarios/' || c.client_id::text);
  perform public._gateway_notify(c.gateway_account_id, 'estorno_parado', r.id::text, c.clinic_id, false, true, false,
    'Estorno parado no Asaas', 'Um estorno pedido no riSZon está parado há mais de 1 dia útil.', '/prontuarios/' || c.client_id::text);
end;
$$;
revoke execute on function public._charge_refund_late(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) O SALDO DA CONTA QUE RECEBE O SPLIT (18.7.4)
-- -----------------------------------------------------------------------------
alter table public.gateway_split_settings
  add column if not exists min_balance_cents bigint check (min_balance_cents is null or min_balance_cents >= 0);

-- As contas a conferir: as que recebem split (franqueadora e recebedoras).
create or replace function public._gateway_split_balance_accounts()
returns table (account_id uuid, label text, min_balance_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.label,
         case when g.owner_type = 'franchisor' then (select s.min_balance_cents from public.gateway_split_settings s where s.id) end
    from public.gateway_accounts g
   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and g.api_key_secret_id is not null
     and exists (select 1 from public.charge_splits cs where cs.destination_account_id = g.id);
$$;
revoke execute on function public._gateway_split_balance_accounts() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) O WEBHOOK QUE SE CORRIGE SOZINHO (18.7.5)
-- -----------------------------------------------------------------------------
alter table public.gateway_accounts
  add column if not exists webhook_events_version integer,
  add column if not exists webhook_events_ok boolean,
  add column if not exists webhook_events_checked_at timestamptz;

create or replace function public._gateway_webhook_events_mark(p_account_id uuid, p_ok boolean, p_version integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gateway_accounts set
    webhook_events_ok = p_ok,
    webhook_events_version = case when p_ok then p_version else webhook_events_version end,
    webhook_events_checked_at = now()
   where id = p_account_id;
$$;
revoke execute on function public._gateway_webhook_events_mark(uuid, boolean, integer) from public, anon, authenticated;

-- A prontidão: webhook desatualizado derruba o item "Webhook ativo".
create or replace function public._central_readiness_raw(p_clinic_id uuid)
returns table(item text, ok boolean, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_today date := public.today_br();
  v_has_account boolean;
begin
  select a.* into v_acc
    from public.gateway_accounts a
   where a.id = public._gateway_account_of(p_clinic_id);
  v_has_account := found;

  return query
  select 'conta_validada'::text,
         coalesce(v_has_account and v_acc.status = 'active' and v_acc.last_check_ok is not false, false),
         10
  union all
  select 'wallet_id',
         coalesce(v_has_account and length(coalesce(v_acc.wallet_id, '')) > 0, false),
         20
  union all
  select 'webhook_ativo',
         coalesce(v_has_account and v_acc.webhook_id is not null and v_acc.webhook_token_secret_id is not null
                  and v_acc.webhook_events_ok is not false, false),
         30
  union all
  select 'tarifas',
         coalesce(v_has_account and exists (
           select 1
             from public.card_acquirers c
             join public.acquirer_rates r on r.acquirer_id = c.id
            where c.gateway_account_id = v_acc.id
              and r.valid_from <= v_today
              and (r.valid_to is null or r.valid_to >= v_today)
         ), false),
         40
  union all
  select 'chave_pix',
         coalesce(v_has_account and v_acc.pix_key_active is true, false),
         50
  union all
  select 'split_habilitado',
         coalesce(v_has_account and (v_acc.split_enabled_confirmed_at is not null
                                     or v_acc.split_enabled_declared_at is not null), false),
         60
  union all
  select 'termo_registrado',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor'
                                     or v_acc.term_registered_at is not null), false),
         70
  union all
  select 'antecipacao_desligada',
         coalesce(v_has_account and v_acc.anticipation_auto_enabled is false, false),
         80;
end;
$$;
revoke execute on function public._central_readiness_raw(uuid) from public, anon, authenticated;

-- As contas cujo webhook precisa ser conferido (versão diferente ou semana).
create or replace function public._gateway_webhook_accounts(p_version integer)
returns table (account_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id from public.gateway_accounts g
   where g.status = 'active' and g.webhook_id is not null and g.api_key_secret_id is not null
     and (g.webhook_events_version is distinct from p_version
          or g.webhook_events_ok is not true
          or g.webhook_events_checked_at is null
          or g.webhook_events_checked_at < now() - interval '7 days');
$$;
revoke execute on function public._gateway_webhook_accounts(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) AS PORTAS DAS TELAS
-- -----------------------------------------------------------------------------
-- O retrato da unidade na aba Taxas da franquia: pode ter split? a fila, as
-- cobranças com todas as taxas em zero, as últimas atualizações.
create or replace function public.gateway_split_unit_overview(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_motivo text;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor() or public.can_see_clinic_finance(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_acc from public.gateway_accounts where id = public._gateway_account_of(p_clinic_id);
  v_motivo := case
    when v_acc.id is null then 'sem_conta'
    when (select type from public.clinics where id = p_clinic_id) is distinct from 'franchise_unit' then 'franqueadora'
    when v_acc.split_enabled_declared_at is null and v_acc.split_enabled_confirmed_at is null then 'split_nao_habilitado'
    else null end;
  return jsonb_build_object(
    'podeSplit', v_motivo is null,
    'motivo', v_motivo,
    'splitConfirmado', v_acc.split_enabled_confirmed_at is not null,
    'naFila', (select count(*) from public.charges ch where ch.clinic_id = p_clinic_id and ch.split_pending_since is not null and public._charge_split_open(ch)),
    'comErro', (select count(*) from public.charges ch where ch.clinic_id = p_clinic_id and ch.split_error is not null and ch.split_pending_since is not null),
    'todasEmZero', (select count(*) from public.charges ch where ch.clinic_id = p_clinic_id and ch.split_zero_pending and ch.split_zero_confirmed_at is null and public._charge_split_open(ch)),
    'comSplit', (select count(*) from public.charges ch where ch.clinic_id = p_clinic_id and ch.split_applied and public._charge_split_open(ch)),
    'refundRoles', to_jsonb(coalesce(v_acc.refund_roles, '{}')),
    'ultimas', (select coalesce(jsonb_agg(jsonb_build_object('at', u.at, 'reasons', u.reasons, 'outcome', u.outcome) order by u.at desc), '[]'::jsonb)
                  from (select u.* from public.charge_split_updates u join public.charges ch on ch.id = u.charge_id
                         where ch.clinic_id = p_clinic_id order by u.at desc limit 10) u));
end;
$$;
revoke execute on function public.gateway_split_unit_overview(uuid) from public, anon, authenticated;
grant execute on function public.gateway_split_unit_overview(uuid) to authenticated;

-- "Atualizar agora" (U8): só confere quem pode; o servidor roda a fila e
-- registra o uso (ajuste 6) por `gateway_split_log_run`.
create or replace function public.gateway_split_run_check(p_clinic_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  return public._gateway_account_of(p_clinic_id);
end;
$$;
revoke execute on function public.gateway_split_run_check(uuid) from public, anon, authenticated;
grant execute on function public.gateway_split_run_check(uuid) to authenticated;

create or replace function public._gateway_split_log_run(p_actor uuid, p_clinic_id uuid, p_changed integer, p_checked integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_actor, p_clinic_id, 'update', 'gateway_split_run', p_clinic_id::text,
          jsonb_build_object('alteradas', p_changed, 'conferidas', p_checked));
$$;
revoke execute on function public._gateway_split_log_run(uuid, uuid, integer, integer) from public, anon, authenticated;

-- Todas as taxas em zero: o Financeiro ou o Admin confirma a retirada (U4).
create or replace function public.gateway_split_zero_confirm(p_clinic_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  update public.charges ch set split_zero_confirmed_at = now(), split_zero_confirmed_by = (select auth.uid())
   where ch.clinic_id = p_clinic_id and ch.split_zero_pending and ch.split_zero_confirmed_at is null;
  get diagnostics v_n = row_count;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), p_clinic_id, 'update', 'gateway_split_zero', p_clinic_id::text,
          jsonb_build_object('reason', btrim(p_reason), 'cobrancas', v_n));
  return v_n;
end;
$$;
revoke execute on function public.gateway_split_zero_confirm(uuid, text) from public, anon, authenticated;
grant execute on function public.gateway_split_zero_confirm(uuid, text) to authenticated;

-- Quem tem o acesso de autorização do Asaas na unidade (só o Admin Master).
create or replace function public.gateway_refund_roles_set(p_clinic_id uuid, p_roles text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  update public.gateway_accounts set refund_roles = p_roles::public.user_role[], updated_at = now()
   where id = public._gateway_account_of(p_clinic_id);
  if not found then raise exception 'CLINIC_INVALID'; end if;
end;
$$;
revoke execute on function public.gateway_refund_roles_set(uuid, text[]) from public, anon, authenticated;
grant execute on function public.gateway_refund_roles_set(uuid, text[]) to authenticated;

-- O saldo mínimo da franqueadora (em branco = sem aviso).
create or replace function public.gateway_split_min_balance_set(p_min_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  update public.gateway_split_settings set min_balance_cents = p_min_cents, updated_at = now(), updated_by = (select auth.uid())
   where id and min_balance_cents is distinct from p_min_cents;
end;
$$;
revoke execute on function public.gateway_split_min_balance_set(bigint) from public, anon, authenticated;
grant execute on function public.gateway_split_min_balance_set(bigint) to authenticated;

-- A cobrança na ficha: o histórico do split e o estorno (quem vê o financeiro).
create or replace function public.charge_split_history(p_charge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or not (public.is_admin_master() or public.can_see_clinic_finance(c.clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  return jsonb_build_object(
    'updates', (select coalesce(jsonb_agg(jsonb_build_object('at', u.at, 'reasons', u.reasons, 'outcome', u.outcome) order by u.at desc), '[]'::jsonb)
                  from public.charge_split_updates u where u.charge_id = c.id),
    'naFila', c.split_pending_since is not null,
    'refundState', c.refund_state,
    'refund', (select to_jsonb(r) - 'requested_by' || jsonb_build_object('podeVerLink', true)
                 from public.charge_refunds r where r.charge_id = c.id order by r.requested_at desc limit 1),
    'podePedirEstorno', public._charge_refund_can(c.clinic_id) and c.status in ('paga', 'liquidada')
                         and c.refund_state is null and c.asaas_payment_id is not null and not c.is_external);
end;
$$;
revoke execute on function public.charge_split_history(uuid) from public, anon, authenticated;
grant execute on function public.charge_split_history(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 10) O ESTORNO DE BOLETO E O CELULAR DO PAGADOR (decisão do dono, 13/11/2026)
-- -----------------------------------------------------------------------------
-- O Asaas só estorna boleto com o CELULAR do pagador cadastrado nele (manda um
-- SMS com o link para os dados bancários). Regras (18.7.7):
--   * o celular é o do pagador da ficha (o responsável financeiro, quando há),
--     mostrado na tela antes de confirmar; sem celular válido, não sai;
--   * enviar o celular NÃO liga aviso: os avisos do pagador ficam como estavam;
--   * exige a declaração do termo de privacidade (a mesma da régua);
--   * com a régua da unidade DESLIGADA, o celular é apagado no Asaas quando o
--     estorno termina (concluído, negado ou cancelado) — o método da D6;
--   * auditoria: enviado e apagado, por quem e quando, SEM o número.
alter table public.charge_refunds
  add column if not exists mobile_sent_at timestamptz,
  add column if not exists mobile_sent_by uuid references public.profiles (id),
  add column if not exists mobile_clear_needed boolean not null default false,
  add column if not exists mobile_cleared_at timestamptz;

-- O pagador da cobrança e o que o estorno de boleto precisa saber dele.
create or replace function public._charge_refund_payer(p_charge_id uuid)
returns table (gateway_customer_id uuid, asaas_customer_id text, mobile text, avisos_ligados boolean,
               regua_da_unidade boolean, termo_declarado boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.asaas_customer_id,
         (select x.mobile from public._gateway_customer_contact(k.id) x),
         coalesce(k.regua_applied_on, false),
         public._gateway_regua_unit_on(c.gateway_account_id),
         exists (select 1 from public.gateway_notification_settings s where s.id and s.privacy_declared_at is not null)
    from public.charges c
    join public.gateway_customers k on k.id = c.gateway_customer_id
   where c.id = p_charge_id;
$$;
revoke execute on function public._charge_refund_payer(uuid) from public, anon, authenticated;

-- A PORTA (redefinida): no boleto, o termo e o celular válido são exigidos.
create or replace function public.charge_refund_check(p_charge_id uuid, p_reason text)
returns table (charge_id uuid, account_id uuid, asaas_payment_id text, billing_type text, clinic_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  p record;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_refund_can(c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if c.status not in ('paga', 'liquidada') or c.asaas_payment_id is null or c.is_external then
    raise exception 'NOT_REFUNDABLE';
  end if;
  if c.refund_state is not null or exists (select 1 from public.charge_refunds r where r.charge_id = c.id and r.status = 'pedido') then
    raise exception 'REFUND_PENDING';
  end if;
  if c.billing_type = 'BOLETO' then
    select * into p from public._charge_refund_payer(c.id);
    if not coalesce(p.termo_declarado, false) then raise exception 'PRIVACY_NOT_DECLARED'; end if;
    if p.asaas_customer_id is null or p.mobile is null then raise exception 'NO_MOBILE'; end if;
  end if;
  return query select c.id, c.gateway_account_id, c.asaas_payment_id, c.billing_type, c.clinic_id;
end;
$$;
revoke execute on function public.charge_refund_check(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_refund_check(uuid, text) to authenticated;

-- O celular foi enviado para o estorno (auditoria sem o número).
create or replace function public._charge_refund_mobile_sent(p_charge_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  update public.charge_refunds set mobile_sent_at = now(), mobile_sent_by = p_actor
   where charge_id = p_charge_id and status = 'pedido';
  select clinic_id into v_clinic from public.charges where id = p_charge_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_actor, v_clinic, 'update', 'charge_refund_mobile', p_charge_id::text, jsonb_build_object('celular', 'enviado ao Asaas para o estorno de boleto'));
end;
$$;
revoke execute on function public._charge_refund_mobile_sent(uuid, uuid) from public, anon, authenticated;

-- O estorno terminou: com a régua da unidade desligada, o celular enviado
-- para ele precisa ser apagado no Asaas (a rotina de 10 minutos apaga).
create or replace function public._charge_refund_mark_mobile_clear(p_charge_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.charge_refunds r set mobile_clear_needed = true
    from public.charges c
   where r.charge_id = p_charge_id and c.id = r.charge_id
     and r.mobile_sent_at is not null and r.mobile_cleared_at is null
     and r.status <> 'pedido'
     and not public._gateway_regua_unit_on(c.gateway_account_id);
$$;
revoke execute on function public._charge_refund_mark_mobile_clear(uuid) from public, anon, authenticated;

create or replace function public._charge_refund_mobiles_to_clear()
returns table (refund_id uuid, account_id uuid, asaas_customer_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, c.gateway_account_id, k.asaas_customer_id
    from public.charge_refunds r
    join public.charges c on c.id = r.charge_id
    join public.gateway_customers k on k.id = c.gateway_customer_id
   where r.mobile_clear_needed and r.mobile_cleared_at is null and k.asaas_customer_id is not null;
$$;
revoke execute on function public._charge_refund_mobiles_to_clear() from public, anon, authenticated;

create or replace function public._charge_refund_mobile_cleared(p_refund_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.charge_refunds%rowtype;
begin
  update public.charge_refunds set mobile_cleared_at = now(), mobile_clear_needed = false
   where id = p_refund_id returning * into r;
  if r.id is null then return; end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (null, r.clinic_id, 'update', 'charge_refund_mobile', r.charge_id::text, jsonb_build_object('celular', 'apagado no Asaas depois do estorno'));
end;
$$;
revoke execute on function public._charge_refund_mobile_cleared(uuid) from public, anon, authenticated;

-- O fim do pedido (redefinido): marca a limpeza do celular.
create or replace function public._charge_refund_closed(p_charge_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.charge_refunds%rowtype;
  c public.charges%rowtype;
  v_title text;
begin
  select * into r from public.charge_refunds where charge_id = p_charge_id and status = 'pedido' for update;
  if not found then return; end if;
  select * into c from public.charges where id = p_charge_id;
  update public.charge_refunds set status = p_status, finished_at = now(), status_note = left(p_note, 200) where id = r.id;
  update public.charges set refund_state = null where id = p_charge_id;
  perform public._charge_refund_mark_mobile_clear(p_charge_id);
  v_title := case p_status when 'negado' then 'Estorno negado pelo Asaas'
                           when 'cancelado' then 'Pedido de estorno cancelado'
                           else 'Estorno não concluído' end;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  values (r.requested_by, c.clinic_id, v_title,
          'O estorno pedido não aconteceu (' || coalesce(p_note, p_status) || '). A cobrança continua paga.',
          '/prontuarios/' || c.client_id::text);
  if p_status in ('negado', 'falhou') then
    perform public._gateway_notify(c.gateway_account_id, 'estorno_' || p_status, r.id::text, c.clinic_id, false, true, false,
      v_title, 'O estorno pedido no riSZon não aconteceu (' || coalesce(p_note, p_status) || '). A cobrança continua paga.',
      '/prontuarios/' || c.client_id::text);
  end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (null, c.clinic_id, 'update', 'charge_refund', c.id::text, jsonb_build_object('result', p_status, 'note', p_note));
end;
$$;
revoke execute on function public._charge_refund_closed(uuid, text, text) from public, anon, authenticated;

-- O aviso do estorno (redefinido): o concluído também marca a limpeza.
create or replace function public._gateway_event_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_ref text := new.payload->'payment'->>'externalReference';
begin
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  select * into c from public.charges where id = v_ref::uuid and gateway_account_id = new.account_id;
  if not found then return null; end if;
  if new.event = 'PAYMENT_REFUNDED' then
    perform public._gateway_split_refunded(c.id);
    update public.charge_refunds set status = 'concluido', finished_at = now(), asaas_status = 'DONE'
     where charge_id = c.id and status = 'pedido';
    update public.charges set refund_state = null where id = c.id;
    perform public._charge_refund_mark_mobile_clear(c.id);
    update public.gateway_webhook_events set result = coalesce(result, '') || '+split' where id = new.id and c.split_applied;
  elsif new.event = 'PAYMENT_REFUND_DENIED' then
    perform public._charge_refund_closed(c.id, 'negado', 'negado pelo Asaas');
    update public.gateway_webhook_events set result = 'estorno_negado' where id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public._gateway_event_refund() from public, anon, authenticated;

-- A ficha (redefinida): no boleto, qual celular será enviado e se o termo foi declarado.
create or replace function public.charge_split_history(p_charge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  v_pode boolean;
  v_cel text;
  v_termo boolean;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or not (public.is_admin_master() or public.can_see_clinic_finance(c.clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  v_pode := public._charge_refund_can(c.clinic_id) and c.status in ('paga', 'liquidada')
            and c.refund_state is null and c.asaas_payment_id is not null and not c.is_external;
  if v_pode and c.billing_type = 'BOLETO' then
    select x.mobile, x.termo_declarado into v_cel, v_termo from public._charge_refund_payer(c.id) x;
  end if;
  return jsonb_build_object(
    'updates', (select coalesce(jsonb_agg(jsonb_build_object('at', u.at, 'reasons', u.reasons, 'outcome', u.outcome) order by u.at desc), '[]'::jsonb)
                  from public.charge_split_updates u where u.charge_id = c.id),
    'naFila', c.split_pending_since is not null,
    'refundState', c.refund_state,
    'refund', (select to_jsonb(r) - 'requested_by' - 'mobile_sent_by'
                 from public.charge_refunds r where r.charge_id = c.id order by r.requested_at desc limit 1),
    'podePedirEstorno', v_pode,
    -- Só para quem pode pedir, só no boleto: o número que irá ao Asaas.
    'boleto', case when v_pode and c.billing_type = 'BOLETO' then
                jsonb_build_object('celular', v_cel, 'termoDeclarado', coalesce(v_termo, false))
              end);
end;
$$;
revoke execute on function public.charge_split_history(uuid) from public, anon, authenticated;
grant execute on function public.charge_split_history(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 11) CORREÇÃO DA 4008: a receita retida vai para a clínica DONA da conta que
--     recebeu o split (antes: "uma franqueadora qualquer" — com mais de uma
--     clínica franqueadora, a conta bancária não batia e o razão recusava).
-- -----------------------------------------------------------------------------
create or replace function public._gateway_split_ledger(p_split_charge_id uuid, p_settled_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.split_charges%rowtype;
  r public.payment_receipts%rowtype;
  v_acc record;
  v_label text;
  v_accrual date;
  v_status text;
  v_expected date;
  c public.charges%rowtype;
  v_dest uuid;
  v_dest_clinic uuid;
  v_bank_acc uuid;
begin
  select * into s from public.split_charges where id = p_split_charge_id;
  if not found then return; end if;
  select * into r from public.payment_receipts where id = s.receipt_id;
  select * into c from public.charges where id = s.charge_id;
  select * into v_acc from public.network_fee_accounts(s.fee);
  if v_acc is null then return; end if;
  v_label := public.network_fee_label(s.fee) || ' retido no split — ' || to_char(s.period_month, 'MM/YYYY');
  v_accrual := case when date_trunc('month', coalesce(r.received_at, s.period_month)) = s.period_month
                    then coalesce(r.received_at, s.period_month) else s.period_month end;
  v_status := case when s.retained_cents <= 0 or s.reversed then 'cancelled'
                   when p_settled_on is not null then 'settled' else 'open' end;
  v_expected := coalesce(p_settled_on, c.credit_date, r.settlement_date, r.received_at);

  -- A conta que recebeu ESTA taxa no split; sem ela, a raiz do mesmo ambiente.
  select cs.destination_account_id into v_dest
    from public.charge_splits cs where cs.charge_id = c.id and cs.fees ? s.fee limit 1;
  if v_dest is null then
    select g.id into v_dest from public.gateway_accounts g
     where g.owner_type = 'franchisor' and g.status = 'active'
       and g.environment = (select environment from public.gateway_accounts where id = c.gateway_account_id)
     order by g.created_at limit 1;
  end if;
  select g.clinic_id into v_dest_clinic from public.gateway_accounts g where g.id = v_dest;
  v_bank_acc := case when v_dest_clinic is not null then v_dest end;
  -- Carteira recebedora sem clínica (ex.: fundo com conta própria): a receita é
  -- da franqueadora dona da raiz, e o dinheiro é lançado na conta dela.
  if v_dest_clinic is null then
    select g.id, g.clinic_id into v_bank_acc, v_dest_clinic from public.gateway_accounts g
     where g.owner_type = 'franchisor' and g.status = 'active' and g.clinic_id is not null
       and g.environment = (select environment from public.gateway_accounts where id = c.gateway_account_id)
     order by g.created_at limit 1;
  end if;

  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
    amount_cents, direction, status, source_type, source_id, description, bank_account_id
  ) values (
    s.clinic_id, v_acc.unit_account, v_accrual,
    case when v_status = 'settled' then p_settled_on end, v_expected,
    greatest(s.retained_cents, 1), 'outflow', v_status, 'split_retained', s.id, v_label,
    public._gateway_bank_account(c.gateway_account_id)
  )
  on conflict (source_type, source_id) where source_type in ('split_retained', 'split_retained_revenue')
  do update set amount_cents = excluded.amount_cents, status = excluded.status,
                cash_date = excluded.cash_date, expected_settlement_date = excluded.expected_settlement_date,
                updated_at = now();

  if v_dest_clinic is not null and v_dest_clinic <> s.clinic_id then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, bank_account_id
    ) values (
      v_dest_clinic, v_acc.franchisor_account, v_accrual,
      case when v_status = 'settled' then p_settled_on end, v_expected,
      greatest(s.retained_cents, 1), 'inflow', v_status, 'split_retained_revenue', s.id, v_label,
      case when v_bank_acc is not null then
        (select b.id from public.bank_accounts b
          where b.id = public._gateway_bank_account(v_bank_acc) and b.clinic_id = v_dest_clinic) end
    )
    on conflict (source_type, source_id) where source_type in ('split_retained', 'split_retained_revenue')
    do update set amount_cents = excluded.amount_cents, status = excluded.status,
                  cash_date = excluded.cash_date, expected_settlement_date = excluded.expected_settlement_date,
                  updated_at = now();
  end if;
end;
$$;
revoke execute on function public._gateway_split_ledger(uuid, date) from public, anon, authenticated;

-- A limpeza do celular vale para todos os pedidos daquela cobrança (o
-- celular apagado é um só).
create or replace function public._charge_refund_mobile_cleared(p_refund_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.charge_refunds%rowtype;
begin
  select * into r from public.charge_refunds where id = p_refund_id;
  if r.id is null then return; end if;
  update public.charge_refunds set mobile_cleared_at = now(), mobile_clear_needed = false
   where charge_id = r.charge_id and mobile_sent_at is not null and mobile_cleared_at is null;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (null, r.clinic_id, 'update', 'charge_refund_mobile', r.charge_id::text, jsonb_build_object('celular', 'apagado no Asaas depois do estorno'));
end;
$$;
revoke execute on function public._charge_refund_mobile_cleared(uuid) from public, anon, authenticated;

-- A trilha de auditoria nas tabelas novas.
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (o dono vê esta linha no SQL Editor)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.charges where split_pending_since is not null) as cobrancas_na_fila,
  (select count(*) from public.charge_refunds) as estornos_pedidos,
  (select min_balance_cents is null from public.gateway_split_settings where id) as saldo_minimo_em_branco,
  (select count(*) from public.permission_defaults where capability = 'acao.cobranca.estorno') as permissao_estorno,
  (select count(*) from pg_catalog.pg_trigger where tgname like '%split_queue') as gatilhos_da_fila,
  (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'gateway_split_unit_overview', 'gateway_split_run_check', 'gateway_split_zero_confirm', 'gateway_refund_roles_set',
      'gateway_split_min_balance_set', 'charge_split_history', 'charge_refund_check')) as portas;
