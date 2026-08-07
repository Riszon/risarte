-- =============================================================================
-- 0202 — PARIDADE DOS FLUXOS DE VENDA: "cobrança emitida" no Comercial
-- -----------------------------------------------------------------------------
-- Achado da revisão comparativa (docs/COMPARATIVO-VENDAS.md, 06/08/2026): o
-- fechamento tinha **3 passos na venda direta** (contrato · cobrança emitida ·
-- pagamento confirmado) e **2 no Comercial** (contrato · pagamento).
--
-- Hoje isso é só uma diferença de tela. Quando o **ASAAS** entrar, "cobrança
-- emitida" é exatamente o passo que a integração preenche sozinha — e o fluxo
-- do Comercial não teria onde encaixá-la. Alinhar agora custa esta migração;
-- alinhar depois seria mexer numa integração já rodando.
--
-- A renegociação (FIN2.4) já tem os três passos. Com esta migração, os três
-- caminhos que geram cobrança falam a mesma língua.
--
-- A REGRA DE OURO NÃO MUDA: venda concluída = contrato assinado + pagamento
-- CONFIRMADO. "Cobrança emitida" é informativo — registra que o documento foi
-- gerado, não que o dinheiro entrou.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O passo novo
-- -----------------------------------------------------------------------------
alter table public.commercial_sales
  add column if not exists payment_issued boolean not null default false,
  add column if not exists payment_issued_at timestamptz,
  add column if not exists payment_issued_by uuid references public.profiles (id);

comment on column public.commercial_sales.payment_issued is
  'Cobrança/boleto gerado e enviado ao cliente. Informativo: NÃO conclui a '
  'venda — só contrato assinado + pagamento confirmado conclui. É o passo que '
  'o ASAAS vai preencher sozinho.';

-- -----------------------------------------------------------------------------
-- 2) O fechamento aceita os três passos
-- -----------------------------------------------------------------------------
create or replace function public.commercial_close_step(
  p_negotiation_id uuid,
  p_step text,
  p_value boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_sale public.commercial_sales;
  v_sale_id uuid;
  v_card uuid;
  v_user uuid := (select auth.uid());
  v_signed boolean;
  v_paid boolean;
  v_closed boolean := false;
  v_client_name text;
  v_reais text;
  v_label text;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_neg.status <> 'aceita' then raise exception 'NOT_ACCEPTED'; end if;
  -- 0202: 'payment' continua aceito como apelido de 'payment_confirmed' para
  -- não quebrar chamada antiga em cache do navegador.
  if p_step not in ('contract','payment','payment_issued','payment_confirmed') then
    raise exception 'INVALID_STEP';
  end if;

  select * into v_sale from public.commercial_sales where negotiation_id = p_negotiation_id;
  if v_sale.id is null then
    insert into public.commercial_sales
      (negotiation_id, client_id, clinic_id, plan_id, final_cents)
    values (p_negotiation_id, v_neg.client_id, v_neg.clinic_id, v_neg.plan_id, v_neg.final_cents)
    returning * into v_sale;
  end if;
  v_sale_id := v_sale.id;

  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if p_step = 'contract' then
    update public.commercial_sales set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Contrato ';
  elsif p_step = 'payment_issued' then
    update public.commercial_sales set
      payment_issued = p_value,
      payment_issued_at = case when p_value then now() else null end,
      payment_issued_by = case when p_value then v_user else null end,
      -- Mesma regra da venda direta (§7.6): valor zerado pelo programa não tem
      -- o que cobrar — emitir já confirma.
      payment_confirmed = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                               then true else payment_confirmed end,
      payment_confirmed_at = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                                  then now() else payment_confirmed_at end,
      payment_confirmed_by = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                                  then v_user else payment_confirmed_by end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Cobrança ';
  else
    update public.commercial_sales set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Pagamento ';
  end if;

  select contract_signed, payment_confirmed into v_signed, v_paid
  from public.commercial_sales where id = v_sale_id;

  v_card := public.commercial_ensure_card(v_neg.client_id);
  perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
    'fechamento_passo',
    v_label || case when p_value then 'confirmado' else 'desmarcado' end);

  -- REGRA DE OURO, inalterada: assinado + pagamento CONFIRMADO = venda.
  if v_signed and v_paid then
    update public.commercial_sales set closed_at = now(), updated_at = now()
    where id = v_sale_id;
    v_closed := true;

    update public.journey_phase_history set exited_at = now()
    where client_id = v_neg.client_id and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_neg.client_id, v_neg.clinic_id, 'treatment_start', v_user);
    update public.clients set journey_phase = 'treatment_start', phase_entered_at = now()
    where id = v_neg.client_id;

    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    v_reais := 'R$ ' || (v_neg.final_cents / 100)::text || ',' ||
               lpad((v_neg.final_cents % 100)::text, 2, '0');

    perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
      'venda_concluida', 'VENDA CONCLUÍDA — ' || v_reais || ' (contrato assinado + pagamento)');

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'FECHAMENTO! Iniciar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano. Fale com o cliente, dê as boas-vindas e agende o início do tratamento.',
      '/agenda?cliente=' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'receptionist'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Novo fechamento — acompanhar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano e vai iniciar o tratamento. Acompanhe a execução com excelência.',
      '/prontuarios/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Venda fechada — ' || v_reais,
      coalesce(v_client_name, 'Cliente') || ' — venda de ' || v_reais
        || ' concluída (contrato assinado e pagamento confirmado).',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'commercial_sale', p_negotiation_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed));

  return jsonb_build_object('signed', v_signed, 'paid', v_paid, 'closed', v_closed);
end;
$$;

grant execute on function public.commercial_close_step(uuid, text, boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Reparo: venda já concluída teve a cobrança emitida, por definição
-- -----------------------------------------------------------------------------
update public.commercial_sales
   set payment_issued = true,
       payment_issued_at = coalesce(payment_issued_at, payment_confirmed_at, closed_at)
 where closed_at is not null and not payment_issued;

select
  (select count(*) from public.commercial_sales) as fechamentos_do_comercial,
  (select count(*) from public.commercial_sales where payment_issued)
    as com_cobranca_emitida,
  (select count(*) from public.commercial_sales where closed_at is not null)
    as concluidos;
