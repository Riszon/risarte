-- =============================================================================
-- 0242 — Compras C3b: o recebimento (pedido × recebido × pago)
-- -----------------------------------------------------------------------------
-- O pedido existe (C3a), o fornecedor entrega. Esta etapa fecha o ciclo.
--
-- O DINHEIRO SEGUE O CAMINHO QUE JÁ EXISTE. O recebimento chama o
-- `register_stock_purchase` (0221) — o mesmo que a compra avulsa usa. Ele já
-- faz a entrada com conversão de embalagem, o custo médio, a compra virando
-- ATIVO em 6.1.01 e a conta a pagar. Criar um segundo caminho para "compra vira
-- dívida" seria construir dois lugares onde o mesmo dinheiro é calculado — e é
-- exatamente assim que eles passam a divergir. Já custou caro na DRE.
--
-- A NOTA MANDA NO PREÇO, NÃO O PEDIDO. O que entra no estoque é o valor da
-- nota: é o que foi efetivamente pago. Quando diverge do negociado, o sistema
-- ACEITA E REGISTRA — bloquear deixaria o material fora do estoque por causa de
-- centavos, e a clínica trabalharia com saldo errado enquanto alguém resolve a
-- pendência. A diferença vira o indicador "o fornecedor cobrou diferente do
-- combinado", que é o que a franqueadora precisa para a próxima negociação.
--
-- RECEBER PARCIAL É NORMAL, NÃO É ERRO. Pediu 10, vieram 8: entram 8, e o
-- pedido guarda que faltam 2. Ele só fica 'recebido' quando tudo chegou —
-- fechar antes esconderia a pendência com o fornecedor.
--
-- QUANTIDADE A MAIS TAMBÉM ENTRA. Veio 12 onde se pediu 10: o material está na
-- prateleira, e o estoque tem de dizer a verdade. Fica registrado como
-- divergência para cobrança, não recusado.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O RECEBIMENTO
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id),
  clinic_id uuid not null references public.clinics (id),
  -- A compra gerada no Estoque: é ela que fez a entrada e a conta a pagar.
  stock_purchase_id uuid references public.stock_purchases (id),
  invoice_number text,
  issue_date date not null default public.today_br(),
  total_cents bigint not null default 0,
  -- Diferença entre o que a nota cobrou e o que foi negociado, com sinal.
  -- Positivo = cobrou MAIS que o combinado.
  price_diff_cents bigint not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists purchase_receipts_order_idx
  on public.purchase_receipts (order_id, created_at desc);

create table if not exists public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts (id)
    on delete cascade,
  order_item_id uuid not null references public.purchase_order_items (id),
  quantity numeric(14,3) not null check (quantity > 0),
  -- O preço DA NOTA, por embalagem. Congelado aqui.
  unit_cents bigint not null default 0,
  -- O preço que estava no pedido, para a diferença não depender de recalcular
  -- depois — o pedido pode ser corrigido, o histórico não.
  ordered_unit_cents bigint not null default 0,
  lot_code text,
  expires_at date,
  created_at timestamptz not null default now()
);

create index if not exists purchase_receipt_items_receipt_idx
  on public.purchase_receipt_items (receipt_id);

alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_items enable row level security;

drop policy if exists "purchase_receipts_select" on public.purchase_receipts;
create policy "purchase_receipts_select" on public.purchase_receipts
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or public.is_purchaser()
    or clinic_id in (select public.user_clinic_ids())
  );

drop policy if exists "purchase_receipt_items_select"
  on public.purchase_receipt_items;
create policy "purchase_receipt_items_select" on public.purchase_receipt_items
  for select to authenticated
  using (
    exists (
      select 1 from public.purchase_receipts pr
      where pr.id = receipt_id
        and (public.is_admin_master() or public.is_finance_franchisor()
             or public.is_purchaser()
             or pr.clinic_id in (select public.user_clinic_ids()))
    )
  );

-- -----------------------------------------------------------------------------
-- 2) O QUE AINDA FALTA CHEGAR
-- -----------------------------------------------------------------------------
create or replace function public.order_pending_items(p_order_id uuid)
returns table (
  order_item_id uuid,
  item_id uuid,
  description text,
  ordered_quantity numeric,
  received_quantity numeric,
  pending_quantity numeric,
  unit_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    oi.id,
    oi.item_id,
    oi.description,
    oi.quantity,
    oi.received_quantity,
    greatest(0, oi.quantity - oi.received_quantity),
    oi.unit_cents
  from public.purchase_order_items oi
  join public.purchase_orders o on o.id = oi.order_id
  where oi.order_id = p_order_id
    and (public.is_admin_master() or public.is_finance_franchisor()
         or public.is_purchaser()
         or o.clinic_id in (select public.user_clinic_ids()))
  order by oi.description;
$$;

grant execute on function public.order_pending_items(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) RECEBER
-- -----------------------------------------------------------------------------
-- `p_items`: [{ orderItemId, quantity, unitCents, lotCode, expiresAt }]
-- `p_installments`: o mesmo formato do Estoque — [{ amountCents, dueDate }].
create or replace function public.receive_purchase_order(
  p_order_id uuid,
  p_invoice_number text,
  p_issue_date date,
  p_items jsonb,
  p_installments jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order record;
  v_receipt uuid;
  v_item jsonb;
  v_oi record;
  v_qty numeric;
  v_unit bigint;
  v_total bigint := 0;
  v_diff bigint := 0;
  v_stock_items jsonb := '[]'::jsonb;
  v_purchase uuid;
  v_when date := coalesce(p_issue_date, public.today_br());
  v_pending numeric;
begin
  select * into v_order from public.purchase_orders where id = p_order_id;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'cancelado' then raise exception 'ORDER_CANCELLED'; end if;

  -- Receber é ato de estoque: mesma alçada da entrada avulsa.
  if not public.can_manage_stock(v_order.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  insert into public.purchase_receipts (
    order_id, clinic_id, invoice_number, issue_date, notes, created_by
  ) values (
    p_order_id, v_order.clinic_id,
    nullif(btrim(coalesce(p_invoice_number, '')), ''), v_when,
    nullif(btrim(coalesce(p_notes, '')), ''), v_user
  )
  returning id into v_receipt;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_oi from public.purchase_order_items
     where id = (v_item->>'orderItemId')::uuid and order_id = p_order_id;
    if v_oi.id is null then raise exception 'ITEM_NOT_IN_ORDER'; end if;

    v_qty := (v_item->>'quantity')::numeric;
    continue when coalesce(v_qty, 0) <= 0;

    -- Sem preço na nota, vale o do pedido: é o melhor que se sabe, e zero
    -- entraria no estoque como material de graça.
    v_unit := coalesce(nullif(v_item->>'unitCents', '')::bigint, v_oi.unit_cents);

    v_total := v_total + round(v_qty * v_unit)::bigint;
    v_diff := v_diff + round(v_qty * (v_unit - v_oi.unit_cents))::bigint;

    insert into public.purchase_receipt_items (
      receipt_id, order_item_id, quantity, unit_cents, ordered_unit_cents,
      lot_code, expires_at
    ) values (
      v_receipt, v_oi.id, v_qty, v_unit, v_oi.unit_cents,
      nullif(v_item->>'lotCode', ''),
      nullif(v_item->>'expiresAt', '')::date
    );

    update public.purchase_order_items
       set received_quantity = received_quantity + v_qty
     where id = v_oi.id;

    -- Linha livre (sem item de estoque) não entra na prateleira: ela não é
    -- material estocado. Vai para a conta a pagar como as demais.
    if v_oi.item_id is not null then
      v_stock_items := v_stock_items || jsonb_build_object(
        'itemId', v_oi.item_id,
        'packages', v_qty,
        'packageCostCents', v_unit,
        'lotCode', v_item->>'lotCode',
        'expiresAt', v_item->>'expiresAt'
      );
    end if;
  end loop;

  update public.purchase_receipts
     set total_cents = v_total, price_diff_cents = v_diff
   where id = v_receipt;

  -- A ENTRADA E O DINHEIRO pelo caminho de sempre (ver cabeçalho).
  if jsonb_array_length(v_stock_items) > 0 then
    v_purchase := public.register_stock_purchase(
      p_clinic_id => v_order.clinic_id,
      p_supplier_id => v_order.supplier_id,
      p_invoice_number => p_invoice_number,
      p_issue_date => v_when,
      p_items => v_stock_items,
      p_installments => p_installments,
      p_notes => 'Pedido ' || coalesce(v_order.code, '')
    );
    update public.purchase_receipts set stock_purchase_id = v_purchase
     where id = v_receipt;
  end if;

  -- O pedido só fecha quando TUDO chegou. Fechar antes esconderia a pendência
  -- com o fornecedor.
  select sum(greatest(0, quantity - received_quantity)) into v_pending
    from public.purchase_order_items where order_id = p_order_id;

  update public.purchase_orders set
    status = case when coalesce(v_pending, 0) <= 0
                  then 'recebido' else 'recebido_parcial' end,
    updated_at = now()
  where id = p_order_id;

  return v_receipt;
end;
$$;

revoke all on function public.receive_purchase_order(
  uuid, text, date, jsonb, jsonb, text) from public;
grant execute on function public.receive_purchase_order(
  uuid, text, date, jsonb, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) PEDIDO × RECEBIDO × PAGO, numa consulta
-- -----------------------------------------------------------------------------
create or replace function public.order_reconciliation(p_order_id uuid)
returns table (
  order_item_id uuid,
  description text,
  ordered_quantity numeric,
  received_quantity numeric,
  quantity_diff numeric,
  ordered_unit_cents bigint,
  invoiced_unit_cents bigint,
  price_diff_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    oi.id,
    oi.description,
    oi.quantity,
    oi.received_quantity,
    oi.received_quantity - oi.quantity,
    oi.unit_cents,
    r.invoiced,
    coalesce(r.diff, 0)::bigint
  from public.purchase_order_items oi
  join public.purchase_orders o on o.id = oi.order_id
  left join lateral (
    -- Média ponderada do que a nota cobrou: pode haver mais de um recebimento
    -- para o mesmo item, com preços diferentes.
    select
      case when sum(ri.quantity) > 0
           then round(sum(ri.quantity * ri.unit_cents) / sum(ri.quantity))::bigint
      end as invoiced,
      sum(ri.quantity * (ri.unit_cents - ri.ordered_unit_cents))::bigint as diff
    from public.purchase_receipt_items ri
    where ri.order_item_id = oi.id
  ) r on true
  where oi.order_id = p_order_id
    and (public.is_admin_master() or public.is_finance_franchisor()
         or public.is_purchaser()
         or o.clinic_id in (select public.user_clinic_ids()))
  order by oi.description;
$$;

grant execute on function public.order_reconciliation(uuid) to authenticated;

-- O que a franqueadora precisa saber para a próxima negociação: quem cobrou
-- diferente do combinado, e quanto.
create or replace function public.supplier_price_divergence(
  p_from date,
  p_to date
)
returns table (
  supplier_id uuid,
  supplier_name text,
  receipts integer,
  diff_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.supplier_id,
    s.name,
    count(*)::integer,
    sum(pr.price_diff_cents)::bigint
  from public.purchase_receipts pr
  join public.purchase_orders o on o.id = pr.order_id
  left join public.suppliers s on s.id = o.supplier_id
  where pr.issue_date between p_from and p_to
    and pr.price_diff_cents <> 0
    and (public.is_admin_master() or public.is_finance_franchisor()
         or public.is_purchaser())
  group by o.supplier_id, s.name
  order by abs(sum(pr.price_diff_cents)) desc;
$$;

grant execute on function public.supplier_price_divergence(date, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.purchase_orders where status = 'aberto')
    as pedidos_esperando_entrega,
  (select count(*) from public.purchase_receipts) as recebimentos,
  (select count(*) from public.purchase_receipts where price_diff_cents <> 0)
    as recebimentos_com_preco_diferente,
  (select coalesce(sum(price_diff_cents), 0) / 100.0
     from public.purchase_receipts) as reais_de_diferenca_de_preco;
