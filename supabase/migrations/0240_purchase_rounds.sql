-- =============================================================================
-- 0240 — Compras C2: a mesa de negociação da franqueadora
-- -----------------------------------------------------------------------------
-- O C1 entregou a lista de cada unidade. Aqui elas viram PODER DE NEGOCIAÇÃO:
-- o comprador junta as requisições numa RODADA, vê tudo consolidado por item
-- ("Resina A2 — 47 tubos, de 6 unidades"), registra cotação por fornecedor e
-- escolhe de quem comprar CADA item — podendo dividir.
--
-- A RODADA É DA REDE; O PEDIDO É DA UNIDADE. Esta migração termina no
-- *item → fornecedor → preço*. Os pedidos, o faturamento e a entrega são o C3.
-- Juntar os dois num objeto só faria o faturamento individual virar remendo — e
-- é a separação que sustenta o módulo inteiro.
--
-- EM BRANCO NÃO É ZERO. Fornecedor que não cotou um item fica com preço NULO,
-- nunca 0: zero é um preço (e ganharia qualquer comparação de "melhor preço"),
-- enquanto nulo é "não quis cotar". Confundir os dois faria a mesa premiar
-- justamente quem não respondeu.
--
-- ITEM SEM COTAÇÃO NENHUMA NÃO TRAVA A RODADA. Ele volta para a unidade como
-- NÃO NEGOCIADO, e ela resolve local (que já é caminho previsto e medido, desde
-- o `is_local` do C1). Travar a rodada inteira por causa de uma gaze faria a
-- mesa parar de existir na prática.
--
-- A FRANQUEADORA PODE ALTERAR QUANTIDADE (decisão 3 do dono, que passa a valer
-- aqui) — ela vai pagar por aquilo. A alteração fica GRAVADA ao lado do pedido
-- original, para a unidade aprovar no C3 vendo o que mudou. E o rateio da
-- diferença entre as unidades é PROPORCIONAL, com a sobra dos arredondamentos
-- indo para a maior: mesma regra das parcelas de venda e da depreciação, para
-- não sobrar centavo órfão nem faltar unidade na conta.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A RODADA
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_rounds (
  id uuid primary key default gen_random_uuid(),
  -- Código do documento: RC nunca some do registro (regra do dono).
  code text unique,
  name text,
  status text not null default 'aberta'
    check (status in ('aberta', 'cotando', 'fechada', 'cancelada')),
  notes text,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_rounds_status_idx
  on public.purchase_rounds (status, created_at desc);

-- A requisição entra em UMA rodada. Sem isso, a mesma necessidade poderia ser
-- negociada duas vezes e a unidade receberia o item em dobro.
alter table public.purchase_requests
  add column if not exists round_id uuid references public.purchase_rounds (id);

create index if not exists purchase_requests_round_idx
  on public.purchase_requests (round_id);

-- -----------------------------------------------------------------------------
-- 2) O CONSOLIDADO POR ITEM — onde mora a decisão
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_round_items (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.purchase_rounds (id)
    on delete cascade,
  -- Nulo = linha livre (o que não se estoca), agrupada pela descrição.
  item_id uuid references public.stock_items (id),
  description text not null,
  purchase_unit text,
  -- O que as unidades pediram, somado. Congelado ao montar a rodada.
  requested_quantity numeric(14,3) not null check (requested_quantity > 0),
  -- O que a franqueadora decidiu comprar. Nulo = igual ao pedido.
  adjusted_quantity numeric(14,3) check (adjusted_quantity >= 0),
  adjust_reason text,
  -- A previsão do C1, somada — é contra ela que a economia é medida.
  estimated_total_cents bigint not null default 0,
  -- O resultado da negociação.
  awarded_supplier_id uuid references public.suppliers (id),
  awarded_unit_cents bigint check (awarded_unit_cents >= 0),
  awarded_at timestamptz,
  awarded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint purchase_round_item_unique unique nulls not distinct
    (round_id, item_id, description)
);

create index if not exists purchase_round_items_round_idx
  on public.purchase_round_items (round_id);

comment on column public.purchase_round_items.adjusted_quantity is
  'Quantidade que a franqueadora decidiu comprar, quando diferente do pedido. '
  'Nulo = comprou o que foi pedido. A diferença é rateada proporcionalmente '
  'entre as unidades e a alteração aparece para a unidade aprovar no C3 — quem '
  'paga é ela.';

-- -----------------------------------------------------------------------------
-- 3) AS COTAÇÕES
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_quotes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.purchase_rounds (id)
    on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  delivery_days integer check (delivery_days >= 0),
  payment_terms text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint purchase_quote_unique unique (round_id, supplier_id)
);

create table if not exists public.purchase_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.purchase_quotes (id)
    on delete cascade,
  round_item_id uuid not null references public.purchase_round_items (id)
    on delete cascade,
  -- NULO = não cotou. Nunca 0: zero é um preço, e ganharia a comparação de
  -- melhor preço de quem simplesmente não respondeu.
  unit_cents bigint check (unit_cents is null or unit_cents >= 0),
  notes text,
  constraint purchase_quote_item_unique unique (quote_id, round_item_id)
);

create index if not exists purchase_quote_items_item_idx
  on public.purchase_quote_items (round_item_id);

-- -----------------------------------------------------------------------------
-- 4) RLS — a mesa é da franqueadora
-- -----------------------------------------------------------------------------
-- A unidade NÃO vê a mesa: ela vê a própria parte quando a rodada fecha (C3).
-- Deixar o franqueado ver a cotação dos outros seria entregar a negociação da
-- rede para o outro lado dela.
do $$
declare
  t text;
begin
  foreach t in array array['purchase_rounds', 'purchase_round_items',
                           'purchase_quotes', 'purchase_quote_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_all" on public.%I', t, t);
    execute format(
      'create policy "%s_all" on public.%I for all to authenticated '
      'using (public.is_admin_master() or public.is_finance_franchisor() '
      '       or public.is_purchaser()) '
      'with check (public.is_admin_master() or public.is_finance_franchisor() '
      '       or public.is_purchaser())', t, t);
  end loop;
end;
$$;

-- Código RC-0001 da rodada.
create or replace function public.set_purchase_round_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := 'RC-' || lpad(
      (coalesce((select max(substring(code from 4)::integer)
                 from public.purchase_rounds
                 where code ~ '^RC-[0-9]+$'), 0) + 1)::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_rounds_code on public.purchase_rounds;
create trigger purchase_rounds_code
  before insert on public.purchase_rounds
  for each row execute function public.set_purchase_round_code();

-- -----------------------------------------------------------------------------
-- 5) ABRIR A RODADA — juntar as requisições enviadas
-- -----------------------------------------------------------------------------
create or replace function public.open_purchase_round(
  p_request_ids uuid[],
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_round uuid;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or public.is_purchaser()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_request_ids is null or cardinality(p_request_ids) = 0 then
    raise exception 'NO_REQUESTS';
  end if;

  -- Requisição já negociada não entra de novo: seria comprar em dobro.
  if exists (
    select 1 from public.purchase_requests r
     where r.id = any(p_request_ids)
       and (r.round_id is not null or r.status <> 'enviada')
  ) then
    raise exception 'REQUEST_NOT_AVAILABLE';
  end if;

  insert into public.purchase_rounds (name, created_by)
  values (nullif(btrim(p_name), ''), v_user)
  returning id into v_round;

  update public.purchase_requests
     set round_id = v_round, status = 'em_negociacao', updated_at = now()
   where id = any(p_request_ids);

  -- O consolidado: soma por item, e por DESCRIÇÃO nas linhas livres. Item de
  -- estoque agrupa pelo cadastro; linha livre agrupa pelo texto, que é o que
  -- existe. A previsão vem somada do C1 e fica CONGELADA — é contra ela que a
  -- economia da rodada vai ser medida no C4.
  insert into public.purchase_round_items (
    round_id, item_id, description, purchase_unit,
    requested_quantity, estimated_total_cents
  )
  select
    v_round,
    i.item_id,
    coalesce(max(s.name), max(i.description)),
    max(i.purchase_unit),
    sum(i.quantity),
    sum(i.estimated_total_cents)
  from public.purchase_request_items i
  join public.purchase_requests r on r.id = i.request_id
  left join public.stock_items s on s.id = i.item_id
  where r.round_id = v_round
  group by i.item_id,
           case when i.item_id is null then lower(btrim(i.description)) end;

  return v_round;
end;
$$;

revoke all on function public.open_purchase_round(uuid[], text) from public;
grant execute on function public.open_purchase_round(uuid[], text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6) COTAR E ESCOLHER
-- -----------------------------------------------------------------------------
create or replace function public.save_purchase_quote(
  p_round_id uuid,
  p_supplier_id uuid,
  p_delivery_days integer default null,
  p_payment_terms text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or public.is_purchaser()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.purchase_rounds
                  where id = p_round_id and status in ('aberta', 'cotando')) then
    raise exception 'ROUND_CLOSED';
  end if;

  insert into public.purchase_quotes
    (round_id, supplier_id, delivery_days, payment_terms, notes, created_by)
  values (p_round_id, p_supplier_id, p_delivery_days,
          nullif(btrim(p_payment_terms), ''), nullif(btrim(p_notes), ''), v_user)
  on conflict (round_id, supplier_id) do update
    set delivery_days = excluded.delivery_days,
        payment_terms = excluded.payment_terms,
        notes = excluded.notes
  returning id into v_id;

  update public.purchase_rounds
     set status = 'cotando', updated_at = now()
   where id = p_round_id and status = 'aberta';

  return v_id;
end;
$$;

revoke all on function public.save_purchase_quote(uuid, uuid, integer, text, text)
  from public;
grant execute on function public.save_purchase_quote(uuid, uuid, integer, text, text)
  to authenticated;

-- Preço de um item numa cotação. NULO apaga a linha: "não cotou" é ausência,
-- não é um valor.
create or replace function public.save_quote_price(
  p_quote_id uuid,
  p_round_item_id uuid,
  p_unit_cents bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or public.is_purchaser()) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_unit_cents is null then
    delete from public.purchase_quote_items
     where quote_id = p_quote_id and round_item_id = p_round_item_id;
    return;
  end if;

  insert into public.purchase_quote_items (quote_id, round_item_id, unit_cents)
  values (p_quote_id, p_round_item_id, greatest(0, p_unit_cents))
  on conflict (quote_id, round_item_id) do update
    set unit_cents = excluded.unit_cents;
end;
$$;

revoke all on function public.save_quote_price(uuid, uuid, bigint) from public;
grant execute on function public.save_quote_price(uuid, uuid, bigint)
  to authenticated;

-- Escolher o fornecedor de UM item. O sistema sugere o melhor preço, mas quem
-- decide é o comprador: prazo e condição às vezes valem mais que centavos, e é
-- essa a razão de existir de uma mesa de negociação.
create or replace function public.award_round_item(
  p_round_item_id uuid,
  p_supplier_id uuid,
  p_adjusted_quantity numeric default null,
  p_adjust_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_price bigint;
  v_round uuid;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or public.is_purchaser()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select round_id into v_round from public.purchase_round_items
   where id = p_round_item_id;
  if v_round is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if not exists (select 1 from public.purchase_rounds
                  where id = v_round and status in ('aberta', 'cotando')) then
    raise exception 'ROUND_CLOSED';
  end if;

  -- Desfazer a escolha.
  if p_supplier_id is null then
    update public.purchase_round_items
       set awarded_supplier_id = null, awarded_unit_cents = null,
           awarded_at = null, awarded_by = null
     where id = p_round_item_id;
    return;
  end if;

  select qi.unit_cents into v_price
  from public.purchase_quote_items qi
  join public.purchase_quotes q on q.id = qi.quote_id
  where qi.round_item_id = p_round_item_id
    and q.round_id = v_round and q.supplier_id = p_supplier_id;

  -- Só se escolhe quem cotou: premiar quem não respondeu deixaria o pedido sem
  -- preço, e o C3 pediria aprovação de um valor que não existe.
  if v_price is null then raise exception 'SUPPLIER_DID_NOT_QUOTE'; end if;

  update public.purchase_round_items set
    awarded_supplier_id = p_supplier_id,
    awarded_unit_cents = v_price,
    awarded_at = now(),
    awarded_by = v_user,
    adjusted_quantity = p_adjusted_quantity,
    adjust_reason = nullif(btrim(p_adjust_reason), '')
  where id = p_round_item_id;
end;
$$;

revoke all on function public.award_round_item(uuid, uuid, numeric, text)
  from public;
grant execute on function public.award_round_item(uuid, uuid, numeric, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 7) A MESA, PARA A TELA
-- -----------------------------------------------------------------------------
create or replace function public.round_items_view(p_round_id uuid)
returns table (
  round_item_id uuid,
  item_id uuid,
  description text,
  purchase_unit text,
  requested_quantity numeric,
  adjusted_quantity numeric,
  adjust_reason text,
  clinics integer,
  estimated_total_cents bigint,
  quotes integer,
  best_supplier_id uuid,
  best_unit_cents bigint,
  awarded_supplier_id uuid,
  awarded_supplier_name text,
  awarded_unit_cents bigint,
  awarded_total_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ri.id,
    ri.item_id,
    ri.description,
    ri.purchase_unit,
    ri.requested_quantity,
    ri.adjusted_quantity,
    ri.adjust_reason,
    coalesce(u.n, 0)::integer,
    ri.estimated_total_cents,
    coalesce(b.n, 0)::integer,
    b.best_supplier,
    b.best_price,
    ri.awarded_supplier_id,
    s.name,
    ri.awarded_unit_cents,
    (coalesce(ri.adjusted_quantity, ri.requested_quantity)
      * coalesce(ri.awarded_unit_cents, 0))::bigint
  from public.purchase_round_items ri
  left join public.suppliers s on s.id = ri.awarded_supplier_id
  -- Quantas unidades pediram este item.
  left join lateral (
    select count(distinct r.clinic_id) as n
    from public.purchase_request_items i
    join public.purchase_requests r on r.id = i.request_id
    where r.round_id = ri.round_id
      and (
        (ri.item_id is not null and i.item_id = ri.item_id)
        or (ri.item_id is null and i.item_id is null
            and lower(btrim(i.description)) = lower(btrim(ri.description)))
      )
  ) u on true
  -- A melhor cotação. `unit_cents` nulo nem entra: não cotou não concorre.
  left join lateral (
    select count(*) as n,
           (array_agg(q.supplier_id order by qi.unit_cents))[1] as best_supplier,
           min(qi.unit_cents) as best_price
    from public.purchase_quote_items qi
    join public.purchase_quotes q on q.id = qi.quote_id
    where qi.round_item_id = ri.id and qi.unit_cents is not null
  ) b on true
  where ri.round_id = p_round_id
    and (public.is_admin_master() or public.is_finance_franchisor()
         or public.is_purchaser())
  order by ri.description;
$$;

grant execute on function public.round_items_view(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) FECHAR A RODADA — a parte de cada unidade
-- -----------------------------------------------------------------------------
-- O rateio é PROPORCIONAL ao que cada unidade pediu, e a SOBRA dos
-- arredondamentos vai para a maior. Sem essa regra, alterar 47 para 45 deixaria
-- fração de tubo espalhada e a soma das partes não bateria com o total
-- comprado — a mesma lei da última parcela e da última depreciação.
create or replace function public.round_allocation(p_round_id uuid)
returns table (
  clinic_id uuid,
  clinic_name text,
  round_item_id uuid,
  description text,
  supplier_id uuid,
  supplier_name text,
  requested_quantity numeric,
  allocated_quantity numeric,
  unit_cents bigint,
  total_cents bigint,
  estimated_total_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with pedido as (
    select
      ri.id as round_item_id,
      ri.description,
      ri.awarded_supplier_id,
      ri.awarded_unit_cents,
      coalesce(ri.adjusted_quantity, ri.requested_quantity) as comprar,
      ri.requested_quantity as pedido_total,
      r.clinic_id,
      sum(i.quantity) as pedido_unidade,
      sum(i.estimated_total_cents) as previsto
    from public.purchase_round_items ri
    join public.purchase_requests r on r.round_id = ri.round_id
    join public.purchase_request_items i on i.request_id = r.id
      and (
        (ri.item_id is not null and i.item_id = ri.item_id)
        or (ri.item_id is null and i.item_id is null
            and lower(btrim(i.description)) = lower(btrim(ri.description)))
      )
    where ri.round_id = p_round_id
      and ri.awarded_supplier_id is not null
    group by ri.id, ri.description, ri.awarded_supplier_id,
             ri.awarded_unit_cents, ri.adjusted_quantity,
             ri.requested_quantity, r.clinic_id
  ),
  rateado as (
    select
      p.*,
      -- Proporcional, truncado; a sobra vai para a maior, logo abaixo.
      floor(p.comprar * p.pedido_unidade / nullif(p.pedido_total, 0)) as base,
      row_number() over (
        partition by p.round_item_id
        order by p.pedido_unidade desc, p.clinic_id
      ) as posicao,
      sum(floor(p.comprar * p.pedido_unidade / nullif(p.pedido_total, 0)))
        over (partition by p.round_item_id) as soma_base
    from pedido p
  )
  select
    c.id,
    c.name,
    x.round_item_id,
    x.description,
    x.awarded_supplier_id,
    s.name,
    x.pedido_unidade,
    x.qtd,
    x.awarded_unit_cents,
    (x.qtd * x.awarded_unit_cents)::bigint,
    x.previsto::bigint
  from (
    select
      r.*,
      r.base + case when r.posicao = 1 then r.comprar - r.soma_base else 0 end
        as qtd
    from rateado r
  ) x
  join public.clinics c on c.id = x.clinic_id
  left join public.suppliers s on s.id = x.awarded_supplier_id
  where x.qtd > 0
    and (public.is_admin_master() or public.is_finance_franchisor()
         or public.is_purchaser())
  order by c.name, x.description;
$$;

grant execute on function public.round_allocation(uuid) to authenticated;

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

  -- Fechar sem nenhum item escolhido não é fechar, é cancelar.
  if v_awarded = 0 then raise exception 'NOTHING_AWARDED'; end if;

  update public.purchase_rounds
     set status = 'fechada', closed_at = now(), closed_by = v_user,
         updated_at = now()
   where id = p_round_id;

  -- Item sem cotação volta para a unidade como NÃO negociado: ela resolve
  -- local, que já é caminho previsto e medido (`is_local`, C1). Travar a
  -- rodada por causa de uma gaze faria a mesa parar de existir.
  update public.purchase_requests
     set status = 'concluida', updated_at = now()
   where round_id = p_round_id;

  return v_awarded;
end;
$$;

revoke all on function public.close_purchase_round(uuid) from public;
grant execute on function public.close_purchase_round(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.purchase_rounds) as rodadas,
  (select count(*) from public.purchase_requests where status = 'enviada')
    as requisicoes_esperando_rodada,
  (select count(*) from public.purchase_round_items) as itens_consolidados,
  (select count(*) from public.purchase_quote_items where unit_cents is not null)
    as precos_cotados;
