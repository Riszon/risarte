-- =============================================================================
-- 0219 — QUEM ABRE A EMBALAGEM É GENTE, NÃO O SISTEMA
-- -----------------------------------------------------------------------------
-- Correção do dono (12/08/2026), e ele está certo:
--
--   "não permitir que o sistema abra o próximo sozinho. Pois em itens como tubo
--    de resina, frasco de adesivo (...) podemos ter um cálculo aproximado do
--    consumo, portanto pode ser que o sistema vai achar que acabou um produto
--    mas ainda não acabou."
--
-- A 0218 abria a embalagem seguinte sozinha quando a conta zerava. O erro está
-- na premissa: o consumo do kit é ESTIMATIVA (0,2 g de resina, 1 aplicação de
-- adesivo), e estimativa não sabe se o frasco acabou. Abrir sozinho faria o
-- sistema afirmar um fato físico que ele não tem como conhecer — e o saldo de
-- embalagens fechadas passaria a cair por conta própria.
--
-- O QUE MUDA:
--
--   • O consumo continua descontando do que está EM USO, e o valor pode ficar
--     NEGATIVO. Negativo aqui não é erro: é a estimativa dizendo "pela conta,
--     esse frasco já deveria ter acabado".
--   • ABRIR EMBALAGEM VIRA ATO MANUAL (`open_stock_package`). Quem olha a
--     bancada decide.
--   • A troca de embalagem é o MOMENTO DA VERDADE, e é onde a estimativa se
--     acerta com a realidade: o que sobrou (ou faltou) na embalagem anterior
--     vira um AJUSTE com motivo, em vez de ser arrastado para a próxima.
--       – sobrou 2,8 → saída de ajuste (o material saiu, mesmo que a conta não
--         tenha previsto).
--       – faltou 1,5 (negativo) → entrada de ajuste (o frasco rendeu mais do
--         que a conta supunha).
--     Sem isso, o erro de uma embalagem contaminaria todas as seguintes.
--   • O sistema AVISA, em vez de decidir: "o que está em uso pode estar
--     acabando — confira e abra outro se precisar".
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O CONSUMO NÃO ABRE MAIS NADA
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
  else
    v_unit := v_cur_avg;
    v_new_avg := v_cur_avg;

    if coalesce(v_item.track_open_package, false) and p_kind = 'consumo' then
      -- 0219: SEM ABERTURA AUTOMÁTICA. O consumo sai do que está em uso e o
      -- número pode ficar negativo — isso é a estimativa dizendo "pela conta,
      -- esse frasco já deveria ter acabado", não um erro a corrigir sozinho.
      -- O estoque FECHADO não se mexe: só gente abre embalagem.
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
-- 2) ABRIR EMBALAGEM — ato de quem olha a bancada
-- -----------------------------------------------------------------------------
-- É AQUI QUE A ESTIMATIVA SE ACERTA COM A REALIDADE. Trocar de frasco é o único
-- momento em que alguém sabe, de fato, quanto havia: o resto (sobra ou falta)
-- da embalagem anterior é registrado como ajuste, com motivo, em vez de ser
-- empurrado para a próxima — senão o erro de uma vira o erro de todas.
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

  -- Não há embalagem fechada para abrir: quem decide é gente, mas o sistema não
  -- inventa estoque que não existe.
  if coalesce(v_bal.quantity, 0) < v_units then
    raise exception 'NO_CLOSED_PACKAGE';
  end if;

  -- ACERTO DA EMBALAGEM ANTERIOR, quando ela é dada por encerrada.
  if p_previous_finished and v_residue <> 0 then
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
    -- Reclassificação: o material continua na unidade, só mudou de prateleira.
    0, v_when, 'abertura',
    p_packages || ' ' || v_item.purchase_unit || ' aberta(s)',
    coalesce(v_bal.quantity, 0) - v_units, round(v_avg, 4), v_user
  )
  returning id into v_id;

  update public.stock_balances
     set quantity = coalesce(quantity, 0) - v_units,
         in_use_quantity = v_residue + v_units,
         open_packages = case when p_previous_finished
                              then p_packages
                              else coalesce(open_packages, 0) + p_packages end,
         updated_at = now()
   where id = v_bal.id;

  return v_id;
end;
$$;

grant execute on function public.open_stock_package(uuid, uuid, integer, boolean)
  to authenticated;

comment on function public.open_stock_package(uuid, uuid, integer, boolean) is
  'Abrir embalagem é ato MANUAL: o consumo do kit é estimativa e não sabe se o '
  'frasco acabou. A troca é o momento em que a estimativa se acerta com a '
  'realidade — a sobra/falta da anterior vira ajuste com motivo.';

-- -----------------------------------------------------------------------------
-- 3) O AVISO, no lugar da decisão
-- -----------------------------------------------------------------------------
-- Devolve o que está em uso e quanto falta para a conta zerar. Quem olha o
-- frasco decide; o sistema só aponta onde olhar.
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
    and i.track_open_package
    and (
      (b.open_packages > 0
       and b.in_use_quantity * 100.0 / greatest(i.units_per_purchase, 0.000001)
           <= greatest(coalesce(p_threshold_percent, 15), 0))
      or (b.open_packages = 0 and b.in_use_quantity < 0)
    )
  order by b.in_use_quantity;
$$;

grant execute on function public.packages_running_out(uuid, numeric)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_items where track_open_package)
    as itens_com_embalagem_aberta,
  (select count(*) from public.stock_balances where open_packages > 0)
    as embalagens_abertas_agora,
  (select count(*) from public.stock_balances where in_use_quantity < 0)
    as em_uso_negativo_estimativa_estourou,
  (select count(*) from public.stock_movements where kind = 'abertura')
    as aberturas_registradas;
