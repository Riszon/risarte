-- =============================================================================
-- 0239 — Compras C1: a necessidade da unidade
-- -----------------------------------------------------------------------------
-- Primeiro passo do módulo aprovado em 12/08 (docs/COMPRAS.md). O objetivo, nas
-- palavras do dono: "concentrar a compra na franqueadora para melhorar a
-- capacidade de negociação". Daí a arquitetura inteira: **a NEGOCIAÇÃO é da
-- rede, mas o DINHEIRO é da unidade**.
--
-- A C1 entrega valor sozinha: a lista de compras pronta, com previsão de custo.
--
-- PREVISÃO EM TRÊS DEGRAUS, E A ORIGEM VIAJA JUNTO COM O NÚMERO:
--   1. última compra DESTA unidade   — o mais confiável
--   2. última compra DA REDE         — quando esta unidade nunca comprou
--   3. custo médio atual             — quando não há compra nenhuma
-- Sem dizer de onde veio, um preço de dois anos atrás pareceria tão sólido
-- quanto o de ontem. Mesma regra do repasse por nível e do custo do kit:
-- MOSTRAR A ORIGEM DO NÚMERO FAZ PARTE DO NÚMERO.
--
-- O PREÇO É CONGELADO NA LINHA no momento em que ela nasce. A previsão serve
-- para comparar com o negociado depois (é o indicador que prova ou derruba a
-- tese de centralizar); se ela se recalculasse sozinha, a economia medida
-- mudaria de valor toda vez que alguém abrisse a tela.
--
-- LINHA LIVRE para o que não se estoca (uma cadeira, um conserto): sem item, com
-- a conta de despesa escolhida na hora. Obrigar tudo a virar item de estoque
-- faria o catálogo encher de coisa que nunca terá saldo.
--
-- COMPRA LOCAL (decisão do dono): a unidade PODE comprar direto, e a requisição
-- nasce marcada como tal. Proibir não impede a compra — faz ela sair do sistema,
-- e aí some do estoque, do custo e do dashboard. Marcada, ela vira **vazamento
-- medido**, que é o único tipo que dá para reduzir.
-- Idempotente. REQUER a 0238 aplicada antes (valor de enum commitado).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O comprador existe na franqueadora
-- -----------------------------------------------------------------------------
create or replace function public.role_allowed_for_clinic(
  p_role public.user_role,
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (select type from public.clinics where id = p_clinic_id)
    when 'franchisor' then p_role in (
      'sdr','planner_dentist','commercial_consultant',
      'commercial_assistant','franchisor_staff','rislife_consultant',
      'finance_franchisor','purchaser'
    )
    when 'franchise_unit' then p_role in (
      'receptionist','clinical_coordinator','dentist','unit_manager',
      'tsb','asb','franchisee'
    )
    else false
  end;
$$;

/** Quem negocia com fornecedor. De propósito, NÃO é quem paga. */
create or replace function public.is_purchaser()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_clinic_roles r
    where r.user_id = (select auth.uid()) and r.role = 'purchaser'
  ) or public.is_admin_master();
$$;

grant execute on function public.is_purchaser() to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A REQUISIÇÃO
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  -- Código do documento: PC nunca some do registro (regra do dono).
  code text unique,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'enviada', 'em_negociacao', 'concluida',
                      'cancelada')),
  -- Compra local: a unidade resolveu sozinha. Vira vazamento MEDIDO.
  is_local boolean not null default false,
  notes text,
  sent_at timestamptz,
  sent_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_requests_clinic_idx
  on public.purchase_requests (clinic_id, status, created_at desc);

create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests (id)
    on delete cascade,
  -- Nulo = linha LIVRE (o que não se estoca).
  item_id uuid references public.stock_items (id),
  description text not null,
  -- Conta de despesa da linha livre; a de item vem do estoque.
  account_code text references public.chart_of_accounts (code),
  -- Quantidade em EMBALAGENS — é assim que se compra e é assim que a
  -- `replenishment_list` sugere.
  quantity numeric(14,3) not null check (quantity > 0),
  purchase_unit text,
  -- A previsão, CONGELADA, e de onde ela veio.
  estimated_unit_cents bigint not null default 0,
  estimated_total_cents bigint not null default 0,
  estimate_source text not null default 'sem_referencia'
    check (estimate_source in ('unidade', 'rede', 'medio', 'manual',
                               'sem_referencia')),
  estimate_date date,
  notes text,
  created_at timestamptz not null default now(),
  constraint purchase_request_item_unique unique (request_id, item_id)
);

create index if not exists purchase_request_items_request_idx
  on public.purchase_request_items (request_id);

comment on column public.purchase_request_items.estimate_source is
  'De onde veio a previsão: unidade (última compra desta unidade), rede '
  '(última compra da rede), medio (custo médio atual), manual (digitada), '
  'sem_referencia (nunca comprado e sem custo médio). A origem viaja junto com '
  'o número porque um preço de dois anos atrás parece tão sólido quanto o de '
  'ontem quando aparece sozinho.';

alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;

-- A unidade vê as suas; a franqueadora (comprador e financeiro) vê as enviadas.
drop policy if exists "purchase_requests_select" on public.purchase_requests;
create policy "purchase_requests_select" on public.purchase_requests
  for select to authenticated
  using (
    clinic_id in (select public.user_clinic_ids())
    or public.is_admin_master()
    or ((public.is_purchaser() or public.is_finance_franchisor())
        and status <> 'rascunho')
  );

-- Rascunho é da unidade: a franqueadora não vê lista que ainda está sendo
-- montada, senão o gerente perde a liberdade de rascunhar.
drop policy if exists "purchase_requests_write" on public.purchase_requests;
create policy "purchase_requests_write" on public.purchase_requests
  for all to authenticated
  using (public.is_admin_master() or public.can_manage_stock(clinic_id))
  with check (public.is_admin_master() or public.can_manage_stock(clinic_id));

drop policy if exists "purchase_request_items_select" on public.purchase_request_items;
create policy "purchase_request_items_select" on public.purchase_request_items
  for select to authenticated
  using (exists (
    select 1 from public.purchase_requests r
    where r.id = request_id
      and (r.clinic_id in (select public.user_clinic_ids())
           or public.is_admin_master()
           or ((public.is_purchaser() or public.is_finance_franchisor())
               and r.status <> 'rascunho'))
  ));

drop policy if exists "purchase_request_items_write" on public.purchase_request_items;
create policy "purchase_request_items_write" on public.purchase_request_items
  for all to authenticated
  using (exists (
    select 1 from public.purchase_requests r
    where r.id = request_id
      and (public.is_admin_master() or public.can_manage_stock(r.clinic_id))
  ))
  with check (exists (
    select 1 from public.purchase_requests r
    where r.id = request_id
      and (public.is_admin_master() or public.can_manage_stock(r.clinic_id))
  ));

-- Código PC-000001, como os outros documentos do sistema.
create sequence if not exists public.purchase_request_code_seq;

create or replace function public.set_purchase_request_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := 'PC-' || lpad(
      nextval('public.purchase_request_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_requests_code on public.purchase_requests;
create trigger purchase_requests_code
  before insert on public.purchase_requests
  for each row execute function public.set_purchase_request_code();

-- -----------------------------------------------------------------------------
-- 3) A PREVISÃO DE CUSTO, EM TRÊS DEGRAUS
-- -----------------------------------------------------------------------------
-- Devolve o preço POR EMBALAGEM e diz de onde ele veio. Só olha ENTRADA, que é
-- a única movimentação que tem preço de compra de verdade.
create or replace function public.estimated_purchase_cost(
  p_clinic_id uuid,
  p_item_id uuid
)
returns table (
  unit_cents bigint,
  source text,
  reference_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  -- 1) Última compra DESTA unidade.
  (select m.purchase_unit_cost_cents, 'unidade'::text, m.movement_date
  from public.stock_movements m
  where m.clinic_id = p_clinic_id and m.item_id = p_item_id
    and m.kind = 'entrada'
    and coalesce(m.purchase_unit_cost_cents, 0) > 0
   order by m.movement_date desc, m.created_at desc
   limit 1)

  union all

  -- 2) Última compra DA REDE, quando esta unidade nunca comprou.
  (select m.purchase_unit_cost_cents, 'rede'::text, m.movement_date
  from public.stock_movements m
  where m.item_id = p_item_id
    and m.kind = 'entrada'
    and coalesce(m.purchase_unit_cost_cents, 0) > 0
    and not exists (
      select 1 from public.stock_movements x
      where x.clinic_id = p_clinic_id and x.item_id = p_item_id
        and x.kind = 'entrada'
        and coalesce(x.purchase_unit_cost_cents, 0) > 0
    )
   order by m.movement_date desc, m.created_at desc
   limit 1)

  union all

  -- 3) Custo médio atual, convertido para embalagem. Último recurso.
  (select
    round(b.avg_cost_cents
          * greatest(coalesce(i.units_per_purchase, 1), 0.000001))::bigint,
    'medio'::text,
    null::date
  from public.stock_balances b
  join public.stock_items i on i.id = b.item_id
  where b.clinic_id = p_clinic_id and b.item_id = p_item_id
    and coalesce(b.avg_cost_cents, 0) > 0
    and not exists (
      select 1 from public.stock_movements x
      where x.item_id = p_item_id and x.kind = 'entrada'
        and coalesce(x.purchase_unit_cost_cents, 0) > 0
    )
   limit 1);
$$;

grant execute on function public.estimated_purchase_cost(uuid, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) GERAR A LISTA a partir do que está abaixo do mínimo
-- -----------------------------------------------------------------------------
-- Reaproveita a `replenishment_list()` da E5 (0222) — quem decide o que falta
-- continua sendo o estoque, e uma segunda régua aqui divergiria dele.
create or replace function public.build_purchase_request(
  p_clinic_id uuid,
  p_is_local boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_row record;
  v_est record;
begin
  if not (public.is_admin_master() or public.can_manage_stock(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.purchase_requests (clinic_id, is_local, created_by)
  values (p_clinic_id, coalesce(p_is_local, false), v_user)
  returning id into v_id;

  for v_row in
    select * from public.replenishment_list(p_clinic_id)
     where suggested_packages > 0
  loop
    select * into v_est
      from public.estimated_purchase_cost(p_clinic_id, v_row.item_id);

    insert into public.purchase_request_items (
      request_id, item_id, description, quantity, purchase_unit,
      estimated_unit_cents, estimated_total_cents, estimate_source,
      estimate_date
    ) values (
      v_id, v_row.item_id,
      v_row.item_name || coalesce(' — ' || v_row.brand, ''),
      v_row.suggested_packages, v_row.purchase_unit,
      coalesce(v_est.unit_cents, 0),
      round(coalesce(v_est.unit_cents, 0) * v_row.suggested_packages)::bigint,
      coalesce(v_est.source, 'sem_referencia'),
      v_est.reference_date
    )
    on conflict (request_id, item_id) do nothing;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.build_purchase_request(uuid, boolean) from public;
grant execute on function public.build_purchase_request(uuid, boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) ENVIAR À FRANQUEADORA — o gerente da unidade
-- -----------------------------------------------------------------------------
create or replace function public.send_purchase_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_user uuid := (select auth.uid());
  v_items integer;
begin
  select * into v_r from public.purchase_requests where id = p_id;
  if v_r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.can_manage_stock(v_r.clinic_id))
  then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_r.status <> 'rascunho' then raise exception 'ALREADY_SENT'; end if;

  select count(*) into v_items
    from public.purchase_request_items where request_id = p_id;
  if v_items = 0 then raise exception 'EMPTY_REQUEST'; end if;

  update public.purchase_requests
     set status = 'enviada', sent_at = now(), sent_by = v_user,
         updated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.send_purchase_request(uuid) from public;
grant execute on function public.send_purchase_request(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.purchase_requests) as requisicoes,
  (select count(*) from public.purchase_request_items) as itens,
  (select count(*) from public.user_clinic_roles where role = 'purchaser')
    as compradores_cadastrados,
  (select count(*) from public.stock_movements
    where kind = 'entrada' and coalesce(purchase_unit_cost_cents, 0) > 0)
    as entradas_com_preco_de_compra;
