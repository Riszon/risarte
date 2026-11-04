-- 0359 — O AVISO DA ZAPSIGN NÃO DESFAZ O ENVIO (ZS8, achado no teste real do sandbox, 03/11/2026)
--
-- No teste real, o segundo pacote (ASS-000050) foi enviado à ZapSign, com os
-- links de cada pessoa, e ficou gravado como RASCUNHO. A ordem no rastro:
--   23:40:13,567  o envio grava "enviado" (sent_at)
--   23:40:13,581  o aviso "documento criado" da ZapSign grava o pacote de novo
-- `signature_apply_webhook` lia o pacote SEM TRAVA; tendo lido antes de o
-- envio confirmar, calculava "sem mudança" a partir do que leu (rascunho) e
-- gravava rascunho por cima. No primeiro pacote o aviso chegou 0,3 s depois e
-- não houve corrida.
--
-- Consequências: o pacote some de "aguardando", o cancelar e o reenviar
-- recusam ("não está aguardando assinatura"), a conferência horária não o vê.
--
-- O que muda (o resto da função é o texto do banco, sem mudança):
--   1. o pacote é lido com `for update`: o aviso espera o envio terminar (ou o
--      envio espera o aviso), e cada um vê o que o outro gravou;
--      (NÃO se força "rascunho → enviado" aqui: provado no treino, isso fazia o
--      aviso passar na frente e a gravação do envio — que só vale sobre
--      rascunho — não gravar quem enviou nem o mês do consumo, ASS-000052);
--   2. conserto: pacote em rascunho que tem documento na ZapSign e o registro
--      "sent" (sem "send_failed" depois) volta a "enviado".
--
-- Idempotente: `create or replace` e o conserto só pega quem está errado.

CREATE OR REPLACE FUNCTION public.signature_apply_webhook(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- 0359: TRAVA o pacote ao ler. Sem a trava, o aviso "documento criado" da
  -- ZapSign, chegando no mesmo instante em que o envio grava "enviado", lia o
  -- pacote ainda como rascunho e gravava rascunho por cima (ASS-000050, ZS8).
  select * into v_pkg from public.signature_packages where zapsign_doc_token = p_event->>'doc_token' for update;
  if v_pkg.id is null and (p_event->>'external_id') ~ '^[0-9a-f-]{36}$' then
    select * into v_pkg from public.signature_packages where id = (p_event->>'external_id')::uuid for update;
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
$function$;

-- 2. Conserto dos pacotes que a corrida deixou em rascunho.
update public.signature_packages p
   set status = 'sent'
 where p.status = 'draft'
   and p.zapsign_doc_token is not null
   and p.sent_at is not null
   and exists (select 1 from public.signature_events e
                where e.package_id = p.id and e.event_type = 'sent')
   and not exists (select 1 from public.signature_events e
                    where e.package_id = p.id and e.event_type = 'send_failed');

-- Conferência (rodar e olhar): true · 0
select
  (pg_get_functiondef('signature_apply_webhook(jsonb)'::regprocedure) like '%for update;%') as le_com_trava,
  (select count(*) from public.signature_packages p
    where p.status = 'draft' and p.zapsign_doc_token is not null and p.sent_at is not null
      and exists (select 1 from public.signature_events e where e.package_id = p.id and e.event_type = 'sent')) as presos_em_rascunho;
