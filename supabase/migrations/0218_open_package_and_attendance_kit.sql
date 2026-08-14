-- =============================================================================
-- 0218 — VENDA DIRETA BAIXA · FRASCO EM USO · KIT DE ATENDIMENTO E USO GERAL
-- -----------------------------------------------------------------------------
-- Três achados do teste do dono (12/08/2026).
--
-- 1) BUG: "fiz uma venda direta, onde o procedimento já nasce concluído e não
--    deu baixa no estoque."
--
--    Na venda direta a sessão é CRIADA pronta (`insert ... status = 'done'`),
--    não criada e depois concluída. Os gatilhos escutavam só `after update` —
--    então nunca eram acionados. Erro meu, e do tipo que passa despercebido
--    justamente porque a venda direta funciona.
--
--    O MESMO BURACO ESTAVA NO REPASSE AO DENTISTA (0209): procedimento vendido
--    na venda direta nunca gerou repasse. No banco havia 68 sessões concluídas
--    por venda direta, nenhuma com repasse e nenhuma com baixa. Sem apuração
--    retroativa (decisão do dono) — os dois gatilhos passam a valer daqui.
--
-- 2) "01 frasco de adesivo está em uso... não ficar aparecendo que tem 2,78ml,
--    fica fora de realidade."
--
--    Ele está certo, e o problema é de LEITURA, não de conta. Ninguém tem 2,78
--    ml de adesivo: tem um frasco aberto pela metade. O saldo passa a ter dois
--    números — FECHADOS e EM USO — e o consumo sai do frasco aberto. Quando ele
--    acaba, o sistema abre o próximo e REGISTRA a abertura. A conta do custo não
--    muda em nada (é o que ele pediu).
--
-- 3) "máscara, gorro e propé é utilizado no atendimento, mas não para um
--    procedimento específico".
--
--    São DUAS coisas, e tratá-las igual é o que deixaria o controle irreal:
--
--    • DO PACIENTE (gorro, propé, babador): um por ATENDIMENTO, não por
--      procedimento — quem faz três procedimentos na mesma consulta não usa três
--      gorros. Vira KIT DE ATENDIMENTO, baixado quando a recepção encerra o
--      atendimento.
--    • DO PROFISSIONAL (máscara e gorro dele): é por TURNO. Rastrear por
--      paciente seria trabalho diário sem retorno e o número sairia errado do
--      mesmo jeito. Vira item de USO GERAL: sai por lançamento avulso quando a
--      caixa vai para a sala, e NÃO entra em kit de procedimento.
--
--    A RAZÃO DE FUNDO: o custo da máscara que o dentista usa o dia inteiro JÁ
--    ESTÁ na hora de cadeira do precificador — é estrutura, como aluguel e luz.
--    Rateá-la também por procedimento contaria o mesmo custo duas vezes e
--    inflaria o preço sugerido sem motivo.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) OS DOIS GATILHOS PASSAM A OUVIR A CRIAÇÃO TAMBÉM
-- -----------------------------------------------------------------------------
-- `OLD` não existe em gatilho de INSERT (lê-lo levanta erro), por isso a
-- condição passa a olhar TG_OP em vez de `old.status`.
create or replace function public.accrue_session_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate record;
  v_provider uuid;
  v_when date;
  v_was_done boolean := (TG_OP = 'UPDATE' and coalesce(old.status, '') = 'done');
begin
  if new.status <> 'done' or v_was_done then
    return new;
  end if;
  if new.procedure_id is null or new.clinic_id is null then
    return new;
  end if;

  v_provider := coalesce(new.executed_by, new.planner_provider_id);
  if v_provider is null then return new; end if;

  v_when := coalesce(new.done_at::date, public.today_br());

  select * into v_rate
  from public.payout_rate_for(new.procedure_id, v_provider, new.clinic_id, v_when);

  insert into public.provider_payouts (
    clinic_id, provider_id, session_id, procedure_id, procedure_name,
    accrual_date, amount_cents, rate_id
  ) values (
    new.clinic_id, v_provider, new.id, new.procedure_id, new.procedure_name,
    v_when, coalesce(v_rate.amount_cents, 0), v_rate.rate_id
  )
  on conflict (session_id) do nothing;

  return new;
end;
$$;

drop trigger if exists treatment_sessions_accrue_payout on public.treatment_sessions;
create trigger treatment_sessions_accrue_payout
  after insert or update on public.treatment_sessions
  for each row execute function public.accrue_session_payout();

create or replace function public.consume_session_kit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_when date;
  v_was_done boolean := (TG_OP = 'UPDATE' and coalesce(old.status, '') = 'done');
begin
  if new.status <> 'done' or v_was_done then
    return new;
  end if;
  if new.procedure_id is null or new.clinic_id is null then
    return new;
  end if;

  v_when := coalesce(new.done_at::date, public.today_br());

  for v_line in
    select ki.item_id, sum(ki.quantity) as quantity
    from public.kits_for(new.procedure_id, new.clinic_id) f
    join public.stock_kit_items ki on ki.kit_id = f.kit_id
    group by ki.item_id
  loop
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
  after insert or update on public.treatment_sessions
  for each row execute function public.consume_session_kit();

-- -----------------------------------------------------------------------------
-- 2) FRASCO ABERTO: o saldo passa a ter dois números
-- -----------------------------------------------------------------------------
alter table public.stock_items
  add column if not exists track_open_package boolean not null default false,
  add column if not exists general_use boolean not null default false;

comment on column public.stock_items.track_open_package is
  'Item em que a embalagem aberta importa (adesivo, resina). O saldo separa '
  'FECHADOS de EM USO — ninguém tem "2,78 ml de adesivo": tem um frasco pela '
  'metade.';
comment on column public.stock_items.general_use is
  'Uso geral do atendimento (máscara, gorro do profissional): não entra em kit '
  'de procedimento. O custo dele é ESTRUTURA e já está na hora de cadeira — '
  'rateá-lo por procedimento contaria duas vezes.';

alter table public.stock_balances
  -- Quanto resta dentro das embalagens ABERTAS, na unidade de consumo.
  add column if not exists in_use_quantity numeric(14,3) not null default 0,
  add column if not exists open_packages integer not null default 0;

comment on column public.stock_balances.quantity is
  'Saldo FECHADO (embalagens intactas), na unidade de consumo. O que está '
  'dentro de embalagem aberta fica em `in_use_quantity`.';

-- 'abertura' = reclassificação: o frasco sai do fechado e entra no em uso.
-- Não é entrada nem saída da unidade, e por isso não move valor.
alter table public.stock_movements
  drop constraint if exists stock_movements_kind_check;
alter table public.stock_movements
  add constraint stock_movements_kind_check check (kind in (
    'entrada', 'consumo', 'perda',
    'ajuste_entrada', 'ajuste_saida',
    'transferencia_entrada', 'transferencia_saida',
    'abertura'
  ));

-- -----------------------------------------------------------------------------
-- 3) A CONTA DO MOVIMENTO, agora com o frasco aberto
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
  v_guard integer := 0;
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
    -- A média pondera o estoque INTEIRO (fechado + aberto): o que está no
    -- frasco pela metade custou o que custou e continua valendo.
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
      -- ABRE EMBALAGEM ENQUANTO PRECISAR. O consumo sai do frasco aberto; a
      -- abertura fica registrada, para "1 em uso" nunca ser um número que
      -- ninguém sabe de onde veio.
      while v_in_use < v_qty and v_cur_qty >= v_factor and v_guard < 100 loop
        v_cur_qty := v_cur_qty - v_factor;
        v_in_use := v_in_use + v_factor;
        v_open := v_open + 1;
        v_guard := v_guard + 1;

        insert into public.stock_movements (
          clinic_id, item_id, kind, quantity, unit_cost_cents, total_cents,
          movement_date, source_type, source_id, reason,
          balance_after, avg_cost_after, created_by
        ) values (
          p_clinic_id, p_item_id, 'abertura', v_factor, round(v_cur_avg, 4),
          -- Reclassificação não move valor: o material continua na unidade.
          0, v_when, 'abertura', p_source_id,
          'Embalagem aberta (' || v_item.purchase_unit || ')',
          v_cur_qty, round(v_cur_avg, 4), v_user
        );
      end loop;

      v_in_use := v_in_use - v_qty;
      -- Frasco aberto que zerou deixa de ser "em uso".
      if v_in_use <= 0 and v_open > 0 then v_open := 0; end if;
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
         -- Pode ficar NEGATIVO de propósito: consumiu mais do que havia aberto e
         -- não havia embalagem fechada para abrir. É o mesmo princípio do saldo
         -- negativo — o número denuncia em vez de esconder.
         in_use_quantity = v_in_use,
         open_packages = v_open,
         avg_cost_cents = round(v_new_avg, 4),
         updated_at = now()
   where id = v_bal.id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) KIT DE ATENDIMENTO — um por paciente atendido, não por procedimento
-- -----------------------------------------------------------------------------
alter table public.stock_kits
  add column if not exists kind text not null default 'procedimento';

do $$
begin
  alter table public.stock_kits
    add constraint stock_kits_kind_check
    check (kind in ('procedimento', 'atendimento'));
exception when duplicate_object then null;
end $$;

comment on column public.stock_kits.kind is
  'atendimento = baixa uma vez por paciente atendido (gorro, propé, babador). '
  'Quem faz três procedimentos na mesma consulta não usa três gorros.';

-- Kit de procedimento nunca é kit de atendimento: `kits_for` só devolve os de
-- procedimento, senão o gorro entraria no custo de cada procedimento.
create or replace function public.kits_for(
  p_procedure_id uuid,
  p_clinic_id uuid
)
returns table (kit_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select l.kit_id
  from public.procedure_kit_links l
  join public.stock_kits k on k.id = l.kit_id
  where l.procedure_id = p_procedure_id
    and k.active and k.kind = 'procedimento'
    and l.clinic_id = p_clinic_id
  union all
  select l.kit_id
  from public.procedure_kit_links l
  join public.stock_kits k on k.id = l.kit_id
  where l.procedure_id = p_procedure_id
    and k.active and k.kind = 'procedimento'
    and l.clinic_id is null
    and not exists (
      select 1 from public.procedure_kit_links l2
      where l2.procedure_id = p_procedure_id and l2.clinic_id = p_clinic_id
    );
$$;

create unique index if not exists stock_movements_appointment_item_unique
  on public.stock_movements (source_id, item_id)
  where source_type = 'appointment';

create or replace function public.consume_attendance_kit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_when date;
  v_was_done boolean := (TG_OP = 'UPDATE'
                         and coalesce(old.attendance::text, '') = 'done');
begin
  if coalesce(new.attendance::text, '') <> 'done' or v_was_done then
    return new;
  end if;
  if new.clinic_id is null then return new; end if;

  v_when := coalesce(new.starts_at::date, public.today_br());

  -- Kit de atendimento da unidade vence o da rede (mesma cascata de sempre).
  for v_line in
    select ki.item_id, sum(ki.quantity) as quantity
    from public.stock_kits k
    join public.stock_kit_items ki on ki.kit_id = k.id
    where k.active and k.kind = 'atendimento'
      and (k.clinic_id = new.clinic_id
           or (k.clinic_id is null and not exists (
                 select 1 from public.stock_kits k2
                 where k2.active and k2.kind = 'atendimento'
                   and k2.clinic_id = new.clinic_id)))
    group by ki.item_id
  loop
    perform public.apply_stock_movement(
      p_clinic_id => new.clinic_id,
      p_item_id => v_line.item_id,
      p_kind => 'consumo',
      p_quantity => v_line.quantity,
      p_movement_date => v_when,
      p_reason => 'Atendimento encerrado',
      p_source_type => 'appointment',
      p_source_id => new.id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists appointments_consume_attendance_kit on public.appointments;
create trigger appointments_consume_attendance_kit
  after insert or update on public.appointments
  for each row execute function public.consume_attendance_kit();

-- -----------------------------------------------------------------------------
-- 5) O CADASTRO DO ITEM ganha os dois marcadores
-- -----------------------------------------------------------------------------
drop function if exists public.save_stock_item(
  uuid, text, text, text, text, numeric, text, text, boolean);

create or replace function public.save_stock_item(
  p_id uuid,
  p_name text,
  p_brand text,
  p_unit_of_measure text,
  p_purchase_unit text,
  p_units_per_purchase numeric,
  p_category text,
  p_notes text,
  p_active boolean default true,
  p_track_open_package boolean default false,
  p_general_use boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_old record;
  v_has_history boolean;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  if p_units_per_purchase is null or p_units_per_purchase <= 0 then
    raise exception 'INVALID_FACTOR';
  end if;

  if v_id is not null then
    select * into v_old from public.stock_items where id = v_id;
    if v_old.id is null then raise exception 'ITEM_NOT_FOUND'; end if;

    if v_old.unit_of_measure is distinct from btrim(p_unit_of_measure) then
      select exists (
        select 1 from public.stock_movements where item_id = v_id
        union all
        select 1 from public.stock_balances
         where item_id = v_id and quantity <> 0
      ) into v_has_history;

      if v_has_history then raise exception 'UNIT_LOCKED'; end if;
    end if;

    update public.stock_items
       set name = btrim(p_name),
           brand = nullif(btrim(coalesce(p_brand, '')), ''),
           unit_of_measure = btrim(p_unit_of_measure),
           purchase_unit = btrim(p_purchase_unit),
           units_per_purchase = p_units_per_purchase,
           category = nullif(btrim(coalesce(p_category, '')), ''),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           is_active = p_active,
           track_open_package = coalesce(p_track_open_package, false),
           general_use = coalesce(p_general_use, false)
     where id = v_id;
  else
    insert into public.stock_items (
      name, brand, unit_of_measure, purchase_unit, units_per_purchase,
      category, notes, is_active, track_open_package, general_use, created_by
    ) values (
      btrim(p_name), nullif(btrim(coalesce(p_brand, '')), ''),
      btrim(p_unit_of_measure), btrim(p_purchase_unit), p_units_per_purchase,
      nullif(btrim(coalesce(p_category, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''), p_active,
      coalesce(p_track_open_package, false), coalesce(p_general_use, false),
      (select auth.uid())
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_stock_item(
  uuid, text, text, text, text, numeric, text, text, boolean, boolean, boolean)
  to authenticated;

-- Salvar o kit também precisa dizer o TIPO (procedimento × atendimento).
drop function if exists public.save_stock_kit(
  uuid, uuid, text, text, jsonb, uuid[], boolean);

create or replace function public.save_stock_kit(
  p_kit_id uuid,
  p_clinic_id uuid,
  p_name text,
  p_notes text,
  p_items jsonb,
  p_procedure_ids uuid[],
  p_active boolean default true,
  p_kind text default 'procedimento'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_kit_id;
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_proc uuid;
  v_kind text := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'procedimento');
begin
  if not (
    public.is_admin_master() or public.is_finance_franchisor()
    or (p_clinic_id is not null and public.can_manage_stock(p_clinic_id))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;

  if v_id is null then
    insert into public.stock_kits
      (clinic_id, name, notes, active, kind, created_by)
    values (p_clinic_id, btrim(p_name),
            nullif(btrim(coalesce(p_notes, '')), ''), p_active, v_kind, v_user)
    returning id into v_id;
  else
    update public.stock_kits
       set name = btrim(p_name),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           active = p_active,
           kind = v_kind
     where id = v_id;
  end if;

  delete from public.stock_kit_items where kit_id = v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if (v_item->>'quantity')::numeric > 0 then
      insert into public.stock_kit_items (kit_id, item_id, quantity)
      values (v_id, (v_item->>'itemId')::uuid, (v_item->>'quantity')::numeric)
      on conflict (kit_id, item_id) do update
        set quantity = excluded.quantity;
    end if;
  end loop;

  delete from public.procedure_kit_links
   where kit_id = v_id and clinic_id is not distinct from p_clinic_id;

  -- Kit de ATENDIMENTO não se liga a procedimento: ele vale para o paciente
  -- atendido, e ligá-lo a procedimentos traria o gorro de volta para o custo
  -- de cada um.
  if v_kind = 'procedimento' and p_procedure_ids is not null then
    foreach v_proc in array p_procedure_ids loop
      insert into public.procedure_kit_links
        (procedure_id, kit_id, clinic_id, created_by)
      values (v_proc, v_id, p_clinic_id, v_user)
      on conflict do nothing;
    end loop;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_stock_kit(
  uuid, uuid, text, text, jsonb, uuid[], boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_items where track_open_package)
    as itens_com_frasco_aberto,
  (select count(*) from public.stock_items where general_use)
    as itens_de_uso_geral,
  (select count(*) from public.stock_kits where kind = 'atendimento')
    as kits_de_atendimento,
  (select count(*) from public.stock_movements where kind = 'abertura')
    as aberturas,
  (select count(*) from public.stock_movements where source_type = 'appointment')
    as baixas_por_atendimento,
  (select count(*) from public.stock_balances where in_use_quantity <> 0)
    as itens_com_embalagem_aberta;
