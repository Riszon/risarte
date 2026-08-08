-- =============================================================================
-- 0207 — O CANCELAMENTO APARECE NO COCKPIT DO CONSULTOR
-- -----------------------------------------------------------------------------
-- Achado ao responder "onde eu clico para cancelar?" (07/08/2026): a 0206
-- cancelava a negociação, movia o cliente para a Fase 6/7 e **não tocava no
-- cartão do cockpit comercial**.
--
-- Consequência: o caso sumia. `commercialColumnOf` deriva a coluna do
-- `commercial_cards.stage`; sem marcar 'cancelado', um plano cancelado não
-- caía na coluna **Cancelado** do Histórico — ficava fora do quadro e fora do
-- histórico, como se nunca tivesse existido.
--
-- Também registra o cancelamento na linha do tempo do cartão, que é onde o
-- Consultor lê a história do caso.
-- Idempotente.
-- =============================================================================

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
  update public.commercial_cards set
    stage = 'cancelado',
    outcome_reason = v_c.reason,
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

  perform public.commercial_log_card_event(
    v_card, v_c.client_id, v_c.clinic_id, 'cancelamento',
    'TRATAMENTO CANCELADO — ' || v_c.reason
      || case when v_c.client_owes_cents > 0
              then '. Paciente deve R$ ' || (v_c.client_owes_cents / 100)::text
              when v_c.clinic_refunds_cents > 0
              then '. Clínica devolve R$ ' || (v_c.clinic_refunds_cents / 100)::text
              else '. Sem saldo entre as partes' end);

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

-- Reparo: cancelamentos já efetivados antes desta migração marcam o cartão.
do $$
declare
  r record;
  v_card uuid;
begin
  for r in
    select c.* from public.plan_cancellations c
    where c.status = 'efetivado'
  loop
    v_card := public.commercial_ensure_card(r.client_id);
    update public.commercial_cards
       set stage = 'cancelado',
           outcome_reason = coalesce(outcome_reason, r.reason),
           updated_at = now()
     where id = v_card and stage <> 'cancelado';
  end loop;
end $$;

select
  (select count(*) from public.plan_cancellations where status = 'efetivado')
    as cancelamentos_efetivados,
  (select count(*) from public.commercial_cards where stage = 'cancelado')
    as cartoes_no_cancelado;
