-- =============================================================================
-- 0296 — COORDENADOR E ASB MONTAM A LISTA DE COMPRAS; O ASB DÁ ENTRADA (AP42)
--
-- Na matriz de permissões, "Criar requisição de compra" está ligada para
-- Coordenador Clínico e ASB, e "Entrada e inventário de estoque" para o ASB —
-- mas o banco só aceitava Admin, Financeiro da Franqueadora e Gerente
-- (can_manage_stock), e a tela mostrava "Só consulta". Decisão do dono
-- (15/10/2026): liberar no banco.
--
-- O QUE ABRE, E SÓ ISTO, na unidade onde a pessoa tem a função:
--   - Coordenador e ASB: montar, editar, enviar e cancelar a lista de compras;
--   - ASB: entradas de estoque e a contagem (inventário).
-- O QUE NÃO ABRE: compra com nota e recebimento de pedido (criam CONTA A
-- PAGAR), kits e configuração dos itens — continuam com can_manage_stock.
--
-- ⚠️ As funções vão POR NOME, não pela matriz: a matriz da produção também
-- liga essas ações para a Franqueadora/Rede, que o dono decidiu deixar só em
-- consulta (OC-00094). A matriz continua podendo DESLIGAR na tela.
--
-- As funções abaixo são as definições em vigor (lidas do banco do treino em
-- 15/10/2026), com só a guarda trocada. Nada apaga. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) As duas réguas novas
-- -----------------------------------------------------------------------------
create or replace function public.can_request_purchase(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_stock(p_clinic_id)
      or (p_clinic_id is not null and public.has_role_in_clinic(
            p_clinic_id, array['clinical_coordinator', 'asb']::public.user_role[]));
$$;

revoke execute on function public.can_request_purchase(uuid) from public, anon, authenticated;
grant execute on function public.can_request_purchase(uuid) to authenticated;

create or replace function public.can_post_stock_entry(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_stock(p_clinic_id)
      or (p_clinic_id is not null and public.has_role_in_clinic(
            p_clinic_id, array['asb']::public.user_role[]));
$$;

revoke execute on function public.can_post_stock_entry(uuid) from public, anon, authenticated;
grant execute on function public.can_post_stock_entry(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) As funções que passam a usar as réguas
-- -----------------------------------------------------------------------------
-- post_stock_movement: a definição em vigor (lida do banco), só com a guarda trocada.
CREATE OR REPLACE FUNCTION public.post_stock_movement(p_clinic_id uuid, p_item_id uuid, p_kind text, p_quantity numeric DEFAULT NULL::numeric, p_unit_cost_cents numeric DEFAULT NULL::numeric, p_movement_date date DEFAULT NULL::date, p_reason text DEFAULT NULL::text, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_purchase_quantity numeric DEFAULT NULL::numeric, p_purchase_unit_cost_cents bigint DEFAULT NULL::bigint, p_lot_code text DEFAULT NULL::text, p_expires_at date DEFAULT NULL::date, p_supplier_id uuid DEFAULT NULL::uuid, p_invoice_number text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_kind in ('entrada', 'ajuste_entrada', 'transferencia_entrada',
                'ajuste_saida', 'transferencia_saida') then
    if not public.can_post_stock_entry(p_clinic_id) then
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
$function$;

-- open_stock_count: a definição em vigor (lida do banco), só com a guarda trocada.
CREATE OR REPLACE FUNCTION public.open_stock_count(p_clinic_id uuid, p_only_with_balance boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not public.can_post_stock_entry(p_clinic_id) then
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
$function$;

-- apply_stock_count: a definição em vigor (lida do banco), só com a guarda trocada.
CREATE OR REPLACE FUNCTION public.apply_stock_count(p_count_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not public.can_post_stock_entry(v_count.clinic_id) then
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
$function$;

-- discard_stock_count: a definição em vigor (lida do banco), só com a guarda trocada.
CREATE OR REPLACE FUNCTION public.discard_stock_count(p_count_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count record;
begin
  select * into v_count from public.stock_counts where id = p_count_id;
  if v_count.id is null then raise exception 'COUNT_NOT_FOUND'; end if;
  if not public.can_post_stock_entry(v_count.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_count.status <> 'aberta' then raise exception 'COUNT_NOT_OPEN'; end if;

  update public.stock_counts set status = 'descartada' where id = p_count_id;
end;
$function$;

-- build_purchase_request: a definição em vigor (lida do banco), só com a guarda trocada.
CREATE OR REPLACE FUNCTION public.build_purchase_request(p_clinic_id uuid, p_is_local boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_row record;
  v_est record;
begin
  if not (public.is_admin_master() or public.can_request_purchase(p_clinic_id)) then
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
$function$;

-- send_purchase_request: a definição em vigor (lida do banco), só com a guarda trocada.
CREATE OR REPLACE FUNCTION public.send_purchase_request(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_r record;
  v_user uuid := (select auth.uid());
  v_items integer;
begin
  select * into v_r from public.purchase_requests where id = p_id;
  if v_r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.can_request_purchase(v_r.clinic_id))
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
$function$;

-- -----------------------------------------------------------------------------
-- 3) As regras das tabelas (a lista e a contagem são gravadas também direto)
-- -----------------------------------------------------------------------------
drop policy if exists purchase_requests_write on public.purchase_requests;
create policy purchase_requests_write on public.purchase_requests for all
  using (public.is_admin_master() or public.can_request_purchase(clinic_id))
  with check (public.is_admin_master() or public.can_request_purchase(clinic_id));

drop policy if exists purchase_request_items_write on public.purchase_request_items;
create policy purchase_request_items_write on public.purchase_request_items for all
  using (exists (select 1 from public.purchase_requests r
                  where r.id = purchase_request_items.request_id
                    and (public.is_admin_master() or public.can_request_purchase(r.clinic_id))))
  with check (exists (select 1 from public.purchase_requests r
                       where r.id = purchase_request_items.request_id
                         and (public.is_admin_master() or public.can_request_purchase(r.clinic_id))));

drop policy if exists stock_counts_write on public.stock_counts;
create policy stock_counts_write on public.stock_counts for all
  using (public.can_post_stock_entry(clinic_id))
  with check (public.can_post_stock_entry(clinic_id));

drop policy if exists stock_count_items_write on public.stock_count_items;
create policy stock_count_items_write on public.stock_count_items for all
  using (exists (select 1 from public.stock_counts c
                  where c.id = stock_count_items.count_id and c.status = 'aberta'
                    and public.can_post_stock_entry(c.clinic_id)))
  with check (exists (select 1 from public.stock_counts c
                       where c.id = stock_count_items.count_id and c.status = 'aberta'
                         and public.can_post_stock_entry(c.clinic_id)));
