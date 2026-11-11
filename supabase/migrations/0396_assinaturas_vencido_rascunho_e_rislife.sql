-- =============================================================================
-- 0396 — ASSINATURA DIGITAL: OS DE PRIORIDADE MÉDIA DA REVISÃO (AP151, AP154, AP157)
--
-- Revisão de 11/11/2026 (pedido do dono). Recria duas funções, sem tabela nova:
--
--   1) `signature_apply_webhook` (a porta do aviso da ZapSign), a partir da 0359:
--      a) AP154 — a rotina diária vence o pacote SÓ PELA DATA, sem perguntar à
--         ZapSign. Uma assinatura feita no limite, com o aviso atrasado,
--         ficava enterrada ("só o registro"). Agora `doc_signed` para pacote
--         vencido PELA ROTINA (evento `expired_by_routine`) atualiza os
--         signatários; com todos assinados, o pacote passa a assinado (PDF,
--         venda e selo seguem). Vencido pela própria ZapSign não muda.
--      b) AP151 (a suspeita que tinha ficado) — o riSZon cancela na ZapSign o
--         documento de um envio que falhou; a ZapSign avisa "recusado" com o
--         `external_id` do pacote, e o RASCUNHO virava "recusado pelo
--         paciente". Agora rascunho só registra recusa/exclusão/vencimento.
--      c) AP158 (item 10) — "É a sua vez de assinar" vai também a quem já
--         abriu o link (`link_opened`), não só a quem está `pending`.
--      Tudo o mais é IGUAL à 0359 (a trava `for update`, a idempotência, a
--      venda que fecha sozinha). Régua: `assinaturas-corrida-do-envio.test.ts`.
--
--   2) `signature_consultant_scope_ok` (AP157) — a trava "o Consultor RisLife
--      só vê os pacotes das empresas e dos leads dele" valia só para quem tinha
--      APENAS esse papel. Com qualquer outro papel em qualquer unidade, sumia.
--      Agora: pacote de empresa/lead, para quem tem o papel RisLife e NÃO é
--      gestor do programa (`empresarial.is_program_manager()`: Admin Master ou
--      Franqueadora/Rede) → só os dele. Pacote de paciente segue a regra de
--      antes (quem é SÓ RisLife não vê; com outro papel, a matriz decide).
--
--   3) `signature_failure_notices` (AP155, NOVA, só da chave de serviço) — a
--      falha do pós-assinatura vira aviso no sino, pela porta do banco.
--
-- Idempotente: `create or replace`, mesma assinatura e mesmo retorno.
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

  if v_type = 'doc_refused' then
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

revoke execute on function public.signature_apply_webhook(jsonb) from public, anon, authenticated;

-- 2) A trava do Consultor RisLife (AP157).
create or replace function public.signature_consultant_scope_ok(p_company_id uuid, p_lead_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_has_rislife boolean;
  v_only_rislife boolean;
begin
  if v_uid is null then
    return false;
  end if;
  if public.is_admin_master() or public.is_owner() then
    return true;
  end if;

  select coalesce(bool_or(ucr.role = 'rislife_consultant'), false),
         coalesce(bool_and(ucr.role = 'rislife_consultant') and count(*) > 0, false)
    into v_has_rislife, v_only_rislife
    from public.user_clinic_roles ucr
   where ucr.user_id = v_uid;

  -- Pacote de paciente: quem é SÓ RisLife não vê; com outro papel, a matriz
  -- (`signature_can`) decide, como sempre.
  if p_company_id is null and p_lead_id is null then
    return not v_only_rislife;
  end if;

  -- Pacote de empresa/lead: sem o papel RisLife, ou gestor do programa,
  -- passa; o RisLife (com ou sem outros papéis) vê só os dele.
  if not v_has_rislife or empresarial.is_program_manager() then
    return true;
  end if;
  if p_company_id is not null and exists (
       select 1 from empresarial.companies c
        where c.id = p_company_id and c.assigned_consultant_id = v_uid) then
    return true;
  end if;
  if p_lead_id is not null and exists (
       select 1 from empresarial.commercial_leads l
        where l.id = p_lead_id and l.consultant_id = v_uid) then
    return true;
  end if;
  return false;
end;
$$;

revoke execute on function public.signature_consultant_scope_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.signature_consultant_scope_ok(uuid, uuid) to authenticated;

-- 3) AP155: FALHA DO PÓS-ASSINATURA VIRA AVISO (pela porta do banco, 0316).
--    Chamada pela rotina de hora em hora (chave de serviço). Cada falha avisa
--    UMA vez (chave `failure_notice|<evento>`), no sino do Admin Master e de
--    quem enviou o pacote: a venda que não fechou sozinha, o selo do lead não
--    marcado, o PDF assinado que não veio, o envio gravado pela metade e o
--    documento que ficou aberto na ZapSign depois de um envio que falhou. E a
--    rotina diária parada há mais de 26 horas (um aviso por dia).
create or replace function public.signature_failure_notices()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e record;
  v_pkg public.signature_packages;
  v_titulo text;
  v_admins uuid[];
  v_ins int;
  v_n int := 0;
  v_last timestamptz;
  v_stale boolean := false;
begin
  select coalesce(array_agg(p.id), '{}'::uuid[]) into v_admins
    from public.profiles p
   where p.is_admin_master and p.is_active and coalesce(p.kind, 'person') <> 'agent';

  for v_e in
    select e.id, e.package_id, e.event_type
      from public.signature_events e
     where e.created_at >= now() - interval '30 days'
       and e.package_id is not null
       and (e.event_type in ('closing_failed', 'lead_seal_failed', 'pdf_fetch_gave_up', 'send_mark_skipped')
            or (e.event_type = 'send_failed'
                and ((e.payload->>'doc_cancelled') = 'false' or (e.payload->>'creation_uncertain') = 'true')))
     order by e.created_at
     limit 200
  loop
    insert into public.signature_events (package_id, event_type, event_key, payload)
    values (v_e.package_id, 'failure_notified', 'failure_notice|' || v_e.id, jsonb_build_object('of', v_e.event_type))
    on conflict (event_key) do nothing;
    get diagnostics v_ins = row_count;
    continue when v_ins = 0;

    select * into v_pkg from public.signature_packages where id = v_e.package_id;
    continue when v_pkg.id is null;
    v_titulo := case v_e.event_type
      when 'closing_failed' then 'Contrato assinado, mas a venda não fechou sozinha'
      when 'lead_seal_failed' then 'Contrato de adesão assinado, mas o selo do lead não foi marcado'
      when 'pdf_fetch_gave_up' then 'O PDF assinado não veio da ZapSign'
      when 'send_mark_skipped' then 'Envio para assinatura gravado pela metade'
      else 'Documento ficou aberto na ZapSign depois de um envio que falhou' end;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct u, v_pkg.clinic_id, v_titulo,
           'Pacote ' || v_pkg.number || '. Abra o pacote para ver o que aconteceu e o que fazer.',
           '/assinaturas/pacotes/' || v_pkg.id
      from unnest(v_admins || case when v_pkg.sent_by is null then '{}'::uuid[] else array[v_pkg.sent_by] end) as u;
    v_n := v_n + 1;
  end loop;

  select max(r.ran_at) into v_last from public.signature_job_runs r where r.job = 'daily';
  if v_last is null or v_last < now() - interval '26 hours' then
    insert into public.signature_events (package_id, event_type, event_key, payload)
    values (null, 'routine_stale',
            'routine_stale|daily|' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
            jsonb_build_object('last', v_last))
    on conflict (event_key) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select u, null, 'A rotina diária das assinaturas parou',
             'Sem execução há mais de 26 horas: pacotes vencidos, lembretes e o alerta do plano não estão sendo feitos. Confira em Assinaturas → Configurações.',
             '/assinaturas/configuracoes'
        from unnest(v_admins) as u;
      v_stale := true;
    end if;
  end if;

  return jsonb_build_object('notified', v_n, 'routine_stale', v_stale);
end;
$$;

revoke execute on function public.signature_failure_notices() from public, anon, authenticated;
grant execute on function public.signature_failure_notices() to service_role;

-- Conferência (cole e rode à parte, depois): true · true · true · true
-- select
--   (pg_get_functiondef('public.signature_apply_webhook(jsonb)'::regprocedure) like '%expired_by_routine%') as vencido_pela_rotina,
--   (pg_get_functiondef('public.signature_apply_webhook(jsonb)'::regprocedure) like '%for update;%') as le_com_trava,
--   (pg_get_functiondef('public.signature_consultant_scope_ok(uuid,uuid)'::regprocedure) like '%is_program_manager%') as trava_do_rislife,
--   (to_regprocedure('public.signature_failure_notices()') is not null) as avisos_de_falha;
