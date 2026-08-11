-- =============================================================================
-- 0214 — ESTOQUE: EMBALAGEM × CONSUMO, LOTE/VALIDADE E MOVIMENTO DETALHADO
-- -----------------------------------------------------------------------------
-- Teste do dono (11/08/2026). Cinco pedidos, e dois deles eram o MESMO problema:
--
--   "eu pago R$ 25,00 na caixa de sugadores, mas vem 100 unidades"
--   "um tubo de resina pode ser utilizado em várias restaurações"
--
-- VOCÊ COMPRA NUM TAMANHO E CONSOME NOUTRO. A 0213 assumia que os dois eram
-- iguais, e por isso a caixa entrava como "1 unidade a R$ 25,00" — cada sugador
-- custando R$ 25,00 no procedimento. Distorção de 100 vezes, e silenciosa: o
-- preço sugerido sairia absurdo sem nada apontar o motivo.
--
-- A CORREÇÃO É UM CONCEITO SÓ, e resolve os dois casos:
--
--   unidade de CONTROLE (o que se consome) + FATOR de conversão da embalagem
--
--     sugador   | caixa  R$ 25,00  | 100 | unidade   | R$  0,25
--     resina    | tubo   R$180,00  |   4 | grama     | R$ 45,00/g
--     adesivo   | frasco R$240,00  |  20 | aplicação | R$ 12,00
--
-- O adesivo é o caso que prova a escolha: ninguém vai medir ml de adesivo na
-- clínica. O que se sabe é RENDIMENTO — "um frasco dá umas 20 restaurações". O
-- fator aceita isso sem inventar mecanismo novo; a unidade de controle vira
-- "aplicação".
--
-- O SALDO VIVE SEMPRE NA UNIDADE DE CONTROLE. A entrada é lançada como está na
-- nota ("1 caixa a R$ 25,00") e o banco converte. Guardar as duas versões no
-- movimento é o que permite conferir contra a nota depois.
--
-- LOTE E VALIDADE NÃO SÃO DO ITEM — SÃO DA COMPRA. A caixa que chegou em março
-- tem lote e validade diferentes da que chegou em agosto. Gravar no item faria
-- a segunda compra apagar a informação da primeira, e o dado passaria a estar
-- errado sem ninguém perceber. Por isso vão no MOVIMENTO de entrada.
--
-- LIMITE DECLARADO (decisão do dono: fica para depois da E3): o consumo ainda
-- NÃO escolhe lote. Não há baixa pelo lote que vence primeiro nem recusa de
-- vencido — há registro e alerta. Controle por lote de verdade muda a baixa, e
-- a baixa automática ainda não existe.
--
-- PRECISÃO: custo UNITÁRIO vira numeric com 4 casas; valor TOTAL continua em
-- centavos inteiros. R$ 180,00 ÷ 7 g = 2571,4286 centavos por grama — arredondar
-- isso para 2571 a cada movimento subestimaria o custo sempre para o mesmo lado.
-- Regra: TAXA carrega decimais, VALOR é centavo inteiro.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O ITEM: embalagem, fator e os dados de cadastro pedidos
-- -----------------------------------------------------------------------------
-- `unit_of_measure` (0213) passa a ser explicitamente a unidade de CONTROLE.
alter table public.stock_items
  add column if not exists brand text,
  add column if not exists purchase_unit text not null default 'unidade',
  add column if not exists units_per_purchase numeric(12,3) not null default 1;

do $$
begin
  alter table public.stock_items
    add constraint stock_items_units_per_purchase_check
    check (units_per_purchase > 0);
exception when duplicate_object then null;
end $$;

comment on column public.stock_items.unit_of_measure is
  'Unidade de CONTROLE: em que o saldo é medido e o kit consome (unidade, '
  'grama, mililitro, aplicação). Nunca a embalagem de compra.';
comment on column public.stock_items.purchase_unit is
  'Embalagem em que se compra (caixa, tubo, frasco). Só para lançar a entrada '
  'do jeito que está na nota.';
comment on column public.stock_items.units_per_purchase is
  'Quantas unidades de CONTROLE vêm em uma embalagem. 100 sugadores por caixa; '
  '20 aplicações por frasco de adesivo (rendimento).';

-- -----------------------------------------------------------------------------
-- 2) O QUE É DA UNIDADE fica no saldo
-- -----------------------------------------------------------------------------
-- Local de armazenamento, máximo e fornecedor habitual variam por unidade —
-- Cambé guarda num armário, Londrina noutro, e `suppliers` já é por clínica.
alter table public.stock_balances
  add column if not exists max_quantity numeric(14,3),
  add column if not exists storage_location text,
  add column if not exists preferred_supplier_id uuid references public.suppliers (id);

comment on column public.stock_balances.max_quantity is
  'Acima disto é dinheiro parado (e, em material com validade, é perda '
  'programada). Nulo = sem controle de máximo.';

-- -----------------------------------------------------------------------------
-- 3) O MOVIMENTO: as duas versões da quantidade, lote, validade e nota
-- -----------------------------------------------------------------------------
alter table public.stock_movements
  add column if not exists purchase_quantity numeric(14,3),
  add column if not exists purchase_unit_cost_cents bigint,
  add column if not exists purchase_unit text,
  add column if not exists units_per_purchase numeric(12,3),
  add column if not exists lot_code text,
  add column if not exists expires_at date,
  add column if not exists supplier_id uuid references public.suppliers (id),
  add column if not exists invoice_number text;

comment on column public.stock_movements.purchase_quantity is
  'O que foi comprado NA EMBALAGEM (1 caixa). A quantidade em unidades de '
  'controle fica em `quantity`. Guardar as duas é o que permite conferir '
  'contra a nota.';
comment on column public.stock_movements.expires_at is
  'Validade DESTE lote. Fica aqui e não no item porque cada compra tem a sua — '
  'no item, a compra nova apagaria a informação da anterior.';

-- Taxa carrega decimais; valor é centavo inteiro.
alter table public.stock_movements
  alter column unit_cost_cents type numeric(16,4);
alter table public.stock_balances
  alter column avg_cost_cents type numeric(16,4);

create index if not exists stock_movements_expiry_idx
  on public.stock_movements (clinic_id, expires_at)
  where expires_at is not null;

-- -----------------------------------------------------------------------------
-- 4) A PORTA ÚNICA, agora convertendo embalagem → consumo
-- -----------------------------------------------------------------------------
-- A assinatura mudou: `create or replace` não basta quando os parâmetros mudam.
drop function if exists public.post_stock_movement(
  uuid, uuid, text, numeric, bigint, date, text, text, uuid);

create or replace function public.post_stock_movement(
  p_clinic_id uuid,
  p_item_id uuid,
  p_kind text,
  -- Quantidade na unidade de CONTROLE. Pode vir nula quando a entrada é
  -- informada pela embalagem (o caminho normal de uma nota).
  p_quantity numeric default null,
  p_unit_cost_cents numeric default null,
  p_movement_date date default null,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  -- Entrada pela EMBALAGEM: "1 caixa a R$ 25,00".
  p_purchase_quantity numeric default null,
  p_purchase_unit_cost_cents bigint default null,
  p_lot_code text default null,
  p_expires_at date default null,
  p_supplier_id uuid default null,
  p_invoice_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in boolean;
  v_item record;
  v_bal record;
  v_factor numeric;
  v_qty numeric;
  v_unit numeric;
  v_cur_qty numeric;
  v_cur_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  select * into v_item from public.stock_items where id = p_item_id;
  if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;

  v_factor := greatest(coalesce(v_item.units_per_purchase, 1), 0.000001);
  v_in := p_kind in ('entrada', 'ajuste_entrada', 'transferencia_entrada');

  -- Converte embalagem → unidade de controle. É AQUI que a caixa de R$ 25,00
  -- vira 100 sugadores de R$ 0,25 — e não na tela, para o mesmo cálculo valer
  -- para a nota digitada hoje e para a integração de compras amanhã.
  if p_purchase_quantity is not null then
    v_qty := p_purchase_quantity * v_factor;
    if p_purchase_unit_cost_cents is not null then
      v_unit := p_purchase_unit_cost_cents::numeric / v_factor;
    end if;
  else
    v_qty := p_quantity;
    v_unit := p_unit_cost_cents;
  end if;

  if v_qty is null or v_qty <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  if v_in or p_kind in ('ajuste_saida', 'transferencia_saida') then
    if not public.can_manage_stock(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  else
    if not public.can_consume_stock(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;

  select * into v_bal from public.stock_balances
   where clinic_id = p_clinic_id and item_id = p_item_id
   for update;

  if v_bal.id is null then
    insert into public.stock_balances (clinic_id, item_id)
    values (p_clinic_id, p_item_id)
    on conflict (clinic_id, item_id) do nothing;

    select * into v_bal from public.stock_balances
     where clinic_id = p_clinic_id and item_id = p_item_id
     for update;
  end if;

  v_cur_qty := coalesce(v_bal.quantity, 0);
  v_cur_avg := coalesce(v_bal.avg_cost_cents, 0);

  if v_in then
    v_unit := coalesce(v_unit, v_cur_avg);
    v_new_qty := v_cur_qty + v_qty;
    if v_cur_qty > 0 and v_new_qty > 0 then
      v_new_avg := ((v_cur_qty * v_cur_avg) + (v_qty * v_unit)) / v_new_qty;
    else
      v_new_avg := v_unit;
    end if;
  else
    v_unit := v_cur_avg;
    v_new_qty := v_cur_qty - v_qty;
    v_new_avg := v_cur_avg;
  end if;

  insert into public.stock_movements (
    clinic_id, item_id, kind, quantity, unit_cost_cents, total_cents,
    movement_date, source_type, source_id, reason,
    balance_after, avg_cost_after, created_by,
    purchase_quantity, purchase_unit_cost_cents, purchase_unit,
    units_per_purchase, lot_code, expires_at, supplier_id, invoice_number
  ) values (
    p_clinic_id, p_item_id, p_kind, v_qty, round(v_unit, 4),
    -- O VALOR é centavo inteiro; só a taxa unitária carrega decimais.
    round(v_qty * v_unit)::bigint,
    coalesce(p_movement_date, public.today_br()),
    p_source_type, p_source_id, nullif(btrim(coalesce(p_reason, '')), ''),
    v_new_qty, round(v_new_avg, 4), v_user,
    p_purchase_quantity, p_purchase_unit_cost_cents,
    case when p_purchase_quantity is not null then v_item.purchase_unit end,
    case when p_purchase_quantity is not null then v_factor end,
    nullif(btrim(coalesce(p_lot_code, '')), ''), p_expires_at,
    p_supplier_id, nullif(btrim(coalesce(p_invoice_number, '')), '')
  )
  returning id into v_id;

  update public.stock_balances
     set quantity = v_new_qty,
         avg_cost_cents = round(v_new_avg, 4),
         updated_at = now()
   where id = v_bal.id;

  return v_id;
end;
$$;

grant execute on function public.post_stock_movement(
  uuid, uuid, text, numeric, numeric, date, text, text, uuid,
  numeric, bigint, text, date, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Configuração do item NA UNIDADE (mínimo, máximo, local, fornecedor)
-- -----------------------------------------------------------------------------
create or replace function public.set_stock_item_settings(
  p_clinic_id uuid,
  p_item_id uuid,
  p_min numeric default null,
  p_max numeric default null,
  p_storage_location text default null,
  p_supplier_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_stock(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_max is not null and p_min is not null and p_max > 0 and p_max < p_min then
    raise exception 'MAX_BELOW_MIN';
  end if;

  insert into public.stock_balances (
    clinic_id, item_id, min_quantity, max_quantity, storage_location,
    preferred_supplier_id
  )
  values (
    p_clinic_id, p_item_id, greatest(coalesce(p_min, 0), 0),
    nullif(greatest(coalesce(p_max, 0), 0), 0),
    nullif(btrim(coalesce(p_storage_location, '')), ''), p_supplier_id
  )
  on conflict (clinic_id, item_id)
  do update set
    min_quantity = greatest(coalesce(p_min, 0), 0),
    max_quantity = nullif(greatest(coalesce(p_max, 0), 0), 0),
    storage_location = nullif(btrim(coalesce(p_storage_location, '')), ''),
    preferred_supplier_id = p_supplier_id,
    updated_at = now();
end;
$$;

grant execute on function public.set_stock_item_settings(
  uuid, uuid, numeric, numeric, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O QUE VENCE PRIMEIRO
-- -----------------------------------------------------------------------------
-- Enquanto o consumo não escolhe lote (fica para depois da E3), o mínimo que o
-- sistema deve fazer é APONTAR o lote que vence antes. Perder material por
-- validade é perda que o estoque existia para evitar.
create or replace function public.stock_expiring(
  p_clinic_id uuid,
  p_days integer default 90
)
returns table (
  item_id uuid,
  item_name text,
  lot_code text,
  expires_at date,
  quantity numeric,
  days_left integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.item_id,
    i.name,
    m.lot_code,
    m.expires_at,
    sum(m.quantity),
    (m.expires_at - public.today_br())::integer
  from public.stock_movements m
  join public.stock_items i on i.id = m.item_id
  where m.clinic_id = p_clinic_id
    and m.expires_at is not null
    and m.kind in ('entrada', 'transferencia_entrada')
    and m.expires_at <= public.today_br() + greatest(coalesce(p_days, 90), 0)
  group by m.item_id, i.name, m.lot_code, m.expires_at
  order by m.expires_at;
$$;

grant execute on function public.stock_expiring(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_items) as itens,
  (select count(*) from public.stock_items
    where units_per_purchase <> 1) as itens_com_fator,
  (select count(*) from public.stock_movements
    where purchase_quantity is not null) as entradas_pela_embalagem,
  (select count(*) from public.stock_movements
    where expires_at is not null) as movimentos_com_validade,
  (select count(*) from public.stock_balances
    where storage_location is not null) as itens_com_local;
