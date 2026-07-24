-- =============================================================================
-- Risarte Odontologia — Migration 0158 (Venda Direta v2 — VD2: fluxo)
-- docs/COMERCIAL.md §7. Complementa a 0157 (base/configuração).
--
-- 1) create_direct_sale_v2 — lança a venda: valida QUEM pode lançar cada
--    procedimento, grava a venda + itens, cria os PROCEDIMENTOS EM ABERTO no
--    prontuário (treatment_sessions), marca a EXCEÇÃO quando o atendimento já
--    havia sido feito, e notifica (Consultor da unidade com o valor + recepção
--    quando quem lançou não pode fechar).
--    Os preços/descontos de programa chegam JÁ CALCULADOS pelo servidor (a
--    server action recalcula do banco — o navegador nunca define valor).
-- 2) direct_sale_set_conditions — condições de pagamento (só quem FECHA:
--    recepção, gerente ou SDR autorizada). Acréscimo só o Gerente.
-- 3) direct_sale_close_step — contrato assinado / cobrança emitida / pagamento
--    confirmado. Regra de ouro: assinado + confirmado = venda CONCLUÍDA.
-- Idempotente.
-- =============================================================================

-- Quem pode FECHAR venda direta na unidade (recepção, gerente; SDR é validada
-- item a item na action, pois depende dos procedimentos da venda).
create or replace function public.direct_sale_can_close(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id,
         array['receptionist','unit_manager','sdr']::public.user_role[]);
$$;

-- 1) Lançamento da venda -------------------------------------------------------
create or replace function public.create_direct_sale_v2(
  p_client_id uuid,
  p_appointment_id uuid,
  p_attendance_done_before boolean,
  p_items jsonb,          -- [{procedure_id, description, quantity, unit_price_cents, program_discount_cents, final_cents}]
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
begin
  select clinic_id, full_name into v_clinic, v_client_name
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  -- Só a equipe da unidade lança venda direta.
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic,
         array['receptionist','sdr','clinical_coordinator','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Atendimento é OBRIGATÓRIO (decisão do dono §7.8).
  if p_appointment_id is null then raise exception 'APPOINTMENT_REQUIRED'; end if;
  if not exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id and a.client_id = p_client_id
  ) then
    raise exception 'APPOINTMENT_INVALID';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;

  insert into public.direct_sales
    (clinic_id, client_id, client_name, appointment_id, attendance_done_before,
     notes, created_by, status)
  values (v_clinic, p_client_id, v_client_name, p_appointment_id,
          coalesce(p_attendance_done_before, false), nullif(btrim(p_notes), ''),
          v_user, 'aguardando_fechamento')
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
    discount_cents = v_program,   -- desconto de PROGRAMA nesta etapa
    final_cents = v_final,
    updated_at = now()
  where id = v_sale;

  -- PROCEDIMENTOS EM ABERTO no prontuário (aba "Sessões & Procedimentos").
  -- Sem plano vinculado: são da venda direta. O dentista dá baixa depois.
  insert into public.treatment_sessions
    (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
     session_index, session_total, status, appointment_id)
  select
    p_client_id, v_clinic, null, null,
    nullif(i->>'procedure_id', '')::uuid,
    coalesce(i->>'description', 'Procedimento'),
    1, 1, 'pending', p_appointment_id
  from jsonb_array_elements(p_items) i,
       generate_series(1, greatest(1, coalesce((i->>'quantity')::int, 1)));

  v_reais := 'R$ ' || (v_final / 100)::text || ',' ||
             lpad((v_final % 100)::text, 2, '0');

  -- Consultor Comercial da unidade: toda venda direta com o VALOR (§7.7).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_clinic,
    'Venda direta na unidade — ' || v_reais,
    coalesce(v_client_name, 'Cliente') || ' — venda direta de ' || v_reais
      || ' (' || v_count || ' procedimento(s)) lançada na unidade.',
    '/comercial/venda-direta'
  from public.providers_with_access(v_clinic, 'commercial_consultant') pwa
  where pwa.user_id is distinct from v_user;

  -- Quem lançou não fecha (ex.: Coordenador Clínico) → aciona a recepção.
  v_can_close := public.direct_sale_can_close(v_clinic);
  if not v_can_close then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'Venda direta aguardando fechamento',
      coalesce(v_client_name, 'Cliente') || ' — ' || v_reais
        || '. Defina a forma de pagamento, envie o contrato e a cobrança.',
      '/comercial/venda-direta'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role in ('receptionist','unit_manager')
      and ucr.user_id is distinct from v_user;
  end if;

  -- EXCEÇÃO: atendeu primeiro e vendeu depois — vai ao gerente/franqueado.
  if coalesce(p_attendance_done_before, false) then
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
    jsonb_build_object('items', v_count, 'exception', coalesce(p_attendance_done_before,false)));

  return v_sale;
end;
$$;

-- 2) Condições de pagamento (só quem fecha) -----------------------------------
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

  -- Acréscimo é privilégio do Gerente (§7.5).
  if coalesce(p_surcharge_cents, 0) > 0
     and not (public.is_admin_master()
              or public.has_role_in_clinic(v_sale.clinic_id,
                   array['unit_manager']::public.user_role[])) then
    raise exception 'SURCHARGE_MANAGER_ONLY';
  end if;

  v_final := greatest(0,
    v_sale.subtotal_cents - v_sale.discount_cents
    - coalesce(p_discount_cents, 0) + coalesce(p_surcharge_cents, 0));

  update public.direct_sales set
    payment_method = p_payment_method,
    installments = greatest(1, coalesce(p_installments, 1)),
    -- discount_cents guarda programa + desconto manual (total concedido).
    discount_cents = v_sale.discount_cents + coalesce(p_discount_cents, 0),
    surcharge_cents = coalesce(p_surcharge_cents, 0),
    final_cents = v_final,
    updated_at = now()
  where id = p_sale_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_conditions', p_sale_id::text, null);
end;
$$;

-- 3) Passos do fechamento ------------------------------------------------------
create or replace function public.direct_sale_close_step(
  p_sale_id uuid,
  p_step text,      -- 'contract' | 'payment_issued' | 'payment_confirmed'
  p_value boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.direct_sales;
  v_user uuid := (select auth.uid());
  v_signed boolean;
  v_confirmed boolean;
  v_closed boolean := false;
begin
  select * into v_sale from public.direct_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.direct_sale_can_close(v_sale.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;
  if p_step not in ('contract','payment_issued','payment_confirmed') then
    raise exception 'INVALID_STEP';
  end if;

  if p_step = 'contract' then
    update public.direct_sales set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end,
      updated_at = now()
    where id = p_sale_id;
  elsif p_step = 'payment_issued' then
    update public.direct_sales set
      payment_issued = p_value,
      payment_issued_at = case when p_value then now() else null end,
      payment_issued_by = case when p_value then v_user else null end,
      -- Valor zerado por programa: emitir já confirma o pagamento (§7.6).
      payment_confirmed = case when p_value and v_sale.final_cents <= 0 then true
                               else payment_confirmed end,
      payment_confirmed_at = case when p_value and v_sale.final_cents <= 0 then now()
                                  else payment_confirmed_at end,
      payment_confirmed_by = case when p_value and v_sale.final_cents <= 0 then v_user
                                  else payment_confirmed_by end,
      updated_at = now()
    where id = p_sale_id;
  else
    update public.direct_sales set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end,
      updated_at = now()
    where id = p_sale_id;
  end if;

  select contract_signed, payment_confirmed into v_signed, v_confirmed
  from public.direct_sales where id = p_sale_id;

  -- REGRA DE OURO: assinado + confirmado = venda concluída.
  if v_signed and v_confirmed then
    update public.direct_sales set
      status = 'concluida', closed_at = now(), updated_at = now()
    where id = p_sale_id;
    v_closed := true;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_close', p_sale_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed));

  return jsonb_build_object('signed', v_signed, 'confirmed', v_confirmed, 'closed', v_closed);
end;
$$;

revoke all on function public.direct_sale_can_close(uuid) from public;
revoke all on function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text) from public;
revoke all on function public.direct_sale_set_conditions(uuid, text, integer, integer, integer) from public;
revoke all on function public.direct_sale_close_step(uuid, text, boolean) from public;
grant execute on function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text) to authenticated;
grant execute on function public.direct_sale_set_conditions(uuid, text, integer, integer, integer) to authenticated;
grant execute on function public.direct_sale_close_step(uuid, text, boolean) to authenticated;
