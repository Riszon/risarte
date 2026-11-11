-- =============================================================================
-- 0397 — ASSINATURA DIGITAL: ACHADOS MENORES DA REVISÃO (AP158)
--
-- Revisão de 11/11/2026 (pedido do dono). Três itens precisam do banco:
--
--   1) Item 15 — CANCELAR NÃO VIRA "RECUSADO PELO PACIENTE". Cancelar no
--      riSZon = `refuse` na ZapSign primeiro, depois a porta
--      `signature_cancel_package`. A ZapSign avisa a recusa de volta; se o
--      aviso chegava antes da porta, o pacote virava "recusado" (motivo do
--      paciente nos indicadores) e a porta recusava o cancelamento. Agora
--      `signature_apply_webhook` (a partir da 0396) reconhece o motivo que o
--      riSZon manda ("Cancelado no riSZon: …") e grava CANCELADO, com o motivo
--      digitado, sem avisar quem enviou de novo (ele mesmo cancelou).
--   2) Item 8 — `signature_report_rows` ordena por `sent_at desc, id`: a
--      leitura em páginas não pula nem repete pacote com o mesmo horário.
--      Mesmo retorno e mesma conta da 0347; só o desempate.
--   3) Item 14 — PACOTE DE EMPRESA SÓ PELA FRANQUEADORA: gatilho na criação
--      (`signature_packages_company_issuer`). A tela já escolhia a
--      Franqueadora; o banco não conferia (chamada direta à API).
--
-- Idempotente.
-- =============================================================================

-- 1) A porta do aviso da ZapSign.
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

  -- 0396 (AP151): rascunho só muda pelo envio. A recusa/exclusão que a própria
  -- ZapSign manda depois de o riSZon desfazer um envio que falhou não pode
  -- virar "recusado pelo paciente": fica só o registro.
  if v_pkg.status = 'draft' and v_type in ('doc_refused', 'doc_deleted', 'doc_expired') then
    return jsonb_build_object('duplicate', false, 'matched', true, 'package_id', v_pkg.id,
      'client_id', v_pkg.client_id, 'clinic_id', v_pkg.clinic_id, 'number', v_pkg.number,
      'status', v_pkg.status, 'stage', v_pkg.current_stage, 'changed', false,
      'signed_file_needed', false);
  end if;

  -- Pacote já fechado (assinado, recusado, vencido, cancelado): só o registro.
  -- 0396 (AP154): EXCETO a assinatura que chega para um pacote vencido pela
  -- ROTINA DO RISZON (só pela data): a ZapSign é quem sabe se assinaram no
  -- limite. Os signatários são atualizados; se todos assinaram, o pacote passa
  -- a assinado (com PDF, venda e selo); senão continua vencido.
  if v_pkg.status in ('signed', 'refused', 'expired', 'cancelled')
     and not (v_pkg.status = 'expired' and v_type = 'doc_signed'
              and exists (select 1 from public.signature_events e
                           where e.package_id = v_pkg.id and e.event_type = 'expired_by_routine')) then
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

  if v_type = 'doc_refused' and coalesce(p_event->>'rejected_reason', '') like 'Cancelado no riSZon: %' then
    -- 0397 (AP158, item 15): a "recusa" que a ZapSign avisa depois de o
    -- riSZon cancelar (cancelar = `refuse` na ZapSign) é CANCELAMENTO, não
    -- recusa do paciente — mesmo quando o aviso chega antes da porta
    -- `signature_cancel_package`.
    v_new_status := 'cancelled';
  elsif v_type = 'doc_refused' then
    v_new_status := 'refused';
  elsif v_type = 'doc_expired' then
    v_new_status := 'expired';
  elsif v_type = 'doc_deleted' then
    v_new_status := 'cancelled';
  elsif v_total > 0 and v_signed = v_total then
    v_new_status := 'signed';
  elsif v_old_status = 'expired' then
    v_new_status := 'expired';
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
    cancel_reason = case when v_new_status = 'cancelled' and v_old_status <> 'cancelled'
                         then case when v_type = 'doc_refused'
                                   then substr(p_event->>'rejected_reason', length('Cancelado no riSZon: ') + 1)
                                   else 'zapsign_deleted' end
                         else cancel_reason end,
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
       where s.package_id = v_pkg.id and s.user_id is not null and s.status in ('pending', 'link_opened')
         and s.order_group = case v_new_stage when 'witnesses' then 2 else 3 end
    loop
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_user, v_pkg.clinic_id, 'É a sua vez de assinar',
        'Pacote ' || v_pkg.number || ' — ' || coalesce(v_docs, 'documentos') || '. Abra "Minhas assinaturas pendentes" e assine.',
        '/assinaturas/minhas');
      v_notified := v_notified || v_user;
    end loop;
  end if;

  if v_new_status <> v_old_status and v_new_status in ('signed', 'refused', 'expired', 'cancelled') and v_pkg.sent_by is not null
     and not (v_new_status = 'cancelled' and v_type = 'doc_refused') then
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

revoke execute on function public.signature_apply_webhook(jsonb) from public, anon, authenticated;

-- 2) O relatório com desempate.
create or replace function public.signature_report_rows(
  p_from date,
  p_to date,
  p_clinic_ids uuid[] default null,
  p_audience text default null,
  p_template_id uuid default null,
  p_sent_by uuid default null
)
returns table (
  id uuid,
  number text,
  clinic_id uuid,
  clinic_name text,
  audience text,
  status text,
  current_stage text,
  client_name text,
  client_id uuid,
  company_id uuid,
  lead_id uuid,
  origin_type text,
  origin_id uuid,
  sent_at timestamptz,
  client_signed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  cancel_reason text,
  refused_reason text,
  sent_by uuid,
  sent_by_name text,
  cancelled_by_name text,
  items jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select p.*,
           case when p.status in ('refused', 'expired', 'cancelled')
                then coalesce(p.cancelled_at, p.updated_at) end as fim
      from public.signature_packages p
     where p.sent_at is not null
       and (p_clinic_ids is null or p.clinic_id = any (p_clinic_ids))
       and (p_audience is null or p.audience = p_audience)
       and (p_sent_by is null or p.sent_by = p_sent_by)
       and (p_template_id is null or exists (
             select 1 from public.signature_package_items i
              where i.package_id = p.id and i.template_id = p_template_id))
  )
  select b.id, b.number, b.clinic_id,
         coalesce(c.name, b.cover_data->>'clinic_name') as clinic_name,
         b.audience, b.status, b.current_stage,
         b.cover_data->>'client_name' as client_name,
         b.client_id, b.company_id, b.lead_id, b.origin_type, b.origin_id,
         b.sent_at, b.client_signed_at, b.completed_at, b.expires_at,
         b.fim as ended_at,
         b.cancel_reason, b.refused_reason, b.sent_by,
         ps.full_name as sent_by_name,
         pc.full_name as cancelled_by_name,
         coalesce((
           select jsonb_agg(jsonb_build_object('title', i.title, 'template_id', i.template_id, 'kind', t.kind) order by i.sort_order)
             from public.signature_package_items i
             left join public.signature_templates t on t.id = i.template_id
            where i.package_id = b.id
         ), '[]'::jsonb) as items
    from base b
    left join public.clinics c on c.id = b.clinic_id
    left join public.profiles ps on ps.id = b.sent_by
    left join public.profiles pc on pc.id = b.cancelled_by
   where (b.sent_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or (b.completed_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or (b.client_signed_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or (b.fim at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or b.status in ('sent', 'partially_signed')
   order by b.sent_at desc, b.id;
$$;

revoke execute on function public.signature_report_rows(date, date, uuid[], text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.signature_report_rows(date, date, uuid[], text, uuid, uuid) to authenticated, service_role;

-- 3) Pacote de empresa só pela Franqueadora.
create or replace function public._signature_company_issuer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.audience = 'company' and not exists (
       select 1 from public.clinics c where c.id = new.clinic_id and c.type = 'franchisor') then
    raise exception 'ISSUER_NOT_FRANCHISOR';
  end if;
  return new;
end;
$$;

revoke execute on function public._signature_company_issuer_guard() from public, anon, authenticated;

drop trigger if exists signature_packages_company_issuer on public.signature_packages;
create trigger signature_packages_company_issuer
  before insert on public.signature_packages
  for each row execute function public._signature_company_issuer_guard();

-- Conferência (cole e rode à parte, depois): true · true · 1
-- select
--   (pg_get_functiondef('public.signature_apply_webhook(jsonb)'::regprocedure) like '%Cancelado no riSZon%') as cancelar_nao_vira_recusa,
--   (pg_get_functiondef(p.oid) like '%order by b.sent_at desc, b.id%') as relatorio_com_desempate,
--   (select count(*) from pg_trigger where tgname = 'signature_packages_company_issuer') as trava_da_emissora
--   from pg_proc p where p.proname = 'signature_report_rows';
