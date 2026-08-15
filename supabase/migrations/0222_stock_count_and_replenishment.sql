-- =============================================================================
-- 0222 — ESTOQUE E5: INVENTÁRIO, ALERTAS E LISTA DE REPOSIÇÃO
-- -----------------------------------------------------------------------------
-- Fecha o módulo. Três coisas que faltavam:
--
-- 1) INVENTÁRIO — contar a prateleira e acertar o sistema.
--
--    A DIFERENÇA É A INFORMAÇÃO, não um erro a apagar. Ela mede perda, furto,
--    kit mal cadastrado e consumo fora do previsto. Por isso a contagem não
--    "corrige" o saldo em silêncio: vira MOVIMENTO DE AJUSTE com motivo, e o
--    que se contou fica registrado ao lado do que o sistema esperava.
--
--    A CONTAGEM CONGELA O ESPERADO. Entre contar e aplicar pode haver consumo
--    legítimo — um atendimento acontecendo enquanto alguém conta a gaveta. Se o
--    ajuste fosse "deixe o saldo igual ao contado", ele APAGARIA esse consumo.
--    Por isso o ajuste é `contado − esperado no momento da contagem`, e o que
--    aconteceu no meio continua valendo.
--
-- 2) ACIMA DO MÁXIMO — o alerta que faltava. Abaixo do mínimo é falta; acima do
--    máximo é dinheiro parado, e em material com validade é perda programada.
--
-- 3) LISTA DE REPOSIÇÃO — o que comprar, em EMBALAGENS (é assim que se compra),
--    já ligada à nota de compra da E4.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONTAGEM
-- -----------------------------------------------------------------------------
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  count_date date not null default public.today_br(),
  status text not null default 'aberta'
    check (status in ('aberta', 'aplicada', 'descartada')),
  notes text,
  applied_at timestamptz,
  applied_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists stock_counts_clinic_idx
  on public.stock_counts (clinic_id, count_date desc);

comment on table public.stock_counts is
  'Contagem física. Fica ABERTA enquanto se conta e só vira ajuste quando '
  'aplicada — contar e corrigir são atos diferentes.';

create table if not exists public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts (id) on delete cascade,
  item_id uuid not null references public.stock_items (id),
  -- CONGELADO no momento em que a linha entrou na contagem.
  expected_quantity numeric(14,3) not null default 0,
  counted_quantity numeric(14,3),
  created_at timestamptz not null default now(),
  unique (count_id, item_id)
);

comment on column public.stock_count_items.expected_quantity is
  'O que o sistema dizia QUANDO SE CONTOU. O ajuste sai da diferença contra '
  'este número — usar o saldo do momento da aplicação apagaria o consumo '
  'legítimo que aconteceu no meio.';

alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;

drop policy if exists "stock_counts_select" on public.stock_counts;
create policy "stock_counts_select" on public.stock_counts
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or clinic_id in (select public.user_clinic_ids())
  );

drop policy if exists "stock_counts_write" on public.stock_counts;
create policy "stock_counts_write" on public.stock_counts
  for all to authenticated
  using (public.can_manage_stock(clinic_id))
  with check (public.can_manage_stock(clinic_id));

drop policy if exists "stock_count_items_select" on public.stock_count_items;
create policy "stock_count_items_select" on public.stock_count_items
  for select to authenticated using (true);

drop policy if exists "stock_count_items_write" on public.stock_count_items;
create policy "stock_count_items_write" on public.stock_count_items
  for all to authenticated
  using (
    exists (select 1 from public.stock_counts c
            where c.id = count_id and c.status = 'aberta'
              and public.can_manage_stock(c.clinic_id))
  )
  with check (
    exists (select 1 from public.stock_counts c
            where c.id = count_id and c.status = 'aberta'
              and public.can_manage_stock(c.clinic_id))
  );

-- Abrir a contagem já com o esperado congelado item a item.
create or replace function public.open_stock_count(
  p_clinic_id uuid,
  p_only_with_balance boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.can_manage_stock(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if exists (select 1 from public.stock_counts
             where clinic_id = p_clinic_id and status = 'aberta') then
    raise exception 'COUNT_ALREADY_OPEN';
  end if;

  insert into public.stock_counts (clinic_id, created_by)
  values (p_clinic_id, (select auth.uid()))
  returning id into v_id;

  insert into public.stock_count_items (count_id, item_id, expected_quantity)
  select v_id, i.id, coalesce(b.quantity, 0) + coalesce(b.in_use_quantity, 0)
  from public.stock_items i
  left join public.stock_balances b
    on b.item_id = i.id and b.clinic_id = p_clinic_id
  where i.is_active
    and (not p_only_with_balance
         or coalesce(b.quantity, 0) + coalesce(b.in_use_quantity, 0) <> 0);

  return v_id;
end;
$$;

grant execute on function public.open_stock_count(uuid, boolean) to authenticated;

-- Aplicar: cada diferença vira um ajuste com motivo.
create or replace function public.apply_stock_count(
  p_count_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count record;
  v_line record;
  v_diff numeric;
  v_applied integer := 0;
  v_reason text;
begin
  select * into v_count from public.stock_counts where id = p_count_id;
  if v_count.id is null then raise exception 'COUNT_NOT_FOUND'; end if;
  if v_count.status <> 'aberta' then raise exception 'COUNT_NOT_OPEN'; end if;
  if not public.can_manage_stock(v_count.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  v_reason := 'Inventário de '
    || to_char(v_count.count_date, 'DD/MM/YYYY')
    || case when coalesce(btrim(p_reason), '') <> ''
            then ' — ' || btrim(p_reason) else '' end;

  for v_line in
    select * from public.stock_count_items
    where count_id = p_count_id and counted_quantity is not null
  loop
    -- Diferença contra o ESPERADO CONGELADO: o consumo que aconteceu enquanto
    -- se contava continua valendo.
    v_diff := v_line.counted_quantity - v_line.expected_quantity;
    if v_diff = 0 then continue; end if;

    perform public.apply_stock_movement(
      p_clinic_id => v_count.clinic_id,
      p_item_id => v_line.item_id,
      p_kind => case when v_diff > 0 then 'ajuste_entrada' else 'ajuste_saida' end,
      p_quantity => abs(v_diff),
      p_movement_date => v_count.count_date,
      p_reason => v_reason,
      p_source_type => 'stock_count',
      p_source_id => p_count_id
    );
    v_applied := v_applied + 1;
  end loop;

  update public.stock_counts
     set status = 'aplicada', applied_at = now(),
         applied_by = (select auth.uid()),
         notes = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), notes)
   where id = p_count_id;

  return v_applied;
end;
$$;

grant execute on function public.apply_stock_count(uuid, text) to authenticated;

create or replace function public.discard_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count record;
begin
  select * into v_count from public.stock_counts where id = p_count_id;
  if v_count.id is null then raise exception 'COUNT_NOT_FOUND'; end if;
  if not public.can_manage_stock(v_count.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_count.status <> 'aberta' then raise exception 'COUNT_NOT_OPEN'; end if;

  update public.stock_counts set status = 'descartada' where id = p_count_id;
end;
$$;

grant execute on function public.discard_stock_count(uuid) to authenticated;

-- O movimento do inventário aponta para a contagem: do ajuste dá para chegar
-- na folha que o gerou.
create index if not exists stock_movements_count_idx
  on public.stock_movements (source_id)
  where source_type = 'stock_count';

-- -----------------------------------------------------------------------------
-- 2) LISTA DE REPOSIÇÃO — o que comprar, em EMBALAGENS
-- -----------------------------------------------------------------------------
-- Comprar é em caixa, não em unidade. A sugestão arredonda para CIMA: pedir
-- meia caixa não existe, e faltar custa mais que sobrar um pouco.
create or replace function public.replenishment_list(p_clinic_id uuid)
returns table (
  item_id uuid,
  item_name text,
  brand text,
  purchase_unit text,
  stock_unit text,
  total_quantity numeric,
  min_quantity numeric,
  max_quantity numeric,
  suggested_packages numeric,
  avg_cost_cents numeric,
  estimated_cost_cents bigint,
  supplier_id uuid,
  state text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      i.id, i.name, i.brand, i.purchase_unit, i.unit_of_measure,
      coalesce(b.quantity, 0) + coalesce(b.in_use_quantity, 0) as total,
      coalesce(b.min_quantity, 0) as minimo,
      b.max_quantity as maximo,
      greatest(coalesce(i.units_per_purchase, 1), 0.000001) as fator,
      coalesce(b.avg_cost_cents, 0) as avg_cost,
      b.preferred_supplier_id
    from public.stock_items i
    join public.stock_balances b
      on b.item_id = i.id and b.clinic_id = p_clinic_id
    where i.is_active
  )
  select
    id, name, brand, purchase_unit, unit_of_measure,
    total, minimo, maximo,
    ceil(
      (coalesce(maximo, minimo * 2) - total) / fator
    )::numeric,
    avg_cost,
    round(ceil((coalesce(maximo, minimo * 2) - total) / fator)
          * fator * avg_cost)::bigint,
    preferred_supplier_id,
    case when total < 0 then 'negativo'
         when total = 0 then 'zerado'
         else 'abaixo_do_minimo' end
  from base
  where minimo > 0 and total <= minimo
    and coalesce(maximo, minimo * 2) > total
  order by (total / greatest(minimo, 0.000001)), name;
$$;

grant execute on function public.replenishment_list(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) ACIMA DO MÁXIMO — dinheiro parado
-- -----------------------------------------------------------------------------
create or replace function public.overstocked_items(p_clinic_id uuid)
returns table (
  item_id uuid,
  item_name text,
  stock_unit text,
  total_quantity numeric,
  max_quantity numeric,
  excess_quantity numeric,
  excess_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.name, i.unit_of_measure,
    coalesce(b.quantity, 0) + coalesce(b.in_use_quantity, 0),
    b.max_quantity,
    coalesce(b.quantity, 0) + coalesce(b.in_use_quantity, 0) - b.max_quantity,
    round((coalesce(b.quantity, 0) + coalesce(b.in_use_quantity, 0)
           - b.max_quantity) * coalesce(b.avg_cost_cents, 0))::bigint
  from public.stock_balances b
  join public.stock_items i on i.id = b.item_id
  where b.clinic_id = p_clinic_id
    and i.is_active
    and b.max_quantity is not null and b.max_quantity > 0
    and coalesce(b.quantity, 0) + coalesce(b.in_use_quantity, 0) > b.max_quantity
  order by 7 desc;
$$;

grant execute on function public.overstocked_items(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_counts) as contagens,
  (select count(*) from public.stock_counts where status = 'aberta')
    as contagens_abertas,
  (select count(*) from public.stock_movements where source_type = 'stock_count')
    as ajustes_de_inventario,
  (select count(*) from public.stock_balances
    where min_quantity > 0) as itens_com_minimo,
  (select count(*) from public.stock_balances
    where max_quantity is not null) as itens_com_maximo;
