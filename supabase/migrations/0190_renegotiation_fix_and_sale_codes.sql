-- =============================================================================
-- 0190 — FIN2.1: correção da renegociação + código da venda
-- -----------------------------------------------------------------------------
-- BUG (relatado pelo dono no teste da 0189): a renegociação era gravada e
-- aparecia como "Aplicada", mas NADA acontecia — as parcelas antigas não viravam
-- `renegociada`, as novas não nasciam e o razão não recebia lançamento.
--
-- Causa: `save_renegotiation` já GRAVAVA a linha com status 'aplicada' quando
-- não precisava de autorização, e `apply_renegotiation` começava com
--   if v_r.status = 'aplicada' then return; end if;   -- guarda de idempotência
-- ou seja, a própria guarda barrava a primeira aplicação. Como a parcela nunca
-- saía de "em aberto", ela podia ser renegociada de novo, e de novo — o segundo
-- problema que o dono viu.
--
-- Correção: a guarda passa a olhar `applied_at` (que só existe DEPOIS de
-- aplicar), não o status. E `save_renegotiation` recusa cobrança que já está em
-- uma renegociação esperando autorização.
--
-- Também aqui:
--   • JUROS DO PARCELAMENTO na renegociação (Tabela Price): quanto mais tempo
--     para quitar, mais juros. Guardados no documento para a conta ser
--     auditável depois.
--   • CÓDIGO da venda (PT-00001 / VD-00001) e da renegociação (RN-00001), para
--     cada cobrança na ficha dizer a que se refere.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Status novo para as renegociações que ficaram pelo caminho
-- -----------------------------------------------------------------------------
alter table public.payment_renegotiations
  drop constraint if exists payment_renegotiations_status_check;
alter table public.payment_renegotiations
  add constraint payment_renegotiations_status_check
  check (status in ('aplicada', 'aguardando_autorizacao', 'recusada', 'cancelada'));

-- Juros do parcelamento (a conta fica no documento, não só na tela).
alter table public.payment_renegotiations
  add column if not exists monthly_interest_percent numeric(6,3) not null default 0,
  add column if not exists financed_interest_cents bigint not null default 0,
  add column if not exists code text;

comment on column public.payment_renegotiations.monthly_interest_percent is
  'Juros ao mês do NOVO parcelamento (Tabela Price). Quanto mais parcelas, '
  'mais juros — é o custo de esperar para receber.';

-- -----------------------------------------------------------------------------
-- 2) A correção da guarda de idempotência
-- -----------------------------------------------------------------------------
create or replace function public.apply_renegotiation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_e jsonb;
  v_seq int := 0;
begin
  select * into v_r from public.payment_renegotiations where id = p_id;
  if v_r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  -- 0190: a guarda é o applied_at. Antes olhava o status — que já nascia
  -- 'aplicada' — e por isso a função nunca fazia nada.
  if v_r.applied_at is not null then return; end if;
  if v_r.status = 'recusada' or v_r.status = 'cancelada' then return; end if;

  -- As antigas saem de cena, mas continuam na ficha. O lançamento de
  -- competência delas FICA como está: a receita do serviço foi reconhecida e
  -- continua valendo. (FIN6: a projeção de caixa tem de sair das PARCELAS em
  -- aberto, não dos lançamentos com status 'open', senão conta duas vezes.)
  update public.payment_installments
     set status = 'renegociada',
         renegotiated_by_id = p_id
   where id = any(v_r.source_installment_ids);

  for v_e in
    select * from jsonb_array_elements(coalesce(v_r.pending_entries, '[]'::jsonb))
  loop
    v_seq := v_seq + 1;
    insert into public.payment_installments
      (clinic_id, client_id, renegotiation_id, seq, kind, due_date,
       amount_cents, payment_method, created_by)
    values (
      v_r.clinic_id, v_r.client_id, p_id, v_seq,
      coalesce(v_e->>'kind', 'parcela'),
      (v_e->>'due_date')::date,
      (v_e->>'amount_cents')::int,
      nullif(v_e->>'payment_method', ''),
      v_r.created_by
    );
  end loop;

  if (v_r.original_fee_cents + v_r.original_interest_cents) > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_r.clinic_id, '4.1.01', current_date,
      v_r.original_fee_cents + v_r.original_interest_cents, 'inflow', 'open',
      'renegotiation_charges', p_id,
      'Multa e juros incorporados em renegociação', v_r.created_by
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge') do nothing;
  end if;

  if v_r.original_benefit_cents > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_r.clinic_id, '1.1.01', current_date, v_r.original_benefit_cents,
      'inflow', 'open', 'renegotiation_benefit', p_id,
      'Benefício perdido incorporado em renegociação', v_r.created_by
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge') do nothing;
  end if;

  if v_r.discount_cents > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_r.clinic_id, '1.9.02', current_date, v_r.discount_cents,
      'outflow', 'open', 'renegotiation_discount', p_id,
      'Desconto concedido em renegociação', v_r.created_by
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge') do nothing;
  elsif v_r.discount_cents < 0 then
    -- Acréscimo: juros do parcelamento da renegociação = receita financeira.
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_r.clinic_id, '4.1.01', current_date, -v_r.discount_cents,
      'inflow', 'open', 'renegotiation_surcharge', p_id,
      'Juros do parcelamento na renegociação', v_r.created_by
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge') do nothing;
  end if;

  update public.payment_renegotiations
     set status = 'aplicada', applied_at = now()
   where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) save_renegotiation: juros do parcelamento + trava do "renegociar duas vezes"
-- -----------------------------------------------------------------------------
create or replace function public.save_renegotiation(
  p_client_id uuid,
  p_installment_ids uuid[],
  p_entries jsonb,
  p_reason text default null,
  p_monthly_interest_percent numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_i record;
  v_b record;
  v_principal bigint := 0;
  v_benefit bigint := 0;
  v_fee bigint := 0;
  v_interest bigint := 0;
  v_original bigint := 0;
  v_new bigint := 0;
  v_discount bigint;
  v_pct numeric := 0;
  v_max_disc numeric;
  v_needs_auth boolean := false;
  v_is_manager boolean;
  v_id uuid;
  v_client_name text;
  v_user uuid := (select auth.uid());
  v_count int := 0;
  v_pending int;
begin
  if p_installment_ids is null or array_length(p_installment_ids, 1) is null then
    raise exception 'NO_INSTALLMENTS';
  end if;

  -- 0190: cobrança que já está numa renegociação esperando autorização não
  -- pode entrar em outra — senão a mesma dívida vira duas.
  select count(*) into v_pending
  from public.payment_renegotiations r
  where r.status = 'aguardando_autorizacao'
    and r.source_installment_ids && p_installment_ids;
  if v_pending > 0 then raise exception 'RENEGOTIATION_PENDING'; end if;

  for v_i in
    select * from public.payment_installments
    where id = any(p_installment_ids)
    order by due_date, seq
  loop
    if v_i.client_id is distinct from p_client_id then
      raise exception 'CLIENT_MISMATCH';
    end if;
    if v_clinic is null then
      v_clinic := v_i.clinic_id;
    elsif v_clinic <> v_i.clinic_id then
      raise exception 'CLINIC_MISMATCH';
    end if;
    if v_i.status not in ('em_aberto', 'parcial') then
      raise exception 'INSTALLMENT_NOT_OPEN';
    end if;

    select * into v_b from public.installment_balance(v_i.id, current_date);
    v_principal := v_principal + coalesce(v_b.principal_rem, 0);
    v_benefit   := v_benefit   + coalesce(v_b.benefit_rem, 0);
    v_fee       := v_fee       + coalesce(v_b.fee_rem, 0);
    v_interest  := v_interest  + coalesce(v_b.interest_rem, 0);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'NO_INSTALLMENTS'; end if;
  if not public.can_renegotiate(v_clinic) then raise exception 'NOT_ALLOWED'; end if;

  v_original := v_principal + v_benefit + v_fee + v_interest;

  select coalesce(sum((e->>'amount_cents')::bigint), 0) into v_new
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e;

  if v_new <= 0 then raise exception 'NO_ENTRIES'; end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
       where e->>'kind' = 'entrada') > 1 then
    raise exception 'MULTIPLE_DOWN_PAYMENTS';
  end if;

  v_discount := v_original - v_new;
  if v_original > 0 and v_discount > 0 then
    v_pct := round(v_discount::numeric * 100 / v_original, 2);
  end if;

  select coalesce(u.max_discount_percent, n.max_discount_percent)
    into v_max_disc
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_clinic
  left join public.commercial_rules n on n.clinic_id is null;

  v_is_manager := public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['unit_manager']::public.user_role[]);

  if v_max_disc is not null and v_pct > v_max_disc then
    v_needs_auth := true;
  end if;
  if v_discount > 0 and not v_is_manager then
    v_needs_auth := true;
  end if;

  insert into public.payment_renegotiations (
    clinic_id, client_id, source_installment_ids,
    original_principal_cents, original_benefit_cents,
    original_fee_cents, original_interest_cents, original_total_cents,
    discount_cents, new_total_cents, discount_percent, reason,
    monthly_interest_percent,
    financed_interest_cents,
    status, pending_entries, requires_authorization, created_by
  ) values (
    v_clinic, p_client_id, p_installment_ids,
    v_principal, v_benefit, v_fee, v_interest, v_original,
    v_discount, v_new, v_pct, nullif(btrim(p_reason), ''),
    coalesce(p_monthly_interest_percent, 0),
    greatest(0, -v_discount),
    case when v_needs_auth then 'aguardando_autorizacao' else 'aplicada' end,
    p_entries, v_needs_auth, v_user
  )
  returning id into v_id;

  if v_needs_auth then
    select full_name into v_client_name from public.clients where id = p_client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'Renegociação com desconto — autorizar?',
      coalesce(v_client_name, 'Cliente') || ' — desconto de ' ||
      to_char(v_discount / 100.0, 'FM999G999D00') || ' (' ||
      to_char(v_pct, 'FM999D00') || '%) sobre ' ||
      to_char(v_original / 100.0, 'FM999G999D00'),
      '/prontuarios/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  else
    perform public.apply_renegotiation(v_id);
  end if;

  return v_id;
end;
$$;

-- A assinatura mudou (ganhou os juros): a antiga vira ambiguidade (PGRST203).
drop function if exists public.save_renegotiation(uuid, uuid[], jsonb, text);

grant execute on function public.save_renegotiation(
  uuid, uuid[], jsonb, text, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) CÓDIGO da venda e da renegociação
-- -----------------------------------------------------------------------------
-- Cada cobrança na ficha precisa dizer a que se refere. Sequência única para os
-- três tipos: um código nunca se repete, mesmo entre unidades.
create sequence if not exists public.sale_code_seq;

alter table public.plan_negotiations add column if not exists code text;
alter table public.direct_sales add column if not exists code text;

create unique index if not exists plan_negotiations_code_key
  on public.plan_negotiations (code);
create unique index if not exists direct_sales_code_key
  on public.direct_sales (code);
create unique index if not exists payment_renegotiations_code_key
  on public.payment_renegotiations (code);

create or replace function public.assign_sale_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := tg_argv[0] || '-' ||
      lpad(nextval('public.sale_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists plan_negotiations_assign_code on public.plan_negotiations;
create trigger plan_negotiations_assign_code
  before insert on public.plan_negotiations
  for each row execute function public.assign_sale_code('PT');

drop trigger if exists direct_sales_assign_code on public.direct_sales;
create trigger direct_sales_assign_code
  before insert on public.direct_sales
  for each row execute function public.assign_sale_code('VD');

drop trigger if exists payment_renegotiations_assign_code
  on public.payment_renegotiations;
create trigger payment_renegotiations_assign_code
  before insert on public.payment_renegotiations
  for each row execute function public.assign_sale_code('RN');

-- Quem já existe ganha código pela ordem de criação.
do $$
declare
  r record;
begin
  for r in
    select id from public.plan_negotiations where code is null order by created_at
  loop
    update public.plan_negotiations
       set code = 'PT-' || lpad(nextval('public.sale_code_seq')::text, 5, '0')
     where id = r.id;
  end loop;
  for r in
    select id from public.direct_sales where code is null order by created_at
  loop
    update public.direct_sales
       set code = 'VD-' || lpad(nextval('public.sale_code_seq')::text, 5, '0')
     where id = r.id;
  end loop;
  for r in
    select id from public.payment_renegotiations where code is null
    order by created_at
  loop
    update public.payment_renegotiations
       set code = 'RN-' || lpad(nextval('public.sale_code_seq')::text, 5, '0')
     where id = r.id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5) Reparo: as renegociações que a 0189 gravou e nunca aplicou
-- -----------------------------------------------------------------------------
-- NÃO aplicamos retroativamente de propósito: o dono chegou a repetir a
-- renegociação da MESMA parcela, e aplicar todas criaria dívida duplicada.
-- Elas ficam registradas como canceladas, com o motivo — e ele refaz a que
-- valer. Nada foi cobrado do cliente por elas (nenhuma parcela mudou).
update public.payment_renegotiations
   set status = 'cancelada',
       authorization_note = coalesce(
         authorization_note,
         'Não chegou a ser aplicada por uma falha da migração 0189 — nenhuma '
         'cobrança foi alterada. Refazer a renegociação.')
 where applied_at is null
   and status = 'aplicada';

select count(*)::integer as renegociacoes_canceladas_no_reparo
from public.payment_renegotiations where status = 'cancelada';
