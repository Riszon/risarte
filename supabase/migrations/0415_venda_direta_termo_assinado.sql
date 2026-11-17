-- =============================================================================
-- 0415 — VENDA DIRETA V3, VD3-2: O TERMO DA VENDA DIRETA PELA ZAPSIGN
--
-- Pedido do dono (16/11/2026): "não sei onde envia o contrato ou termo da
-- venda direta; não dá baixa automática na assinatura; marca tudo manual".
-- Plano e decisões (V1–V3) em docs/comercial/VENDA-DIRETA-V3-PLANO.md §7.
--
-- O que muda:
--   1) a assinatura digital aceita a origem `direct_sale`;
--   2) `direct_sales` guarda o pacote do termo, a ORIGEM da assinatura e o
--      papel anexado;
--   3) a TRAVA: uma pessoa logada não marca o termo como assinado sem a
--      ZapSign ou sem o papel anexado (PAPER_REQUIRED). Venda de R$ 0,00 (o
--      programa cobre tudo) continua fechando sozinha, como desde a 0166;
--      caminhos sem usuário (o aviso da ZapSign, rotinas) não passam pela
--      trava;
--   4) a pasta privada `termos-venda-direta` (papel assinado), caminho
--      `<venda>/<uuid>.<ext>` — sem nome de paciente;
--   5) a porta `direct_sale_term_package`: QUEM FECHA a venda direta cria o
--      pacote do termo (V1: sem a permissão geral "Enviar para assinatura");
--   6) assinou na ZapSign → a venda fica assinada SOZINHA (gatilho em
--      `signature_packages`, em nome de quem enviou, origem
--      `assinatura_digital`); a cobrança automática nasce pelo gatilho da
--      4012, que já olha `contract_signed`;
--   7) `direct_sale_mark_paper`: anexa o papel e marca, numa transação (V2:
--      quem fecha a venda).
--
-- Idempotente. Não mexe em venda existente.
-- =============================================================================

-- 1) A origem nova na assinatura ---------------------------------------------
alter table public.signature_packages drop constraint if exists signature_packages_origin_type_check;
alter table public.signature_packages add constraint signature_packages_origin_type_check
  check (origin_type in ('client', 'plan_negotiation', 'treatment_plan', 'company', 'company_document', 'commercial_lead',
                         'payment_renegotiation', 'direct_sale'));

-- 2) As colunas da venda -------------------------------------------------------
alter table public.direct_sales
  add column if not exists contract_signed_source text,
  add column if not exists signature_package_id uuid references public.signature_packages (id) on delete set null,
  add column if not exists contract_paper_path text,
  add column if not exists contract_paper_name text,
  add column if not exists contract_paper_by uuid references public.profiles (id) on delete set null,
  add column if not exists contract_paper_at timestamptz;

alter table public.direct_sales drop constraint if exists direct_sales_contract_signed_source_check;
alter table public.direct_sales add constraint direct_sales_contract_signed_source_check
  check (contract_signed_source is null or contract_signed_source in ('assinatura_digital', 'papel'));

create index if not exists direct_sales_signature_package_idx
  on public.direct_sales (signature_package_id) where signature_package_id is not null;

comment on column public.direct_sales.contract_signed_source is
  'VD3-2 (0415): de onde veio a assinatura do termo — assinatura_digital (ZapSign) ou papel (anexado). Nulo nas vendas anteriores à 0415 e nas de R$ 0,00.';
comment on column public.direct_sales.signature_package_id is
  'VD3-2 (0415): o pacote da ZapSign do termo desta venda (o mais recente).';

-- 3) A TRAVA -------------------------------------------------------------------
create or replace function public.direct_sales_term_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contract_signed
     and (tg_op = 'INSERT' or not coalesce(old.contract_signed, false))
     and (select auth.uid()) is not null
     and coalesce(new.final_cents, 0) > 0
     and not (
       coalesce(new.contract_signed_source, '') = 'assinatura_digital'
       or (coalesce(new.contract_signed_source, '') = 'papel'
           and coalesce(btrim(new.contract_paper_path), '') <> '')
     ) then
    raise exception 'PAPER_REQUIRED';
  end if;
  -- Desmarcar apaga a origem (a próxima marcação diz de novo de onde veio).
  if not new.contract_signed and coalesce(old.contract_signed, false) then
    new.contract_signed_source := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.direct_sales_term_guard() from public, anon, authenticated;

drop trigger if exists direct_sales_term_guard on public.direct_sales;
create trigger direct_sales_term_guard
  before insert or update of contract_signed, contract_signed_source, contract_paper_path
  on public.direct_sales
  for each row execute function public.direct_sales_term_guard();

-- Quem fecha ESTA venda (a regra de sempre, `direct_sale_can_close`), com a
-- venda aberta. Responde ao app (para o envio e o link de assinatura).
create or replace function public.direct_sale_can_handle_term(p_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.direct_sales s
        where s.id = p_sale_id
          and not coalesce(s.cancelled, false)
          and s.closed_at is null
          and public.direct_sale_can_close(s.clinic_id)
     );
$$;
revoke execute on function public.direct_sale_can_handle_term(uuid) from public, anon, authenticated;
grant execute on function public.direct_sale_can_handle_term(uuid) to authenticated;

-- 4) A pasta do papel ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('termos-venda-direta', 'termos-venda-direta', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A venda do caminho `<venda>/<arquivo>`; nulo se o caminho não for desse jeito.
create or replace function public.direct_sale_of_paper_path(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.direct_sale_of_paper_path(text) from public, anon, authenticated;
grant execute on function public.direct_sale_of_paper_path(text) to authenticated;

-- VER = quem vê a venda (a regra da tabela decide); ENVIAR = quem fecha, com a
-- venda aberta; APAGAR = só o Admin Master (o papel é a prova da venda).
drop policy if exists "termos_venda_direta_select" on storage.objects;
create policy "termos_venda_direta_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'termos-venda-direta'
    and exists (select 1 from public.direct_sales s where s.id = public.direct_sale_of_paper_path(name))
  );
drop policy if exists "termos_venda_direta_insert" on storage.objects;
create policy "termos_venda_direta_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'termos-venda-direta'
    and public.direct_sale_of_paper_path(name) is not null
    and public.direct_sale_can_handle_term(public.direct_sale_of_paper_path(name))
  );
drop policy if exists "termos_venda_direta_delete" on storage.objects;
create policy "termos_venda_direta_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'termos-venda-direta' and public.is_admin_master());

-- 5) A porta do termo ----------------------------------------------------------
-- O mesmo pacote da `signature_create_package` (0345), com a origem fixa na
-- venda e a conferência de QUEM FECHA no lugar da permissão geral de envio.
create or replace function public.direct_sale_term_package(
  p_sale_id uuid,
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
  v_sale public.direct_sales%rowtype;
  v_open text;
  v_id uuid;
  v_number text;
  v_item jsonb;
  v_signer jsonb;
begin
  if v_uid is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_sale from public.direct_sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if not public.direct_sale_can_close(v_sale.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(v_sale.cancelled, false) then raise exception 'SALE_CANCELLED'; end if;
  if v_sale.closed_at is not null or v_sale.contract_signed then raise exception 'ALREADY_SIGNED'; end if;
  if v_sale.client_id is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if coalesce(v_sale.final_cents, 0) > 0 and v_sale.payment_method is null then
    raise exception 'CONDITIONS_REQUIRED';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'ITEMS_REQUIRED'; end if;
  if jsonb_typeof(p_signers) <> 'array' or jsonb_array_length(p_signers) = 0 then raise exception 'SIGNERS_REQUIRED'; end if;

  -- Um termo vivo por venda: o anterior tem de ter acabado (recusado, vencido
  -- ou cancelado) para nascer outro.
  select p.number into v_open from public.signature_packages p
   where p.origin_type = 'direct_sale' and p.origin_id = p_sale_id
     and p.status in ('draft', 'sent', 'partially_signed')
   limit 1;
  if v_open is not null then raise exception 'OPEN_PACKAGE_EXISTS:%', v_open; end if;

  insert into public.signature_packages (
    clinic_id, issuer_cnpj, audience, origin_type, origin_id, client_id,
    company_id, lead_id, status, current_stage, linked_amount_cents,
    auth_level_applied, auth_reason, expires_at, cover_data, created_by
  ) values (
    v_sale.clinic_id, nullif(btrim(coalesce(p_issuer_cnpj, '')), ''), 'patient', 'direct_sale', p_sale_id, v_sale.client_id,
    null, null, 'draft', 'client', coalesce(v_sale.final_cents, 0),
    p_auth_level, p_auth_reason, p_expires_at, p_cover_data, v_uid
  )
  returning id, number into v_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.signature_package_items (
      package_id, sort_order, template_id, title, rendered_data, origin_type, origin_id
    ) values (
      v_id,
      coalesce((v_item->>'sort_order')::integer, 0),
      null,
      v_item->>'title',
      v_item->'rendered_data',
      'direct_sale',
      p_sale_id
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

  update public.direct_sales set signature_package_id = v_id, updated_at = now() where id = p_sale_id;

  insert into public.signature_events (package_id, event_type, actor_user_id, payload)
  values (v_id, 'package_created', v_uid,
          jsonb_build_object('items', jsonb_array_length(p_items), 'signers', jsonb_array_length(p_signers), 'origem', 'venda_direta'));

  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;
revoke execute on function public.direct_sale_term_package(uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.direct_sale_term_package(uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text) to authenticated;

-- 6) Assinou na ZapSign → a venda fica assinada sozinha ------------------------
-- Função de gatilho em UMA tabela (lição da 0399). Nunca derruba o aviso da
-- ZapSign: o erro vira evento do pacote e aviso no log do banco.
create or replace function public._direct_sale_mark_signed(p_package_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg public.signature_packages%rowtype;
  v_sale public.direct_sales%rowtype;
  v_closed boolean := false;
begin
  select * into v_pkg from public.signature_packages where id = p_package_id;
  if v_pkg.id is null or v_pkg.origin_type <> 'direct_sale' or v_pkg.origin_id is null then return false; end if;
  select * into v_sale from public.direct_sales where id = v_pkg.origin_id for update;
  if v_sale.id is null or coalesce(v_sale.cancelled, false) or v_sale.contract_signed then return false; end if;

  update public.direct_sales set
    contract_signed = true,
    contract_signed_at = now(),
    contract_signed_by = coalesce(v_pkg.sent_by, v_pkg.created_by),
    contract_signed_source = 'assinatura_digital',
    signature_package_id = v_pkg.id,
    updated_at = now()
  where id = v_sale.id;

  if v_sale.payment_confirmed then
    update public.direct_sales set status = 'concluida', closed_at = now(), updated_at = now()
     where id = v_sale.id and closed_at is null;
    v_closed := true;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (null, v_sale.clinic_id, 'update', 'direct_sale_close', v_sale.id::text,
          jsonb_build_object('step', 'contract', 'value', true, 'source', 'assinatura_digital',
                             'package', v_pkg.number, 'closed', v_closed));
  return true;
end;
$$;
revoke execute on function public._direct_sale_mark_signed(uuid) from public, anon, authenticated;

create or replace function public.signature_packages_direct_sale_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin_type = 'direct_sale' and new.status = 'signed'
     and old.status is distinct from 'signed' then
    begin
      perform public._direct_sale_mark_signed(new.id);
    exception when others then
      raise warning 'venda direta: termo assinado e não marcado (%): %', new.number, sqlerrm;
      insert into public.signature_events (package_id, event_type, error)
      values (new.id, 'direct_sale_mark_failed', left(sqlerrm, 300));
    end;
  end if;
  return null;
end;
$$;
revoke execute on function public.signature_packages_direct_sale_signed() from public, anon, authenticated;

drop trigger if exists signature_packages_direct_sale_signed on public.signature_packages;
create trigger signature_packages_direct_sale_signed
  after update of status on public.signature_packages
  for each row execute function public.signature_packages_direct_sale_signed();

-- 7) O papel: anexa e marca, juntos --------------------------------------------
create or replace function public.direct_sale_mark_paper(
  p_sale_id uuid,
  p_path text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale public.direct_sales%rowtype;
  v_closed boolean := false;
begin
  if v_uid is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_sale from public.direct_sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if not public.direct_sale_can_close(v_sale.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(v_sale.cancelled, false) then raise exception 'SALE_CANCELLED'; end if;
  if v_sale.closed_at is not null or v_sale.contract_signed then raise exception 'ALREADY_SIGNED'; end if;
  if coalesce(v_sale.final_cents, 0) > 0 and v_sale.payment_method is null then
    raise exception 'CONDITIONS_REQUIRED';
  end if;
  if public.direct_sale_of_paper_path(p_path) is distinct from p_sale_id
     or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'termos-venda-direta' and o.name = p_path) then
    raise exception 'FILE_NOT_FOUND';
  end if;

  update public.direct_sales set
    contract_paper_path = p_path,
    contract_paper_name = nullif(btrim(coalesce(p_name, '')), ''),
    contract_paper_by = v_uid,
    contract_paper_at = now(),
    contract_signed = true,
    contract_signed_at = now(),
    contract_signed_by = v_uid,
    contract_signed_source = 'papel',
    updated_at = now()
  where id = p_sale_id;

  if v_sale.payment_confirmed then
    update public.direct_sales set status = 'concluida', closed_at = now(), updated_at = now()
     where id = p_sale_id and closed_at is null;
    v_closed := true;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_uid, v_sale.clinic_id, 'update', 'direct_sale_close', p_sale_id::text,
          jsonb_build_object('step', 'contract', 'value', true, 'source', 'papel', 'arquivo', p_path, 'closed', v_closed));
  return jsonb_build_object('closed', v_closed);
end;
$$;
revoke execute on function public.direct_sale_mark_paper(uuid, text, text) from public, anon, authenticated;
grant execute on function public.direct_sale_mark_paper(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- Conferência (rodar depois; esperado: 1 · 4 · 1 · 1 · 1 · false):
-- select
--   (select count(*) from pg_constraint where conname = 'signature_packages_origin_type_check'
--      and pg_get_constraintdef(oid) like '%direct_sale%') as origem_nova,
--   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'direct_sales'
--      and column_name in ('contract_signed_source', 'signature_package_id', 'contract_paper_path', 'contract_paper_at')) as colunas,
--   (select count(*) from pg_trigger where tgname = 'direct_sales_term_guard') as trava,
--   (select count(*) from pg_trigger where tgname = 'signature_packages_direct_sale_signed') as marca_sozinha,
--   (select count(*) from storage.buckets where id = 'termos-venda-direta' and not public) as pasta,
--   has_function_privilege('anon', 'public.direct_sale_term_package(uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text)', 'execute') as termo_sem_login;
