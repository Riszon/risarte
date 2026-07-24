-- =============================================================================
-- Risarte Odontologia — Migration 0159 (Venda Direta v2 — correções)
-- docs/COMERCIAL.md §7.
--
-- 1) BUG do desconto acumulado: separa o desconto de PROGRAMA
--    (program_discount_cents) do desconto MANUAL (discount_cents). Salvar as
--    condições agora SUBSTITUI o desconto manual (não soma), e sempre sobre o
--    preço "cheio" (subtotal − programa) — não sobre o valor já descontado.
-- 2) Procedimentos EM ABERTO / CONCLUÍDOS: as sessões da venda direta já
--    existiam (0158), mas o prontuário só as montava a partir de planos. Aqui
--    garantimos que o atendimento JÁ REALIZADO nasce "concluído" (status done,
--    baixa pelo dentista do atendimento); o que será realizado nasce "em aberto".
-- Idempotente.
-- =============================================================================

alter table public.direct_sales
  add column if not exists program_discount_cents integer not null default 0;

-- Backfill: nas vendas já criadas, discount_cents guardava o desconto de
-- PROGRAMA (0158). Move para a coluna própria e zera o desconto manual.
update public.direct_sales
set program_discount_cents = discount_cents, discount_cents = 0
where program_discount_cents = 0 and discount_cents > 0 and closed_at is null;

-- 1) Lançamento: separa programa (calculado) do manual (começa em 0). ----------
create or replace function public.create_direct_sale_v2(
  p_client_id uuid,
  p_appointment_id uuid,
  p_attendance_done_before boolean,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client_name text;
  v_sale uuid;
  v_item jsonb;
  v_subtotal integer := 0;
  v_program integer := 0;
  v_final integer := 0;
  v_count integer := 0;
  v_user uuid := (select auth.uid());
  v_can_close boolean;
  v_reais text;
  v_provider uuid;
  v_done boolean := coalesce(p_attendance_done_before, false);
begin
  select clinic_id, full_name into v_clinic, v_client_name
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic,
         array['receptionist','sdr','clinical_coordinator','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_appointment_id is null then raise exception 'APPOINTMENT_REQUIRED'; end if;
  select provider_user_id into v_provider
  from public.appointments a
  where a.id = p_appointment_id and a.client_id = p_client_id;
  if not found then raise exception 'APPOINTMENT_INVALID'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;

  insert into public.direct_sales
    (clinic_id, client_id, client_name, appointment_id, attendance_done_before,
     notes, created_by, status)
  values (v_clinic, p_client_id, v_client_name, p_appointment_id, v_done,
          nullif(btrim(p_notes), ''), v_user, 'aguardando_fechamento')
  returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.direct_sale_items
      (sale_id, clinic_id, procedure_id, description, quantity,
       unit_price_cents, program_discount_cents, final_cents)
    values (
      v_sale, v_clinic,
      nullif(v_item->>'procedure_id', '')::uuid,
      coalesce(v_item->>'description', 'Procedimento'),
      coalesce((v_item->>'quantity')::int, 1),
      coalesce((v_item->>'unit_price_cents')::int, 0),
      coalesce((v_item->>'program_discount_cents')::int, 0),
      coalesce((v_item->>'final_cents')::int, 0)
    );
    v_subtotal := v_subtotal
      + coalesce((v_item->>'unit_price_cents')::int, 0)
        * coalesce((v_item->>'quantity')::int, 1);
    v_program := v_program + coalesce((v_item->>'program_discount_cents')::int, 0);
    v_final := v_final + coalesce((v_item->>'final_cents')::int, 0);
    v_count := v_count + coalesce((v_item->>'quantity')::int, 1);
  end loop;

  update public.direct_sales set
    subtotal_cents = v_subtotal,
    program_discount_cents = v_program,
    discount_cents = 0,           -- desconto MANUAL começa em zero
    final_cents = v_final,
    updated_at = now()
  where id = v_sale;

  -- PROCEDIMENTOS no prontuário: já realizado → CONCLUÍDO (baixa do dentista do
  -- atendimento); a realizar/em atendimento → EM ABERTO (pending).
  insert into public.treatment_sessions
    (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
     session_index, session_total, status, appointment_id, done_at, executed_by)
  select
    p_client_id, v_clinic, null, null,
    nullif(i->>'procedure_id', '')::uuid,
    coalesce(i->>'description', 'Procedimento'),
    1, 1,
    case when v_done then 'done' else 'pending' end,
    p_appointment_id,
    case when v_done then now() else null end,
    case when v_done then v_provider else null end
  from jsonb_array_elements(p_items) i,
       generate_series(1, greatest(1, coalesce((i->>'quantity')::int, 1)));

  v_reais := 'R$ ' || (v_final / 100)::text || ',' ||
             lpad((v_final % 100)::text, 2, '0');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_clinic,
    'Venda direta na unidade — ' || v_reais,
    coalesce(v_client_name, 'Cliente') || ' — venda direta de ' || v_reais
      || ' (' || v_count || ' procedimento(s)) lançada na unidade.',
    '/comercial/venda-direta'
  from public.providers_with_access(v_clinic, 'commercial_consultant') pwa
  where pwa.user_id is distinct from v_user;

  v_can_close := public.direct_sale_can_close(v_clinic);
  if not v_can_close then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'Venda direta aguardando fechamento',
      coalesce(v_client_name, 'Cliente') || ' — ' || v_reais
        || '. Defina a forma de pagamento, envie o contrato e a cobrança.',
      '/prontuarios/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role in ('receptionist','unit_manager')
      and ucr.user_id is distinct from v_user;
  end if;

  if v_done then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'ATENÇÃO: venda direta lançada APÓS o atendimento',
      coalesce(v_client_name, 'Cliente')
        || ' — o atendimento foi realizado ANTES da venda ser lançada. O certo é'
        || ' vender antes de atender; acompanhe para corrigir o fluxo da unidade.',
      '/comercial/venda-direta'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('unit_manager','franchisee')
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'direct_sale', v_sale::text,
    jsonb_build_object('items', v_count, 'exception', v_done));

  return v_sale;
end;
$$;

-- 2) Condições: SUBSTITUI o desconto manual (não soma) e recalcula do cheio. ---
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
begin
  select * into v_sale from public.direct_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.direct_sale_can_close(v_sale.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if coalesce(p_surcharge_cents, 0) > 0
     and not (public.is_admin_master()
              or public.has_role_in_clinic(v_sale.clinic_id,
                   array['unit_manager']::public.user_role[])) then
    raise exception 'SURCHARGE_MANAGER_ONLY';
  end if;

  -- Final = cheio − programa − desconto MANUAL (substituído) + acréscimo.
  v_final := greatest(0,
    v_sale.subtotal_cents - v_sale.program_discount_cents
    - coalesce(p_discount_cents, 0) + coalesce(p_surcharge_cents, 0));

  update public.direct_sales set
    payment_method = p_payment_method,
    installments = greatest(1, coalesce(p_installments, 1)),
    discount_cents = coalesce(p_discount_cents, 0),   -- SUBSTITUI
    surcharge_cents = coalesce(p_surcharge_cents, 0),
    final_cents = v_final,
    updated_at = now()
  where id = p_sale_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_conditions', p_sale_id::text, null);
end;
$$;
