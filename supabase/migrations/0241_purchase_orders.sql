-- =============================================================================
-- 0241 — Compras C3a: a unidade aprova, e o pedido nasce
-- -----------------------------------------------------------------------------
-- O C2 fechou a rodada com *item → fornecedor → preço*. Aqui a unidade vê a
-- parte dela, aprova ou recusa item a item, e os pedidos nascem.
--
-- A PARTE DA UNIDADE PASSA A SER GRAVADA. No C2 ela era calculada na hora
-- (`round_allocation`), e isso não serve para aprovar: editar a rodada depois
-- mudaria silenciosamente o que a unidade já tinha aprovado. Congelar é a mesma
-- regra do preço previsto (C1), do repasse (0209) e da alçada (0194).
--
-- UM PEDIDO POR UNIDADE **E POR FORNECEDOR**. É ele que é faturado, pago e
-- entregue naquele endereço. É a razão de a rodada e o pedido serem objetos
-- diferentes desde o plano: um pedido por rodada faria o faturamento individual
-- virar remendo.
--
-- SILÊNCIO NÃO VIRA APROVAÇÃO. Sem decisão da unidade o pedido não nasce — é
-- dinheiro dela. A franqueadora enxerga quem não respondeu, e isso vira
-- cobrança, não automatismo.
--
-- RECUSA É UM DIREITO, E FICA VISÍVEL. A unidade recusa com motivo opcional; a
-- franqueadora vê. Sem esse registro, o volume combinado com o fornecedor cairia
-- sem ninguém saber por quê — e é justamente o que derruba a negociação da
-- próxima rodada.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A PARTE DE CADA UNIDADE, GRAVADA
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_allocations (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.purchase_rounds (id)
    on delete cascade,
  round_item_id uuid not null references public.purchase_round_items (id)
    on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  description text not null,
  supplier_id uuid references public.suppliers (id),
  -- O que a unidade pediu e o que coube a ela depois do rateio.
  requested_quantity numeric(14,3) not null,
  allocated_quantity numeric(14,3) not null check (allocated_quantity > 0),
  -- Congelados: é contra a previsão que a economia aparece para a unidade.
  unit_cents bigint not null default 0,
  total_cents bigint not null default 0,
  estimated_total_cents bigint not null default 0,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'recusado')),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  refuse_reason text,
  order_id uuid,
  created_at timestamptz not null default now(),
  constraint purchase_allocation_unique unique (round_item_id, clinic_id)
);

create index if not exists purchase_allocations_clinic_idx
  on public.purchase_allocations (clinic_id, status);

alter table public.purchase_allocations enable row level security;

-- A unidade vê a PARTE DELA; a franqueadora vê todas.
drop policy if exists "purchase_allocations_select" on public.purchase_allocations;
create policy "purchase_allocations_select" on public.purchase_allocations
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or public.is_purchaser()
    or clinic_id in (select public.user_clinic_ids())
  );

-- -----------------------------------------------------------------------------
-- 2) O PEDIDO
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  -- Código do documento: PD nunca some do registro (regra do dono).
  code text unique,
  clinic_id uuid not null references public.clinics (id),
  supplier_id uuid not null references public.suppliers (id),
  round_id uuid references public.purchase_rounds (id),
  status text not null default 'aberto'
    check (status in ('aberto', 'recebido_parcial', 'recebido', 'cancelado')),
  total_cents bigint not null default 0,
  expected_delivery date,
  notes text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_orders_clinic_idx
  on public.purchase_orders (clinic_id, status, created_at desc);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id)
    on delete cascade,
  allocation_id uuid references public.purchase_allocations (id),
  item_id uuid references public.stock_items (id),
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cents bigint not null default 0,
  total_cents bigint not null default 0,
  -- O C3b preenche isto quando a nota chegar.
  received_quantity numeric(14,3) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_items_order_idx
  on public.purchase_order_items (order_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists "purchase_orders_select" on public.purchase_orders;
create policy "purchase_orders_select" on public.purchase_orders
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or public.is_purchaser()
    or clinic_id in (select public.user_clinic_ids())
  );

drop policy if exists "purchase_order_items_select" on public.purchase_order_items;
create policy "purchase_order_items_select" on public.purchase_order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.purchase_orders o
      where o.id = order_id
        and (public.is_admin_master() or public.is_finance_franchisor()
             or public.is_purchaser()
             or o.clinic_id in (select public.user_clinic_ids()))
    )
  );

-- A ligação alocação → pedido só pode ser criada depois que a tabela de pedidos
-- existe. Em bloco para a migração continuar segura ao rodar de novo.
do $$
begin
  alter table public.purchase_allocations
    add constraint purchase_allocations_order_fkey
    foreign key (order_id) references public.purchase_orders (id);
exception when duplicate_object then null;
end;
$$;

-- Código PD-0001.
create or replace function public.set_purchase_order_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := 'PD-' || lpad(
      (coalesce((select max(substring(code from 4)::integer)
                 from public.purchase_orders
                 where code ~ '^PD-[0-9]+$'), 0) + 1)::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_orders_code on public.purchase_orders;
create trigger purchase_orders_code
  before insert on public.purchase_orders
  for each row execute function public.set_purchase_order_code();

-- -----------------------------------------------------------------------------
-- 3) FECHAR A RODADA PASSA A GRAVAR A PARTE DE CADA UNIDADE
-- -----------------------------------------------------------------------------
create or replace function public.materialize_round_allocations(p_round_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.purchase_allocations (
    round_id, round_item_id, clinic_id, description, supplier_id,
    requested_quantity, allocated_quantity, unit_cents, total_cents,
    estimated_total_cents
  )
  select
    p_round_id, a.round_item_id, a.clinic_id, a.description, a.supplier_id,
    a.requested_quantity, a.allocated_quantity, a.unit_cents, a.total_cents,
    a.estimated_total_cents
  from public.round_allocation(p_round_id) a
  on conflict (round_item_id, clinic_id) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.materialize_round_allocations(uuid) from public;

create or replace function public.close_purchase_round(p_round_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_awarded integer;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or public.is_purchaser()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.purchase_rounds
                  where id = p_round_id and status in ('aberta', 'cotando')) then
    raise exception 'ROUND_CLOSED';
  end if;

  select count(*) into v_awarded from public.purchase_round_items
   where round_id = p_round_id and awarded_supplier_id is not null;

  if v_awarded = 0 then raise exception 'NOTHING_AWARDED'; end if;

  update public.purchase_rounds
     set status = 'fechada', closed_at = now(), closed_by = v_user,
         updated_at = now()
   where id = p_round_id;

  update public.purchase_requests
     set status = 'concluida', updated_at = now()
   where round_id = p_round_id;

  -- A PARTE DA UNIDADE CONGELA AQUI. Sem isso, editar a rodada depois mudaria
  -- silenciosamente o que a unidade já tinha aprovado.
  perform public.materialize_round_allocations(p_round_id);

  return v_awarded;
end;
$$;

revoke all on function public.close_purchase_round(uuid) from public;
grant execute on function public.close_purchase_round(uuid) to authenticated;

-- As rodadas que já foram fechadas antes desta migração não têm a parte das
-- unidades gravada. Grava agora, para o teste do dono não precisar ser refeito.
do $$
declare
  r record;
begin
  for r in select id from public.purchase_rounds where status = 'fechada' loop
    perform public.materialize_round_allocations(r.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) APROVAR OU RECUSAR
-- -----------------------------------------------------------------------------
create or replace function public.decide_allocation(
  p_allocation_id uuid,
  p_approved boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_a record;
begin
  select * into v_a from public.purchase_allocations where id = p_allocation_id;
  if v_a.id is null then raise exception 'ALLOCATION_NOT_FOUND'; end if;

  -- Quem decide é quem monta a lista da unidade: o gerente. A franqueadora não
  -- aprova no lugar dela — é dinheiro da unidade.
  if not (public.is_admin_master()
          or public.has_role_in_clinic(v_a.clinic_id,
               array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Item que já virou pedido não volta atrás por aqui: o pedido é o documento,
  -- e desfazer exige cancelar o pedido.
  if v_a.order_id is not null then raise exception 'ALREADY_ORDERED'; end if;

  update public.purchase_allocations set
    status = case when p_approved then 'aprovado' else 'recusado' end,
    decided_at = now(),
    decided_by = v_user,
    refuse_reason = case when p_approved then null
                         else nullif(btrim(p_reason), '') end
  where id = p_allocation_id;
end;
$$;

revoke all on function public.decide_allocation(uuid, boolean, text) from public;
grant execute on function public.decide_allocation(uuid, boolean, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) GERAR OS PEDIDOS — um por fornecedor
-- -----------------------------------------------------------------------------
create or replace function public.create_orders_from_round(
  p_round_id uuid,
  p_clinic_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_sup record;
  v_order uuid;
  v_n integer := 0;
begin
  if not (public.is_admin_master()
          or public.has_role_in_clinic(p_clinic_id,
               array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Nada aprovado, nada a pedir. Gerar pedido vazio só criaria documento para
  -- alguém cancelar depois.
  if not exists (
    select 1 from public.purchase_allocations
     where round_id = p_round_id and clinic_id = p_clinic_id
       and status = 'aprovado' and order_id is null
  ) then
    raise exception 'NOTHING_APPROVED';
  end if;

  for v_sup in
    select distinct supplier_id
    from public.purchase_allocations
    where round_id = p_round_id and clinic_id = p_clinic_id
      and status = 'aprovado' and order_id is null
      and supplier_id is not null
  loop
    insert into public.purchase_orders
      (clinic_id, supplier_id, round_id, created_by)
    values (p_clinic_id, v_sup.supplier_id, p_round_id, v_user)
    returning id into v_order;

    insert into public.purchase_order_items
      (order_id, allocation_id, item_id, description, quantity, unit_cents,
       total_cents)
    select
      v_order, a.id, ri.item_id, a.description, a.allocated_quantity,
      a.unit_cents, a.total_cents
    from public.purchase_allocations a
    join public.purchase_round_items ri on ri.id = a.round_item_id
    where a.round_id = p_round_id and a.clinic_id = p_clinic_id
      and a.supplier_id = v_sup.supplier_id
      and a.status = 'aprovado' and a.order_id is null;

    update public.purchase_allocations set order_id = v_order
     where round_id = p_round_id and clinic_id = p_clinic_id
       and supplier_id = v_sup.supplier_id
       and status = 'aprovado' and order_id is null;

    update public.purchase_orders set total_cents = (
      select coalesce(sum(total_cents), 0)
      from public.purchase_order_items where order_id = v_order
    ) where id = v_order;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.create_orders_from_round(uuid, uuid) from public;
grant execute on function public.create_orders_from_round(uuid, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6) QUEM AINDA NÃO RESPONDEU — para a franqueadora cobrar
-- -----------------------------------------------------------------------------
-- Silêncio não vira aprovação: sem decisão, o pedido não nasce. Mas a
-- franqueadora precisa VER o silêncio, senão ele vira surpresa no fim do mês.
create or replace function public.round_pending_approvals(p_round_id uuid)
returns table (
  clinic_id uuid,
  clinic_name text,
  pending integer,
  approved integer,
  refused integer,
  pending_cents bigint,
  approved_cents bigint,
  orders integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    count(*) filter (where a.status = 'pendente')::integer,
    count(*) filter (where a.status = 'aprovado')::integer,
    count(*) filter (where a.status = 'recusado')::integer,
    coalesce(sum(a.total_cents) filter (where a.status = 'pendente'), 0)::bigint,
    coalesce(sum(a.total_cents) filter (where a.status = 'aprovado'), 0)::bigint,
    count(distinct a.order_id)::integer
  from public.purchase_allocations a
  join public.clinics c on c.id = a.clinic_id
  where a.round_id = p_round_id
    and (public.is_admin_master() or public.is_finance_franchisor()
         or public.is_purchaser())
  group by c.id, c.name
  order by c.name;
$$;

grant execute on function public.round_pending_approvals(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.purchase_allocations) as partes_gravadas,
  (select count(*) from public.purchase_allocations where status = 'pendente')
    as esperando_decisao,
  (select count(*) from public.purchase_orders) as pedidos,
  (select count(*) from public.purchase_rounds where status = 'fechada')
    as rodadas_fechadas;
