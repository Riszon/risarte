-- =============================================================================
-- 0221 — ESTOQUE E4: A COMPRA ENTRA NA CONTABILIDADE
-- -----------------------------------------------------------------------------
-- Até aqui o estoque andava sozinho: o material entrava e saía, e o Financeiro
-- não ficava sabendo. Esta etapa fecha o círculo, e é ela que faz o DRE do FIN6
-- nascer certo em vez de nascer torto.
--
-- AS DUAS METADES DA MESMA DECISÃO (dono, 11/08/2026):
--
--   COMPRAR NÃO É GASTAR. Comprar é trocar dinheiro por material — a nota vai
--   para 6.1.01 (ativo) e NÃO entra no resultado.
--
--   GASTAR É USAR. Quando o material é consumido num procedimento, aí vira
--   custo, em 2.2.01, com competência na data do procedimento.
--
-- Sem isso, o mês da compra parece péssimo e o mês do uso parece ótimo. Com
-- isso, o saldo da conta 6.1.01 passa a ser o valor do estoque: compras menos
-- consumo. É o que permite conferir a contabilidade contra a prateleira.
--
-- PERDA NÃO É CUSTO DE PROCEDIMENTO (decisão do dono, 12/08/2026). Consumo do
-- kit vai para 2.2.01; quebra, vencimento e diferença de inventário vão para
-- 2.2.02. Se fossem para o mesmo lugar, o custo dos procedimentos subiria por
-- causa de material que caiu no chão — e o desperdício, que é o problema de
-- verdade, ficaria invisível dentro do custo do serviço.
--
-- LIMITES DECLARADOS (decisões do dono):
--   • Nota com material E serviço junto: a tela nova trata as LINHAS DE
--     ESTOQUE; frete e serviço continuam em Contas a Pagar como hoje.
--   • Devolução ao fornecedor fica de fora — entra se acontecer de verdade.
--   • ENTRADA MANUAL (sem nota) NÃO CONTABILIZA. Ela existe para acerto, e
--     inventar obrigação sem documento seria pior. A tela de conferência mostra
--     a diferença quando isso acontece, em vez de escondê-la.
--   • Nada retroativo: entradas e consumos já lançados não geram contabilização
--     para trás.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CONSUMO E PERDA EM CONTAS SEPARADAS
-- -----------------------------------------------------------------------------
insert into public.chart_of_accounts
  (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic)
values
  ('2.2.01', 'Consumo de material clínico', '2.2', 'expense', 'direct_cost',
   'variable', 'unit', true),
  ('2.2.02', 'Perdas e descartes de material', '2.2', 'expense', 'direct_cost',
   'variable', 'unit', true)
on conflict (code) do nothing;

-- O que já apontava para 2.2 passa a apontar para o consumo — senão os
-- lançamentos antigos ficariam órfãos numa conta que deixou de receber.
update public.payables set account_code = '2.2.01' where account_code = '2.2';
update public.financial_entries set account_code = '2.2.01'
 where account_code = '2.2';
update public.payable_approval_rules set account_code = '2.2.01'
 where account_code = '2.2';

update public.chart_of_accounts set is_analytic = false where code = '2.2';

-- -----------------------------------------------------------------------------
-- 2) A NOTA DE COMPRA
-- -----------------------------------------------------------------------------
create table if not exists public.stock_purchases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  supplier_id uuid references public.suppliers (id),
  invoice_number text,
  issue_date date not null default public.today_br(),
  total_cents bigint not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists stock_purchases_clinic_idx
  on public.stock_purchases (clinic_id, issue_date);

comment on table public.stock_purchases is
  'Cabeçalho da nota de compra: amarra as entradas de estoque às contas a pagar '
  'que nasceram dela. Sem essa amarração, conferir a nota depois é impossível.';

alter table public.stock_purchases enable row level security;

drop policy if exists "stock_purchases_select" on public.stock_purchases;
create policy "stock_purchases_select" on public.stock_purchases
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or clinic_id in (select public.user_clinic_ids())
  );

-- Escrita só pela função: a nota, as entradas e as contas a pagar nascem juntas.
alter table public.payables
  add column if not exists stock_purchase_id uuid
    references public.stock_purchases (id);

-- -----------------------------------------------------------------------------
-- 3) REGISTRAR A NOTA — entradas + contas a pagar, de uma vez
-- -----------------------------------------------------------------------------
-- Tudo numa transação: se a conta a pagar falhasse depois das entradas, o
-- estoque subiria sem a obrigação correspondente e a conferência nunca mais
-- fecharia.
create or replace function public.register_stock_purchase(
  p_clinic_id uuid,
  p_supplier_id uuid,
  p_invoice_number text,
  p_issue_date date,
  p_items jsonb,
  p_installments jsonb,
  p_cost_center_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase uuid;
  v_payable uuid;
  v_item jsonb;
  v_inst jsonb;
  v_total bigint := 0;
  v_line bigint;
  v_user uuid := (select auth.uid());
  v_when date := coalesce(p_issue_date, public.today_br());
  v_count integer := 0;
begin
  -- Comprar é ato de gestão (mesma alçada de contas a pagar e de entrada).
  if not public.can_manage_stock(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  insert into public.stock_purchases (
    clinic_id, supplier_id, invoice_number, issue_date, notes, created_by
  ) values (
    p_clinic_id, p_supplier_id,
    nullif(btrim(coalesce(p_invoice_number, '')), ''), v_when,
    nullif(btrim(coalesce(p_notes, '')), ''), v_user
  )
  returning id into v_purchase;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := round((v_item->>'packages')::numeric
                    * (v_item->>'packageCostCents')::numeric)::bigint;
    v_total := v_total + v_line;
    v_count := v_count + 1;

    -- A entrada usa a MESMA porta de sempre: a conversão embalagem → consumo e
    -- o custo médio continuam sendo calculados num lugar só.
    perform public.apply_stock_movement(
      p_clinic_id => p_clinic_id,
      p_item_id => (v_item->>'itemId')::uuid,
      p_kind => 'entrada',
      p_movement_date => v_when,
      p_source_type => 'purchase',
      p_source_id => v_purchase,
      p_purchase_quantity => (v_item->>'packages')::numeric,
      p_purchase_unit_cost_cents => (v_item->>'packageCostCents')::bigint,
      p_lot_code => nullif(v_item->>'lotCode', ''),
      p_expires_at => nullif(v_item->>'expiresAt', '')::date,
      p_supplier_id => p_supplier_id,
      p_invoice_number => nullif(btrim(coalesce(p_invoice_number, '')), '')
    );
  end loop;

  update public.stock_purchases set total_cents = v_total where id = v_purchase;

  -- A COMPRA VIRA ATIVO, NÃO DESPESA: conta a pagar classificada em 6.1.01.
  -- O resultado só é tocado quando o material for usado.
  if p_installments is null or jsonb_array_length(p_installments) = 0 then
    raise exception 'NO_INSTALLMENTS';
  end if;

  for v_inst in select * from jsonb_array_elements(p_installments)
  loop
    v_payable := public.save_payable(
       p_clinic_id => p_clinic_id,
       p_supplier_id => p_supplier_id,
       p_account_code => '6.1.01',
       p_cost_center_id => p_cost_center_id,
       p_description => 'Compra de material'
         || case when coalesce(btrim(p_invoice_number), '') <> ''
                 then ' — NF ' || btrim(p_invoice_number) else '' end
         || ' (' || v_count || ' item' || case when v_count = 1 then '' else 'ns' end || ')',
       p_amount_cents => (v_inst->>'amountCents')::bigint,
       p_due_date => (v_inst->>'dueDate')::date,
       p_accrual_date => v_when,
       p_document_number => nullif(btrim(coalesce(p_invoice_number, '')), '')
     );

    update public.payables set stock_purchase_id = v_purchase
     where id = v_payable;
  end loop;

  return v_purchase;
end;
$$;

grant execute on function public.register_stock_purchase(
  uuid, uuid, text, date, jsonb, jsonb, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O CONSUMO VIRA CUSTO
-- -----------------------------------------------------------------------------
-- Um lançamento POR MOVIMENTO, não um consolidado mensal: rastreabilidade é
-- invariante deste módulo — todo número de relatório precisa chegar ao documento
-- de origem. Consolidar depois é fácil; recuperar rastro perdido não é.
create unique index if not exists financial_entries_stock_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('stock_consumption', 'stock_loss', 'stock_asset');

create or replace function public.post_stock_movement_entries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account text;
  v_direction text;
  v_asset_direction text;
  v_name text;
begin
  -- 'abertura' é reclassificação de prateleira: não move valor.
  -- 'entrada' é contabilizada pela CONTA A PAGAR da nota (senão dobraria o
  -- ativo); entrada manual não contabiliza, e a conferência mostra a diferença.
  if new.kind in ('abertura', 'entrada', 'transferencia_entrada',
                  'transferencia_saida') then
    return null;
  end if;
  if coalesce(new.total_cents, 0) = 0 then return null; end if;

  select name into v_name from public.stock_items where id = new.item_id;

  if new.kind = 'consumo' then
    v_account := '2.2.01';
    v_direction := 'outflow';
    v_asset_direction := 'inflow';   -- o estoque diminui
  elsif new.kind in ('perda', 'ajuste_saida') then
    v_account := '2.2.02';
    v_direction := 'outflow';
    v_asset_direction := 'inflow';
  else
    -- ajuste_entrada: sobra encontrada. Reduz a perda e devolve o ativo.
    v_account := '2.2.02';
    v_direction := 'inflow';
    v_asset_direction := 'outflow';
  end if;

  -- O CUSTO (ou a perda), na competência do movimento.
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description, created_by
  ) values (
    new.clinic_id, v_account, new.movement_date, null, new.total_cents,
    v_direction, 'settled',
    case when new.kind = 'consumo' then 'stock_consumption' else 'stock_loss' end,
    new.id,
    coalesce(v_name, 'Material') || ' — ' || coalesce(new.reason, new.kind),
    new.created_by
  )
  on conflict do nothing;

  -- A BAIXA DO ATIVO: sem ela o saldo de 6.1.01 seria só compras, e a
  -- conferência contra a prateleira nunca fecharia.
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description, created_by
  ) values (
    new.clinic_id, '6.1.01', new.movement_date, null, new.total_cents,
    v_asset_direction, 'settled', 'stock_asset', new.id,
    coalesce(v_name, 'Material') || ' — baixa de estoque', new.created_by
  )
  on conflict do nothing;

  return null;
end;
$$;

drop trigger if exists stock_movements_post_entries on public.stock_movements;
create trigger stock_movements_post_entries
  after insert on public.stock_movements
  for each row execute function public.post_stock_movement_entries();

-- -----------------------------------------------------------------------------
-- 5) A CONFERÊNCIA: prateleira × contabilidade
-- -----------------------------------------------------------------------------
-- Se os dois divergirem, algo escapou — e é melhor descobrir por um número do
-- que por um balanço. A causa mais comum será entrada manual sem nota, que é
-- justamente o que esta tela existe para revelar.
create or replace function public.stock_ledger_check(p_clinic_id uuid)
returns table (
  stock_value_cents bigint,
  ledger_value_cents bigint,
  difference_cents bigint,
  manual_entries integer,
  manual_entries_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(round((b.quantity + b.in_use_quantity) * b.avg_cost_cents))
      from public.stock_balances b where b.clinic_id = p_clinic_id
    ), 0)::bigint,
    coalesce((
      select sum(case when e.direction = 'outflow'
                      then e.amount_cents else -e.amount_cents end)
      from public.financial_entries e
      where e.clinic_id = p_clinic_id
        and e.account_code = '6.1.01'
        and e.status <> 'reversed'
        and e.reversal_of is null
    ), 0)::bigint,
    coalesce((
      select sum(round((b.quantity + b.in_use_quantity) * b.avg_cost_cents))
      from public.stock_balances b where b.clinic_id = p_clinic_id
    ), 0)::bigint
    - coalesce((
      select sum(case when e.direction = 'outflow'
                      then e.amount_cents else -e.amount_cents end)
      from public.financial_entries e
      where e.clinic_id = p_clinic_id
        and e.account_code = '6.1.01'
        and e.status <> 'reversed'
        and e.reversal_of is null
    ), 0)::bigint,
    coalesce((
      select count(*) from public.stock_movements m
      where m.clinic_id = p_clinic_id and m.kind = 'entrada'
        and coalesce(m.source_type, 'manual') <> 'purchase'
    ), 0)::integer,
    coalesce((
      select sum(m.total_cents) from public.stock_movements m
      where m.clinic_id = p_clinic_id and m.kind = 'entrada'
        and coalesce(m.source_type, 'manual') <> 'purchase'
    ), 0)::bigint;
$$;

grant execute on function public.stock_ledger_check(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.chart_of_accounts
    where code in ('2.2.01', '2.2.02', '6.1.01')) as contas_criadas,
  (select is_analytic from public.chart_of_accounts where code = '2.2')
    as conta_2_2_virou_grupo,
  (select count(*) from public.stock_purchases) as notas_de_compra,
  (select count(*) from public.financial_entries
    where source_type in ('stock_consumption', 'stock_loss')) as lancamentos_de_custo,
  (select count(*) from public.financial_entries
    where source_type = 'stock_asset') as baixas_de_ativo;
