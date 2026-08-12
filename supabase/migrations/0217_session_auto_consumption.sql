-- =============================================================================
-- 0217 — ESTOQUE E3: A BAIXA AUTOMÁTICA NA CONCLUSÃO DA SESSÃO
-- -----------------------------------------------------------------------------
-- É a etapa que dá sentido ao resto. O documento base já dizia como o módulo
-- morre — "falta de baixa no uso" — e a resposta nunca foi cobrar disciplina de
-- quem está com o paciente na cadeira: é o sistema saber o que aquele
-- procedimento consome e descontar sozinho.
--
-- O GANCHO É O MESMO DO REPASSE AO DENTISTA (0209): a sessão passa a `done`.
-- Nenhuma tela nova para o dentista; ele conclui como já faz.
--
-- CINCO REGRAS TRAVADAS AQUI:
--
--   1. CONCLUIR DE NOVO NÃO CONSOME DE NOVO. Índice único por (sessão, item):
--      um duplo clique viraria estoque negativo sem ninguém entender por quê.
--   2. REABRIR NÃO DEVOLVE O MATERIAL. Ele foi usado de verdade; devolver ao
--      saldo seria inventar gaze que não está mais na gaveta.
--   3. NUNCA BLOQUEIA O ATENDIMENTO. Sem saldo, fica negativo e alerta; sem kit,
--      não consome e segue. Mesma decisão da baixa da adquirente: problema de
--      cadastro não trava quem está na cadeira.
--   4. O QUE NÃO TEM KIT FICA VISÍVEL (`sessions_without_kit`). Silêncio aqui
--      viraria rotina, e rotina vira saldo que ninguém confia.
--   5. O CONSUMO É O PREVISTO, NÃO O MEDIDO. Usou duas anestesias? O registro
--      avulso corrige. O kit é boa estimativa, não medição — e a tela diz isso.
--
-- O MESMO ITEM EM DOIS KITS VIRA UMA LINHA SÓ. "Rolo de algodão" no kit básico
-- e no específico soma a quantidade e gera um movimento: dois movimentos para o
-- mesmo item na mesma sessão tornariam a conferência confusa e quebrariam a
-- trava de idempotência.
--
-- NÃO HÁ BAIXA RETROATIVA. Sessões já concluídas antes desta migração não são
-- descontadas: ninguém sabe o que foi usado nelas, e inventar consumo velho
-- estragaria o custo médio de hoje.
--
-- O LANÇAMENTO CONTÁBIL EM 2.2 fica para a E4, junto com a compra virando ativo
-- em 6.1.01 — as duas metades da mesma decisão entram juntas.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONTA DO MOVIMENTO SAI DE DENTRO DA PORTA
-- -----------------------------------------------------------------------------
-- `post_stock_movement` valida permissão E faz a conta. O gatilho da sessão
-- precisa da conta sem a validação de papel (quem concluiu a sessão já passou
-- pela permissão que importa — a de concluir). Duplicar a matemática nos dois
-- caminhos é exatamente como eles passam a divergir; então ela sai para uma
-- função interna e os dois passam a chamar a MESMA conta.
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
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  select * into v_item from public.stock_items where id = p_item_id;
  if v_item.id is null then raise exception 'ITEM_NOT_FOUND'; end if;

  v_factor := greatest(coalesce(v_item.units_per_purchase, 1), 0.000001);
  v_in := p_kind in ('entrada', 'ajuste_entrada', 'transferencia_entrada');

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
  -- A trava de idempotência (item 1) vive no índice; conflito = já consumido.
  on conflict do nothing
  returning id into v_id;

  if v_id is null then return null; end if;

  update public.stock_balances
     set quantity = v_new_qty,
         avg_cost_cents = round(v_new_avg, 4),
         updated_at = now()
   where id = v_bal.id;

  return v_id;
end;
$$;

-- A porta pública continua a mesma, agora só com a guarda de papel na frente.
create or replace function public.post_stock_movement(
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
begin
  if p_kind in ('entrada', 'ajuste_entrada', 'transferencia_entrada',
                'ajuste_saida', 'transferencia_saida') then
    if not public.can_manage_stock(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  else
    if not public.can_consume_stock(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;

  return public.apply_stock_movement(
    p_clinic_id, p_item_id, p_kind, p_quantity, p_unit_cost_cents,
    p_movement_date, p_reason, p_source_type, p_source_id,
    p_purchase_quantity, p_purchase_unit_cost_cents, p_lot_code,
    p_expires_at, p_supplier_id, p_invoice_number);
end;
$$;

grant execute on function public.apply_stock_movement(
  uuid, uuid, text, numeric, numeric, date, text, text, uuid,
  numeric, bigint, text, date, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A TRAVA: UM CONSUMO POR SESSÃO E POR ITEM
-- -----------------------------------------------------------------------------
create unique index if not exists stock_movements_session_item_unique
  on public.stock_movements (source_id, item_id)
  where source_type = 'session';

-- -----------------------------------------------------------------------------
-- 3) O GATILHO
-- -----------------------------------------------------------------------------
create or replace function public.consume_session_kit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_when date;
begin
  -- Só quando a sessão PASSA a concluída (mesma condição do repasse).
  if new.status <> 'done' or coalesce(old.status, '') = 'done' then
    return new;
  end if;
  if new.procedure_id is null or new.clinic_id is null then
    return new;
  end if;

  -- Competência do consumo = data do procedimento, não a de hoje.
  v_when := coalesce(new.done_at::date, public.today_br());

  -- O MESMO ITEM EM DOIS KITS VIRA UMA LINHA SÓ.
  for v_line in
    select ki.item_id, sum(ki.quantity) as quantity
    from public.kits_for(new.procedure_id, new.clinic_id) f
    join public.stock_kit_items ki on ki.kit_id = f.kit_id
    group by ki.item_id
  loop
    -- Sem saldo NÃO impede: fica negativo e o alerta aparece. Travar aqui
    -- travaria a conclusão de um atendimento por causa de cadastro.
    perform public.apply_stock_movement(
      p_clinic_id => new.clinic_id,
      p_item_id => v_line.item_id,
      p_kind => 'consumo',
      p_quantity => v_line.quantity,
      p_movement_date => v_when,
      p_reason => 'Sessão concluída — '
                  || coalesce(new.procedure_name, 'procedimento'),
      p_source_type => 'session',
      p_source_id => new.id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists treatment_sessions_consume_kit on public.treatment_sessions;
create trigger treatment_sessions_consume_kit
  after update on public.treatment_sessions
  for each row execute function public.consume_session_kit();

comment on function public.consume_session_kit() is
  'Baixa automática do kit na conclusão da sessão. Reabrir NÃO devolve o '
  'material (ele foi usado de verdade) e concluir de novo não consome outra '
  'vez — a trava é o índice único por (sessão, item).';

-- -----------------------------------------------------------------------------
-- 4) O BURACO QUE PRECISA APARECER
-- -----------------------------------------------------------------------------
-- Procedimento concluído SEM kit não consome nada. Isso é normal no começo e
-- vira problema quando ninguém percebe: o saldo para de bater e a culpa cai no
-- estoque. Melhor contar quantas vezes aconteceu.
create or replace function public.sessions_without_kit(
  p_clinic_id uuid,
  p_days integer default 30
)
returns table (
  procedure_id uuid,
  procedure_name text,
  sessions integer,
  last_done date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.procedure_id,
    coalesce(max(s.procedure_name), 'Procedimento'),
    count(*)::integer,
    max(coalesce(s.done_at::date, s.created_at::date))
  from public.treatment_sessions s
  where s.clinic_id = p_clinic_id
    and s.status = 'done'
    and s.procedure_id is not null
    and coalesce(s.done_at::date, s.created_at::date)
        >= public.today_br() - greatest(coalesce(p_days, 30), 1)
    and not exists (
      select 1 from public.kits_for(s.procedure_id, p_clinic_id)
    )
  group by s.procedure_id
  order by count(*) desc;
$$;

grant execute on function public.sessions_without_kit(uuid, integer)
  to authenticated;

-- O consumo de uma sessão, para a conferência ir do saldo até o atendimento.
create or replace function public.session_consumption(p_session_id uuid)
returns table (
  item_name text,
  quantity numeric,
  unit text,
  unit_cost_cents numeric,
  total_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.name, m.quantity, i.unit_of_measure, m.unit_cost_cents, m.total_cents
  from public.stock_movements m
  join public.stock_items i on i.id = m.item_id
  where m.source_type = 'session' and m.source_id = p_session_id
  order by i.name;
$$;

grant execute on function public.session_consumption(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_movements
    where source_type = 'session') as consumos_por_sessao,
  (select count(distinct source_id) from public.stock_movements
    where source_type = 'session') as sessoes_com_baixa,
  (select count(*) from public.treatment_sessions where status = 'done')
    as sessoes_concluidas_total,
  (select count(*) from public.stock_balances where quantity < 0)
    as itens_negativos;
