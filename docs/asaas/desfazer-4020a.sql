-- DESFAZER a 4020a (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
-- Volta as quatro funções que a 4020a redefine às versões que estão na produção
-- antes dela (4020 e 4009), e tira o gatilho da parcela "Estornada".
-- As tabelas e colunas novas (refund_requests, o limite da Central, as colunas de
-- charge_refunds e de payment_installments) FICAM, vazias ou sem uso: não apagam dado.
-- Atenção: as funções novas da 4020a continuam existindo, mas nada as chama depois
-- do desfazer; a tela antiga (0.480.0) não usa nenhuma delas.

drop trigger if exists zz_payment_receipts_refund_close on public.payment_receipts;

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

create or replace function public._gateway_event_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    perform public._charge_refund_closed(c.id, 'negado', 'negado pelo Asaas');
    update public.gateway_webhook_events set result = 'estorno_negado' where id = new.id;
  end if;
  return null;
end;
$$;

create or replace function public.distrato_refund_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.plan_cancellations%rowtype;
  v_amount bigint := (p ->> 'amount_cents')::bigint;
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_path text := nullif(btrim(p ->> 'term_path'), '');
  v_already bigint;
  v_id uuid;
  v_user uuid := (select auth.uid());
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
  insert into public.distrato_refunds (clinic_id, cancellation_id, client_id, amount_cents, reason, term_path, term_name, requested_by)
  values (v_c.clinic_id, v_c.id, v_c.client_id, v_amount, v_reason, v_path, nullif(btrim(p ->> 'term_name'), ''), v_user)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_c.clinic_id, 'create', 'distrato_refund', v_id::text,
          jsonb_build_object('distrato', v_c.code, 'amount_cents', v_amount, 'reason', v_reason));
  perform public._notify_users('distrato_devolucao_pedida', v_id::text, public._admins_and_finance(), v_c.clinic_id,
    'Devolução do distrato para autorizar',
    'Pedido de devolução ao paciente de ' || public.brl(v_amount) || ' no distrato ' || coalesce(v_c.code, '')
      || ', por Pix da conta da unidade. Confira o termo assinado e autorize ou negue.',
    '/financeiro/cobrancas-automaticas');
  return v_id;
end;
$$;

create or replace function public.distrato_refund_decide(p_id uuid, p_approve boolean, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.distrato_refunds%rowtype;
  v_c public.plan_cancellations%rowtype;
  v_user uuid := (select auth.uid());
  v_payable uuid;
  v_nome text;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.distrato_refunds where id = p_id for update;
  if not found then raise exception 'RETURN_NOT_FOUND'; end if;
  if r.status <> 'pedida' then raise exception 'RETURN_ALREADY_DECIDED'; end if;
  if r.requested_by = v_user then raise exception 'SELF_APPROVAL'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_c from public.plan_cancellations where id = r.cancellation_id;
  if p_approve then
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
    case when p_approve then 'A devolução virou conta a pagar da unidade (Contas a pagar). Pague pelo Pix da conta da unidade e anexe o comprovante.'
         else 'A devolução foi negada: ' || coalesce(p_note, '') end,
    '/prontuarios/' || r.client_id::text);
  return v_payable;
end;
$$;


notify pgrst, 'reload schema';

select (select count(*) from pg_trigger where tgname = 'zz_payment_receipts_refund_close') as gatilho_restante,
       position('_charge_refund_partial_event' in pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure)) = 0 as aviso_desligado;
