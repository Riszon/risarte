-- DESFAZER a 4021 (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
-- Volta as três funções que a 4021 redefine às versões que estão na produção antes
-- dela (a apuração das contas de taxa da 4018b, a leitura da cobrança para o Asaas da
-- 4018 e o aviso do Asaas da 4020a), e tira o gatilho da cobrança mensal.
-- As tabelas, a coluna payable_payments.franchise_batch_id, o CHECK do pagador e a
-- pasta dos demonstrativos FICAM (vazios): não apagam dado.
-- Rode ANTES o desfazer da 4021a, se a 4021a já estiver na produção.

drop trigger if exists charges_franchise_monthly_sync on public.charges;

CREATE OR REPLACE FUNCTION public.refresh_network_fee_payable(p_clinic_id uuid, p_fee text, p_period date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cfg record;
  v_acc record;
  v_total bigint;
  v_payable uuid;
  v_due date;
  v_franchisor uuid;
  v_label text := public.network_fee_label(p_fee);
begin
  select * into v_cfg from public.network_fee_for(p_clinic_id, p_fee, p_period);
  if v_cfg is null then return; end if;
  select * into v_acc from public.network_fee_accounts(p_fee);
  if v_acc is null then return; end if;

  if v_cfg.kind = 'percent' then
    -- ASA3: o que o split reteve na origem não é cobrado de novo.
    select coalesce(sum(amount_cents - retained_cents), 0) into v_total
      from public.split_charges
     where clinic_id = p_clinic_id and fee = p_fee
       and period_month = p_period and not reversed;
  else
    v_total := case when v_cfg.active then v_cfg.amount_cents else 0 end;
  end if;

  v_due := (p_period + interval '1 month')::date
           + (coalesce(v_cfg.due_day, 10) - 1);

  select id into v_payable from public.payables
   where clinic_id = p_clinic_id and network_fee = p_fee
     and fee_period = p_period;

  -- 4018b: a conta cancelada À MÃO (por quem decide, com o motivo) não volta
  -- sozinha — nem pelo "Gerar taxas fixas do mês", nem pela apuração de um
  -- recebimento. Só a cancelada pela própria apuração ("Sem valor apurado no
  -- mês") é refeita.
  if v_payable is not null and exists (
       select 1 from public.payables x where x.id = v_payable and x.status = 'cancelada'
          and coalesce(x.cancel_reason, '') <> 'Sem valor apurado no mês') then
    return;
  end if;

  if v_total <= 0 then
    if v_payable is not null then
      update public.payables set status = 'cancelada',
        cancel_reason = 'Sem valor apurado no mês', updated_at = now()
       where id = v_payable and status <> 'paga';
      update public.financial_entries set status = 'cancelled'
       where source_type = 'payable_accrual' and source_id = v_payable;
      update public.financial_entries set status = 'cancelled'
       where source_type = 'network_fee_revenue' and source_id = v_payable;
    end if;
    return;
  end if;

  if v_payable is null then
    insert into public.payables (
      clinic_id, account_code, description, accrual_date, due_date,
      amount_cents, status, approval_mode, requires_approval,
      network_fee, fee_period, notes
    ) values (
      p_clinic_id, v_acc.unit_account,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
        || coalesce(' (' || v_cfg.campaign_name || ')', ''),
      p_period, v_due, v_total, 'aberta',
      'sem_autorizacao', false,
      p_fee, p_period,
      'Apurado automaticamente sobre os recebimentos do mês.'
    ) returning id into v_payable;

    perform public.post_payable_accrual(v_payable);
  else
    update public.payables set
      amount_cents = v_total, due_date = v_due,
      status = case when status = 'cancelada' then 'aberta' else status end,
      updated_at = now()
     where id = v_payable;

    update public.financial_entries set
      amount_cents = v_total, status = 'open', updated_at = now()
     where source_type = 'payable_accrual' and source_id = v_payable;

    perform public.post_payable_accrual(v_payable);
  end if;

  select id into v_franchisor from public.clinics
   where type = 'franchisor' limit 1;

  if v_franchisor is not null and v_franchisor <> p_clinic_id then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description
    ) values (
      v_franchisor, v_acc.franchisor_account, p_period, null, v_due,
      v_total, 'inflow', 'open', 'network_fee_revenue', v_payable,
      v_label || ' — ' || to_char(p_period, 'MM/YYYY')
    )
    on conflict (source_type, source_id)
      where source_type = 'network_fee_revenue'
    do update set amount_cents = excluded.amount_cents,
                  expected_settlement_date = excluded.expected_settlement_date,
                  status = 'open',
                  updated_at = now();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public._charge_for_gateway(p_charge_id uuid)
 RETURNS TABLE(charge_id uuid, status text, clinic_id uuid, gateway_account_id uuid, billing_type text, value_cents bigint, discount_cents bigint, fine_percent numeric, fine_cents bigint, interest_percent numeric, due_date date, description text, asaas_payment_id text, payer_kind text, payer_guardian_id uuid, client_id uuid, payer_name text, payer_cpf text, asaas_customer_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, c.status, c.clinic_id, c.gateway_account_id, c.billing_type, c.value_cents,
         c.discount_cents, c.fine_percent, c.fine_cents, c.interest_percent, c.due_date,
         coalesce(c.description, 'Parcela ' || i.seq || ' — ' || cl.name),
         c.asaas_payment_id, c.payer_kind, c.payer_guardian_id, c.client_id,
         coalesce(g.full_name, k.full_name),
         public.cpf_digits(coalesce(g.cpf, k.cpf)),
         gc.asaas_customer_id
    from public.charges c
    left join public.payment_installments i on i.id = c.payment_installment_id
    join public.clinics cl on cl.id = c.clinic_id
    left join public.clients k on k.id = c.client_id
    left join public.client_guardians g on g.id = c.payer_guardian_id
    left join public.gateway_customers gc
      on gc.gateway_account_id = c.gateway_account_id
     and gc.cpf_cnpj = public.cpf_digits(coalesce(g.cpf, k.cpf))
   where c.id = p_charge_id;
$function$;

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


notify pgrst, 'reload schema';

select (select count(*) from pg_trigger where tgname = 'charges_franchise_monthly_sync') as gatilho_restante,
       position('waived_at is null' in pg_get_functiondef('public.refresh_network_fee_payable(uuid, text, date)'::regprocedure)) = 0 as apuracao_antiga;
