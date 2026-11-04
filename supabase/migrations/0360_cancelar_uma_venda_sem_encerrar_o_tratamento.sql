-- =============================================================================
-- 0360 — CANCELAR UMA VENDA SEM ENCERRAR O TRATAMENTO QUE CONTINUA (AP107)
--
-- Decisões do dono (04/11/2026), K1–K3 em docs/comercial/AP63-AP64-PLANO.md §7:
--   * K1: um cancelamento POR VENDA (plano original ou complemento N).
--   * K2: cancelar só o complemento — o cliente fica na Fase 5.
--   * K3: cancelar o plano original NÃO cancela o complemento; o cliente segue
--     em tratamento e só vai à Fase 6 ou 7 quando terminar o complemento.
--
-- A regra: o cancelamento só leva o cliente à Fase 6/7 (e só marca o cartão do
-- Comercial como "cancelado") quando NÃO sobra outra venda em tratamento —
-- outra venda fechada, não cancelada, com sessão ainda por fazer. Senão, cancela
-- só aquela venda: as sessões do plano dela e as cobranças dela, como sempre.
--
-- O que muda:
--   1) `_outra_venda_em_tratamento` (interna) — a regra acima;
--   2) `open_plan_cancellation` (0206): sem destino de fase quando outra venda
--      segue em tratamento;
--   3) `apply_plan_cancellation` (0207): idem — não move a fase, não marca o
--      cartão como cancelado e não manda o aviso de reavaliação/retorno.
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1) Há outra venda em tratamento? -----------------------------------------------
create or replace function public._outra_venda_em_tratamento(p_client_id uuid, p_negotiation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plan_negotiations n
    join public.commercial_sales s on s.negotiation_id = n.id
    where n.client_id = p_client_id
      and n.id <> p_negotiation_id
      and n.status = 'aceita'
      and s.closed_at is not null
      and s.cancelled_at is null
      and exists (
        select 1 from public.treatment_sessions ts
        where ts.plan_id = n.plan_id and ts.status in ('pending', 'scheduled')
      )
  );
$$;
revoke execute on function public._outra_venda_em_tratamento(uuid, uuid) from public, anon, authenticated;

-- 2) Abrir o termo: sem destino quando outra venda segue -------------------------
-- A definição em vigor (0206), com as trocas marcadas "AP107".
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
    case when v_closed and not v_outra then p_destination else null end,
    case when v_closed and not v_outra and p_destination = 'follow_up' then p_return_date end,
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

revoke execute on function public.open_plan_cancellation(uuid, text, text, date, text) from public, anon, authenticated;
grant execute on function public.open_plan_cancellation(uuid, text, text, date, text) to authenticated;

-- 3) Efetivar: a fase e o cartão só mudam quando não sobra tratamento -----------
-- A definição em vigor (0207), com as trocas marcadas "AP107".
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

-- Conferência (só leitura) ------------------------------------------------------
select
  to_regprocedure('public._outra_venda_em_tratamento(uuid, uuid)') is not null as regra_existe,
  position('v_outra' in pg_get_functiondef('public.open_plan_cancellation(uuid, text, text, date, text)'::regprocedure)) > 0
    and position('v_outra' in pg_get_functiondef('public.apply_plan_cancellation(uuid)'::regprocedure)) > 0
    as abrir_e_efetivar_conhecem_a_regra,
  has_function_privilege('anon', 'public.apply_plan_cancellation(uuid)', 'execute') as sem_login_esperado_false;
