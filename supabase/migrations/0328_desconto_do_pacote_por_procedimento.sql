-- =============================================================================
-- 0328 — DE ONDE SAI O DESCONTO DO PACOTE (pedido do dono, 27/10/2026)
-- Plano: docs/procedimentos/GRUPOS-PLANO.md §8 (GP9)
--
-- Até aqui o pacote tinha UM percentual (0325), aplicado igual em todos os
-- procedimentos do grupo. O dono pediu escolher de onde o desconto (ou o
-- acréscimo) sai: de um procedimento só, ou um pouco de cada, como hoje.
--
-- Cada procedimento do grupo pode ter o SEU percentual
-- (`procedure_group_items.price_adjust_percent`). Nulo = vale o do grupo
-- (`procedure_groups.price_adjust_percent`) — é o "igual em todos" de hoje.
-- Continua sendo percentual (GP5): vale para qualquer número de dentes.
--
-- Quem faz a conta continua sendo o banco, no MESMO lugar:
-- `plan_item_group_percent` (usada pela trava do item, 0325, e pelo envio do
-- plano) passa a devolver o percentual do procedimento quando ele tem um.
--
-- ⚠️ `save_procedure_group` (0324) apagava e regravava os itens do grupo —
-- apagaria o percentual de cada procedimento ao editar o grupo ou ao usar o
-- "Vincular a grupo". Recriada aqui levando o percentual de quem fica.
--
-- Idempotente.
-- =============================================================================

-- 1) A coluna ----------------------------------------------------------------------
-- QUATRO casas: "o desconto sai de um procedimento só" tem de fechar no
-- centavo — com 2 casas, R$ 1.260,00 pedidos num pacote de R$ 1.400,00
-- tirando só de um canal de R$ 950,00 saíam R$ 1.259,97 (achado na tela).
alter table public.procedure_group_items
  add column if not exists price_adjust_percent numeric(7,4);
alter table public.procedure_group_items
  alter column price_adjust_percent type numeric(7,4);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'procedure_group_items_price_adjust_chk') then
    alter table public.procedure_group_items
      add constraint procedure_group_items_price_adjust_chk
      check (price_adjust_percent is null
             or (price_adjust_percent > -100 and price_adjust_percent <= 100));
  end if;
end $$;

-- 2) A conta: o percentual do procedimento, senão o do grupo ------------------------
create or replace function public.plan_item_group_percent(p_group uuid, p_procedure uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce(gi.price_adjust_percent, g.price_adjust_percent)
      from public.procedure_groups g
      join public.procedure_group_items gi on gi.group_id = g.id
     where g.id = p_group and gi.procedure_id = p_procedure
  ), 0);
$$;
revoke execute on function public.plan_item_group_percent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.plan_item_group_percent(uuid, uuid) to authenticated;

-- 3) Editar o grupo NÃO apaga o percentual de quem fica -----------------------------
-- Igual à 0324, exceto: antes de apagar os itens, guarda o percentual de cada
-- procedimento e devolve a quem continua no grupo.
create or replace function public.save_procedure_group(
  p_id uuid,
  p_name text,
  p_description text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_ordem int := 0;
  v_proc uuid;
  v_qtd int;
  v_pcts jsonb := '{}'::jsonb;
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'NAME_REQUIRED'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) < 2 then
    raise exception 'GROUP_NEEDS_TWO';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'GROUP_TOO_BIG'; end if;
  if exists (select 1 from public.procedure_groups g
              where lower(btrim(g.name)) = lower(btrim(p_name))
                and g.id is distinct from p_id) then
    raise exception 'GROUP_NAME_TAKEN';
  end if;

  if p_id is null then
    insert into public.procedure_groups (name, description, updated_by, updated_at)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), auth.uid(), now())
    returning id into v_id;
  else
    update public.procedure_groups
       set name = btrim(p_name),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           updated_by = auth.uid(),
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'GROUP_NOT_FOUND'; end if;
    -- 0328: o percentual de cada procedimento, para devolver a quem fica.
    select coalesce(jsonb_object_agg(gi.procedure_id::text, gi.price_adjust_percent), '{}'::jsonb)
      into v_pcts
      from public.procedure_group_items gi
     where gi.group_id = v_id and gi.price_adjust_percent is not null;
    delete from public.procedure_group_items where group_id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_ordem := v_ordem + 1;
    v_proc := nullif(v_item ->> 'procedureId', '')::uuid;
    v_qtd := coalesce(nullif(v_item ->> 'quantity', '')::int, 1);
    if v_qtd not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;
    if v_proc is null or not exists (select 1 from public.procedures p
                                      where p.id = v_proc and p.is_active) then
      raise exception 'PROCEDURE_NOT_ACTIVE';
    end if;
    if exists (select 1 from public.procedure_group_items gi
                where gi.group_id = v_id and gi.procedure_id = v_proc) then
      raise exception 'PROCEDURE_REPEATED';
    end if;
    insert into public.procedure_group_items (group_id, procedure_id, sort_order, quantity, price_adjust_percent)
    values (v_id, v_proc, v_ordem, v_qtd, (v_pcts ->> v_proc::text)::numeric);
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.save_procedure_group(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_procedure_group(uuid, text, text, jsonb) to authenticated;

-- 4) A porta do preço com a distribuição: SÓ o Admin Master -------------------------
-- p_percent = o percentual do grupo (o de quem não tem o seu).
-- p_item_percents = [{ "procedureId": uuid, "percent": numeric | null }, ...]
--   — nulo apaga o percentual próprio (volta a valer o do grupo). Procedimento
--   que não está no grupo é recusado. Lista vazia = todos voltam ao do grupo.
-- O mínimo (0326) é conferido contra o pacote EFETIVO: um de cada, pelo
-- preço padrão da rede, com o percentual de cada procedimento.
create or replace function public.set_procedure_group_split(
  p_id uuid,
  p_percent numeric,
  p_min_percent numeric,
  p_item_percents jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_proc uuid;
  v_pct numeric;
  v_tabela numeric;
  v_pacote numeric;
begin
  if not public.is_admin_master() then
    raise exception 'PRICE_NOT_ALLOWED';
  end if;
  if p_percent is null or p_percent <= -100 or p_percent > 100 then
    raise exception 'INVALID_ADJUST';
  end if;
  if p_min_percent is not null and (p_min_percent <= 0 or p_min_percent > 200) then
    raise exception 'INVALID_MIN';
  end if;
  if jsonb_typeof(coalesce(p_item_percents, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'INVALID_ADJUST';
  end if;
  if not exists (select 1 from public.procedure_groups where id = p_id) then
    raise exception 'GROUP_NOT_FOUND';
  end if;

  update public.procedure_groups
     set price_adjust_percent = round(p_percent, 2),
         min_price_percent = round(p_min_percent, 2),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_id;

  -- Todos voltam ao do grupo; depois, quem tem o seu ganha o seu.
  update public.procedure_group_items set price_adjust_percent = null
   where group_id = p_id and price_adjust_percent is not null;
  for v_item in select value from jsonb_array_elements(coalesce(p_item_percents, '[]'::jsonb)) loop
    v_proc := nullif(v_item ->> 'procedureId', '')::uuid;
    v_pct := nullif(v_item ->> 'percent', '')::numeric;
    if v_pct is not null and (v_pct <= -100 or v_pct > 100) then
      raise exception 'INVALID_ADJUST';
    end if;
    update public.procedure_group_items
       set price_adjust_percent = round(v_pct, 4)
     where group_id = p_id and procedure_id = v_proc;
    if not found then raise exception 'PROCEDURE_NOT_IN_GROUP'; end if;
  end loop;

  -- O mínimo não pode ficar acima do pacote efetivo (um de cada, preço da rede).
  if p_min_percent is not null then
    select sum(p.default_price_cents * gi.quantity),
           sum(p.default_price_cents * gi.quantity
               * (100 + coalesce(gi.price_adjust_percent, round(p_percent, 2))) / 100)
      into v_tabela, v_pacote
      from public.procedure_group_items gi
      join public.procedures p on p.id = gi.procedure_id
     where gi.group_id = p_id;
    if coalesce(v_tabela, 0) > 0
       and round(p_min_percent, 2) > round(v_pacote * 100 / v_tabela, 2) then
      raise exception 'MIN_ABOVE_PRICE';
    end if;
  end if;
end;
$$;
revoke execute on function public.set_procedure_group_split(uuid, numeric, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.set_procedure_group_split(uuid, numeric, numeric, jsonb) to authenticated;
