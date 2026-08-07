-- =============================================================================
-- 0206 — CANCELAMENTO DE PLANO DE TRATAMENTO: TERMO, ACERTO E DESTINO
-- -----------------------------------------------------------------------------
-- A 0205 mandava todo cancelamento para a Fase 4 e RECUSAVA cancelar quando já
-- havia recebimento. O dono corrigiu as duas coisas (07/08/2026):
--
--   • Fase 4 é o lugar de quem NÃO fechou. Quem já estava em tratamento não
--     volta para a fila comercial como se fosse caso novo: vai para a
--     **Fase 6 (reavaliação)** ou **Fase 7 (acompanhamento, com data de
--     retorno)** — quem decide é o Gerente, no ato do cancelamento.
--   • Recusar por causa de dinheiro recebido era fugir do problema. Agora
--     existe um **TERMO DE CANCELAMENTO** que apura o acerto e é **assinado
--     pelo cliente** — é ele que resolve quem deve a quem.
--
-- O FLUXO TEM TRÊS PASSOS, e nada é destruído antes do último:
--   1) APURAR   — calcula e congela o acerto (rascunho);
--   2) ASSINAR  — o cliente assina o termo (manual, como o resto do fechamento);
--   3) EFETIVAR — só aqui sessões, cobranças e fase mudam.
-- Desistiu no meio? `discard_plan_cancellation` joga fora sem estrago.
--
-- REGRAS DE DINHEIRO (dono, 07/08/2026):
--   • Realizado é cobrado COM o desconto que o cliente tinha.
--   • Multa de rescisão é percentual configurável, **padrão 0%**, e incide
--     sobre o NÃO EXECUTADO (o que a clínica deixou de faturar).
--   • Cliente devendo → nasce uma cobrança nova. Clínica devendo → nasce uma
--     CONTA A PAGAR em nome do cliente; a forma de devolver é decidida no
--     Financeiro (estorno automático em cartão dependeria da adquirente).
--
-- LIMITE: o sistema NÃO lê o contrato assinado (não há texto armazenado). Ele
-- aplica as regras acima e CITA o contrato de origem; divergência é conciliada
-- por gente, no campo de observações.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Configuração: multa de rescisão (cascata rede → unidade)
-- -----------------------------------------------------------------------------
alter table public.commercial_rules
  add column if not exists cancellation_penalty_percent numeric(5,2)
    check (cancellation_penalty_percent is null
           or (cancellation_penalty_percent >= 0
               and cancellation_penalty_percent <= 100));

comment on column public.commercial_rules.cancellation_penalty_percent is
  'Multa de rescisão sobre o NÃO EXECUTADO. Nula/zero = sem multa (padrão). '
  'A multa compensa a agenda perdida — não pune o que já foi entregue.';

create or replace function public.cancellation_penalty_percent(p_clinic uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.cancellation_penalty_percent from public.commercial_rules u
      where u.clinic_id = p_clinic),
    (select n.cancellation_penalty_percent from public.commercial_rules n
      where n.clinic_id is null),
    0);
$$;

grant execute on function public.cancellation_penalty_percent(uuid) to authenticated;

-- Fase 7 passa a saber QUANDO o cliente volta.
alter table public.clients
  add column if not exists follow_up_return_at date;

comment on column public.clients.follow_up_return_at is
  'Data combinada de retorno no Acompanhamento. Sem isto o caso some do radar '
  'da unidade — ninguém sabe quando ligar.';

-- -----------------------------------------------------------------------------
-- 2) O TERMO
-- -----------------------------------------------------------------------------
create table if not exists public.plan_cancellations (
  id uuid primary key default gen_random_uuid(),
  code text,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  negotiation_id uuid not null references public.plan_negotiations (id),
  plan_id uuid,

  reason text not null,
  notes text,
  -- 'reevaluation' | 'follow_up'; nulo quando a venda nem chegou a fechar.
  destination text check (destination in ('reevaluation', 'follow_up')),
  follow_up_return_at date,

  -- ACERTO CONGELADO no momento da apuração. Reajuste de tabela ou nova baixa
  -- depois disso não reescreve um termo já assinado.
  contract_cents bigint not null default 0,
  list_total_cents bigint not null default 0,
  executed_list_cents bigint not null default 0,
  executed_cents bigint not null default 0,
  pending_cents bigint not null default 0,
  penalty_percent numeric(5,2) not null default 0,
  penalty_cents bigint not null default 0,
  due_cents bigint not null default 0,
  paid_cents bigint not null default 0,
  reversed_cents bigint not null default 0,
  client_owes_cents bigint not null default 0,
  clinic_refunds_cents bigint not null default 0,

  status text not null default 'rascunho'
    check (status in ('rascunho', 'assinado', 'efetivado', 'descartado')),
  term_signed_at timestamptz,
  term_signed_by uuid references public.profiles (id),
  applied_at timestamptz,
  applied_by uuid references public.profiles (id),
  discarded_at timestamptz,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists plan_cancellations_client_idx
  on public.plan_cancellations (client_id, created_at desc);
-- Uma apuração viva por negociação (rascunho ou assinada aguardando efetivação).
create unique index if not exists plan_cancellations_open_unique
  on public.plan_cancellations (negotiation_id)
  where status in ('rascunho', 'assinado');

comment on table public.plan_cancellations is
  'Termo de cancelamento de plano: o acerto de contas congelado + a assinatura '
  'do cliente. Nada do tratamento é desfeito antes de status = efetivado.';

alter table public.plan_cancellations enable row level security;

drop policy if exists "plan_cancellations_select" on public.plan_cancellations;
create policy "plan_cancellations_select" on public.plan_cancellations
  for select to authenticated
  using (clinic_id in (select public.user_full_access_clinic_ids()));

drop policy if exists "plan_cancellations_write" on public.plan_cancellations;
create policy "plan_cancellations_write" on public.plan_cancellations
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(
         clinic_id, array['unit_manager']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(
         clinic_id, array['unit_manager']::public.user_role[])
  );

-- Código do termo: CN-00001, mesma família de VD/PT/RN.
create or replace function public.next_cancellation_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  select coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), ''))::int, 0) + 1
    into v
  from public.plan_cancellations where code like 'CN-%';
  -- lpad TRUNCA quando o número é maior que a largura (lição da 0191).
  return 'CN-' || lpad(v::text, greatest(5, length(v::text)), '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) APURAR — calcula e congela, sem desfazer nada
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

  -- Venda fechada exige destino; acompanhamento exige data de retorno.
  if v_closed then
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
    client_owes_cents, clinic_refunds_cents, created_by
  ) values (
    public.next_cancellation_code(), v_neg.clinic_id, v_neg.client_id,
    p_negotiation_id, v_neg.plan_id,
    btrim(p_reason), nullif(btrim(p_notes), ''),
    case when v_closed then p_destination else null end,
    case when v_closed and p_destination = 'follow_up' then p_return_date end,
    coalesce(v_neg.final_cents, 0), v_list, v_exec_list,
    v_executed, v_pending, v_pct, v_penalty,
    v_due, v_paid, v_reversed,
    greatest(0, v_diff), greatest(0, -v_diff), v_user
  )
  returning id into v_id;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'create', 'plan_cancellation', v_id::text,
          jsonb_build_object('destination', p_destination, 'closed', v_closed));

  return v_id;
end;
$$;

grant execute on function public.open_plan_cancellation(uuid, text, text, date, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) ASSINAR / DESCARTAR
-- -----------------------------------------------------------------------------
create or replace function public.sign_plan_cancellation(
  p_id uuid,
  p_signed boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_user uuid := (select auth.uid());
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_c.clinic_id, array['unit_manager']::public.user_role[])
  ) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status = 'efetivado' then raise exception 'ALREADY_APPLIED'; end if;

  update public.plan_cancellations set
    status = case when p_signed then 'assinado' else 'rascunho' end,
    term_signed_at = case when p_signed then now() else null end,
    term_signed_by = case when p_signed then v_user else null end
  where id = p_id;
end;
$$;

grant execute on function public.sign_plan_cancellation(uuid, boolean) to authenticated;

create or replace function public.discard_plan_cancellation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c record;
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_c.clinic_id, array['unit_manager']::public.user_role[])
  ) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status = 'efetivado' then raise exception 'ALREADY_APPLIED'; end if;

  update public.plan_cancellations
     set status = 'descartado', discarded_at = now()
   where id = p_id;
end;
$$;

grant execute on function public.discard_plan_cancellation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) EFETIVAR — só aqui o tratamento é desfeito
-- -----------------------------------------------------------------------------
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
  v_inst uuid;
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if v_c.status = 'efetivado' then raise exception 'ALREADY_APPLIED'; end if;
  -- O termo assinado é a condição — sem ele nada é desfeito.
  if v_c.status <> 'assinado' then raise exception 'TERM_NOT_SIGNED'; end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_c.clinic_id, array['unit_manager']::public.user_role[])
  ) then raise exception 'NOT_ALLOWED'; end if;

  select * into v_neg from public.plan_negotiations where id = v_c.negotiation_id;

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

  -- Cobranças em aberto morrem; o saldo real vira uma cobrança nova abaixo.
  update public.payment_installments set status = 'cancelada'
   where negotiation_id = v_c.negotiation_id and status = 'em_aberto';

  -- CLIENTE DEVENDO: uma cobrança nova, com 15 dias para pagar.
  if v_c.client_owes_cents > 0 then
    insert into public.payment_installments
      (clinic_id, client_id, negotiation_id, seq, kind, due_date,
       amount_cents, payment_method, created_by)
    values (v_c.clinic_id, v_c.client_id, v_c.negotiation_id, 999, 'parcela',
            public.today_br() + 15, v_c.client_owes_cents,
            v_neg.payment_method, v_user)
    returning id into v_inst;
  end if;

  -- CLÍNICA DEVENDO: conta a pagar em nome do cliente. A FORMA de devolver é
  -- decidida no Financeiro — estorno automático em cartão dependeria da
  -- adquirente e nem sempre é possível.
  if v_c.clinic_refunds_cents > 0 then
    select full_name into v_client_name from public.clients where id = v_c.client_id;
    insert into public.payables
      (clinic_id, account_code, description, reference, accrual_date, due_date,
       amount_cents, status, notes, created_by)
    values (
      -- 1.9.03 (Cancelamentos e estornos), não 1.9.02: devolver dinheiro por
      -- cancelamento não é desconto comercial concedido.
      v_c.clinic_id, '1.9.03',
      'Devolução ao paciente — cancelamento ' || coalesce(v_c.code, ''),
      coalesce(v_c.code, ''), public.today_br(), public.today_br() + 15,
      v_c.clinic_refunds_cents, 'aberta',
      'Termo de cancelamento assinado. Definir a forma de devolução com o '
        || 'paciente (o meio original nem sempre aceita estorno).',
      v_user);
  end if;

  -- DESTINO: quem fechou vai para Reavaliação ou Acompanhamento. Quem não
  -- fechou continua onde está (Fase 4) — não há tratamento a encerrar.
  if v_c.destination is not null then
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
    and v_c.destination is not null;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_c.clinic_id, 'update', 'plan_cancellation_apply',
          p_id::text,
          jsonb_build_object('owes', v_c.client_owes_cents,
                             'refunds', v_c.clinic_refunds_cents,
                             'destination', v_c.destination));
end;
$$;

grant execute on function public.apply_plan_cancellation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) A 0205 saiu de cena: cancelar agora passa pelo termo
-- -----------------------------------------------------------------------------
drop function if exists public.cancel_negotiation(uuid, text);

select
  (select count(*) from public.plan_cancellations) as termos_de_cancelamento,
  (select public.cancellation_penalty_percent(null)) as multa_padrao_da_rede,
  (select count(*) from public.clients where follow_up_return_at is not null)
    as clientes_com_retorno_marcado;
