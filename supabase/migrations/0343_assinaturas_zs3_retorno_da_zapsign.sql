-- =============================================================================
-- 0343 — ASSINATURA DIGITAL (ZapSign) — FASE ZS3: o retorno da ZapSign
-- -----------------------------------------------------------------------------
-- Plano ZS0 (docs/assinaturas/PLANO-ZS0.md §4.8, §5.5, §5.6, fase ZS3). A ZS2
-- envia; aqui o sistema FICA SABENDO o que aconteceu:
--
--   * `signature_apply_webhook(p_event)` — a porta que a Route Handler
--     `/api/webhooks/zapsign` chama pela chave de serviço com o evento já
--     normalizado. Idempotente pela `event_key` (única em `signature_events`):
--     o mesmo aviso chegando duas vezes entra uma vez só. Atualiza os
--     signatários, a etapa e a situação do pacote, avisa quem é o próximo e
--     quem enviou, e fecha a venda quando o contrato/orçamento foi assinado.
--   * `signature_my_pending()` — "Minhas assinaturas pendentes": o que espera
--     a assinatura de quem está logado (testemunha ou representante), e se
--     já é a vez dela.
--   * `commercial_close_step` vira uma PORTA sobre `_commercial_close_step_raw`
--     (padrão da 0282): a marcação manual continua com a guarda de quem clica;
--     a assinatura digital marca em nome de quem enviou o pacote, e a venda
--     guarda de onde veio a marcação (`contract_signed_source`) e qual pacote
--     (`contract_signature_package_id`).
--   * `signature_packages` e `signature_signers` entram no Realtime, para a
--     ficha e as listas atualizarem sozinhas quando o aviso chega.
--
-- Continua valendo: nenhuma policy de escrita em `signature_*`; só a porta
-- (chave de serviço) grava. Pacote assinado segue trancado pelo gatilho da
-- 0340 — a porta muda a situação para `signed` numa única gravação, e depois
-- disso só `signed_pdf_path`/`completed_at` entram.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A VENDA GUARDA DE ONDE VEIO A MARCAÇÃO DO CONTRATO
-- -----------------------------------------------------------------------------
alter table public.commercial_sales
  add column if not exists contract_signed_source text
    check (contract_signed_source is null or contract_signed_source in ('manual', 'assinatura_digital'));
alter table public.commercial_sales
  add column if not exists contract_signature_package_id uuid references public.signature_packages (id) on delete set null;

comment on column public.commercial_sales.contract_signed_source is
  'ZS3 (0343): quem marcou "contrato assinado" — a pessoa (manual) ou o retorno da ZapSign (assinatura_digital).';

-- -----------------------------------------------------------------------------
-- 2) A PORTA DO FECHAMENTO: `commercial_close_step` → `_commercial_close_step_raw`
-- -----------------------------------------------------------------------------
-- O corpo abaixo é o da 0334, com três mudanças: o usuário vem por parâmetro,
-- a guarda `commercial_can_close` só vale na marcação manual, e o passo
-- 'contract' grava a origem e o pacote. Ao mexer no fechamento, mexer AQUI;
-- a porta de baixo não muda.
create or replace function public._commercial_close_step_raw(
  p_negotiation_id uuid,
  p_step text,
  p_value boolean,
  p_user uuid,
  p_source text,
  p_package_id uuid
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
  v_user uuid := p_user;
  v_signed boolean;
  v_paid boolean;
  v_closed boolean := false;
  v_client_name text;
  v_reais text;
  v_label text;
  v_ortho uuid;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  -- A guarda de quem clica vale para a marcação MANUAL; a assinatura digital
  -- chega pelo webhook (sem usuário logado) em nome de quem enviou o pacote.
  if p_source = 'manual' and not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
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
      -- ZS3 (0343): de onde veio a marcação, e qual pacote assinou.
      contract_signed_source = case when p_value then p_source else null end,
      contract_signature_package_id = case when p_value then p_package_id else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Contrato ' || case when p_source = 'assinatura_digital' then '(assinatura digital) ' else '' end;
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

    -- ORTO8 (0334): venda com ortodontia → o caso nasce aqui. Nunca derruba o
    -- fechamento: se a ortodontia falhar, fica o aviso no log do banco.
    begin
      v_ortho := public._ortho_open_from_sale(p_negotiation_id);
    exception when others then
      raise warning '_ortho_open_from_sale (%): %', p_negotiation_id, sqlerrm;
    end;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'commercial_sale', p_negotiation_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed,
                       'ortho_case_id', v_ortho, 'source', p_source, 'package_id', p_package_id));

  return jsonb_build_object('signed', v_signed, 'paid', v_paid, 'closed', v_closed,
                            'ortho_case_id', v_ortho);
end;
$$;

revoke execute on function public._commercial_close_step_raw(uuid, text, boolean, uuid, text, uuid) from public, anon, authenticated;

-- A porta que a tela chama: a mesma assinatura e o mesmo retorno de sempre.
create or replace function public.commercial_close_step(
  p_negotiation_id uuid,
  p_step text,
  p_value boolean
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._commercial_close_step_raw(p_negotiation_id, p_step, p_value, (select auth.uid()), 'manual', null);
$$;

revoke execute on function public.commercial_close_step(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.commercial_close_step(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A PORTA DO WEBHOOK
-- -----------------------------------------------------------------------------
-- Entrada (já normalizada por `parseWebhook`, src/lib/zapsign/webhook.ts):
--   { event_key, event_type, doc_token, external_id, doc_status, occurred_at,
--     rejected_reason, signer_token, signer_signed_at,
--     signers: [{ token, status, signed_at }], payload }
-- `event_type` normalizado: doc_signed | doc_refused | doc_expired |
-- doc_deleted | doc_viewed | other. Devolve o que a rota precisa decidir
-- (baixar o PDF assinado, enfileirar a cópia).
create or replace function public.signature_apply_webhook(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := p_event->>'event_key';
  v_type text := coalesce(p_event->>'event_type', 'other');
  v_pkg public.signature_packages;
  v_old_status text;
  v_old_stage text;
  v_s jsonb;
  v_status text;
  v_signed_at timestamptz;
  v_total int;
  v_signed int;
  v_g1_pending int;
  v_g2_pending int;
  v_g3_pending int;
  v_new_status text;
  v_new_stage text;
  v_client_signed_at timestamptz;
  v_docs text;
  v_link text;
  v_notified uuid[] := '{}';
  v_user uuid;
  v_has_contract boolean;
  v_closing jsonb;
  v_inserted int;
begin
  if v_key is null or btrim(v_key) = '' then
    raise exception 'EVENT_KEY_REQUIRED';
  end if;

  -- O pacote: pelo token do documento; senão pelo id que mandamos (external_id).
  select * into v_pkg from public.signature_packages where zapsign_doc_token = p_event->>'doc_token';
  if v_pkg.id is null and (p_event->>'external_id') ~ '^[0-9a-f-]{36}$' then
    select * into v_pkg from public.signature_packages where id = (p_event->>'external_id')::uuid;
  end if;

  -- Idempotência: a chave entra UMA vez. Repetido = não faz nada.
  insert into public.signature_events (package_id, event_type, event_key, payload)
  values (v_pkg.id, 'webhook_' || v_type, v_key, p_event->'payload')
  on conflict (event_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('duplicate', true, 'matched', v_pkg.id is not null, 'package_id', v_pkg.id);
  end if;
  if v_pkg.id is null then
    return jsonb_build_object('duplicate', false, 'matched', false);
  end if;

  v_old_status := v_pkg.status;
  v_old_stage := v_pkg.current_stage;

  -- Pacote já fechado (assinado, recusado, vencido, cancelado): só o registro.
  if v_pkg.status in ('signed', 'refused', 'expired', 'cancelled') then
    return jsonb_build_object('duplicate', false, 'matched', true, 'package_id', v_pkg.id,
      'client_id', v_pkg.client_id, 'clinic_id', v_pkg.clinic_id, 'number', v_pkg.number,
      'status', v_pkg.status, 'stage', v_pkg.current_stage, 'changed', false,
      'signed_file_needed', v_pkg.status = 'signed' and v_pkg.signed_pdf_path is null);
  end if;

  -- 1) Os signatários, pelo que a ZapSign mandou (nunca volta de assinado).
  for v_s in select * from jsonb_array_elements(coalesce(p_event->'signers', '[]'::jsonb)) loop
    v_status := v_s->>'status';
    v_signed_at := nullif(v_s->>'signed_at', '')::timestamptz;
    if v_status = 'signed' then
      update public.signature_signers
         set status = 'signed', signed_at = coalesce(signed_at, v_signed_at, now())
       where package_id = v_pkg.id and zapsign_signer_token = v_s->>'token' and status <> 'signed';
    elsif v_status = 'link-opened' then
      update public.signature_signers
         set status = 'link_opened'
       where package_id = v_pkg.id and zapsign_signer_token = v_s->>'token' and status = 'pending';
    end if;
  end loop;
  if v_type = 'doc_signed' and (p_event->>'signer_token') is not null then
    update public.signature_signers
       set status = 'signed', signed_at = coalesce(signed_at, nullif(p_event->>'signer_signed_at', '')::timestamptz, now())
     where package_id = v_pkg.id and zapsign_signer_token = p_event->>'signer_token' and status <> 'signed';
  end if;
  if v_type = 'doc_refused' and (p_event->>'signer_token') is not null then
    update public.signature_signers set status = 'refused'
     where package_id = v_pkg.id and zapsign_signer_token = p_event->>'signer_token';
  end if;

  -- 2) Onde o pacote está.
  select count(*), count(*) filter (where status = 'signed'),
         count(*) filter (where order_group = 1 and status <> 'signed'),
         count(*) filter (where order_group = 2 and status <> 'signed'),
         count(*) filter (where order_group = 3 and status <> 'signed'),
         max(signed_at) filter (where order_group = 1)
    into v_total, v_signed, v_g1_pending, v_g2_pending, v_g3_pending, v_client_signed_at
    from public.signature_signers where package_id = v_pkg.id;

  v_new_stage := case when v_g1_pending > 0 then 'client'
                      when v_g2_pending > 0 then 'witnesses'
                      when v_g3_pending > 0 then 'risarte'
                      else 'done' end;

  if v_type = 'doc_refused' then
    v_new_status := 'refused';
  elsif v_type = 'doc_expired' then
    v_new_status := 'expired';
  elsif v_type = 'doc_deleted' then
    v_new_status := 'cancelled';
  elsif v_total > 0 and v_signed = v_total then
    v_new_status := 'signed';
  elsif v_signed > 0 then
    v_new_status := 'partially_signed';
  else
    v_new_status := v_pkg.status;
  end if;

  update public.signature_packages set
    status = v_new_status,
    current_stage = case when v_new_status = 'signed' then 'done' else v_new_stage end,
    client_signed_at = case when v_g1_pending = 0 then coalesce(client_signed_at, v_client_signed_at, now()) else client_signed_at end,
    completed_at = case when v_new_status = 'signed' then coalesce(completed_at, now()) else completed_at end,
    refused_reason = case when v_new_status = 'refused' then coalesce(p_event->>'rejected_reason', refused_reason) else refused_reason end,
    cancel_reason = case when v_new_status = 'cancelled' and v_old_status <> 'cancelled' then 'zapsign_deleted' else cancel_reason end,
    cancelled_at = case when v_new_status = 'cancelled' and v_old_status <> 'cancelled' then now() else cancelled_at end
  where id = v_pkg.id;

  -- 3) Os avisos (0316: aviso nasce pela porta do banco, uma vez).
  select string_agg(title, ' + ' order by sort_order) into v_docs
    from public.signature_package_items where package_id = v_pkg.id;
  v_link := '/prontuarios/' || v_pkg.client_id || '?aba=documentos';

  if v_new_status in ('sent', 'partially_signed') and v_new_stage <> v_old_stage and v_new_stage in ('witnesses', 'risarte') then
    -- Chegou a vez da próxima turma: cada pessoa do sistema recebe o seu.
    for v_user in
      select distinct s.user_id from public.signature_signers s
       where s.package_id = v_pkg.id and s.user_id is not null and s.status = 'pending'
         and s.order_group = case v_new_stage when 'witnesses' then 2 else 3 end
    loop
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_user, v_pkg.clinic_id, 'É a sua vez de assinar',
        'Pacote ' || v_pkg.number || ' — ' || coalesce(v_docs, 'documentos') || '. Abra "Minhas assinaturas pendentes" e assine.',
        '/assinaturas/minhas');
      v_notified := v_notified || v_user;
    end loop;
  end if;

  if v_new_status <> v_old_status and v_new_status in ('signed', 'refused', 'expired', 'cancelled') and v_pkg.sent_by is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (v_pkg.sent_by, v_pkg.clinic_id,
      case v_new_status when 'signed' then 'Pacote assinado por todos'
                        when 'refused' then 'Assinatura recusada'
                        when 'expired' then 'Link de assinatura venceu'
                        else 'Pacote cancelado na ZapSign' end,
      'Pacote ' || v_pkg.number || ' — ' || coalesce(v_docs, 'documentos')
        || case when v_new_status = 'refused' and (p_event->>'rejected_reason') is not null
                then '. Motivo: ' || left(p_event->>'rejected_reason', 200) else '' end,
      v_link);
    v_notified := v_notified || v_pkg.sent_by;
  end if;

  -- 4) A venda fecha sozinha (plano §4.8): pacote de uma negociação aceita
  --    com contrato ou orçamento aprovado, assinado por todos.
  if v_new_status = 'signed' and v_old_status <> 'signed'
     and v_pkg.origin_type = 'plan_negotiation' and v_pkg.origin_id is not null then
    select exists (
      select 1 from public.signature_package_items i
        join public.signature_templates t on t.id = i.template_id
       where i.package_id = v_pkg.id and t.kind in ('contract', 'budget')
    ) into v_has_contract;
    if v_has_contract then
      begin
        if not exists (select 1 from public.commercial_sales cs
                        where cs.negotiation_id = v_pkg.origin_id and cs.contract_signed) then
          v_closing := public._commercial_close_step_raw(
            v_pkg.origin_id, 'contract', true, v_pkg.sent_by, 'assinatura_digital', v_pkg.id);
        end if;
      exception when others then
        -- Negociação que não está mais aceita, venda já fechada: o pacote
        -- continua assinado; fica o aviso no log do banco e no evento.
        raise warning 'signature_apply_webhook: fechamento (%): %', v_pkg.origin_id, sqlerrm;
        insert into public.signature_events (package_id, event_type, error)
        values (v_pkg.id, 'closing_failed', left(sqlerrm, 300));
      end;
    end if;
  end if;

  return jsonb_build_object(
    'duplicate', false, 'matched', true, 'package_id', v_pkg.id,
    'client_id', v_pkg.client_id, 'clinic_id', v_pkg.clinic_id, 'number', v_pkg.number,
    'status', v_new_status, 'stage', case when v_new_status = 'signed' then 'done' else v_new_stage end,
    'changed', v_new_status <> v_old_status or v_new_stage <> v_old_stage,
    'newly_signed', v_new_status = 'signed' and v_old_status <> 'signed',
    'signed_file_needed', v_new_status = 'signed' and v_pkg.signed_pdf_path is null,
    'notified', to_jsonb(v_notified),
    'closing', v_closing
  );
end;
$$;

-- Só a chave de serviço (a rota do webhook) chama: nada para logado ou anônimo.
revoke execute on function public.signature_apply_webhook(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) MINHAS ASSINATURAS PENDENTES
-- -----------------------------------------------------------------------------
-- O que espera a assinatura de quem está logado (testemunha ou representante
-- da Risarte), com "já é a sua vez?". Lê como dono: a pessoa pode não ter
-- permissão de ver o pacote inteiro — mas a linha dela é dela (0340).
create or replace function public.signature_my_pending()
returns table (
  package_id uuid,
  number text,
  client_name text,
  documents text,
  order_group integer,
  signer_status text,
  is_my_turn boolean,
  sign_url text,
  expires_at timestamptz,
  sent_at timestamptz,
  package_status text,
  current_stage text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.number,
         coalesce(p.cover_data->>'client_name', c.full_name, 'Paciente') as client_name,
         (select string_agg(i.title, ' + ' order by i.sort_order) from public.signature_package_items i where i.package_id = p.id) as documents,
         s.order_group, s.status,
         (p.current_stage = case s.order_group when 1 then 'client' when 2 then 'witnesses' else 'risarte' end) as is_my_turn,
         s.sign_url, p.expires_at, p.sent_at, p.status, p.current_stage
    from public.signature_signers s
    join public.signature_packages p on p.id = s.package_id
    left join public.clients c on c.id = p.client_id
   where s.user_id = (select auth.uid())
     and s.status in ('pending', 'link_opened')
     and p.status in ('sent', 'partially_signed')
   order by is_my_turn desc, p.sent_at;
$$;

revoke execute on function public.signature_my_pending() from public, anon, authenticated;
grant execute on function public.signature_my_pending() to authenticated;

-- -----------------------------------------------------------------------------
-- 5) TEMPO REAL
-- -----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.signature_packages;
exception when duplicate_object then null; when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.signature_signers;
exception when duplicate_object then null; when others then null; end $$;

-- -----------------------------------------------------------------------------
-- 6) AUDITORIA (0288): nenhuma tabela nova
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('signature_apply_webhook', 'signature_my_pending', '_commercial_close_step_raw', 'commercial_close_step')) as funcoes,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'commercial_sales'
    and column_name in ('contract_signed_source', 'contract_signature_package_id')) as colunas,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
    and tablename in ('signature_packages', 'signature_signers')) as realtime,
  (select has_function_privilege('anon', 'public.signature_apply_webhook(jsonb)', 'execute')) as webhook_sem_login,
  (select has_function_privilege('authenticated', 'public.signature_my_pending()', 'execute')) as minhas_logado,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'signature\_%' and cmd <> 'SELECT') as policies_fora_de_select;
