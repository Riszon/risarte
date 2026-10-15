-- =============================================================================
-- 0294 — QUEM APROVA A COMPRA DA PRÓPRIA FRANQUEADORA (relato OC-00102)
--
-- "Realizei o pedido de compra, mas não aparece para aprovação." O pedido
-- aparecia — sem os botões: aprovar e gerar pedido (0241) só aceitavam o
-- Admin Master e o GERENTE da unidade. A RISARTE Franchising não tem gerente
-- (lido nos dois bancos em 14/10/2026), então a compra da própria
-- Franqueadora só andava pelo Admin.
--
-- Decisão do dono (15/10/2026): quando a unidade da compra é a PRÓPRIA
-- Franqueadora, o Financeiro da Franqueadora também decide. Nas unidades nada
-- muda: o gerente (dono do dinheiro) e o Admin.
--
-- As duas funções abaixo são as da 0241 com UMA mudança: a guarda passa a
-- chamar can_decide_purchase (uma régua só, também usada pela tela).
-- De carona: deixam de executar SEM LOGIN (AP15/AP16) — a guarda já recusava.
-- E a tela ganha a permissão própria "Aprovar compra da unidade" (item 4).
--
-- Nada apaga. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A régua: quem decide a parte de uma unidade na rodada
-- -----------------------------------------------------------------------------
create or replace function public.can_decide_purchase(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.has_role_in_clinic(p_clinic_id,
           array['unit_manager']::public.user_role[])
      or (public.has_role_in_clinic(p_clinic_id,
            array['finance_franchisor']::public.user_role[])
          and exists (select 1 from public.clinics c
                       where c.id = p_clinic_id and c.type = 'franchisor'));
$$;

revoke execute on function public.can_decide_purchase(uuid) from public, anon, authenticated;
grant execute on function public.can_decide_purchase(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) Aprovar ou recusar (igual à 0241, menos a guarda e o comentário dela)
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

  -- Quem decide é quem PAGA: o gerente da unidade. A franqueadora não aprova
  -- no lugar de uma unidade — é dinheiro dela. Na compra da PRÓPRIA
  -- Franqueadora, o Financeiro da Franqueadora decide (0294).
  -- 0294 (OC-00102): a regra de quem decide mora em can_decide_purchase.
  if not public.can_decide_purchase(v_a.clinic_id) then
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

revoke execute on function public.decide_allocation(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.decide_allocation(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Gerar os pedidos (igual à 0241, menos a guarda)
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
  -- 0294 (OC-00102): a regra de quem decide mora em can_decide_purchase.
  if not public.can_decide_purchase(p_clinic_id) then
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

revoke execute on function public.create_orders_from_round(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_orders_from_round(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A permissão "Aprovar compra da unidade" na matriz
-- -----------------------------------------------------------------------------
-- Até aqui a tela mostrava os botões de aprovar a quem tinha "Criar requisição
-- de compra" — que, na produção, não está ligada para o Financeiro da
-- Franqueadora. Aprovar ganha permissão própria (src/lib/permissions.ts),
-- semeada com o mesmo padrão do código: Gerente e Financeiro da Franqueadora.
-- Com a matriz gravada no banco, permissão sem linha não alcança ninguém —
-- por isso as linhas entram aqui. Quem fica com a última palavra é o banco
-- (can_decide_purchase): o Financeiro só decide a compra da Franqueadora.
insert into public.permission_matrix (capability, role) values
  ('acao.compras.aprovar', 'unit_manager'),
  ('acao.compras.aprovar', 'finance_franchisor')
on conflict (capability, role) do nothing;

