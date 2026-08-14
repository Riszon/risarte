-- =============================================================================
-- 0220 — "ENVIAR PARA USO": UM CLIQUE, UMA EMBALAGEM
-- -----------------------------------------------------------------------------
-- Pedido do dono (12/08/2026):
--
--   "deve ter um botão rápido em cada item para ser enviado para consumo (...)
--    um tubo de resina, um frasco de adesivo, um pacote de algodão, um pacote de
--    sugador, não deve ser retirado 1 a 1 do estoque, deve ter como indicar que
--    01 frasco foi aberto para consumo e não quantos ml foram enviados (...)
--    sinalizando a quantidade aproximada ainda em uso (colocar em percentual)"
--
-- A 0219 já tinha `open_stock_package`, mas só valia para item marcado como
-- "controla embalagem aberta" (resina, adesivo) e o botão vivia escondido no
-- aviso. O pedido é mais amplo e está certo: **caixa de sugador e pacote de
-- algodão também saem do estoque INTEIROS** — ninguém retira 40 sugadores da
-- caixa, retira a caixa.
--
-- A REGRA FICA UMA SÓ, e é a que descreve a prateleira de verdade:
--
--   O CONSUMO SAI DO QUE ESTÁ EM USO. Se não há nada em uso, sai do fechado.
--
-- Com uma exceção deliberada, para os itens fracionados (`track_open_package`):
-- ali o consumo sai do "em uso" MESMO quando não há nada aberto, ficando
-- negativo. Não é erro — é o único jeito de o sistema dizer "alguém usou resina
-- sem ninguém ter aberto tubo nenhum". Para sugador esse aviso seria ruído; para
-- resina é a informação.
--
-- O PERCENTUAL é o que ele pediu para ler: "restam ~35% do frasco" diz mais que
-- "restam 7 aplicações", porque o rendimento é estimado de qualquer forma.
--
-- O custo continua igual: consumo estimado × custo médio. Abrir embalagem não
-- move valor — o material continua na unidade, só mudou de prateleira.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O CONSUMO OLHA PRIMEIRO O QUE ESTÁ EM USO
-- -----------------------------------------------------------------------------
create or replace function public.apply_stock_movement(
  p_clinic_id uuid,
  p_item_id uuid,
  p_kind text,
  p_quantity numeric default null,
  p_unit_cost_cents numeric default null,
  p_movement_date date default null,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null,
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
  v_in_use numeric;
  v_open integer;
  v_from_use boolean;
  v_when date;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  select * into v_item from public.stock_items where id = p_item_id;
  if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;

  v_factor := greatest(coalesce(v_item.units_per_purchase, 1), 0.000001);
  v_in := p_kind in ('entrada', 'ajuste_entrada', 'transferencia_entrada');
  v_when := coalesce(p_movement_date, public.today_br());

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
  v_in_use := coalesce(v_bal.in_use_quantity, 0);
  v_open := coalesce(v_bal.open_packages, 0);

  if v_in then
    v_unit := coalesce(v_unit, v_cur_avg);
    v_new_qty := v_cur_qty + v_qty;
    if (v_cur_qty + v_in_use) > 0 and (v_new_qty + v_in_use) > 0 then
      v_new_avg := (((v_cur_qty + v_in_use) * v_cur_avg) + (v_qty * v_unit))
                   / (v_new_qty + v_in_use);
    else
      v_new_avg := v_unit;
    end if;
    v_new_qty := v_new_qty;
  else
    v_unit := v_cur_avg;
    v_new_avg := v_cur_avg;

    -- A REGRA ÚNICA: consumo sai do que está EM USO; sem nada em uso, sai do
    -- fechado. A exceção é o item fracionado, onde consumir sem ter aberto é
    -- justamente o que precisa aparecer (fica negativo e o aviso nasce daí).
    v_from_use := (p_kind = 'consumo')
                  and (v_open > 0
                       or coalesce(v_item.track_open_package, false));

    if v_from_use then
      v_in_use := v_in_use - v_qty;
      v_new_qty := v_cur_qty;
    else
      v_new_qty := v_cur_qty - v_qty;
    end if;
  end if;

  insert into public.stock_movements (
    clinic_id, item_id, kind, quantity, unit_cost_cents, total_cents,
    movement_date, source_type, source_id, reason,
    balance_after, avg_cost_after, created_by,
    purchase_quantity, purchase_unit_cost_cents, purchase_unit,
    units_per_purchase, lot_code, expires_at, supplier_id, invoice_number
  ) values (
    p_clinic_id, p_item_id, p_kind, v_qty, round(v_unit, 4),
    round(v_qty * v_unit)::bigint, v_when,
    p_source_type, p_source_id, nullif(btrim(coalesce(p_reason, '')), ''),
    v_new_qty, round(v_new_avg, 4), v_user,
    p_purchase_quantity, p_purchase_unit_cost_cents,
    case when p_purchase_quantity is not null then v_item.purchase_unit end,
    case when p_purchase_quantity is not null then v_factor end,
    nullif(btrim(coalesce(p_lot_code, '')), ''), p_expires_at,
    p_supplier_id, nullif(btrim(coalesce(p_invoice_number, '')), '')
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then return null; end if;

  update public.stock_balances
     set quantity = v_new_qty,
         in_use_quantity = v_in_use,
         open_packages = v_open,
         avg_cost_cents = round(v_new_avg, 4),
         updated_at = now()
   where id = v_bal.id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) O AVISO passa a valer para QUALQUER item com embalagem aberta
-- -----------------------------------------------------------------------------
-- E devolve o percentual, que é o que ele pediu para ler: "restam ~35% do
-- frasco" diz mais que "restam 7 aplicações", porque o rendimento é estimado
-- de qualquer forma.
create or replace function public.packages_running_out(
  p_clinic_id uuid,
  p_threshold_percent numeric default 15
)
returns table (
  item_id uuid,
  item_name text,
  purchase_unit text,
  stock_unit text,
  in_use_quantity numeric,
  units_per_purchase numeric,
  percent_left numeric,
  closed_packages numeric,
  state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.name, i.purchase_unit, i.unit_of_measure,
    b.in_use_quantity, i.units_per_purchase,
    round(b.in_use_quantity * 100.0
          / greatest(i.units_per_purchase, 0.000001), 1),
    floor(b.quantity / greatest(i.units_per_purchase, 0.000001)),
    case
      when b.open_packages = 0 then 'sem_aberta'
      when b.in_use_quantity <= 0 then 'deve_ter_acabado'
      else 'acabando'
    end
  from public.stock_balances b
  join public.stock_items i on i.id = b.item_id
  where b.clinic_id = p_clinic_id
    and i.is_active
    and (
      -- Qualquer item com embalagem aberta chegando ao fim.
      (b.open_packages > 0
       and b.in_use_quantity * 100.0 / greatest(i.units_per_purchase, 0.000001)
           <= greatest(coalesce(p_threshold_percent, 15), 0))
      -- Só o item FRACIONADO avisa "consumiu sem abrir": para sugador isso
      -- seria ruído; para resina é a informação.
      or (i.track_open_package and b.open_packages = 0
          and b.in_use_quantity < 0)
    )
  order by b.in_use_quantity;
$$;

-- -----------------------------------------------------------------------------
-- 3) ENVIAR PARA USO — a embalagem INTEIRA, num clique
-- -----------------------------------------------------------------------------
-- `p_previous_finished` deixa de ser sempre verdadeiro: mandar um segundo
-- pacote de algodão para a sala não significa que o primeiro acabou. Quando ele
-- ACABOU, o acerto da sobra/falta continua acontecendo (é o momento da verdade
-- da 0219); quando é só reforço, os dois convivem.
create or replace function public.open_stock_package(
  p_clinic_id uuid,
  p_item_id uuid,
  p_packages integer default 1,
  p_previous_finished boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_bal record;
  v_factor numeric;
  v_avg numeric;
  v_residue numeric;
  v_when date := public.today_br();
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_units numeric;
  v_had_open boolean;
begin
  if not public.can_consume_stock(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if coalesce(p_packages, 0) <= 0 then raise exception 'INVALID_QUANTITY'; end if;

  select * into v_item from public.stock_items where id = p_item_id;
  if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;

  v_factor := greatest(coalesce(v_item.units_per_purchase, 1), 0.000001);
  v_units := v_factor * p_packages;

  select * into v_bal from public.stock_balances
   where clinic_id = p_clinic_id and item_id = p_item_id
   for update;
  if v_bal.id is null then raise exception 'NO_BALANCE'; end if;

  v_avg := coalesce(v_bal.avg_cost_cents, 0);
  v_residue := coalesce(v_bal.in_use_quantity, 0);
  v_had_open := coalesce(v_bal.open_packages, 0) > 0;

  if coalesce(v_bal.quantity, 0) < v_units then
    raise exception 'NO_CLOSED_PACKAGE';
  end if;

  -- Acerto só quando a anterior é dada por ENCERRADA e existia mesmo uma
  -- aberta. Mandar reforço para a sala não encerra nada.
  if p_previous_finished and v_had_open and v_residue <> 0 then
    insert into public.stock_movements (
      clinic_id, item_id, kind, quantity, unit_cost_cents, total_cents,
      movement_date, source_type, reason, balance_after, avg_cost_after,
      created_by
    ) values (
      p_clinic_id, p_item_id,
      case when v_residue > 0 then 'ajuste_saida' else 'ajuste_entrada' end,
      abs(v_residue), round(v_avg, 4), round(abs(v_residue) * v_avg)::bigint,
      v_when, 'abertura',
      case when v_residue > 0
        then 'Sobra da embalagem anterior (o consumo é estimado)'
        else 'A embalagem anterior rendeu mais que o previsto' end,
      coalesce(v_bal.quantity, 0), round(v_avg, 4), v_user
    );
    v_residue := 0;
  end if;

  insert into public.stock_movements (
    clinic_id, item_id, kind, quantity, unit_cost_cents, total_cents,
    movement_date, source_type, reason, balance_after, avg_cost_after,
    created_by
  ) values (
    p_clinic_id, p_item_id, 'abertura', v_units, round(v_avg, 4),
    0, v_when, 'abertura',
    p_packages || ' ' || v_item.purchase_unit || ' enviada(s) para uso',
    coalesce(v_bal.quantity, 0) - v_units, round(v_avg, 4), v_user
  )
  returning id into v_id;

  update public.stock_balances
     set quantity = coalesce(quantity, 0) - v_units,
         in_use_quantity = v_residue + v_units,
         open_packages = case
           when p_previous_finished and v_had_open then p_packages
           else coalesce(open_packages, 0) + p_packages end,
         updated_at = now()
   where id = v_bal.id;

  return v_id;
end;
$$;

grant execute on function public.open_stock_package(uuid, uuid, integer, boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_balances where open_packages > 0)
    as itens_com_embalagem_em_uso,
  (select count(*) from public.stock_balances where in_use_quantity < 0)
    as em_uso_negativo,
  (select count(*) from public.stock_movements where kind = 'abertura')
    as envios_para_uso,
  (select count(*) from public.stock_items
    where is_active and units_per_purchase > 1) as itens_que_vem_em_embalagem;
