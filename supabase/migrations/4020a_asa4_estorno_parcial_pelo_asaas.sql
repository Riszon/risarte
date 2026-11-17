-- =============================================================================
-- 4020a — ASA4: o ESTORNO PARCIAL pelo Asaas (spec 19.38, aprovada em 17/11/2026
-- com 1a–4a e os três cuidados do dono)
-- -----------------------------------------------------------------------------
--   * O PEDIDO de estorno (parcial ou total) nasce em `refund_requests`, com o
--     valor, o motivo e, no cartão parcelado, a REPARTIÇÃO PREVISTA entre as
--     parcelas (as inteiras primeiro, a parte da seguinte).
--   * CUIDADO 1 — o cartão sai na hora e não volta: todo estorno de cartão
--     (parcial ou total) acima do valor da Central (rede; em branco = todos) só
--     vai ao Asaas depois que o Gerente ou o franqueado CONFIRMA — nunca quem
--     pediu. No distrato, a autorização do Financeiro é a confirmação.
--   * CUIDADO 2 — a repartição é previsão: depois do pedido, o riSZon grava o
--     que o Asaas fez (lido da API); diferente da previsão, avisa quem pediu e
--     o Financeiro.
--   * CUIDADO 3 — a parcela estornada inteira (pelo pedido do riSZon) fica
--     ENCERRADA como "Estornada": a baixa é desfeita, ela não volta a ser
--     cobrada sozinha; só o Gerente (ou o Admin) reabre, com motivo. A taxa da
--     rede continua devida ("a cobrar").
--   * O parcial: a parcela continua paga, a devolução fica registrada, a taxa
--     continua. O aviso PAYMENT_PARTIALLY_REFUNDED fecha o pedido com o
--     comprovante; no distrato, a devolução fica "Paga pelo Asaas".
--   * A RÉGUA do pedido pendente (19.37, item 3): Pix esperando a autorização —
--     1 dia útil, a cada 7 dias, o aviso do 25º dia, a queda aos 30 (a cobrança
--     volta a "Paga"; no distrato, a devolução volta a "pedir"); cartão em
--     processamento há mais de 5 dias úteis — aviso ao Financeiro.
--   * O SALDO (19.37, item 1): sem saldo, o pedido não sai (o servidor lê o
--     saldo); a tela da unidade não vê o saldo da franqueadora; quem pediu é
--     avisado quando o estorno volta a ficar disponível.
-- Nenhuma chamada ao Asaas sai do banco. Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O LIMITE DA CONFIRMAÇÃO (Central › Rede; em branco = todo estorno de cartão)
-- -----------------------------------------------------------------------------
alter table public.gateway_split_settings add column if not exists card_refund_confirm_above_cents bigint
  check (card_refund_confirm_above_cents is null or card_refund_confirm_above_cents >= 0);

create or replace function public.card_refund_limit_save(p_cents bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  if p_cents is not null and p_cents < 0 then raise exception 'INVALID_AMOUNT'; end if;
  update public.gateway_split_settings set card_refund_confirm_above_cents = p_cents, updated_at = now(), updated_by = (select auth.uid()) where id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), null, 'update', 'card_refund_limit', 'rede', jsonb_build_object('cents', p_cents));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) O PEDIDO DE ESTORNO
-- -----------------------------------------------------------------------------
create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  client_id uuid,
  charge_id uuid references public.charges(id),
  installment_block uuid,
  kind text not null check (kind in ('pix', 'cartao', 'boleto')),
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  partial boolean not null default false,
  reason text not null check (length(btrim(reason)) >= 5),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  needs_confirm boolean not null default false,
  confirmed_by uuid,
  confirmed_at timestamptz,
  status text not null default 'confirmar' check (status in ('confirmar', 'enviar', 'enviado', 'cancelado', 'falhou', 'sem_saldo')),
  expected_split jsonb,
  actual_split jsonb,
  actual_checked_at timestamptz,
  split_differs boolean,
  distrato_refund_id uuid,
  sent_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  error text,
  balance_notice_at timestamptz,
  created_at timestamptz not null default now(),
  check ((charge_id is not null) or (installment_block is not null))
);
create index if not exists refund_requests_charge on public.refund_requests (charge_id);
create index if not exists refund_requests_block on public.refund_requests (installment_block);
alter table public.refund_requests enable row level security;

-- O que o Asaas recebeu, por cobrança: o valor do parcial, o pedido e o comprovante.
alter table public.charge_refunds add column if not exists amount_cents bigint;
alter table public.charge_refunds add column if not exists request_id uuid references public.refund_requests(id);
alter table public.charge_refunds add column if not exists receipt_url text;
alter table public.charge_refunds add column if not exists reminders integer not null default 0;
alter table public.charge_refunds add column if not exists last_reminder_at timestamptz;
alter table public.charge_refunds add column if not exists processing_notice_at timestamptz;
alter table public.charge_refunds drop constraint if exists charge_refunds_status_check;
alter table public.charge_refunds add constraint charge_refunds_status_check
  check (status = any (array['pedido', 'concluido', 'negado', 'cancelado', 'falhou', 'caiu']));

-- A parcela estornada inteira: encerrada como "Estornada" (cuidado 3).
alter table public.payment_installments add column if not exists refund_closed_at timestamptz;
alter table public.payment_installments add column if not exists refund_reopened_at timestamptz;
alter table public.payment_installments add column if not exists refund_reopened_by uuid;
alter table public.payment_installments add column if not exists refund_reopen_reason text;

-- A devolução do distrato paga pelo estorno do Asaas.
alter table public.distrato_refunds add column if not exists charge_id uuid references public.charges(id);
alter table public.distrato_refunds add column if not exists paid_by_refund_at timestamptz;
alter table public.distrato_refunds drop constraint if exists distrato_refunds_status_check;
alter table public.distrato_refunds add constraint distrato_refunds_status_check
  check (status = any (array['pedida', 'autorizada', 'negada', 'paga_pelo_asaas']));

-- -----------------------------------------------------------------------------
-- 3) O QUE AINDA SE PODE ESTORNAR E A REPARTIÇÃO PREVISTA
-- -----------------------------------------------------------------------------
-- O que da cobrança paga ainda não foi devolvido (estorno total = tudo).
create or replace function public._refund_left_cents(p_charge_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.charge_refunds r where r.charge_id = c.id and r.status in ('pedido', 'concluido') and r.amount_cents is null)
      then 0
    else greatest(coalesce(c.paid_cents, c.value_cents, 0)
           - coalesce((select sum(r.amount_cents) from public.charge_refunds r
                        where r.charge_id = c.id and r.status in ('pedido', 'concluido') and r.amount_cents is not null), 0), 0)
  end
  from public.charges c where c.id = p_charge_id;
$$;

-- A repartição PREVISTA no parcelado (o que o Asaas fez na prova de 17/11): as
-- parcelas inteiras primeiro, pela ordem, e a parte da seguinte.
create or replace function public._refund_block_split(p_block uuid, p_amount bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  v_left bigint := p_amount;
  v_out jsonb := '[]'::jsonb;
  v_part bigint;
  v_can bigint;
begin
  for r in select c.id, c.installment_number from public.charges c
            where c.installment_block = p_block and c.status in ('paga', 'liquidada') and not c.is_external
            order by c.installment_number loop
    exit when v_left <= 0;
    v_can := public._refund_left_cents(r.id);
    continue when v_can <= 0;
    v_part := least(v_left, v_can);
    v_out := v_out || jsonb_build_object('charge_id', r.id, 'numero', r.installment_number, 'valor_cents', v_part, 'inteira', v_part = v_can);
    v_left := v_left - v_part;
  end loop;
  return v_out;
end;
$$;

-- Precisa da confirmação do Gerente ou do franqueado? (cuidado 1)
create or replace function public._refund_needs_confirm(p_kind text, p_amount bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_kind = 'cartao' and (s.card_refund_confirm_above_cents is null or coalesce(p_amount, 0) > s.card_refund_confirm_above_cents)
    from public.gateway_split_settings s where s.id;
$$;

create or replace function public._refund_confirmers(p_clinic_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct ucr.user_id), '{}') from public.user_clinic_roles ucr
   where ucr.clinic_id = p_clinic_id and ucr.role in ('unit_manager', 'franchisee');
$$;

-- O que a tela mostra ANTES de pedir (a confirmação reforçada).
create or replace function public.refund_request_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_charge uuid := (p ->> 'charge_id')::uuid;
  v_block uuid := (p ->> 'block_id')::uuid;
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint;
  c public.charges%rowtype;
  v_kind text;
  v_left bigint;
  v_total bigint;
  v_nome text;
begin
  if v_block is not null then
    select * into c from public.charges x where x.installment_block = v_block order by x.installment_number limit 1;
  else
    select * into c from public.charges x where x.id = v_charge;
  end if;
  if c.id is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_refund_can(c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  v_kind := case c.billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto' else 'cartao' end;
  if v_block is not null then
    select coalesce(sum(public._refund_left_cents(x.id)), 0) into v_left from public.charges x
     where x.installment_block = v_block and x.status in ('paga', 'liquidada');
  else
    v_left := public._refund_left_cents(c.id);
  end if;
  v_total := coalesce(v_amount, v_left);
  select full_name into v_nome from public.clients where id = c.client_id;
  return jsonb_build_object(
    'kind', v_kind, 'left_cents', v_left, 'amount_cents', v_total, 'partial', v_total < v_left,
    'patient', jsonb_build_object('code', (select code from public.clients where id = c.client_id), 'name', v_nome),
    'needs_confirm', public._refund_needs_confirm(v_kind, v_total),
    'limit_cents', (select card_refund_confirm_above_cents from public.gateway_split_settings where id),
    'expected_split', case when v_block is not null then public._refund_block_split(v_block, v_total) end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) PEDIR, CONFIRMAR, CANCELAR
-- -----------------------------------------------------------------------------
create or replace function public.refund_request_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_charge uuid := (p ->> 'charge_id')::uuid;
  v_block uuid := (p ->> 'block_id')::uuid;
  v_amount bigint := nullif(p ->> 'amount_cents', '')::bigint;
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_user uuid := (select auth.uid());
  c public.charges%rowtype;
  v_kind text;
  v_left bigint;
  v_total bigint;
  v_needs boolean;
  v_split jsonb;
  v_id uuid;
begin
  if v_block is not null then
    select * into c from public.charges x where x.installment_block = v_block order by x.installment_number limit 1;
  else
    select * into c from public.charges x where x.id = v_charge;
  end if;
  if c.id is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._charge_refund_can(c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if v_block is null and c.installment_block is not null then raise exception 'USE_O_PARCELAMENTO'; end if;
  if c.asaas_payment_id is null or c.is_external then raise exception 'NOT_REFUNDABLE'; end if;
  v_kind := case c.billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto' else 'cartao' end;
  -- O boleto só tem o estorno TOTAL, pelo pagador (18.7.7): continua no caminho da 4009.
  if v_kind = 'boleto' then raise exception 'BOLETO_PELO_ESTORNO_TOTAL'; end if;
  if exists (select 1 from public.refund_requests r
              where r.status in ('confirmar', 'enviar') and (r.charge_id = c.id or (v_block is not null and r.installment_block = v_block))) then
    raise exception 'REFUND_PENDING';
  end if;
  if v_block is not null then
    if exists (select 1 from public.charges x where x.installment_block = v_block
                and (x.refund_state is not null or exists (select 1 from public.charge_refunds f where f.charge_id = x.id and f.status = 'pedido'))) then
      raise exception 'REFUND_PENDING';
    end if;
    select coalesce(sum(public._refund_left_cents(x.id)), 0) into v_left from public.charges x
     where x.installment_block = v_block and x.status in ('paga', 'liquidada');
  else
    if c.status not in ('paga', 'liquidada') then raise exception 'NOT_REFUNDABLE'; end if;
    if c.refund_state is not null or exists (select 1 from public.charge_refunds f where f.charge_id = c.id and f.status = 'pedido') then
      raise exception 'REFUND_PENDING';
    end if;
    v_left := public._refund_left_cents(c.id);
  end if;
  v_total := coalesce(v_amount, v_left);
  if v_left <= 0 then raise exception 'NOTHING_TO_REFUND'; end if;
  if v_total <= 0 or v_total > v_left then raise exception 'AMOUNT_OVER_BALANCE'; end if;
  v_needs := public._refund_needs_confirm(v_kind, v_total);
  v_split := case when v_block is not null then public._refund_block_split(v_block, v_total) end;
  insert into public.refund_requests (clinic_id, client_id, charge_id, installment_block, kind, amount_cents, partial, reason,
    requested_by, needs_confirm, status, expected_split, distrato_refund_id)
  values (c.clinic_id, c.client_id, case when v_block is null then c.id end, v_block, v_kind,
    case when v_total < v_left then v_total end, v_total < v_left, v_reason, v_user, v_needs,
    case when v_needs then 'confirmar' else 'enviar' end, v_split, (p ->> 'distrato_refund_id')::uuid)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, c.clinic_id, 'create', 'refund_request', v_id::text,
          jsonb_build_object('kind', v_kind, 'amount_cents', v_total, 'partial', v_total < v_left, 'reason', v_reason, 'needs_confirm', v_needs));
  if v_needs then
    perform public._notify_users('estorno_confirmar', v_id::text,
      array(select x from unnest(public._refund_confirmers(c.clinic_id)) x where x <> v_user), c.clinic_id,
      'Estorno de cartão para confirmar',
      'Um estorno de cartão de ' || public.brl(v_total) || ' foi pedido e espera a sua confirmação. No cartão, o estorno sai na hora e não pode ser desfeito.',
      '/prontuarios/' || c.client_id::text);
  end if;
  return jsonb_build_object('id', v_id, 'needs_confirm', v_needs, 'kind', v_kind, 'amount_cents', v_total, 'partial', v_total < v_left,
                            'expected_split', v_split);
end;
$$;

-- O Gerente ou o franqueado confirma — nunca quem pediu (cuidado 1).
create or replace function public.refund_request_confirm(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.refund_requests%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into r from public.refund_requests where id = p_id for update;
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'confirmar' then raise exception 'REQUEST_NOT_WAITING'; end if;
  if r.requested_by = v_user then raise exception 'SELF_CONFIRM'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(r.clinic_id, array['unit_manager', 'franchisee']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.refund_requests set status = 'enviar', confirmed_by = v_user, confirmed_at = now() where id = r.id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, r.clinic_id, 'update', 'refund_request', r.id::text, jsonb_build_object('confirmed', true));
  return jsonb_build_object('id', r.id);
end;
$$;

create or replace function public.refund_request_cancel(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.refund_requests%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into r from public.refund_requests where id = p_id for update;
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status not in ('confirmar', 'enviar', 'sem_saldo') then raise exception 'REQUEST_NOT_WAITING'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if not (r.requested_by = v_user or public.is_admin_master() or public.is_finance_franchisor()
          or public.has_role_in_clinic(r.clinic_id, array['unit_manager', 'franchisee']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.refund_requests set status = 'cancelado', cancelled_by = v_user, cancel_reason = btrim(p_reason) where id = r.id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, r.clinic_id, 'update', 'refund_request', r.id::text, jsonb_build_object('cancelled', true, 'reason', btrim(p_reason)));
end;
$$;

-- O servidor lê o pedido pronto para ir ao Asaas.
create or replace function public._refund_request_for_send(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.refund_requests%rowtype;
  c public.charges%rowtype;
  v_hq_part bigint;
begin
  select * into r from public.refund_requests where id = p_id;
  if r.id is null or r.status <> 'enviar' then return null; end if;
  if r.installment_block is not null then
    select * into c from public.charges x where x.installment_block = r.installment_block order by x.installment_number limit 1;
  else
    select * into c from public.charges x where x.id = r.charge_id;
  end if;
  -- A parte da franqueadora (o split que volta no estorno TOTAL de cobrança já creditada).
  select coalesce(sum(cs.settled_cents), 0) into v_hq_part from public.charge_splits cs
    join public.charges x on x.id = cs.charge_id
   where cs.status = 'liquidado' and (x.id = r.charge_id or (r.installment_block is not null and x.installment_block = r.installment_block));
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'account_id', c.gateway_account_id, 'asaas_payment_id', c.asaas_payment_id,
    'asaas_installment_id', c.asaas_installment_id, 'block', r.installment_block, 'charge_id', r.charge_id,
    'amount_cents', r.amount_cents, 'partial', r.partial, 'reason', r.reason, 'requested_by', r.requested_by,
    'expected_split', r.expected_split, 'hq_part_cents', v_hq_part,
    'hq_account_id', (select a.id from public.gateway_accounts a where a.owner_type = 'franchisor' and a.status = 'active' order by a.created_at limit 1),
    'min_balance_cents', (select min_balance_cents from public.gateway_split_settings where id),
    'charges', (select jsonb_agg(jsonb_build_object('charge_id', x.id, 'numero', x.installment_number, 'asaas_payment_id', x.asaas_payment_id)
                                 order by x.installment_number)
                  from public.charges x where (x.id = r.charge_id) or (r.installment_block is not null and x.installment_block = r.installment_block)));
end;
$$;

-- O servidor grava o que o Asaas fez (cuidado 2: a repartição REAL, e o aviso se for diferente).
create or replace function public._refund_request_sent(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.refund_requests%rowtype;
  x jsonb;
  v_status text := p ->> 'result';
  v_differs boolean := false;
  v_exp jsonb;
  c public.charges%rowtype;
begin
  select * into r from public.refund_requests where id = p_id for update;
  if r.id is null then return; end if;
  if v_status = 'sem_saldo' then
    update public.refund_requests set status = 'sem_saldo', error = left(p ->> 'error', 300) where id = r.id;
    -- A unidade não vê o saldo da franqueadora (19.37.5): a mensagem é a mesma para todos.
    perform public._notify_users('estorno_sem_saldo', r.id::text, array[r.requested_by], r.clinic_id,
      'Estorno pelo Asaas temporariamente indisponível',
      'O estorno pelo Asaas está temporariamente indisponível. O Financeiro da Franqueadora já foi avisado. Enquanto isso, você pode esperar o aviso de que o estorno voltou a ficar disponível, ou combinar com o Financeiro a devolução por Pix da conta da unidade.',
      '/prontuarios/' || r.client_id::text);
    perform public._notify_users('estorno_sem_saldo_rede', r.id::text, public._admins_and_finance(), r.clinic_id,
      'Estorno parado por falta de saldo',
      coalesce(p ->> 'detalhe', 'Falta saldo na conta Asaas para o estorno.') || ' Reponha o saldo; quem pediu é avisado quando voltar.',
      '/prontuarios/' || r.client_id::text);
    return;
  end if;
  if v_status <> 'ok' then
    update public.refund_requests set status = 'falhou', error = left(p ->> 'error', 300) where id = r.id;
    perform public._notify_users('estorno_falhou', r.id::text, array[r.requested_by], r.clinic_id,
      'Estorno não foi pedido', 'O Asaas recusou o estorno: ' || coalesce(p ->> 'error', 'sem motivo') || '. A cobrança continua paga.',
      '/prontuarios/' || r.client_id::text);
    return;
  end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'refunds', '[]'::jsonb)) loop
    select * into c from public.charges where id = (x ->> 'charge_id')::uuid;
    insert into public.charge_refunds (charge_id, clinic_id, kind, reason, requested_by, asaas_status, status, finished_at, amount_cents, request_id)
    values (c.id, c.clinic_id, r.kind, r.reason, r.requested_by, x ->> 'asaas_status',
            case when x ->> 'asaas_status' = 'DONE' then 'concluido' else 'pedido' end,
            case when x ->> 'asaas_status' = 'DONE' then now() end,
            case when coalesce((x ->> 'inteira')::boolean, false) then null else (x ->> 'amount_cents')::bigint end, r.id);
    if r.kind = 'pix' and x ->> 'asaas_status' <> 'DONE' then
      update public.charges set refund_state = 'aguardando_autorizacao' where id = c.id;
    end if;
  end loop;
  -- A repartição real contra a prevista.
  if r.installment_block is not null then
    select coalesce(jsonb_agg(jsonb_build_object('charge_id', e ->> 'charge_id', 'valor_cents', (e ->> 'valor_cents')::bigint) order by e ->> 'charge_id'), '[]')
      into v_exp from jsonb_array_elements(coalesce(r.expected_split, '[]'::jsonb)) e;
    v_differs := v_exp is distinct from (
      select coalesce(jsonb_agg(jsonb_build_object('charge_id', a ->> 'charge_id', 'valor_cents', (a ->> 'amount_cents')::bigint) order by a ->> 'charge_id'), '[]')
        from jsonb_array_elements(coalesce(p -> 'refunds', '[]'::jsonb)) a);
  end if;
  update public.refund_requests set status = 'enviado', sent_at = now(), actual_split = p -> 'refunds', actual_checked_at = now(),
         split_differs = case when r.installment_block is not null then v_differs end
   where id = r.id;
  if v_differs then
    perform public._notify_users('estorno_reparticao', r.id::text, array[r.requested_by] || public._admins_and_finance(), r.clinic_id,
      'Estorno: o Asaas repartiu diferente da previsão',
      'O Asaas repartiu o estorno entre as parcelas de um jeito diferente do previsto. O riSZon gravou o que o Asaas fez; confira na ficha.',
      '/prontuarios/' || r.client_id::text);
  end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (null, r.clinic_id, 'update', 'refund_request', r.id::text, jsonb_build_object('sent', true, 'refunds', p -> 'refunds', 'split_differs', v_differs));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) O QUE CHEGA DO ASAAS
-- -----------------------------------------------------------------------------
-- O estorno PARCIAL concluído (PAYMENT_PARTIALLY_REFUNDED, com a lista `refunds`).
create or replace function public._charge_refund_partial_event(p_charge_id uuid, p_payment jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  f public.charge_refunds%rowtype;
  x jsonb;
  v_n integer := 0;
  rq public.refund_requests%rowtype;
begin
  for f in select * from public.charge_refunds where charge_id = p_charge_id and status = 'pedido' and amount_cents is not null for update loop
    for x in select * from jsonb_array_elements(coalesce(p_payment -> 'refunds', '[]'::jsonb)) loop
      if round((x ->> 'value')::numeric * 100) = f.amount_cents and x ->> 'status' in ('DONE', 'CANCELLED') then
        update public.charge_refunds set status = case when x ->> 'status' = 'DONE' then 'concluido' else 'cancelado' end,
               finished_at = now(), asaas_status = x ->> 'status', receipt_url = nullif(x ->> 'transactionReceiptUrl', '')
         where id = f.id;
        update public.charges set refund_state = null where id = p_charge_id;
        v_n := v_n + 1;
        select * into rq from public.refund_requests where id = f.request_id;
        if x ->> 'status' = 'DONE' and rq.distrato_refund_id is not null then
          update public.distrato_refunds set status = 'paga_pelo_asaas', paid_by_refund_at = now() where id = rq.distrato_refund_id;
        end if;
        perform public._notify_users('estorno_parcial_' || lower(x ->> 'status'), f.id::text, array[f.requested_by], f.clinic_id,
          case when x ->> 'status' = 'DONE' then 'Estorno parcial concluído' else 'Estorno parcial cancelado no Asaas' end,
          case when x ->> 'status' = 'DONE' then 'O estorno de ' || public.brl(f.amount_cents) || ' foi concluído. A parcela continua paga e a taxa da rede continua devida.'
               else 'O estorno de ' || public.brl(f.amount_cents) || ' foi cancelado no Asaas. A cobrança continua paga.' end,
          '/prontuarios/' || (select client_id::text from public.charges where id = p_charge_id));
        exit;
      end if;
    end loop;
  end loop;
  return case when v_n > 0 then 'estorno_parcial' else 'aviso_manual' end;
end;
$$;

-- A parcela estornada INTEIRA pelo pedido do riSZon: encerrada como "Estornada"
-- (cuidado 3). Só o Gerente ou o Admin reabrem.
create or replace function public._refund_close_installment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reversal_of is null or coalesce(new.reversal_reason, '') not like 'Estorno no Asaas%' then return null; end if;
  if exists (select 1 from public.charges c join public.charge_refunds f on f.charge_id = c.id
              where c.receipt_id = new.reversal_of and f.amount_cents is null and f.status in ('pedido', 'concluido')) then
    update public.payment_installments set status = 'cancelada', refund_closed_at = now()
     where id = new.installment_id and status in ('em_aberto', 'parcial');
  end if;
  return null;
end;
$$;
drop trigger if exists zz_payment_receipts_refund_close on public.payment_receipts;
create trigger zz_payment_receipts_refund_close after insert on public.payment_receipts
  for each row execute function public._refund_close_installment();

create or replace function public.installment_refund_reopen(p_installment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.payment_installments%rowtype;
begin
  select * into i from public.payment_installments where id = p_installment_id for update;
  if i.id is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(i.clinic_id, array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if i.refund_closed_at is null or i.status <> 'cancelada' then raise exception 'NOT_REFUND_CLOSED'; end if;
  update public.payment_installments set status = 'em_aberto', refund_reopened_at = now(), refund_reopened_by = (select auth.uid()),
         refund_reopen_reason = btrim(p_reason)
   where id = i.id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), i.clinic_id, 'update', 'installment_refund_reopen', i.id::text, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) A RÉGUA DO PEDIDO PENDENTE (19.37, item 3) e o saldo que voltou
-- -----------------------------------------------------------------------------
create or replace function public._refund_regua_list()
returns table (refund_id uuid, charge_id uuid, account_id uuid, asaas_payment_id text, kind text, amount_cents bigint,
               dias integer, dias_uteis integer, reminders integer, last_reminder_at timestamptz, processing_notice_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.id, f.charge_id, c.gateway_account_id, c.asaas_payment_id, f.kind, f.amount_cents,
         public.today_br() - (f.requested_at at time zone 'America/Sao_Paulo')::date,
         (select count(*)::int from generate_series((f.requested_at at time zone 'America/Sao_Paulo')::date + 1, public.today_br(), '1 day') d
           where extract(dow from d) not in (0, 6)),
         f.reminders, f.last_reminder_at, f.processing_notice_at
    from public.charge_refunds f join public.charges c on c.id = f.charge_id
   where f.status = 'pedido' and f.kind in ('pix', 'cartao');
$$;

-- O lembrete: o Pix esperando a autorização (a cada 7 dias; o do 25º dia) e o
-- cartão em processamento (uma vez, depois de 5 dias úteis).
create or replace function public._refund_regua_notice(p_refund_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f public.charge_refunds%rowtype;
  c public.charges%rowtype;
  v_dest uuid[];
  v_title text; v_body text;
begin
  select * into f from public.charge_refunds where id = p_refund_id for update;
  if f.id is null or f.status <> 'pedido' then return; end if;
  select * into c from public.charges where id = f.charge_id;
  if p_kind = 'processamento' then
    if f.processing_notice_at is not null then return; end if;
    update public.charge_refunds set processing_notice_at = now() where id = f.id;
    v_dest := public._admins_and_finance();
    v_title := 'Estorno de cartão em processamento há mais de 5 dias úteis';
    v_body := 'O estorno de cartão de ' || public.brl(coalesce(f.amount_cents, c.paid_cents)) || ' ainda está em processamento no Asaas. Não há o que o titular faça: acompanhe com o Asaas.';
  else
    update public.charge_refunds set reminders = reminders + 1, last_reminder_at = now() where id = f.id;
    v_dest := array[f.requested_by] || public._refund_confirmers(f.clinic_id);
    v_title := case when p_kind = 'dia25' then 'Estorno cai em 5 dias sem a autorização' else 'Estorno esperando a autorização no Asaas' end;
    v_body := 'O estorno de ' || public.brl(coalesce(f.amount_cents, c.paid_cents)) || ' espera a autorização do titular no painel do Asaas'
              || case when p_kind = 'dia25' then '. Sem ela, o pedido cai em 5 dias.' else '.' end;
  end if;
  perform public._notify_users('estorno_regua_' || p_kind, f.id::text || ':' || f.reminders, v_dest, f.clinic_id, v_title, v_body,
    '/prontuarios/' || c.client_id::text);
end;
$$;

-- Caiu (30 dias sem autorização) ou recusado pelo titular: a cobrança volta a
-- "Paga"; no distrato, a devolução volta para "pedir" (com o Pix da unidade).
create or replace function public._refund_fell(p_refund_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f public.charge_refunds%rowtype;
  c public.charges%rowtype;
  rq public.refund_requests%rowtype;
begin
  select * into f from public.charge_refunds where id = p_refund_id for update;
  if f.id is null or f.status <> 'pedido' then return; end if;
  select * into c from public.charges where id = f.charge_id;
  update public.charge_refunds set status = p_status, finished_at = now(),
         status_note = case when p_status = 'caiu' then 'Caiu sem autorização (30 dias)' else 'Recusado pelo titular' end
   where id = f.id;
  update public.charges set refund_state = null where id = f.charge_id;
  select * into rq from public.refund_requests where id = f.request_id;
  if rq.distrato_refund_id is not null then
    update public.distrato_refunds set status = 'pedida', decision_note = 'O estorno pelo Asaas caiu sem autorização: peça de novo ou use o Pix da conta da unidade.'
     where id = rq.distrato_refund_id and status = 'autorizada';
  end if;
  perform public._notify_users('estorno_caiu', f.id::text, array[f.requested_by] || public._refund_confirmers(f.clinic_id) || public._admins_and_finance(), f.clinic_id,
    case when p_status = 'caiu' then 'Estorno caiu sem autorização' else 'Estorno recusado pelo titular' end,
    'O estorno de ' || public.brl(coalesce(f.amount_cents, c.paid_cents)) || ' não aconteceu. A cobrança continua paga.'
      || case when rq.distrato_refund_id is not null then ' A devolução do distrato voltou para "pedir": peça de novo ou use o Pix da conta da unidade.' else '' end,
    '/prontuarios/' || c.client_id::text);
end;
$$;

-- Os pedidos parados por falta de saldo (o servidor confere o saldo de novo).
create or replace function public._refund_requests_blocked()
returns table (request_id uuid, kind text, account_id uuid, hq_account_id uuid, needed_cents bigint, requested_by uuid)
language sql stable security definer set search_path = '' as $$
  select r.id, r.kind, x.gateway_account_id,
         (select a.id from public.gateway_accounts a where a.owner_type = 'franchisor' and a.status = 'active' order by a.created_at limit 1),
         coalesce(r.amount_cents, 0), r.requested_by
    from public.refund_requests r
    left join lateral (select c.gateway_account_id from public.charges c
                        where c.id = r.charge_id or (r.installment_block is not null and c.installment_block = r.installment_block) limit 1) x on true
   where r.status = 'sem_saldo' and r.balance_notice_at is null;
$$;

create or replace function public._refund_request_balance_back(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.refund_requests%rowtype;
begin
  select * into r from public.refund_requests where id = p_id for update;
  if r.id is null or r.balance_notice_at is not null then return; end if;
  update public.refund_requests set balance_notice_at = now() where id = r.id;
  perform public._notify_users('estorno_disponivel', r.id::text, array[r.requested_by], r.clinic_id,
    'O estorno pelo Asaas voltou a ficar disponível', 'Peça o estorno de novo pela ficha.', '/prontuarios/' || r.client_id::text);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) A LEITURA DA FICHA
-- -----------------------------------------------------------------------------
create or replace function public.refund_requests_read(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'charge_id', r.charge_id, 'block', r.installment_block, 'kind', r.kind,
             'amount_cents', r.amount_cents, 'partial', r.partial, 'reason', r.reason, 'status', r.status,
             'requested_at', r.requested_at, 'requested_by', (select full_name from public.profiles where id = r.requested_by),
             'confirmed_by', (select full_name from public.profiles where id = r.confirmed_by), 'confirmed_at', r.confirmed_at,
             'expected_split', r.expected_split, 'actual_split', r.actual_split, 'split_differs', r.split_differs,
             'can_confirm', r.status = 'confirmar' and r.requested_by <> v_user
                            and (public.is_admin_master() or public.has_role_in_clinic(r.clinic_id, array['unit_manager', 'franchisee']::public.user_role[])),
             'can_cancel', r.status in ('confirmar', 'enviar', 'sem_saldo')
                            and (r.requested_by = v_user or public._charge_refund_can(r.clinic_id)))
           order by r.requested_at desc)
      from public.refund_requests r
     where r.client_id = p_client_id and public.can_see_receivables(r.clinic_id)), '[]'::jsonb);
end;
$$;

-- As parcelas encerradas por estorno (cuidado 3), para a ficha mostrar "Estornada" e o "Reabrir".
create or replace function public.installments_refund_closed(p_client_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'seq', i.seq, 'due_date', i.due_date, 'amount_cents', i.amount_cents, 'closed_at', i.refund_closed_at,
           'can_reopen', public.is_admin_master() or public.has_role_in_clinic(i.clinic_id, array['unit_manager']::public.user_role[]))
         order by i.due_date), '[]'::jsonb)
    from public.payment_installments i
   where i.client_id = p_client_id and i.status = 'cancelada' and i.refund_closed_at is not null
     and public.can_see_receivables(i.clinic_id);
$$;

-- O limite da confirmação, para a Central (quem configura a rede).
create or replace function public.card_refund_limit_read()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  return (select jsonb_build_object('cents', card_refund_confirm_above_cents) from public.gateway_split_settings where id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) REDEFINIÇÕES: o aviso do Asaas, a recusa e a devolução do distrato
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._gateway_apply_event(p_event_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.gateway_webhook_events%rowtype;
  p jsonb;
  v_ref text;
  c public.charges%rowtype;
  v_link text;
  v_other boolean;
  v_rec public.payment_receipts%rowtype;
begin
  select * into e from public.gateway_webhook_events w where w.id = p_event_id;

  -- Chave e situação da conta: aviso ao Admin.
  if e.event like 'ACCESS_TOKEN_%' or e.event like 'ACCOUNT_STATUS_%' then
    perform public._gateway_notify_admins(e.account_id, lower(e.event), e.asaas_event_id,
      'Asaas: atenção na conta',
      'O Asaas avisou: ' || e.event || '. Confira a conta na Central de Configuração.');
    return 'aviso_admin';
  end if;
  if e.event not like 'PAYMENT_%' then return 'sem_efeito'; end if;
  if e.event like 'PAYMENT_SPLIT_%' then return 'registrado_asa3'; end if;

  p := e.payload->'payment';
  if p is null then return 'ignorado_sem_cobranca'; end if;
  v_ref := p->>'externalReference';
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'ignorado_fora_do_riszon';
  end if;
  select * into c from public.charges ch where ch.id = v_ref::uuid and ch.gateway_account_id = e.account_id for update;
  if not found then return 'ignorado_fora_do_riszon'; end if;
  if c.asaas_payment_id is not null and c.asaas_payment_id <> coalesce(p->>'id', '') then
    return 'ignorado_outra_cobranca';
  end if;
  update public.gateway_webhook_events set charge_id = c.id where id = e.id;
  if c.asaas_payment_id is null then
    update public.charges set asaas_payment_id = p->>'id' where id = c.id;
  end if;
  v_link := '/prontuarios/' || c.client_id::text;
  -- 4021 (ASA6): a cobrança mensal da rede tem o ramo dela.
  if c.source_type = 'franchise_monthly' and to_regprocedure('public._franchise_monthly_event(uuid,text,jsonb)') is not null then
    return public._franchise_monthly_event(c.id, e.event, p);
  end if;

  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    return public._gateway_on_paid(c.id, case when e.event = 'PAYMENT_CONFIRMED' then 'PAYMENT_CONFIRMED' else 'PAYMENT_RECEIVED' end, p);

  elsif e.event = 'PAYMENT_OVERDUE' then
    if c.status = 'emitida' then
      update public.charges set status = 'vencida', last_event_at = now() where id = c.id;
      return 'vencida';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_DELETED' then
    if c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
      update public.charges
         set status = 'cancelada', cancelled_at = now(), cancelled_by = null,
             cancel_reason = 'Apagada no painel do Asaas', last_event_at = now()
       where id = c.id;
      perform public._gateway_notify(c.gateway_account_id, 'apagada_no_asaas', c.id::text, c.clinic_id, true, false, true,
        'Cobrança apagada no Asaas',
        'Uma cobrança emitida pelo riSZon foi apagada direto no painel do Asaas. A parcela voltou a aceitar nova cobrança.',
        v_link);
      return 'cancelada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_RESTORED' then
    select exists (
      select 1 from public.charges o
       where o.payment_installment_id = c.payment_installment_id and o.id <> c.id
         and o.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa')
    ) into v_other;
    if c.status = 'cancelada' and c.cancel_reason = 'Apagada no painel do Asaas' and not v_other
       and exists (select 1 from public.payment_installments i
                    where i.id = c.payment_installment_id and i.status in ('em_aberto', 'parcial')) then
      update public.charges
         set status = case when c.due_date < public.today_br() then 'vencida' else 'emitida' end,
             cancelled_at = null, cancel_reason = null, last_event_at = now()
       where id = c.id;
      return 'restaurada';
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'restaurada_no_asaas', c.id::text, c.clinic_id, true, false, true,
      'Cobrança restaurada no Asaas',
      'Uma cobrança foi restaurada no painel do Asaas, mas a parcela já tem outra cobrança ou não está em aberto. Confira e cancele a que sobrar.',
      v_link);
    return 'restaurada_so_aviso';

  elsif e.event = 'PAYMENT_UPDATED' then
    if round(coalesce((p->>'value')::numeric, 0) * 100) <> coalesce(c.value_cents, 0)
       or (p->>'dueDate')::date is distinct from c.due_date then
      perform public._gateway_notify(c.gateway_account_id, 'alterada_no_asaas', e.asaas_event_id, c.clinic_id, true, false, true,
        'Cobrança alterada no Asaas',
        'Uma cobrança emitida pelo riSZon teve valor ou vencimento alterado direto no painel do Asaas. O riSZon não segue a mudança; o pagamento segue a regra do valor a maior ou a menor.',
        v_link);
      return 'alterada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_REFUNDED' then
    -- 4018: a mensalidade estornada continua como paga; a unidade decide desfazer a baixa.
    if c.source_type <> 'installment' then
      if c.status in ('paga', 'liquidada', 'em_contestacao') then
        update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
      end if;
      -- 4020 (19.35.8): o estorno da mensalidade do PPR+ tira os pontos do Riso+ Social dela.
      if c.source_type = 'ppr_charge' then
        delete from public.ppr_social_points sp
         using public.ppr_charges pc
         where pc.id = c.source_id and sp.membership_id = pc.membership_id and sp.reference_month = pc.reference_month;
      end if;
      perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
        'Estorno de mensalidade no Asaas',
        'Uma mensalidade paga pelo Asaas foi estornada. Ela continua marcada como paga: desfaça a baixa à mão, se for o caso.',
        v_link);
      return 'estornada';
    end if;
    if c.receipt_id is not null then
      select * into v_rec from public.payment_receipts r where r.id = c.receipt_id;
      if not v_rec.reversed then
        perform public._gateway_reverse_receipt(c.receipt_id, 'Estorno no Asaas');
      end if;
    end if;
    if c.status in ('paga', 'liquidada', 'em_contestacao') then
      update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
      'Estorno no Asaas',
      'Um pagamento pelo Asaas foi estornado. A baixa foi desfeita e a parcela voltou a ficar em aberto; a taxa da rede continua devida (pode ser dispensada pelo Financeiro).',
      v_link);
    return 'estornada';

  elsif e.event = 'PAYMENT_PARTIALLY_REFUNDED'
        and to_regprocedure('public._charge_refund_partial_event(uuid,jsonb)') is not null
        and exists (select 1 from public.charge_refunds f where f.charge_id = c.id and f.status = 'pedido' and f.amount_cents is not null) then
    -- 4020a: o estorno parcial pedido pelo riSZon (o pedido fecha, com o comprovante).
    return public._charge_refund_partial_event(c.id, p);

  elsif e.event in ('PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE') then
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), e.asaas_event_id, c.clinic_id, true, true, true,
      'Asaas: estorno para tratar à mão',
      'O Asaas avisou ' || e.event || ' numa cobrança do riSZon. O Financeiro trata à mão.',
      v_link);
    return 'aviso_manual';

  elsif e.event in ('PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL') then
    if c.status in ('paga', 'liquidada') then
      update public.charges set status = 'em_contestacao', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), c.id::text, c.clinic_id, true, true, true,
      'Contestação no cartão',
      'O pagador contestou no cartão uma cobrança do riSZon (' || e.event || '). O Financeiro acompanha e trata à mão.',
      v_link);
    return 'contestacao';
  end if;

  return 'sem_efeito';
end;
$function$;

CREATE OR REPLACE FUNCTION public._gateway_event_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.charges%rowtype;
  v_ref text := new.payload->'payment'->>'externalReference';
begin
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  select * into c from public.charges where id = v_ref::uuid and gateway_account_id = new.account_id;
  if not found then return null; end if;
  if new.event = 'PAYMENT_REFUNDED' then
    perform public._gateway_split_refunded(c.id);
    update public.charge_refunds set status = 'concluido', finished_at = now(), asaas_status = 'DONE'
     where charge_id = c.id and status = 'pedido';
    update public.charges set refund_state = null where id = c.id;
    perform public._charge_refund_mark_mobile_clear(c.id);
    update public.gateway_webhook_events set result = coalesce(result, '') || '+split' where id = new.id and c.split_applied;
  elsif new.event = 'PAYMENT_REFUND_DENIED' then
    -- 4020a: o pedido do riSZon recusado volta tudo (e, no distrato, a devolução volta para "pedir").
    if exists (select 1 from public.charge_refunds f where f.charge_id = c.id and f.status = 'pedido' and f.request_id is not null) then
      perform public._refund_fell((select f.id from public.charge_refunds f where f.charge_id = c.id and f.status = 'pedido' and f.request_id is not null limit 1), 'negado');
    else
      perform public._charge_refund_closed(c.id, 'negado', 'negado pelo Asaas');
    end if;
    update public.gateway_webhook_events set result = 'estorno_negado' where id = new.id;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.distrato_refund_request(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_c public.plan_cancellations%rowtype;
  v_amount bigint := (p ->> 'amount_cents')::bigint;
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_path text := nullif(btrim(p ->> 'term_path'), '');
  v_already bigint;
  v_id uuid;
  v_user uuid := (select auth.uid());
  v_method text := coalesce(nullif(p ->> 'method', ''), 'pix_unidade');
  v_charge public.charges%rowtype;
begin
  select * into v_c from public.plan_cancellations where id = (p ->> 'cancellation_id')::uuid;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public._is_manager_or_admin(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status <> 'efetivado' then raise exception 'NOT_APPLIED'; end if;
  if length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if v_path is null or public.clinic_of_storage_path(v_path) is distinct from v_c.clinic_id
     or not exists (select 1 from storage.objects o where o.bucket_id = 'devolucoes' and o.name = v_path) then
    raise exception 'TERM_REQUIRED';
  end if;
  select coalesce(sum(r.amount_cents), 0) into v_already
    from public.distrato_refunds r where r.cancellation_id = v_c.id and r.status <> 'negada';
  if coalesce(v_amount, 0) <= 0 or v_amount > v_c.clinic_refunds_cents - v_already then
    raise exception 'AMOUNT_OVER_BALANCE';
  end if;
  -- 4020a: o estorno pelo Asaas primeiro, numa cobrança paga do cliente (Pix ou cartão).
  if v_method = 'estorno_asaas' then
    select * into v_charge from public.charges where id = (p ->> 'charge_id')::uuid;
    if v_charge.id is null or v_charge.client_id is distinct from v_c.client_id or v_charge.status not in ('paga', 'liquidada')
       or v_charge.asaas_payment_id is null or v_charge.is_external or v_charge.billing_type not in ('PIX', 'CREDIT_CARD') then
      raise exception 'CHARGE_NOT_REFUNDABLE';
    end if;
    if public._refund_left_cents(v_charge.id) < v_amount then raise exception 'AMOUNT_OVER_CHARGE'; end if;
  elsif v_method <> 'pix_unidade' then
    raise exception 'INVALID_METHOD';
  end if;
  insert into public.distrato_refunds (clinic_id, cancellation_id, client_id, amount_cents, reason, term_path, term_name, requested_by, method, charge_id)
  values (v_c.clinic_id, v_c.id, v_c.client_id, v_amount, v_reason, v_path, nullif(btrim(p ->> 'term_name'), ''), v_user, v_method, v_charge.id)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_c.clinic_id, 'create', 'distrato_refund', v_id::text,
          jsonb_build_object('distrato', v_c.code, 'amount_cents', v_amount, 'reason', v_reason));
  perform public._notify_users('distrato_devolucao_pedida', v_id::text, public._admins_and_finance(), v_c.clinic_id,
    'Devolução do distrato para autorizar',
    'Pedido de devolução ao paciente de ' || public.brl(v_amount) || ' no distrato ' || coalesce(v_c.code, '')
      || case when v_method = 'estorno_asaas' then ', pelo estorno no Asaas da cobrança paga.' else ', por Pix da conta da unidade.' end
      || ' Confira o termo assinado e autorize ou negue.',
    '/financeiro/cobrancas-automaticas');
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.distrato_refund_decide(p_id uuid, p_approve boolean, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.distrato_refunds%rowtype;
  v_c public.plan_cancellations%rowtype;
  v_user uuid := (select auth.uid());
  v_payable uuid;
  v_nome text;
  v_req uuid;
  v_ch public.charges%rowtype;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.distrato_refunds where id = p_id for update;
  if not found then raise exception 'RETURN_NOT_FOUND'; end if;
  if r.status <> 'pedida' then raise exception 'RETURN_ALREADY_DECIDED'; end if;
  if r.requested_by = v_user then raise exception 'SELF_APPROVAL'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_c from public.plan_cancellations where id = r.cancellation_id;
  if p_approve and r.method = 'estorno_asaas' then
    -- 4020a: autorizado pelo Financeiro (a confirmação do cartão), o pedido vai ao Asaas pelo servidor.
    select * into v_ch from public.charges where id = r.charge_id;
    insert into public.refund_requests (clinic_id, client_id, charge_id, kind, amount_cents, partial, reason, requested_by,
      needs_confirm, confirmed_by, confirmed_at, status, distrato_refund_id)
    values (r.clinic_id, r.client_id, v_ch.id, case v_ch.billing_type when 'PIX' then 'pix' else 'cartao' end,
      case when r.amount_cents < public._refund_left_cents(v_ch.id) then r.amount_cents end,
      r.amount_cents < public._refund_left_cents(v_ch.id), 'Devolução do distrato ' || coalesce(v_c.code, '') || ': ' || r.reason,
      r.requested_by, false, v_user, now(), 'enviar', r.id)
    returning id into v_req;
  elsif p_approve then
    select full_name into v_nome from public.clients where id = r.client_id;
    insert into public.payables (clinic_id, account_code, description, reference, accrual_date, due_date,
                                 amount_cents, status, notes, created_by)
    values (r.clinic_id, '1.9.03',
            'Devolução ao paciente — distrato ' || coalesce(v_c.code, '') || coalesce(' — ' || v_nome, ''),
            coalesce(v_c.code, 'DEV-' || left(r.id::text, 8)), public.today_br(), public.today_br() + 5,
            r.amount_cents, 'aberta',
            'Pagar por Pix da conta da unidade e anexar o comprovante. O recebimento original não é desfeito e a taxa da rede continua devida. Termo assinado: ' || r.term_path,
            v_user)
    returning id into v_payable;
  end if;
  update public.distrato_refunds
     set status = case when p_approve then 'autorizada' else 'negada' end,
         decided_by = v_user, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         payable_id = v_payable
   where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, r.clinic_id, 'update', 'distrato_refund', p_id::text,
          jsonb_build_object('approve', p_approve, 'note', p_note, 'payable_id', v_payable));
  perform public._notify_users('distrato_devolucao_decidida', p_id::text, array[r.requested_by], r.clinic_id,
    case when p_approve then 'Devolução do distrato autorizada' else 'Devolução do distrato negada' end,
    case when p_approve and r.method = 'estorno_asaas' then 'A devolução vai pelo estorno no Asaas. Quando o Asaas concluir, ela fica "Paga pelo Asaas".'
         when p_approve then 'A devolução virou conta a pagar da unidade (Contas a pagar). Pague pelo Pix da conta da unidade e anexe o comprovante.'
         else 'A devolução foi negada: ' || coalesce(p_note, '') end,
    '/prontuarios/' || r.client_id::text);
  return coalesce(v_req, v_payable);
end;
$function$;

-- -----------------------------------------------------------------------------
-- 9) PERMISSÕES
-- -----------------------------------------------------------------------------
revoke execute on function public.card_refund_limit_save(bigint) from public, anon, authenticated;
revoke execute on function public._refund_left_cents(uuid) from public, anon, authenticated;
revoke execute on function public._refund_block_split(uuid, bigint) from public, anon, authenticated;
revoke execute on function public._refund_needs_confirm(text, bigint) from public, anon, authenticated;
revoke execute on function public._refund_confirmers(uuid) from public, anon, authenticated;
revoke execute on function public.refund_request_preview(jsonb) from public, anon, authenticated;
revoke execute on function public.refund_request_create(jsonb) from public, anon, authenticated;
revoke execute on function public.refund_request_confirm(uuid) from public, anon, authenticated;
revoke execute on function public.refund_request_cancel(uuid, text) from public, anon, authenticated;
revoke execute on function public._refund_request_for_send(uuid) from public, anon, authenticated;
revoke execute on function public._refund_request_sent(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._charge_refund_partial_event(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._refund_close_installment() from public, anon, authenticated;
revoke execute on function public.installment_refund_reopen(uuid, text) from public, anon, authenticated;
revoke execute on function public._refund_regua_list() from public, anon, authenticated;
revoke execute on function public._refund_regua_notice(uuid, text) from public, anon, authenticated;
revoke execute on function public._refund_fell(uuid, text) from public, anon, authenticated;
revoke execute on function public._refund_requests_blocked() from public, anon, authenticated;
revoke execute on function public._refund_request_balance_back(uuid) from public, anon, authenticated;
revoke execute on function public.refund_requests_read(uuid) from public, anon, authenticated;
revoke execute on function public.installments_refund_closed(uuid) from public, anon, authenticated;
revoke execute on function public.card_refund_limit_read() from public, anon, authenticated;
grant execute on function public.card_refund_limit_save(bigint) to authenticated;
grant execute on function public.refund_request_preview(jsonb) to authenticated;
grant execute on function public.refund_request_create(jsonb) to authenticated;
grant execute on function public.refund_request_confirm(uuid) to authenticated;
grant execute on function public.refund_request_cancel(uuid, text) to authenticated;
grant execute on function public.installment_refund_reopen(uuid, text) to authenticated;
grant execute on function public.refund_requests_read(uuid) to authenticated;
grant execute on function public.installments_refund_closed(uuid) to authenticated;
grant execute on function public.card_refund_limit_read() to authenticated;
revoke execute on function public.distrato_refund_request(jsonb) from public, anon, authenticated;
grant execute on function public.distrato_refund_request(jsonb) to authenticated;
revoke execute on function public.distrato_refund_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.distrato_refund_decide(uuid, boolean, text) to authenticated;

select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'refund_requests') as tabela_nova,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('refund_request_create', 'refund_request_confirm', 'refund_request_cancel', 'refund_request_preview', '_refund_request_sent',
                      '_charge_refund_partial_event', 'installment_refund_reopen', '_refund_fell', '_refund_regua_notice')) as funcoes_novas,
  (select card_refund_confirm_above_cents is null from public.gateway_split_settings where id) as limite_em_branco,
  position('_charge_refund_partial_event' in pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure)) > 0 as aviso_ligado;
