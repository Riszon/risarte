-- =============================================================================
-- 0344 — ASSINATURA DIGITAL (ZapSign) — FASE ZS4: as ações sobre o pacote
-- -----------------------------------------------------------------------------
-- Plano ZS0 (docs/assinaturas/PLANO-ZS0.md §10, fase ZS4). O detalhe do
-- pacote passa a VISUALIZAR, BAIXAR, REENVIAR e CANCELAR. Três portas novas,
-- todas `security definer` com a guarda do módulo (`signature_can`, que lê a
-- `permission_matrix`) e a trava fixa do RisLife:
--
--   * `signature_cancel_package(p_id, p_reason)` — quem tem
--     `acao.assinaturas.cancelar` na unidade emissora. Motivo obrigatório.
--     Recusa pacote ASSINADO (`PACKAGE_SIGNED`) e já cancelado
--     (`ALREADY_CANCELLED`); recusado/expirado também não (`NOT_CANCELLABLE`).
--     O servidor chama a ZapSign ANTES (`refuse`); se ela falha, esta porta
--     nem é chamada — o pacote não fica cancelado aqui e vivo lá.
--   * `signature_mark_notified(p_package_id, p_signer_ids, p_channel)` — o
--     "Reenviar": grava `last_notified_at` dos signatários pendentes e o
--     evento `action:resend`. Quem tem `acao.assinaturas.enviar`.
--   * `signature_log_action(p_package_id, p_action, p_payload)` — o registro
--     de visualizar/baixar no log do pacote (`action:view`, `action:download`,
--     `action:download_copy`). Quem vê o pacote. O `logAudit` do servidor
--     grava a outra metade (auditoria geral).
--
-- Storage: a leitura do bucket `signature-documents` já é por
-- `signature_can_view_package` (0340) — é o que deixa o servidor gerar a URL
-- assinada de 60 s com a sessão de quem pediu. Nada muda ali; as cópias
-- individuais nascem no servidor (chave de serviço), como os outros PDFs.
--
-- Continua valendo: nenhuma policy de escrita em `signature_*`; pacote
-- assinado trancado pelo gatilho da 0340; pacote nunca é apagado.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) "JÁ FOI REENVIADO COMO…" — achar o pacote novo pelo antigo
-- -----------------------------------------------------------------------------
create index if not exists signature_packages_resent_from_idx
  on public.signature_packages (resent_from_package_id)
  where resent_from_package_id is not null;

-- A lista `/assinaturas/pacotes` ordena pelo envio mais recente.
create index if not exists signature_packages_sent_at_idx
  on public.signature_packages (sent_at desc nulls last);

-- -----------------------------------------------------------------------------
-- 2) CANCELAR
-- -----------------------------------------------------------------------------
create or replace function public.signature_cancel_package(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pkg public.signature_packages;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_pkg from public.signature_packages where id = p_id for update;
  if not found then
    raise exception 'PACKAGE_NOT_FOUND';
  end if;

  if not public.signature_can('acao.assinaturas.cancelar', v_pkg.clinic_id)
     or not public.signature_consultant_scope_ok(v_pkg.company_id, v_pkg.lead_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_reason is null then
    raise exception 'REASON_REQUIRED';
  end if;
  if length(v_reason) > 500 then
    v_reason := left(v_reason, 500);
  end if;

  if v_pkg.status = 'signed' then
    raise exception 'PACKAGE_SIGNED';
  end if;
  if v_pkg.status = 'cancelled' then
    raise exception 'ALREADY_CANCELLED';
  end if;
  if v_pkg.status not in ('draft', 'sent', 'partially_signed') then
    raise exception 'NOT_CANCELLABLE';
  end if;

  update public.signature_packages
     set status = 'cancelled',
         cancel_reason = v_reason,
         cancelled_by = v_uid,
         cancelled_at = now()
   where id = p_id;

  insert into public.signature_events (package_id, event_type, actor_user_id, payload)
  values (p_id, 'action:cancel', v_uid, jsonb_build_object('from_status', v_pkg.status));

  return jsonb_build_object('id', p_id, 'number', v_pkg.number, 'status', 'cancelled');
end;
$$;

revoke execute on function public.signature_cancel_package(uuid, text) from public, anon, authenticated;
grant execute on function public.signature_cancel_package(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) REENVIAR — quando cada pessoa foi avisada de novo
-- -----------------------------------------------------------------------------
-- `p_signer_ids` nulo = todos os pendentes do pacote (o reenvio por e-mail da
-- ZapSign vai a todos os pendentes de uma vez). Só signatário pendente ganha
-- a data; quem já assinou não.
create or replace function public.signature_mark_notified(
  p_package_id uuid,
  p_signer_ids uuid[],
  p_channel text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pkg public.signature_packages;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_pkg from public.signature_packages where id = p_package_id;
  if not found then
    raise exception 'PACKAGE_NOT_FOUND';
  end if;
  if not public.signature_can('acao.assinaturas.enviar', v_pkg.clinic_id)
     or not public.signature_consultant_scope_ok(v_pkg.company_id, v_pkg.lead_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_pkg.status not in ('sent', 'partially_signed') then
    raise exception 'NOT_WAITING';
  end if;
  if p_channel is null or p_channel not in ('whatsapp_link', 'copy_link', 'sign_now', 'zapsign_email') then
    raise exception 'CHANNEL_INVALID';
  end if;

  update public.signature_signers
     set last_notified_at = now()
   where package_id = p_package_id
     and status in ('pending', 'link_opened')
     and (p_signer_ids is null or id = any (p_signer_ids));
  get diagnostics v_count = row_count;

  insert into public.signature_events (package_id, event_type, actor_user_id, payload)
  values (p_package_id, 'action:resend', v_uid,
          jsonb_build_object('channel', p_channel, 'signers', v_count,
                             'signer_ids', coalesce(to_jsonb(p_signer_ids), 'null'::jsonb)));

  return v_count;
end;
$$;

revoke execute on function public.signature_mark_notified(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.signature_mark_notified(uuid, uuid[], text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) VISUALIZAR / BAIXAR — o rastro no log do pacote
-- -----------------------------------------------------------------------------
create or replace function public.signature_log_action(
  p_package_id uuid,
  p_action text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.signature_can_view_package(p_package_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_action is null or p_action not in ('view', 'download', 'download_copy') then
    raise exception 'ACTION_INVALID';
  end if;
  insert into public.signature_events (package_id, event_type, actor_user_id, payload)
  values (p_package_id, 'action:' || p_action, v_uid,
          case when p_payload is null or jsonb_typeof(p_payload) <> 'object' then null else p_payload end);
end;
$$;

revoke execute on function public.signature_log_action(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.signature_log_action(uuid, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) AUDITORIA (0288): nenhuma tabela nova
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('signature_cancel_package', 'signature_mark_notified', 'signature_log_action')) as funcoes,
  (select count(*) from pg_indexes where schemaname = 'public'
    and indexname in ('signature_packages_resent_from_idx', 'signature_packages_sent_at_idx')) as indices,
  (select has_function_privilege('anon', 'public.signature_cancel_package(uuid, text)', 'execute')) as cancelar_sem_login,
  (select has_function_privilege('authenticated', 'public.signature_cancel_package(uuid, text)', 'execute')) as cancelar_logado,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'signature\_%' and cmd <> 'SELECT') as policies_fora_de_select;
