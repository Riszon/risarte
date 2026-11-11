-- =============================================================================
-- 4001 — INTEGRAÇÃO ASAAS — FASE ASA0: as tarifas do Asaas no adquirente
-- -----------------------------------------------------------------------------
-- Decisão do dono (10/11/2026, D22): as tarifas por meio de pagamento NÃO
-- ganham tabela nova. Cada conta Asaas vira um adquirente "Asaas"
-- (`card_acquirers`) e as tarifas entram em `acquirer_rates`, preenchidas pela
-- consulta de tarifas do Asaas (`GET /v3/myAccount/fees`), com vigência e fim
-- de promoção. É a mesma tabela que a baixa já usa para lançar a taxa no
-- razão — por isso a tarifa nunca é contada duas vezes.
--
-- O que muda em tabela existente (só acréscimo):
--   * `card_acquirers.gateway_account_id` — a conta Asaas dona do adquirente.
--   * `acquirer_rates.min_fee_cents` / `max_fee_cents` — piso e teto da tarifa
--     percentual (o PIX do Asaas pode ser percentual com mínimo e máximo).
--   * `acquirer_rates.source` — `manual` (digitada) ou `gateway` (veio do Asaas).
--
-- ⚠️ O adquirente "Asaas" NÃO nasce como padrão da unidade: enquanto a
-- integração não emite cobrança, as baixas manuais continuam com o adquirente
-- que a unidade já usa.
--
-- ⚠️ A sincronização NUNCA sobrescreve: tarifa que mudou fecha a vigência da
-- antiga (`valid_to`) e abre uma nova. Tarifa digitada à mão (`manual`) não é
-- tocada.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

alter table public.card_acquirers
  add column if not exists gateway_account_id uuid references public.gateway_accounts (id);

create unique index if not exists card_acquirers_gateway_account_unique
  on public.card_acquirers (gateway_account_id)
  where gateway_account_id is not null;

comment on column public.card_acquirers.gateway_account_id is
  'Conta Asaas dona deste adquirente (4001). Nulo = adquirente cadastrado à mão.';

alter table public.acquirer_rates
  add column if not exists min_fee_cents bigint check (min_fee_cents is null or min_fee_cents >= 0),
  add column if not exists max_fee_cents bigint check (max_fee_cents is null or max_fee_cents >= 0),
  add column if not exists source text not null default 'manual';

alter table public.acquirer_rates
  drop constraint if exists acquirer_rates_source_check;
alter table public.acquirer_rates
  add constraint acquirer_rates_source_check check (source in ('manual', 'gateway'));

comment on column public.acquirer_rates.min_fee_cents is
  'Piso da tarifa percentual, em centavos (4001). Nulo = sem piso.';
comment on column public.acquirer_rates.max_fee_cents is
  'Teto da tarifa percentual, em centavos (4001). Nulo = sem teto.';
comment on column public.acquirer_rates.source is
  'manual = digitada na tela; gateway = veio da consulta de tarifas do Asaas (4001).';

-- -----------------------------------------------------------------------------
-- A SINCRONIZAÇÃO — só o servidor chama (chave de serviço)
-- -----------------------------------------------------------------------------
-- `p_rates` é a lista já convertida pelo servidor (`src/lib/asaas/fees.ts`):
--   [{ modality, min_installments, max_installments, fee_percent,
--      fixed_fee_cents, min_fee_cents, max_fee_cents, settlement_days,
--      free_monthly_count, valid_from, valid_to }]
-- `valid_from`/`valid_to` vêm preenchidos quando há tarifa promocional com
-- data de fim: uma linha vale até o fim da promoção e outra a partir do dia
-- seguinte.
--
-- Devolve quantas linhas mudaram (0 = as tarifas já estavam iguais).
create or replace function public._gateway_sync_fees(p_account_id uuid, p_rates jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_acquirer uuid;
  v_today date := public.today_br();
  v_changed integer := 0;
  r record;
  v_from date;
begin
  select * into v_acc from public.gateway_accounts a where a.id = p_account_id;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.status = 'disabled' then raise exception 'ACCOUNT_DISABLED'; end if;
  -- Carteira de repasse não emite cobrança: não tem adquirente.
  if v_acc.clinic_id is null then return 0; end if;
  if p_rates is null or jsonb_typeof(p_rates) <> 'array' then
    raise exception 'RATES_INVALID';
  end if;

  select c.id into v_acquirer
    from public.card_acquirers c
   where c.gateway_account_id = p_account_id;

  if v_acquirer is null then
    insert into public.card_acquirers (clinic_id, name, is_default, scope, notes, gateway_account_id)
    values (
      v_acc.clinic_id,
      case when v_acc.environment = 'sandbox' then 'Asaas (teste)' else 'Asaas' end,
      false,
      'unidade',
      'Criado pela Central de Configuração. As tarifas vêm da consulta ao Asaas.',
      p_account_id
    )
    returning id into v_acquirer;
  end if;

  -- A lista nova, numa tabela temporária desta transação.
  drop table if exists pg_temp._gateway_new_rates;
  create temporary table _gateway_new_rates on commit drop as
  select
    x.modality,
    coalesce(x.min_installments, 1) as min_installments,
    coalesce(x.max_installments, 1) as max_installments,
    coalesce(x.fee_percent, 0)::numeric(6,3) as fee_percent,
    coalesce(x.fixed_fee_cents, 0)::bigint as fixed_fee_cents,
    x.min_fee_cents,
    x.max_fee_cents,
    coalesce(x.settlement_days, 0) as settlement_days,
    x.free_monthly_count,
    greatest(coalesce(x.valid_from, v_today), v_today) as valid_from,
    x.valid_to
  from jsonb_to_recordset(p_rates) as x(
    modality text,
    min_installments integer,
    max_installments integer,
    fee_percent numeric,
    fixed_fee_cents bigint,
    min_fee_cents bigint,
    max_fee_cents bigint,
    settlement_days integer,
    free_monthly_count integer,
    valid_from date,
    valid_to date
  )
  where x.modality is not null
    and (x.valid_to is null or x.valid_to >= v_today);

  -- 1) Fecha a tarifa do Asaas que não aparece mais (ou mudou), a partir de
  --    hoje. A que começou hoje e mudou é substituída sem deixar rastro de um
  --    dia (não chegou a valer para ninguém ontem).
  for r in
    select ar.id, ar.valid_from
      from public.acquirer_rates ar
     where ar.acquirer_id = v_acquirer
       and ar.source = 'gateway'
       and (ar.valid_to is null or ar.valid_to >= v_today)
       and (ar.valid_to is null or ar.valid_to >= ar.valid_from)
       and not exists (
         select 1 from pg_temp._gateway_new_rates n
          where n.modality = ar.modality
            and n.min_installments = ar.min_installments
            and n.max_installments = ar.max_installments
            and n.fee_percent = ar.fee_percent
            and n.fixed_fee_cents = ar.fixed_fee_cents
            and n.min_fee_cents is not distinct from ar.min_fee_cents
            and n.max_fee_cents is not distinct from ar.max_fee_cents
            and n.settlement_days = ar.settlement_days
            and n.free_monthly_count is not distinct from ar.free_monthly_count
            and n.valid_to is not distinct from ar.valid_to
            and (n.valid_from = ar.valid_from or (n.valid_from <= v_today and ar.valid_from <= v_today))
       )
  loop
    if r.valid_from >= v_today then
      -- Ainda não valeu (ou começou hoje): encerra na véspera do início, o que
      -- a tira de toda consulta sem apagar a linha.
      update public.acquirer_rates ar
         set valid_to = r.valid_from - 1
       where ar.id = r.id;
    else
      update public.acquirer_rates ar
         set valid_to = v_today - 1
       where ar.id = r.id;
    end if;
    v_changed := v_changed + 1;
  end loop;

  -- 2) Abre a que ainda não existe.
  for r in
    select n.*
      from pg_temp._gateway_new_rates n
     where not exists (
       select 1 from public.acquirer_rates ar
        where ar.acquirer_id = v_acquirer
          and ar.source = 'gateway'
          and (ar.valid_to is null or ar.valid_to >= v_today)
          and (ar.valid_to is null or ar.valid_to >= ar.valid_from)
          and ar.modality = n.modality
          and ar.min_installments = n.min_installments
          and ar.max_installments = n.max_installments
          and ar.fee_percent = n.fee_percent
          and ar.fixed_fee_cents = n.fixed_fee_cents
          and ar.min_fee_cents is not distinct from n.min_fee_cents
          and ar.max_fee_cents is not distinct from n.max_fee_cents
          and ar.settlement_days = n.settlement_days
          and ar.free_monthly_count is not distinct from n.free_monthly_count
          and ar.valid_to is not distinct from n.valid_to
          and (ar.valid_from = n.valid_from or (n.valid_from <= v_today and ar.valid_from <= v_today))
     )
  loop
    v_from := r.valid_from;
    insert into public.acquirer_rates (
      acquirer_id, modality, min_installments, max_installments, fee_percent,
      fixed_fee_cents, min_fee_cents, max_fee_cents, settlement_days,
      free_monthly_count, valid_from, valid_to, fee_charged_on, source
    ) values (
      v_acquirer, r.modality, r.min_installments, r.max_installments, r.fee_percent,
      r.fixed_fee_cents, r.min_fee_cents, r.max_fee_cents, r.settlement_days,
      r.free_monthly_count, v_from, r.valid_to, 'pagamento', 'gateway'
    );
    v_changed := v_changed + 1;
  end loop;

  update public.gateway_accounts a
     set fees_synced_at = now()
   where a.id = p_account_id;

  return v_changed;
end;
$$;

revoke execute on function public._gateway_sync_fees(uuid, jsonb) from public, anon, authenticated;

-- Nenhuma tabela nova; mantém a regra da 0288 em dia.
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'acquirer_rates'
      and column_name in ('min_fee_cents', 'max_fee_cents', 'source')) as colunas_novas_das_tarifas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'card_acquirers'
      and column_name = 'gateway_account_id') as coluna_do_adquirente,
  (select count(*) from public.acquirer_rates where source = 'gateway') as tarifas_do_asaas;
