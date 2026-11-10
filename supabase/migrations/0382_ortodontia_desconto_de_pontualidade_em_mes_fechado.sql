-- =============================================================================
-- 0382 — ORTODONTIA: A BAIXA COM DESCONTO DE PONTUALIDADE NUMA MENSALIDADE DE
--         MÊS JÁ FECHADO (AP128)
--
-- O QUE ESTAVA ERRADO (lido no código ao fazer a 0370, AP69): a mensalidade da
-- Ortodontia é UM lançamento no razão. Na baixa com desconto de pontualidade,
-- o gatilho trocava o VALOR do lançamento pelo líquido. O guarda do mês
-- fechado recusa mudar valor em mês fechado: pagar no prazo uma mensalidade de
-- um mês já fechado dava PERIOD_CLOSED. Sem desconto passava.
--
-- DECISÃO DO DONO (10/11/2026): "dedução só se o mês estiver fechado".
--   • Mês da mensalidade ABERTO: continua como hoje — o lançamento passa a
--     valer o líquido (a receita entra já com o desconto).
--   • Mês da mensalidade FECHADO: o lançamento NÃO muda de valor (a receita
--     do mês fechado fica cheia, como estava quando fechou) e o desconto entra
--     como DEDUÇÃO, na conta 1.9.02 (Descontos concedidos), no mês do
--     pagamento. É o mesmo desenho da renegociação (0189).
--
-- O CAIXA FICA CERTO NOS DOIS CASOS: no mês fechado, entram o valor cheio e a
-- saída do desconto, os dois com a data do pagamento — o líquido é o dinheiro
-- que entrou de verdade.
--
-- ⚠️ A COMPETÊNCIA DA DEDUÇÃO é o dia do pagamento. Se o mês DO PAGAMENTO
-- também já estiver fechado (baixa lançada com data retroativa), a dedução
-- entra no dia em que a baixa foi lançada — nunca num mês fechado.
--
-- DESFAZER A BAIXA cancela a dedução (o lançamento fica, como cancelado, para
-- o histórico). Pagar de novo lança uma dedução nova.
--
-- ⚠️ As taxas da rede (0370) continuam sobre o dinheiro que entrou
-- (`paid_amount_cents`): este gatilho não mexe nelas.
--
-- Corpo recriado a partir do da 0335 (o último); só o trecho da baixa e o do
-- desfazer mudam. Nada é apagado. Idempotente.
-- =============================================================================

create or replace function public.ortho_charge_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash date;
  v_desc text;
  v_disc integer;
  v_fechado boolean;
  v_competencia date;
begin
  v_desc := case when new.kind = 'contencao'
                 then 'Contenção ortodôntica ' || to_char(new.reference_month, 'MM/YYYY')
                 else 'Mensalidade ortodôntica ' || to_char(new.reference_month, 'MM/YYYY') end;
  if tg_op = 'INSERT' then
    if new.status = 'cancelada' then return null; end if;
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, created_by
    ) values (
      new.clinic_id, '1.1.04', new.reference_month,
      case when new.status = 'paga' then coalesce(new.paid_on, (new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br()) end,
      new.due_date, coalesce(case when new.status = 'paga' then new.paid_amount_cents end, new.amount_cents), 'inflow',
      case when new.status = 'paga' then 'settled' else 'open' end,
      'ortho_charge', new.id, v_desc, new.created_by
    )
    on conflict (source_type, source_id) where source_type = 'ortho_charge' do nothing;
    return null;
  end if;

  -- UPDATE
  if new.status = 'paga' and old.status <> 'paga' then
    v_cash := coalesce(new.paid_on, (new.paid_at at time zone 'America/Sao_Paulo')::date, public.today_br());
    v_disc := greatest(0, new.amount_cents - coalesce(new.paid_amount_cents, new.amount_cents));
    -- 0382: a competência da mensalidade está num mês FECHADO?
    v_fechado := v_disc > 0 and exists (
      select 1
        from public.financial_entries e
        join public.fiscal_periods p
          on p.clinic_id = e.clinic_id
         and p.status = 'closed'
         and p.year = extract(year from e.accrual_date)::integer
         and p.month = extract(month from e.accrual_date)::integer
       where e.source_type = 'ortho_charge' and e.source_id = new.id
    );

    if v_fechado then
      -- Mês fechado: o valor do lançamento NÃO muda (o guarda deixa passar a
      -- troca de situação com valor igual, 0370)...
      update public.financial_entries
         set status = 'settled', cash_date = v_cash, updated_at = now()
       where source_type = 'ortho_charge' and source_id = new.id and status in ('open','cancelled');

      -- ...e o desconto vira dedução no mês do pagamento (ou, se ele também
      -- já fechou, no dia em que a baixa foi lançada).
      v_competencia := v_cash;
      if exists (
        select 1 from public.fiscal_periods p
         where p.clinic_id = new.clinic_id
           and p.status = 'closed'
           and p.year = extract(year from v_cash)::integer
           and p.month = extract(month from v_cash)::integer
      ) then
        v_competencia := public.today_br();
      end if;

      insert into public.financial_entries (
        clinic_id, account_code, accrual_date, cash_date,
        amount_cents, direction, status, source_type, source_id, description, created_by
      ) values (
        new.clinic_id, '1.9.02', v_competencia, v_cash,
        v_disc, 'outflow', 'settled', 'ortho_charge_discount', new.id,
        'Desconto de pontualidade — ' || v_desc, coalesce(new.paid_by, new.created_by)
      );
    else
      update public.financial_entries
         set status = 'settled', cash_date = v_cash,
             amount_cents = coalesce(new.paid_amount_cents, new.amount_cents), updated_at = now()
       where source_type = 'ortho_charge' and source_id = new.id and status in ('open','cancelled');
    end if;
  elsif old.status = 'paga' and new.status <> 'paga' then
    update public.financial_entries
       set status = case when new.status = 'cancelada' then 'cancelled' else 'open' end,
           cash_date = null,
           amount_cents = new.amount_cents,
           reversal_reason = case when new.status = 'cancelada' then 'Cobrança cancelada' else 'Baixa desfeita' end,
           updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'settled';
    -- 0382: a dedução do desconto sai junto com a baixa.
    update public.financial_entries
       set status = 'cancelled',
           reversal_reason = case when new.status = 'cancelada' then 'Cobrança cancelada' else 'Baixa desfeita' end,
           updated_at = now()
     where source_type = 'ortho_charge_discount' and source_id = new.id and status = 'settled';
  elsif new.status = 'cancelada' and old.status <> 'cancelada' then
    update public.financial_entries
       set status = 'cancelled', updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'open';
  elsif old.status = 'cancelada' and new.status <> 'cancelada' then
    update public.financial_entries
       set status = 'open', updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'cancelled';
  end if;

  if new.amount_cents <> old.amount_cents then
    update public.financial_entries
       set amount_cents = new.amount_cents, updated_at = now()
     where source_type = 'ortho_charge' and source_id = new.id and status = 'open';
  end if;
  return null;
end;
$$;
revoke execute on function public.ortho_charge_ledger() from public, anon, authenticated;

create index if not exists financial_entries_ortho_discount_idx
  on public.financial_entries (source_id)
  where source_type = 'ortho_charge_discount';

-- CONFERÊNCIA (só leitura). Esperado: gatilho_novo = true; deducoes = 0 logo
-- depois de rodar (elas nascem nas próximas baixas com desconto em mês fechado).
select
  position('ortho_charge_discount' in pg_get_functiondef('public.ortho_charge_ledger'::regproc)) > 0 as gatilho_novo,
  (select count(*) from public.financial_entries where source_type = 'ortho_charge_discount') as deducoes,
  exists (select 1 from public.chart_of_accounts where code = '1.9.02') as conta_1_9_02_existe;
