-- =============================================================================
-- 0178 — I9: entrada + parcelas personalizadas
-- -----------------------------------------------------------------------------
-- Até aqui a venda guardava só "meio de pagamento + nº de parcelas". O dono
-- pediu venda com **entrada + parcelas**, e — no boleto — **cada parcela com
-- data de vencimento e valor próprios**.
--
-- `payment_installments` é o plano de cobrança da venda (negociação do consultor
-- OU venda direta). Ela é, de propósito, a **base do módulo Financeiro**: é
-- daqui que sairão os boletos em aberto, o atraso e a renegociação.
-- Idempotente.
-- =============================================================================

create table if not exists public.payment_installments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid references public.clients (id) on delete cascade,
  -- Exatamente uma origem: negociação do comercial OU venda direta.
  negotiation_id uuid references public.plan_negotiations (id) on delete cascade,
  direct_sale_id uuid references public.direct_sales (id) on delete cascade,
  seq integer not null,
  kind text not null default 'parcela' check (kind in ('entrada','parcela')),
  due_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  payment_method text
    check (payment_method is null or payment_method in
      ('pix','boleto','cartao','cartao_parcelado','credito_recorrente','deposito_avista')),
  status text not null default 'em_aberto'
    check (status in ('em_aberto','paga','cancelada')),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint payment_installments_origin_check check (
    (negotiation_id is not null and direct_sale_id is null)
    or (negotiation_id is null and direct_sale_id is not null)
  )
);

create index if not exists payment_installments_negotiation_idx
  on public.payment_installments (negotiation_id, seq);
create index if not exists payment_installments_sale_idx
  on public.payment_installments (direct_sale_id, seq);
-- O Financeiro vai varrer por vencimento e situação.
create index if not exists payment_installments_due_idx
  on public.payment_installments (clinic_id, status, due_date);
create index if not exists payment_installments_client_idx
  on public.payment_installments (client_id, due_date);

alter table public.payment_installments enable row level security;

drop policy if exists "payment_installments_select" on public.payment_installments;
create policy "payment_installments_select" on public.payment_installments
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or exists (
      select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
      where p.user_id = (select auth.uid())
    )
  );

-- Escrita só pela função (que valida a soma e a permissão).
drop policy if exists "payment_installments_write" on public.payment_installments;

-- Entrada guardada também na venda/negociação, para as telas mostrarem rápido.
alter table public.plan_negotiations
  add column if not exists down_payment_cents integer not null default 0;
alter table public.direct_sales
  add column if not exists down_payment_cents integer not null default 0;

-- -----------------------------------------------------------------------------
-- save_payment_schedule: substitui o plano de cobrança de uma venda.
-- p_entries = [{ "kind":"entrada|parcela", "due_date":"YYYY-MM-DD",
--                "amount_cents":12345, "payment_method":"boleto" }, ...]
-- A soma TEM de fechar com o valor final da venda.
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
  v_sum integer;
  v_down integer;
  v_entradas int;
  v_user uuid := (select auth.uid());
  v_seq int := 0;
  v_e jsonb;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then
    raise exception 'ORIGIN_REQUIRED';
  end if;

  if p_negotiation_id is not null then
    select n.clinic_id, n.client_id, n.final_cents
      into v_clinic, v_client, v_final
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.clinic_id, s.client_id, s.final_cents
      into v_clinic, v_client, v_final
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  if v_clinic is null then raise exception 'SALE_NOT_FOUND'; end if;

  -- Quem negocia/fecha na unidade define o plano de pagamento.
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
      nullif(v_e->>'payment_method', ''),
      v_user
    );
  end loop;

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

-- Baixa de uma cobrança (o Financeiro completo vem no módulo próprio).
create or replace function public.mark_installment_paid(
  p_installment_id uuid,
  p_paid boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_user uuid := (select auth.uid());
begin
  select clinic_id into v_clinic
  from public.payment_installments where id = p_installment_id;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['unit_manager','receptionist']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.payment_installments
     set status = case when p_paid then 'paga' else 'em_aberto' end,
         paid_at = case when p_paid then now() else null end,
         paid_by = case when p_paid then v_user else null end
   where id = p_installment_id;
end;
$$;

grant execute on function public.mark_installment_paid(uuid, boolean)
  to authenticated;
