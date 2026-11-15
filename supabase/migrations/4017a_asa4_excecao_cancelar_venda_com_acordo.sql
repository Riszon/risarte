-- =============================================================================
-- 4017a — A EXCEÇÃO: CANCELAR VENDA COM ACORDO DE RENEGOCIAÇÃO
-- (docs/integracao-asaas.md 19.30; aprovada pelo Jeferson em 15/11/2026: 1a,
--  2a, 3b, 4a e as confirmações da 19.30.7)
-- =============================================================================
-- A 4015a recusa o cancelamento da venda que tem parcelas num acordo que ainda
-- não vale ou que tem parcela em aberto. Esta migração dá o caminho:
--   * acordo que AINDA NÃO VALE: quem pode renegociar cancela o acordo (a porta
--     da 4017) e o cancelamento segue normal — nada muda aqui;
--   * acordo ASSINADO, de UMA venda só, com parcela em aberto: o Gerente da
--     unidade ou o Admin Master PEDE a exceção; só o Financeiro da Franqueadora
--     ou o Admin Master AUTORIZA, e nunca quem pediu (SELF_APPROVAL). Vale 7
--     dias, uma vez, e cai se o acordo mudar;
--   * com a exceção: o termo de cancelamento conta como pago também o que o
--     cliente pagou no acordo (a cadeia inteira); ao efetivar, as parcelas do
--     acordo em aberto são canceladas e o acordo fica "encerrado";
--   * venda direta: só se o cliente não pagou nada no acordo (o resto, distrato);
--   * acordo que junta outras vendas: sem exceção (distrato).
-- A taxa da rede sobre o que foi pago continua devida (D13).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O acordo pode ficar "encerrado pelo cancelamento da venda"
-- -----------------------------------------------------------------------------
alter table public.payment_renegotiations drop constraint if exists payment_renegotiations_status_check;
alter table public.payment_renegotiations add constraint payment_renegotiations_status_check
  check (status in ('aplicada', 'aguardando_autorizacao', 'recusada', 'cancelada',
                    'aguardando_assinatura', 'nao_assinada', 'expirada', 'cancelada_pagamento', 'encerrada'));

alter table public.plan_cancellations add column if not exists agreement_paid_cents bigint not null default 0;
alter table public.plan_cancellations add column if not exists agreement_card_pending_cents bigint not null default 0;
alter table public.plan_cancellations add column if not exists exception_id uuid;

-- -----------------------------------------------------------------------------
-- 2) OS ACORDOS DA VENDA (a cadeia: acordo de acordo), com o aberto e o pago
-- -----------------------------------------------------------------------------
create or replace function public._sale_agreements(p_negotiation_id uuid, p_direct_sale_id uuid)
returns table (
  renegotiation_id uuid, code text, status text, pendente boolean, multi_venda boolean,
  aberto_cents bigint, pago_cents bigint, cartao_a_receber_cents bigint, abertas uuid[]
)
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
  todos as (
    select c.reneg_id as id from cadeia c
    union
    select r.id from public.payment_renegotiations r
     where r.status in ('aguardando_autorizacao', 'aguardando_assinatura')
       and exists (select 1 from public.payment_installments i
                    where i.id = any(r.source_installment_ids)
                      and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
                        or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id)))
  )
  select r.id, r.code, r.status,
         r.status in ('aguardando_autorizacao', 'aguardando_assinatura'),
         -- junta outra venda? (as vendas de origem não são só esta)
         exists (select 1 from unnest(r.origin_negotiation_ids) x where x is distinct from p_negotiation_id)
           or exists (select 1 from unnest(r.origin_direct_sale_ids) y where y is distinct from p_direct_sale_id)
           or (r.flow = 'legado' and exists (
                select 1 from public.payment_installments s
                 where s.renegotiated_by_id = r.id
                   and s.renegotiation_id is null
                   and not ((p_negotiation_id is not null and s.negotiation_id = p_negotiation_id)
                         or (p_direct_sale_id is not null and s.direct_sale_id = p_direct_sale_id)))),
         coalesce((select sum(b.total_rem) from public.payment_installments k
                    cross join lateral public.installment_balance(k.id, public.today_br()) b
                   where k.renegotiation_id = r.id and k.status in ('em_aberto', 'parcial')), 0)::bigint,
         coalesce((select sum(rc.amount_cents) from public.payment_receipts rc
                    join public.payment_installments k on k.id = rc.installment_id
                   where k.renegotiation_id = r.id and not coalesce(rc.reversed, false) and rc.reversal_of is null), 0)::bigint,
         coalesce((select sum(ch.value_cents) from public.charges ch
                    join public.payment_installments k on k.id = ch.payment_installment_id
                   where k.renegotiation_id = r.id and ch.installment_block is not null and ch.status = 'paga'), 0)::bigint,
         coalesce((select array_agg(k.id order by k.id) from public.payment_installments k
                   where k.renegotiation_id = r.id and k.status in ('em_aberto', 'parcial')), '{}'::uuid[])
    from todos t
    join public.payment_renegotiations r on r.id = t.id;
$$;
revoke execute on function public._sale_agreements(uuid, uuid) from public, anon, authenticated;

-- A tela do cancelamento recusado: os acordos e o caminho de cada um.
create or replace function public.sale_agreements_read(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select coalesce((select n.clinic_id from public.plan_negotiations n where n.id = p_negotiation_id),
                  (select s.clinic_id from public.direct_sales s where s.id = p_direct_sale_id)) into v_clinic;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  if not public.can_receive_payment(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  return jsonb_build_object(
    'pode_pedir', public._is_manager_or_admin(v_clinic),
    'acordos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.renegotiation_id, 'codigo', a.code, 'situacao', a.status, 'pendente', a.pendente,
        'multi_venda', a.multi_venda, 'aberto', a.aberto_cents, 'pago', a.pago_cents,
        'cartao_a_receber', a.cartao_a_receber_cents) order by a.code)
      from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a
     where a.pendente or array_length(a.abertas, 1) is not null), '[]'::jsonb),
    'excecao', (select jsonb_build_object('id', e.id, 'situacao',
                  case when e.status = 'autorizada' and public._sale_cancel_exception_valid(p_negotiation_id, p_direct_sale_id) is null
                       then 'caiu' else e.status end,
                  'valida_ate', e.valid_until, 'nota', e.decision_note)
                  from public.sale_cancel_exceptions e
                 where ((p_negotiation_id is not null and e.negotiation_id = p_negotiation_id)
                     or (p_direct_sale_id is not null and e.direct_sale_id = p_direct_sale_id))
                 order by e.requested_at desc limit 1));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) O PEDIDO, A DECISÃO E A VALIDADE
-- -----------------------------------------------------------------------------
create table if not exists public.sale_cancel_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  negotiation_id uuid references public.plan_negotiations (id),
  direct_sale_id uuid references public.direct_sales (id),
  agreement_ids uuid[] not null default '{}',
  -- A foto no pedido: as parcelas em aberto e o pago (se mudar, a autorização cai).
  open_installment_ids uuid[] not null default '{}',
  paid_cents bigint not null default 0,
  reason text not null check (length(btrim(reason)) >= 5),
  status text not null default 'pedida' check (status in ('pedida', 'autorizada', 'negada', 'usada')),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  valid_until date,
  used_at timestamptz,
  check ((negotiation_id is null) <> (direct_sale_id is null))
);
create index if not exists sale_cancel_exceptions_sale_idx on public.sale_cancel_exceptions (negotiation_id, direct_sale_id, requested_at desc);
create index if not exists sale_cancel_exceptions_open_idx on public.sale_cancel_exceptions (status) where status = 'pedida';
alter table public.sale_cancel_exceptions enable row level security;
drop policy if exists "sale_cancel_exceptions_select" on public.sale_cancel_exceptions;
create policy "sale_cancel_exceptions_select" on public.sale_cancel_exceptions
  for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor() or public._is_manager_or_admin(clinic_id));
comment on table public.sale_cancel_exceptions is
  '4017a (19.30): pedido de exceção para cancelar venda com acordo de renegociação assinado e em aberto. Pede o Gerente ou o Admin; autoriza o Financeiro da Franqueadora ou o Admin, nunca quem pediu. Vale 7 dias, uma vez.';

-- A autorização ainda vale para esta venda? (autorizada, no prazo, não usada, sem
-- acordo pendente e com o acordo igual ao do pedido). Devolve o id ou nulo.
create or replace function public._sale_cancel_exception_valid(p_negotiation_id uuid, p_direct_sale_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
    from public.sale_cancel_exceptions e
   where ((p_negotiation_id is not null and e.negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and e.direct_sale_id = p_direct_sale_id))
     and e.status = 'autorizada' and e.used_at is null and e.valid_until >= public.today_br()
     and not exists (select 1 from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a where a.pendente)
     and not exists (select 1 from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a where a.multi_venda)
     and coalesce((select array_agg(x order by x) from (
            select unnest(a.abertas) x from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a) t), '{}'::uuid[])
         = coalesce((select array_agg(x order by x) from unnest(e.open_installment_ids) x), '{}'::uuid[])
     and coalesce((select sum(a.pago_cents) from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a), 0) = e.paid_cents
   order by e.decided_at desc
   limit 1;
$$;
revoke execute on function public._sale_cancel_exception_valid(uuid, uuid) from public, anon, authenticated;

create or replace function public.sale_cancel_exception_request(p_negotiation_id uuid, p_direct_sale_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_ids uuid[];
  v_abertas uuid[];
  v_pago bigint;
  v_users uuid[];
  v_codigos text;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  select coalesce((select n.clinic_id from public.plan_negotiations n where n.id = p_negotiation_id),
                  (select s.clinic_id from public.direct_sales s where s.id = p_direct_sale_id)) into v_clinic;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  -- 3b: só o Gerente da unidade ou o Admin Master pede.
  if not public._is_manager_or_admin(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if exists (select 1 from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a where a.pendente) then
    raise exception 'PENDING_FIRST';
  end if;
  if exists (select 1 from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a where a.multi_venda) then
    raise exception 'MULTI_SALE';
  end if;
  select coalesce(array_agg(a.renegotiation_id), '{}'), coalesce(sum(a.pago_cents), 0)
    into v_ids, v_pago
    from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a;
  select coalesce(array_agg(x order by x), '{}') into v_abertas
    from (select unnest(a.abertas) x from public._sale_agreements(p_negotiation_id, p_direct_sale_id) a) t;
  if array_length(v_abertas, 1) is null then raise exception 'NOTHING_OPEN'; end if;
  -- 2a: na venda direta, só se o cliente não pagou nada no acordo.
  if p_direct_sale_id is not null and v_pago > 0 then raise exception 'DIRECT_SALE_PAID'; end if;
  if exists (select 1 from public.sale_cancel_exceptions e
              where ((p_negotiation_id is not null and e.negotiation_id = p_negotiation_id)
                  or (p_direct_sale_id is not null and e.direct_sale_id = p_direct_sale_id))
                and (e.status = 'pedida'
                     or (e.status = 'autorizada' and e.used_at is null and e.valid_until >= public.today_br()))) then
    raise exception 'ALREADY_REQUESTED';
  end if;
  insert into public.sale_cancel_exceptions (clinic_id, negotiation_id, direct_sale_id, agreement_ids,
                                             open_installment_ids, paid_cents, reason, requested_by)
  values (v_clinic, p_negotiation_id, p_direct_sale_id, v_ids, v_abertas, v_pago, btrim(p_reason), v_user)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'sale_cancel_exception', v_id::text,
          jsonb_build_object('acordos', v_ids, 'pago_no_acordo', v_pago, 'motivo', btrim(p_reason)));
  -- 4a: aviso ao Financeiro da Franqueadora (rede) e aos Admin Master.
  select coalesce(array_agg(distinct u), '{}') into v_users from (
    select ucr.user_id u from public.user_clinic_roles ucr where ucr.role = 'finance_franchisor'
    union select p.id from public.profiles p where p.is_admin_master and p.is_active) x
   where u is distinct from v_user;
  select string_agg(coalesce(r.code, ''), ', ') into v_codigos from public.payment_renegotiations r where r.id = any(v_ids);
  perform public._notify_users('excecao_cancelamento', v_id::text, v_users, v_clinic,
    'Pedido de exceção: cancelar venda com acordo ' || coalesce(v_codigos, ''),
    'Motivo: ' || btrim(p_reason) || '. Decida em Financeiro › Cobranças automáticas.',
    '/financeiro/cobrancas-automaticas');
  return v_id;
end;
$$;
revoke execute on function public.sale_cancel_exception_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sale_cancel_exception_request(uuid, uuid, text) to authenticated;

create or replace function public.sale_cancel_exception_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.sale_cancel_exceptions%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into e from public.sale_cancel_exceptions where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_finance_franchisor() or public.is_admin_master()) then raise exception 'NOT_ALLOWED'; end if;
  -- Quem pediu não autoriza o próprio pedido, nem sendo Admin Master.
  if e.requested_by = v_user then raise exception 'SELF_APPROVAL'; end if;
  if e.status <> 'pedida' then raise exception 'NOT_PENDING'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  update public.sale_cancel_exceptions
     set status = case when p_approve then 'autorizada' else 'negada' end,
         decided_by = v_user, decided_at = now(), decision_note = nullif(btrim(p_note), ''),
         valid_until = case when p_approve then public.today_br() + 7 end
   where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, e.clinic_id, 'update', 'sale_cancel_exception', p_id::text,
          jsonb_build_object('decisao', case when p_approve then 'autorizada' else 'negada' end, 'nota', p_note));
  perform public._notify_users('excecao_cancelamento_decidida', p_id::text, array[e.requested_by], e.clinic_id,
    case when p_approve then 'Exceção autorizada: o cancelamento pode seguir (vale 7 dias, uma vez)'
         else 'Exceção negada: o cancelamento da venda com acordo continua recusado' end,
    coalesce(nullif(btrim(p_note), ''), 'Sem observações.'),
    coalesce('/prontuarios/' || (select n.client_id from public.plan_negotiations n where n.id = e.negotiation_id)::text,
             '/prontuarios/' || (select s.client_id from public.direct_sales s where s.id = e.direct_sale_id)::text));
end;
$$;
revoke execute on function public.sale_cancel_exception_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.sale_cancel_exception_decide(uuid, boolean, text) to authenticated;

-- A fila (4a): o Financeiro da Franqueadora e o Admin veem a rede; o Gerente, a sua unidade.
create or replace function public.sale_cancel_exceptions_read()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'unidade', c.name, 'cliente', cl.full_name,
    'venda', coalesce(n.code, s.code), 'tipo', case when e.negotiation_id is not null then 'plano' else 'venda_direta' end,
    'acordos', (select string_agg(coalesce(r.code, ''), ', ') from public.payment_renegotiations r where r.id = any(e.agreement_ids)),
    'aberto', (select coalesce(sum(a.aberto_cents), 0) from public._sale_agreements(e.negotiation_id, e.direct_sale_id) a),
    'pago', e.paid_cents, 'motivo', e.reason, 'situacao', e.status,
    'quem_pediu', (select p.full_name from public.profiles p where p.id = e.requested_by),
    'pedido_em', e.requested_at, 'valida_ate', e.valid_until, 'nota', e.decision_note,
    'pode_decidir', e.status = 'pedida' and (public.is_finance_franchisor() or public.is_admin_master())
                    and e.requested_by is distinct from (select auth.uid()))
    order by (e.status = 'pedida') desc, e.requested_at desc), '[]'::jsonb)
    from public.sale_cancel_exceptions e
    join public.clinics c on c.id = e.clinic_id
    left join public.plan_negotiations n on n.id = e.negotiation_id
    left join public.direct_sales s on s.id = e.direct_sale_id
    left join public.clients cl on cl.id = coalesce(n.client_id, s.client_id)
   where (public.is_admin_master() or public.is_finance_franchisor() or public._is_manager_or_admin(e.clinic_id))
     and (e.status = 'pedida' or e.requested_at > now() - interval '30 days');
$$;
revoke execute on function public.sale_cancel_exceptions_read() from public, anon, authenticated;
grant execute on function public.sale_cancel_exceptions_read() to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A TRAVA DA 4015a deixa seguir com a exceção autorizada e válida
-- -----------------------------------------------------------------------------
create or replace function public._open_agreement_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes text[];
begin
  if coalesce(current_setting('risarte.cancelar_com_acordo', true), '') = '1' then
    return new;
  end if;
  if tg_table_name = 'plan_cancellations' then
    if public._sale_cancel_exception_valid(new.negotiation_id, null) is not null then return new; end if;
    v_codes := public._sale_open_agreements(new.negotiation_id, null);
  elsif tg_table_name = 'commercial_sales' then
    if old.cancelled_at is not null or new.cancelled_at is null then return new; end if;
    if public._sale_cancel_exception_valid(new.negotiation_id, null) is not null then return new; end if;
    v_codes := public._sale_open_agreements(new.negotiation_id, null);
  elsif tg_table_name = 'direct_sales' then
    if coalesce(old.cancelled, false) or not coalesce(new.cancelled, false) then return new; end if;
    if public._sale_cancel_exception_valid(null, new.id) is not null then return new; end if;
    v_codes := public._sale_open_agreements(null, new.id);
  end if;
  if array_length(v_codes, 1) is not null then
    raise exception 'RENEGOTIATED_OPEN: %', array_to_string(v_codes, ', ');
  end if;
  return new;
end;
$$;
revoke execute on function public._open_agreement_guard() from public, anon, authenticated;

-- Encerra os acordos da venda (com a exceção): cancela as parcelas em aberto
-- e marca o acordo e a exceção. O servidor já cancelou os boletos no Asaas.
create or replace function public._sale_agreements_close(p_negotiation_id uuid, p_direct_sale_id uuid, p_exception_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  a record;
begin
  for a in select * from public._sale_agreements(p_negotiation_id, p_direct_sale_id) loop
    update public.payment_installments set status = 'cancelada'
     where renegotiation_id = a.renegotiation_id and status in ('em_aberto', 'parcial');
    get diagnostics v_n = row_count;
    perform set_config('risarte.motivo_renegociacao', 'encerrado pelo cancelamento da venda (exceção autorizada)', true);
    update public.payment_renegotiations
       set status = 'encerrada', ended_at = now(), ended_by = p_actor,
           end_reason = 'Encerrado pelo cancelamento da venda, com a exceção autorizada pelo Financeiro.'
     where id = a.renegotiation_id and status = 'aplicada';
  end loop;
  update public.sale_cancel_exceptions set status = 'usada', used_at = now() where id = p_exception_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  select p_actor, e.clinic_id, 'update', 'sale_cancel_exception', p_exception_id::text,
         jsonb_build_object('usada', true, 'acordos', e.agreement_ids, 'parcelas_canceladas', e.open_installment_ids, 'pago_no_acordo', e.paid_cents)
    from public.sale_cancel_exceptions e where e.id = p_exception_id;
  return v_n;
end;
$$;
revoke execute on function public._sale_agreements_close(uuid, uuid, uuid, uuid) from public, anon, authenticated;


revoke execute on function public.sale_agreements_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sale_agreements_read(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) O CANCELAMENTO COM A EXCEÇÃO (o texto de hoje, da 0360 e da 0180, com os
--    pontos da 4017a marcados)
-- -----------------------------------------------------------------------------
create or replace function public.open_plan_cancellation(
  p_negotiation_id uuid,
  p_reason text,
  p_destination text default null,
  p_return_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_sale record;
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_closed boolean;
  v_list bigint := 0;
  v_exec_list bigint := 0;
  v_paid bigint := 0;
  v_reversed bigint := 0;
  v_ratio numeric;
  v_executed bigint;
  v_pending bigint;
  v_pct numeric;
  v_penalty bigint;
  v_due bigint;
  v_diff bigint;
  v_outra boolean;
  -- 4017a: a exceção autorizada e o pago no acordo
  v_exc uuid;
  v_agr_paid bigint := 0;
  v_agr_card bigint := 0;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;

  -- Cancelar tratamento é ato de gestão.
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_neg.clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if exists (select 1 from public.plan_cancellations
             where negotiation_id = p_negotiation_id
               and status in ('rascunho', 'assinado')) then
    raise exception 'ALREADY_OPEN';
  end if;
  if v_neg.status = 'cancelada' then raise exception 'ALREADY_CANCELLED'; end if;

  select * into v_sale from public.commercial_sales
   where negotiation_id = p_negotiation_id;
  v_closed := v_sale.id is not null and v_sale.closed_at is not null;

  -- AP107 (0360): se o cliente segue em tratamento com OUTRA venda (o plano
  -- original ou um complemento), cancelar esta não muda a fase — sem destino.
  v_outra := public._outra_venda_em_tratamento(v_neg.client_id, p_negotiation_id);

  -- Venda fechada exige destino; acompanhamento exige data de retorno.
  if v_closed and not v_outra then
    if p_destination is null then raise exception 'DESTINATION_REQUIRED'; end if;
    if p_destination not in ('reevaluation', 'follow_up') then
      raise exception 'INVALID_DESTINATION';
    end if;
    if p_destination = 'follow_up' and p_return_date is null then
      raise exception 'RETURN_DATE_REQUIRED';
    end if;
  end if;

  -- Itens contratados, a preço de TABELA (base da proporção do desconto).
  select coalesce(sum(oi.quantity * oi.unit_price_cents), 0) into v_list
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items oi on oi.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and ni.included
    and oi.option_id = v_neg.option_id;

  -- O que JÁ FOI EXECUTADO, também a preço de tabela. Sessão concluída é
  -- histórico clínico: o paciente passou por ela e ela é devida.
  select coalesce(sum(oi.unit_price_cents), 0) into v_exec_list
  from public.treatment_sessions ts
  join public.treatment_plan_option_items oi on oi.id = ts.item_id
  where ts.plan_id = v_neg.plan_id
    and ts.status = 'done'
    and oi.option_id = v_neg.option_id;

  -- Dinheiro que entrou (baixas ativas) e o que já foi estornado antes.
  select coalesce(sum(r.amount_cents) filter
           (where not r.reversed and r.reversal_of is null), 0),
         coalesce(sum(r.amount_cents) filter (where r.reversal_of is not null), 0)
    into v_paid, v_reversed
  from public.payment_receipts r
  join public.payment_installments i on i.id = r.installment_id
  where i.negotiation_id = p_negotiation_id;

  -- 4017a (19.30.3): com a exceção autorizada, o "pago" do acerto inclui o que
  -- o cliente pagou nas parcelas do acordo (a cadeia inteira). O cartão
  -- parcelado aprovado conta inteiro (a baixa nasce na aprovação).
  v_exc := public._sale_cancel_exception_valid(p_negotiation_id, null);
  if v_exc is not null then
    select coalesce(sum(a.pago_cents), 0), coalesce(sum(a.cartao_a_receber_cents), 0)
      into v_agr_paid, v_agr_card
      from public._sale_agreements(p_negotiation_id, null) a;
    v_paid := v_paid + v_agr_paid;
  end if;

  -- O ACERTO (espelha src/lib/finance/cancellation.ts).
  v_ratio := case when v_list > 0
                  then coalesce(v_neg.final_cents, 0)::numeric / v_list
                  else 1 end;
  v_executed := least(coalesce(v_neg.final_cents, 0),
                      round(v_exec_list * v_ratio));
  v_pending := greatest(0, coalesce(v_neg.final_cents, 0) - v_executed);
  v_pct := public.cancellation_penalty_percent(v_neg.clinic_id);
  v_penalty := case when v_pct > 0 then round(v_pending * v_pct / 100.0) else 0 end;
  v_due := v_executed + v_penalty;
  v_diff := v_due - v_paid;

  insert into public.plan_cancellations (
    code, clinic_id, client_id, negotiation_id, plan_id,
    reason, notes, destination, follow_up_return_at,
    contract_cents, list_total_cents, executed_list_cents,
    executed_cents, pending_cents, penalty_percent, penalty_cents,
    due_cents, paid_cents, reversed_cents,
    client_owes_cents, clinic_refunds_cents, created_by,
    agreement_paid_cents, agreement_card_pending_cents, exception_id
  ) values (
    public.next_cancellation_code(), v_neg.clinic_id, v_neg.client_id,
    p_negotiation_id, v_neg.plan_id,
    btrim(p_reason), nullif(btrim(p_notes), ''),
    case when v_closed and not v_outra then p_destination else null end,
    case when v_closed and not v_outra and p_destination = 'follow_up' then p_return_date end,
    coalesce(v_neg.final_cents, 0), v_list, v_exec_list,
    v_executed, v_pending, v_pct, v_penalty,
    v_due, v_paid, v_reversed,
    greatest(0, v_diff), greatest(0, -v_diff), v_user,
    v_agr_paid, v_agr_card, v_exc
  )
  returning id into v_id;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'create', 'plan_cancellation', v_id::text,
          jsonb_build_object('destination', p_destination, 'closed', v_closed));

  return v_id;
end;
$$;
revoke execute on function public.open_plan_cancellation(uuid, text, text, date, text) from public, anon, authenticated;
grant execute on function public.open_plan_cancellation(uuid, text, text, date, text) to authenticated;

create or replace function public.apply_plan_cancellation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_neg record;
  v_user uuid := (select auth.uid());
  v_client_name text;
  v_phase text;
  v_card uuid;
  v_outra boolean;
  v_exc uuid;
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if v_c.status = 'efetivado' then raise exception 'ALREADY_APPLIED'; end if;
  if v_c.status <> 'assinado' then raise exception 'TERM_NOT_SIGNED'; end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_c.clinic_id, array['unit_manager']::public.user_role[])
  ) then raise exception 'NOT_ALLOWED'; end if;

  -- 4017a: o termo aberto com a exceção só é efetivado se ela ainda valer
  -- (no prazo, não usada, e o acordo igual ao do pedido).
  if v_c.exception_id is not null then
    v_exc := public._sale_cancel_exception_valid(v_c.negotiation_id, null);
    if v_exc is distinct from v_c.exception_id then raise exception 'EXCEPTION_INVALID'; end if;
  end if;

  select * into v_neg from public.plan_negotiations where id = v_c.negotiation_id;
  -- AP107 (0360): outra venda segue em tratamento? Então só esta é cancelada.
  v_outra := public._outra_venda_em_tratamento(v_c.client_id, v_c.negotiation_id);

  update public.plan_negotiations
     set status = 'cancelada', updated_at = now()
   where id = v_c.negotiation_id;

  update public.commercial_sales set
    cancelled_at = now(), cancelled_by = v_user,
    cancel_reason = v_c.reason, updated_at = now()
  where negotiation_id = v_c.negotiation_id and cancelled_at is null;

  -- O que JÁ FOI FEITO não é desfeito: é histórico clínico do paciente.
  update public.treatment_sessions set
    status = 'cancelled', appointment_id = null
  where plan_id = v_c.plan_id and status not in ('cancelled', 'done');

  update public.payment_installments set status = 'cancelada'
   where negotiation_id = v_c.negotiation_id and status = 'em_aberto';

  -- 4017a: com a exceção, as parcelas do acordo em aberto são canceladas e o
  -- acordo fica encerrado (o servidor já cancelou os boletos no Asaas).
  if v_c.exception_id is not null then
    perform public._sale_agreements_close(v_c.negotiation_id, null, v_c.exception_id, v_user);
  end if;

  if v_c.client_owes_cents > 0 then
    insert into public.payment_installments
      (clinic_id, client_id, negotiation_id, seq, kind, due_date,
       amount_cents, payment_method, created_by)
    values (v_c.clinic_id, v_c.client_id, v_c.negotiation_id, 999, 'parcela',
            public.today_br() + 15, v_c.client_owes_cents,
            v_neg.payment_method, v_user);
  end if;

  if v_c.clinic_refunds_cents > 0 then
    insert into public.payables
      (clinic_id, account_code, description, reference, accrual_date, due_date,
       amount_cents, status, notes, created_by)
    values (
      v_c.clinic_id, '1.9.03',
      'Devolução ao paciente — cancelamento ' || coalesce(v_c.code, ''),
      coalesce(v_c.code, ''), public.today_br(), public.today_br() + 15,
      v_c.clinic_refunds_cents, 'aberta',
      'Termo de cancelamento assinado. Definir a forma de devolução com o '
        || 'paciente (o meio original nem sempre aceita estorno).',
      v_user);
  end if;

  -- 0207: O COCKPIT PRECISA SABER. Sem isto o caso sumia do quadro E do
  -- histórico — a coluna "Cancelado" lê o stage do cartão, não a negociação.
  v_card := public.commercial_ensure_card(v_c.client_id);
  -- AP107: o cartão só fica "cancelado" quando não sobra tratamento.
  if not v_outra then
    update public.commercial_cards set
      stage = 'cancelado',
      outcome_reason = v_c.reason,
      updated_by = v_user,
      updated_at = now()
    where id = v_card;
  end if;

  perform public.commercial_log_card_event(
    v_card, v_c.client_id, v_c.clinic_id, 'cancelamento',
    case when v_outra then 'VENDA CANCELADA (o tratamento segue com a outra venda) — '
         else 'TRATAMENTO CANCELADO — ' end || v_c.reason
      || case when v_c.client_owes_cents > 0
              then '. Paciente deve R$ ' || (v_c.client_owes_cents / 100)::text
              when v_c.clinic_refunds_cents > 0
              then '. Clínica devolve R$ ' || (v_c.clinic_refunds_cents / 100)::text
              else '. Sem saldo entre as partes' end);

  if v_c.destination is not null and not v_outra then
    v_phase := case when v_c.destination = 'reevaluation'
                    then 'reevaluation' else 'follow_up' end;

    update public.journey_phase_history set exited_at = now()
    where client_id = v_c.client_id and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_c.client_id, v_c.clinic_id, v_phase::public.journey_phase, v_user);
    update public.clients set
      journey_phase = v_phase::public.journey_phase,
      phase_entered_at = now(),
      follow_up_return_at = case when v_c.destination = 'follow_up'
                                 then v_c.follow_up_return_at
                                 else follow_up_return_at end
    where id = v_c.client_id;
  end if;

  update public.plan_cancellations
     set status = 'efetivado', applied_at = now(), applied_by = v_user
   where id = p_id;

  select full_name into v_client_name from public.clients where id = v_c.client_id;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_c.clinic_id,
    case when v_c.destination = 'reevaluation'
         then 'Cancelamento — agendar REAVALIAÇÃO'
         else 'Cancelamento — agendar RETORNO do acompanhamento' end,
    coalesce(v_client_name, 'Cliente') || ' teve o tratamento cancelado ('
      || v_c.reason || ').'
      || case when v_c.destination = 'follow_up' and v_c.follow_up_return_at is not null
              then ' Retorno combinado para '
                   || to_char(v_c.follow_up_return_at, 'DD/MM/YYYY') || '.'
              else ' Agende a reavaliação com o Coordenador Clínico.' end,
    '/prontuarios/' || v_c.client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_c.clinic_id
    and ucr.role in ('receptionist', 'clinical_coordinator', 'unit_manager')
    and ucr.user_id is distinct from v_user
    and v_c.destination is not null
    and not v_outra;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_c.clinic_id, 'update', 'plan_cancellation_apply',
          p_id::text,
          jsonb_build_object('owes', v_c.client_owes_cents,
                             'refunds', v_c.clinic_refunds_cents,
                             'destination', v_c.destination));
end;
$$;
revoke execute on function public.apply_plan_cancellation(uuid) from public, anon, authenticated;
grant execute on function public.apply_plan_cancellation(uuid) to authenticated;

create or replace function public.cancel_direct_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
  v_user uuid := (select auth.uid());
  v_exc uuid;
begin
  select * into v_sale from public.direct_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'NOT_FOUND'; end if;
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_sale.clinic_id,
         array['receptionist','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- 4017a: a exceção autorizada (lida antes de a venda mudar).
  v_exc := public._sale_cancel_exception_valid(null, p_sale_id);

  update public.direct_sales set
    cancelled = true,
    status = 'cancelada',
    cancelled_at = now(),
    cancelled_by = v_user,
    updated_at = now()
  where id = p_sale_id;

  -- Os procedimentos da venda deixam de valer: saem de "concluído"/"em aberto"
  -- e ficam CANCELADOS (o histórico continua visível, mas não conta como feito
  -- nem aparece como pendente para agendar).
  update public.treatment_sessions set
    status = 'cancelled',
    done_at = null,
    executed_by = null,
    appointment_id = null
  where direct_sale_id = p_sale_id
    and status <> 'cancelled';

  -- Venda cancelada devolve o benefício do programa (a limpeza volta a estar
  -- liberada, por exemplo).
  delete from public.ppr_benefit_usages where direct_sale_id = p_sale_id;

  -- As cobranças da venda cancelada também deixam de existir (o Financeiro não
  -- deve cobrar por venda cancelada).
  update public.payment_installments set status = 'cancelada'
   where direct_sale_id = p_sale_id and status = 'em_aberto';

  -- 4017a: com a exceção (o cliente não pagou nada no acordo), as parcelas do
  -- acordo em aberto são canceladas e o acordo fica encerrado.
  if v_exc is not null then
    perform public._sale_agreements_close(null, p_sale_id, v_exc, v_user);
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_cancel',
          p_sale_id::text, jsonb_build_object('sessions_cancelled', true));
end;
$$;
revoke execute on function public.cancel_direct_sale(uuid) from public, anon, authenticated;
grant execute on function public.cancel_direct_sale(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_sale_agreements', 'sale_agreements_read', '_sale_cancel_exception_valid', 'sale_cancel_exception_request',
      'sale_cancel_exception_decide', 'sale_cancel_exceptions_read', '_sale_agreements_close')) as funcoes_novas,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'sale_cancel_exceptions') as tabelas_novas,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'plan_cancellations'
    and column_name in ('agreement_paid_cents', 'agreement_card_pending_cents', 'exception_id')) as colunas_novas,
  position('_sale_agreements_close' in pg_get_functiondef('public.apply_plan_cancellation(uuid)'::regprocedure)) > 0
    and position('_sale_agreements_close' in pg_get_functiondef('public.cancel_direct_sale(uuid)'::regprocedure)) > 0
    and position('v_agr_paid' in pg_get_functiondef('public.open_plan_cancellation(uuid, text, text, date, text)'::regprocedure)) > 0
    as cancelamento_com_excecao;
