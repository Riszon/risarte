-- =============================================================================
-- 0243 — Compras C4: o dashboard
-- -----------------------------------------------------------------------------
-- O módulo existe por uma tese declarada pelo dono: "concentrar a compra na
-- franqueadora para melhorar a capacidade de negociação". Este painel é o que
-- prova ou derruba essa tese, e por isso os dois indicadores principais são:
--
--   1. QUANTO A NEGOCIAÇÃO ECONOMIZOU — preço negociado contra a previsão.
--   2. QUANTO FOI COMPRADO POR FORA — o vazamento que corrói o poder de
--      negociação, e que só desaparece do radar se ninguém medir.
--
-- A ECONOMIA É CONTRA A PREVISÃO, NÃO CONTRA A REALIDADE, e a tela diz isso.
-- Se a previsão da rede estava velha, a economia parece maior do que foi.
-- Apresentar esse número como se fosse dinheiro medido seria vender a tese com
-- a régua da própria tese.
--
-- SÓ ITEM NEGOCIADO ENTRA NA ECONOMIA. Comparar a previsão de um item sem
-- cotação contra zero mostraria 100% de economia onde não houve compra nenhuma.
--
-- COMPRA POR FORA TEM DOIS CAMINHOS, e o segundo é o que importa:
--   • a requisição marcada como local (`is_local`) — declarada;
--   • a compra de material lançada direto no Estoque, sem pedido — NÃO
--     declarada. É o caminho que ninguém avisa, e por isso é medido pela
--     ausência de vínculo com recebimento de pedido.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A ECONOMIA DA NEGOCIAÇÃO, por rodada
-- -----------------------------------------------------------------------------
create or replace function public.purchase_savings(
  p_from date,
  p_to date,
  p_clinic_id uuid default null
)
returns table (
  round_id uuid,
  round_code text,
  round_name text,
  closed_at timestamptz,
  items_awarded integer,
  items_pending integer,
  estimated_cents bigint,
  awarded_cents bigint,
  saved_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.code,
    r.name,
    r.closed_at,
    count(*) filter (where ri.awarded_supplier_id is not null)::integer,
    count(*) filter (where ri.awarded_supplier_id is null)::integer,
    -- Só o que foi negociado entra na comparação (ver cabeçalho).
    coalesce(sum(ri.estimated_total_cents)
             filter (where ri.awarded_supplier_id is not null), 0)::bigint,
    coalesce(sum(coalesce(ri.adjusted_quantity, ri.requested_quantity)
                 * coalesce(ri.awarded_unit_cents, 0))
             filter (where ri.awarded_supplier_id is not null), 0)::bigint,
    coalesce(sum(ri.estimated_total_cents
                 - coalesce(ri.adjusted_quantity, ri.requested_quantity)
                   * coalesce(ri.awarded_unit_cents, 0))
             filter (where ri.awarded_supplier_id is not null), 0)::bigint
  from public.purchase_rounds r
  join public.purchase_round_items ri on ri.round_id = r.id
  where r.status = 'fechada'
    and r.closed_at::date between p_from and p_to
    -- Filtro por unidade: só rodadas em que ELA participou.
    and (p_clinic_id is null or exists (
      select 1 from public.purchase_requests pr
       where pr.round_id = r.id and pr.clinic_id = p_clinic_id
    ))
    and (
      public.is_admin_master() or public.is_finance_franchisor()
      or public.is_purchaser()
      or (p_clinic_id is not null
          and p_clinic_id in (select public.user_clinic_ids()))
    )
  group by r.id, r.code, r.name, r.closed_at
  order by r.closed_at desc;
$$;

grant execute on function public.purchase_savings(date, date, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2) O VAZAMENTO — quanto foi comprado por fora
-- -----------------------------------------------------------------------------
-- `pela_rede`  = compras que chegaram por recebimento de pedido.
-- `local`      = compras de material lançadas direto no Estoque, sem pedido.
-- A conta é sobre a COMPRA de material (`stock_purchases`), que é onde o
-- dinheiro de fato saiu — não sobre a requisição, que é intenção.
create or replace function public.purchase_leakage(
  p_from date,
  p_to date,
  p_clinic_id uuid default null
)
returns table (
  clinic_id uuid,
  clinic_name text,
  network_cents bigint,
  local_cents bigint,
  local_purchases integer,
  declared_local_requests integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    coalesce(p.rede, 0)::bigint,
    coalesce(p.local, 0)::bigint,
    coalesce(p.n_local, 0)::integer,
    coalesce(d.n, 0)::integer
  from public.clinics c
  left join lateral (
    select
      sum(sp.total_cents) filter (where rc.id is not null) as rede,
      sum(sp.total_cents) filter (where rc.id is null) as local,
      count(*) filter (where rc.id is null) as n_local
    from public.stock_purchases sp
    left join public.purchase_receipts rc on rc.stock_purchase_id = sp.id
    where sp.clinic_id = c.id
      and sp.issue_date between p_from and p_to
  ) p on true
  -- A requisição marcada como local: o vazamento DECLARADO, que é o caso menos
  -- preocupante justamente por estar declarado.
  left join lateral (
    select count(*) as n
    from public.purchase_requests pr
    where pr.clinic_id = c.id and pr.is_local
      and pr.created_at::date between p_from and p_to
  ) d on true
  where c.is_active
    and c.type <> 'franchisor'
    and (p_clinic_id is null or c.id = p_clinic_id)
    and (
      public.is_admin_master() or public.is_finance_franchisor()
      or public.is_purchaser()
      or c.id in (select public.user_clinic_ids())
    )
  order by coalesce(p.local, 0) desc, c.name;
$$;

grant execute on function public.purchase_leakage(date, date, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) FORNECEDORES: volume, valor e PRAZO DE ENTREGA
-- -----------------------------------------------------------------------------
-- O prazo só existe desde o C3b: é a distância entre o pedido nascer e a
-- entrega chegar. Antes disso não havia como medir.
create or replace function public.purchase_suppliers(
  p_from date,
  p_to date,
  p_clinic_id uuid default null
)
returns table (
  supplier_id uuid,
  supplier_name text,
  orders integer,
  ordered_cents bigint,
  received_cents bigint,
  price_diff_cents bigint,
  avg_delivery_days numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.supplier_id,
    coalesce(s.name, 'Sem fornecedor'),
    count(distinct o.id)::integer,
    coalesce(sum(o.total_cents), 0)::bigint,
    coalesce(sum(r.total_cents), 0)::bigint,
    coalesce(sum(r.price_diff_cents), 0)::bigint,
    -- Média só dos que já chegaram: pedido em aberto não tem prazo, e contá-lo
    -- como zero faria o fornecedor lento parecer rápido.
    round(avg(r.issue_date - o.created_at::date)
          filter (where r.id is not null), 1)
  from public.purchase_orders o
  left join public.suppliers s on s.id = o.supplier_id
  left join public.purchase_receipts r on r.order_id = o.id
  where o.created_at::date between p_from and p_to
    and o.status <> 'cancelado'
    and (p_clinic_id is null or o.clinic_id = p_clinic_id)
    and (
      public.is_admin_master() or public.is_finance_franchisor()
      or public.is_purchaser()
      or o.clinic_id in (select public.user_clinic_ids())
    )
  group by o.supplier_id, s.name
  order by coalesce(sum(o.total_cents), 0) desc;
$$;

grant execute on function public.purchase_suppliers(date, date, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) OS ITENS MAIS COMPRADOS
-- -----------------------------------------------------------------------------
create or replace function public.purchase_top_items(
  p_from date,
  p_to date,
  p_clinic_id uuid default null,
  p_limit integer default 15
)
returns table (
  description text,
  orders integer,
  quantity numeric,
  total_cents bigint,
  avg_unit_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    oi.description,
    count(distinct o.id)::integer,
    sum(oi.quantity),
    coalesce(sum(oi.total_cents), 0)::bigint,
    case when sum(oi.quantity) > 0
         then round(sum(oi.total_cents) / sum(oi.quantity))::bigint end
  from public.purchase_order_items oi
  join public.purchase_orders o on o.id = oi.order_id
  where o.created_at::date between p_from and p_to
    and o.status <> 'cancelado'
    and (p_clinic_id is null or o.clinic_id = p_clinic_id)
    and (
      public.is_admin_master() or public.is_finance_franchisor()
      or public.is_purchaser()
      or o.clinic_id in (select public.user_clinic_ids())
    )
  group by oi.description
  order by coalesce(sum(oi.total_cents), 0) desc
  limit greatest(coalesce(p_limit, 15), 1);
$$;

grant execute on function public.purchase_top_items(date, date, uuid, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.purchase_rounds where status = 'fechada')
    as rodadas_fechadas,
  (select count(*) from public.purchase_orders where status <> 'cancelado')
    as pedidos,
  (select count(*) from public.stock_purchases sp
    where not exists (select 1 from public.purchase_receipts r
                       where r.stock_purchase_id = sp.id))
    as compras_sem_pedido_por_fora,
  (select count(*) from public.purchase_requests where is_local)
    as requisicoes_locais_declaradas;
