-- =============================================================================
-- 4022 — ASA7: as peças que preparam o piloto (spec 21.2 e 21.7, aprovadas em
-- 17/11/2026: decisão 1 = (b), 2a a 6a, e os quatro acréscimos do dono)
-- -----------------------------------------------------------------------------
--   1. O INTERRUPTOR DE PRODUÇÃO: só o Admin Master liga, com motivo, e só com
--      a PRONTIDÃO DA REDE completa — inclusive todas as migrações do Asaas na
--      produção, conferidas pela marca que cada uma deixa no banco. Ligar não
--      liga nenhuma unidade. Nasce DESLIGADO; nenhuma linha desta migração liga.
--   2. A PRONTIDÃO DA REDE: a confirmação escrita do Asaas (documento anexado,
--      pasta privada), o saldo mínimo da franqueadora, ver/emitir/cancelar
--      cobranças liberados ao Gerente e à Recepção, o termo de privacidade
--      publicado e as migrações.
--   3. A PRONTIDÃO DA UNIDADE ganha três itens:
--        * o débito desabilitado (marca do Admin Master, 19.37 item 2);
--        * a chave com as permissões mínimas (marca do Admin Master + a sonda
--          do servidor: transferências, Pix enviado e contas pagas recusados
--          por falta de permissão). Vale para a conta de PRODUÇÃO; no sandbox
--          não se aplica (as chaves de teste foram criadas antes da regra);
--        * o levantamento do que já existe no Asaas da conta (obrigatório, 2a).
--   4. A CONCILIAÇÃO DAS COBRANÇAS com o Asaas (3a e 4a): as divergências que o
--      servidor acha (toda noite, 3 dias para trás; toda semana, as em aberto),
--      gravadas aqui; fecham sozinhas; o Financeiro ou o Admin ignoram com
--      motivo; o Gerente e o franqueado veem a própria unidade, sem ignorar;
--      um resumo por dia ao Financeiro só quando aparece divergência nova.
--   5. COPIAR DE OUTRA UNIDADE (5a): Comercial (regras e acompanhamento) e
--      Financeiro (inclui a multa e os juros da unidade). Nunca a conta, a
--      chave, os termos, a prontidão, as taxas ou a cobrança mensal.
-- Nenhuma chamada ao Asaas sai do banco. Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) AS COLUNAS NOVAS
-- -----------------------------------------------------------------------------
alter table public.gateway_settings add column if not exists production_changed_at timestamptz;
alter table public.gateway_settings add column if not exists production_changed_by uuid references public.profiles(id);
alter table public.gateway_settings add column if not exists production_reason text;
alter table public.gateway_settings add column if not exists asaas_confirmation_path text;
alter table public.gateway_settings add column if not exists asaas_confirmation_name text;
alter table public.gateway_settings add column if not exists asaas_confirmation_at timestamptz;
alter table public.gateway_settings add column if not exists asaas_confirmation_by uuid references public.profiles(id);

alter table public.gateway_accounts add column if not exists debit_disabled_declared_at timestamptz;
alter table public.gateway_accounts add column if not exists debit_disabled_declared_by uuid references public.profiles(id);
alter table public.gateway_accounts add column if not exists key_min_perm_declared_at timestamptz;
alter table public.gateway_accounts add column if not exists key_min_perm_declared_by uuid references public.profiles(id);
alter table public.gateway_accounts add column if not exists key_perm_probe_at timestamptz;
alter table public.gateway_accounts add column if not exists key_perm_probe_ok boolean;
alter table public.gateway_accounts add column if not exists key_perm_probe_detail jsonb;

-- A pasta privada da confirmação do Asaas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asaas-rede', 'asaas-rede', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2) O LEVANTAMENTO DA CONTA (o que já existe no Asaas sem o riSZon)
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_account_surveys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.gateway_accounts(id),
  clinic_id uuid references public.clinics(id),
  ran_at timestamptz not null default now(),
  ran_by uuid references public.profiles(id),
  ok boolean not null,
  open_payments integer not null default 0,
  open_payments_cents bigint not null default 0,
  installments integer not null default 0,
  subscriptions integer not null default 0,
  sample jsonb not null default '[]'::jsonb,
  error text
);
create index if not exists gateway_account_surveys_account on public.gateway_account_surveys (account_id, ran_at desc);
alter table public.gateway_account_surveys enable row level security;
revoke all on public.gateway_account_surveys from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) A CONCILIAÇÃO DAS COBRANÇAS
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_charge_issues (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null,
  account_id uuid not null references public.gateway_accounts(id),
  clinic_id uuid references public.clinics(id),
  charge_id uuid references public.charges(id),
  asaas_payment_id text,
  kind text not null check (kind in ('paga_no_asaas', 'situacao_diferente', 'valor_diferente', 'cancelada_so_no_asaas',
                                     'cancelada_so_no_riszon', 'sem_no_asaas', 'fora_do_riszon')),
  status text not null default 'aberta' check (status in ('aberta', 'ignorada', 'resolvida')),
  amount_cents bigint,
  detail jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  reopened_at timestamptz,
  ignored_at timestamptz,
  ignored_by uuid references public.profiles(id),
  ignored_reason text,
  ignored_amount_cents bigint
);
create unique index if not exists gateway_charge_issues_open on public.gateway_charge_issues (issue_key) where status <> 'resolvida';
create index if not exists gateway_charge_issues_clinic on public.gateway_charge_issues (clinic_id, status);
alter table public.gateway_charge_issues enable row level security;
revoke all on public.gateway_charge_issues from anon, authenticated;

create table if not exists public.gateway_charge_recon_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.gateway_accounts(id),
  kind text not null check (kind in ('diaria', 'semanal')),
  ran_at timestamptz not null default now(),
  checked integer not null default 0,
  calls integer not null default 0,
  new_issues integer not null default 0,
  open_issues integer not null default 0,
  error text
);
create index if not exists gateway_charge_recon_runs_account on public.gateway_charge_recon_runs (account_id, ran_at desc);
alter table public.gateway_charge_recon_runs enable row level security;
revoke all on public.gateway_charge_recon_runs from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) AS MIGRAÇÕES DO ASAAS NA PRODUÇÃO (pela marca de cada uma)
-- -----------------------------------------------------------------------------
create or replace function public.gateway_asaas_migrations()
returns table (code text, label text, applied boolean, sort_order integer)
language sql stable security definer set search_path = '' as $$
  with m(code, label, kind, obj, sort_order) as (values
    ('4000', 'Fundação: contas e Vault', 'table', 'gateway_settings', 1),
    ('4001', 'Tarifas no adquirente', 'fn', '_gateway_sync_fees', 2),
    ('4002', 'Prontidão, histórico e verificação', 'table', 'central_unit_readiness', 3),
    ('4003', 'Responsável financeiro e carência', 'col', 'client_guardians.is_financial', 4),
    ('4004', 'Cobranças, travas e dispensa', 'table', 'gateway_customers', 5),
    ('4005', 'O aviso vira baixa', 'table', 'gateway_payment_surpluses', 6),
    ('4006', 'Selo em atraso e painel de cobranças', 'fn', '_overdue_badge_business_days', 7),
    ('4007', 'A régua de avisos', 'table', 'gateway_notification_rules', 8),
    ('4008', 'O split na emissão', 'table', 'gateway_split_settings', 9),
    ('4009', 'A fila do split e o estorno', 'table', 'charge_split_updates', 10),
    ('4010', 'Repasses da franquia', 'fn', '_franchise_payout_charge_fees', 11),
    ('4011', 'Meio por parcela, dinheiro e permuta', 'table', 'sale_method_settings', 12),
    ('4012', 'Cobrança na assinatura e rotina', 'table', 'gateway_auto_charge_settings', 13),
    ('4013', 'Cartão parcelado', 'fn', 'charges_card_block_rule', 14),
    ('4014', 'Parcelado: devolução, contestação e avisos', 'table', 'card_block_returns', 15),
    ('4015', 'Todos os boletos agora', 'table', 'gateway_carne_customers', 16),
    ('4015a', 'Recusa de cancelar venda com acordo aberto', 'fn', '_sale_open_agreements', 17),
    ('4017', 'Renegociação assinada', 'table', 'payment_renegotiation_events', 18),
    ('4017a', 'Exceção: cancelar venda com acordo', 'table', 'sale_cancel_exceptions', 19),
    ('4018', 'Mensalidades pelo Asaas', 'table', 'charge_source_types', 20),
    ('4018a', 'A marca do split a mais', 'body', '_gateway_split_retention|4018a', 21),
    ('4018b', 'A conta cancelada à mão', 'body', 'refresh_network_fee_payable|Sem valor apurado', 22),
    ('4018c', 'A taxa retida no razão', 'fn', '_split_charges_after_born', 23),
    ('4020', 'Distrato com checklist', 'table', 'distrato_requests', 24),
    ('4020a', 'Estorno de parte pelo Asaas', 'table', 'refund_requests', 25),
    ('4021', 'Cobrança mensal da rede', 'table', 'franchise_billing_settings', 26),
    ('4021a', 'Conferência das taxas', 'table', 'reconciliation_issues', 27),
    ('4022', 'As peças do piloto', 'table', 'gateway_charge_issues', 28)
  )
  select m.code, m.label,
         case m.kind
           when 'table' then exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = m.obj)
           when 'fn' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.obj)
           when 'col' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                                     and c.table_name = split_part(m.obj, '.', 1) and c.column_name = split_part(m.obj, '.', 2))
           -- sem objeto novo: a marca é um trecho da função que ela redefiniu
           when 'body' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public' and p.proname = split_part(m.obj, '|', 1)
                                       and position(split_part(m.obj, '|', 2) in p.prosrc) > 0)
         end,
         m.sort_order
    from m order by m.sort_order;
$$;

-- -----------------------------------------------------------------------------
-- 5) A PRONTIDÃO DA REDE
-- -----------------------------------------------------------------------------
-- Os papéis que valem para uma permissão (a matriz, ou o padrão, dentro do teto):
-- o mesmo cálculo de `_gateway_cap_clinics`, sem olhar quem está logado.
create or replace function public._gateway_cap_effective_roles(p_capability text)
returns public.user_role[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.user_role[];
begin
  if exists (select 1 from public.permission_matrix) then
    select coalesce(array_agg(pm.role), '{}') into v from public.permission_matrix pm
     where pm.capability = p_capability and pm.allowed;
  else
    v := public._gateway_cap_default_roles(p_capability);
  end if;
  return v;
end;
$$;

create or replace function public._gateway_network_readiness()
returns table (item text, ok boolean, detail jsonb, sort_order integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.gateway_settings%rowtype;
  v_min bigint;
  v_priv timestamptz;
  v_faltam text[];
  v_cap text;
  v_falta_cap jsonb := '[]'::jsonb;
  v_roles public.user_role[];
begin
  select * into s from public.gateway_settings where id;
  select min_balance_cents into v_min from public.gateway_split_settings where id;
  select privacy_declared_at into v_priv from public.gateway_notification_settings where id;
  select coalesce(array_agg(g.code order by g.sort_order), '{}') into v_faltam from public.gateway_asaas_migrations() g where not g.applied;
  -- As CINCO marcas (decisão do dono, 18/11/2026): ver, emitir e cancelar para o
  -- Gerente; ver e emitir para a Recepção. A Recepção não cancela à mão (o banco
  -- recusa desde a 4004: `_charge_can('cancel')`); o "Recebeu no balcão" dela é
  -- outro caminho (`counter`) e não depende desta marca.
  foreach v_cap in array array['acao.cobranca.ver', 'acao.cobranca.emitir', 'acao.cobranca.cancelar'] loop
    v_roles := public._gateway_cap_effective_roles(v_cap);
    if not ('unit_manager' = any (v_roles)) then v_falta_cap := v_falta_cap || jsonb_build_array(v_cap || ' · Gerente'); end if;
    if v_cap <> 'acao.cobranca.cancelar' and not ('receptionist' = any (v_roles)) then
      v_falta_cap := v_falta_cap || jsonb_build_array(v_cap || ' · Recepção');
    end if;
  end loop;

  return query
  select 'confirmacao_asaas'::text, s.asaas_confirmation_path is not null,
         jsonb_build_object('arquivo', s.asaas_confirmation_name, 'em', s.asaas_confirmation_at), 10
  union all
  select 'saldo_minimo', v_min is not null, jsonb_build_object('centavos', v_min), 20
  union all
  select 'permissoes_cobranca', jsonb_array_length(v_falta_cap) = 0, jsonb_build_object('faltam', v_falta_cap), 30
  union all
  select 'termo_privacidade', v_priv is not null, jsonb_build_object('em', v_priv), 40
  union all
  select 'migracoes', coalesce(array_length(v_faltam, 1), 0) = 0, jsonb_build_object('faltam', to_jsonb(v_faltam)), 50;
end;
$$;

create or replace function public.gateway_production_read()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.gateway_settings%rowtype;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  select * into s from public.gateway_settings where id;
  return jsonb_build_object(
    'ligada', coalesce(s.production_enabled, false),
    'mudou_em', s.production_changed_at,
    'mudou_por', (select p.full_name from public.profiles p where p.id = s.production_changed_by),
    'motivo', s.production_reason,
    'pode_mudar', public.is_admin_master(),
    'prontidao', coalesce((select jsonb_agg(jsonb_build_object('item', r.item, 'ok', r.ok, 'detalhe', r.detail) order by r.sort_order)
                             from public._gateway_network_readiness() r), '[]'::jsonb),
    'migracoes', coalesce((select jsonb_agg(jsonb_build_object('codigo', m.code, 'nome', m.label, 'na_producao', m.applied) order by m.sort_order)
                             from public.gateway_asaas_migrations() m), '[]'::jsonb)
  );
end;
$$;

create or replace function public.gateway_asaas_confirmation_save(p_path text, p_name text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if p_path is null or not exists (select 1 from storage.objects o where o.bucket_id = 'asaas-rede' and o.name = p_path) then
    raise exception 'PROOF_REQUIRED';
  end if;
  update public.gateway_settings set asaas_confirmation_path = p_path, asaas_confirmation_name = left(coalesce(p_name, ''), 200),
         asaas_confirmation_at = now(), asaas_confirmation_by = (select auth.uid()), updated_at = now(), updated_by = (select auth.uid())
   where id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), null, 'update', 'asaas_confirmation', 'rede', jsonb_build_object('arquivo', left(coalesce(p_name, ''), 200)));
end;
$$;

-- O INTERRUPTOR. Ligar: só o Admin Master, com motivo, e com a prontidão da rede completa.
create or replace function public.gateway_production_switch(p_on boolean, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_falta text[];
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_on then
    select coalesce(array_agg(n.item order by n.sort_order), '{}') into v_falta from public._gateway_network_readiness() n where not n.ok;
    if coalesce(array_length(v_falta, 1), 0) > 0 then
      raise exception 'NETWORK_NOT_READY: %', array_to_string(v_falta, ', ');
    end if;
  end if;
  update public.gateway_settings set production_enabled = p_on, production_changed_at = now(),
         production_changed_by = (select auth.uid()), production_reason = btrim(p_reason),
         updated_at = now(), updated_by = (select auth.uid())
   where id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), null, 'update', 'production_switch', 'rede', jsonb_build_object('ligada', p_on, 'motivo', btrim(p_reason)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) A PRONTIDÃO DA UNIDADE: os três itens novos
-- -----------------------------------------------------------------------------
create or replace function public._central_readiness_raw(p_clinic_id uuid)
returns table(item text, ok boolean, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_today date := public.today_br();
  v_has_account boolean;
begin
  select a.* into v_acc
    from public.gateway_accounts a
   where a.id = public._gateway_account_of(p_clinic_id);
  v_has_account := found;

  return query
  select 'conta_validada'::text,
         coalesce(v_has_account and v_acc.status = 'active' and v_acc.last_check_ok is not false, false),
         10
  union all
  select 'wallet_id',
         coalesce(v_has_account and length(coalesce(v_acc.wallet_id, '')) > 0, false),
         20
  union all
  select 'webhook_ativo',
         coalesce(v_has_account and v_acc.webhook_id is not null and v_acc.webhook_token_secret_id is not null
                  and v_acc.webhook_events_ok is not false, false),
         30
  union all
  select 'tarifas',
         coalesce(v_has_account and exists (
           select 1
             from public.card_acquirers c
             join public.acquirer_rates r on r.acquirer_id = c.id
            where c.gateway_account_id = v_acc.id
              and r.valid_from <= v_today
              and (r.valid_to is null or r.valid_to >= v_today)
         ), false),
         40
  union all
  select 'chave_pix',
         coalesce(v_has_account and v_acc.pix_key_active is true, false),
         50
  union all
  select 'split_habilitado',
         coalesce(v_has_account and (v_acc.split_enabled_confirmed_at is not null
                                     or v_acc.split_enabled_declared_at is not null), false),
         60
  union all
  select 'termo_registrado',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor'
                                     or v_acc.term_registered_at is not null), false),
         70
  union all
  select 'antecipacao_desligada',
         coalesce(v_has_account and v_acc.anticipation_auto_enabled is false, false),
         80
  union all
  -- 4022 (19.37 item 2): o débito desabilitado no painel do Asaas, marcado pelo Admin Master.
  select 'debito_desabilitado',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor' or v_acc.debit_disabled_declared_at is not null), false),
         90
  union all
  -- 4022 (21.7 item 2): a chave de PRODUÇÃO com as permissões mínimas — a marca
  -- do Admin Master e a sonda do servidor (as três leituras proibidas recusadas).
  -- No sandbox não se aplica.
  select 'chave_permissoes_minimas',
         coalesce(v_has_account and (v_acc.environment <> 'production'
                                     or (v_acc.key_min_perm_declared_at is not null and v_acc.key_perm_probe_ok is true)), false),
         100
  union all
  -- 4022 (2a): o levantamento do que já existe no Asaas da conta, feito.
  select 'levantamento_feito',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor'
                                     or exists (select 1 from public.gateway_account_surveys s where s.account_id = v_acc.id and s.ok)), false),
         110;
end;
$$;

create or replace function public.gateway_declare_debit_disabled(p_account_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.gateway_accounts%rowtype;
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  select * into a from public.gateway_accounts where id = p_account_id;
  if a.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  update public.gateway_accounts set debit_disabled_declared_at = now(), debit_disabled_declared_by = (select auth.uid()), updated_at = now()
   where id = p_account_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), a.clinic_id, 'update', 'gateway_debit_disabled', p_account_id::text, jsonb_build_object('conta', a.label));
end;
$$;

create or replace function public.gateway_declare_key_permissions(p_account_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.gateway_accounts%rowtype;
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  select * into a from public.gateway_accounts where id = p_account_id;
  if a.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  update public.gateway_accounts set key_min_perm_declared_at = now(), key_min_perm_declared_by = (select auth.uid()), updated_at = now()
   where id = p_account_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), a.clinic_id, 'update', 'gateway_key_permissions', p_account_id::text, jsonb_build_object('conta', a.label));
end;
$$;

-- A sonda (só o servidor): as três leituras proibidas recusadas = a chave está restrita.
create or replace function public._gateway_key_probe_save(p_account_id uuid, p_ok boolean, p_detail jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.gateway_accounts%rowtype;
begin
  select * into a from public.gateway_accounts where id = p_account_id;
  if a.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  update public.gateway_accounts set key_perm_probe_at = now(), key_perm_probe_ok = p_ok, key_perm_probe_detail = coalesce(p_detail, '{}'::jsonb)
   where id = p_account_id;
  if not p_ok and a.environment = 'production' then
    perform public._gateway_notify(p_account_id, 'chave_permissao_demais', public.today_br()::text, a.clinic_id, false, false, true,
      'Chave do Asaas com permissão demais',
      'A chave de produção desta conta responde a transferências, Pix enviado ou contas pagas. Troque-a por uma com as permissões mínimas (Central › Conta e tarifas). A unidade saiu da prontidão.',
      case when a.clinic_id is not null then '/central/unidades/' || a.clinic_id::text else '/central' end);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) O LEVANTAMENTO: gravar (servidor) e ler (Admin Master e Financeiro)
-- -----------------------------------------------------------------------------
create or replace function public._gateway_survey_save(p_account_id uuid, p_actor uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.gateway_accounts%rowtype;
  v_id uuid;
begin
  select * into a from public.gateway_accounts where id = p_account_id;
  if a.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  insert into public.gateway_account_surveys (account_id, clinic_id, ran_by, ok, open_payments, open_payments_cents, installments, subscriptions, sample, error)
  values (p_account_id, a.clinic_id, p_actor, coalesce((p->>'ok')::boolean, false),
          coalesce((p->>'open_payments')::int, 0), coalesce((p->>'open_payments_cents')::bigint, 0),
          coalesce((p->>'installments')::int, 0), coalesce((p->>'subscriptions')::int, 0),
          coalesce(p->'sample', '[]'::jsonb), p->>'error')
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_actor, a.clinic_id, 'create', 'gateway_survey', v_id::text,
          jsonb_build_object('conta', a.label, 'ok', p->'ok', 'cobrancas', p->'open_payments', 'parcelamentos', p->'installments', 'assinaturas', p->'subscriptions'));
  return v_id;
end;
$$;

create or replace function public.gateway_surveys_read(p_account_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'em', s.ran_at, 'por', p.full_name, 'ok', s.ok,
                                                       'cobrancas', s.open_payments, 'cobrancas_cents', s.open_payments_cents,
                                                       'parcelamentos', s.installments, 'assinaturas', s.subscriptions,
                                                       'amostra', s.sample, 'erro', s.error) order by s.ran_at desc)
                     from (select * from public.gateway_account_surveys where account_id = p_account_id order by ran_at desc limit 10) s
                     left join public.profiles p on p.id = s.ran_by), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) A CONCILIAÇÃO DAS COBRANÇAS: gravar (servidor), ler, ignorar
-- -----------------------------------------------------------------------------
-- p_found: as divergências achadas [{kind, charge_id, asaas_payment_id, amount_cents, detail}].
-- p_checked: os ids do Asaas e as cobranças do riSZon conferidos nesta rodada
-- ({asaas: [...], charges: [...]}); o que foi conferido e não voltou divergente fecha.
create or replace function public._gateway_charge_recon_save(p_account_id uuid, p_kind text, p_found jsonb, p_checked jsonb, p_calls integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.gateway_accounts%rowtype;
  f jsonb;
  v_key text;
  v_now timestamptz := now();
  v_new integer := 0;
  v_seen text[] := '{}';
  r public.gateway_charge_issues%rowtype;
  v_open integer;
  v_closed integer;
  v_asaas text[];
  v_charges uuid[];
  v_amount bigint;
begin
  select * into a from public.gateway_accounts where id = p_account_id;
  if a.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_kind not in ('diaria', 'semanal') then raise exception 'INVALID_KIND'; end if;
  select coalesce(array_agg(x), '{}') into v_asaas from jsonb_array_elements_text(coalesce(p_checked->'asaas', '[]'::jsonb)) x;
  select coalesce(array_agg(x::uuid), '{}') into v_charges from jsonb_array_elements_text(coalesce(p_checked->'charges', '[]'::jsonb)) x;

  for f in select * from jsonb_array_elements(coalesce(p_found, '[]'::jsonb)) loop
    v_key := (f->>'kind') || '|' || p_account_id || '|' || coalesce(f->>'charge_id', '') || '|' || coalesce(f->>'asaas_payment_id', '');
    v_seen := v_seen || v_key;
    v_amount := nullif(f->>'amount_cents', '')::bigint;
    select * into r from public.gateway_charge_issues where issue_key = v_key and status <> 'resolvida';
    if r.id is null then
      insert into public.gateway_charge_issues (issue_key, account_id, clinic_id, charge_id, asaas_payment_id, kind, amount_cents, detail)
      values (v_key, p_account_id, coalesce((select c.clinic_id from public.charges c where c.id = nullif(f->>'charge_id', '')::uuid), a.clinic_id),
              nullif(f->>'charge_id', '')::uuid, nullif(f->>'asaas_payment_id', ''), f->>'kind', v_amount, coalesce(f->'detail', '{}'::jsonb));
      v_new := v_new + 1;
    elsif r.status = 'ignorada' and r.ignored_amount_cents is distinct from v_amount then
      update public.gateway_charge_issues set status = 'aberta', reopened_at = v_now, amount_cents = v_amount,
             detail = coalesce(f->'detail', '{}'::jsonb), last_seen_at = v_now where id = r.id;
      v_new := v_new + 1;
    else
      update public.gateway_charge_issues set amount_cents = v_amount, detail = coalesce(f->'detail', '{}'::jsonb), last_seen_at = v_now where id = r.id;
    end if;
  end loop;

  -- O que foi conferido nesta rodada e não voltou divergente fecha sozinho.
  update public.gateway_charge_issues i set status = 'resolvida', resolved_at = v_now
   where i.account_id = p_account_id and i.status in ('aberta', 'ignorada')
     and not (i.issue_key = any (v_seen))
     and ((i.asaas_payment_id is not null and i.asaas_payment_id = any (v_asaas))
          or (i.charge_id is not null and i.charge_id = any (v_charges)));
  get diagnostics v_closed = row_count;
  select count(*) into v_open from public.gateway_charge_issues where account_id = p_account_id and status = 'aberta';

  insert into public.gateway_charge_recon_runs (account_id, kind, checked, calls, new_issues, open_issues)
  values (p_account_id, p_kind, coalesce(array_length(v_asaas, 1), 0) + coalesce(array_length(v_charges, 1), 0), coalesce(p_calls, 0), v_new, v_open);

  -- Um resumo por dia ao Financeiro, só quando aparece divergência nova.
  if v_new > 0 then
    perform public._gateway_notify(p_account_id, 'conciliacao_cobrancas', public.today_br()::text, a.clinic_id, false, true, false,
      'Divergências com o Asaas',
      'A conferência das cobranças achou divergência nova entre o riSZon e o Asaas. Veja em Painel de cobranças › Divergências com o Asaas.',
      '/financeiro/cobrancas?aba=divergencias');
  end if;
  return jsonb_build_object('novas', v_new, 'abertas', v_open, 'fechadas', v_closed);
end;
$$;

create or replace function public.gateway_charge_issues_read(p_clinic_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean := public.is_admin_master() or public.is_finance_franchisor();
begin
  if not v_all then
    if p_clinic_id is null then
      -- o Gerente e o franqueado: as unidades deles
      null;
    elsif not public.has_role_in_clinic(p_clinic_id, array['unit_manager', 'franchisee']::public.user_role[]) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;
  return jsonb_build_object(
    'pode_ignorar', v_all,
    'divergencias', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.kind, 'status', i.status, 'clinica', cl.name, 'clinic_id', i.clinic_id,
                                          'cobranca', i.charge_id, 'asaas', i.asaas_payment_id, 'valor', i.amount_cents, 'detalhe', i.detail,
                                          'desde', i.first_seen_at, 'visto', i.last_seen_at, 'ignorada_em', i.ignored_at,
                                          'ignorada_por', pr.full_name, 'motivo', i.ignored_reason, 'cliente', c.client_id)
                       order by i.status, i.first_seen_at desc)
        from public.gateway_charge_issues i
        left join public.clinics cl on cl.id = i.clinic_id
        left join public.charges c on c.id = i.charge_id
        left join public.profiles pr on pr.id = i.ignored_by
       where i.status in ('aberta', 'ignorada')
         and (p_clinic_id is null or i.clinic_id = p_clinic_id)
         and (v_all or public.has_role_in_clinic(i.clinic_id, array['unit_manager', 'franchisee']::public.user_role[]))), '[]'::jsonb),
    'rodadas', case when v_all then coalesce((
      select jsonb_agg(jsonb_build_object('conta', g.label, 'tipo', x.kind, 'em', x.ran_at, 'conferidas', x.checked, 'chamadas', x.calls,
                                          'novas', x.new_issues, 'abertas', x.open_issues, 'erro', x.error) order by x.ran_at desc)
        from (select * from public.gateway_charge_recon_runs order by ran_at desc limit 20) x
        join public.gateway_accounts g on g.id = x.account_id), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.gateway_charge_issue_ignore(p_issue_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.gateway_charge_issues%rowtype;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into i from public.gateway_charge_issues where id = p_issue_id;
  if i.id is null or i.status <> 'aberta' then raise exception 'ISSUE_NOT_OPEN'; end if;
  update public.gateway_charge_issues set status = 'ignorada', ignored_at = now(), ignored_by = (select auth.uid()),
         ignored_reason = btrim(p_reason), ignored_amount_cents = i.amount_cents
   where id = p_issue_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), i.clinic_id, 'update', 'gateway_charge_issue', p_issue_id::text,
          jsonb_build_object('tipo', i.kind, 'motivo', btrim(p_reason)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) COPIAR DE OUTRA UNIDADE (Comercial e Financeiro)
-- -----------------------------------------------------------------------------
create or replace function public.central_copy_preview(p_target uuid, p_source uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if p_target is null or p_source is null or p_target = p_source then raise exception 'INVALID_UNITS'; end if;
  return jsonb_build_object(
    'origem', (select name from public.clinics where id = p_source),
    'destino', (select name from public.clinics where id = p_target),
    'comercial', jsonb_build_object(
      'regras_origem', (select to_jsonb(r) - 'id' - 'clinic_id' - 'updated_by' - 'updated_at' from public.commercial_rules r where r.clinic_id = p_source),
      'regras_destino', (select to_jsonb(r) - 'id' - 'clinic_id' - 'updated_by' - 'updated_at' from public.commercial_rules r where r.clinic_id = p_target),
      'acompanhamento_origem', (select to_jsonb(r) - 'id' - 'clinic_id' - 'updated_by' - 'updated_at' from public.commercial_followup_settings r where r.clinic_id = p_source),
      'acompanhamento_destino', (select to_jsonb(r) - 'id' - 'clinic_id' - 'updated_by' - 'updated_at' from public.commercial_followup_settings r where r.clinic_id = p_target)),
    'financeiro', jsonb_build_object(
      'origem', (select to_jsonb(f) - 'id' - 'clinic_id' - 'updated_by' - 'updated_at' from public.finance_settings f where f.clinic_id = p_source),
      'destino', (select to_jsonb(f) - 'id' - 'clinic_id' - 'updated_by' - 'updated_at' from public.finance_settings f where f.clinic_id = p_target)),
    'nunca', jsonb_build_array('a conta Asaas e a chave', 'os termos', 'as marcas da prontidão', 'as taxas da franquia', 'a cobrança mensal', 'a maquininha (adquirentes e taxas)')
  );
end;
$$;

-- Copiar = o destino fica igual à origem no bloco. Origem sem valor próprio
-- (usa o padrão da rede) = o destino volta ao padrão da rede.
create or replace function public.central_copy_apply(p_target uuid, p_source uuid, p_blocks text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done text[] := '{}';
  v_src text := (select name from public.clinics where id = p_source);
begin
  if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if p_target is null or p_source is null or p_target = p_source then raise exception 'INVALID_UNITS'; end if;
  if p_blocks is null or not (p_blocks <@ array['comercial', 'financeiro']) or cardinality(p_blocks) = 0 then raise exception 'INVALID_BLOCKS'; end if;
  if not exists (select 1 from public.clinics where id = p_target and type = 'franchise_unit')
     or not exists (select 1 from public.clinics where id = p_source and type = 'franchise_unit') then
    raise exception 'INVALID_UNITS';
  end if;

  if 'comercial' = any (p_blocks) then
    delete from public.commercial_rules where clinic_id = p_target;
    insert into public.commercial_rules (clinic_id, max_discount_percent, max_installments, allowed_methods, updated_by, updated_at,
                                         cash_discount_percent, min_installment_cents_by_method, cancellation_penalty_percent,
                                         min_margin_percent, budget_validity_days)
    select p_target, max_discount_percent, max_installments, allowed_methods, (select auth.uid()), now(),
           cash_discount_percent, min_installment_cents_by_method, cancellation_penalty_percent, min_margin_percent, budget_validity_days
      from public.commercial_rules where clinic_id = p_source;
    delete from public.commercial_followup_settings where clinic_id = p_target;
    insert into public.commercial_followup_settings (clinic_id, max_attempts, interval_days, max_days, updated_by, updated_at)
    select p_target, max_attempts, interval_days, max_days, (select auth.uid()), now()
      from public.commercial_followup_settings where clinic_id = p_source;
    v_done := v_done || 'comercial'::text;
  end if;

  if 'financeiro' = any (p_blocks) then
    delete from public.finance_settings where clinic_id = p_target;
    insert into public.finance_settings (clinic_id, late_fee_percent, monthly_interest_percent, grace_days, rounding_mode, updated_at, updated_by,
                                         alerts_enabled, alert_budget_percent, alert_cash_days, alert_breakeven_days, alert_overdue_cents,
                                         alert_overdue_percent, overdue_reissue_max_days, gateway_rounding_tolerance_cents,
                                         overdue_badge_business_days, distrato_overdue_days)
    select p_target, late_fee_percent, monthly_interest_percent, grace_days, rounding_mode, now(), (select auth.uid()),
           alerts_enabled, alert_budget_percent, alert_cash_days, alert_breakeven_days, alert_overdue_cents,
           alert_overdue_percent, overdue_reissue_max_days, gateway_rounding_tolerance_cents,
           overdue_badge_business_days, distrato_overdue_days
      from public.finance_settings where clinic_id = p_source;
    v_done := v_done || 'financeiro'::text;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), p_target, 'update', 'central_copy', p_target::text,
          jsonb_build_object('copiado_de', v_src, 'origem_id', p_source, 'blocos', to_jsonb(v_done)));
  return jsonb_build_object('blocos', to_jsonb(v_done), 'origem', v_src);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10) PERMISSÕES
-- -----------------------------------------------------------------------------
revoke execute on function public.gateway_asaas_migrations() from public, anon, authenticated;
revoke execute on function public._gateway_cap_effective_roles(text) from public, anon, authenticated;
revoke execute on function public._gateway_network_readiness() from public, anon, authenticated;
revoke execute on function public.gateway_production_read() from public, anon, authenticated;
revoke execute on function public.gateway_asaas_confirmation_save(text, text) from public, anon, authenticated;
revoke execute on function public.gateway_production_switch(boolean, text) from public, anon, authenticated;
revoke execute on function public._central_readiness_raw(uuid) from public, anon, authenticated;
revoke execute on function public.gateway_declare_debit_disabled(uuid) from public, anon, authenticated;
revoke execute on function public.gateway_declare_key_permissions(uuid) from public, anon, authenticated;
revoke execute on function public._gateway_key_probe_save(uuid, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public._gateway_survey_save(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.gateway_surveys_read(uuid) from public, anon, authenticated;
revoke execute on function public._gateway_charge_recon_save(uuid, text, jsonb, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.gateway_charge_issues_read(uuid) from public, anon, authenticated;
revoke execute on function public.gateway_charge_issue_ignore(uuid, text) from public, anon, authenticated;
revoke execute on function public.central_copy_preview(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.central_copy_apply(uuid, uuid, text[]) from public, anon, authenticated;

grant execute on function public.gateway_production_read() to authenticated;
grant execute on function public.gateway_asaas_confirmation_save(text, text) to authenticated;
grant execute on function public.gateway_production_switch(boolean, text) to authenticated;
grant execute on function public.gateway_declare_debit_disabled(uuid) to authenticated;
grant execute on function public.gateway_declare_key_permissions(uuid) to authenticated;
grant execute on function public.gateway_surveys_read(uuid) to authenticated;
grant execute on function public.gateway_charge_issues_read(uuid) to authenticated;
grant execute on function public.gateway_charge_issue_ignore(uuid, text) to authenticated;
grant execute on function public.central_copy_preview(uuid, uuid) to authenticated;
grant execute on function public.central_copy_apply(uuid, uuid, text[]) to authenticated;

select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('gateway_account_surveys', 'gateway_charge_issues', 'gateway_charge_recon_runs')) as tabelas_novas,
  (select production_enabled from public.gateway_settings where id) as producao_ligada,
  (select count(*) from public.gateway_asaas_migrations() where not applied) as migracoes_faltando,
  (select count(*) from public._central_readiness_raw(null)) as itens_da_prontidao;
