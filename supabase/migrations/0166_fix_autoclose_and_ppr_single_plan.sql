-- =============================================================================
-- Risarte Odontologia — Migration 0166 (CORREÇÃO URGENTE do fechamento
-- automático + uma pessoa só pode estar em UM plano do PPR+)
--
-- BUG (0165): o gatilho de fechamento automático também disparava no INSERT da
-- venda. Como a venda nasce com final_cents = 0 (os itens e o total só entram
-- no passo seguinte), TODA venda direta era fechada na hora — inclusive as que
-- tinham valor a pagar. Aqui o gatilho passa a disparar SÓ quando o total é
-- gravado (update) e SÓ quando a venda já tem itens.
--
-- Também reabre as vendas que foram fechadas por engano: dá para reconhecê-las
-- porque o gatilho não preenche QUEM assinou/confirmou.
--
-- E cria a trava do PPR+: uma pessoa não pode fazer parte de dois planos.
-- Idempotente.
-- =============================================================================

-- 1) Gatilho corrigido ---------------------------------------------------------
create or replace function public.direct_sale_autoclose_zero()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só fecha sozinha a venda que JÁ TEM ITENS e ficou sem valor a pagar.
  if new.cancelled is not true
     and new.closed_at is null
     and coalesce(new.final_cents, 0) <= 0
     and coalesce(new.status, '') <> 'concluida'
     and exists (select 1 from public.direct_sale_items i where i.sale_id = new.id)
  then
    update public.direct_sales set
      contract_signed = true,
      contract_signed_at = coalesce(contract_signed_at, now()),
      payment_issued = true,
      payment_issued_at = coalesce(payment_issued_at, now()),
      payment_confirmed = true,
      payment_confirmed_at = coalesce(payment_confirmed_at, now()),
      status = 'concluida',
      closed_at = now(),
      updated_at = now()
    where id = new.id;
  end if;
  return null;
end;
$$;

-- O INSERT sai do gatilho: no insert a venda ainda não tem itens nem total.
drop trigger if exists trg_direct_sale_autoclose_zero on public.direct_sales;
create trigger trg_direct_sale_autoclose_zero
  after update of final_cents on public.direct_sales
  for each row execute function public.direct_sale_autoclose_zero();

-- 2) Reabrir as vendas fechadas por engano -------------------------------------
-- Marca do erro: fechada, COM valor a pagar e sem NINGUÉM registrado como quem
-- assinou o contrato ou confirmou o pagamento (o gatilho não preenche isso).
update public.direct_sales set
  contract_signed = false,
  contract_signed_at = null,
  payment_issued = false,
  payment_issued_at = null,
  payment_confirmed = false,
  payment_confirmed_at = null,
  status = 'aguardando_fechamento',
  closed_at = null,
  updated_at = now()
where cancelled is not true
  and closed_at is not null
  and coalesce(final_cents, 0) > 0
  and contract_signed_by is null
  and payment_confirmed_by is null;

-- 3) PPR+: uma pessoa, um plano ------------------------------------------------
-- Um cliente não pode ser beneficiário (titular ou dependente) de duas adesões
-- vivas ao mesmo tempo. Para entrar em outro plano, cancela o atual primeiro.
create or replace function public.ppr_one_plan_per_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other uuid;
begin
  if new.left_at is not null then return new; end if;

  select b.membership_id into v_other
  from public.ppr_beneficiaries b
  join public.ppr_memberships m on m.id = b.membership_id
  where b.client_id = new.client_id
    and b.id is distinct from new.id
    and b.left_at is null
    and m.status <> 'cancelado'
  limit 1;

  if v_other is not null then
    raise exception 'ALREADY_IN_PPR';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ppr_one_plan_per_person on public.ppr_beneficiaries;
create trigger trg_ppr_one_plan_per_person
  before insert or update of client_id, left_at on public.ppr_beneficiaries
  for each row execute function public.ppr_one_plan_per_person();
