-- =============================================================================
-- 4012 — ASA4, entrega 1 (parte 2): A COBRANÇA NASCE SOZINHA (spec 19.3 a
-- 19.10, 19.13 e 19.14; revisão aprovada pelo Jeferson em 14/11/2026 — 19.16)
-- -----------------------------------------------------------------------------
-- QUANDO: o contrato da venda é assinado (ZapSign ou papel) ou a venda direta
-- nova é marcada como assinada — e a UNIDADE está com a emissão automática
-- ligada. Venda assinada antes de a unidade ser ligada continua manual (19.7).
-- A marca é UMA por venda (`sale_auto_charges`, índice único): o aviso da
-- ZapSign repetido não marca de novo (19.6).
-- O QUÊ (proposta A, 19.4): nasce no Asaas toda parcela pelo Asaas que vence
-- dentro do prazo (padrão 15 dias, 11 a 30, sempre maior que o 1º lembrete);
-- as seguintes nascem pela rotina diária, X dias antes do vencimento.
--   * contrato: boleto e Pix; venda direta nova: boleto, Pix e cartão à vista;
--   * cobrança cancelada À MÃO não volta sozinha; a parcela que recebeu parte
--     em dinheiro depois do cancelamento volta (o restante, 4011 decisão 4).
-- QUEM CRIA: o servidor (o Asaas só é chamado de lá). O banco entrega a lista
-- (`_auto_charge_due`) e a porta sem usuário (`_charge_prepare_system`), que
-- confere tudo o que a emissão manual confere (`_charge_compute`).
-- AS RODADAS ficam gravadas (`gateway_routine_runs`: rotina, origem, números);
-- o VIGIA (só banco, pg_cron, de hora em hora) avisa o Admin Master e o
-- Financeiro da Franqueadora quando uma rotina não rodou ou há parcela na
-- janela sem cobrança e sem motivo. O SEGUNDO DISPARO (pg_cron + pg_net) só é
-- criado onde o pg_net existe (na produção, só com o "pode" do Jeferson, 19.14).
-- ENVIO: "Enviada pelo Asaas" (régua ligada, pagador com contato e sem recusa,
-- na criação), "Aberta pelo pagador" (aviso do Asaas) e o registro de cada
-- envio pelo riSZon (`charge_link_sends`). Avisos de link não enviado e de
-- primeira cobrança não aberta para quem fechou a venda.
-- Nenhum dado é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONFIGURAÇÃO: prazo, endereço da aplicação e a chave por unidade
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_auto_charge_settings (
  id boolean primary key default true check (id),
  window_days integer not null default 15 check (window_days between 11 and 30),
  app_base_url text check (app_base_url is null or app_base_url ~ '^https://[a-z0-9.-]+$'),
  watch_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
comment on table public.gateway_auto_charge_settings is
  'ASA4 (4012): prazo da proposta A (dias antes do vencimento), endereço da aplicação para o 2º disparo (pg_net) e o vigia.';
insert into public.gateway_auto_charge_settings (id) values (true) on conflict (id) do nothing;
alter table public.gateway_auto_charge_settings enable row level security;
drop policy if exists gateway_auto_charge_settings_select on public.gateway_auto_charge_settings;
create policy gateway_auto_charge_settings_select on public.gateway_auto_charge_settings
  for select to authenticated using (true);

create table if not exists public.gateway_auto_charge_units (
  clinic_id uuid primary key references public.clinics (id),
  enabled boolean not null default false,
  enabled_from timestamptz,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id)
);
comment on table public.gateway_auto_charge_units is
  'ASA4 (4012): emissão automática ligada na unidade, e desde quando (contrato assinado antes continua manual).';
alter table public.gateway_auto_charge_units enable row level security;
drop policy if exists gateway_auto_charge_units_select on public.gateway_auto_charge_units;
create policy gateway_auto_charge_units_select on public.gateway_auto_charge_units
  for select to authenticated using (true);

create or replace function public._auto_charge_window()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.window_days from public.gateway_auto_charge_settings s where s.id), 15);
$$;
revoke execute on function public._auto_charge_window() from public, anon, authenticated;

create or replace function public.auto_charge_settings_set(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_window integer := nullif(p ->> 'window_days', '')::integer;
  v_lembrete integer;
  v_u jsonb;
  v_clinic uuid;
  v_on boolean;
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if v_window is not null then
    select r.schedule_offset into v_lembrete from public.gateway_notification_rules r where r.slot = 'lembrete_1';
    -- O prazo precisa ser MAIOR que o 1º lembrete, senão chegam dois avisos no mesmo dia (19.4).
    if v_window <= coalesce(v_lembrete, 10) then raise exception 'WINDOW_NOT_ABOVE_REMINDER'; end if;
  end if;
  update public.gateway_auto_charge_settings set
    window_days = coalesce(v_window, window_days),
    app_base_url = case when p ? 'app_base_url' then nullif(btrim(p ->> 'app_base_url'), '') else app_base_url end,
    watch_enabled = coalesce((p ->> 'watch_enabled')::boolean, watch_enabled),
    updated_at = now(), updated_by = v_user
  where id;
  for v_u in select * from jsonb_array_elements(coalesce(p -> 'units', '[]'))
  loop
    v_clinic := (v_u ->> 'clinic_id')::uuid;
    v_on := (v_u ->> 'enabled')::boolean;
    insert into public.gateway_auto_charge_units (clinic_id, enabled, enabled_from, changed_at, changed_by)
    values (v_clinic, v_on, case when v_on then now() end, now(), v_user)
    on conflict (clinic_id) do update set
      enabled = excluded.enabled,
      -- Religar recomeça a contagem: o que foi assinado com a chave desligada fica manual.
      enabled_from = case when excluded.enabled and not public.gateway_auto_charge_units.enabled then now()
                          else public.gateway_auto_charge_units.enabled_from end,
      changed_at = now(), changed_by = v_user;
  end loop;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, null, 'update', 'auto_charge_settings', 'rede', p);
end;
$$;
revoke execute on function public.auto_charge_settings_set(jsonb) from public, anon, authenticated;
grant execute on function public.auto_charge_settings_set(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A MARCA DA VENDA: uma por venda (idempotência, 19.6)
-- -----------------------------------------------------------------------------
create table if not exists public.sale_auto_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  negotiation_id uuid unique references public.plan_negotiations (id),
  direct_sale_id uuid unique references public.direct_sales (id),
  source text not null check (source in ('assinatura', 'venda_direta')),
  created_at timestamptz not null default now(),
  check ((negotiation_id is null) <> (direct_sale_id is null))
);
comment on table public.sale_auto_charges is
  'ASA4 (4012): venda com emissão automática (assinada depois de a unidade ser ligada). Uma linha por venda.';
alter table public.sale_auto_charges enable row level security;

create or replace function public._auto_charge_unit_on(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.gateway_auto_charge_units u
                  where u.clinic_id = p_clinic_id and u.enabled and u.enabled_from is not null
                    and u.enabled_from <= now());
$$;
revoke execute on function public._auto_charge_unit_on(uuid) from public, anon, authenticated;

create or replace function public.commercial_sales_auto_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contract_signed and (tg_op = 'INSERT' or not coalesce(old.contract_signed, false))
     and public._auto_charge_unit_on(new.clinic_id) then
    insert into public.sale_auto_charges (clinic_id, negotiation_id, source)
    values (new.clinic_id, new.negotiation_id, 'assinatura')
    on conflict (negotiation_id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.commercial_sales_auto_charge() from public, anon, authenticated;
drop trigger if exists commercial_sales_auto_charge on public.commercial_sales;
create trigger commercial_sales_auto_charge
  after insert or update of contract_signed on public.commercial_sales
  for each row execute function public.commercial_sales_auto_charge();

create or replace function public.direct_sales_auto_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.method_rule = 'asa4' and new.contract_signed and not coalesce(new.cancelled, false)
     and (tg_op = 'INSERT' or not coalesce(old.contract_signed, false))
     and public._auto_charge_unit_on(new.clinic_id) then
    insert into public.sale_auto_charges (clinic_id, direct_sale_id, source)
    values (new.clinic_id, new.id, 'venda_direta')
    on conflict (direct_sale_id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.direct_sales_auto_charge() from public, anon, authenticated;
drop trigger if exists direct_sales_auto_charge on public.direct_sales;
create trigger direct_sales_auto_charge
  after insert or update of contract_signed on public.direct_sales
  for each row execute function public.direct_sales_auto_charge();

-- -----------------------------------------------------------------------------
-- 3) A COBRANÇA GUARDA DE ONDE NASCEU, SE O ASAAS ENVIOU E SE FOI ABERTA
-- -----------------------------------------------------------------------------
alter table public.charges add column if not exists auto_origin text;
alter table public.charges drop constraint if exists charges_auto_origin_check;
alter table public.charges add constraint charges_auto_origin_check
  check (auto_origin is null or auto_origin in ('assinatura', 'venda_direta', 'rotina', 'rodar_agora', 'restante'));
alter table public.charges add column if not exists asaas_sent_at timestamptz;
alter table public.charges add column if not exists viewed_at timestamptz;

-- Elegível? Parcela aberta, da venda marcada, pelo Asaas, dentro do prazo,
-- sem cobrança ativa, sem cancelamento à mão em vigor, unidade pronta.
create or replace function public._auto_charge_billing(p_installment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when i.negotiation_id is not null and i.payment_method = 'pix' then 'PIX'
    when i.negotiation_id is not null and i.payment_method = 'boleto' then 'BOLETO'
    when i.direct_sale_id is not null and ds.method_rule = 'asa4' and i.payment_method = 'pix' then 'PIX'
    when i.direct_sale_id is not null and ds.method_rule = 'asa4' and i.payment_method = 'boleto' then 'BOLETO'
    when i.direct_sale_id is not null and ds.method_rule = 'asa4' and i.payment_method = 'cartao' then 'CREDIT_CARD'
  end
    from public.payment_installments i
    left join public.direct_sales ds on ds.id = i.direct_sale_id
   where i.id = p_installment_id;
$$;
revoke execute on function public._auto_charge_billing(uuid) from public, anon, authenticated;

-- Cancelada à mão e nada recebido depois: a decisão da pessoa vale.
create or replace function public._auto_charge_cancelled_by_hand(p_installment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.charges c
     where c.payment_installment_id = p_installment_id and c.status = 'cancelada'
       and not exists (select 1 from public.payment_receipts r
                        where r.installment_id = p_installment_id and r.reversal_of is null
                          and not coalesce(r.reversed, false) and r.created_at > coalesce(c.cancelled_at, c.updated_at)));
$$;
revoke execute on function public._auto_charge_cancelled_by_hand(uuid) from public, anon, authenticated;

create or replace function public._auto_charge_due(
  p_clinic_id uuid, p_negotiation_id uuid, p_direct_sale_id uuid, p_limit integer
)
returns table (installment_id uuid, clinic_id uuid, billing_type text, due_date date, origem text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.clinic_id, public._auto_charge_billing(i.id), i.due_date, m.source
    from public.payment_installments i
    join public.sale_auto_charges m
      on (m.negotiation_id is not null and m.negotiation_id = i.negotiation_id)
      or (m.direct_sale_id is not null and m.direct_sale_id = i.direct_sale_id)
   where i.status in ('em_aberto', 'parcial')
     and i.renegotiation_id is null
     and coalesce(i.grace_days, 0) = 0
     and public._auto_charge_billing(i.id) is not null
     and i.due_date <= public.today_br() + public._auto_charge_window()
     and not public._installment_has_active_charge(i.id, false)
     and not public._auto_charge_cancelled_by_hand(i.id)
     and (p_clinic_id is null or i.clinic_id = p_clinic_id)
     and (p_negotiation_id is null or i.negotiation_id = p_negotiation_id)
     and (p_direct_sale_id is null or i.direct_sale_id = p_direct_sale_id)
     and public.central_is_ready(i.clinic_id)
   order by i.due_date, i.seq
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke execute on function public._auto_charge_due(uuid, uuid, uuid, integer) from public, anon, authenticated;

-- A porta SEM USUÁRIO (só o servidor): a mesma conferência da emissão manual.
create or replace function public._charge_prepare_system(
  p_installment_id uuid, p_billing_type text, p_origin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v record;
  v_id uuid;
begin
  select i.clinic_id into v_clinic from public.payment_installments i where i.id = p_installment_id for update;
  if v_clinic is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not exists (select 1 from public._auto_charge_due(v_clinic, null, null, 1000) d where d.installment_id = p_installment_id) then
    raise exception 'NOT_DUE';
  end if;
  select * into v from public._charge_compute(p_installment_id, p_billing_type, null);
  if v.error_code is not null then raise exception '%', v.error_code; end if;
  insert into public.charges (
    clinic_id, gateway_account_id, source_type, payment_installment_id, client_id,
    payer_kind, payer_guardian_id, billing_type, value_cents, discount_cents,
    fine_percent, fine_cents, interest_percent, due_date, is_overdue_reissue, status, created_by, auto_origin
  ) values (
    v_clinic, v.gateway_account_id, 'installment', p_installment_id, v.client_id,
    v.payer_kind, v.payer_guardian_id, v.billing_type, v.value_cents, v.discount_cents,
    v.fine_percent, v.fine_cents, v.interest_percent, v.due_date, v.is_overdue_reissue, 'emitindo', null, p_origin
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._charge_prepare_system(uuid, text, text) from public, anon, authenticated;

-- "Enviada pelo Asaas": no momento da criação, a régua estava ligada, o
-- pagador tinha contato e não estava na lista de recusa (19.3). Não é
-- confirmação de entrega.
create or replace function public._charge_mark_asaas_sent(p_charge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.charges%rowtype;
  v_contato record;
begin
  select * into v from public.charges where id = p_charge_id;
  if v.id is null or v.status <> 'emitida' or v.gateway_customer_id is null then return false; end if;
  if public._gateway_regua_mode(v.gateway_customer_id) <> 'on' then return false; end if;
  select * into v_contato from public._gateway_customer_contact(v.gateway_customer_id);
  if v_contato.email is null and v_contato.mobile is null then return false; end if;
  update public.charges set asaas_sent_at = coalesce(issued_at, now()) where id = p_charge_id and asaas_sent_at is null;
  return true;
end;
$$;
revoke execute on function public._charge_mark_asaas_sent(uuid) from public, anon, authenticated;

-- "Aberta pelo pagador": os avisos PAYMENT_CHECKOUT_VIEWED / PAYMENT_BANK_SLIP_VIEWED.
create or replace function public.gateway_events_viewed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event in ('PAYMENT_CHECKOUT_VIEWED', 'PAYMENT_BANK_SLIP_VIEWED') then
    update public.charges c
       set viewed_at = coalesce(c.viewed_at, new.received_at)
     where c.asaas_payment_id = new.payload -> 'payment' ->> 'id'
       and c.gateway_account_id = new.account_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.gateway_events_viewed() from public, anon, authenticated;
drop trigger if exists gateway_events_viewed on public.gateway_webhook_events;
create trigger gateway_events_viewed
  after insert on public.gateway_webhook_events
  for each row execute function public.gateway_events_viewed();

-- -----------------------------------------------------------------------------
-- 4) AS RODADAS DAS ROTINAS (de onde o vigia lê)
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_routine_runs (
  id bigint generated always as identity primary key,
  routine text not null check (routine in ('cobrancas', 'split_diario', 'contas', 'regua')),
  origin text not null check (origin in ('vercel', 'banco', 'rodar_agora', 'gatilho')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  created integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  stopped_reason text,
  actor uuid references public.profiles (id),
  details jsonb
);
create index if not exists gateway_routine_runs_recent on public.gateway_routine_runs (routine, started_at desc);
alter table public.gateway_routine_runs enable row level security;

create or replace function public._routine_run_start(p_routine text, p_origin text, p_actor uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.gateway_routine_runs (routine, origin, actor) values (p_routine, p_origin, p_actor)
  returning id into v_id;
  -- Guarda 90 dias de rodadas (registro técnico da rotina, não dado de operação).
  -- DESTRUTIVO: apaga só rodadas de rotina com mais de 90 dias.
  delete from public.gateway_routine_runs where started_at < now() - interval '90 days';
  return v_id;
end;
$$;
revoke execute on function public._routine_run_start(text, text, uuid) from public, anon, authenticated;

create or replace function public._routine_run_finish(
  p_id bigint, p_ok boolean, p_created integer, p_failed integer, p_skipped integer, p_reason text, p_details jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gateway_routine_runs
     set finished_at = now(), ok = p_ok, created = coalesce(p_created, 0), failed = coalesce(p_failed, 0),
         skipped = coalesce(p_skipped, 0), stopped_reason = p_reason, details = p_details
   where id = p_id;
$$;
revoke execute on function public._routine_run_finish(bigint, boolean, integer, integer, integer, text, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) A LISTA DE PENDÊNCIAS, COM O MOTIVO (Gerente, Financeiro, Admin)
-- -----------------------------------------------------------------------------
create or replace function public._auto_charge_reason(p_installment_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_billing text;
  v_err text;
  v_charge record;
begin
  select i.clinic_id into v_clinic from public.payment_installments i where i.id = p_installment_id;
  select c.status, c.error_code into v_charge from public.charges c
   where c.payment_installment_id = p_installment_id and c.status in ('erro_emissao', 'emitindo')
   order by c.created_at desc limit 1;
  if v_charge.status = 'erro_emissao' then return 'erro:' || coalesce(v_charge.error_code, 'desconhecido'); end if;
  if v_charge.status = 'emitindo' then return 'emitindo'; end if;
  if public._auto_charge_cancelled_by_hand(p_installment_id) then return 'cancelada_a_mao'; end if;
  if not public.central_is_ready(v_clinic) then return 'unidade_nao_pronta'; end if;
  v_billing := public._auto_charge_billing(p_installment_id);
  select error_code into v_err from public._charge_compute(p_installment_id, v_billing, null);
  if v_err is not null then return 'erro:' || v_err; end if;
  return 'aguardando_rotina';
end;
$$;
revoke execute on function public._auto_charge_reason(uuid) from public, anon, authenticated;

create or replace function public.auto_charge_panel_read(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer := public._auto_charge_window();
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or (p_clinic_id is not null and public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[]))) then
    raise exception 'NOT_ALLOWED';
  end if;
  return jsonb_build_object(
    'prazo', v_window,
    'pode_configurar', public.is_admin_master(),
    'app_base_url', (select s.app_base_url from public.gateway_auto_charge_settings s where s.id),
    'vigia', (select s.watch_enabled from public.gateway_auto_charge_settings s where s.id),
    'segundo_disparo', exists (select 1 from pg_extension where extname = 'pg_net'),
    'unidades', coalesce((
      select jsonb_agg(jsonb_build_object('clinic_id', k.id, 'nome', k.name,
               'ligada', coalesce(u.enabled, false), 'desde', u.enabled_from,
               'pronta', public.central_is_ready(k.id)) order by k.name)
        from public.clinics k left join public.gateway_auto_charge_units u on u.clinic_id = k.id
       where k.type = 'franchise_unit' and k.is_active
         and (p_clinic_id is null or k.id = p_clinic_id)), '[]'),
    'pendencias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'installment_id', i.id, 'clinic_id', i.clinic_id, 'vencimento', i.due_date, 'valor', i.amount_cents,
               'meio', i.payment_method, 'cliente', c.full_name, 'codigo', c.code, 'client_id', i.client_id,
               'motivo', public._auto_charge_reason(i.id)) order by i.due_date)
        from public.payment_installments i
        join public.sale_auto_charges m
          on (m.negotiation_id is not null and m.negotiation_id = i.negotiation_id)
          or (m.direct_sale_id is not null and m.direct_sale_id = i.direct_sale_id)
        left join public.clients c on c.id = i.client_id
       where i.status in ('em_aberto', 'parcial')
         and public._auto_charge_billing(i.id) is not null
         and i.due_date <= public.today_br() + v_window
         and not exists (select 1 from public.charges x where x.payment_installment_id = i.id
                            and x.status in ('emitida', 'vencida', 'externa'))
         and (p_clinic_id is null or i.clinic_id = p_clinic_id)), '[]'),
    'rodadas', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.started_at desc)
        from (select x.routine, x.origin, x.started_at, x.finished_at, x.ok, x.created, x.failed, x.skipped,
                     x.stopped_reason, pr.full_name as quem
                from public.gateway_routine_runs x left join public.profiles pr on pr.id = x.actor
               where x.routine <> 'regua' order by x.started_at desc limit 30) r), '[]')
  );
end;
$$;
revoke execute on function public.auto_charge_panel_read(uuid) from public, anon, authenticated;
grant execute on function public.auto_charge_panel_read(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O VIGIA (só banco: pg_cron, de hora em hora; não depende da Vercel)
-- -----------------------------------------------------------------------------
create table if not exists public.routine_notices (
  kind text not null,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (kind, key)
);
alter table public.routine_notices enable row level security;

create or replace function public._notify_users(
  p_kind text, p_key text, p_users uuid[], p_clinic_id uuid, p_title text, p_body text, p_link text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
  v_n integer;
begin
  if p_users is null or cardinality(p_users) = 0 then return 0; end if;
  insert into public.routine_notices (kind, key) values (p_kind, p_key)
  on conflict do nothing returning true into v_new;
  if not coalesce(v_new, false) then return 0; end if;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct u, p_clinic_id, p_title, p_body, p_link from unnest(p_users) u where u is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public._notify_users(text, text, uuid[], uuid, text, text, text) from public, anon, authenticated;

create or replace function public._admins_and_finance()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select p.id x from public.profiles p where p.is_admin_master and p.is_active
    union select ucr.user_id from public.user_clinic_roles ucr where ucr.role = 'finance_franchisor') t;
$$;
revoke execute on function public._admins_and_finance() from public, anon, authenticated;

create or replace function public.routine_watch_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_hora integer := extract(hour from (v_now at time zone 'America/Sao_Paulo'))::integer;
  v_hoje date := public.today_br();
  v_inicio timestamptz := (v_hoje::timestamp at time zone 'America/Sao_Paulo');
  v_n integer := 0;
  v_quem uuid[] := public._admins_and_finance();
  v_faltam integer;
begin
  if not coalesce((select s.watch_enabled from public.gateway_auto_charge_settings s where s.id), true) then return 0; end if;

  -- Cobranças do dia: Vercel 07:00 e banco 09:30; às 11:00 sem rodada boa → aviso.
  if v_hora >= 11 and exists (select 1 from public.gateway_auto_charge_units u where u.enabled)
     and not exists (select 1 from public.gateway_routine_runs r where r.routine = 'cobrancas'
                       and r.ok and r.origin <> 'gatilho' and r.started_at >= v_inicio) then
    v_n := v_n + public._notify_users('vigia_sem_rodada', 'cobrancas:' || v_hoje, v_quem, null,
      'A criação das cobranças não rodou hoje',
      'Nenhuma rodada boa da criação automática de cobranças hoje. Abra Financeiro → Cobranças automáticas e use "Rodar agora".',
      '/financeiro/cobrancas-automaticas');
  end if;
  -- Parcela que já devia ter nascido (prazo − 1 dia) e não tem cobrança, nem motivo conhecido.
  if v_hora >= 11 then
    select count(*) into v_faltam
      from public._auto_charge_due(null, null, null, 1000) d
     where d.due_date <= v_hoje + public._auto_charge_window() - 1;
    if v_faltam > 0 then
      v_n := v_n + public._notify_users('vigia_atrasadas', 'cobrancas:' || v_hoje, v_quem, null,
        'Parcelas sem cobrança no prazo',
        v_faltam || ' parcela(s) já deviam ter cobrança no Asaas e ainda não têm. Veja a lista de pendências.',
        '/financeiro/cobrancas-automaticas');
    end if;
  end if;
  -- Split diário (Vercel 00:05, banco 01:35) e contas (Vercel 06:40, banco 08:10).
  if v_hora >= 3 and not exists (select 1 from public.gateway_routine_runs r where r.routine = 'split_diario'
                                    and r.ok and r.started_at >= v_inicio) then
    v_n := v_n + public._notify_users('vigia_sem_rodada', 'split_diario:' || v_hoje, v_quem, null,
      'A rotina diária do split não rodou hoje', 'A fila do split e a virada das campanhas não rodaram hoje.',
      '/financeiro/cobrancas-automaticas');
  end if;
  if v_hora >= 10 and not exists (select 1 from public.gateway_routine_runs r where r.routine = 'contas'
                                     and r.ok and r.started_at >= v_inicio) then
    v_n := v_n + public._notify_users('vigia_sem_rodada', 'contas:' || v_hoje, v_quem, null,
      'A verificação das contas Asaas não rodou hoje', 'A verificação diária das contas Asaas não rodou hoje.',
      '/financeiro/cobrancas-automaticas');
  end if;
  -- Régua: roda a cada 10 minutos; 1 hora sem rodada → aviso (uma vez por hora).
  if not exists (select 1 from public.gateway_routine_runs r where r.routine = 'regua'
                   and r.started_at >= v_now - interval '1 hour') then
    v_n := v_n + public._notify_users('vigia_sem_rodada', 'regua:' || to_char(v_now at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24'),
      v_quem, null, 'A fila da régua parou', 'A rotina de 10 em 10 minutos (régua e avisos de cobrança) não roda há mais de 1 hora.',
      '/financeiro/cobrancas-automaticas');
  end if;
  return v_n;
end;
$$;
revoke execute on function public.routine_watch_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) O SEGUNDO DISPARO (pg_cron + pg_net), com a senha gerada no Vault
-- -----------------------------------------------------------------------------
-- A senha é gerada aqui e nunca sai do banco: a aplicação a confere pela porta
-- `_db_cron_token_ok` (servidor). Ninguém a vê nem a copia.
create or replace function public._db_cron_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'riszon_db_cron_token' limit 1;
  if v is null then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                                'riszon_db_cron_token', 'Senha do 2º disparo das rotinas (pg_cron → aplicação). 4012.');
    select decrypted_secret into v from vault.decrypted_secrets where name = 'riszon_db_cron_token' limit 1;
  end if;
  return v;
end;
$$;
revoke execute on function public._db_cron_token() from public, anon, authenticated;

create or replace function public._db_cron_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_token is not null and length(p_token) >= 32
     and exists (select 1 from vault.decrypted_secrets s where s.name = 'riszon_db_cron_token' and s.decrypted_secret = p_token);
$$;
revoke execute on function public._db_cron_token_ok(text) from public, anon, authenticated;

create or replace function public._routine_http_dispatch(p_path text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := (select s.app_base_url from public.gateway_auto_charge_settings s where s.id);
begin
  if v_base is null or not exists (select 1 from pg_extension where extname = 'pg_net') then return false; end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 290000)'
    using v_base || p_path,
          jsonb_build_object('Authorization', 'Bearer ' || public._db_cron_token(), 'x-riszon-origem', 'banco');
  return true;
end;
$$;
revoke execute on function public._routine_http_dispatch(text) from public, anon, authenticated;

-- Liga o 2º disparo onde o pg_net existe. Na produção: depois de o Jeferson
-- instalar o pg_net (19.14), `select public.routine_second_dispatch_enable();`.
create or replace function public.routine_second_dispatch_enable()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 0;
  end if;
  perform public._db_cron_token();
  -- Horários em UTC: 01:35, 08:10 e 09:30 em Brasília.
  perform cron.schedule('risarte-2o-split-diario', '35 4 * * *', $c$select public._routine_http_dispatch('/api/cron/gateway-split-diario')$c$);
  perform cron.schedule('risarte-2o-contas', '10 11 * * *', $c$select public._routine_http_dispatch('/api/cron/gateway-accounts')$c$);
  perform cron.schedule('risarte-2o-cobrancas', '30 12 * * *', $c$select public._routine_http_dispatch('/api/cron/gateway-cobrancas')$c$);
  return 3;
end;
$$;
revoke execute on function public.routine_second_dispatch_enable() from public, anon, authenticated;
grant execute on function public.routine_second_dispatch_enable() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('risarte-vigia-rotinas', '5 * * * *', 'select public.routine_watch_run()');
    perform public.routine_second_dispatch_enable();
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) COBRANÇAS DA VENDA: leitura, registro de envio e avisos (19.3)
-- -----------------------------------------------------------------------------
create table if not exists public.charge_link_sends (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges (id),
  channel text not null check (channel in ('copiar_link', 'whatsapp', 'copiar_pix', 'linha_digitavel')),
  sent_by uuid references public.profiles (id),
  sent_at timestamptz not null default now()
);
create index if not exists charge_link_sends_charge on public.charge_link_sends (charge_id, sent_at desc);
alter table public.charge_link_sends enable row level security;

-- Quem fechou a venda: o Consultor da negociação; na venda direta, quem a registrou.
create or replace function public._sale_closer(p_negotiation_id uuid, p_direct_sale_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select n.consultant_id from public.plan_negotiations n where n.id = p_negotiation_id),
    (select s.created_by from public.direct_sales s where s.id = p_direct_sale_id));
$$;
revoke execute on function public._sale_closer(uuid, uuid) from public, anon, authenticated;

create or replace function public._sale_charges_can(p_negotiation_id uuid, p_direct_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
       public.is_admin_master() or public.is_finance_franchisor()
    or public._sale_closer(p_negotiation_id, p_direct_sale_id) = (select auth.uid())
    or public.has_role_in_clinic(
         coalesce((select n.clinic_id from public.plan_negotiations n where n.id = p_negotiation_id),
                  (select s.clinic_id from public.direct_sales s where s.id = p_direct_sale_id)),
         array['unit_manager']::public.user_role[]));
$$;
revoke execute on function public._sale_charges_can(uuid, uuid) from public, anon, authenticated;

-- A porta própria (a regra de leitura das cobranças, 0403, NÃO muda).
create or replace function public.sale_charges_read(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer := public._auto_charge_window();
  v_closed timestamptz;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  if not public._sale_charges_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_negotiation_id is not null then
    select cs.closed_at into v_closed from public.commercial_sales cs where cs.negotiation_id = p_negotiation_id;
  else
    select s.closed_at into v_closed from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  return jsonb_build_object(
    'automatica', exists (select 1 from public.sale_auto_charges m
                           where (p_negotiation_id is not null and m.negotiation_id = p_negotiation_id)
                              or (p_direct_sale_id is not null and m.direct_sale_id = p_direct_sale_id)),
    'prazo', v_window,
    'venda_fechada_em', v_closed,
    'parcelas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'installment_id', i.id, 'seq', i.seq, 'tipo', i.kind, 'vencimento', i.due_date,
               'valor', i.amount_cents, 'pago', coalesce(i.paid_amount_cents, 0), 'meio', i.payment_method,
               'situacao_parcela', i.status,
               'pelo_asaas', public._auto_charge_billing(i.id) is not null,
               'agendada_para', case when ch.id is null and i.status in ('em_aberto', 'parcial')
                                       and public._auto_charge_billing(i.id) is not null
                                     then greatest(public.today_br(), i.due_date - v_window) end,
               'cobranca', case when ch.id is null then null else jsonb_build_object(
                  'id', ch.id, 'status', ch.status, 'meio', ch.billing_type, 'valor', ch.value_cents,
                  'link', ch.invoice_url, 'boleto', ch.bank_slip_url, 'pix', ch.pix_copy_paste,
                  'linha', ch.identification_field, 'criada_em', ch.issued_at, 'origem', ch.auto_origin,
                  'enviada_pelo_asaas_em', ch.asaas_sent_at, 'aberta_em', ch.viewed_at, 'paga_em', ch.paid_on) end,
               'ultimo_envio', (select jsonb_build_object('canal', l.channel, 'quem', pr.full_name, 'quando', l.sent_at)
                                  from public.charge_link_sends l left join public.profiles pr on pr.id = l.sent_by
                                 where l.charge_id = ch.id order by l.sent_at desc limit 1))
             order by i.seq)
        from public.payment_installments i
        left join lateral (
          select c.* from public.charges c
           where c.payment_installment_id = i.id and c.status <> 'cancelada'
           order by c.created_at desc limit 1) ch on true
       where (p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
          or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id)), '[]')
  );
end;
$$;
revoke execute on function public.sale_charges_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sale_charges_read(uuid, uuid) to authenticated;

create or replace function public.charge_link_sent(p_charge_id uuid, p_channel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.payment_installments%rowtype;
begin
  select i.* into v_inst from public.charges c join public.payment_installments i on i.id = c.payment_installment_id
   where c.id = p_charge_id;
  if v_inst.id is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._sale_charges_can(v_inst.negotiation_id, v_inst.direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  insert into public.charge_link_sends (charge_id, channel, sent_by) values (p_charge_id, p_channel, (select auth.uid()));
end;
$$;
revoke execute on function public.charge_link_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_link_sent(uuid, text) to authenticated;

-- Os avisos (rodam na rotina de 10 em 10 minutos).
create or replace function public.charge_link_alerts_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.today_br();
  v_n integer := 0;
  r record;
  v_gerentes uuid[];
  v_link text;
begin
  for r in
    select c.id, c.clinic_id, c.issued_at, c.due_date, c.asaas_sent_at, c.viewed_at, i.client_id, i.seq,
           i.negotiation_id, i.direct_sale_id, cl.full_name as cliente,
           public._sale_closer(i.negotiation_id, i.direct_sale_id) as quem_fechou,
           exists (select 1 from public.charge_link_sends l where l.charge_id = c.id) as enviada,
           (i.seq = (select min(j.seq) from public.payment_installments j
                      join public.charges cj on cj.payment_installment_id = j.id and cj.status <> 'cancelada'
                     where (j.negotiation_id is not null and j.negotiation_id = i.negotiation_id)
                        or (j.direct_sale_id is not null and j.direct_sale_id = i.direct_sale_id))) as primeira
      from public.charges c
      join public.payment_installments i on i.id = c.payment_installment_id
      join public.sale_auto_charges m
        on (m.negotiation_id is not null and m.negotiation_id = i.negotiation_id)
        or (m.direct_sale_id is not null and m.direct_sale_id = i.direct_sale_id)
      left join public.clients cl on cl.id = i.client_id
     where c.status in ('emitida', 'vencida') and c.due_date >= v_hoje - 1
  loop
    v_link := case when r.negotiation_id is not null then '/comercial/' || r.client_id::text else '/comercial/venda-direta' end;
    if r.asaas_sent_at is null and not r.enviada then
      -- (a) 1 dia útil depois da criação sem envio → quem fechou a venda.
      if public._payout_add_business_days((r.issued_at at time zone 'America/Sao_Paulo')::date, 1) <= v_hoje then
        v_n := v_n + public._notify_users('link_1du', r.id::text, array[r.quem_fechou], r.clinic_id,
          'Link de cobrança não enviado',
          'A cobrança de ' || coalesce(r.cliente, 'cliente') || ' (vence ' || to_char(r.due_date, 'DD/MM') || ') foi criada e o link ainda não foi enviado.',
          v_link);
      end if;
      -- (b) faltando 2 dias úteis para o vencimento sem envio → também o Gerente.
      if public._payout_add_business_days(v_hoje, 2) >= r.due_date then
        select coalesce(array_agg(u.user_id), '{}') into v_gerentes from public.user_clinic_roles u
         where u.clinic_id = r.clinic_id and u.role = 'unit_manager';
        v_n := v_n + public._notify_users('link_2du', r.id::text, array[r.quem_fechou] || v_gerentes, r.clinic_id,
          'Cobrança vence em 2 dias úteis sem envio',
          'O link da cobrança de ' || coalesce(r.cliente, 'cliente') || ' (vence ' || to_char(r.due_date, 'DD/MM') || ') não foi enviado. O Gerente pode enviar no lugar.',
          v_link);
      end if;
    elsif r.asaas_sent_at is not null and r.primeira and r.viewed_at is null
          and public._payout_add_business_days(v_hoje, 1) >= r.due_date then
      -- Régua ligada: a primeira cobrança não foi aberta até 1 dia útil antes → reenviar (ajuste 4).
      v_n := v_n + public._notify_users('nao_aberta', r.id::text, array[r.quem_fechou], r.clinic_id,
        'Primeira cobrança ainda não aberta',
        coalesce(r.cliente, 'O cliente') || ' ainda não abriu a primeira cobrança (vence ' || to_char(r.due_date, 'DD/MM') || '). Reenvie o link.',
        v_link);
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.charge_link_alerts_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_charge_prepare_system', '_auto_charge_due', 'auto_charge_panel_read', 'auto_charge_settings_set',
      'routine_watch_run', 'sale_charges_read', 'charge_link_sent', 'charge_link_alerts_run',
      'routine_second_dispatch_enable', '_db_cron_token_ok')) as funcoes_novas,
  (select window_days from public.gateway_auto_charge_settings where id) as prazo_dias,
  (select count(*) from public.gateway_auto_charge_units where enabled) as unidades_ligadas,
  (select count(*) from cron.job where jobname = 'risarte-vigia-rotinas') as vigia,
  exists (select 1 from pg_extension where extname = 'pg_net') as tem_pg_net,
  (select count(*) from cron.job where jobname like 'risarte-2o-%') as segundo_disparo;
