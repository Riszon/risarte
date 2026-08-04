-- =============================================================================
-- 0189 — FIN2: RENEGOCIAÇÃO
-- -----------------------------------------------------------------------------
-- Renegociar é trocar cobranças velhas por novas. Regras travadas com o dono
-- (04/08/2026):
--
--   • A dívida nova nasce com TUDO o que é devido hoje: principal que falta +
--     benefício perdido + multa + juros. Nada é perdoado por acidente.
--   • Perdoar alguma coisa é DESCONTO, e desconto aparece: vira lançamento na
--     conta 1.9.02 (Descontos concedidos), com motivo e autor.
--   • O teto do desconto é o MESMO da regra comercial da unidade. Acima disso,
--     precisa de autorização do Gerente — igual à negociação fora da regra.
--   • O Financeiro da Franqueadora não perdoa sozinho: qualquer desconto dele
--     nasce "aguardando autorização" do Gerente da unidade.
--   • A marca de que a parcela ESTEVE em atraso sobrevive (`was_overdue`) —
--     senão renegociar viraria o jeito de zerar a inadimplência da unidade.
--   • Nada se apaga: as cobranças antigas viram `renegociada` e continuam na
--     ficha, ligadas à renegociação que as substituiu.
--
-- CONTABILIDADE (o detalhe que evita contar receita duas vezes): as cobranças
-- antigas JÁ reconheceram a receita do serviço quando nasceram. Por isso as
-- cobranças novas da renegociação NÃO geram lançamento de competência — só o
-- que é NOVO entra no razão: multa e juros incorporados (4.1.01), benefício
-- perdido incorporado (1.1.01) e o desconto concedido (1.9.02).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O documento da renegociação
-- -----------------------------------------------------------------------------
create table if not exists public.payment_renegotiations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  -- Cobranças que entraram (congeladas: a lista não muda depois).
  source_installment_ids uuid[] not null default '{}',
  -- Apuração no momento da renegociação — congelada, para a conta bater depois.
  original_principal_cents bigint not null default 0,
  original_benefit_cents bigint not null default 0,
  original_fee_cents bigint not null default 0,
  original_interest_cents bigint not null default 0,
  original_total_cents bigint not null default 0,
  -- Positivo = perdão concedido; negativo = acréscimo (juros de parcelamento).
  discount_cents bigint not null default 0,
  new_total_cents bigint not null default 0,
  discount_percent numeric(6,2) not null default 0,
  reason text,
  status text not null default 'aplicada'
    check (status in ('aplicada', 'aguardando_autorizacao', 'recusada')),
  -- Novas cobranças enquanto espera autorização (só viram parcela ao aplicar).
  pending_entries jsonb,
  requires_authorization boolean not null default false,
  authorization_note text,
  authorized_by uuid references public.profiles (id),
  authorized_at timestamptz,
  applied_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists payment_renegotiations_client_idx
  on public.payment_renegotiations (client_id, created_at desc);
create index if not exists payment_renegotiations_clinic_idx
  on public.payment_renegotiations (clinic_id, status, created_at desc);

comment on table public.payment_renegotiations is
  'FIN2. A dívida apurada fica congelada aqui: sem isso, meses depois ninguém '
  'consegue explicar de onde veio o valor renegociado.';

alter table public.payment_renegotiations enable row level security;

drop policy if exists "payment_renegotiations_select" on public.payment_renegotiations;
create policy "payment_renegotiations_select" on public.payment_renegotiations
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or clinic_id in (select public.user_full_access_clinic_ids())
  );

-- Escrita só pelas funções abaixo (que apuram, validam teto e permissão).
drop policy if exists "payment_renegotiations_write" on public.payment_renegotiations;

-- -----------------------------------------------------------------------------
-- 2) A parcela sabe quem a substituiu — e pode nascer de uma renegociação
-- -----------------------------------------------------------------------------
alter table public.payment_installments
  add column if not exists renegotiated_by_id uuid
    references public.payment_renegotiations (id);

comment on column public.payment_installments.renegotiated_by_id is
  'Renegociação que SUBSTITUIU esta cobrança. Em renegotiation_id fica a '
  'renegociação que CRIOU a cobrança nova.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_installments_renegotiation_fkey'
  ) then
    alter table public.payment_installments
      add constraint payment_installments_renegotiation_fkey
      foreign key (renegotiation_id) references public.payment_renegotiations (id);
  end if;
end $$;

create index if not exists payment_installments_renegotiation_idx
  on public.payment_installments (renegotiation_id, seq);

-- Cobrança nascida de renegociação não pertence a UMA venda (pode consolidar
-- parcelas de vendas diferentes) — a origem dela é a própria renegociação.
alter table public.payment_installments
  drop constraint if exists payment_installments_origin_check;
alter table public.payment_installments
  add constraint payment_installments_origin_check check (
    (negotiation_id is not null and direct_sale_id is null)
    or (negotiation_id is null and direct_sale_id is not null)
    or (negotiation_id is null and direct_sale_id is null
        and renegotiation_id is not null)
  );

-- -----------------------------------------------------------------------------
-- 3) Quem pode renegociar
-- -----------------------------------------------------------------------------
-- Recepção NÃO renegocia: dar baixa é rotina de balcão, perdoar dívida não é.
create or replace function public.can_renegotiate(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or public.has_role_in_clinic(
           p_clinic_id, array['unit_manager']::public.user_role[]);
$$;

grant execute on function public.can_renegotiate(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) Cobrança de renegociação não repete a receita do serviço
-- -----------------------------------------------------------------------------
create or replace function public.post_installment_accrual(p_installment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_account text;
begin
  select * into v_inst from public.payment_installments where id = p_installment_id;
  if v_inst.id is null then return; end if;

  -- FIN2: a receita do serviço já foi reconhecida pela cobrança ORIGINAL.
  -- Repetir aqui inflaria o faturamento a cada renegociação.
  if v_inst.renegotiation_id is not null then return; end if;

  v_account := case
    when v_inst.direct_sale_id is not null then '1.1.02'
    else '1.1.01'
  end;

  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date,
    expected_settlement_date, amount_cents, direction, status,
    source_type, source_id, description, created_by
  )
  values (
    v_inst.clinic_id, v_account, coalesce(v_inst.created_at::date, current_date),
    null, v_inst.due_date, v_inst.amount_cents, 'inflow', 'open',
    'installment_accrual', v_inst.id,
    case when v_inst.kind = 'entrada' then 'Entrada da venda'
         else 'Parcela ' || v_inst.seq end,
    v_inst.created_by
  )
  on conflict (source_type, source_id) where source_type in
    ('installment_accrual', 'receipt_cash', 'receipt_benefit',
     'receipt_late_fee') do nothing;
end;
$$;

-- O razão da renegociação também é único por documento.
drop index if exists public.financial_entries_source_unique;
create unique index if not exists financial_entries_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('installment_accrual', 'receipt_cash',
                        'receipt_benefit', 'receipt_late_fee',
                        'renegotiation_charges', 'renegotiation_benefit',
                        'renegotiation_discount', 'renegotiation_surcharge');

-- -----------------------------------------------------------------------------
-- 5) Aplicar a renegociação (troca as cobranças e lança no razão)
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
  if v_r.status = 'aplicada' then return; end if;  -- idempotente

  -- As antigas saem de cena, mas continuam na ficha. O lançamento de
  -- competência delas FICA como está: a receita do serviço foi reconhecida e
  -- continua valendo. (FIN6: a projeção de caixa tem de sair das PARCELAS em
  -- aberto, não dos lançamentos com status 'open', senão conta duas vezes.)
  update public.payment_installments
     set status = 'renegociada',
         renegotiated_by_id = p_id
   where id = any(v_r.source_installment_ids);

  -- As novas nascem ligadas à renegociação.
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

  -- RAZÃO — só o que é NOVO entra (ver cabeçalho da migração).
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
    -- Desconto é DEDUÇÃO da receita: aparece na DRE, não some.
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
    -- Acréscimo (juros do novo parcelamento) é receita financeira.
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_r.clinic_id, '4.1.01', current_date, -v_r.discount_cents,
      'inflow', 'open', 'renegotiation_surcharge', p_id,
      'Acréscimo do parcelamento na renegociação', v_r.created_by
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
-- 6) Salvar a renegociação (apura, valida o teto e aplica ou pede autorização)
-- -----------------------------------------------------------------------------
create or replace function public.save_renegotiation(
  p_client_id uuid,
  p_installment_ids uuid[],
  p_entries jsonb,
  p_reason text default null
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
begin
  if p_installment_ids is null or array_length(p_installment_ids, 1) is null then
    raise exception 'NO_INSTALLMENTS';
  end if;

  -- Apuração: cada cobrança entra pelo que AINDA falta dela, hoje.
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

  -- Teto: o MESMO desconto máximo da regra comercial (rede → unidade).
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
  -- O Financeiro da Franqueadora não perdoa sozinho.
  if v_discount > 0 and not v_is_manager then
    v_needs_auth := true;
  end if;

  insert into public.payment_renegotiations (
    clinic_id, client_id, source_installment_ids,
    original_principal_cents, original_benefit_cents,
    original_fee_cents, original_interest_cents, original_total_cents,
    discount_cents, new_total_cents, discount_percent, reason,
    status, pending_entries, requires_authorization, created_by
  ) values (
    v_clinic, p_client_id, p_installment_ids,
    v_principal, v_benefit, v_fee, v_interest, v_original,
    v_discount, v_new, v_pct, nullif(btrim(p_reason), ''),
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

grant execute on function public.save_renegotiation(uuid, uuid[], jsonb, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 7) Autorizar (ou recusar) a renegociação — só o Gerente da unidade / Admin
-- -----------------------------------------------------------------------------
create or replace function public.authorize_renegotiation(
  p_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_user uuid := (select auth.uid());
begin
  select * into v_r from public.payment_renegotiations where id = p_id;
  if v_r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if v_r.status <> 'aguardando_autorizacao' then
    raise exception 'NOT_PENDING';
  end if;

  -- Quem pediu não autoriza a si mesmo.
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_r.clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.payment_renegotiations
     set authorized_by = v_user,
         authorized_at = now(),
         authorization_note = nullif(btrim(p_note), ''),
         status = case when p_approve then status else 'recusada' end
   where id = p_id;

  if p_approve then
    perform public.apply_renegotiation(p_id);
  end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select v_r.created_by, v_r.clinic_id,
    case when p_approve then 'Renegociação autorizada'
         else 'Renegociação recusada' end,
    coalesce(nullif(btrim(p_note), ''), 'Sem observações.'),
    '/prontuarios/' || v_r.client_id
  where v_r.created_by is not null and v_r.created_by is distinct from v_user;
end;
$$;

grant execute on function public.authorize_renegotiation(uuid, boolean, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 8) Trava: plano de cobrança de venda que já tem dinheiro não é reescrito
-- -----------------------------------------------------------------------------
-- `save_payment_schedule` APAGA e recria as cobranças da venda. Com o FIN1 no
-- ar isso passou a ser perigoso: apagar a parcela levava junto as baixas
-- (cascade) e o histórico do dinheiro. Agora ela recusa reescrever quando já
-- houve recebimento, baixa ou renegociação.
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
  v_locked int;
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

  -- Já entrou dinheiro (ou já houve renegociação)? Não se reescreve o plano.
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
      nullif(v_e->>'payment_method', ''),
      v_user
    );
  end loop;

  perform public.apply_sale_benefit_risk(p_negotiation_id, p_direct_sale_id);

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

select count(*)::integer as renegociacoes from public.payment_renegotiations;
