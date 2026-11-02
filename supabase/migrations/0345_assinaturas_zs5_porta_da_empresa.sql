-- =============================================================================
-- 0345 — ASSINATURA DIGITAL (ZapSign) — FASE ZS5: a porta confere a empresa
-- -----------------------------------------------------------------------------
-- Plano ZS0 (docs/assinaturas/PLANO-ZS0.md §4.3, §4.6 e §11, fase ZS5).
--
-- A 0342 deixou a porta `signature_create_package` pronta para o público
-- "empresa", mas sem conferir NADA da empresa: qualquer um com
-- `acao.assinaturas.enviar` criaria um pacote apontando para uma empresa ou um
-- lead que não existe, ou que é de outro consultor. Agora:
--
--   * Pacote de EMPRESA exige a origem (`commercial_lead`, `company` ou
--     `company_document`) e ela tem de existir (`LEAD_NOT_FOUND`,
--     `COMPANY_NOT_FOUND`). Não leva cliente (`CLIENT_NOT_ALLOWED`).
--   * Origem no LEAD que já virou empresa: o pacote nasce com as DUAS
--     ligações (`lead_id` e `company_id`).
--   * A trava fixa do Consultor RisLife (`signature_consultant_scope_ok`,
--     0340) passa a valer NA CRIAÇÃO, para os dois públicos: quem só é
--     Consultor RisLife cria pacote apenas da empresa ou do lead em que é o
--     responsável, e pacote de paciente não é dele.
--
-- Assinatura (parâmetros e retorno) igual à da 0342: `create or replace`.
-- Idempotente. Não apaga dado.
-- =============================================================================

create or replace function public.signature_create_package(
  p_clinic_id uuid,
  p_audience text,
  p_origin_type text,
  p_origin_id uuid,
  p_client_id uuid,
  p_linked_amount_cents integer,
  p_auth_level text,
  p_auth_reason text,
  p_expires_at timestamptz,
  p_items jsonb,
  p_signers jsonb,
  p_cover_data jsonb,
  p_issuer_cnpj text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_number text;
  v_item jsonb;
  v_signer jsonb;
  v_company_id uuid;
  v_lead_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if not public.signature_can('acao.assinaturas.enviar', p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_audience not in ('patient', 'company') then
    raise exception 'AUDIENCE_INVALID';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;
  if jsonb_typeof(p_signers) <> 'array' or jsonb_array_length(p_signers) = 0 then
    raise exception 'SIGNERS_REQUIRED';
  end if;

  if p_audience = 'patient' then
    if p_client_id is null or not exists (
      select 1 from public.clients c
       where c.id = p_client_id
         and (c.clinic_id = p_clinic_id or c.preferred_clinic_id = p_clinic_id)
         and c.anonymized_at is null
    ) then
      raise exception 'CLIENT_NOT_FOUND';
    end if;
  else
    -- Empresarial (ZS5): a empresa ou o lead vêm na origem e precisam existir.
    if p_client_id is not null then
      raise exception 'CLIENT_NOT_ALLOWED';
    end if;
    if p_origin_id is null then
      raise exception 'ORIGIN_REQUIRED';
    end if;
    if p_origin_type = 'commercial_lead' then
      select l.id, l.company_id into v_lead_id, v_company_id
        from empresarial.commercial_leads l
       where l.id = p_origin_id;
      if v_lead_id is null then
        raise exception 'LEAD_NOT_FOUND';
      end if;
    elsif p_origin_type = 'company' then
      select c.id into v_company_id
        from empresarial.companies c
       where c.id = p_origin_id;
      if v_company_id is null then
        raise exception 'COMPANY_NOT_FOUND';
      end if;
    elsif p_origin_type = 'company_document' then
      select d.company_id into v_company_id
        from empresarial.company_documents d
       where d.id = p_origin_id;
      if v_company_id is null then
        raise exception 'COMPANY_NOT_FOUND';
      end if;
    else
      raise exception 'ORIGIN_INVALID';
    end if;
  end if;

  -- A trava fixa do Consultor RisLife (0340), agora também na criação.
  if not public.signature_consultant_scope_ok(v_company_id, v_lead_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.signature_packages (
    clinic_id, issuer_cnpj, audience, origin_type, origin_id, client_id,
    company_id, lead_id, status, current_stage, linked_amount_cents,
    auth_level_applied, auth_reason, expires_at, cover_data, created_by
  ) values (
    p_clinic_id, nullif(btrim(coalesce(p_issuer_cnpj, '')), ''), p_audience, p_origin_type, p_origin_id, p_client_id,
    v_company_id, v_lead_id, 'draft', 'client', p_linked_amount_cents,
    p_auth_level, p_auth_reason, p_expires_at, p_cover_data, v_uid
  )
  returning id, number into v_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.signature_package_items (
      package_id, sort_order, template_id, title, rendered_data, origin_type, origin_id
    ) values (
      v_id,
      coalesce((v_item->>'sort_order')::integer, 0),
      nullif(v_item->>'template_id', '')::uuid,
      v_item->>'title',
      v_item->'rendered_data',
      nullif(v_item->>'origin_type', ''),
      nullif(v_item->>'origin_id', '')::uuid
    );
  end loop;

  for v_signer in select * from jsonb_array_elements(p_signers) loop
    insert into public.signature_signers (
      package_id, sort_order, order_group, signer_type, name, cpf, email, phone,
      user_id, staff_member_id, auth_mode_applied
    ) values (
      v_id,
      coalesce((v_signer->>'sort_order')::integer, 0),
      coalesce((v_signer->>'order_group')::integer, 1),
      v_signer->>'signer_type',
      v_signer->>'name',
      nullif(v_signer->>'cpf', ''),
      nullif(v_signer->>'email', ''),
      nullif(v_signer->>'phone', ''),
      nullif(v_signer->>'user_id', '')::uuid,
      nullif(v_signer->>'staff_member_id', '')::uuid,
      nullif(v_signer->>'auth_mode_applied', '')
    );
  end loop;

  insert into public.signature_events (package_id, event_type, actor_user_id, payload)
  values (v_id, 'package_created', v_uid, jsonb_build_object('items', jsonb_array_length(p_items), 'signers', jsonb_array_length(p_signers)));

  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

revoke execute on function public.signature_create_package(uuid, text, text, uuid, uuid, integer, text, text, timestamptz, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.signature_create_package(uuid, text, text, uuid, uuid, integer, text, text, timestamptz, jsonb, jsonb, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens, nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'signature_create_package') as versoes_da_porta,
  (position('LEAD_NOT_FOUND' in pg_get_functiondef('public.signature_create_package(uuid, text, text, uuid, uuid, integer, text, text, timestamptz, jsonb, jsonb, jsonb, text)'::regprocedure)) > 0) as confere_o_lead,
  (position('signature_consultant_scope_ok' in pg_get_functiondef('public.signature_create_package(uuid, text, text, uuid, uuid, integer, text, text, timestamptz, jsonb, jsonb, jsonb, text)'::regprocedure)) > 0) as trava_do_rislife,
  has_function_privilege('anon', 'public.signature_create_package(uuid, text, text, uuid, uuid, integer, text, text, timestamptz, jsonb, jsonb, jsonb, text)', 'execute') as criar_sem_login;
