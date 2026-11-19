-- =============================================================================
-- 4023 — ASA5: O RISARTE EMPRESARIAL PELO ASAAS (docs/integracao-asaas.md seção
-- 22; plano e decisões aprovados pelo dono em 18/11/2026)
-- -----------------------------------------------------------------------------
--   * A MENSALIDADE (`corporate_monthly`) sai pela CONTA RAIZ da franqueadora,
--     com split PERCENTUAL para a carteira da RisLife (o Asaas aplica sobre o
--     LÍQUIDO: decisão 2b). A baixa pelo aviso liga `split_at_source` e grava
--     o que a RisLife recebeu DE FATO; a tarifa do Asaas vira despesa da
--     franqueadora (2.4.02).
--   * A IMPLANTAÇÃO (`corporate_implementation`) é FATURADA PELA RISLIFE: sai na
--     CONTA ASAAS DA RISLIFE (conta `recipient` operada pelo riSZon), sem split,
--     100% dela (decisão 1). Fica fora do razão da franqueadora, como sempre.
--   * O PAGADOR (decisões 4 e 12): o documento da linha (CNPJ/CPF); CAEPF, CNO
--     ou NIF → o CNPJ da matriz, senão o CPF do responsável; a cobrança à parte
--     dos dependentes (1049) → quem paga (o titular ou outro), com o contato dele.
--   * LIGAR (decisão 7b): a rede inteira, com data de início. Toda cobrança
--     GERADA desde a data sai no Asaas; as abertas de antes ganham "Emitir no
--     Asaas" (o mesmo caminho, à mão).
--   * AS TRAVAS: com cobrança viva no Asaas, a linha do Empresarial não muda de
--     valor, vencimento ou pagador, não é baixada à mão, cancelada nem excluída
--     (o servidor cancela no Asaas antes). Paga pelo Asaas, só o estorno pelo
--     Asaas desfaz a baixa.
--   * O ATRASO (decisão 5c): a rotina do Empresarial continua; o aviso do Asaas
--     só marca a cobrança vencida; a divergência entre os dois aparece na Central.
--   * O RELATÓRIO DO MÊS (decisão 6): a foto do "Relatório detalhado" guardada na
--     emissão da mensalidade, aberta por código (link na cobrança).
--   * O LEGADO (decisão 11b): a tabela `empresarial.asaas_webhook_events` e a
--     coluna `adhesion_billing.asaas_billing_id` saem — só se vazias.
--   * A IMPLANTAÇÃO É 100% RISLIFE (decisão 9b): as exceções de split não mudam
--     mais a implantação.
--
-- Nada é chamado no Asaas pelo banco. Não altera `settle_billing` nem
-- `_settle_billing_raw` (só os chama). Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) O LEGADO VAZIO? (antes de tudo: se tiver dado, nada roda)
-- -----------------------------------------------------------------------------
do $$
declare v_tem boolean;
begin
  -- Dinâmico: na segunda vez, a tabela e a coluna já não existem.
  if to_regclass('empresarial.asaas_webhook_events') is not null then
    execute 'select exists (select 1 from empresarial.asaas_webhook_events)' into v_tem;
    if v_tem then
      raise exception 'LEGACY_NOT_EMPTY: empresarial.asaas_webhook_events tem linhas. Nada foi feito; avise a sessão do Asaas.';
    end if;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'empresarial' and table_name = 'adhesion_billing' and column_name = 'asaas_billing_id') then
    execute 'select exists (select 1 from empresarial.adhesion_billing where asaas_billing_id is not null)' into v_tem;
    if v_tem then
      raise exception 'LEGACY_NOT_EMPTY: adhesion_billing.asaas_billing_id tem valores. Nada foi feito; avise a sessão do Asaas.';
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1) AS TABELAS
-- -----------------------------------------------------------------------------
-- A configuração (uma linha): de quando a rede cobra pelo Asaas e qual é a conta
-- da RisLife (a que fatura a implantação e recebe o split da mensalidade).
create table if not exists public.corporate_gateway_settings (
  id boolean primary key default true check (id),
  enabled_from date,
  rislife_account_id uuid references public.gateway_accounts (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
alter table public.corporate_gateway_settings enable row level security;
insert into public.corporate_gateway_settings (id) values (true) on conflict (id) do nothing;

-- O que a cobrança do Empresarial guarda da emissão (para a baixa usar o que
-- valia na hora, e não a regra de hoje).
create table if not exists public.corporate_charges (
  charge_id uuid primary key references public.charges (id),
  billing_id uuid not null,
  company_id uuid not null,
  kind text not null check (kind in ('implantacao', 'mensalidade')),
  rislife_pct numeric check (rislife_pct is null or (rislife_pct >= 0 and rislife_pct < 100)),
  rislife_wallet_id text,
  rislife_account_id uuid references public.gateway_accounts (id),
  rislife_cents bigint,
  payer_document text not null check (payer_document ~ '^([0-9]{11}|[0-9]{14})$'),
  payer_name text not null,
  payer_email text,
  payer_phone text,
  payer_source text not null check (payer_source in ('documento', 'matriz', 'responsavel', 'dependentes')),
  report_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists corporate_charges_billing on public.corporate_charges (billing_id);
alter table public.corporate_charges enable row level security;

-- A foto do "Relatório detalhado" do mês (decisão 6), aberta por código.
create table if not exists public.corporate_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  billing_id uuid not null unique,
  company_id uuid not null,
  reference_month date,
  code text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  data jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.corporate_monthly_reports enable row level security;

-- O contato do "outro pagador" dos dependentes (decisão 12a). O CHECK aceita
-- NULL; por isso o coalesce (o mesmo cuidado da 1049).
alter table empresarial.employees add column if not exists dependents_payer_email text;
alter table empresarial.employees add column if not exists dependents_payer_phone text;
alter table empresarial.employees drop constraint if exists employees_dependents_payer_contact_check;
alter table empresarial.employees add constraint employees_dependents_payer_contact_check check (
  coalesce(dependents_payer, '') <> 'OUTRO'
  or coalesce(nullif(btrim(coalesce(dependents_payer_email, '')), ''), nullif(btrim(coalesce(dependents_payer_phone, '')), '')) is not null
) not valid;
comment on column empresarial.employees.dependents_payer_email is
  '4023 (ASA5, decisão 12a): o e-mail do outro pagador dos dependentes (os avisos do Asaas). Com OUTRO, e-mail ou celular é obrigatório.';

-- A implantação é 100% RisLife (decisão 9b). As exceções que diziam outra coisa
-- passam a 100 (registrado na auditoria) e a regra trava.
insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
select null, null, 'update', 'empresarial_split_rule', r.id::text,
       jsonb_build_object('4023', 'implantação 100% RisLife', 'antes_rislife', r.first_payment_rislife_pct, 'antes_risarte', r.first_payment_risarte_pct)
  from empresarial.split_rules r
 where r.first_payment_rislife_pct <> 100 or r.first_payment_risarte_pct <> 0;
update empresarial.split_rules set first_payment_rislife_pct = 100, first_payment_risarte_pct = 0
 where first_payment_rislife_pct <> 100 or first_payment_risarte_pct <> 0;
alter table empresarial.split_rules drop constraint if exists split_rules_implantacao_rislife_check;
alter table empresarial.split_rules add constraint split_rules_implantacao_rislife_check
  check (first_payment_rislife_pct = 100 and first_payment_risarte_pct = 0);

-- -----------------------------------------------------------------------------
-- 2) QUEM FAZ
-- -----------------------------------------------------------------------------
-- As cobranças do Empresarial: o gestor do programa, o Financeiro da Franqueadora
-- e o Admin Master (os mesmos de `settle_billing`).
create or replace function public._corporate_can_manage()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_master() or empresarial.is_program_finance();
$$;

-- Ligar e escolher a conta da RisLife: o Admin Master e o Financeiro da Franqueadora.
create or replace function public._corporate_can_configure()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_master() or public.is_finance_franchisor();
$$;

-- -----------------------------------------------------------------------------
-- 3) AS CONTAS
-- -----------------------------------------------------------------------------
-- A conta da RisLife pronta para faturar: ativa, com chave, carteira e webhook.
create or replace function public._corporate_rislife_account()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.corporate_gateway_settings s
    join public.gateway_accounts a on a.id = s.rislife_account_id
   where s.id and a.owner_type = 'recipient' and a.status = 'active'
     and a.api_key_secret_id is not null and a.wallet_id is not null and a.webhook_id is not null;
$$;

-- -----------------------------------------------------------------------------
-- 4) O PAGADOR DE UMA LINHA DO EMPRESARIAL
-- -----------------------------------------------------------------------------
create or replace function public._corporate_payer_of(p_billing_id uuid)
returns table (doc text, name text, email text, phone text, source text, note text)
language plpgsql stable security definer set search_path = '' as $$
declare
  b empresarial.adhesion_billing%rowtype;
  co empresarial.companies%rowtype;
  d empresarial.company_documents%rowtype;
  m empresarial.company_documents%rowtype;
  e empresarial.employees%rowtype;
  v_resp text;
begin
  select * into b from empresarial.adhesion_billing where id = p_billing_id;
  if b.id is null then return; end if;
  select * into co from empresarial.companies where id = b.company_id;
  v_resp := public.cpf_digits(co.responsible_cpf);

  -- A cobrança à parte dos dependentes (1049): quem paga, com o contato dele.
  if b.employee_id is not null then
    select * into e from empresarial.employees where id = b.employee_id;
    return query select public.cpf_digits(b.payer_document), b.payer_name,
      case when e.dependents_payer = 'OUTRO' then nullif(btrim(coalesce(e.dependents_payer_email, '')), '') else nullif(btrim(coalesce(e.email, '')), '') end,
      case when e.dependents_payer = 'OUTRO' then nullif(btrim(coalesce(e.dependents_payer_phone, '')), '') else nullif(btrim(coalesce(e.phone, '')), '') end,
      'dependentes'::text, null::text;
    return;
  end if;

  select * into d from empresarial.company_documents where id = b.company_document_id;
  if d.id is null then
    select * into d from empresarial.company_documents where company_id = b.company_id and is_primary limit 1;
  end if;
  if d.id is null or d.doc_type in ('CNPJ', 'CPF') then
    return query select public.cpf_digits(coalesce(d.doc_number, co.cnpj)), co.legal_name::text,
      nullif(btrim(coalesce(co.responsible_email, '')), ''), nullif(btrim(coalesce(co.responsible_phone, '')), ''),
      'documento'::text, null::text;
    return;
  end if;

  -- CAEPF, CNO ou NIF (decisão 4): o CNPJ da matriz, senão o CPF do responsável.
  select * into m from empresarial.company_documents
   where company_id = b.company_id and is_primary and doc_type = 'CNPJ' limit 1;
  if m.id is not null then
    return query select public.cpf_digits(m.doc_number), co.legal_name::text,
      nullif(btrim(coalesce(co.responsible_email, '')), ''), nullif(btrim(coalesce(co.responsible_phone, '')), ''),
      'matriz'::text, ('referente ao ' || d.doc_type || ' ' || d.doc_formatted)::text;
  elsif v_resp is not null and public._cpf_ok(v_resp) then
    return query select v_resp, coalesce(nullif(btrim(coalesce(co.responsible_name, '')), ''), co.legal_name)::text,
      nullif(btrim(coalesce(co.responsible_email, '')), ''), nullif(btrim(coalesce(co.responsible_phone, '')), ''),
      'responsavel'::text, ('referente ao ' || d.doc_type || ' ' || d.doc_formatted || ' — ' || co.legal_name)::text;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) A EMISSÃO
-- -----------------------------------------------------------------------------
-- Prepara a cobrança no riSZon ("emitindo"); o servidor chama o Asaas depois.
-- p_manual = o botão "Emitir no Asaas" (a linha gerada antes da data de início).
-- Nunca levanta erro por regra de negócio: devolve o motivo, para a geração da
-- cobrança no Empresarial nunca falhar por causa do Asaas.
create or replace function public.corporate_charge_prepare(p_billing_id uuid, p_manual boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.corporate_gateway_settings%rowtype;
  b empresarial.adhesion_billing%rowtype;
  py record;
  v_kind text;
  v_account uuid;
  v_rislife uuid;
  v_root uuid;
  v_env_root text;
  v_env_rl text;
  v_wallet text;
  v_pct numeric;
  v_hq uuid;
  v_due date;
  v_charge uuid;
  v_desc text;
begin
  select * into b from empresarial.adhesion_billing where id = p_billing_id for update;
  -- Quem cobra no Empresarial; e, na implantação que nasceu no funil (decisão 8),
  -- também quem atende o lead.
  if not (public._corporate_can_manage()
          or (b.origin_lead_id is not null and b.billing_type = 'IMPLANTATION' and empresarial.can_access_lead(b.origin_lead_id))) then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into s from public.corporate_gateway_settings where id;
  if s.enabled_from is null or s.enabled_from > public.today_br() then
    return jsonb_build_object('motivo', 'desligado');
  end if;
  if b.id is null then return jsonb_build_object('motivo', 'nao_encontrada'); end if;
  if b.status not in ('PENDING', 'OVERDUE') then return jsonb_build_object('motivo', 'nao_esta_em_aberto'); end if;
  if not p_manual and (b.created_at at time zone 'America/Sao_Paulo')::date < s.enabled_from then
    return jsonb_build_object('motivo', 'gerada_antes_da_data');
  end if;
  select ch.id into v_charge from public.charges ch
   where ch.source_type in ('corporate_implementation', 'corporate_monthly') and ch.source_id = b.id
     and ch.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'paga', 'liquidada', 'em_contestacao')
   order by ch.created_at desc limit 1;
  if v_charge is not null then return jsonb_build_object('motivo', 'ja_tem_cobranca', 'charge_id', v_charge); end if;
  if b.total_amount_cents < 500 then return jsonb_build_object('motivo', 'abaixo_do_minimo'); end if;

  select * into py from public._corporate_payer_of(b.id);
  if py.doc is null or py.doc !~ '^([0-9]{11}|[0-9]{14})$' or (length(py.doc) = 11 and not public._cpf_ok(py.doc)) then
    return jsonb_build_object('motivo', 'sem_documento_aceito');
  end if;
  if py.email is null and py.phone is null then
    return jsonb_build_object('motivo', 'sem_contato');
  end if;

  v_root := public._franchise_root_account();
  v_rislife := public._corporate_rislife_account();
  if v_rislife is null then return jsonb_build_object('motivo', 'sem_conta_da_rislife'); end if;
  select environment, wallet_id into v_env_rl, v_wallet from public.gateway_accounts where id = v_rislife;

  if b.billing_type = 'IMPLANTATION' then
    v_kind := 'implantacao';
    v_account := v_rislife;
    v_pct := null;
  else
    v_kind := 'mensalidade';
    if v_root is null then return jsonb_build_object('motivo', 'sem_conta_raiz'); end if;
    select environment into v_env_root from public.gateway_accounts where id = v_root;
    if v_env_root is distinct from v_env_rl then return jsonb_build_object('motivo', 'contas_em_ambientes_diferentes'); end if;
    v_account := v_root;
    select r.recurring_rislife_pct into v_pct from empresarial.split_rules r
     where r.company_id = b.company_id or r.company_id is null
     order by (r.company_id = b.company_id) desc nulls last limit 1;
    v_pct := coalesce(v_pct, 50);
    if v_pct >= 100 then return jsonb_build_object('motivo', 'split_invalido'); end if;
    if v_pct <= 0 then v_pct := null; v_wallet := null; end if;
  end if;

  v_hq := public._franchise_hq();
  v_due := greatest(coalesce(b.due_date, public.today_br()), public.today_br());
  v_desc := left(coalesce(nullif(btrim(coalesce(b.description, '')), ''),
                          case when v_kind = 'implantacao' then 'Implantação — Risarte Empresarial' else 'Mensalidade — Risarte Empresarial' end)
                 || coalesce(' (' || py.note || ')', ''), 400);

  insert into public.charges (clinic_id, gateway_account_id, source_type, source_id, payer_kind, billing_type,
    value_cents, discount_cents, fine_percent, fine_cents, interest_percent, due_date, description, status, created_by)
  values (v_hq, v_account, case when v_kind = 'implantacao' then 'corporate_implementation' else 'corporate_monthly' end,
    b.id, 'company', 'BOLETO', b.total_amount_cents, 0, 0, 0, 0, v_due, v_desc, 'emitindo', (select auth.uid()))
  returning id into v_charge;

  insert into public.corporate_charges (charge_id, billing_id, company_id, kind, rislife_pct, rislife_wallet_id, rislife_account_id,
    payer_document, payer_name, payer_email, payer_phone, payer_source)
  values (v_charge, b.id, b.company_id, v_kind, v_pct, case when v_pct is not null then v_wallet end, v_rislife,
    py.doc, left(py.name, 200), py.email, py.phone, py.source);

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), null, 'create', 'corporate_charge', v_charge::text,
          jsonb_build_object('billing_id', b.id, 'kind', v_kind, 'manual', p_manual, 'payer_source', py.source));
  return jsonb_build_object('charge_id', v_charge, 'kind', v_kind);
end;
$$;

-- Decisão 8: com o Asaas ligado, a implantação do funil é EMITIDA pelo Asaas (e
-- não mais registrada como paga por fora). Cria a linha de implantação em aberto,
-- ligada ao lead; o servidor emite na conta da RisLife em seguida. Uma por lead.
create or replace function public.corporate_lead_implantation_issue(p_lead_id uuid, p_value_cents bigint, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.corporate_gateway_settings%rowtype;
  v_lead record;
  v_doc uuid;
  v_holders integer;
  v_id uuid;
begin
  if not (public.is_admin_master() or empresarial.can_access_lead(p_lead_id)) then raise exception 'NOT_ALLOWED'; end if;
  select * into s from public.corporate_gateway_settings where id;
  if s.enabled_from is null or s.enabled_from > public.today_br() then raise exception 'ASAAS_OFF'; end if;
  select id, company_id, implantation_paid_at into v_lead from empresarial.commercial_leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_lead.company_id is null then raise exception 'NO_COMPANY'; end if;
  if v_lead.implantation_paid_at is not null then raise exception 'ALREADY_PAID'; end if;
  if coalesce(p_value_cents, 0) < 500 then raise exception 'VALUE_BELOW_MIN'; end if;
  if p_due is null or p_due < public.today_br() then raise exception 'DUE_DATE_INVALID'; end if;
  select id into v_id from empresarial.adhesion_billing
   where origin_lead_id = p_lead_id and billing_type = 'IMPLANTATION' and status <> 'CANCELLED' limit 1;
  if v_id is not null then return v_id; end if;
  select id into v_doc from empresarial.company_documents where company_id = v_lead.company_id and is_primary limit 1;
  select contracted_holders into v_holders from empresarial.companies where id = v_lead.company_id;
  insert into empresarial.adhesion_billing
    (company_id, company_document_id, billing_type, reference_month, total_amount_cents, status, due_date,
     description, holders_covered, origin_lead_id)
  values (v_lead.company_id, v_doc, 'IMPLANTATION', date_trunc('month', p_due)::date, p_value_cents, 'PENDING', p_due,
     'Implantação (1º pagamento) — emitida pelo funil', v_holders, p_lead_id)
  returning id into v_id;
  insert into empresarial.commercial_lead_activities (lead_id, author_id, kind, note)
  values (p_lead_id, (select auth.uid()), 'NOTE', '1º pagamento (implantação): cobrança gerada para emitir pelo Asaas (conta da RisLife).');
  return v_id;
end;
$$;

-- Tentar de novo a emissão que deu erro.
create or replace function public.corporate_charge_retry(p_charge_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public._corporate_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  update public.charges set status = 'emitindo', error_code = null
   where id = p_charge_id and status = 'erro_emissao' and source_type in ('corporate_implementation', 'corporate_monthly');
  if not found then raise exception 'CHARGE_NOT_RETRYABLE'; end if;
  return p_charge_id;
end;
$$;

-- O pagador para o servidor (cria ou acha no Asaas).
create or replace function public._corporate_payer(p_charge_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('billing_id', cc.billing_id, 'company_id', cc.company_id, 'name', cc.payer_name,
           'doc', cc.payer_document, 'email', cc.payer_email, 'phone', cc.payer_phone,
           'asaas_customer_id', gc.asaas_customer_id)
    from public.corporate_charges cc
    join public.charges ch on ch.id = cc.charge_id
    left join public.gateway_customers gc on gc.gateway_account_id = ch.gateway_account_id and gc.cpf_cnpj = cc.payer_document
   where cc.charge_id = p_charge_id;
$$;

create or replace function public._corporate_payer_save(p_charge_id uuid, p_asaas_customer_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; cc public.corporate_charges%rowtype; v_acc uuid;
begin
  select * into cc from public.corporate_charges where charge_id = p_charge_id;
  if cc.charge_id is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  select gateway_account_id into v_acc from public.charges where id = p_charge_id;
  insert into public.gateway_customers (gateway_account_id, cpf_cnpj, asaas_customer_id, owner_kind, company_id)
  values (v_acc, cc.payer_document, p_asaas_customer_id, 'company', cc.company_id)
  on conflict (gateway_account_id, cpf_cnpj) do update set asaas_customer_id = excluded.asaas_customer_id, synced_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- O split da mensalidade: percentual para a carteira da RisLife (o Asaas aplica
-- sobre o líquido). A implantação não tem split.
create or replace function public._corporate_split_plan(p_charge_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when cc.kind = 'mensalidade' and cc.rislife_pct is not null and cc.rislife_wallet_id is not null
    then jsonb_build_array(jsonb_build_object('walletId', cc.rislife_wallet_id, 'percentualValue', cc.rislife_pct))
    else '[]'::jsonb end
    from public.corporate_charges cc where cc.charge_id = p_charge_id;
$$;

-- A descrição ganha o link do relatório do mês (o servidor monta o endereço).
create or replace function public._corporate_charge_report(p_charge_id uuid, p_report_id uuid, p_suffix text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.corporate_charges set report_id = p_report_id where charge_id = p_charge_id;
  update public.charges set description = left(coalesce(description, '') || coalesce(p_suffix, ''), 500)
   where id = p_charge_id and status = 'emitindo';
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) O RELATÓRIO DO MÊS (decisão 6)
-- -----------------------------------------------------------------------------
create or replace function public._corporate_report_save(p_billing_id uuid, p_data jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b empresarial.adhesion_billing%rowtype; r public.corporate_monthly_reports%rowtype;
begin
  select * into b from empresarial.adhesion_billing where id = p_billing_id;
  if b.id is null then raise exception 'BILLING_NOT_FOUND'; end if;
  insert into public.corporate_monthly_reports (billing_id, company_id, reference_month, data, created_by)
  values (b.id, b.company_id, b.reference_month, p_data, p_actor)
  on conflict (billing_id) do nothing;
  select * into r from public.corporate_monthly_reports where billing_id = b.id;
  return jsonb_build_object('id', r.id, 'code', r.code);
end;
$$;

create or replace function public._corporate_report_by_code(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('data', r.data, 'reference_month', r.reference_month, 'created_at', r.created_at)
    from public.corporate_monthly_reports r
   where r.code = p_code and length(coalesce(p_code, '')) = 64;
$$;

-- -----------------------------------------------------------------------------
-- 7) A BAIXA E OS AVISOS DO ASAAS
-- -----------------------------------------------------------------------------
create or replace function public._corporate_event(p_charge_id uuid, p_event text, p_payment jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.charges%rowtype;
  cc public.corporate_charges%rowtype;
  b empresarial.adhesion_billing%rowtype;
  v_paid bigint := round(coalesce((p_payment->>'value')::numeric, 0) * 100);
  v_net bigint := round((p_payment->>'netValue')::numeric * 100);
  v_on date := coalesce((p_payment->>'clientPaymentDate')::date, (p_payment->>'paymentDate')::date,
                        (p_payment->>'confirmedDate')::date, public.today_br());
  v_credit date := coalesce((p_payment->>'creditDate')::date, (p_payment->>'estimatedCreditDate')::date);
  v_final text;
  v_rl bigint;
  v_split_total numeric;
  v_link text;
begin
  select * into c from public.charges where id = p_charge_id for update;
  select * into cc from public.corporate_charges where charge_id = c.id;
  select * into b from empresarial.adhesion_billing where id = c.source_id for update;
  v_link := '/empresarial/' || coalesce(cc.company_id::text, '');

  if p_event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    v_final := case when p_event = 'PAYMENT_CONFIRMED' then 'paga' else 'liquidada' end;
    if c.status in ('paga', 'liquidada') then
      if v_final = 'liquidada' and c.status = 'paga' then
        update public.charges set status = 'liquidada', credit_date = coalesce(v_credit, credit_date), last_event_at = now() where id = c.id;
        return 'liquidada';
      end if;
      return 'ja_baixada';
    end if;
    if c.status in ('cancelada', 'estornada') or b.id is null or b.status = 'CANCELLED' then
      update public.charges set paid_cents = v_paid, paid_on = v_on, last_event_at = now() where id = c.id;
      perform public._gateway_notify(c.gateway_account_id, 'emp_paga_depois_de_cancelada', c.id::text, c.clinic_id, false, true, true,
        'Empresarial: cobrança paga depois de cancelada',
        'Uma empresa pagou pelo Asaas uma cobrança que o riSZon tinha cancelado. Trate a devolução ou a compensação à mão.', v_link);
      return 'duplicidade';
    end if;
    update public.charges set status = v_final, paid_cents = v_paid, paid_on = v_on, credit_date = v_credit,
           fee_cents = case when v_net is not null then v_paid - v_net end, net_cents = v_net, last_event_at = now()
     where id = c.id;

    if b.status = 'PAID' then
      return 'ja_paga_no_empresarial';
    end if;
    if v_paid < b.total_amount_cents then
      perform public._gateway_notify(c.gateway_account_id, 'emp_paga_a_menor', c.id::text, c.clinic_id, false, true, true,
        'Empresarial: cobrança paga a menor',
        'O Asaas avisou um pagamento menor que o valor da cobrança do Empresarial. A baixa não foi feita: confira e trate à mão.', v_link);
      return 'paga_a_menor';
    end if;

    -- O que a RisLife recebeu de fato (mensalidade): o split que o Asaas
    -- informou; sem ele, o percentual sobre o líquido, arredondado para baixo.
    if cc.kind = 'mensalidade' and cc.rislife_pct is not null then
      select sum((x->>'totalValue')::numeric) into v_split_total
        from jsonb_array_elements(coalesce(p_payment->'split', '[]'::jsonb)) x
       where x->>'walletId' = cc.rislife_wallet_id and x->>'totalValue' is not null;
      v_rl := coalesce(round(v_split_total * 100)::bigint,
                       floor(coalesce(v_net, v_paid) * cc.rislife_pct / 100.0)::bigint);
    elsif cc.kind = 'mensalidade' then
      v_rl := 0;
    end if;

    perform set_config('risarte.baixa_do_asaas', '1', true);
    if cc.kind = 'mensalidade' then
      update empresarial.adhesion_billing set split_at_source = true where id = b.id;
    end if;
    perform empresarial._settle_billing_raw(b.id, (v_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo');
    if cc.kind = 'mensalidade' then
      update empresarial.adhesion_billing
         set split_rislife_cents = v_rl, split_risarte_cents = total_amount_cents - v_rl
       where id = b.id;
      update public.corporate_charges set rislife_cents = v_rl where charge_id = c.id;
    end if;
    -- Decisão 8: a implantação emitida pelo funil, paga pelo Asaas, sela o 1º
    -- pagamento do lead (data, valor e forma) — ninguém registra à mão.
    if cc.kind = 'implantacao' and b.origin_lead_id is not null then
      update empresarial.commercial_leads
         set implantation_paid_at = (v_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo',
             implantation_paid_cents = v_paid,
             implantation_payment_method = case upper(coalesce(p_payment->>'billingType', c.billing_type))
               when 'PIX' then 'PIX' when 'CREDIT_CARD' then 'CARD' else 'BOLETO' end,
             implantation_paid_by = null
       where id = b.origin_lead_id and implantation_paid_at is null;
      if found then
        insert into empresarial.commercial_lead_activities (lead_id, author_id, kind, note)
        values (b.origin_lead_id, null, 'NOTE', '1º pagamento (implantação) pago pelo Asaas (conta da RisLife).');
      end if;
    end if;
    perform set_config('risarte.baixa_do_asaas', '', true);

    -- A tarifa do Asaas da mensalidade é da franqueadora (a da implantação é da
    -- RisLife, na conta dela: fora do razão da franqueadora).
    if cc.kind = 'mensalidade' and v_net is not null and v_paid - v_net > 0
       and not exists (select 1 from public.financial_entries f where f.source_type = 'gateway_fee_charge' and f.source_id = c.id) then
      insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
        amount_cents, direction, status, source_type, source_id, description)
      values (c.clinic_id, '2.4.02', v_on, coalesce(v_credit, v_on), coalesce(v_credit, v_on), v_paid - v_net, 'outflow', 'settled',
        'gateway_fee_charge', c.id, 'Tarifa do Asaas — Empresarial (mensalidade)');
    end if;
    return 'baixa';

  elsif p_event = 'PAYMENT_OVERDUE' then
    -- 5c: só a cobrança fica vencida; quem marca o atraso e suspende é a rotina do Empresarial.
    if c.status = 'emitida' then
      update public.charges set status = 'vencida', last_event_at = now() where id = c.id;
      return 'vencida';
    end if;
    return 'sem_efeito';

  elsif p_event = 'PAYMENT_DELETED' then
    if c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
      update public.charges set status = 'cancelada', cancelled_at = now(), cancelled_by = null,
             cancel_reason = 'Apagada no painel do Asaas', last_event_at = now()
       where id = c.id;
      perform public._gateway_notify(c.gateway_account_id, 'emp_apagada_no_asaas', c.id::text, c.clinic_id, false, true, true,
        'Empresarial: cobrança apagada no Asaas',
        'Uma cobrança do Empresarial foi apagada direto no painel do Asaas. A cobrança continua em aberto no Empresarial: use "Emitir no Asaas" ou receba à mão.', v_link);
      return 'cancelada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif p_event = 'PAYMENT_REFUNDED' then
    if c.status in ('paga', 'liquidada', 'em_contestacao') then
      update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
    end if;
    if b.status = 'PAID' then
      perform public._gateway_notify(c.gateway_account_id, 'emp_estorno', c.id::text, c.clinic_id, false, true, true,
        'Empresarial: estorno no Asaas',
        'Uma cobrança do Empresarial paga pelo Asaas foi estornada fora do riSZon. Ela continua paga no Empresarial: desfaça a baixa (Estornar) na tela de cobranças.', v_link);
    end if;
    return 'estornada';

  elsif p_event = 'PAYMENT_UPDATED'
        and round(coalesce((p_payment->>'value')::numeric, 0) * 100) = coalesce(c.value_cents, 0)
        and (p_payment->>'dueDate')::date is not distinct from c.due_date then
    return 'sem_efeito';

  elsif p_event in ('PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_REQUESTED',
                    'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL', 'PAYMENT_UPDATED', 'PAYMENT_RESTORED') then
    perform public._gateway_notify(c.gateway_account_id, 'emp_' || lower(p_event), coalesce(p_payment->>'id', '') || public.today_br()::text,
      c.clinic_id, false, true, true, 'Empresarial: ' || p_event,
      'O Asaas avisou ' || p_event || ' numa cobrança do Empresarial. O Financeiro trata à mão.', v_link);
    return 'aviso_manual';
  end if;
  return 'sem_efeito';
end;
$$;

-- O ramo do Empresarial no aviso do Asaas, ao lado do da cobrança mensal da rede
-- (inserido na função de hoje, sem reescrevê-la).
do $$
declare
  v_def text := pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure);
  v_anchor text := '  -- 4021 (ASA6): a cobrança mensal da rede tem o ramo dela.';
  v_branch text := E'  -- 4023 (ASA5): as cobranças do Empresarial têm o ramo delas.\n'
    || E'  if c.source_type in (''corporate_implementation'', ''corporate_monthly'') and to_regprocedure(''public._corporate_event(uuid,text,jsonb)'') is not null then\n'
    || E'    return public._corporate_event(c.id, e.event, p);\n'
    || E'  end if;\n';
begin
  if position('_corporate_event' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'APPLY_EVENT_ANCHOR_NOT_FOUND'; end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end;
$$;

-- A trava do funil (`guard_lead_signatures`, 1041) recusa mudar o 1º pagamento
-- quando a implantação já está nas cobranças. O selo que vem do AVISO DO ASAAS
-- (decisão 8) passa — só ele (a marca `risarte.baixa_do_asaas`, ligada só dentro
-- da baixa pelo aviso). Inserido na função de hoje, sem reescrevê-la.
do $$
declare
  v_def text := pg_get_functiondef('empresarial.guard_lead_signatures()'::regprocedure);
  v_anchor text := E'  -- O 1º pagamento já lançado no financeiro não muda pelo funil.\n  if (';
  v_novo text := E'  -- O 1º pagamento já lançado no financeiro não muda pelo funil.\n'
    || E'  -- 4023 (ASA5): a baixa pelo aviso do Asaas sela o pagamento do lead.\n'
    || E'  if coalesce(current_setting(''risarte.baixa_do_asaas'', true), '''') <> ''1'' and (';
begin
  if position('risarte.baixa_do_asaas' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'LEAD_GUARD_ANCHOR_NOT_FOUND'; end if;
  execute replace(v_def, v_anchor, v_novo);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) AS TRAVAS NA LINHA DO EMPRESARIAL
-- -----------------------------------------------------------------------------
create or replace function public._corporate_billing_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_live boolean;
  v_paid boolean;
begin
  if coalesce(current_setting('risarte.baixa_do_asaas', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select bool_or(ch.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')),
         bool_or(ch.status in ('paga', 'liquidada', 'em_contestacao'))
    into v_live, v_paid
    from public.charges ch
   where ch.source_type in ('corporate_implementation', 'corporate_monthly') and ch.source_id = old.id;
  v_live := coalesce(v_live, false);
  v_paid := coalesce(v_paid, false);
  if tg_op = 'DELETE' then
    if v_live or v_paid then raise exception 'CHARGE_IN_GATEWAY'; end if;
    return old;
  end if;
  if v_live then
    if new.status is distinct from old.status
       and not (old.status in ('PENDING', 'OVERDUE') and new.status in ('PENDING', 'OVERDUE')) then
      raise exception 'CHARGE_IN_GATEWAY';
    end if;
    if new.total_amount_cents is distinct from old.total_amount_cents or new.due_date is distinct from old.due_date
       or new.company_document_id is distinct from old.company_document_id or new.employee_id is distinct from old.employee_id
       or new.payer_document is distinct from old.payer_document then
      raise exception 'CHARGE_IN_GATEWAY';
    end if;
  end if;
  -- Paga pelo Asaas: só o estorno pelo Asaas desfaz a baixa.
  if v_paid and old.status = 'PAID' and new.status <> 'PAID' then
    raise exception 'CHARGE_PAID_IN_GATEWAY';
  end if;
  return new;
end;
$$;
drop trigger if exists adhesion_billing_gateway_lock on empresarial.adhesion_billing;
create trigger adhesion_billing_gateway_lock before update or delete on empresarial.adhesion_billing
  for each row execute function public._corporate_billing_lock();

-- A cobrança viva de uma linha (o servidor cancela no Asaas antes de mexer nela).
create or replace function public.corporate_live_charge(p_billing_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ch public.charges%rowtype;
begin
  if not public._corporate_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  select * into ch from public.charges c
   where c.source_type in ('corporate_implementation', 'corporate_monthly') and c.source_id = p_billing_id
     and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'paga', 'liquidada', 'em_contestacao')
   order by c.created_at desc limit 1;
  if ch.id is null then return null; end if;
  return jsonb_build_object('charge_id', ch.id, 'account_id', ch.gateway_account_id, 'asaas_payment_id', ch.asaas_payment_id,
                            'status', ch.status, 'value_cents', ch.value_cents, 'paid_cents', ch.paid_cents);
end;
$$;

-- O estorno feito pelo riSZon no Asaas: marca a cobrança (o Empresarial desfaz
-- a baixa em seguida, pela porta dele, `reverse_billing`).
create or replace function public._corporate_mark_refunded(p_charge_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.charges set status = 'estornada', last_event_at = now()
   where id = p_charge_id and status in ('paga', 'liquidada', 'em_contestacao')
     and source_type in ('corporate_implementation', 'corporate_monthly');
end;
$$;

-- Os saldos que o estorno confere (19.37): a conta que recebeu e, na mensalidade,
-- a parte da RisLife.
create or replace function public.corporate_refund_check(p_billing_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ch public.charges%rowtype; cc public.corporate_charges%rowtype;
begin
  if not public._corporate_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  select * into ch from public.charges c
   where c.source_type in ('corporate_implementation', 'corporate_monthly') and c.source_id = p_billing_id
     and c.status in ('paga', 'liquidada') order by c.created_at desc limit 1;
  if ch.id is null then return null; end if;
  select * into cc from public.corporate_charges where charge_id = ch.id;
  return jsonb_build_object('charge_id', ch.id, 'account_id', ch.gateway_account_id, 'asaas_payment_id', ch.asaas_payment_id,
    'kind', cc.kind, 'paid_cents', ch.paid_cents, 'net_cents', ch.net_cents,
    'rislife_account_id', case when cc.kind = 'mensalidade' then cc.rislife_account_id end,
    'rislife_cents', case when cc.kind = 'mensalidade' then cc.rislife_cents end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) O QUE AS TELAS LEEM
-- -----------------------------------------------------------------------------
-- As cobranças do Asaas das linhas de uma empresa (a aba Cobranças).
create or replace function public.corporate_billing_charges(p_company_id uuid)
returns table (billing_id uuid, charge_id uuid, status text, kind text, invoice_url text, bank_slip_url text,
               pix_copy_paste text, identification_field text, error_code text, due_date date, emissor text, report_code text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._corporate_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  return query
  select distinct on (cc.billing_id) cc.billing_id, ch.id, ch.status, cc.kind, ch.invoice_url, ch.bank_slip_url,
         ch.pix_copy_paste, ch.identification_field, ch.error_code, ch.due_date,
         case when cc.kind = 'implantacao' then 'RisLife' else 'Franqueadora' end,
         r.code
    from public.corporate_charges cc
    join public.charges ch on ch.id = cc.charge_id
    left join public.corporate_monthly_reports r on r.id = cc.report_id
   where cc.company_id = p_company_id
   order by cc.billing_id, ch.created_at desc;
end;
$$;

-- O que falta no cadastro antes de ligar (decisão 7): as empresas ativas cujas
-- cobranças não sairiam (sem documento aceito ou sem contato) e os titulares
-- com "outro pagador" sem contato.
create or replace function public._corporate_pending_registrations()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'empresa', x->>'problema'), '[]'::jsonb) from (
    select jsonb_build_object('company_id', co.id, 'empresa', coalesce(co.trade_name, co.legal_name),
             'problema', 'sem_documento_aceito', 'detalhe', d.doc_type || ' ' || d.doc_formatted) x
      from empresarial.companies co
      join empresarial.company_documents d on d.company_id = co.id and d.doc_type in ('CAEPF', 'CNO', 'NIF')
     where co.status = 'ACTIVE'
       and not exists (select 1 from empresarial.company_documents m where m.company_id = co.id and m.is_primary and m.doc_type = 'CNPJ')
       and not coalesce(public._cpf_ok(public.cpf_digits(co.responsible_cpf)), false)
    union all
    select jsonb_build_object('company_id', co.id, 'empresa', coalesce(co.trade_name, co.legal_name),
             'problema', 'sem_contato', 'detalhe', 'Sem e-mail e sem celular do responsável')
      from empresarial.companies co
     where co.status = 'ACTIVE'
       and nullif(btrim(coalesce(co.responsible_email, '')), '') is null
       and nullif(btrim(coalesce(co.responsible_phone, '')), '') is null
    union all
    select jsonb_build_object('company_id', co.id, 'empresa', coalesce(co.trade_name, co.legal_name),
             'problema', 'outro_pagador_sem_contato', 'detalhe', e.full_name)
      from empresarial.employees e join empresarial.companies co on co.id = e.company_id
     where co.status = 'ACTIVE' and e.status = 'ACTIVE' and e.dependents_payer = 'OUTRO'
       and nullif(btrim(coalesce(e.dependents_payer_email, '')), '') is null
       and nullif(btrim(coalesce(e.dependents_payer_phone, '')), '') is null
  ) s;
$$;

-- 5c: a rotina do Empresarial e o Asaas dizem coisas diferentes sobre o atraso
-- (com um dia de folga para os dois lados rodarem).
create or replace function public._corporate_overdue_divergences()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('billing_id', b.id, 'company_id', b.company_id,
           'empresa', coalesce(co.trade_name, co.legal_name), 'vencimento', ch.due_date,
           'no_empresarial', b.status, 'no_asaas', ch.status) order by ch.due_date), '[]'::jsonb)
    from public.charges ch
    join empresarial.adhesion_billing b on b.id = ch.source_id
    join empresarial.companies co on co.id = b.company_id
   where ch.source_type in ('corporate_implementation', 'corporate_monthly')
     and ch.status in ('emitida', 'vencida')
     and ch.due_date < public.today_br() - 1
     and ((ch.status = 'vencida') <> (b.status = 'OVERDUE'));
$$;

-- A aba Empresarial da Central.
create or replace function public.corporate_settings_read()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.corporate_gateway_settings%rowtype; v_root uuid := public._franchise_root_account();
begin
  if not (public._corporate_can_configure() or public._corporate_can_manage()) then raise exception 'NOT_ALLOWED'; end if;
  select * into s from public.corporate_gateway_settings where id;
  return jsonb_build_object(
    'enabled_from', s.enabled_from,
    'ligado', s.enabled_from is not null and s.enabled_from <= public.today_br(),
    'rislife_account_id', s.rislife_account_id,
    'rislife_pronta', public._corporate_rislife_account() is not null,
    'pode_configurar', public._corporate_can_configure(),
    'contas_rislife', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'environment', a.environment,
                         'status', a.status, 'tem_chave', a.api_key_secret_id is not null, 'tem_carteira', a.wallet_id is not null,
                         'tem_webhook', a.webhook_id is not null) order by a.label)
                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled'), '[]'::jsonb),
    'conta_raiz', (select jsonb_build_object('id', a.id, 'label', a.label, 'environment', a.environment) from public.gateway_accounts a where a.id = v_root),
    'regra', (select jsonb_build_object('implantacao_rislife', r.first_payment_rislife_pct, 'mensalidade_rislife', r.recurring_rislife_pct)
                from empresarial.split_rules r where r.company_id is null limit 1),
    'excecoes', (select count(*) from empresarial.split_rules r where r.company_id is not null),
    'pendencias', public._corporate_pending_registrations(),
    'divergencias_de_atraso', public._corporate_overdue_divergences(),
    'cobrancas', (select jsonb_build_object(
        'emitidas', count(*) filter (where ch.status in ('emitida', 'vencida')),
        'com_erro', count(*) filter (where ch.status = 'erro_emissao'),
        'pagas', count(*) filter (where ch.status in ('paga', 'liquidada')))
        from public.charges ch where ch.source_type in ('corporate_implementation', 'corporate_monthly')),
    'abertas_antes_da_data', (select count(*) from empresarial.adhesion_billing b
        where b.status in ('PENDING', 'OVERDUE') and s.enabled_from is not null
          and (b.created_at at time zone 'America/Sao_Paulo')::date < s.enabled_from
          and not exists (select 1 from public.charges ch where ch.source_type in ('corporate_implementation', 'corporate_monthly')
                            and ch.source_id = b.id and ch.status <> 'cancelada'))
  );
end;
$$;

create or replace function public.corporate_settings_save(p_enabled_from date, p_rislife_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.corporate_gateway_settings%rowtype;
begin
  if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if;
  if p_rislife_account_id is not null and not exists (
       select 1 from public.gateway_accounts a where a.id = p_rislife_account_id and a.owner_type = 'recipient' and a.status <> 'disabled') then
    raise exception 'RISLIFE_ACCOUNT_INVALID';
  end if;
  if p_enabled_from is not null then
    if p_rislife_account_id is null then raise exception 'RISLIFE_ACCOUNT_REQUIRED'; end if;
    if not exists (select 1 from public.gateway_accounts a where a.id = p_rislife_account_id and a.status = 'active'
                    and a.api_key_secret_id is not null and a.wallet_id is not null and a.webhook_id is not null) then
      raise exception 'RISLIFE_ACCOUNT_NOT_READY';
    end if;
    if public._franchise_root_account() is null then raise exception 'ROOT_ACCOUNT_MISSING'; end if;
  end if;
  select * into v_old from public.corporate_gateway_settings where id;
  update public.corporate_gateway_settings
     set enabled_from = p_enabled_from, rislife_account_id = p_rislife_account_id, updated_at = now(), updated_by = (select auth.uid())
   where id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), null, 'update', 'corporate_gateway_settings', 'true',
          jsonb_build_object('enabled_from', p_enabled_from, 'rislife_account_id', p_rislife_account_id,
                             'antes_enabled_from', v_old.enabled_from, 'antes_rislife_account_id', v_old.rislife_account_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 10) QUEM VÊ AS COBRANÇAS DO EMPRESARIAL
-- -----------------------------------------------------------------------------
drop policy if exists "charges_select_corporate" on public.charges;
create policy "charges_select_corporate" on public.charges
  for select to authenticated
  using (source_type in ('corporate_implementation', 'corporate_monthly') and public._corporate_can_manage());

-- -----------------------------------------------------------------------------
-- 11) O LEGADO SAI (decisão 11b; conferido vazio no passo 0)
-- -----------------------------------------------------------------------------
drop table if exists empresarial.asaas_webhook_events;
delete from public.audit_excluded_tables where schema_name = 'empresarial' and table_name = 'asaas_webhook_events';
alter table empresarial.adhesion_billing drop column if exists asaas_billing_id;

-- -----------------------------------------------------------------------------
-- 12) A LISTA DAS MIGRAÇÕES DO ASAAS (a prontidão da produção)
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
    ('4022', 'As peças do piloto', 'table', 'gateway_charge_issues', 28),
    ('4023', 'O Empresarial pelo Asaas', 'table', 'corporate_gateway_settings', 29)
  )
  select m.code, m.label,
         case m.kind
           when 'table' then exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = m.obj)
           when 'fn' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.obj)
           when 'col' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                                     and c.table_name = split_part(m.obj, '.', 1) and c.column_name = split_part(m.obj, '.', 2))
           when 'body' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public' and p.proname = split_part(m.obj, '|', 1)
                                       and position(split_part(m.obj, '|', 2) in p.prosrc) > 0)
         end,
         m.sort_order
    from m order by m.sort_order;
$$;
revoke execute on function public.gateway_asaas_migrations() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 13) PERMISSÕES
-- -----------------------------------------------------------------------------
revoke execute on function public._corporate_can_manage() from public, anon, authenticated;
-- A regra de leitura de `charges` chama esta (só diz "sim" ou "não" para quem pergunta).
grant execute on function public._corporate_can_manage() to authenticated;
revoke execute on function public._corporate_can_configure() from public, anon, authenticated;
revoke execute on function public._corporate_rislife_account() from public, anon, authenticated;
revoke execute on function public._corporate_payer_of(uuid) from public, anon, authenticated;
revoke execute on function public._corporate_payer(uuid) from public, anon, authenticated;
revoke execute on function public._corporate_payer_save(uuid, text) from public, anon, authenticated;
revoke execute on function public._corporate_split_plan(uuid) from public, anon, authenticated;
revoke execute on function public._corporate_charge_report(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._corporate_report_save(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public._corporate_report_by_code(text) from public, anon, authenticated;
revoke execute on function public._corporate_event(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public._corporate_billing_lock() from public, anon, authenticated;
revoke execute on function public._corporate_mark_refunded(uuid) from public, anon, authenticated;
revoke execute on function public._corporate_pending_registrations() from public, anon, authenticated;
revoke execute on function public._corporate_overdue_divergences() from public, anon, authenticated;
revoke execute on function public.corporate_charge_prepare(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.corporate_charge_retry(uuid) from public, anon, authenticated;
revoke execute on function public.corporate_lead_implantation_issue(uuid, bigint, date) from public, anon, authenticated;
grant execute on function public.corporate_lead_implantation_issue(uuid, bigint, date) to authenticated;
revoke execute on function public.corporate_live_charge(uuid) from public, anon, authenticated;
revoke execute on function public.corporate_refund_check(uuid) from public, anon, authenticated;
revoke execute on function public.corporate_billing_charges(uuid) from public, anon, authenticated;
revoke execute on function public.corporate_settings_read() from public, anon, authenticated;
revoke execute on function public.corporate_settings_save(date, uuid) from public, anon, authenticated;
grant execute on function public.corporate_charge_prepare(uuid, boolean) to authenticated;
grant execute on function public.corporate_charge_retry(uuid) to authenticated;
grant execute on function public.corporate_live_charge(uuid) to authenticated;
grant execute on function public.corporate_refund_check(uuid) to authenticated;
grant execute on function public.corporate_billing_charges(uuid) to authenticated;
grant execute on function public.corporate_settings_read() to authenticated;
grant execute on function public.corporate_settings_save(date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 14) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('corporate_gateway_settings', 'corporate_charges', 'corporate_monthly_reports')) as tabelas_novas,
  (select enabled_from is null from public.corporate_gateway_settings where id) as desligado,
  position('_corporate_event' in pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure)) > 0 as ramo_do_aviso,
  to_regclass('empresarial.asaas_webhook_events') is null
    and not exists (select 1 from information_schema.columns where table_schema = 'empresarial'
                      and table_name = 'adhesion_billing' and column_name = 'asaas_billing_id') as legado_fora,
  (select count(*) from empresarial.split_rules where first_payment_rislife_pct <> 100) as implantacao_fora_de_100;
