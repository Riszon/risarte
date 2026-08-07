-- =============================================================================
-- 0200 — A COBRANÇA GUARDA O MEIO DE PAGAMENTO
-- -----------------------------------------------------------------------------
-- Achado no teste do dono (06/08/2026): ele fez uma venda direta em 2× no
-- BOLETO e o botão "Registrar emissão" não apareceu.
--
-- Causa: `payment_installments.payment_method` estava NULO em todas as
-- cobranças. O meio de pagamento só existia na VENDA (`direct_sales
-- .payment_method` = 'boleto'); a coluna da parcela só era preenchida quando a
-- tela mandava um meio por cobrança — o que ela nunca faz.
--
-- Isso não era só a tela do boleto: a aba Financeiro da ficha também deixava de
-- mostrar como cada cobrança seria paga, e qualquer regra futura que dependa do
-- meio (repasse, conciliação, projeção) leria nulo.
--
-- Correção: quando a cobrança não diz o meio, ela HERDA o da venda. Vale para a
-- venda direta e para a negociação do Comercial — o dono pediu explicitamente
-- que os dois fluxos andem iguais.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Salvar as cobranças passa a herdar o meio de pagamento da venda
-- -----------------------------------------------------------------------------
create or replace function public.save_payment_schedule(
  p_negotiation_id uuid,
  p_direct_sale_id uuid,
  p_entries jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_final integer;
  v_method text;
  v_sum integer;
  v_down integer;
  v_entradas int;
  v_locked int;
  v_user uuid := (select auth.uid());
  v_seq int := 0;
  v_e jsonb;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then
    raise exception 'ORIGIN_REQUIRED';
  end if;

  if p_negotiation_id is not null then
    select n.clinic_id, n.client_id, n.final_cents, n.payment_method
      into v_clinic, v_client, v_final, v_method
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.clinic_id, s.client_id, s.final_cents, s.payment_method
      into v_clinic, v_client, v_final, v_method
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  if v_clinic is null then raise exception 'SALE_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic,
         array['unit_manager','receptionist','sdr']::public.user_role[])
    or exists (
      select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p
      where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select count(*) into v_locked
  from public.payment_installments i
  where ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))
    and (i.status in ('paga', 'parcial', 'renegociada')
         or coalesce(i.paid_amount_cents, 0) > 0
         or exists (select 1 from public.payment_receipts r
                    where r.installment_id = i.id));
  if v_locked > 0 then raise exception 'SCHEDULE_LOCKED'; end if;

  select coalesce(sum((e->>'amount_cents')::int), 0),
         count(*) filter (where e->>'kind' = 'entrada'),
         coalesce(sum((e->>'amount_cents')::int)
                  filter (where e->>'kind' = 'entrada'), 0)
    into v_sum, v_entradas, v_down
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e;

  if v_entradas > 1 then raise exception 'MULTIPLE_DOWN_PAYMENTS'; end if;
  if v_sum <> coalesce(v_final, 0) then raise exception 'TOTAL_MISMATCH'; end if;

  delete from public.payment_installments
   where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);

  for v_e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_seq := v_seq + 1;
    insert into public.payment_installments
      (clinic_id, client_id, negotiation_id, direct_sale_id, seq, kind,
       due_date, amount_cents, payment_method, created_by)
    values (
      v_clinic, v_client, p_negotiation_id, p_direct_sale_id, v_seq,
      coalesce(v_e->>'kind', 'parcela'),
      (v_e->>'due_date')::date,
      (v_e->>'amount_cents')::int,
      -- 0200: sem meio na cobrança, vale o da VENDA. Antes ficava nulo e a
      -- cobrança "não sabia" como seria paga.
      coalesce(nullif(v_e->>'payment_method', ''), v_method),
      v_user
    );
  end loop;

  perform public.apply_sale_benefit_risk(p_negotiation_id, p_direct_sale_id);
  perform public.apply_settlement_projection(p_negotiation_id, p_direct_sale_id);

  if p_negotiation_id is not null then
    update public.plan_negotiations
       set down_payment_cents = v_down, updated_at = now()
     where id = p_negotiation_id;
  else
    update public.direct_sales
       set down_payment_cents = v_down, updated_at = now()
     where id = p_direct_sale_id;
  end if;
end;
$$;

grant execute on function public.save_payment_schedule(uuid, uuid, jsonb)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2) Reparo: as cobranças que já existem herdam o meio da venda
-- -----------------------------------------------------------------------------
update public.payment_installments i
   set payment_method = s.payment_method
  from public.direct_sales s
 where i.direct_sale_id = s.id
   and i.payment_method is null
   and s.payment_method is not null;

update public.payment_installments i
   set payment_method = n.payment_method
  from public.plan_negotiations n
 where i.negotiation_id = n.id
   and i.payment_method is null
   and n.payment_method is not null;

-- Cobrança de renegociação: herda o meio da própria renegociação quando houver.
update public.payment_installments i
   set payment_method = o.payment_method
  from public.payment_installments o
 where i.renegotiation_id is not null
   and o.renegotiation_id = i.renegotiation_id
   and o.payment_method is not null
   and i.payment_method is null;

select
  (select count(*) from public.payment_installments
    where payment_method is not null) as cobrancas_com_meio,
  (select count(*) from public.payment_installments
    where payment_method is null) as cobrancas_sem_meio,
  (select count(*) from public.payment_installments
    where payment_method = 'boleto' and status in ('em_aberto','parcial'))
      as boletos_em_aberto;
