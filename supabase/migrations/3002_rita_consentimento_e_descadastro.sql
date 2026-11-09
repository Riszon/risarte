-- =============================================================================
-- 3002 — Rita, Fase 0A.3: consentimento de contato e descadastro (opt-out)
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.3 (decisões 15, 17, 18 e 30 de
-- docs/sdr/DECISOES_RITA.md).
--
-- O QUE CRIA
--   * `rita.phone_e164(texto)`: o telefone no formato +55DDNÚMERO, ou nulo se
--     não for um telefone brasileiro com DDD (10 ou 11 dígitos depois do 55).
--   * `rita.consent_texts`: as versões do TEXTO do consentimento. Nasce VAZIA
--     (decisão 30 em aberto). `rita.approve_consent_text` — só Admin Master.
--     **Sem texto aprovado, ninguém grava consentimento novo** (nem a Rita nem
--     a recepção): `CONSENT_TEXT_NOT_APPROVED`.
--   * `rita.contact_consents`: cada consentimento, com o telefone, a
--     finalidade (`contato` / `marketing`), a versão do texto, por onde veio e
--     quem registrou. Revogar marca `revoked_at`; nunca se apaga.
--   * `rita.opt_outs`: cada "não quero mais receber", em linhas que nunca se
--     apagam. Voltar atrás é um consentimento NOVO, com data posterior.
--   * `rita.can_contact(telefone, finalidade)`: pode ou não, e por quê. Vale o
--     FATO MAIS RECENTE entre: consentimento da Rita (libera), aceite do
--     indicado no Indica +Risos (libera, só para `contato`), revogação de
--     qualquer um dos dois (bloqueia) e descadastro (bloqueia). Sem nenhum
--     fato: não pode. O Indica só é LIDO; nada muda nele.
--   * Portas: `rita.register_consent`, `rita.revoke_consent`,
--     `rita.register_opt_out` — pela chave de serviço (autora: a Rita) ou por
--     uma pessoa logada da equipe (autora: ela).
--
-- "Não quero contato" (decisão 18): a Rita registra o DESCADASTRO daquele
-- telefone; o bloqueio vale para qualquer abordagem nova, inclusive nova
-- indicação. As recusas do Indica têm motivo em texto livre e NÃO são lidas.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O telefone normalizado
-- -----------------------------------------------------------------------------
create or replace function rita.phone_e164(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');
begin
  -- Zeros de discagem na frente ("0 43 …", "0055 …") saem.
  d := regexp_replace(d, '^0+', '');
  if length(d) in (12, 13) and left(d, 2) = '55' then
    d := substr(d, 3);
  end if;
  -- DDD de 11 a 99 + 8 ou 9 dígitos.
  if d !~ '^[1-9][1-9][0-9]{8,9}$' then
    return null;
  end if;
  return '+55' || d;
end;
$$;

revoke execute on function rita.phone_e164(text) from public, anon, authenticated;
grant execute on function rita.phone_e164(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) As tabelas
-- -----------------------------------------------------------------------------
create table if not exists rita.consent_texts (
  version text primary key check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  purpose text not null check (purpose in ('contato', 'marketing')),
  body text not null check (length(btrim(body)) >= 20),
  approved_by uuid not null references public.profiles (id),
  approved_at timestamptz not null default now()
);

create table if not exists rita.contact_consents (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+55[1-9][1-9][0-9]{8,9}$'),
  person_kind text check (person_kind in ('client', 'guardian', 'lead', 'employee', 'dependent')),
  person_id uuid,
  clinic_id uuid references public.clinics (id) on delete set null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  purpose text not null check (purpose in ('contato', 'marketing')),
  text_version text not null references rita.consent_texts (version),
  granted_at timestamptz not null default clock_timestamp(),
  granted_via text not null
    check (granted_via in ('whatsapp', 'presencial', 'telefone', 'evento', 'importacao', 'portal')),
  evidence jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  revoked_via text,
  registered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists contact_consents_phone on rita.contact_consents (phone_e164, purpose);

create table if not exists rita.opt_outs (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+55[1-9][1-9][0-9]{8,9}$'),
  opted_out_at timestamptz not null default clock_timestamp(),
  via text not null check (via in ('whatsapp', 'presencial', 'telefone', 'email', 'portal')),
  note text,
  registered_by uuid not null references public.profiles (id)
);

create index if not exists opt_outs_phone on rita.opt_outs (phone_e164, opted_out_at desc);

-- O relógio de CADA comando (não o do início da transação): descadastro e
-- consentimento novo na mesma transação ficam na ordem certa.
alter table rita.contact_consents alter column granted_at set default clock_timestamp();
alter table rita.opt_outs alter column opted_out_at set default clock_timestamp();

do $$
declare
  t text;
begin
  foreach t in array array['consent_texts', 'contact_consents', 'opt_outs'] loop
    execute format('alter table rita.%I enable row level security', t);
    execute format('revoke all on rita.%I from public, anon, authenticated', t);
    execute format('grant all on rita.%I to service_role', t);
  end loop;
end $$;

-- Nada disso se apaga (nem pela chave de serviço). Corrigir = linha nova.
create or replace function rita._never_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'RITA_NEVER_DELETE'
    using hint = 'Consentimento e descadastro não se apagam: registre um fato novo.';
end;
$$;

revoke execute on function rita._never_delete() from public, anon, authenticated;

drop trigger if exists never_delete on rita.consent_texts;
create trigger never_delete before delete on rita.consent_texts
  for each row execute function rita._never_delete();
drop trigger if exists never_delete on rita.contact_consents;
create trigger never_delete before delete on rita.contact_consents
  for each row execute function rita._never_delete();
drop trigger if exists never_delete on rita.opt_outs;
create trigger never_delete before delete on rita.opt_outs
  for each row execute function rita._never_delete();

-- -----------------------------------------------------------------------------
-- 3) Quem registra: a Rita (chave de serviço) ou uma pessoa da equipe
-- -----------------------------------------------------------------------------
-- Devolve o autor. Sem login: a Rita (declara a autoria na transação). Com
-- login: a pessoa, que precisa ser da equipe (ter a unidade no escopo, ou ser
-- Admin Master quando não há unidade).
create or replace function rita._author(p_clinic uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return rita.begin_as_agent();
  end if;
  if public.is_admin_master() then
    return v_uid;
  end if;
  if p_clinic is not null and p_clinic in (select public.user_full_access_clinic_ids()) then
    return v_uid;
  end if;
  raise exception 'NOT_ALLOWED';
end;
$$;

revoke execute on function rita._author(uuid) from public, anon, authenticated;

-- Pedir para PARAR é sempre aceito de quem é da equipe, de qualquer unidade:
-- proteger a pessoa nunca depende do escopo de quem anota.
create or replace function rita._author_protective()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return rita.begin_as_agent();
  end if;
  if public.is_admin_master()
     or exists (select 1 from public.user_clinic_roles_all r where r.user_id = v_uid) then
    return v_uid;
  end if;
  raise exception 'NOT_ALLOWED';
end;
$$;

revoke execute on function rita._author_protective() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) O texto do consentimento (só o Admin Master aprova)
-- -----------------------------------------------------------------------------
create or replace function rita.approve_consent_text(p_version text, p_purpose text, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if exists (select 1 from rita.consent_texts where version = p_version) then
    -- Texto aprovado não muda: versão nova.
    raise exception 'CONSENT_TEXT_EXISTS';
  end if;
  insert into rita.consent_texts (version, purpose, body, approved_by)
  values (p_version, p_purpose, p_body, auth.uid());
exception
  when check_violation or not_null_violation then
    raise exception 'INVALID_INPUT';
end;
$$;

revoke execute on function rita.approve_consent_text(text, text, text) from public, anon, authenticated;
grant execute on function rita.approve_consent_text(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Registrar e revogar consentimento; registrar descadastro
-- -----------------------------------------------------------------------------
create or replace function rita.register_consent(
  p_phone text,
  p_purpose text,
  p_text_version text,
  p_via text,
  p_clinic uuid default null,
  p_person_kind text default null,
  p_person_id uuid default null,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_phone text := rita.phone_e164(p_phone);
  v_autor uuid;
  v_id uuid;
begin
  v_autor := rita._author(p_clinic);
  if v_phone is null then
    raise exception 'INVALID_PHONE';
  end if;
  if not exists (
    select 1 from rita.consent_texts t
    where t.version = p_text_version and t.purpose = p_purpose
  ) then
    raise exception 'CONSENT_TEXT_NOT_APPROVED';
  end if;
  -- A Rita só registra o que ela mesma ouviu: pelo WhatsApp.
  if auth.uid() is null and p_via <> 'whatsapp' then
    raise exception 'INVALID_INPUT';
  end if;

  insert into rita.contact_consents
    (phone_e164, person_kind, person_id, clinic_id, purpose, text_version,
     granted_via, evidence, registered_by)
  values
    (v_phone, p_person_kind, p_person_id, p_clinic, p_purpose, p_text_version,
     p_via, coalesce(p_evidence, '{}'::jsonb), v_autor)
  returning id into v_id;
  return v_id;
exception
  when check_violation or not_null_violation then
    raise exception 'INVALID_INPUT';
end;
$$;

revoke execute on function rita.register_consent(text, text, text, text, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function rita.register_consent(text, text, text, text, uuid, text, uuid, jsonb) to authenticated, service_role;

create or replace function rita.revoke_consent(p_phone text, p_purpose text, p_via text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_phone text := rita.phone_e164(p_phone);
  v_n integer;
begin
  perform rita._author_protective();
  if v_phone is null then
    raise exception 'INVALID_PHONE';
  end if;
  if coalesce(p_purpose, '') not in ('contato', 'marketing') or nullif(btrim(coalesce(p_via, '')), '') is null then
    raise exception 'INVALID_INPUT';
  end if;
  update rita.contact_consents set
    revoked_at = clock_timestamp(),
    revoked_via = left(p_via, 40)
  where phone_e164 = v_phone and purpose = p_purpose and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function rita.revoke_consent(text, text, text) from public, anon, authenticated;
grant execute on function rita.revoke_consent(text, text, text) to authenticated, service_role;

create or replace function rita.register_opt_out(p_phone text, p_via text, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_phone text := rita.phone_e164(p_phone);
  v_autor uuid;
  v_id uuid;
begin
  v_autor := rita._author_protective();
  if v_phone is null then
    raise exception 'INVALID_PHONE';
  end if;
  insert into rita.opt_outs (phone_e164, via, note, registered_by)
  values (v_phone, p_via, left(nullif(btrim(p_note), ''), 500), v_autor)
  returning id into v_id;
  return v_id;
exception
  when check_violation or not_null_violation then
    raise exception 'INVALID_INPUT';
end;
$$;

revoke execute on function rita.register_opt_out(text, text, text) from public, anon, authenticated;
grant execute on function rita.register_opt_out(text, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6) Pode contatar?
-- -----------------------------------------------------------------------------
-- A conta, sem guarda (a Rita usa por dentro).
create or replace function rita._can_contact(p_phone text, p_purpose text)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := rita.phone_e164(p_phone);
  v record;
begin
  if v_phone is null then
    allowed := false; reason := 'telefone_invalido'; return next; return;
  end if;
  if p_purpose is null or p_purpose not in ('contato', 'marketing') then
    allowed := false; reason := 'finalidade_invalida'; return next; return;
  end if;

  -- Todos os fatos sobre o telefone; vale o mais recente. Empate: bloqueia.
  select f.quando, f.libera, f.motivo into v
  from (
    select c.granted_at as quando, true as libera, 'consentimento' as motivo
      from rita.contact_consents c
     where c.phone_e164 = v_phone and c.purpose = p_purpose
    union all
    select c.revoked_at, false, 'consentimento_revogado'
      from rita.contact_consents c
     where c.phone_e164 = v_phone and c.purpose = p_purpose and c.revoked_at is not null
    union all
    select o.opted_out_at, false, 'descadastro'
      from rita.opt_outs o
     where o.phone_e164 = v_phone
    union all
    -- O aceite do indicado no Indica +Risos vale para CONTATO (decisão 17).
    select k.aceito_em, true, 'aceite_indica'
      from indica.consentimentos k
      join indica.indicacoes i on i.id = k.indicacao_id
     where p_purpose = 'contato'
       and k.aceito_em is not null
       and rita.phone_e164(i.indicado_telefone_digitos) = v_phone
    union all
    select k.revogado_em, false, 'aceite_indica_revogado'
      from indica.consentimentos k
      join indica.indicacoes i on i.id = k.indicacao_id
     where k.revogado_em is not null
       and rita.phone_e164(i.indicado_telefone_digitos) = v_phone
  ) f
  order by f.quando desc, f.libera asc
  limit 1;

  if v.quando is null then
    allowed := false; reason := 'sem_consentimento';
  else
    allowed := v.libera; reason := v.motivo;
  end if;
  return next;
end;
$$;

revoke execute on function rita._can_contact(text, text) from public, anon, authenticated;

create or replace function rita.can_contact(p_phone text, p_purpose text)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not public.is_admin_master()
     and not exists (select 1 from public.user_clinic_roles_all r where r.user_id = auth.uid()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from rita._can_contact(p_phone, p_purpose);
end;
$$;

revoke execute on function rita.can_contact(text, text) from public, anon, authenticated;
grant execute on function rita.can_contact(text, text) to authenticated, service_role;

select public.audit_attach_all();

notify pgrst, 'reload schema';
