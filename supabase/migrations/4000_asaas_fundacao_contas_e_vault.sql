-- =============================================================================
-- 4000 — INTEGRAÇÃO ASAAS — FASE ASA0: contas, Vault, registros e webhook
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 10/11/2026: docs/integracao-asaas.md (versão 3,
-- seções 3, 7, 8 e 10). Faixa própria de migração do Asaas: 4000+.
--
-- O que nasce aqui:
--   * `gateway_settings`       — o interruptor de PRODUÇÃO (nasce desligado e
--                                 não existe função para ligar até a ASA7).
--   * `gateway_accounts`       — uma linha por conta Asaas (raiz, unidade ou
--                                 carteira de repasse).
--   * `gateway_key_usage`      — cada leitura da chave: quem, quando, para quê.
--   * `gateway_api_log`        — cada chamada ao Asaas: método, rota, status e
--                                 duração. Nunca corpo, chave ou CPF.
--   * `gateway_webhook_events` — o evento bruto e a idempotência (ASA0 só
--                                 grava; quem processa é a ASA2).
--
-- ⚠️ A CHAVE DE API MORA NO SUPABASE VAULT (`vault.secrets`). A tabela guarda
-- só o identificador do segredo. Nenhuma função devolve a chave a usuário
-- logado: `_gateway_read_key` responde apenas à chave de serviço (o servidor
-- do riSZon) e grava cada uso.
--
-- ⚠️ TRAVA DE PRODUÇÃO NO BANCO: o gatilho `gateway_accounts_guard` recusa
-- conta `production` enquanto `gateway_settings.production_enabled` for falso
-- (GATEWAY_PRODUCTION_LOCKED), e recusa trocar o ambiente de uma conta.
--
-- ⚠️ NENHUMA REGRA DE ESCRITA: `gateway_*` só é gravada por função.
--
-- Idempotente. Não altera tabela existente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O INTERRUPTOR DE PRODUÇÃO
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_settings (
  id boolean primary key default true check (id),
  -- Falso = o banco recusa qualquer conta de produção. Só a ASA7 cria a
  -- função que liga (Admin Master, com aprovação explícita do dono).
  production_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

insert into public.gateway_settings (id) values (true) on conflict (id) do nothing;

alter table public.gateway_settings enable row level security;

drop policy if exists "gateway_settings_select" on public.gateway_settings;
create policy "gateway_settings_select" on public.gateway_settings
  for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor());

-- -----------------------------------------------------------------------------
-- 2) AS CONTAS
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_accounts (
  id uuid primary key default gen_random_uuid(),
  -- franchisor = a conta raiz (emite o Empresarial e a cobrança mensal);
  -- unit = a conta da unidade (emite as cobranças de paciente);
  -- recipient = carteira que só recebe split (RisLife) — sem unidade.
  owner_type text not null check (owner_type in ('franchisor', 'unit', 'recipient')),
  clinic_id uuid references public.clinics (id),
  label text not null check (length(btrim(label)) > 0),
  cnpj text,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  -- linked = conta que já existe e autoriza o riSZon; subaccount = criada pela
  -- franqueadora (construída, desligada: D2).
  mode text not null default 'linked' check (mode in ('linked', 'subaccount')),
  status text not null default 'awaiting_key'
    check (status in ('awaiting_key', 'active', 'error', 'disabled')),

  -- O que o Asaas respondeu na vinculação e na verificação semanal.
  asaas_account_id text,
  wallet_id text,
  account_name text,
  account_status jsonb,
  commercial_info_expires_on date,
  validated_at timestamptz,

  -- A chave: só a referência do Vault. Nunca o valor.
  api_key_secret_id uuid,
  api_key_saved_at timestamptz,
  api_key_saved_by uuid references public.profiles (id),
  api_key_last_used_at timestamptz,

  -- O webhook criado pela API. `webhook_ref` é o trecho opaco do endereço
  -- (`/api/webhooks/asaas/<ref>`): diz de qual conta veio ANTES de comparar o
  -- token.
  webhook_ref text not null default replace(gen_random_uuid()::text, '-', ''),
  webhook_id text,
  webhook_token_secret_id uuid,
  webhook_created_at timestamptz,
  webhook_last_event_at timestamptz,

  -- O termo em que o franqueado autoriza a franqueadora a operar a conta.
  term_signed_on date,
  term_signed_by_name text,
  term_note text,
  term_registered_at timestamptz,
  term_registered_by uuid references public.profiles (id),
  -- Reservados para o futuro (anexo do termo; termo assinado pela ZapSign).
  -- Sem chave estrangeira de propósito: uma 2ª ligação para a mesma tabela
  -- deixa ambíguas as leituras embutidas dela.
  term_attachment_path text,
  term_signature_package_id uuid,

  -- Itens de prontidão que vêm do painel do Asaas ou da API.
  split_enabled_declared_at timestamptz,
  split_enabled_declared_by uuid references public.profiles (id),
  split_enabled_confirmed_at timestamptz,
  pix_key_active boolean,
  pix_key_checked_at timestamptz,
  anticipation_auto_enabled boolean,
  anticipation_checked_at timestamptz,
  fees_synced_at timestamptz,

  -- A verificação semanal.
  last_check_at timestamptz,
  last_check_ok boolean,
  last_check_error text,

  disabled_at timestamptz,
  disabled_by uuid references public.profiles (id),
  disabled_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),

  constraint gateway_accounts_owner_clinic_check check (
    (owner_type = 'recipient' and clinic_id is null)
    or (owner_type in ('franchisor', 'unit') and clinic_id is not null)
  )
);

comment on table public.gateway_accounts is
  'Contas Asaas ligadas ao riSZon (ASA0). A chave de API fica no Vault; aqui só a referência.';

create unique index if not exists gateway_accounts_webhook_ref_unique
  on public.gateway_accounts (webhook_ref);
-- Uma conta em uso por unidade e ambiente.
create unique index if not exists gateway_accounts_one_per_clinic
  on public.gateway_accounts (clinic_id, environment)
  where clinic_id is not null and status <> 'disabled';
create index if not exists gateway_accounts_clinic_idx
  on public.gateway_accounts (clinic_id);

alter table public.gateway_accounts enable row level security;

-- Lê: Admin Master, Financeiro da Franqueadora e o Gerente da própria unidade.
drop policy if exists "gateway_accounts_select" on public.gateway_accounts;
create policy "gateway_accounts_select" on public.gateway_accounts
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
  );

-- A trava de produção e o que nunca muda numa conta.
create or replace function public.gateway_accounts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.environment = 'production'
     and not coalesce((select s.production_enabled from public.gateway_settings s limit 1), false) then
    raise exception 'GATEWAY_PRODUCTION_LOCKED';
  end if;

  if tg_op = 'UPDATE' then
    if new.environment is distinct from old.environment then
      raise exception 'GATEWAY_ENVIRONMENT_IMMUTABLE';
    end if;
    if new.clinic_id is distinct from old.clinic_id
       or new.owner_type is distinct from old.owner_type then
      raise exception 'GATEWAY_OWNER_IMMUTABLE';
    end if;
    if new.webhook_ref is distinct from old.webhook_ref then
      raise exception 'GATEWAY_WEBHOOK_REF_IMMUTABLE';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function public.gateway_accounts_guard() from public, anon, authenticated;

drop trigger if exists gateway_accounts_guard on public.gateway_accounts;
create trigger gateway_accounts_guard
  before insert or update on public.gateway_accounts
  for each row execute function public.gateway_accounts_guard();

-- Conta nunca é apagada: desativar é o caminho (o histórico fica).
create or replace function public.gateway_accounts_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GATEWAY_ACCOUNT_NO_DELETE';
end;
$$;

revoke execute on function public.gateway_accounts_no_delete() from public, anon, authenticated;

drop trigger if exists gateway_accounts_no_delete on public.gateway_accounts;
create trigger gateway_accounts_no_delete
  before delete on public.gateway_accounts
  for each row execute function public.gateway_accounts_no_delete();

-- -----------------------------------------------------------------------------
-- 3) OS REGISTROS TÉCNICOS
-- -----------------------------------------------------------------------------
-- Cada leitura da chave. Só cresce.
create table if not exists public.gateway_key_usage (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.gateway_accounts (id),
  purpose text not null,
  actor uuid,
  used_at timestamptz not null default now()
);
create index if not exists gateway_key_usage_account_idx
  on public.gateway_key_usage (account_id, used_at desc);
alter table public.gateway_key_usage enable row level security;

drop policy if exists "gateway_key_usage_select" on public.gateway_key_usage;
create policy "gateway_key_usage_select" on public.gateway_key_usage
  for select to authenticated
  using (public.is_admin_master());

-- Cada chamada ao Asaas. `path` é o MODELO da rota (sem identificadores).
create table if not exists public.gateway_api_log (
  id bigint generated always as identity primary key,
  account_id uuid references public.gateway_accounts (id),
  method text not null,
  path text not null,
  http_status integer,
  duration_ms integer,
  attempt integer not null default 1,
  error_code text,
  rate_remaining integer,
  purpose text,
  created_at timestamptz not null default now()
);
create index if not exists gateway_api_log_account_idx
  on public.gateway_api_log (account_id, created_at desc);
alter table public.gateway_api_log enable row level security;

drop policy if exists "gateway_api_log_select" on public.gateway_api_log;
create policy "gateway_api_log_select" on public.gateway_api_log
  for select to authenticated
  using (public.is_admin_master());

-- O evento bruto do webhook. Sem regra de leitura: só o servidor lê (ASA2).
create table if not exists public.gateway_webhook_events (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.gateway_accounts (id),
  asaas_event_id text not null,
  event text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (account_id, asaas_event_id)
);
create index if not exists gateway_webhook_events_pending_idx
  on public.gateway_webhook_events (received_at)
  where processed_at is null;
alter table public.gateway_webhook_events enable row level security;

-- -----------------------------------------------------------------------------
-- 4) QUEM PODE
-- -----------------------------------------------------------------------------
-- A pessoa pode gravar a chave desta conta?
--   * Admin Master: sempre.
--   * Gerente da PRÓPRIA unidade: só depois de o termo de autorização do
--     franqueado estar registrado (decisão do dono, 10/11/2026).
-- Recebe a pessoa por parâmetro porque quem chama é o servidor (chave de
-- serviço), depois de validar a chave no Asaas.
create or replace function public._gateway_actor_can_link(p_actor uuid, p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      exists (
        select 1 from public.profiles p
         where p.id = p_actor and p.is_active and p.is_admin_master
      )
      or (
        a.owner_type = 'unit'
        and a.term_registered_at is not null
        and exists (
          select 1
            from public.user_clinic_roles_all r
            join public.profiles p on p.id = r.user_id and p.is_active
           where r.user_id = p_actor
             and r.clinic_id = a.clinic_id
             and r.role = 'unit_manager'
        )
      )
    from public.gateway_accounts a
   where a.id = p_account_id
  ), false);
$$;

revoke execute on function public._gateway_actor_can_link(uuid, uuid) from public, anon, authenticated;

-- A mesma pergunta, para a TELA (quem está logado). Não revela nada além de
-- sim ou não.
create or replace function public.gateway_can_link(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._gateway_actor_can_link((select auth.uid()), p_account_id);
$$;

revoke execute on function public.gateway_can_link(uuid) from public, anon, authenticated;
grant execute on function public.gateway_can_link(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) O QUE O ADMIN MASTER FAZ PELA TELA (sem segredo nenhum)
-- -----------------------------------------------------------------------------
-- Abre o cadastro da conta (ainda sem chave).
create or replace function public.gateway_create_account(
  p_clinic_id uuid,
  p_owner_type text,
  p_label text,
  p_cnpj text default null,
  p_environment text default 'sandbox'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_type public.clinic_type;
  v_id uuid;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_owner_type not in ('franchisor', 'unit', 'recipient') then
    raise exception 'OWNER_TYPE_UNKNOWN';
  end if;

  if p_owner_type = 'recipient' then
    if p_clinic_id is not null then raise exception 'RECIPIENT_HAS_NO_CLINIC'; end if;
  else
    select c.type into v_type from public.clinics c where c.id = p_clinic_id;
    if v_type is null then raise exception 'CLINIC_NOT_FOUND'; end if;
    if (p_owner_type = 'franchisor') is distinct from (v_type = 'franchisor') then
      raise exception 'OWNER_TYPE_MISMATCH';
    end if;
    if exists (
      select 1 from public.gateway_accounts a
       where a.clinic_id = p_clinic_id
         and a.environment = coalesce(p_environment, 'sandbox')
         and a.status <> 'disabled'
    ) then
      raise exception 'ACCOUNT_ALREADY_EXISTS';
    end if;
  end if;

  insert into public.gateway_accounts (owner_type, clinic_id, label, cnpj, environment, created_by)
  values (p_owner_type, p_clinic_id, btrim(p_label), nullif(btrim(coalesce(p_cnpj, '')), ''),
          coalesce(p_environment, 'sandbox'), v_user)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.gateway_create_account(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.gateway_create_account(uuid, text, text, text, text) to authenticated;

-- Registra o termo de autorização do franqueado (data, quem assinou, nota).
create or replace function public.gateway_register_term(
  p_account_id uuid,
  p_signed_on date,
  p_signed_by_name text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_signed_on is null or p_signed_on > public.today_br() then
    raise exception 'TERM_DATE_INVALID';
  end if;
  if length(btrim(coalesce(p_signed_by_name, ''))) < 3 then
    raise exception 'TERM_SIGNER_REQUIRED';
  end if;

  update public.gateway_accounts a
     set term_signed_on = p_signed_on,
         term_signed_by_name = btrim(p_signed_by_name),
         term_note = nullif(btrim(coalesce(p_note, '')), ''),
         term_registered_at = now(),
         term_registered_by = (select auth.uid())
   where a.id = p_account_id and a.status <> 'disabled';
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
end;
$$;

revoke execute on function public.gateway_register_term(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.gateway_register_term(uuid, date, text, text) to authenticated;

-- "O split está habilitado no painel do Asaas" — declaração do Admin Master.
-- A ASA3 confirma sozinha no primeiro split aceito (`split_enabled_confirmed_at`).
create or replace function public.gateway_declare_split_enabled(p_account_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.gateway_accounts a
     set split_enabled_declared_at = case when coalesce(p_enabled, false) then now() else null end,
         split_enabled_declared_by = case when coalesce(p_enabled, false) then (select auth.uid()) else null end
   where a.id = p_account_id and a.status <> 'disabled';
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
end;
$$;

revoke execute on function public.gateway_declare_split_enabled(uuid, boolean) from public, anon, authenticated;
grant execute on function public.gateway_declare_split_enabled(uuid, boolean) to authenticated;

-- Desativa a conta e APAGA a chave e o token do Vault. O cadastro e o
-- histórico ficam. (O webhook no Asaas é removido pelo servidor antes.)
create or replace function public.gateway_disable_account(p_account_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key uuid;
  v_token uuid;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'REASON_REQUIRED';
  end if;

  select a.api_key_secret_id, a.webhook_token_secret_id into v_key, v_token
    from public.gateway_accounts a
   where a.id = p_account_id and a.status <> 'disabled'
   for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;

  update public.gateway_accounts a
     set status = 'disabled',
         disabled_at = now(),
         disabled_by = (select auth.uid()),
         disabled_reason = btrim(p_reason),
         api_key_secret_id = null,
         webhook_token_secret_id = null
   where a.id = p_account_id;

  delete from vault.secrets s where s.id in (v_key, v_token);
end;
$$;

revoke execute on function public.gateway_disable_account(uuid, text) from public, anon, authenticated;
grant execute on function public.gateway_disable_account(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O QUE SÓ O SERVIDOR FAZ (chave de serviço) — segredos
-- -----------------------------------------------------------------------------
-- Grava a chave validada no Vault e os dados que o Asaas devolveu.
-- `p_actor` nulo = roteiro de servidor (contas de teste do sandbox).
create or replace function public._gateway_store_credentials(
  p_account_id uuid,
  p_actor uuid,
  p_api_key text,
  p_wallet_id text,
  p_asaas_account_id text,
  p_account_name text,
  p_cnpj text,
  p_account_status jsonb,
  p_commercial_info_expires_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_secret uuid;
begin
  select * into v_acc from public.gateway_accounts a where a.id = p_account_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.status = 'disabled' then raise exception 'ACCOUNT_DISABLED'; end if;

  if p_actor is not null and not public._gateway_actor_can_link(p_actor, p_account_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- A chave tem de ser do MESMO ambiente da conta.
  if p_api_key is null or length(p_api_key) < 20 then
    raise exception 'API_KEY_INVALID';
  end if;
  if v_acc.environment = 'sandbox' and left(p_api_key, 11) <> '$aact_hmlg_' then
    raise exception 'API_KEY_WRONG_ENVIRONMENT';
  end if;
  if v_acc.environment = 'production' and left(p_api_key, 11) <> '$aact_prod_' then
    raise exception 'API_KEY_WRONG_ENVIRONMENT';
  end if;
  if length(btrim(coalesce(p_wallet_id, ''))) = 0 then
    raise exception 'WALLET_REQUIRED';
  end if;

  if v_acc.api_key_secret_id is not null
     and exists (select 1 from vault.secrets s where s.id = v_acc.api_key_secret_id) then
    perform vault.update_secret(v_acc.api_key_secret_id, p_api_key);
    v_secret := v_acc.api_key_secret_id;
  else
    v_secret := vault.create_secret(
      p_api_key,
      'gateway_api_key_' || p_account_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
      'Chave de API do Asaas (riSZon). Nunca exibir.'
    );
  end if;

  update public.gateway_accounts a
     set api_key_secret_id = v_secret,
         api_key_saved_at = now(),
         api_key_saved_by = p_actor,
         wallet_id = btrim(p_wallet_id),
         asaas_account_id = nullif(btrim(coalesce(p_asaas_account_id, '')), ''),
         account_name = nullif(btrim(coalesce(p_account_name, '')), ''),
         cnpj = coalesce(nullif(btrim(coalesce(p_cnpj, '')), ''), a.cnpj),
         account_status = p_account_status,
         commercial_info_expires_on = p_commercial_info_expires_on,
         validated_at = now(),
         status = 'active',
         last_check_at = now(),
         last_check_ok = true,
         last_check_error = null
   where a.id = p_account_id;
end;
$$;

revoke execute on function public._gateway_store_credentials(uuid, uuid, text, text, text, text, text, jsonb, date) from public, anon, authenticated;

-- Grava o webhook criado no Asaas e o token dele.
create or replace function public._gateway_store_webhook(
  p_account_id uuid,
  p_webhook_id text,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_secret uuid;
begin
  select * into v_acc from public.gateway_accounts a where a.id = p_account_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.status = 'disabled' then raise exception 'ACCOUNT_DISABLED'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'WEBHOOK_TOKEN_INVALID'; end if;

  if v_acc.webhook_token_secret_id is not null
     and exists (select 1 from vault.secrets s where s.id = v_acc.webhook_token_secret_id) then
    perform vault.update_secret(v_acc.webhook_token_secret_id, p_token);
    v_secret := v_acc.webhook_token_secret_id;
  else
    v_secret := vault.create_secret(
      p_token,
      'gateway_webhook_token_' || p_account_id::text || '_' || replace(gen_random_uuid()::text, '-', ''),
      'Token do webhook do Asaas (riSZon). Nunca exibir.'
    );
  end if;

  update public.gateway_accounts a
     set webhook_id = p_webhook_id,
         webhook_token_secret_id = v_secret,
         webhook_created_at = now()
   where a.id = p_account_id;
end;
$$;

revoke execute on function public._gateway_store_webhook(uuid, text, text) from public, anon, authenticated;

-- LÊ A CHAVE — e grava o uso. Só a chave de serviço chama.
create or replace function public._gateway_read_key(
  p_account_id uuid,
  p_purpose text,
  p_actor uuid default null
)
returns table (api_key text, environment text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_key text;
begin
  select * into v_acc from public.gateway_accounts a where a.id = p_account_id;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.status = 'disabled' then raise exception 'ACCOUNT_DISABLED'; end if;
  if v_acc.api_key_secret_id is null then raise exception 'API_KEY_MISSING'; end if;
  if length(btrim(coalesce(p_purpose, ''))) = 0 then raise exception 'PURPOSE_REQUIRED'; end if;

  select d.decrypted_secret into v_key
    from vault.decrypted_secrets d
   where d.id = v_acc.api_key_secret_id;
  if v_key is null then raise exception 'API_KEY_MISSING'; end if;

  insert into public.gateway_key_usage (account_id, purpose, actor)
  values (p_account_id, left(btrim(p_purpose), 80), p_actor);

  update public.gateway_accounts a
     set api_key_last_used_at = now()
   where a.id = p_account_id;

  return query select v_key, v_acc.environment;
end;
$$;

revoke execute on function public._gateway_read_key(uuid, text, uuid) from public, anon, authenticated;

-- O token do webhook, a partir do trecho opaco do endereço. Só o servidor.
create or replace function public._gateway_webhook_secret(p_ref text)
returns table (account_id uuid, token text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, d.decrypted_secret
    from public.gateway_accounts a
    join vault.decrypted_secrets d on d.id = a.webhook_token_secret_id
   where a.webhook_ref = p_ref
     and a.status <> 'disabled';
$$;

revoke execute on function public._gateway_webhook_secret(text) from public, anon, authenticated;

-- Grava o evento bruto. Devolve verdadeiro se é novo (falso = repetido).
create or replace function public._gateway_record_event(
  p_account_id uuid,
  p_event_id text,
  p_event text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
begin
  insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
  values (p_account_id, p_event_id, p_event, p_payload)
  on conflict (account_id, asaas_event_id) do nothing
  returning true into v_new;

  update public.gateway_accounts a
     set webhook_last_event_at = now()
   where a.id = p_account_id;

  return coalesce(v_new, false);
end;
$$;

revoke execute on function public._gateway_record_event(uuid, text, text, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) AUDITORIA (0288): cadastros entram; registros técnicos ficam fora
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'gateway_key_usage', 'Já é o registro de cada uso da chave do Asaas (só cresce).'),
  ('public', 'gateway_api_log', 'Registro técnico das chamadas ao Asaas (método, rota, status, duração).'),
  ('public', 'gateway_webhook_events', 'Evento bruto do webhook do Asaas (registro técnico; só o servidor grava).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal, nenhum segredo)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'gateway\_%') as tabelas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'gateway\_%' or p.proname like '\_gateway\_%')) as funcoes,
  (select count(*) from pg_trigger where tgname in ('gateway_accounts_guard', 'gateway_accounts_no_delete')) as gatilhos,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'gateway\_%' and cmd <> 'SELECT') as regras_de_escrita,
  (select production_enabled from public.gateway_settings) as producao_ligada,
  (select count(*) from public.gateway_accounts) as contas;
