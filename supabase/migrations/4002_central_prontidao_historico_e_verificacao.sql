-- =============================================================================
-- 4002 — CENTRAL DE CONFIGURAÇÃO — FASE ASA0: prontidão, histórico e verificação
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 10/11/2026: docs/integracao-asaas.md (versão 3,
-- seção 9.1).
--
--   * PRONTIDÃO DA UNIDADE — `central_readiness(unidade)` devolve o que falta.
--     "Pronta para cobrar" exige a lista completa E a marcação do Admin Master
--     (`central_unit_readiness`). A marcação CAI SOZINHA quando um item volta
--     a faltar (`_central_drop_mark_if_unready`).
--     Itens da ASA0: conta validada, walletId, webhook ativo, tarifas, chave
--     Pix, split habilitado (declarado), termo de autorização registrado e
--     antecipação automática desligada. As fases seguintes acrescentam os
--     delas DENTRO de `_central_readiness_raw`.
--   * HISTÓRICO POR ABA — `central_history(aba, unidade)`: janela sobre a
--     trilha de auditoria que já existe (`audit_changes`, 0288), filtrada
--     pelas tabelas de cada aba.
--   * VERIFICAÇÃO SEMANAL — `_gateway_record_check`: o servidor consulta o
--     Asaas uma vez por semana (valida a chave, atualiza a situação e as
--     tarifas, e evita a desativação da chave por 3 meses sem uso). Falha
--     derruba a prontidão e avisa o Admin Master.
--   * PERMISSÕES — `modulo.central` e `acao.central.vincular_conta` nascem SEM
--     papel nenhum: só o Admin Master enxerga a Central até o dono liberar em
--     Administração → Permissões.
--
-- Idempotente. Não altera tabela existente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A MARCAÇÃO "PRONTA PARA COBRAR"
-- -----------------------------------------------------------------------------
create table if not exists public.central_unit_readiness (
  clinic_id uuid primary key references public.clinics (id),
  marked_ready_at timestamptz,
  marked_ready_by uuid references public.profiles (id),
  -- Quando a marcação caiu sozinha, e por quê (o item que voltou a faltar).
  unmarked_at timestamptz,
  unmarked_reason text,
  updated_at timestamptz not null default now()
);

alter table public.central_unit_readiness enable row level security;

drop policy if exists "central_unit_readiness_select" on public.central_unit_readiness;
create policy "central_unit_readiness_select" on public.central_unit_readiness
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
  );

-- -----------------------------------------------------------------------------
-- 2) A LISTA DO QUE FALTA
-- -----------------------------------------------------------------------------
-- A conta que vale para a unidade: a de produção quando o interruptor estiver
-- ligado e ela existir; senão, a de teste.
create or replace function public._gateway_account_of(p_clinic_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
    from public.gateway_accounts a
   where a.clinic_id = p_clinic_id
     and a.status <> 'disabled'
   order by
     (a.environment = 'production'
      and coalesce((select s.production_enabled from public.gateway_settings s limit 1), false)) desc,
     a.created_at desc
   limit 1;
$$;

revoke execute on function public._gateway_account_of(uuid) from public, anon, authenticated;

-- A conta por baixo da porta: sem guarda (rotinas e gatilhos chamam).
-- Cada fase acrescenta os seus itens AQUI, mantendo as colunas do retorno.
create or replace function public._central_readiness_raw(p_clinic_id uuid)
returns table (item text, ok boolean, sort_order integer)
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
         coalesce(v_has_account and v_acc.webhook_id is not null and v_acc.webhook_token_secret_id is not null, false),
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
  -- A conta raiz é da própria franqueadora: não há termo de franqueado.
  select 'termo_registrado',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor'
                                     or v_acc.term_registered_at is not null), false),
         70
  union all
  select 'antecipacao_desligada',
         coalesce(v_has_account and v_acc.anticipation_auto_enabled is false, false),
         80;
end;
$$;

revoke execute on function public._central_readiness_raw(uuid) from public, anon, authenticated;

-- Quem pode ver a Central desta unidade.
create or replace function public.central_can_see(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or (p_clinic_id is not null
          and public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[]));
$$;

revoke execute on function public.central_can_see(uuid) from public, anon, authenticated;
grant execute on function public.central_can_see(uuid) to authenticated;

-- A porta da tela.
create or replace function public.central_readiness(p_clinic_id uuid)
returns table (item text, ok boolean, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.central_can_see(p_clinic_id) then
    return;
  end if;
  return query select r.item, r.ok, r.sort_order from public._central_readiness_raw(p_clinic_id) r order by r.sort_order;
end;
$$;

revoke execute on function public.central_readiness(uuid) from public, anon, authenticated;
grant execute on function public.central_readiness(uuid) to authenticated;

-- A PERGUNTA QUE TODA EMISSÃO FAZ (ASA1 em diante): a unidade está pronta?
-- Lista completa E marcada pelo Admin Master.
create or replace function public.central_is_ready(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.central_unit_readiness u
            where u.clinic_id = p_clinic_id and u.marked_ready_at is not null
         )
     and not exists (
           select 1 from public._central_readiness_raw(p_clinic_id) r where not r.ok
         );
$$;

revoke execute on function public.central_is_ready(uuid) from public, anon, authenticated;
grant execute on function public.central_is_ready(uuid) to authenticated;

-- Derruba a marcação quando algum item voltou a faltar. Devolve verdadeiro se
-- derrubou.
create or replace function public._central_drop_mark_if_unready(p_clinic_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text;
begin
  if p_clinic_id is null then return false; end if;

  select string_agg(r.item, ', ' order by r.sort_order) into v_missing
    from public._central_readiness_raw(p_clinic_id) r
   where not r.ok;
  if v_missing is null then return false; end if;

  update public.central_unit_readiness u
     set marked_ready_at = null,
         marked_ready_by = null,
         unmarked_at = now(),
         unmarked_reason = v_missing,
         updated_at = now()
   where u.clinic_id = p_clinic_id and u.marked_ready_at is not null;
  return found;
end;
$$;

revoke execute on function public._central_drop_mark_if_unready(uuid) from public, anon, authenticated;

-- O Admin Master marca (ou desmarca) a unidade como pronta.
create or replace function public.central_mark_ready(p_clinic_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'CLINIC_NOT_FOUND';
  end if;

  if coalesce(p_ready, false) then
    if exists (select 1 from public._central_readiness_raw(p_clinic_id) r where not r.ok) then
      raise exception 'NOT_READY';
    end if;
    insert into public.central_unit_readiness (clinic_id, marked_ready_at, marked_ready_by)
    values (p_clinic_id, now(), v_user)
    on conflict (clinic_id) do update
      set marked_ready_at = now(), marked_ready_by = v_user,
          unmarked_at = null, unmarked_reason = null, updated_at = now();
  else
    update public.central_unit_readiness u
       set marked_ready_at = null, marked_ready_by = null,
           unmarked_at = now(), unmarked_reason = 'Desmarcada pelo Admin Master', updated_at = now()
     where u.clinic_id = p_clinic_id;
  end if;
end;
$$;

revoke execute on function public.central_mark_ready(uuid, boolean) from public, anon, authenticated;
grant execute on function public.central_mark_ready(uuid, boolean) to authenticated;

-- Conta que mudou pode ter derrubado um item: confere a marcação da unidade.
create or replace function public.gateway_accounts_refresh_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public._central_drop_mark_if_unready(new.clinic_id);
  exception when others then
    raise warning 'gateway_accounts_refresh_mark: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.gateway_accounts_refresh_mark() from public, anon, authenticated;

drop trigger if exists gateway_accounts_refresh_mark on public.gateway_accounts;
-- Só nas colunas que a lista de prontidão lê: a leitura da chave atualiza
-- `api_key_last_used_at` a cada chamada, e não precisa refazer a conta.
create trigger gateway_accounts_refresh_mark
  after update of status, last_check_ok, wallet_id, webhook_id, webhook_token_secret_id,
    pix_key_active, split_enabled_declared_at, split_enabled_confirmed_at,
    term_registered_at, anticipation_auto_enabled
  on public.gateway_accounts
  for each row execute function public.gateway_accounts_refresh_mark();

-- -----------------------------------------------------------------------------
-- 3) A VERIFICAÇÃO DA CONTA (na vinculação e toda semana) — só o servidor
-- -----------------------------------------------------------------------------
-- Dedupe dos avisos: um por conta, assunto e fato.
create table if not exists public.gateway_notices (
  account_id uuid not null references public.gateway_accounts (id),
  kind text not null,
  key text not null default '',
  sent_at timestamptz not null default now(),
  primary key (account_id, kind, key)
);
alter table public.gateway_notices enable row level security;

-- Avisa os Admin Master, uma vez por (conta, assunto, fato). Sem dado pessoal.
create or replace function public._gateway_notify_admins(
  p_account_id uuid,
  p_kind text,
  p_key text,
  p_title text,
  p_body text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_new boolean;
  v_n integer := 0;
begin
  select a.clinic_id into v_clinic from public.gateway_accounts a where a.id = p_account_id;

  insert into public.gateway_notices (account_id, kind, key)
  values (p_account_id, p_kind, coalesce(p_key, ''))
  on conflict (account_id, kind, key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then return 0; end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select p.id, v_clinic, p_title, p_body,
         case when v_clinic is null then '/central/rede/conta'
              else '/central/unidades/' || v_clinic::text || '/conta' end
    from public.profiles p
   where p.is_admin_master and p.is_active;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public._gateway_notify_admins(uuid, text, text, text, text) from public, anon, authenticated;

-- Grava o resultado da verificação. `p_ok` falso = a chave foi recusada ou o
-- Asaas não respondeu como esperado: a prontidão cai e o Admin Master é
-- avisado (uma vez por falha — a próxima verificação boa "rearma" o aviso).
create or replace function public._gateway_record_check(
  p_account_id uuid,
  p_ok boolean,
  p_error text default null,
  p_account_status jsonb default null,
  p_commercial_info_expires_on date default null,
  p_pix_key_active boolean default null,
  p_anticipation_auto_enabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
begin
  select * into v_acc from public.gateway_accounts a where a.id = p_account_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.status = 'disabled' then return; end if;

  if coalesce(p_ok, false) then
    update public.gateway_accounts a
       set last_check_at = now(),
           last_check_ok = true,
           last_check_error = null,
           status = 'active',
           account_status = coalesce(p_account_status, a.account_status),
           commercial_info_expires_on = coalesce(p_commercial_info_expires_on, a.commercial_info_expires_on),
           pix_key_active = coalesce(p_pix_key_active, a.pix_key_active),
           pix_key_checked_at = case when p_pix_key_active is null then a.pix_key_checked_at else now() end,
           anticipation_auto_enabled = coalesce(p_anticipation_auto_enabled, a.anticipation_auto_enabled),
           anticipation_checked_at = case when p_anticipation_auto_enabled is null then a.anticipation_checked_at else now() end
     where a.id = p_account_id;

    -- Verificação boa rearma o aviso de falha.
    delete from public.gateway_notices n
     where n.account_id = p_account_id and n.kind = 'check_failed';

    if p_anticipation_auto_enabled is true then
      perform public._gateway_notify_admins(
        p_account_id, 'anticipation_on', public.today_br()::text,
        'Asaas: antecipação automática ligada',
        'A conta "' || v_acc.label || '" está com a antecipação automática ligada. '
          || 'Ela reduz o repasse do split; desligue no painel do Asaas.');
    end if;
  else
    update public.gateway_accounts a
       set last_check_at = now(),
           last_check_ok = false,
           last_check_error = left(coalesce(p_error, 'unknown'), 120),
           status = 'error'
     where a.id = p_account_id;

    perform public._gateway_notify_admins(
      p_account_id, 'check_failed', '',
      'Asaas: a verificação da conta falhou',
      'A conta "' || v_acc.label || '" não passou na verificação ('
        || left(coalesce(p_error, 'unknown'), 60)
        || '). A unidade deixou de estar pronta para cobrar até a conta ser conferida.');
  end if;
  -- A marcação "pronta" é conferida pelo gatilho da própria tabela.
end;
$$;

revoke execute on function public._gateway_record_check(uuid, boolean, text, jsonb, date, boolean, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) O HISTÓRICO POR ABA
-- -----------------------------------------------------------------------------
-- `audit_changes` é só do Admin Master. Esta janela devolve apenas as linhas
-- das tabelas da aba pedida — e só a quem enxerga a Central daquela unidade.
-- `p_clinic_id` nulo = nível Rede (só Admin Master e Financeiro da Franqueadora).
--   'conta' → gateway_accounts, central_unit_readiness, o adquirente "Asaas"
--             e as tarifas dele
-- Cada fase acrescenta a sua aba aqui.
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
  if p_tab <> 'conta' then
    raise exception 'TAB_UNKNOWN';
  end if;

  if p_clinic_id is null then
    if not (public.is_admin_master() or public.is_finance_franchisor()) then
      return;
    end if;
  elsif not public.central_can_see(p_clinic_id) then
    return;
  end if;

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
end;
$$;

revoke execute on function public.central_history(text, uuid) from public, anon, authenticated;
grant execute on function public.central_history(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) AS PERMISSÕES — nascem só com o Admin Master
-- -----------------------------------------------------------------------------
-- `modulo.central`              → quem abre a Central de Configuração
-- `acao.central.vincular_conta` → quem cola a chave da conta Asaas (o banco
--                                  ainda exige o termo para o Gerente)
-- Sem papel nenhum na matriz: nada a semear nela. Só o padrão fixado (0292),
-- para o selo "fora do padrão" ter referência desde o primeiro dia.
insert into public.permission_defaults (capability, roles) values
  ('modulo.central', '{}'::public.user_role[]),
  ('acao.central.vincular_conta', '{}'::public.user_role[])
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 6) AUDITORIA (0288)
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'gateway_notices', 'Dedupe dos avisos das contas Asaas (registro técnico da rotina).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'central\_%' or p.proname like '\_central\_%')) as funcoes_da_central,
  (select count(*) from pg_trigger where tgname = 'gateway_accounts_refresh_mark') as gatilho,
  (select count(*) from public.permission_defaults where capability in ('modulo.central', 'acao.central.vincular_conta')) as permissoes,
  (select count(*) from public.central_unit_readiness where marked_ready_at is not null) as unidades_prontas;
