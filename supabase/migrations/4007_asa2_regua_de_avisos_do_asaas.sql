-- =============================================================================
-- 4007 — ASA2, ENTREGA 3: A RÉGUA DE AVISOS DO ASAAS E O COMPROVANTE
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 12/11/2026: docs/integracao-asaas.md, 17.4 e 17.5.
--
--   * A RÉGUA DA REDE (D2): `gateway_notification_rules`, os 8 avisos fixos do
--     Asaas por pagador, com prazo e canais (e-mail, SMS, WhatsApp, ligação).
--     Nasce com o padrão do dono (D8): e-mail e SMS em tudo, WhatsApp só no
--     aviso do dia do vencimento, ligação desligada. Os avisos do Asaas PARA A
--     UNIDADE (`*EnabledForProvider`) ficam sempre desligados (D1).
--   * A DECLARAÇÃO do termo de privacidade (Admin Master, uma vez, para a rede)
--     e o botão LIGAR/DESLIGAR por unidade (`gateway_notification_units`). Sem
--     a declaração nenhuma unidade liga. NENHUMA unidade nasce ligada.
--   * "NÃO RECEBER AVISOS" POR CPF, NA REDE TODA (D5, D7):
--     `gateway_notification_optouts`. Desligam: Recepcionista, Gerente,
--     Financeiro da Franqueadora e Admin Master, com motivo. Religam: Gerente,
--     Financeiro e Admin.
--   * A FILA: cada pagador (`gateway_customers`) ganha o estado da régua. Tudo
--     que muda o que o Asaas deve ter (unidade ligada, régua, contato da ficha,
--     pedido de não receber, conta desativada) marca o pagador como pendente;
--     a rotina do servidor (a cada 10 min) aplica no Asaas e devolve o
--     resultado. ⚠️ Nenhuma chamada ao Asaas sai do banco.
--   * CONTA DESATIVADA (D6): o pagador da conta desativada vai para a fila
--     para apagar e-mail e celular no Asaas.
--   * O CUSTO na tela: tarifas de aviso (mensageria, WhatsApp, ligação) e o
--     saldo da conta, gravados pelo servidor em `gateway_accounts`.
--   * O COMPROVANTE (ajuste 4): `charges.receipt_url` (`transactionReceiptUrl`
--     do aviso de pagamento), com as antigas preenchidas pelos avisos guardados.
--   * O histórico da aba Cobrança e comunicação em `central_history`.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A RÉGUA DA REDE
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_notification_rules (
  slot text primary key check (slot in (
    'criada', 'lembrete_1', 'lembrete_2', 'linha_digitavel',
    'vencida_1', 'vencida_2', 'recebida', 'alterada')),
  event text not null check (event in (
    'PAYMENT_CREATED', 'PAYMENT_DUEDATE_WARNING', 'SEND_LINHA_DIGITAVEL',
    'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED', 'PAYMENT_UPDATED')),
  schedule_offset smallint,
  email boolean not null default false,
  sms boolean not null default false,
  whatsapp boolean not null default false,
  phone_call boolean not null default false,
  sort_order smallint not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  -- Os prazos que o Asaas aceita (docs.asaas.com, 12/11/2026).
  constraint gateway_notification_rules_offset_check check (
    case slot
      when 'lembrete_1' then schedule_offset in (5, 10, 15, 30)
      when 'lembrete_2' then schedule_offset in (0, 5, 10, 15, 30)
      when 'vencida_1' then schedule_offset = 0
      when 'vencida_2' then schedule_offset in (1, 7, 15, 30)
      else schedule_offset is null
    end)
);

comment on table public.gateway_notification_rules is
  'A régua de avisos do Asaas da rede (ASA2 entrega 3, 4007; spec 17.5): os 8 avisos fixos por pagador.';

alter table public.gateway_notification_rules enable row level security;
-- Sem política: a leitura e a gravação são pelas portas (gateway_regua_*).

insert into public.gateway_notification_rules (slot, event, schedule_offset, email, sms, whatsapp, phone_call, sort_order)
values
  ('criada',          'PAYMENT_CREATED',         null, true, true, false, false, 1),
  ('lembrete_1',      'PAYMENT_DUEDATE_WARNING', 10,   true, true, false, false, 2),
  ('lembrete_2',      'PAYMENT_DUEDATE_WARNING', 0,    true, true, false, false, 3),
  ('linha_digitavel', 'SEND_LINHA_DIGITAVEL',    null, true, true, false, false, 4),
  ('vencida_1',       'PAYMENT_OVERDUE',         0,    true, true, true,  false, 5),
  ('vencida_2',       'PAYMENT_OVERDUE',         7,    true, true, false, false, 6),
  ('recebida',        'PAYMENT_RECEIVED',        null, true, true, false, false, 7),
  ('alterada',        'PAYMENT_UPDATED',         null, true, true, false, false, 8)
on conflict (slot) do nothing;

-- A configuração única da rede: a declaração e a versão da régua.
create table if not exists public.gateway_notification_settings (
  id boolean primary key default true check (id),
  privacy_declared_at timestamptz,
  privacy_declared_by uuid references public.profiles (id),
  privacy_note text,
  rules_version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.gateway_notification_settings enable row level security;

insert into public.gateway_notification_settings (id) values (true) on conflict (id) do nothing;

-- O botão de cada unidade.
create table if not exists public.gateway_notification_units (
  clinic_id uuid primary key references public.clinics (id),
  enabled boolean not null default false,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id)
);

alter table public.gateway_notification_units enable row level security;

-- "Não receber avisos de cobrança", por CPF, na rede toda.
create table if not exists public.gateway_notification_optouts (
  cpf text primary key check (cpf ~ '^[0-9]{11}$|^[0-9]{14}$'),
  active boolean not null default true,
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  reactivated_at timestamptz,
  reactivated_by uuid references public.profiles (id),
  reactivate_reason text
);

alter table public.gateway_notification_optouts enable row level security;

-- -----------------------------------------------------------------------------
-- 2) O ESTADO DE CADA PAGADOR, AS TARIFAS E O COMPROVANTE
-- -----------------------------------------------------------------------------
alter table public.gateway_customers
  add column if not exists regua_pending_since timestamptz,
  add column if not exists regua_next_try_at timestamptz,
  add column if not exists regua_attempts integer not null default 0,
  add column if not exists regua_applied_on boolean not null default false,
  add column if not exists regua_applied_version integer,
  add column if not exists regua_contact_sent boolean not null default false,
  add column if not exists regua_contact_cleared_at timestamptz,
  add column if not exists regua_synced_at timestamptz,
  add column if not exists regua_error text;

create index if not exists gateway_customers_regua_pending_idx
  on public.gateway_customers (gateway_account_id, regua_pending_since)
  where regua_pending_since is not null;

alter table public.gateway_accounts
  add column if not exists fee_messaging_cents integer,
  add column if not exists fee_whatsapp_cents integer,
  add column if not exists fee_phone_call_cents integer,
  add column if not exists notification_fees_synced_at timestamptz,
  add column if not exists balance_cents bigint,
  add column if not exists balance_checked_at timestamptz;

alter table public.charges
  add column if not exists receipt_url text;

comment on column public.charges.receipt_url is
  'O comprovante do Asaas (transactionReceiptUrl), gravado pelo aviso de pagamento (4007).';

-- -----------------------------------------------------------------------------
-- 3) AS REGRAS PURAS: celular, e-mail, o pagador de um cliente
-- -----------------------------------------------------------------------------
-- Celular só quando parece celular: DDD + 9 + 8 dígitos (11 dígitos). Aceita o
-- 55 do Brasil na frente.
create or replace function public._gateway_mobile(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^55[1-9][1-9]9[0-9]{8}$' then substr(d, 3)
    when d ~ '^[1-9][1-9]9[0-9]{8}$' then d
    else null end
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x;
$$;

revoke execute on function public._gateway_mobile(text) from public, anon, authenticated;

create or replace function public._gateway_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when btrim(coalesce(p_email, '')) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
              then lower(btrim(p_email)) else null end;
$$;

revoke execute on function public._gateway_email(text) from public, anon, authenticated;

-- O pagador de um cliente: o responsável financeiro, quando houver; senão, o
-- próprio cliente (mesma regra da emissão, 4004).
create or replace function public._gateway_payer_of_client(p_client_id uuid)
returns table (cpf text, name text, kind text, guardian_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select public.cpf_digits(coalesce(g.cpf, c.cpf)),
         coalesce(g.full_name, c.full_name),
         case when g.id is null then 'client' else 'guardian' end,
         g.id
    from public.clients c
    left join lateral (
      select * from public.client_guardians x
       where x.client_id = c.id and x.is_financial
       limit 1) g on true
   where c.id = p_client_id;
$$;

revoke execute on function public._gateway_payer_of_client(uuid) from public, anon, authenticated;

-- O contato de um pagador do Asaas, lido da ficha.
create or replace function public._gateway_customer_contact(p_customer_id uuid)
returns table (email text, mobile text)
language sql
stable
security definer
set search_path = ''
as $$
  select public._gateway_email(coalesce(nullif(btrim(g.email), ''), gc.email, c.email)),
         public._gateway_mobile(coalesce(nullif(btrim(g.phone), ''), gc.phone, c.phone))
    from public.gateway_customers k
    left join public.clients c on k.owner_kind = 'client' and c.id = k.client_id
    left join public.client_guardians g on k.owner_kind = 'guardian' and g.id = k.guardian_id
    left join public.clients gc on gc.id = g.guardian_client_id
   where k.id = p_customer_id;
$$;

revoke execute on function public._gateway_customer_contact(uuid) from public, anon, authenticated;

-- A unidade está com a régua ligada de verdade? (botão + declaração + conta ativa)
create or replace function public._gateway_regua_unit_on(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.gateway_accounts a
      join public.gateway_notification_units u on u.clinic_id = a.clinic_id and u.enabled
      join public.gateway_notification_settings s on s.id and s.privacy_declared_at is not null
     where a.id = p_account_id and a.status = 'active');
$$;

revoke execute on function public._gateway_regua_unit_on(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) A FILA
-- -----------------------------------------------------------------------------
-- Marca pendente. `regua_pending_since` é SEMPRE a hora da última mudança: a
-- rotina só limpa o pendente se nada mudou depois que ela começou.
create or replace function public._gateway_regua_enqueue(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  update public.gateway_customers
     set regua_pending_since = clock_timestamp(),
         regua_next_try_at = null,
         regua_attempts = 0
   where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public._gateway_regua_enqueue(uuid[]) from public, anon, authenticated;

-- O que o Asaas deve ter para este pagador:
--   'on'    — contato + avisos ligados + a régua;
--   'off'   — avisos desligados (o contato fica: 17.3);
--   'clear' — conta desativada: apagar e-mail e celular (D6);
--   'skip'  — nada a fazer (nunca foi ligado, ou já está como deve).
create or replace function public._gateway_regua_mode(p_customer_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.gateway_customers%rowtype;
  v_status text;
  v_version integer;
  v_optout boolean;
begin
  select * into k from public.gateway_customers where id = p_customer_id;
  if not found then return 'skip'; end if;
  select a.status into v_status from public.gateway_accounts a where a.id = k.gateway_account_id;
  if v_status = 'disabled' then
    return case when k.regua_contact_sent and k.regua_contact_cleared_at is null then 'clear' else 'skip' end;
  end if;
  select exists (select 1 from public.gateway_notification_optouts o where o.cpf = k.cpf_cnpj and o.active)
    into v_optout;
  if public._gateway_regua_unit_on(k.gateway_account_id) and not v_optout then
    return 'on';
  end if;
  return case when k.regua_applied_on then 'off' else 'skip' end;
end;
$$;

revoke execute on function public._gateway_regua_mode(uuid) from public, anon, authenticated;

-- A régua no formato que o servidor manda ao Asaas.
create or replace function public._gateway_regua_rules_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slot', r.slot, 'event', r.event, 'scheduleOffset', r.schedule_offset,
           'email', r.email, 'sms', r.sms, 'whatsapp', r.whatsapp, 'phoneCall', r.phone_call)
           order by r.sort_order), '[]'::jsonb)
    from public.gateway_notification_rules r;
$$;

revoke execute on function public._gateway_regua_rules_json() from public, anon, authenticated;

-- A vez da rotina: resolve no banco o que não pede Asaas ('skip') e devolve
-- até `p_per_account` pagadores por conta, com o que aplicar. Só a chave de
-- serviço.
create or replace function public._gateway_regua_queue(p_per_account integer default 50)
returns table (
  customer_id uuid,
  account_id uuid,
  asaas_customer_id text,
  mode text,
  email text,
  mobile text,
  rules jsonb,
  rules_version integer,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_rules jsonb := public._gateway_regua_rules_json();
  v_version integer;
  r record;
  v_mode text;
begin
  select s.rules_version into v_version from public.gateway_notification_settings s where s.id;

  -- 1) O que não precisa do Asaas sai da fila aqui.
  for r in
    select k.id from public.gateway_customers k
     where k.regua_pending_since is not null
       and (k.regua_next_try_at is null or k.regua_next_try_at <= v_now)
  loop
    if public._gateway_regua_mode(r.id) = 'skip' then
      update public.gateway_customers
         set regua_pending_since = null, regua_next_try_at = null, regua_attempts = 0, regua_error = null
       where id = r.id and regua_pending_since <= v_now;
    end if;
  end loop;

  -- 2) O resto, por conta (a cota do Asaas é por conta).
  for r in
    select x.id, x.gateway_account_id, x.asaas_customer_id
      from (
        select k.*, row_number() over (partition by k.gateway_account_id order by k.regua_pending_since) as n
          from public.gateway_customers k
          join public.gateway_accounts a on a.id = k.gateway_account_id and a.api_key_secret_id is not null
         where k.regua_pending_since is not null
           and (k.regua_next_try_at is null or k.regua_next_try_at <= v_now)
      ) x
     where x.n <= greatest(1, least(coalesce(p_per_account, 50), 200))
     order by x.gateway_account_id, x.n
  loop
    v_mode := public._gateway_regua_mode(r.id);
    if v_mode = 'skip' then continue; end if;
    customer_id := r.id;
    account_id := r.gateway_account_id;
    asaas_customer_id := r.asaas_customer_id;
    mode := v_mode;
    select c.email, c.mobile into email, mobile from public._gateway_customer_contact(r.id) c;
    rules := case when v_mode = 'on' then v_rules else null end;
    rules_version := v_version;
    started_at := v_now;
    return next;
  end loop;
end;
$$;

revoke execute on function public._gateway_regua_queue(integer) from public, anon, authenticated;

-- O resultado de um pagador. Sucesso só limpa o pendente se nada mudou depois
-- de `p_started_at`; erro tenta de novo mais tarde (10 min, 40 min... até 6 h).
create or replace function public._gateway_regua_done(
  p_customer_id uuid,
  p_mode text,
  p_rules_version integer,
  p_contact_sent boolean,
  p_started_at timestamptz,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_mode not in ('on', 'off', 'clear') then raise exception 'MODE_INVALID'; end if;
  if p_error is not null then
    update public.gateway_customers
       set regua_attempts = regua_attempts + 1,
           regua_error = left(p_error, 300),
           regua_next_try_at = clock_timestamp()
             + least(interval '6 hours', interval '10 minutes' * power(4, least(regua_attempts, 4))),
           regua_synced_at = clock_timestamp()
     where id = p_customer_id;
    return;
  end if;
  update public.gateway_customers
     set regua_applied_on = (p_mode = 'on'),
         regua_applied_version = case when p_mode = 'on' then p_rules_version else regua_applied_version end,
         regua_contact_sent = case when p_mode = 'clear' then false else regua_contact_sent or coalesce(p_contact_sent, false) end,
         regua_contact_cleared_at = case when p_mode = 'clear' then clock_timestamp() else regua_contact_cleared_at end,
         regua_synced_at = clock_timestamp(),
         regua_error = null,
         regua_attempts = 0,
         regua_next_try_at = null,
         regua_pending_since = case when regua_pending_since <= p_started_at then null else regua_pending_since end
   where id = p_customer_id;
end;
$$;

revoke execute on function public._gateway_regua_done(uuid, text, integer, boolean, timestamptz, text) from public, anon, authenticated;

-- A emissão (servidor) pergunta: este pagador precisa da régua ANTES da
-- cobrança nascer (para o aviso "cobrança criada" sair)? Devolve a linha da
-- fila dele, ou nada.
create or replace function public._gateway_regua_for_customer(p_customer_id uuid)
returns table (
  customer_id uuid,
  account_id uuid,
  asaas_customer_id text,
  mode text,
  email text,
  mobile text,
  rules jsonb,
  rules_version integer,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.gateway_customers%rowtype;
  v_mode text;
begin
  select * into k from public.gateway_customers where id = p_customer_id;
  if not found or k.regua_pending_since is null then return; end if;
  v_mode := public._gateway_regua_mode(p_customer_id);
  if v_mode = 'skip' then
    update public.gateway_customers set regua_pending_since = null, regua_error = null where id = p_customer_id;
    return;
  end if;
  customer_id := k.id;
  account_id := k.gateway_account_id;
  asaas_customer_id := k.asaas_customer_id;
  mode := v_mode;
  select c.email, c.mobile into email, mobile from public._gateway_customer_contact(k.id) c;
  rules := case when v_mode = 'on' then public._gateway_regua_rules_json() else null end;
  select s.rules_version into rules_version from public.gateway_notification_settings s where s.id;
  started_at := clock_timestamp();
  return next;
end;
$$;

revoke execute on function public._gateway_regua_for_customer(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) O QUE PÕE NA FILA (gatilhos)
-- -----------------------------------------------------------------------------
-- Pagador novo: sempre pendente (a fila resolve no banco o que não pede Asaas).
create or replace function public._gateway_customers_regua_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.regua_pending_since := clock_timestamp();
  return new;
end;
$$;

revoke execute on function public._gateway_customers_regua_new() from public, anon, authenticated;

drop trigger if exists gateway_customers_regua_new on public.gateway_customers;
create trigger gateway_customers_regua_new
  before insert on public.gateway_customers
  for each row execute function public._gateway_customers_regua_new();

-- A unidade ligou ou desligou.
create or replace function public._gateway_units_regua_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._gateway_regua_enqueue(array(
    select k.id from public.gateway_customers k
      join public.gateway_accounts a on a.id = k.gateway_account_id
     where a.clinic_id = new.clinic_id));
  return null;
end;
$$;

revoke execute on function public._gateway_units_regua_enqueue() from public, anon, authenticated;

drop trigger if exists gateway_notification_units_regua on public.gateway_notification_units;
create trigger gateway_notification_units_regua
  after insert or update of enabled on public.gateway_notification_units
  for each row execute function public._gateway_units_regua_enqueue();

-- A régua mudou, ou a declaração: todos os pagadores das unidades ligadas e
-- os que já estão com a régua aplicada. A gravação da régua chama direto
-- (uma vez, só se algo mudou); a declaração, pelo gatilho.
create or replace function public._gateway_regua_enqueue_all()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public._gateway_regua_enqueue(array(
    select k.id from public.gateway_customers k
      join public.gateway_accounts a on a.id = k.gateway_account_id
      left join public.gateway_notification_units u on u.clinic_id = a.clinic_id
     where coalesce(u.enabled, false) or k.regua_applied_on));
$$;

revoke execute on function public._gateway_regua_enqueue_all() from public, anon, authenticated;

create or replace function public._gateway_rules_regua_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._gateway_regua_enqueue_all();
  return null;
end;
$$;

revoke execute on function public._gateway_rules_regua_enqueue() from public, anon, authenticated;

drop trigger if exists gateway_notification_rules_regua on public.gateway_notification_rules;

drop trigger if exists gateway_notification_settings_regua on public.gateway_notification_settings;
create trigger gateway_notification_settings_regua
  after update of privacy_declared_at on public.gateway_notification_settings
  for each row execute function public._gateway_rules_regua_enqueue();

-- Pedido de não receber (ou de voltar a receber).
create or replace function public._gateway_optouts_regua_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._gateway_regua_enqueue(array(
    select k.id from public.gateway_customers k where k.cpf_cnpj = new.cpf));
  return null;
end;
$$;

revoke execute on function public._gateway_optouts_regua_enqueue() from public, anon, authenticated;

drop trigger if exists gateway_notification_optouts_regua on public.gateway_notification_optouts;
create trigger gateway_notification_optouts_regua
  after insert or update of active on public.gateway_notification_optouts
  for each row execute function public._gateway_optouts_regua_enqueue();

-- O contato da ficha mudou (cliente).
create or replace function public._gateway_clients_regua_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not distinct from old.email and new.phone is not distinct from old.phone then
    return null;
  end if;
  perform public._gateway_regua_enqueue(array(
    select k.id from public.gateway_customers k
     where (k.owner_kind = 'client' and k.client_id = new.id)
        or (k.owner_kind = 'guardian' and k.guardian_id in (
              select g.id from public.client_guardians g where g.guardian_client_id = new.id))));
  return null;
end;
$$;

revoke execute on function public._gateway_clients_regua_enqueue() from public, anon, authenticated;

drop trigger if exists clients_gateway_regua on public.clients;
create trigger clients_gateway_regua
  after update of email, phone on public.clients
  for each row execute function public._gateway_clients_regua_enqueue();

-- O contato do responsável mudou.
create or replace function public._gateway_guardians_regua_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not distinct from old.email and new.phone is not distinct from old.phone then
    return null;
  end if;
  perform public._gateway_regua_enqueue(array(
    select k.id from public.gateway_customers k
     where k.owner_kind = 'guardian' and k.guardian_id = new.id));
  return null;
end;
$$;

revoke execute on function public._gateway_guardians_regua_enqueue() from public, anon, authenticated;

drop trigger if exists client_guardians_gateway_regua on public.client_guardians;
create trigger client_guardians_gateway_regua
  after update of email, phone on public.client_guardians
  for each row execute function public._gateway_guardians_regua_enqueue();

-- A conta foi desativada (ou voltou).
create or replace function public._gateway_accounts_regua_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if 'disabled' not in (new.status, old.status) and 'active' not in (new.status, old.status) then
    return null;
  end if;
  perform public._gateway_regua_enqueue(array(
    select k.id from public.gateway_customers k where k.gateway_account_id = new.id));
  return null;
end;
$$;

revoke execute on function public._gateway_accounts_regua_enqueue() from public, anon, authenticated;

drop trigger if exists gateway_accounts_regua on public.gateway_accounts;
create trigger gateway_accounts_regua
  after update of status on public.gateway_accounts
  for each row execute function public._gateway_accounts_regua_enqueue();

-- -----------------------------------------------------------------------------
-- 6) AS PORTAS DA TELA (Central, aba Cobrança e comunicação)
-- -----------------------------------------------------------------------------
-- Quem edita a régua e liga as unidades: Admin Master e Financeiro da
-- Franqueadora. Quem vê: eles, e o Gerente e o Franqueado da própria unidade.
create or replace function public._gateway_regua_can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or public.is_finance_franchisor();
$$;

revoke execute on function public._gateway_regua_can_edit() from public, anon, authenticated;

create or replace function public._gateway_regua_can_see_unit(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._gateway_regua_can_edit()
      or (p_clinic_id is not null
          and public.has_role_in_clinic(p_clinic_id, array['unit_manager', 'franchisee']::public.user_role[]));
$$;

revoke execute on function public._gateway_regua_can_see_unit(uuid) from public, anon, authenticated;

-- A régua da rede (para quem vê a aba em algum lugar).
create or replace function public.gateway_regua_read()
returns table (
  slot text,
  event text,
  schedule_offset smallint,
  email boolean,
  sms boolean,
  whatsapp boolean,
  phone_call boolean,
  sort_order smallint,
  updated_at timestamptz,
  updated_by_name text,
  privacy_declared_at timestamptz,
  privacy_declared_by_name text,
  privacy_note text,
  can_edit boolean,
  can_declare boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public._gateway_regua_can_edit()
          or exists (select 1 from public.user_clinic_roles ucr
                      where ucr.user_id = (select auth.uid())
                        and ucr.role in ('unit_manager', 'franchisee'))) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
  select r.slot, r.event, r.schedule_offset, r.email, r.sms, r.whatsapp, r.phone_call, r.sort_order,
         r.updated_at, pu.full_name,
         s.privacy_declared_at, pd.full_name, s.privacy_note,
         public._gateway_regua_can_edit(), public.is_admin_master()
    from public.gateway_notification_rules r
    cross join public.gateway_notification_settings s
    left join public.profiles pu on pu.id = r.updated_by
    left join public.profiles pd on pd.id = s.privacy_declared_by
   where s.id
   order by r.sort_order;
end;
$$;

revoke execute on function public.gateway_regua_read() from public, anon, authenticated;
grant execute on function public.gateway_regua_read() to authenticated;

-- Grava a régua inteira (os 8 avisos). p_rules: [{slot, scheduleOffset, email, sms, whatsapp, phoneCall}].
create or replace function public.gateway_regua_save(p_rules jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_l1 smallint;
  v_l2 smallint;
  v_changed integer := 0;
  v_n integer;
begin
  if not public._gateway_regua_can_edit() then raise exception 'NOT_ALLOWED'; end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) <> 8 then
    raise exception 'RULES_INVALID';
  end if;
  for v_item in select * from jsonb_array_elements(p_rules) loop
    update public.gateway_notification_rules r
       set schedule_offset = case when r.slot in ('lembrete_1', 'lembrete_2', 'vencida_2')
                                  then (v_item->>'scheduleOffset')::smallint
                                  else r.schedule_offset end,
           email = coalesce((v_item->>'email')::boolean, false),
           sms = coalesce((v_item->>'sms')::boolean, false),
           whatsapp = coalesce((v_item->>'whatsapp')::boolean, false),
           phone_call = coalesce((v_item->>'phoneCall')::boolean, false),
           updated_at = now(),
           updated_by = (select auth.uid())
     where r.slot = v_item->>'slot'
       and (r.schedule_offset is distinct from case when r.slot in ('lembrete_1', 'lembrete_2', 'vencida_2')
                                                    then (v_item->>'scheduleOffset')::smallint
                                                    else r.schedule_offset end
            or r.email is distinct from coalesce((v_item->>'email')::boolean, false)
            or r.sms is distinct from coalesce((v_item->>'sms')::boolean, false)
            or r.whatsapp is distinct from coalesce((v_item->>'whatsapp')::boolean, false)
            or r.phone_call is distinct from coalesce((v_item->>'phoneCall')::boolean, false));
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end loop;
  select schedule_offset into v_l1 from public.gateway_notification_rules where slot = 'lembrete_1';
  select schedule_offset into v_l2 from public.gateway_notification_rules where slot = 'lembrete_2';
  if v_l2 >= v_l1 then raise exception 'REMINDERS_ORDER'; end if;
  if v_changed > 0 then
    update public.gateway_notification_settings
       set rules_version = rules_version + 1, updated_at = now()
     where id;
    perform public._gateway_regua_enqueue_all();
  end if;
end;
$$;

revoke execute on function public.gateway_regua_save(jsonb) from public, anon, authenticated;
grant execute on function public.gateway_regua_save(jsonb) to authenticated;

-- A declaração do termo de privacidade: só o Admin Master, uma vez, para a rede.
create or replace function public.gateway_regua_declare_privacy(p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  update public.gateway_notification_settings
     set privacy_declared_at = now(),
         privacy_declared_by = (select auth.uid()),
         privacy_note = btrim(p_note),
         updated_at = now()
   where id and privacy_declared_at is null;
end;
$$;

revoke execute on function public.gateway_regua_declare_privacy(text) from public, anon, authenticated;
grant execute on function public.gateway_regua_declare_privacy(text) to authenticated;

-- Liga ou desliga a régua de uma unidade.
create or replace function public.gateway_regua_unit_set(p_clinic_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._gateway_regua_can_edit() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic_id and c.type = 'franchise_unit') then
    raise exception 'CLINIC_INVALID';
  end if;
  if p_enabled and not exists (
    select 1 from public.gateway_notification_settings s where s.id and s.privacy_declared_at is not null) then
    raise exception 'PRIVACY_NOT_DECLARED';
  end if;
  insert into public.gateway_notification_units (clinic_id, enabled, changed_at, changed_by)
  values (p_clinic_id, coalesce(p_enabled, false), now(), (select auth.uid()))
  on conflict (clinic_id) do update
    set enabled = excluded.enabled, changed_at = excluded.changed_at, changed_by = excluded.changed_by
    where public.gateway_notification_units.enabled is distinct from excluded.enabled;
end;
$$;

revoke execute on function public.gateway_regua_unit_set(uuid, boolean) from public, anon, authenticated;
grant execute on function public.gateway_regua_unit_set(uuid, boolean) to authenticated;

-- O retrato da unidade: o botão, a conta, as tarifas, o saldo e os números.
create or replace function public.gateway_regua_unit_overview(p_clinic_id uuid)
returns table (
  enabled boolean,
  changed_at timestamptz,
  changed_by_name text,
  privacy_declared boolean,
  account_status text,
  fee_messaging_cents integer,
  fee_whatsapp_cents integer,
  fee_phone_call_cents integer,
  notification_fees_synced_at timestamptz,
  balance_cents bigint,
  balance_checked_at timestamptz,
  payers integer,
  payers_without_email integer,
  payers_without_mobile integer,
  payers_opted_out integer,
  payers_pending integer,
  payers_with_error integer,
  payers_on integer,
  charges_30d integer,
  paid_30d integer,
  can_edit boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  if not public._gateway_regua_can_see_unit(p_clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  select a.id into v_account from public.gateway_accounts a
   where a.clinic_id = p_clinic_id and a.owner_type = 'unit'
   order by (a.status = 'disabled'), a.created_at desc limit 1;

  select coalesce(u.enabled, false), u.changed_at, p.full_name
    into enabled, changed_at, changed_by_name
    from (select 1) one
    left join public.gateway_notification_units u on u.clinic_id = p_clinic_id
    left join public.profiles p on p.id = u.changed_by;
  select s.privacy_declared_at is not null into privacy_declared
    from public.gateway_notification_settings s where s.id;
  select a.status, a.fee_messaging_cents, a.fee_whatsapp_cents, a.fee_phone_call_cents,
         a.notification_fees_synced_at, a.balance_cents, a.balance_checked_at
    into account_status, fee_messaging_cents, fee_whatsapp_cents, fee_phone_call_cents,
         notification_fees_synced_at, balance_cents, balance_checked_at
    from public.gateway_accounts a where a.id = v_account;

  select count(*)::integer,
         count(*) filter (where c.email is null)::integer,
         count(*) filter (where c.mobile is null)::integer,
         count(*) filter (where exists (select 1 from public.gateway_notification_optouts o
                                         where o.cpf = k.cpf_cnpj and o.active))::integer,
         count(*) filter (where k.regua_pending_since is not null)::integer,
         count(*) filter (where k.regua_error is not null)::integer,
         count(*) filter (where k.regua_applied_on)::integer
    into payers, payers_without_email, payers_without_mobile, payers_opted_out,
         payers_pending, payers_with_error, payers_on
    from public.gateway_customers k
    cross join lateral public._gateway_customer_contact(k.id) c
   where k.gateway_account_id = v_account;

  select count(*) filter (where ch.issued_at >= now() - interval '30 days')::integer,
         count(*) filter (where ch.paid_on >= (now() - interval '30 days')::date)::integer
    into charges_30d, paid_30d
    from public.charges ch
   where ch.clinic_id = p_clinic_id and not ch.is_external;

  can_edit := public._gateway_regua_can_edit();
  return next;
end;
$$;

revoke execute on function public.gateway_regua_unit_overview(uuid) from public, anon, authenticated;
grant execute on function public.gateway_regua_unit_overview(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) "NÃO RECEBER AVISOS DE COBRANÇA" (na ficha)
-- -----------------------------------------------------------------------------
-- Quem desliga: Recepcionista, Gerente, Financeiro da Franqueadora, Admin.
-- Quem religa: Gerente, Financeiro, Admin. Sempre por um cliente que a pessoa
-- vê (a unidade do cliente).
create or replace function public._gateway_optout_roles(p_client_id uuid, p_reenable boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or exists (
        select 1 from public.clients c
         where c.id = p_client_id
           and public.has_role_in_clinic(c.clinic_id,
                 case when p_reenable then array['unit_manager']::public.user_role[]
                      else array['unit_manager', 'receptionist']::public.user_role[] end));
$$;

revoke execute on function public._gateway_optout_roles(uuid, boolean) from public, anon, authenticated;

create or replace function public.gateway_optout_status(p_client_id uuid)
returns table (
  payer_name text,
  payer_kind text,
  has_payer boolean,
  opted_out boolean,
  reason text,
  created_at timestamptz,
  created_by_name text,
  reactivated_at timestamptz,
  reactivated_by_name text,
  can_disable boolean,
  can_enable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payer record;
  o public.gateway_notification_optouts%rowtype;
begin
  if not public._gateway_optout_roles(p_client_id, false) then return; end if;
  select * into v_payer from public._gateway_payer_of_client(p_client_id);
  payer_name := v_payer.name;
  payer_kind := v_payer.kind;
  has_payer := coalesce(public._cpf_ok(v_payer.cpf), false);
  if has_payer then
    select * into o from public.gateway_notification_optouts x where x.cpf = v_payer.cpf;
  end if;
  opted_out := coalesce(o.active, false);
  reason := o.reason;
  created_at := o.created_at;
  select p.full_name into created_by_name from public.profiles p where p.id = o.created_by;
  reactivated_at := o.reactivated_at;
  select p.full_name into reactivated_by_name from public.profiles p where p.id = o.reactivated_by;
  can_disable := has_payer;
  can_enable := has_payer and public._gateway_optout_roles(p_client_id, true);
  return next;
end;
$$;

revoke execute on function public.gateway_optout_status(uuid) from public, anon, authenticated;
grant execute on function public.gateway_optout_status(uuid) to authenticated;

create or replace function public.gateway_optout_set(p_client_id uuid, p_opt_out boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payer record;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if not public._gateway_optout_roles(p_client_id, not coalesce(p_opt_out, true)) then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_payer from public._gateway_payer_of_client(p_client_id);
  if not coalesce(public._cpf_ok(v_payer.cpf), false) then raise exception 'PAYER_CPF_INVALID'; end if;

  if p_opt_out then
    insert into public.gateway_notification_optouts (cpf, active, reason, created_at, created_by)
    values (v_payer.cpf, true, btrim(p_reason), now(), (select auth.uid()))
    on conflict (cpf) do update
      set active = true, reason = excluded.reason, created_at = excluded.created_at,
          created_by = excluded.created_by, reactivated_at = null, reactivated_by = null,
          reactivate_reason = null
      where not public.gateway_notification_optouts.active;
  else
    update public.gateway_notification_optouts
       set active = false, reactivated_at = now(), reactivated_by = (select auth.uid()),
           reactivate_reason = btrim(p_reason)
     where cpf = v_payer.cpf and active;
  end if;
end;
$$;

revoke execute on function public.gateway_optout_set(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.gateway_optout_set(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) AS TARIFAS DE AVISO E O SALDO (gravados pelo servidor)
-- -----------------------------------------------------------------------------
create or replace function public._gateway_save_notification_fees(
  p_account_id uuid,
  p_messaging_cents integer,
  p_whatsapp_cents integer,
  p_phone_call_cents integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gateway_accounts
     set fee_messaging_cents = p_messaging_cents,
         fee_whatsapp_cents = p_whatsapp_cents,
         fee_phone_call_cents = p_phone_call_cents,
         notification_fees_synced_at = now()
   where id = p_account_id;
$$;

revoke execute on function public._gateway_save_notification_fees(uuid, integer, integer, integer) from public, anon, authenticated;

create or replace function public._gateway_save_balance(p_account_id uuid, p_balance_cents bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gateway_accounts
     set balance_cents = p_balance_cents, balance_checked_at = now()
   where id = p_account_id;
$$;

revoke execute on function public._gateway_save_balance(uuid, bigint) from public, anon, authenticated;

-- As contas que a rotina diária confere o saldo: unidade ligada e algum aviso
-- por WhatsApp na régua.
create or replace function public._gateway_regua_balance_accounts()
returns table (account_id uuid, clinic_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.clinic_id
    from public.gateway_accounts a
   where a.api_key_secret_id is not null
     and public._gateway_regua_unit_on(a.id)
     and exists (select 1 from public.gateway_notification_rules r where r.whatsapp);
$$;

revoke execute on function public._gateway_regua_balance_accounts() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) O COMPROVANTE
-- -----------------------------------------------------------------------------
create or replace function public._gateway_event_store_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := nullif(btrim(new.payload->'payment'->>'transactionReceiptUrl'), '');
begin
  if new.charge_id is null or v_url is null or v_url !~ '^https://' then return new; end if;
  update public.charges c
     set receipt_url = v_url
   where c.id = new.charge_id
     and c.asaas_payment_id = new.payload->'payment'->>'id'
     and c.receipt_url is distinct from v_url;
  return new;
end;
$$;

revoke execute on function public._gateway_event_store_receipt() from public, anon, authenticated;

drop trigger if exists gateway_webhook_events_store_receipt on public.gateway_webhook_events;
create trigger gateway_webhook_events_store_receipt
  after update of processed_at on public.gateway_webhook_events
  for each row
  when (old.processed_at is null and new.processed_at is not null)
  execute function public._gateway_event_store_receipt();

-- As antigas: o último comprovante de cada cobrança nos avisos guardados.
update public.charges c
   set receipt_url = x.url
  from (
    select distinct on (e.charge_id) e.charge_id, e.payload->'payment'->>'id' as pid,
           e.payload->'payment'->>'transactionReceiptUrl' as url
      from public.gateway_webhook_events e
     where e.charge_id is not null
       and e.payload->'payment'->>'transactionReceiptUrl' ~ '^https://'
     order by e.charge_id, e.received_at desc
  ) x
 where c.id = x.charge_id
   and c.asaas_payment_id = x.pid
   and c.receipt_url is null;

-- -----------------------------------------------------------------------------
-- 10) O HISTÓRICO DA ABA (central_history ganha 'cobranca')
-- -----------------------------------------------------------------------------
create or replace function public.central_history(p_tab text, p_clinic_id uuid)
returns table (
  id bigint,
  occurred_at timestamptz,
  user_id uuid,
  user_name text,
  actor text,
  table_name text,
  op text,
  changes jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tab not in ('conta', 'financeiro', 'comercial', 'cobranca') then
    raise exception 'TAB_UNKNOWN';
  end if;

  if p_tab = 'comercial' then
    if not public.is_admin_master() then
      return;
    end if;
  elsif p_tab = 'cobranca' then
    if p_clinic_id is null then
      if not public._gateway_regua_can_edit() then return; end if;
    elsif not public._gateway_regua_can_see_unit(p_clinic_id) then
      return;
    end if;
  elsif p_clinic_id is null then
    if not (public.is_admin_master() or public.is_finance_franchisor()) then
      return;
    end if;
  elsif not public.central_can_see(p_clinic_id) then
    return;
  end if;

  if p_tab = 'conta' then
    return query
    select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
           a.table_name, a.op, a.changes
      from public.audit_changes a
      left join public.profiles pr on pr.id = a.user_id
     where a.schema_name = 'public'
       and (
         (a.table_name = 'gateway_accounts' and a.row_id in (
            select g.id::text from public.gateway_accounts g
             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient'))
                or g.clinic_id = p_clinic_id))
         or (p_clinic_id is not null
             and a.table_name = 'central_unit_readiness'
             and a.row_id = p_clinic_id::text)
         or (a.table_name = 'card_acquirers' and a.row_id in (
            select c.id::text
              from public.card_acquirers c
              join public.gateway_accounts g on g.id = c.gateway_account_id
             where (p_clinic_id is null and g.owner_type = 'franchisor')
                or g.clinic_id = p_clinic_id))
         or (a.table_name = 'acquirer_rates' and a.row_id in (
            select r.id::text
              from public.acquirer_rates r
              join public.card_acquirers c on c.id = r.acquirer_id
              join public.gateway_accounts g on g.id = c.gateway_account_id
             where (p_clinic_id is null and g.owner_type = 'franchisor')
                or g.clinic_id = p_clinic_id))
       )
     order by a.occurred_at desc, a.id desc
     limit 200;
    return;
  end if;

  if p_tab = 'cobranca' then
    return query
    select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
           a.table_name, a.op, a.changes
      from public.audit_changes a
      left join public.profiles pr on pr.id = a.user_id
     where a.schema_name = 'public'
       and (
         (p_clinic_id is null and a.table_name in ('gateway_notification_rules', 'gateway_notification_settings'))
         or (p_clinic_id is not null and a.table_name = 'gateway_notification_units'
             and a.row_id = p_clinic_id::text)
       )
     order by a.occurred_at desc, a.id desc
     limit 200;
    return;
  end if;

  return query
  select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
         a.table_name, a.op, a.changes
    from public.audit_changes a
    left join public.profiles pr on pr.id = a.user_id
   where a.schema_name = 'public'
     and a.table_name = any (
       case when p_tab = 'financeiro'
            then array['finance_settings']
            else array['commercial_rules', 'commercial_followup_settings'] end)
     and a.clinic_id is not distinct from p_clinic_id
   order by a.occurred_at desc, a.id desc
   limit 200;
end;
$$;

revoke execute on function public.central_history(text, uuid) from public, anon, authenticated;
grant execute on function public.central_history(text, uuid) to authenticated;

-- A trilha de auditoria nas tabelas novas.
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (o dono vê esta linha no SQL Editor)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.gateway_notification_rules) as avisos_da_regua,
  (select count(*) from public.gateway_notification_rules where whatsapp) as avisos_com_whatsapp,
  (select count(*) from public.gateway_notification_rules where phone_call) as avisos_com_ligacao,
  (select count(*) from public.gateway_notification_units where enabled) as unidades_ligadas,
  (select privacy_declared_at is not null from public.gateway_notification_settings where id) as termo_declarado,
  (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'gateway_regua_read', 'gateway_regua_save', 'gateway_regua_declare_privacy', 'gateway_regua_unit_set',
      'gateway_regua_unit_overview', 'gateway_optout_status', 'gateway_optout_set')) as portas;
