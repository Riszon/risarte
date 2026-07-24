-- =============================================================================
-- Risarte Odontologia — Migration 0160 (Venda Direta v2 — desconto × programa)
-- docs/COMERCIAL.md §7.5: cliente de programa com desconto automático (Risarte
-- Empresarial / futuro riso+) NÃO recebe desconto manual — o benefício do
-- programa já é o desconto. Desconto manual só para quem NÃO é de programa.
-- Idempotente.
-- =============================================================================

create or replace function public.direct_sale_set_conditions(
  p_sale_id uuid,
  p_payment_method text,
  p_installments integer,
  p_discount_cents integer,
  p_surcharge_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.direct_sales;
  v_user uuid := (select auth.uid());
  v_final integer;
  v_is_member boolean;
begin
  select * into v_sale from public.direct_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.direct_sale_can_close(v_sale.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  -- Cliente de programa (desconto automático) → sem desconto manual.
  select (empresarial_company_id is not null and empresarial_active is not false)
    into v_is_member
  from public.clients where id = v_sale.client_id;
  if coalesce(v_is_member, false) and coalesce(p_discount_cents, 0) > 0 then
    raise exception 'PROGRAM_NO_DISCOUNT';
  end if;

  if coalesce(p_surcharge_cents, 0) > 0
     and not (public.is_admin_master()
              or public.has_role_in_clinic(v_sale.clinic_id,
                   array['unit_manager']::public.user_role[])) then
    raise exception 'SURCHARGE_MANAGER_ONLY';
  end if;

  v_final := greatest(0,
    v_sale.subtotal_cents - v_sale.program_discount_cents
    - coalesce(p_discount_cents, 0) + coalesce(p_surcharge_cents, 0));

  update public.direct_sales set
    payment_method = p_payment_method,
    installments = greatest(1, coalesce(p_installments, 1)),
    discount_cents = coalesce(p_discount_cents, 0),
    surcharge_cents = coalesce(p_surcharge_cents, 0),
    final_cents = v_final,
    updated_at = now()
  where id = p_sale_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_conditions', p_sale_id::text, null);
end;
$$;
