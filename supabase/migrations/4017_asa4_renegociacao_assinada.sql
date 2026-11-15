-- =============================================================================
-- 4017 — ASA4, entrega 3: A RENEGOCIAÇÃO ASSINADA PELA ZAPSIGN
-- (docs/integracao-asaas.md 19.28 a 19.28.14; aprovada pelo Jeferson em 15/11/2026)
-- =============================================================================
-- O QUE MUDA:
--   * Salvar a renegociação NÃO aplica mais: ela fica "aguardando assinatura"
--     (ou "aguardando autorização", e depois "aguardando assinatura"). Nada muda
--     nas parcelas antigas, e os boletos delas continuam valendo.
--   * O termo vai pela ZapSign (origem `payment_renegotiation`). Assinado: o
--     servidor cancela no Asaas os boletos vivos das antigas e chama
--     `renegotiation_apply_signed`, que aplica, marca o acordo assinado e liga a
--     cobrança automática das novas (pela regra da entrega 1, com a forma).
--   * Exceção: o PDF assinado anexado pelo Gerente ou pelo Admin Master.
--   * Prazo do termo: até 5 dias corridos, nunca depois do 1º vencimento novo.
--     Vencido → "expirada" (rotina diária). Recusado/cancelado → "não assinada".
--   * Pagamento numa parcela antiga antes da assinatura → "cancelada pelo
--     pagamento", com aviso para refazer.
--   * Cobrança externa nas antigas: o Gerente confirma que cancelou no painel do
--     Asaas antes do envio (a marcação externa é desfeita, na auditoria).
--   * Só entra parcela de venda fechada (contrato assinado) ou de acordo aplicado
--     (SALE_NOT_CLOSED). Meios das novas: os da venda direta nova (pix, boleto,
--     cartão, cartão parcelado pelo Asaas, dinheiro, permuta; a maquininha só com
--     a chave da rede). Permuta só com o Gerente ou o Admin Master e descrição.
--   * Grava para o Financeiro (19.28.13): a foto de cada parcela renegociada,
--     o desconto por componente (juros → multa → benefício → principal, a mesma
--     ordem da dispensa do recebimento), as vendas de origem e o histórico de
--     cada mudança de situação.
--   * A lista de boletos da venda (4015) mostra os boletos novos do acordo que
--     veio dela, SÓ do mesmo pagador; as antigas aparecem como substituídas.
--   * A trava da 4015a passa a contar também o acordo aguardando assinatura.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A RENEGOCIAÇÃO: estados e colunas novas
-- -----------------------------------------------------------------------------
alter table public.payment_renegotiations drop constraint if exists payment_renegotiations_status_check;
alter table public.payment_renegotiations add constraint payment_renegotiations_status_check
  check (status in ('aplicada', 'aguardando_autorizacao', 'recusada', 'cancelada',
                    'aguardando_assinatura', 'nao_assinada', 'expirada', 'cancelada_pagamento'));

alter table public.payment_renegotiations
  add column if not exists flow text not null default 'legado',
  add column if not exists boleto_mode text not null default 'mensal',
  add column if not exists sign_deadline date,
  add column if not exists origin_negotiation_ids uuid[] not null default '{}',
  add column if not exists origin_direct_sale_ids uuid[] not null default '{}',
  add column if not exists signature_package_id uuid references public.signature_packages (id) on delete set null,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by uuid references public.profiles (id),
  add column if not exists signed_via text,
  add column if not exists signed_at timestamptz,
  add column if not exists signed_file_path text,
  add column if not exists signed_attached_by uuid references public.profiles (id),
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references public.profiles (id),
  add column if not exists end_reason text,
  add column if not exists zapsign_cancel_pending boolean not null default false,
  add column if not exists external_confirmations jsonb not null default '[]'::jsonb,
  add column if not exists discount_interest_cents bigint not null default 0,
  add column if not exists discount_fee_cents bigint not null default 0,
  add column if not exists discount_benefit_cents bigint not null default 0,
  add column if not exists discount_principal_cents bigint not null default 0;
alter table public.payment_renegotiations drop constraint if exists payment_renegotiations_flow_check;
alter table public.payment_renegotiations add constraint payment_renegotiations_flow_check check (flow in ('legado', 'assinatura'));
alter table public.payment_renegotiations drop constraint if exists payment_renegotiations_boleto_mode_check;
alter table public.payment_renegotiations add constraint payment_renegotiations_boleto_mode_check check (boleto_mode in ('mensal', 'todos'));
alter table public.payment_renegotiations drop constraint if exists payment_renegotiations_signed_via_check;
alter table public.payment_renegotiations add constraint payment_renegotiations_signed_via_check
  check (signed_via is null or signed_via in ('zapsign', 'termo_anexado'));
create index if not exists payment_renegotiations_pending_idx on public.payment_renegotiations (status, sign_deadline)
  where status in ('aguardando_assinatura', 'aguardando_autorizacao');
create index if not exists payment_renegotiations_package_idx on public.payment_renegotiations (signature_package_id)
  where signature_package_id is not null;
comment on column public.payment_renegotiations.flow is
  '4017: ''legado'' = aplicada ao salvar (antes da 4017); ''assinatura'' = só aplica com o termo assinado.';

-- O histórico de cada mudança de situação (19.28.13 item 3): quem, quando, motivo.
create table if not exists public.payment_renegotiation_events (
  id uuid primary key default gen_random_uuid(),
  renegotiation_id uuid not null references public.payment_renegotiations (id) on delete cascade,
  status text not null,
  previous_status text,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists payment_renegotiation_events_idx on public.payment_renegotiation_events (renegotiation_id, created_at);
alter table public.payment_renegotiation_events enable row level security;
drop policy if exists "payment_renegotiation_events_select" on public.payment_renegotiation_events;
create policy "payment_renegotiation_events_select" on public.payment_renegotiation_events
  for select to authenticated
  using (exists (select 1 from public.payment_renegotiations r
                  where r.id = renegotiation_id and public.can_receive_payment(r.clinic_id)));

create or replace function public.payment_renegotiations_status_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.payment_renegotiation_events (renegotiation_id, status, previous_status, note, created_by)
    values (new.id, new.status, case when tg_op = 'UPDATE' then old.status end,
            nullif(current_setting('risarte.motivo_renegociacao', true), ''), (select auth.uid()));
  end if;
  return null;
end;
$$;
revoke execute on function public.payment_renegotiations_status_log() from public, anon, authenticated;
drop trigger if exists payment_renegotiations_status_log on public.payment_renegotiations;
create trigger payment_renegotiations_status_log
  after insert or update of status on public.payment_renegotiations
  for each row execute function public.payment_renegotiations_status_log();

-- A foto de cada parcela renegociada no dia do acordo (19.28.13 item 1).
create table if not exists public.payment_renegotiation_sources (
  id uuid primary key default gen_random_uuid(),
  renegotiation_id uuid not null references public.payment_renegotiations (id) on delete cascade,
  installment_id uuid not null references public.payment_installments (id),
  negotiation_id uuid,
  direct_sale_id uuid,
  origin_renegotiation_id uuid,
  seq integer,
  due_date date not null,
  amount_cents bigint not null,
  days_late integer not null default 0,
  principal_rem_cents bigint not null default 0,
  benefit_rem_cents bigint not null default 0,
  fee_rem_cents bigint not null default 0,
  interest_rem_cents bigint not null default 0,
  total_rem_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (renegotiation_id, installment_id)
);
create index if not exists payment_renegotiation_sources_inst_idx on public.payment_renegotiation_sources (installment_id);
alter table public.payment_renegotiation_sources enable row level security;
drop policy if exists "payment_renegotiation_sources_select" on public.payment_renegotiation_sources;
create policy "payment_renegotiation_sources_select" on public.payment_renegotiation_sources
  for select to authenticated
  using (exists (select 1 from public.payment_renegotiations r
                  where r.id = renegotiation_id and public.can_receive_payment(r.clinic_id)));

-- -----------------------------------------------------------------------------
-- 2) O DESCONTO POR COMPONENTE (19.28.14, 2a): juros → multa → benefício →
--    principal, a mesma ordem da dispensa do recebimento manual (4004/0188: o
--    pagamento cobre principal → benefício → multa → juros, e a dispensa leva o
--    que sobra, ou seja, cai primeiro nos juros).
-- -----------------------------------------------------------------------------
create or replace function public._desconto_por_componente(
  p_principal bigint, p_benefit bigint, p_fee bigint, p_interest bigint, p_desconto bigint
)
returns table (interest_cents bigint, fee_cents bigint, benefit_cents bigint, principal_cents bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rest bigint := greatest(0, coalesce(p_desconto, 0));
begin
  interest_cents := least(v_rest, greatest(0, coalesce(p_interest, 0)));  v_rest := v_rest - interest_cents;
  fee_cents      := least(v_rest, greatest(0, coalesce(p_fee, 0)));       v_rest := v_rest - fee_cents;
  benefit_cents  := least(v_rest, greatest(0, coalesce(p_benefit, 0)));   v_rest := v_rest - benefit_cents;
  principal_cents := least(v_rest, greatest(0, coalesce(p_principal, 0)));
  return next;
end;
$$;
revoke execute on function public._desconto_por_componente(bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public._desconto_por_componente(bigint, bigint, bigint, bigint, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) AS VENDAS DE ORIGEM (seguindo a cadeia: acordo de acordo herda as vendas)
-- -----------------------------------------------------------------------------
create or replace function public._renegotiation_origins(p_installment_ids uuid[])
returns table (negotiation_ids uuid[], direct_sale_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  with fontes as (
    select i.negotiation_id, i.direct_sale_id, r.origin_negotiation_ids, r.origin_direct_sale_ids
      from public.payment_installments i
      left join public.payment_renegotiations r on r.id = i.renegotiation_id
     where i.id = any(p_installment_ids)
  )
  select
    coalesce((select array_agg(distinct x) from (
      select f.negotiation_id x from fontes f where f.negotiation_id is not null
      union select unnest(f.origin_negotiation_ids) from fontes f) a where x is not null), '{}'::uuid[]),
    coalesce((select array_agg(distinct x) from (
      select f.direct_sale_id x from fontes f where f.direct_sale_id is not null
      union select unnest(f.origin_direct_sale_ids) from fontes f) b where x is not null), '{}'::uuid[]);
$$;
revoke execute on function public._renegotiation_origins(uuid[]) from public, anon, authenticated;

-- O pagador da cobrança (o responsável financeiro do cliente, ou o próprio).
create or replace function public._client_payer_guardian(p_client_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id from public.client_guardians g where g.client_id = p_client_id and g.is_financial limit 1;
$$;
revoke execute on function public._client_payer_guardian(uuid) from public, anon, authenticated;

-- A forma dos boletos de uma parcela: a do acordo, se é parcela de acordo.
create or replace function public._installment_boleto_mode(p_installment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when i.renegotiation_id is not null
              then coalesce((select r.boleto_mode from public.payment_renegotiations r where r.id = i.renegotiation_id), 'mensal')
              else public._sale_boleto_mode(i.negotiation_id, i.direct_sale_id) end
    from public.payment_installments i where i.id = p_installment_id;
$$;
revoke execute on function public._installment_boleto_mode(uuid) from public, anon, authenticated;

-- O prazo do termo (19.28.9, 1a): até 5 dias corridos, nunca depois do 1º vencimento novo.
create or replace function public._renegotiation_deadline(p_entries jsonb)
returns date
language sql
stable
set search_path = ''
as $$
  select least(public.today_br() + 5,
               (select min((e->>'due_date')::date) from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e) - 1);
$$;
revoke execute on function public._renegotiation_deadline(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) SALVAR: não aplica mais; confere venda fechada, meios, permuta e prazo
-- -----------------------------------------------------------------------------
drop function if exists public.save_renegotiation(uuid, uuid[], jsonb, text, numeric);
create or replace function public.save_renegotiation(
  p_client_id uuid,
  p_installment_ids uuid[],
  p_entries jsonb,
  p_reason text default null,
  p_monthly_interest_percent numeric default 0,
  p_boleto_mode text default null
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
  v_e jsonb;
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
  v_signed boolean;
  v_deadline date;
  v_origins record;
  v_mode text;
  v_has_boleto boolean;
  v_d record;
begin
  if p_installment_ids is null or array_length(p_installment_ids, 1) is null then
    raise exception 'NO_INSTALLMENTS';
  end if;

  -- A cobrança que já está num acordo que ainda não vale não entra em outro.
  select count(*) into v_pending
    from public.payment_renegotiations r
   where r.status in ('aguardando_autorizacao', 'aguardando_assinatura')
     and r.source_installment_ids && p_installment_ids;
  if v_pending > 0 then raise exception 'RENEGOTIATION_PENDING'; end if;

  for v_i in
    select * from public.payment_installments where id = any(p_installment_ids) order by due_date, seq
  loop
    if v_i.client_id is distinct from p_client_id then raise exception 'CLIENT_MISMATCH'; end if;
    if v_clinic is null then v_clinic := v_i.clinic_id;
    elsif v_clinic <> v_i.clinic_id then raise exception 'CLINIC_MISMATCH'; end if;
    if v_i.status not in ('em_aberto', 'parcial') then raise exception 'INSTALLMENT_NOT_OPEN'; end if;
    -- 19.28.12 B: só parcela de venda fechada (contrato assinado) ou de acordo aplicado.
    if v_i.renegotiation_id is not null then
      select r.status = 'aplicada' into v_signed from public.payment_renegotiations r where r.id = v_i.renegotiation_id;
    elsif v_i.negotiation_id is not null then
      select (cs.contract_signed or cs.closed_at is not null) into v_signed
        from public.commercial_sales cs where cs.negotiation_id = v_i.negotiation_id;
    elsif v_i.direct_sale_id is not null then
      select (s.contract_signed or s.closed_at is not null) and not coalesce(s.cancelled, false) into v_signed
        from public.direct_sales s where s.id = v_i.direct_sale_id;
    else
      v_signed := true;
    end if;
    if not coalesce(v_signed, false) then raise exception 'SALE_NOT_CLOSED'; end if;

    select * into v_b from public.installment_balance(v_i.id, public.today_br());
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
  if (select count(*) from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e where e->>'kind' = 'entrada') > 1 then
    raise exception 'MULTIPLE_DOWN_PAYMENTS';
  end if;

  -- 19.28.6: os meios da venda direta nova; permuta só Gerente/Admin, com descrição.
  for v_e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    if (v_e->>'due_date') is null or (v_e->>'amount_cents')::bigint <= 0 then raise exception 'NO_ENTRIES'; end if;
    if not public._direct_sale_method_ok(nullif(v_e->>'payment_method', '')) or nullif(v_e->>'payment_method', '') is null then
      raise exception 'METHOD_NOT_ALLOWED';
    end if;
    if v_e->>'payment_method' = 'permuta' then
      if not public._is_manager_or_admin(v_clinic) then raise exception 'PERMUTA_NOT_ALLOWED'; end if;
      if length(btrim(coalesce(v_e->>'descricao', ''))) < 3 then raise exception 'PERMUTA_DESCRIPTION_REQUIRED'; end if;
    end if;
  end loop;

  -- O cartão parcelado pelo Asaas segue as regras do bloco (4013).
  perform public._card_block_entries_check(p_entries);

  -- O prazo do termo: o 1º vencimento novo tem de ser depois de hoje.
  v_deadline := public._renegotiation_deadline(p_entries);
  if v_deadline is null or v_deadline < public.today_br() then raise exception 'FIRST_DUE_TOO_SOON'; end if;

  v_discount := v_original - v_new;
  if v_original > 0 and v_discount > 0 then
    v_pct := round(v_discount::numeric * 100 / v_original, 2);
  end if;
  select coalesce(u.max_discount_percent, n.max_discount_percent) into v_max_disc
    from (select 1) one
    left join public.commercial_rules u on u.clinic_id = v_clinic
    left join public.commercial_rules n on n.clinic_id is null;
  v_is_manager := public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[]);
  if v_max_disc is not null and v_pct > v_max_disc then v_needs_auth := true; end if;
  if v_discount > 0 and not v_is_manager then v_needs_auth := true; end if;

  -- As vendas de origem e a forma dos boletos (19.28.5).
  select * into v_origins from public._renegotiation_origins(p_installment_ids);
  v_has_boleto := exists (select 1 from jsonb_array_elements(p_entries) e where e->>'payment_method' = 'boleto');
  if p_boleto_mode is not null and p_boleto_mode not in ('mensal', 'todos') then raise exception 'INVALID_MODE'; end if;
  v_mode := case
    when not v_has_boleto then 'mensal'
    when p_boleto_mode is not null then p_boleto_mode
    -- já vem marcada a forma da venda de origem; formas diferentes → "Um boleto por mês"
    when (select bool_and(m = 'todos') from (
            select public._sale_boleto_mode(x, null) m from unnest(v_origins.negotiation_ids) x
            union all select public._sale_boleto_mode(null, y) from unnest(v_origins.direct_sale_ids) y) t) then 'todos'
    else 'mensal' end;
  select * into v_d from public._desconto_por_componente(v_principal, v_benefit, v_fee, v_interest, v_discount);

  insert into public.payment_renegotiations (
    clinic_id, client_id, source_installment_ids,
    original_principal_cents, original_benefit_cents, original_fee_cents, original_interest_cents, original_total_cents,
    discount_cents, new_total_cents, discount_percent, reason, monthly_interest_percent, financed_interest_cents,
    status, pending_entries, requires_authorization, created_by,
    flow, boleto_mode, sign_deadline, origin_negotiation_ids, origin_direct_sale_ids,
    discount_interest_cents, discount_fee_cents, discount_benefit_cents, discount_principal_cents
  ) values (
    v_clinic, p_client_id, p_installment_ids,
    v_principal, v_benefit, v_fee, v_interest, v_original,
    v_discount, v_new, v_pct, nullif(btrim(p_reason), ''), coalesce(p_monthly_interest_percent, 0), greatest(0, -v_discount),
    case when v_needs_auth then 'aguardando_autorizacao' else 'aguardando_assinatura' end,
    p_entries, v_needs_auth, v_user,
    'assinatura', v_mode, v_deadline, v_origins.negotiation_ids, v_origins.direct_sale_ids,
    coalesce(v_d.interest_cents, 0), coalesce(v_d.fee_cents, 0), coalesce(v_d.benefit_cents, 0), coalesce(v_d.principal_cents, 0)
  )
  returning id into v_id;

  -- A foto de cada parcela, no dia (19.28.13 item 1).
  insert into public.payment_renegotiation_sources (
    renegotiation_id, installment_id, negotiation_id, direct_sale_id, origin_renegotiation_id, seq, due_date, amount_cents,
    days_late, principal_rem_cents, benefit_rem_cents, fee_rem_cents, interest_rem_cents, total_rem_cents)
  select v_id, i.id, i.negotiation_id, i.direct_sale_id, i.renegotiation_id, i.seq, i.due_date, i.amount_cents,
         coalesce(b.days_late, 0), coalesce(b.principal_rem, 0), coalesce(b.benefit_rem, 0), coalesce(b.fee_rem, 0),
         coalesce(b.interest_rem, 0), coalesce(b.total_rem, 0)
    from public.payment_installments i
    cross join lateral public.installment_balance(i.id, public.today_br()) b
   where i.id = any(p_installment_ids);

  if v_needs_auth then
    select full_name into v_client_name from public.clients where id = p_client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'Renegociação com desconto — autorizar?',
      coalesce(v_client_name, 'Cliente') || ' — desconto de ' || to_char(v_discount / 100.0, 'FM999G999D00') || ' (' ||
      to_char(v_pct, 'FM999D00') || '%) sobre ' || to_char(v_original / 100.0, 'FM999G999D00'),
      '/prontuarios/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'unit_manager' and ucr.user_id is distinct from v_user;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_renegotiation(uuid, uuid[], jsonb, text, numeric, text) from public, anon, authenticated;
grant execute on function public.save_renegotiation(uuid, uuid[], jsonb, text, numeric, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) AUTORIZAR: aprovada vai para "aguardando assinatura" (não aplica)
-- -----------------------------------------------------------------------------
create or replace function public.authorize_renegotiation(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_user uuid := (select auth.uid());
  v_deadline date;
begin
  select * into v_r from public.payment_renegotiations where id = p_id for update;
  if v_r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if v_r.status <> 'aguardando_autorizacao' then raise exception 'NOT_PENDING'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_r.clinic_id, array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_approve then
    v_deadline := public._renegotiation_deadline(v_r.pending_entries);
    if v_deadline is null or v_deadline < public.today_br() then raise exception 'FIRST_DUE_TOO_SOON'; end if;
  end if;
  perform set_config('risarte.motivo_renegociacao', coalesce(nullif(btrim(p_note), ''), ''), true);
  update public.payment_renegotiations
     set authorized_by = v_user, authorized_at = now(),
         authorization_note = nullif(btrim(p_note), ''),
         status = case when p_approve
                       then case when flow = 'assinatura' then 'aguardando_assinatura' else status end
                       else 'recusada' end,
         sign_deadline = case when p_approve then v_deadline else sign_deadline end
   where id = p_id;
  -- O acordo antigo (antes da 4017) continua aplicando na autorização.
  if p_approve and v_r.flow = 'legado' then perform public.apply_renegotiation(p_id); end if;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select v_r.created_by, v_r.clinic_id,
         case when p_approve then 'Renegociação autorizada: envie o termo' else 'Renegociação recusada' end,
         coalesce(nullif(btrim(p_note), ''), 'Sem observações.'),
         '/prontuarios/' || v_r.client_id
   where v_r.created_by is not null and v_r.created_by is distinct from v_user;
end;
$$;
revoke execute on function public.authorize_renegotiation(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.authorize_renegotiation(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) ANTES DE ENVIAR: os boletos que serão cancelados e as cobranças externas
-- -----------------------------------------------------------------------------
create or replace function public._renegotiation_can_handle(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.payment_renegotiations r
                  where r.id = p_id and (public.can_renegotiate(r.clinic_id) or r.created_by = (select auth.uid())));
$$;
revoke execute on function public._renegotiation_can_handle(uuid) from public, anon, authenticated;

create or replace function public.renegotiation_send_check(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.payment_renegotiations%rowtype;
begin
  select * into r from public.payment_renegotiations where id = p_id;
  if r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if not public._renegotiation_can_handle(p_id) then raise exception 'NOT_ALLOWED'; end if;
  return jsonb_build_object(
    'status', r.status,
    'prazo', r.sign_deadline,
    'vencido', r.sign_deadline is not null and r.sign_deadline < public.today_br(),
    'boletos_vivos', (select count(*) from public.charges c
                       where c.payment_installment_id = any(r.source_installment_ids) and not c.is_external
                         and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')),
    'externas', coalesce((select jsonb_agg(jsonb_build_object(
                    'charge_id', c.id, 'seq', i.seq, 'vencimento', i.due_date, 'valor', i.amount_cents,
                    'nota', c.external_note) order by i.due_date)
                  from public.charges c join public.payment_installments i on i.id = c.payment_installment_id
                 where c.payment_installment_id = any(r.source_installment_ids)
                   and c.is_external and c.status = 'externa'), '[]'::jsonb));
end;
$$;
revoke execute on function public.renegotiation_send_check(uuid) from public, anon, authenticated;
grant execute on function public.renegotiation_send_check(uuid) to authenticated;

-- O Gerente (ou o Admin Master) confirma que cancelou no painel do Asaas (19.28.10 ponto 1).
create or replace function public.renegotiation_confirm_external(p_id uuid, p_charge_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_renegotiations%rowtype;
  v_user uuid := (select auth.uid());
  v_n int := 0;
  c record;
begin
  select * into r from public.payment_renegotiations where id = p_id for update;
  if r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if r.status not in ('aguardando_assinatura', 'aguardando_autorizacao') then raise exception 'NOT_PENDING'; end if;
  if not public._is_manager_or_admin(r.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  for c in
    select ch.* from public.charges ch
     where ch.id = any(p_charge_ids) and ch.payment_installment_id = any(r.source_installment_ids)
       and ch.is_external and ch.status = 'externa'
     for update
  loop
    update public.charges set status = 'cancelada', cancelled_at = now(), cancelled_by = v_user,
           cancel_reason = 'cancelada no painel do Asaas para a renegociação'
     where id = c.id;
    v_n := v_n + 1;
    update public.payment_renegotiations
       set external_confirmations = external_confirmations || jsonb_build_array(jsonb_build_object(
             'charge_id', c.id, 'confirmado_por', v_user, 'confirmado_em', now(), 'nota', c.external_note))
     where id = p_id;
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_user, r.clinic_id, 'update', 'renegotiation_external_confirm', p_id::text,
            jsonb_build_object('charge_id', c.id, 'texto', 'Cancelei no painel do Asaas'));
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.renegotiation_confirm_external(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.renegotiation_confirm_external(uuid, uuid[]) to authenticated;

-- O servidor grava o envio (depois de criar o pacote na ZapSign).
create or replace function public.renegotiation_mark_sent(p_id uuid, p_package_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_renegotiations%rowtype;
begin
  select * into r from public.payment_renegotiations where id = p_id for update;
  if r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if r.status <> 'aguardando_assinatura' then raise exception 'NOT_PENDING'; end if;
  if r.sign_deadline < public.today_br() then raise exception 'DEADLINE_PASSED'; end if;
  if exists (select 1 from public.charges c where c.payment_installment_id = any(r.source_installment_ids)
              and c.is_external and c.status = 'externa') then
    raise exception 'EXTERNAL_NOT_CONFIRMED';
  end if;
  update public.payment_renegotiations
     set signature_package_id = p_package_id, sent_at = coalesce(sent_at, now()), sent_by = coalesce(sent_by, p_actor)
   where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_actor, r.clinic_id, 'update', 'renegotiation_sent', p_id::text, jsonb_build_object('package_id', p_package_id));
end;
$$;
revoke execute on function public.renegotiation_mark_sent(uuid, uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) ASSINADO: aplica (o servidor já cancelou no Asaas os boletos vivos)
-- -----------------------------------------------------------------------------
create or replace function public.renegotiation_apply_signed(p_id uuid, p_via text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_renegotiations%rowtype;
  v_users uuid[];
begin
  select * into r from public.payment_renegotiations where id = p_id for update;
  if r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if r.applied_at is not null then return; end if;  -- aviso repetido da ZapSign
  if r.status <> 'aguardando_assinatura' then raise exception 'NOT_PENDING'; end if;
  if p_via not in ('zapsign', 'termo_anexado') then raise exception 'INVALID_VIA'; end if;
  if exists (select 1 from public.payment_installments i
              where i.id = any(r.source_installment_ids) and i.status not in ('em_aberto', 'parcial')) then
    raise exception 'SOURCE_CHANGED';
  end if;
  update public.payment_renegotiations
     set signed_via = p_via, signed_at = now(),
         contract_signed = true, contract_signed_at = now(), contract_signed_by = p_actor
   where id = p_id;
  perform public.apply_renegotiation(p_id);
  -- A cobrança automática das novas (a regra da entrega 1, com a forma do acordo).
  insert into public.sale_auto_charges (clinic_id, renegotiation_id, source)
  values (r.clinic_id, p_id, 'renegociacao')
  on conflict (renegotiation_id) do nothing;
  select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
   where u.clinic_id = r.clinic_id and u.role = 'unit_manager';
  perform public._notify_users('renegociacao_assinada', p_id::text, v_users || array[r.created_by], r.clinic_id,
    'Renegociação assinada',
    'O termo foi assinado. As parcelas antigas foram substituídas e as novas cobranças estão sendo criadas.',
    '/prontuarios/' || r.client_id::text);
end;
$$;
revoke execute on function public.renegotiation_apply_signed(uuid, text, uuid) from public, anon, authenticated;

-- A pasta privada dos termos assinados anexados (exceção 2a). VER = quem lida
-- com pagamento na unidade; ENVIAR = o Gerente ou o Admin Master; APAGAR = ninguém.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('renegociacoes', 'renegociacoes', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "renegociacoes_select" on storage.objects;
create policy "renegociacoes_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'renegociacoes' and public.clinic_of_storage_path(name) is not null
         and public.can_receive_payment(public.clinic_of_storage_path(name)));
drop policy if exists "renegociacoes_insert" on storage.objects;
create policy "renegociacoes_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'renegociacoes' and public.clinic_of_storage_path(name) is not null
              and public._is_manager_or_admin(public.clinic_of_storage_path(name)));

-- O termo assinado anexado (exceção 2a): só o Gerente ou o Admin Master.
create or replace function public.renegotiation_attach_signed(p_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_renegotiations%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into r from public.payment_renegotiations where id = p_id for update;
  if r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if r.status <> 'aguardando_assinatura' then raise exception 'NOT_PENDING'; end if;
  if not public._is_manager_or_admin(r.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_path is null or public.clinic_of_storage_path(p_path) is distinct from r.clinic_id
     or not exists (select 1 from storage.objects o where o.bucket_id = 'renegociacoes' and o.name = p_path) then
    raise exception 'FILE_REQUIRED';
  end if;
  if exists (select 1 from public.charges c where c.payment_installment_id = any(r.source_installment_ids)
              and c.is_external and c.status = 'externa') then
    raise exception 'EXTERNAL_NOT_CONFIRMED';
  end if;
  update public.payment_renegotiations set signed_file_path = p_path, signed_attached_by = v_user where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, r.clinic_id, 'update', 'renegotiation_term_attached', p_id::text, jsonb_build_object('arquivo', p_path));
end;
$$;
revoke execute on function public.renegotiation_attach_signed(uuid, text) from public, anon, authenticated;
grant execute on function public.renegotiation_attach_signed(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) O FIM SEM ASSINATURA: recusado, cancelado, expirado ou cancelado por quem negociou
-- -----------------------------------------------------------------------------
create or replace function public._renegotiation_end(p_id uuid, p_status text, p_reason text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_renegotiations%rowtype;
  v_users uuid[];
  v_titulo text;
begin
  select * into r from public.payment_renegotiations where id = p_id for update;
  if r.id is null or r.status not in ('aguardando_assinatura', 'aguardando_autorizacao') then return; end if;
  perform set_config('risarte.motivo_renegociacao', coalesce(p_reason, ''), true);
  update public.payment_renegotiations
     set status = p_status, ended_at = now(), ended_by = p_actor, end_reason = p_reason,
         zapsign_cancel_pending = (signature_package_id is not null and p_status <> 'nao_assinada')
   where id = p_id;
  select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
   where u.clinic_id = r.clinic_id and u.role = 'unit_manager';
  v_titulo := case p_status
    when 'expirada' then 'Renegociação expirada sem assinatura: as parcelas antigas continuam valendo'
    when 'cancelada_pagamento' then 'O cliente pagou uma parcela da renegociação antes de assinar: refaça o acordo'
    when 'nao_assinada' then 'Termo de renegociação recusado ou cancelado na ZapSign'
    else 'Renegociação cancelada antes da assinatura' end;
  perform public._notify_users('renegociacao_' || p_status, p_id::text, v_users || array[r.created_by], r.clinic_id,
    v_titulo, coalesce(p_reason, 'Nada mudou nas parcelas antigas.'), '/prontuarios/' || r.client_id::text);
end;
$$;
revoke execute on function public._renegotiation_end(uuid, text, text, uuid) from public, anon, authenticated;

-- Quem negociou (ou quem pode renegociar) cancela o acordo que ainda não vale.
create or replace function public.renegotiation_cancel_pending(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._renegotiation_can_handle(p_id) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.payment_renegotiations r
                  where r.id = p_id and r.status in ('aguardando_assinatura', 'aguardando_autorizacao')) then
    raise exception 'NOT_PENDING';
  end if;
  perform public._renegotiation_end(p_id, 'cancelada', btrim(p_reason), (select auth.uid()));
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  select (select auth.uid()), r.clinic_id, 'update', 'renegotiation_cancel_pending', p_id::text, jsonb_build_object('motivo', btrim(p_reason))
    from public.payment_renegotiations r where r.id = p_id;
end;
$$;
revoke execute on function public.renegotiation_cancel_pending(uuid, text) from public, anon, authenticated;
grant execute on function public.renegotiation_cancel_pending(uuid, text) to authenticated;

-- O que a ZapSign avisou (o servidor chama): recusado/cancelado → não assinada; vencido → expirada.
create or replace function public.renegotiation_signature_status(p_package_id uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select r.id into v_id from public.payment_renegotiations r where r.signature_package_id = p_package_id;
  if v_id is null then return null; end if;
  if p_status in ('refused', 'cancelled') then
    perform public._renegotiation_end(v_id, 'nao_assinada', 'O termo foi recusado ou cancelado na ZapSign.', null);
  elsif p_status = 'expired' then
    perform public._renegotiation_end(v_id, 'expirada', 'O link de assinatura venceu.', null);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.renegotiation_signature_status(uuid, text) from public, anon, authenticated;

-- A rotina diária: expira o termo vencido.
create or replace function public.renegotiation_expire_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  r record;
begin
  for r in select id from public.payment_renegotiations
            where status = 'aguardando_assinatura' and sign_deadline < public.today_br()
  loop
    perform public._renegotiation_end(r.id, 'expirada', 'O prazo do termo venceu sem assinatura. Nada mudou nas parcelas antigas.', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.renegotiation_expire_run() from public, anon, authenticated;

-- Os termos que o servidor ainda precisa cancelar na ZapSign.
create or replace function public._renegotiations_zapsign_to_cancel()
returns table (renegotiation_id uuid, package_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.signature_package_id from public.payment_renegotiations r
   where r.zapsign_cancel_pending and r.signature_package_id is not null;
$$;
revoke execute on function public._renegotiations_zapsign_to_cancel() from public, anon, authenticated;

create or replace function public._renegotiation_zapsign_cancelled(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_renegotiations set zapsign_cancel_pending = false where id = p_id;
$$;
revoke execute on function public._renegotiation_zapsign_cancelled(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) PAGAMENTO NUMA PARCELA ANTIGA ANTES DA ASSINATURA (19.28.9, 5a)
-- -----------------------------------------------------------------------------
create or replace function public.payment_receipts_cancel_pending_renegotiation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.reversal_of is not null or coalesce(new.reversed, false) then return null; end if;
  for r in select id from public.payment_renegotiations
            where status in ('aguardando_assinatura', 'aguardando_autorizacao')
              and new.installment_id = any(source_installment_ids)
  loop
    perform public._renegotiation_end(r.id, 'cancelada_pagamento',
      'Foi registrado um pagamento numa parcela do acordo antes da assinatura. O acordo foi cancelado; refaça com o saldo de hoje.',
      (select auth.uid()));
  end loop;
  return null;
end;
$$;
revoke execute on function public.payment_receipts_cancel_pending_renegotiation() from public, anon, authenticated;
drop trigger if exists payment_receipts_cancel_pending_renegotiation on public.payment_receipts;
create trigger payment_receipts_cancel_pending_renegotiation
  after insert on public.payment_receipts
  for each row execute function public.payment_receipts_cancel_pending_renegotiation();

-- A tela da baixa avisa (o aviso não muda quem pode dar baixa).
create or replace function public.installment_pending_renegotiation(p_installment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'codigo', r.code, 'status', r.status, 'prazo', r.sign_deadline)
    from public.payment_renegotiations r
    join public.payment_installments i on i.id = p_installment_id
   where r.status in ('aguardando_assinatura', 'aguardando_autorizacao')
     and p_installment_id = any(r.source_installment_ids)
     and public.can_receive_payment(i.clinic_id)
   limit 1;
$$;
revoke execute on function public.installment_pending_renegotiation(uuid) from public, anon, authenticated;
grant execute on function public.installment_pending_renegotiation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 10) A COBRANÇA AUTOMÁTICA DAS PARCELAS NOVAS
-- -----------------------------------------------------------------------------
alter table public.sale_auto_charges add column if not exists renegotiation_id uuid unique references public.payment_renegotiations (id);
alter table public.sale_auto_charges drop constraint if exists sale_auto_charges_source_check;
alter table public.sale_auto_charges add constraint sale_auto_charges_source_check
  check (source in ('assinatura', 'venda_direta', 'renegociacao'));
alter table public.sale_auto_charges drop constraint if exists sale_auto_charges_check;
alter table public.sale_auto_charges drop constraint if exists sale_auto_charges_origin_check;
alter table public.sale_auto_charges add constraint sale_auto_charges_origin_check
  check ((negotiation_id is not null)::int + (direct_sale_id is not null)::int + (renegotiation_id is not null)::int = 1);

create or replace function public._auto_charge_due(
  p_clinic_id uuid, p_negotiation_id uuid, p_direct_sale_id uuid, p_limit integer, p_renegotiation_id uuid
)
returns table (installment_id uuid, clinic_id uuid, billing_type text, due_date date, origem text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.clinic_id, public._auto_charge_billing(i.id), i.due_date, m.source
    from public.payment_installments i
    join public.sale_auto_charges m
      on (m.negotiation_id is not null and m.negotiation_id = i.negotiation_id and i.renegotiation_id is null)
      or (m.direct_sale_id is not null and m.direct_sale_id = i.direct_sale_id and i.renegotiation_id is null)
      or (m.renegotiation_id is not null and m.renegotiation_id = i.renegotiation_id)
   where i.status in ('em_aberto', 'parcial')
     and coalesce(i.grace_days, 0) = 0
     and public._auto_charge_billing(i.id) is not null
     -- 4015: na forma 2, todos os boletos (sem prazo); 4017: a forma do acordo.
     and (i.due_date <= public.today_br() + public._auto_charge_window()
          or (public._auto_charge_billing(i.id) = 'BOLETO' and public._installment_boleto_mode(i.id) = 'todos'))
     and not public._installment_has_active_charge(i.id, false)
     and not public._auto_charge_cancelled_by_hand(i.id)
     and (p_clinic_id is null or i.clinic_id = p_clinic_id)
     and (p_negotiation_id is null or i.negotiation_id = p_negotiation_id)
     and (p_direct_sale_id is null or i.direct_sale_id = p_direct_sale_id)
     and (p_renegotiation_id is null or i.renegotiation_id = p_renegotiation_id)
     and public.central_is_ready(i.clinic_id)
   order by i.due_date, i.seq
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke execute on function public._auto_charge_due(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated;

create or replace function public._charge_prepare_system(
  p_installment_id uuid, p_billing_type text, p_origin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v record;
  v_id uuid;
begin
  select i.clinic_id into v_clinic from public.payment_installments i where i.id = p_installment_id for update;
  if v_clinic is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not exists (select 1 from public._auto_charge_due(v_clinic, null, null, 1000, null) d where d.installment_id = p_installment_id) then
    raise exception 'NOT_DUE';
  end if;
  select * into v from public._charge_compute(p_installment_id, p_billing_type, null);
  if v.error_code is not null then raise exception '%', v.error_code; end if;
  insert into public.charges (
    clinic_id, gateway_account_id, source_type, payment_installment_id, client_id,
    payer_kind, payer_guardian_id, billing_type, value_cents, discount_cents,
    fine_percent, fine_cents, interest_percent, due_date, is_overdue_reissue, status, created_by, auto_origin, via_carne
  ) values (
    v_clinic, v.gateway_account_id, 'installment', p_installment_id, v.client_id,
    v.payer_kind, v.payer_guardian_id, v.billing_type, v.value_cents, v.discount_cents,
    v.fine_percent, v.fine_cents, v.interest_percent, v.due_date, v.is_overdue_reissue, 'emitindo', null, p_origin,
    -- 4015/4017: o boleto da forma 2 sai pelo cadastro do carnê (a forma do acordo, se é parcela de acordo).
    v.billing_type = 'BOLETO' and public._installment_boleto_mode(p_installment_id) = 'todos'
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._charge_prepare_system(uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11) A LISTA DE BOLETOS DA VENDA (19.28.5 e 19.28.11): os boletos novos do
--     acordo que veio dela, SÓ do mesmo pagador
-- -----------------------------------------------------------------------------
alter table public.boleto_lists add column if not exists payer_guardian_id uuid references public.client_guardians (id) on delete set null;
alter table public.boleto_lists add column if not exists payer_set boolean not null default false;
-- As listas de antes: o pagador dos boletos da venda (o mais recente).
update public.boleto_lists l
   set payer_guardian_id = (select c.payer_guardian_id from public.charges c
                              join public.payment_installments i on i.id = c.payment_installment_id
                             where c.billing_type = 'BOLETO'
                               and ((l.negotiation_id is not null and i.negotiation_id = l.negotiation_id)
                                 or (l.direct_sale_id is not null and i.direct_sale_id = l.direct_sale_id))
                             order by c.created_at desc limit 1),
       payer_set = true
 where not l.payer_set;

-- As parcelas que aparecem na lista de uma venda: as dela e as dos acordos que vieram dela.
create or replace function public._boleto_list_installments(p_list_id uuid)
returns table (installment_id uuid, from_agreement boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, false from public.boleto_lists l
    join public.payment_installments i
      on (l.negotiation_id is not null and i.negotiation_id = l.negotiation_id)
      or (l.direct_sale_id is not null and i.direct_sale_id = l.direct_sale_id)
   where l.id = p_list_id
  union all
  select i.id, true from public.boleto_lists l
    join public.payment_renegotiations r
      on (l.negotiation_id is not null and l.negotiation_id = any(r.origin_negotiation_ids))
      or (l.direct_sale_id is not null and l.direct_sale_id = any(r.origin_direct_sale_ids))
    join public.payment_installments i on i.renegotiation_id = r.id
   where l.id = p_list_id and r.status = 'aplicada';
$$;
revoke execute on function public._boleto_list_installments(uuid) from public, anon, authenticated;

create or replace function public.boleto_list_issue(p_negotiation_id uuid, p_direct_sale_id uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_ultimo date;
  v_id uuid;
  v_user uuid := (select auth.uid());
  v_todos boolean;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  if not public._boleto_mode_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  -- A forma 2 da venda, ou de um acordo que veio dela (4017).
  v_todos := public._sale_boleto_mode(p_negotiation_id, p_direct_sale_id) = 'todos'
    or exists (select 1 from public.payment_renegotiations r
                where r.status = 'aplicada' and r.boleto_mode = 'todos'
                  and ((p_negotiation_id is not null and p_negotiation_id = any(r.origin_negotiation_ids))
                    or (p_direct_sale_id is not null and p_direct_sale_id = any(r.origin_direct_sale_ids))));
  if not v_todos then raise exception 'NOT_FORMA_2'; end if;
  if length(coalesce(p_token_hash, '')) <> 64 then raise exception 'INVALID_TOKEN'; end if;
  select min(i.clinic_id::text)::uuid, min(i.client_id::text)::uuid, max(i.due_date) into v_clinic, v_client, v_ultimo
    from public.payment_installments i
   where i.payment_method = 'boleto' and i.status <> 'cancelada'
     and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id)
       or i.renegotiation_id in (select r.id from public.payment_renegotiations r
                                  where r.status = 'aplicada'
                                    and ((p_negotiation_id is not null and p_negotiation_id = any(r.origin_negotiation_ids))
                                      or (p_direct_sale_id is not null and p_direct_sale_id = any(r.origin_direct_sale_ids)))));
  if v_clinic is null then raise exception 'NO_BOLETO'; end if;
  update public.boleto_lists set revoked_at = now(), revoked_by = v_user
   where revoked_at is null
     and ((p_negotiation_id is not null and negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id));
  insert into public.boleto_lists (clinic_id, negotiation_id, direct_sale_id, client_id, token_hash, created_by, expires_at,
                                   payer_guardian_id, payer_set)
  values (v_clinic, p_negotiation_id, p_direct_sale_id, v_client, p_token_hash, v_user, v_ultimo + 5,
          public._client_payer_guardian(v_client), true)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'boleto_list', v_id::text, jsonb_build_object('expira', v_ultimo + 5));
  return v_id;
end;
$$;
revoke execute on function public.boleto_list_issue(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.boleto_list_issue(uuid, uuid, text) to authenticated;

create or replace function public._boleto_list_read(p_token_hash text, p_ip_hash text, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.boleto_lists%rowtype;
  v_nome text;
  v_boletos jsonb;
begin
  if (select count(*) from public.boleto_list_misses m
       where m.ip_hash = coalesce(p_ip_hash, '-') and m.missed_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('erro', 'limite');
  end if;
  select * into l from public.boleto_lists where token_hash = p_token_hash;
  if not found then
    insert into public.boleto_list_misses (ip_hash) values (coalesce(p_ip_hash, '-'));
    return jsonb_build_object('erro', 'invalido');
  end if;
  if l.revoked_at is not null or l.expires_at < public.today_br() then
    return jsonb_build_object('erro', 'expirado');
  end if;
  if (select count(*) from public.boleto_list_accesses a where a.list_id = l.id and a.accessed_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('erro', 'limite');
  end if;
  insert into public.boleto_list_accesses (list_id, ip_hash, user_agent) values (l.id, p_ip_hash, left(p_user_agent, 120));
  select split_part(btrim(c.full_name), ' ', 1) into v_nome from public.clients c where c.id = l.client_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'vencimento', x.due_date, 'valor', x.value_cents, 'situacao', x.situacao,
           'link', case when x.situacao in ('a_pagar', 'vencido') then x.invoice_url end,
           'linha', case when x.situacao in ('a_pagar', 'vencido') then x.identification_field end)
         order by x.due_date, x.seq), '[]'::jsonb)
    into v_boletos
    from (
      select i.seq, i.due_date, coalesce(ch.value_cents, i.amount_cents) value_cents, ch.invoice_url, ch.identification_field,
             case
               when i.status = 'paga' or ch.status in ('paga', 'liquidada') then
                 case when exists (select 1 from public.payment_receipts r where r.installment_id = i.id and r.reversal_of is null
                                    and not coalesce(r.reversed, false) and r.payment_method = 'dinheiro') then 'pago_no_balcao'
                      when exists (select 1 from public.payment_receipts r where r.installment_id = i.id and r.reversal_of is null
                                    and not coalesce(r.reversed, false) and r.payment_method = 'permuta') then 'pago_permuta'
                      when exists (select 1 from public.payment_waivers w where w.installment_id = i.id) then 'quitado_valor_menor'
                      else 'pago' end
               when i.status = 'renegociada' then 'substituido_renegociacao'
               when i.status = 'cancelada' then 'cancelado'
               when ch.status in ('emitida') then 'a_pagar'
               when ch.status in ('vencida') then 'vencido'
               else 'sem_boleto' end as situacao
        from public._boleto_list_installments(l.id) li
        join public.payment_installments i on i.id = li.installment_id
        left join lateral (
          select c.* from public.charges c where c.payment_installment_id = i.id and c.billing_type = 'BOLETO'
           order by c.created_at desc limit 1) ch on true
       where i.payment_method = 'boleto'
         and (ch.id is not null or i.status in ('renegociada', 'cancelada', 'paga'))
         -- 19.28.11: o boleto do acordo só aparece se o pagador é o mesmo da lista
         -- (outro pagador: a lista mostra só as antigas como substituídas, sem valores do acordo).
         and (not li.from_agreement
              or (ch.id is not null and ch.payer_guardian_id is not distinct from l.payer_guardian_id))
    ) x;
  update public.charges c set viewed_at = coalesce(c.viewed_at, now())
   where c.billing_type = 'BOLETO' and c.status in ('emitida', 'vencida')
     and c.payment_installment_id in (select li.installment_id from public._boleto_list_installments(l.id) li)
     and (c.payer_guardian_id is not distinct from l.payer_guardian_id
          or c.payment_installment_id in (select li.installment_id from public._boleto_list_installments(l.id) li where not li.from_agreement));
  return jsonb_build_object('nome', v_nome, 'expira', l.expires_at, 'boletos', v_boletos);
end;
$$;
revoke execute on function public._boleto_list_read(text, text, text) from public, anon, authenticated;

-- "A lista mudou": também para o boleto novo do acordo, nas listas das vendas
-- de origem do mesmo pagador.
create or replace function public.charges_boleto_list_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.payment_installments%rowtype;
  l record;
  v_users uuid[];
  v_closer uuid;
begin
  if new.billing_type <> 'BOLETO' then return new; end if;
  if tg_op = 'UPDATE' and not (new.status = 'cancelada' and old.status is distinct from 'cancelada') then return new; end if;
  if tg_op = 'INSERT' and not new.via_carne then return new; end if;
  select * into v_inst from public.payment_installments where id = new.payment_installment_id;
  for l in
    select distinct on (bl.negotiation_id, bl.direct_sale_id) bl.*
      from public.boleto_lists bl
     where bl.revoked_at is null and bl.expires_at >= public.today_br()
       and (((v_inst.negotiation_id is not null and bl.negotiation_id = v_inst.negotiation_id)
          or (v_inst.direct_sale_id is not null and bl.direct_sale_id = v_inst.direct_sale_id))
         or (v_inst.renegotiation_id is not null
             and new.payer_guardian_id is not distinct from bl.payer_guardian_id
             and exists (select 1 from public.payment_renegotiations r where r.id = v_inst.renegotiation_id
                          and ((bl.negotiation_id is not null and bl.negotiation_id = any(r.origin_negotiation_ids))
                            or (bl.direct_sale_id is not null and bl.direct_sale_id = any(r.origin_direct_sale_ids))))))
     order by bl.negotiation_id, bl.direct_sale_id, bl.created_at desc
  loop
    select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
     where u.clinic_id = l.clinic_id and u.role = 'unit_manager';
    v_closer := coalesce(public._sale_closer(v_inst.negotiation_id, v_inst.direct_sale_id),
                         (select r.created_by from public.payment_renegotiations r where r.id = v_inst.renegotiation_id));
    v_users := v_users || array[v_closer];
    perform public._notify_users('lista_de_boletos_mudou', l.id::text || ':' || public.today_br()::text, v_users, l.clinic_id,
      'A lista de boletos mudou: reenvie o link',
      'Um boleto da lista enviada ao paciente foi cancelado, substituído ou criado. A página já mostra a situação nova; reenvie o link para o paciente saber.',
      '/prontuarios/' || v_inst.client_id::text);
  end loop;
  return new;
end;
$$;
revoke execute on function public.charges_boleto_list_changed() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11b) O MEIO DAS PARCELAS NOVAS NA COBRANÇA AUTOMÁTICA (Pix, boleto, cartão) e
--      o CARTÃO PARCELADO PELO ASAAS do acordo (o bloco nasce inteiro na assinatura)
-- -----------------------------------------------------------------------------
create or replace function public._auto_charge_billing(p_installment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when i.negotiation_id is not null and i.payment_method = 'pix' then 'PIX'
    when i.negotiation_id is not null and i.payment_method = 'boleto' then 'BOLETO'
    when i.direct_sale_id is not null and ds.method_rule = 'asa4' and i.payment_method = 'pix' then 'PIX'
    when i.direct_sale_id is not null and ds.method_rule = 'asa4' and i.payment_method = 'boleto' then 'BOLETO'
    when i.direct_sale_id is not null and ds.method_rule = 'asa4' and i.payment_method = 'cartao' then 'CREDIT_CARD'
    -- 4017: a parcela do acordo assinado (os meios da venda direta nova)
    when i.renegotiation_id is not null and r.flow = 'assinatura' and i.payment_method = 'pix' then 'PIX'
    when i.renegotiation_id is not null and r.flow = 'assinatura' and i.payment_method = 'boleto' then 'BOLETO'
    when i.renegotiation_id is not null and r.flow = 'assinatura' and i.payment_method = 'cartao' then 'CREDIT_CARD'
  end
    from public.payment_installments i
    left join public.direct_sales ds on ds.id = i.direct_sale_id
    left join public.payment_renegotiations r on r.id = i.renegotiation_id
   where i.id = p_installment_id;
$$;
revoke execute on function public._auto_charge_billing(uuid) from public, anon, authenticated;

alter table public.charges drop constraint if exists charges_auto_origin_check;
alter table public.charges add constraint charges_auto_origin_check
  check (auto_origin is null or auto_origin in ('assinatura', 'venda_direta', 'rotina', 'rodar_agora', 'restante', 'renegociacao'));

-- As parcelas do bloco: da venda (como antes) ou do acordo (4017).
create or replace function public._card_block_rows(p_negotiation_id uuid, p_direct_sale_id uuid, p_renegotiation_id uuid)
returns setof public.payment_installments
language sql
stable
security definer
set search_path = ''
as $$
  select i.* from public.payment_installments i
   where i.payment_method = 'cartao_parcelado_asaas'
     and i.status <> 'cancelada'
     and ((p_renegotiation_id is not null and i.renegotiation_id = p_renegotiation_id)
       or (p_renegotiation_id is null and i.renegotiation_id is null
           and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
             or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))))
   order by i.due_date, i.seq;
$$;
revoke execute on function public._card_block_rows(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._card_block_check(p_negotiation_id uuid, p_direct_sale_id uuid, p_renegotiation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_total bigint;
  v_base bigint;
  v_first date;
  r record;
  k integer := 0;
begin
  select count(*), sum(i.amount_cents), min(i.due_date) into v_n, v_total, v_first
    from public._card_block_rows(p_negotiation_id, p_direct_sale_id, p_renegotiation_id) i;
  if coalesce(v_n, 0) = 0 then return; end if;
  if v_n < 2 then raise exception 'PARCELADO_ASAAS_MIN_2'; end if;
  if v_n > 21 then raise exception 'PARCELADO_ASAAS_MAX_21'; end if;
  if extract(day from v_first) > 28 then raise exception 'PARCELADO_ASAAS_DIA'; end if;
  v_base := floor(v_total::numeric / v_n);
  for r in select * from public._card_block_rows(p_negotiation_id, p_direct_sale_id, p_renegotiation_id) loop
    if r.due_date <> (v_first + make_interval(months => k))::date then raise exception 'PARCELADO_ASAAS_DATAS'; end if;
    if r.amount_cents <> (case when k = v_n - 1 then v_total - v_base * (v_n - 1) else v_base end) then
      raise exception 'PARCELADO_ASAAS_VALORES';
    end if;
    k := k + 1;
  end loop;
end;
$$;
revoke execute on function public._card_block_check(uuid, uuid, uuid) from public, anon, authenticated;

-- A mesma conferência nas parcelas do acordo, antes de existirem (no salvamento).
create or replace function public._card_block_entries_check(p_entries jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_n integer;
  v_total bigint;
  v_base bigint;
  v_first date;
  r record;
  k integer := 0;
begin
  select count(*), sum((e->>'amount_cents')::bigint), min((e->>'due_date')::date) into v_n, v_total, v_first
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e where e->>'payment_method' = 'cartao_parcelado_asaas';
  if coalesce(v_n, 0) = 0 then return; end if;
  if v_n < 2 then raise exception 'PARCELADO_ASAAS_MIN_2'; end if;
  if v_n > 21 then raise exception 'PARCELADO_ASAAS_MAX_21'; end if;
  if extract(day from v_first) > 28 then raise exception 'PARCELADO_ASAAS_DIA'; end if;
  v_base := floor(v_total::numeric / v_n);
  for r in select (e->>'due_date')::date d, (e->>'amount_cents')::bigint a
             from jsonb_array_elements(p_entries) e where e->>'payment_method' = 'cartao_parcelado_asaas'
            order by 1 loop
    if r.d <> (v_first + make_interval(months => k))::date then raise exception 'PARCELADO_ASAAS_DATAS'; end if;
    if r.a <> (case when k = v_n - 1 then v_total - v_base * (v_n - 1) else v_base end) then
      raise exception 'PARCELADO_ASAAS_VALORES';
    end if;
    k := k + 1;
  end loop;
end;
$$;
revoke execute on function public._card_block_entries_check(jsonb) from public, anon, authenticated;

create or replace function public._card_block_has_charge(p_negotiation_id uuid, p_direct_sale_id uuid, p_renegotiation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.charges c
      join public._card_block_rows(p_negotiation_id, p_direct_sale_id, p_renegotiation_id) i on i.id = c.payment_installment_id
     where c.installment_block is not null
       and (c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'paga', 'liquidada', 'em_contestacao')
            or (c.status = 'cancelada' and c.cancelled_by is not null)));
$$;
revoke execute on function public._card_block_has_charge(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._card_blocks_due(
  p_clinic_id uuid, p_negotiation_id uuid, p_direct_sale_id uuid, p_limit integer, p_renegotiation_id uuid
)
returns table (clinic_id uuid, negotiation_id uuid, direct_sale_id uuid, parcelas integer, total_cents bigint, origem text,
               renegotiation_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select k.clinic_id, m.negotiation_id, m.direct_sale_id, k.n, k.total, m.source, m.renegotiation_id
    from public.sale_auto_charges m
    cross join lateral (
      select min(i.clinic_id::text)::uuid as clinic_id, count(*)::integer as n, sum(i.amount_cents)::bigint as total,
             bool_and(i.status = 'em_aberto') as abertas
        from public._card_block_rows(m.negotiation_id, m.direct_sale_id, m.renegotiation_id) i
    ) k
   where k.n >= 2 and k.abertas
     and not public._card_block_has_charge(m.negotiation_id, m.direct_sale_id, m.renegotiation_id)
     and public.central_is_ready(k.clinic_id)
     and (p_clinic_id is null or k.clinic_id = p_clinic_id)
     and (p_negotiation_id is null or m.negotiation_id = p_negotiation_id)
     and (p_direct_sale_id is null or m.direct_sale_id = p_direct_sale_id)
     and (p_renegotiation_id is null or m.renegotiation_id = p_renegotiation_id)
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke execute on function public._card_blocks_due(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated;

create or replace function public._card_block_insert(
  p_negotiation_id uuid, p_direct_sale_id uuid, p_actor uuid, p_origin text, p_renegotiation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block uuid := gen_random_uuid();
  v_n integer;
  r record;
  v record;
  v_bal record;
  k integer := 0;
begin
  perform 1 from public.payment_installments i
   where i.id in (select b.id from public._card_block_rows(p_negotiation_id, p_direct_sale_id, p_renegotiation_id) b) for update;
  perform public._card_block_check(p_negotiation_id, p_direct_sale_id, p_renegotiation_id);
  select count(*) into v_n from public._card_block_rows(p_negotiation_id, p_direct_sale_id, p_renegotiation_id);
  if v_n < 2 then raise exception 'PARCELADO_ASAAS_MIN_2'; end if;
  if public._card_block_has_charge(p_negotiation_id, p_direct_sale_id, p_renegotiation_id) then raise exception 'CHARGE_ALREADY_ACTIVE'; end if;
  for r in select * from public._card_block_rows(p_negotiation_id, p_direct_sale_id, p_renegotiation_id) loop
    if r.status <> 'em_aberto' then raise exception 'PARCELADO_ASAAS_PARCELA_PAGA'; end if;
    select * into v from public._charge_compute(r.id, 'CREDIT_CARD', null);
    if v.error_code is not null then raise exception '%', v.error_code; end if;
    select * into v_bal from public.installment_balance(r.id, r.due_date);
    k := k + 1;
    insert into public.charges (
      clinic_id, gateway_account_id, source_type, payment_installment_id, client_id,
      payer_kind, payer_guardian_id, billing_type, value_cents, discount_cents,
      fine_percent, fine_cents, interest_percent, due_date, is_overdue_reissue, status, created_by, auto_origin,
      installment_block, installment_count, installment_number
    ) values (
      r.clinic_id, v.gateway_account_id, 'installment', r.id, v.client_id,
      v.payer_kind, v.payer_guardian_id, 'CREDIT_CARD', v_bal.principal_rem, 0,
      0, 0, 0, r.due_date, false, 'emitindo', p_actor, p_origin,
      v_block, v_n, k
    );
  end loop;
  return v_block;
end;
$$;
revoke execute on function public._card_block_insert(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public._card_block_prepare_system(
  p_negotiation_id uuid, p_direct_sale_id uuid, p_origin text, p_renegotiation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public._card_blocks_due(null, p_negotiation_id, p_direct_sale_id, 1000, p_renegotiation_id)) then
    raise exception 'NOT_DUE';
  end if;
  return public._card_block_insert(p_negotiation_id, p_direct_sale_id, null, p_origin, p_renegotiation_id);
end;
$$;
revoke execute on function public._card_block_prepare_system(uuid, uuid, text, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 11c) AS ASSINATURAS DE ANTES, COMO PASSAGEM PARA AS NOVAS
-- -----------------------------------------------------------------------------
create or replace function public._auto_charge_due(p_clinic_id uuid, p_negotiation_id uuid, p_direct_sale_id uuid, p_limit integer)
returns table (installment_id uuid, clinic_id uuid, billing_type text, due_date date, origem text)
language sql stable security definer set search_path = ''
as $$ select * from public._auto_charge_due(p_clinic_id, p_negotiation_id, p_direct_sale_id, p_limit, null::uuid); $$;
revoke execute on function public._auto_charge_due(uuid, uuid, uuid, integer) from public, anon, authenticated;

create or replace function public._card_block_rows(p_negotiation_id uuid, p_direct_sale_id uuid)
returns setof public.payment_installments
language sql stable security definer set search_path = ''
as $$ select * from public._card_block_rows(p_negotiation_id, p_direct_sale_id, null::uuid); $$;
revoke execute on function public._card_block_rows(uuid, uuid) from public, anon, authenticated;

create or replace function public._card_block_check(p_negotiation_id uuid, p_direct_sale_id uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$ begin perform public._card_block_check(p_negotiation_id, p_direct_sale_id, null::uuid); end; $$;
revoke execute on function public._card_block_check(uuid, uuid) from public, anon, authenticated;

create or replace function public._card_block_has_charge(p_negotiation_id uuid, p_direct_sale_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public._card_block_has_charge(p_negotiation_id, p_direct_sale_id, null::uuid); $$;
revoke execute on function public._card_block_has_charge(uuid, uuid) from public, anon, authenticated;

create or replace function public._card_blocks_due(p_clinic_id uuid, p_negotiation_id uuid, p_direct_sale_id uuid, p_limit integer)
returns table (clinic_id uuid, negotiation_id uuid, direct_sale_id uuid, parcelas integer, total_cents bigint, origem text)
language sql stable security definer set search_path = ''
as $$ select d.clinic_id, d.negotiation_id, d.direct_sale_id, d.parcelas, d.total_cents, d.origem
        from public._card_blocks_due(p_clinic_id, p_negotiation_id, p_direct_sale_id, p_limit, null::uuid) d
       where d.renegotiation_id is null; $$;
revoke execute on function public._card_blocks_due(uuid, uuid, uuid, integer) from public, anon, authenticated;

create or replace function public._card_block_insert(p_negotiation_id uuid, p_direct_sale_id uuid, p_actor uuid, p_origin text)
returns uuid
language sql security definer set search_path = ''
as $$ select public._card_block_insert(p_negotiation_id, p_direct_sale_id, p_actor, p_origin, null::uuid); $$;
revoke execute on function public._card_block_insert(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public._card_block_prepare_system(p_negotiation_id uuid, p_direct_sale_id uuid, p_origin text)
returns uuid
language sql security definer set search_path = ''
as $$ select public._card_block_prepare_system(p_negotiation_id, p_direct_sale_id, p_origin, null::uuid); $$;
revoke execute on function public._card_block_prepare_system(uuid, uuid, text) from public, anon, authenticated;

-- As cobranças do acordo, para a ficha: o bloco do parcelado e cada parcela.
create or replace function public.renegotiation_charges_read(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.payment_renegotiations%rowtype;
  v_block uuid;
begin
  select * into r from public.payment_renegotiations where id = p_id;
  if r.id is null or not public.can_receive_payment(r.clinic_id) then return null; end if;
  select c.installment_block into v_block from public.charges c
    join public._card_block_rows(null, null, p_id) i on i.id = c.payment_installment_id
   where c.installment_block is not null order by (c.status = 'cancelada'), c.created_at desc limit 1;
  return jsonb_build_object(
    'parcelado', case when v_block is null then null else (
      select jsonb_build_object('block', v_block, 'parcelas', count(*), 'link',
               (array_agg(c.invoice_url order by c.installment_number) filter (where c.invoice_url is not null))[1],
               'situacao', case when bool_and(c.status in ('paga', 'liquidada')) then 'pago'
                                when bool_or(c.status = 'erro_emissao') then 'erro'
                                when bool_or(c.status = 'emitindo') then 'emitindo'
                                when bool_and(c.status = 'cancelada') then 'cancelado'
                                else 'aguardando' end)
        from public.charges c where c.installment_block = v_block) end,
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object(
        'seq', i.seq, 'vencimento', i.due_date, 'valor', i.amount_cents, 'meio', i.payment_method, 'situacao', i.status,
        'cobranca', (select jsonb_build_object('status', c.status, 'link', c.invoice_url, 'via_carne', c.via_carne)
                       from public.charges c where c.payment_installment_id = i.id order by c.created_at desc limit 1))
        order by i.due_date, i.seq)
      from public.payment_installments i where i.renegotiation_id = p_id), '[]'::jsonb));
end;
$$;
revoke execute on function public.renegotiation_charges_read(uuid) from public, anon, authenticated;
grant execute on function public.renegotiation_charges_read(uuid) to authenticated;

-- A assinatura da ZapSign aceita a origem nova.
alter table public.signature_packages drop constraint if exists signature_packages_origin_type_check;
alter table public.signature_packages add constraint signature_packages_origin_type_check
  check (origin_type in ('client', 'plan_negotiation', 'treatment_plan', 'company', 'company_document', 'commercial_lead',
                         'payment_renegotiation'));

-- Cancelar o termo na ZapSign SEM usuário (o acordo expirou ou foi pago antes):
-- o servidor já recusou o documento na ZapSign; aqui o pacote fica cancelado.
create or replace function public._signature_cancel_package_system(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.signature_packages
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(coalesce(p_reason, 'cancelado pelo sistema'), 300)
   where id = p_id and status in ('draft', 'sent', 'partially_signed');
  if found then
    insert into public.signature_events (package_id, event_type, payload)
    values (p_id, 'cancelled_by_system', jsonb_build_object('motivo', p_reason));
  end if;
end;
$$;
revoke execute on function public._signature_cancel_package_system(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 12) A TRAVA DA 4015a conta também o acordo aguardando assinatura
-- -----------------------------------------------------------------------------
create or replace function public._sale_open_agreements(p_negotiation_id uuid, p_direct_sale_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with recursive cadeia(reneg_id) as (
    select distinct i.renegotiated_by_id
      from public.payment_installments i
     where i.status = 'renegociada' and i.renegotiated_by_id is not null
       and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
         or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))
    union
    select j.renegotiated_by_id
      from public.payment_installments j
      join cadeia c on j.renegotiation_id = c.reneg_id
     where j.status = 'renegociada' and j.renegotiated_by_id is not null
  ),
  abertos as (
    select r.id, coalesce(r.code, left(r.id::text, 8)) as rotulo
      from cadeia c
      join public.payment_renegotiations r on r.id = c.reneg_id
     where exists (select 1 from public.payment_installments k
                    where k.renegotiation_id = r.id and k.status in ('em_aberto', 'parcial'))
    union
    -- o acordo que ainda não vale (autorização ou assinatura), com parcela desta venda
    select r.id, coalesce(r.code, left(r.id::text, 8))
      from public.payment_renegotiations r
     where r.status in ('aguardando_autorizacao', 'aguardando_assinatura')
       and exists (select 1 from public.payment_installments i
                    where i.id = any(r.source_installment_ids)
                      and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
                        or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id)))
  )
  select coalesce(array_agg(distinct a.rotulo), '{}'::text[]) from abertos a;
$$;
revoke execute on function public._sale_open_agreements(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 13) A AUDITORIA DAS TABELAS NOVAS
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

notify pgrst, 'reload schema';

-- CONFERÊNCIA
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_desconto_por_componente', '_renegotiation_origins', '_client_payer_guardian', '_installment_boleto_mode',
      '_renegotiation_deadline', '_renegotiation_can_handle', 'renegotiation_send_check', 'renegotiation_confirm_external',
      'renegotiation_mark_sent', 'renegotiation_apply_signed', 'renegotiation_attach_signed', '_renegotiation_end',
      'renegotiation_cancel_pending', 'renegotiation_signature_status', 'renegotiation_expire_run',
      '_renegotiations_zapsign_to_cancel', '_renegotiation_zapsign_cancelled',
      'payment_receipts_cancel_pending_renegotiation', 'installment_pending_renegotiation',
      '_boleto_list_installments', 'payment_renegotiations_status_log', '_card_block_entries_check',
      'renegotiation_charges_read', '_signature_cancel_package_system')) as funcoes_novas,
  (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('payment_renegotiation_events', 'payment_renegotiation_sources')) as tabelas_novas,
  (select count(*) from public.payment_renegotiations where flow = 'legado') as renegociacoes_antigas,
  (select count(*) from public.payment_renegotiations where status in ('aguardando_assinatura')) as aguardando_assinatura,
  (select not public from storage.buckets where id = 'renegociacoes') as pasta_privada;
