-- =============================================================================
-- 1050 — REVISAR CONTRATO, A IMPLANTAÇÃO DA IMPORTADA E A DOS DEPENDENTES NOVOS
--        (Empresarial 0.111.0, 18/11/2026)
--
-- Pedido do dono: "quando eu crio uma empresa através de uma importação eu
-- fico limitado às personalizações da empresa… deve ter uma opção de revisar
-- contrato, para revisar todas as regras e benefícios contratados, onde pode
-- ser feito alterações nos combinados — o que necessitaria de anexos ou
-- mudança no contrato assinado." Plano aprovado (R1–R7) em
-- docs/risarte-empresarial/REVISAR-CONTRATO-PLANO.md.
--
-- O QUE MUDA NO BANCO:
--   1. companies: fidelidade e multa de saída (R5, copiadas do lead) e a
--      situação da implantação (R4: cobrar / já paga antes do sistema /
--      isenta);
--   2. contract_revisions: a revisão (RV-00001) com a foto das regras antes e
--      a proposta depois, o aditivo assinado anexado (R2) e quem aplicou;
--   3. as portas: abrir, salvar, anexar, aplicar (só o gestor, R6) e cancelar;
--   4. a TRAVA (R1): as regras comerciais da empresa só mudam pela revisão —
--      e pelos dois caminhos que já eram legítimos: a criação da empresa (os
--      primeiros minutos) e a alteração da proposta reaberta e reassinada no
--      funil (1041);
--   5. dependents_implantation_coverage (R7): quantos dependentes de cada
--      titular já pagaram implantação — a implantação dos dependentes novos
--      cobra só quem passou disso.
--
-- ⚠️ O QUE A REVISÃO AINDA NÃO MUDA (próxima entrega): benefícios por
-- procedimento, outras vantagens, unidades da parceria e a divisão (split).
-- Eles continuam editados nas telas de sempre e FORA da trava.
-- ⚠️ Fora da trava de propósito: billing_model (é da aba Documentos, junto
-- com os CNPJs), social_participates (aba Riso+ Social), special_agreements
-- (o gatilho da conferência do fechamento grava nele, 1011) e o início do
-- contrato (o 1º pagamento grava, 1044).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colunas novas na empresa
-- -----------------------------------------------------------------------------
alter table empresarial.companies
  add column if not exists min_term_months integer,
  add column if not exists early_exit_fee_cents bigint,
  add column if not exists implantation_status text not null default 'COBRAR',
  add column if not exists implantation_prepaid_holders integer;

alter table empresarial.companies drop constraint if exists companies_implantation_status_check;
alter table empresarial.companies add constraint companies_implantation_status_check check (
  implantation_status in ('COBRAR', 'JA_PAGA', 'ISENTA')
  and (implantation_prepaid_holders is null or implantation_prepaid_holders >= 0)
  and (min_term_months is null or min_term_months > 0)
  and (early_exit_fee_cents is null or early_exit_fee_cents >= 0)
);

comment on column empresarial.companies.implantation_status is
  'A implantação desta empresa (1050, R4): COBRAR (pela regra combinada), '
  'JA_PAGA (paga antes do sistema; implantation_prepaid_holders titulares '
  'contam como já cobertos) ou ISENTA (combinado com a empresa).';
comment on column empresarial.companies.min_term_months is
  'Prazo mínimo do contrato (fidelidade), em meses (1050, R5; vem da proposta).';
comment on column empresarial.companies.early_exit_fee_cents is
  'Multa de saída antecipada (1050, R5; vem da proposta).';

-- R5: a fidelidade e a multa da proposta passam a morar na empresa.
update empresarial.companies c
   set min_term_months = coalesce(c.min_term_months, q.min_term_months),
       early_exit_fee_cents = coalesce(c.early_exit_fee_cents, q.early_exit_fee_cents)
  from empresarial.lead_qualification q
 where q.lead_id = c.origin_lead_id
   and (q.min_term_months is not null or q.early_exit_fee_cents is not null)
   and (c.min_term_months is null and c.early_exit_fee_cents is null);

-- O aditivo assinado é um arquivo da empresa (aba Documentos).
alter table empresarial.company_files drop constraint if exists company_files_file_type_check;
alter table empresarial.company_files add constraint company_files_file_type_check check (
  file_type in ('contrato_social', 'cartao_cnpj', 'procuracao', 'contrato_programa', 'aditivo', 'outro')
);

-- -----------------------------------------------------------------------------
-- 2. A revisão
-- -----------------------------------------------------------------------------
create sequence if not exists empresarial.contract_revisions_code_seq;

create table if not exists empresarial.contract_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  code text not null unique
    default 'RV-' || lpad(nextval('empresarial.contract_revisions_code_seq')::text, 5, '0'),
  status text not null default 'RASCUNHO'
    check (status in ('RASCUNHO', 'APLICADA', 'CANCELADA')),
  reason text not null check (length(btrim(reason)) >= 10),
  -- A foto das regras quando a revisão abriu, e a proposta.
  terms_before jsonb not null,
  terms_after jsonb not null,
  -- R2: o aditivo (ou o contrato novo) assinado, anexado na aba Documentos.
  document_file_id uuid references empresarial.company_files (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A foto das regras no instante de aplicar (o "antes" que valeu).
  applied_terms_before jsonb,
  applied_by uuid references public.profiles (id) on delete set null,
  applied_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text
);
create unique index if not exists contract_revisions_one_draft
  on empresarial.contract_revisions (company_id) where status = 'RASCUNHO';
create index if not exists contract_revisions_company_idx
  on empresarial.contract_revisions (company_id, created_at desc);

comment on table empresarial.contract_revisions is
  'Revisão do contrato da empresa (1050): as regras de antes, as propostas, o '
  'aditivo assinado e quem aplicou. Uma em rascunho por empresa. Grava só '
  'pelas portas open/save/attach/apply/cancel_contract_revision.';

alter table empresarial.contract_revisions enable row level security;
drop policy if exists contract_revisions_select on empresarial.contract_revisions;
create policy contract_revisions_select on empresarial.contract_revisions
  for select to authenticated
  using (
    empresarial.is_program_manager()
    or empresarial.is_program_finance()
    or empresarial.is_my_company(company_id)
  );
-- Sem regra de escrita: só as portas abaixo gravam.
grant select on empresarial.contract_revisions to authenticated;
grant all on empresarial.contract_revisions to service_role;

-- -----------------------------------------------------------------------------
-- 3. A cobertura da implantação dos dependentes (R7)
-- -----------------------------------------------------------------------------
create table if not exists empresarial.dependents_implantation_coverage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  employee_id uuid not null references empresarial.employees (id) on delete cascade,
  -- Quantos dependentes ativos o titular tinha quando a implantação os cobriu.
  dependents_covered integer not null check (dependents_covered >= 0),
  package_cents bigint not null default 0 check (package_cents >= 0),
  -- A cobrança que cobriu. Cancelada a cobrança, a cobertura deixa de valer
  -- (quem lê filtra pela situação dela). Nula = coberto sem cobrança nova
  -- (já pago antes, pela estimativa do fechamento, ou dispensado): o motivo
  -- é obrigatório.
  billing_id uuid references empresarial.adhesion_billing (id) on delete cascade,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dependents_implantation_coverage_reason
    check (billing_id is not null or length(btrim(coalesce(reason, ''))) >= 10)
);
create index if not exists dependents_implantation_coverage_employee_idx
  on empresarial.dependents_implantation_coverage (employee_id);
create index if not exists dependents_implantation_coverage_billing_idx
  on empresarial.dependents_implantation_coverage (billing_id) where billing_id is not null;

comment on table empresarial.dependents_implantation_coverage is
  'Quantos dependentes de cada titular já pagaram implantação (1050, R7). '
  'Coberto = o maior dependents_covered entre as linhas sem cobrança e as de '
  'cobrança não cancelada.';

alter table empresarial.dependents_implantation_coverage enable row level security;
drop policy if exists dependents_implantation_coverage_select on empresarial.dependents_implantation_coverage;
create policy dependents_implantation_coverage_select on empresarial.dependents_implantation_coverage
  for select to authenticated
  using (
    empresarial.is_program_manager()
    or empresarial.is_program_finance()
    or empresarial.is_my_company(company_id)
  );
-- Quem cobra a empresa registra a cobertura (junto com a cobrança).
drop policy if exists dependents_implantation_coverage_insert on empresarial.dependents_implantation_coverage;
create policy dependents_implantation_coverage_insert on empresarial.dependents_implantation_coverage
  for insert to authenticated
  with check (
    empresarial.is_program_finance()
    and created_by = auth.uid()
    and exists (
      select 1 from empresarial.employees e
       where e.id = employee_id and e.company_id = dependents_implantation_coverage.company_id
    )
  );
grant select, insert on empresarial.dependents_implantation_coverage to authenticated;
grant all on empresarial.dependents_implantation_coverage to service_role;

-- A implantação que já cobrava os dependentes (antes da 1050) cobriu os
-- dependentes de hoje: ninguém paga de novo por ter entrado antes.
insert into empresarial.dependents_implantation_coverage
  (company_id, employee_id, dependents_covered, reason)
select e.company_id, e.id, count(d.id)::int,
       'Implantação anterior à 1050 (a empresa já pagava a dos dependentes)'
  from empresarial.employees e
  join empresarial.companies c on c.id = e.company_id
  join empresarial.dependents d on d.employee_id = e.id and d.status = 'ACTIVE'
 where e.status = 'ACTIVE'
   and c.implantation_includes_dependents
   and exists (
     select 1 from empresarial.adhesion_billing b
      where b.company_id = c.id and b.billing_type = 'IMPLANTATION' and b.status <> 'CANCELLED'
   )
   and not exists (
     select 1 from empresarial.dependents_implantation_coverage x where x.employee_id = e.id
   )
 group by e.company_id, e.id;

-- -----------------------------------------------------------------------------
-- 4. As regras da empresa, em JSON (a foto da revisão)
-- -----------------------------------------------------------------------------
create or replace function empresarial._termos_da_empresa(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'empresa', (
      select jsonb_build_object(
        'payment_model', c.payment_model,
        'company_subsidy_type', c.company_subsidy_type,
        'company_subsidy_value', c.company_subsidy_value,
        'due_day', c.due_day,
        'payment_methods', to_jsonb(c.payment_methods),
        'default_max_installments', c.default_max_installments,
        'grace_period_days', c.grace_period_days,
        'employee_grace_period_days', c.employee_grace_period_days,
        'special_agreements', c.special_agreements,
        'min_adhesions', c.min_adhesions,
        'max_adhesions', c.max_adhesions,
        'adhesion_limit_target', c.adhesion_limit_target,
        'contracted_holders', c.contracted_holders,
        'contracted_dependents', c.contracted_dependents,
        'excess_mode', c.excess_mode,
        'excess_fixed_cents', c.excess_fixed_cents,
        'excess_holder_fee_cents', c.excess_holder_fee_cents,
        'excess_dependent_fee_cents', c.excess_dependent_fee_cents,
        'billing_basis', c.billing_basis,
        'fixed_monthly_cents', c.fixed_monthly_cents,
        'implantation_includes_dependents', c.implantation_includes_dependents,
        'implantation_status', c.implantation_status,
        'implantation_prepaid_holders', c.implantation_prepaid_holders,
        'min_term_months', c.min_term_months,
        'early_exit_fee_cents', c.early_exit_fee_cents
      )
      from empresarial.companies c where c.id = p_company_id
    ),
    -- Nulo = vale o preço da rede.
    'preco', (
      select jsonb_build_object(
        'holder_fee_cents', p.holder_fee_cents,
        'dependent_individual_fee_cents', p.dependent_individual_fee_cents,
        'dependent_family_fee_cents', p.dependent_family_fee_cents,
        'dependent_family_extra_fee_cents', p.dependent_family_extra_fee_cents,
        'dependent_family_size', p.dependent_family_size,
        'dependent_mode', p.dependent_mode,
        'max_installments', p.max_installments
      )
      from empresarial.adhesion_pricing p where p.company_id = p_company_id
    ),
    'faixas', coalesce((
      select jsonb_agg(jsonb_build_object('min_quantity', f.min_quantity, 'price_cents', f.price_cents)
                       order by f.min_quantity)
      from empresarial.company_price_tiers f where f.company_id = p_company_id
    ), '[]'::jsonb)
  );
$$;
revoke all on function empresarial._termos_da_empresa(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. A trava (R1)
-- -----------------------------------------------------------------------------
-- As regras da empresa podem mudar agora? Pela revisão (a porta liga a marca
-- da transação), na criação da empresa (o funil e a importação gravam preço e
-- faixas logo depois de criar) e na proposta reaberta e assinada de novo no
-- funil, até ela ser levada para a empresa (1041).
create or replace function empresarial._termos_liberados(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(current_setting('empresarial.revisao_em_curso', true), '') = p_company_id::text
    or exists (
      select 1 from empresarial.companies c
       where c.id = p_company_id
         and c.created_at > now() - interval '10 minutes'
    )
    or exists (
      select 1
        from empresarial.companies c
        join empresarial.lead_proposal_reopenings r on r.lead_id = c.origin_lead_id
        join empresarial.commercial_leads l on l.id = r.lead_id
       where c.id = p_company_id
         and r.applied_to_company_at is null
         and l.contract_signed_at is not null
         and l.contract_signed_at > r.reopened_at
    );
$$;
revoke all on function empresarial._termos_liberados(uuid) from public, anon, authenticated;

create or replace function empresarial.guard_company_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
       new.payment_model is distinct from old.payment_model
    or new.company_subsidy_type is distinct from old.company_subsidy_type
    or new.company_subsidy_value is distinct from old.company_subsidy_value
    or new.due_day is distinct from old.due_day
    or new.payment_methods is distinct from old.payment_methods
    or new.default_max_installments is distinct from old.default_max_installments
    or new.grace_period_days is distinct from old.grace_period_days
    or new.employee_grace_period_days is distinct from old.employee_grace_period_days
    or new.min_adhesions is distinct from old.min_adhesions
    or new.max_adhesions is distinct from old.max_adhesions
    or new.adhesion_limit_target is distinct from old.adhesion_limit_target
    or new.contracted_holders is distinct from old.contracted_holders
    or new.contracted_dependents is distinct from old.contracted_dependents
    or new.excess_mode is distinct from old.excess_mode
    or new.excess_fixed_cents is distinct from old.excess_fixed_cents
    or new.excess_holder_fee_cents is distinct from old.excess_holder_fee_cents
    or new.excess_dependent_fee_cents is distinct from old.excess_dependent_fee_cents
    or new.billing_basis is distinct from old.billing_basis
    or new.fixed_monthly_cents is distinct from old.fixed_monthly_cents
    or new.implantation_includes_dependents is distinct from old.implantation_includes_dependents
    or new.implantation_dependents_cents is distinct from old.implantation_dependents_cents
    or new.implantation_status is distinct from old.implantation_status
    or new.implantation_prepaid_holders is distinct from old.implantation_prepaid_holders
    or new.min_term_months is distinct from old.min_term_months
    or new.early_exit_fee_cents is distinct from old.early_exit_fee_cents
  ) and not empresarial._termos_liberados(new.id) then
    raise exception 'CONTRACT_TERMS_LOCKED'
      using hint = 'As regras combinadas mudam pela revisão do contrato (aba Regras combinadas).';
  end if;
  return new;
end;
$$;
revoke all on function empresarial.guard_company_terms() from public, anon, authenticated;

drop trigger if exists companies_guard_terms on empresarial.companies;
create trigger companies_guard_terms
  before update on empresarial.companies
  for each row execute function empresarial.guard_company_terms();

-- Preço e faixas da EMPRESA (a linha da rede, company_id nulo, é das
-- Configurações e não trava).
create or replace function empresarial.guard_company_price_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
begin
  if v_company is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- A empresa sendo apagada leva junto (cascata): nada a travar.
  if tg_op = 'DELETE' and not exists (select 1 from empresarial.companies where id = v_company) then
    return old;
  end if;
  if not empresarial._termos_liberados(v_company) then
    raise exception 'CONTRACT_TERMS_LOCKED'
      using hint = 'As regras combinadas mudam pela revisão do contrato (aba Regras combinadas).';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function empresarial.guard_company_price_rows() from public, anon, authenticated;

drop trigger if exists adhesion_pricing_guard_terms on empresarial.adhesion_pricing;
create trigger adhesion_pricing_guard_terms
  before insert or update or delete on empresarial.adhesion_pricing
  for each row execute function empresarial.guard_company_price_rows();

drop trigger if exists company_price_tiers_guard_terms on empresarial.company_price_tiers;
create trigger company_price_tiers_guard_terms
  before insert or update or delete on empresarial.company_price_tiers
  for each row execute function empresarial.guard_company_price_rows();

-- -----------------------------------------------------------------------------
-- 6. As portas da revisão
-- -----------------------------------------------------------------------------
create or replace function empresarial._pode_revisar(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select empresarial.is_program_manager() or empresarial.is_my_company(p_company_id);
$$;
revoke all on function empresarial._pode_revisar(uuid) from public, anon, authenticated;

-- Abre (R6: o gestor, ou o consultor RisLife nas empresas dele).
create or replace function empresarial.open_contract_revision(p_company_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_aberta text;
  v_termos jsonb;
begin
  if auth.uid() is null or not empresarial._pode_revisar(p_company_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'REASON_REQUIRED';
  end if;
  select code into v_aberta from empresarial.contract_revisions
   where company_id = p_company_id and status = 'RASCUNHO';
  if v_aberta is not null then
    raise exception 'REVISION_OPEN:%', v_aberta;
  end if;
  v_termos := empresarial._termos_da_empresa(p_company_id);
  if v_termos -> 'empresa' is null or v_termos -> 'empresa' = 'null'::jsonb then
    raise exception 'NOT_FOUND';
  end if;
  insert into empresarial.contract_revisions (company_id, reason, terms_before, terms_after, created_by)
  values (p_company_id, btrim(p_reason), v_termos, v_termos, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function empresarial.open_contract_revision(uuid, text) from public, anon, authenticated;
grant execute on function empresarial.open_contract_revision(uuid, text) to authenticated;

-- Salva a proposta (as regras novas) e o motivo, enquanto é rascunho.
create or replace function empresarial.save_contract_revision(p_id uuid, p_terms jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r empresarial.contract_revisions;
begin
  select * into r from empresarial.contract_revisions where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if auth.uid() is null or not empresarial._pode_revisar(r.company_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if r.status <> 'RASCUNHO' then raise exception 'REVISION_CLOSED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'REASON_REQUIRED'; end if;
  if jsonb_typeof(p_terms -> 'empresa') <> 'object'
     or jsonb_typeof(coalesce(p_terms -> 'faixas', '[]'::jsonb)) <> 'array'
     or (p_terms ? 'preco' and jsonb_typeof(p_terms -> 'preco') not in ('object', 'null')) then
    raise exception 'INVALID_TERMS';
  end if;
  update empresarial.contract_revisions
     set terms_after = p_terms, reason = btrim(p_reason), updated_at = now()
   where id = p_id;
end;
$$;
revoke all on function empresarial.save_contract_revision(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function empresarial.save_contract_revision(uuid, jsonb, text) to authenticated;

-- Liga o aditivo assinado (um arquivo "aditivo" da mesma empresa).
create or replace function empresarial.attach_contract_revision_document(p_id uuid, p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r empresarial.contract_revisions;
begin
  select * into r from empresarial.contract_revisions where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if auth.uid() is null or not empresarial._pode_revisar(r.company_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if r.status <> 'RASCUNHO' then raise exception 'REVISION_CLOSED'; end if;
  if p_file_id is not null and not exists (
    select 1 from empresarial.company_files f
     where f.id = p_file_id and f.company_id = r.company_id and f.file_type = 'aditivo'
  ) then
    raise exception 'INVALID_DOCUMENT';
  end if;
  update empresarial.contract_revisions
     set document_file_id = p_file_id, updated_at = now()
   where id = p_id;
end;
$$;
revoke all on function empresarial.attach_contract_revision_document(uuid, uuid) from public, anon, authenticated;
grant execute on function empresarial.attach_contract_revision_document(uuid, uuid) to authenticated;

-- Grava as regras de um JSON na empresa (só pela aplicação da revisão).
create or replace function empresarial._aplicar_termos(p_company_id uuid, p_terms jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb := p_terms -> 'empresa';
  p jsonb := p_terms -> 'preco';
begin
  update empresarial.companies c set
    payment_model = e ->> 'payment_model',
    company_subsidy_type = e ->> 'company_subsidy_type',
    company_subsidy_value = (e ->> 'company_subsidy_value')::bigint,
    due_day = (e ->> 'due_day')::int,
    payment_methods = coalesce(
      (select array_agg(x)::varchar[] from jsonb_array_elements_text(e -> 'payment_methods') x),
      c.payment_methods),
    default_max_installments = (e ->> 'default_max_installments')::int,
    grace_period_days = (e ->> 'grace_period_days')::int,
    employee_grace_period_days = (e ->> 'employee_grace_period_days')::int,
    special_agreements = nullif(btrim(e ->> 'special_agreements'), ''),
    min_adhesions = (e ->> 'min_adhesions')::int,
    max_adhesions = (e ->> 'max_adhesions')::int,
    adhesion_limit_target = e ->> 'adhesion_limit_target',
    contracted_holders = (e ->> 'contracted_holders')::int,
    contracted_dependents = (e ->> 'contracted_dependents')::int,
    excess_mode = e ->> 'excess_mode',
    excess_fixed_cents = (e ->> 'excess_fixed_cents')::bigint,
    excess_holder_fee_cents = (e ->> 'excess_holder_fee_cents')::bigint,
    excess_dependent_fee_cents = (e ->> 'excess_dependent_fee_cents')::bigint,
    billing_basis = e ->> 'billing_basis',
    fixed_monthly_cents = (e ->> 'fixed_monthly_cents')::bigint,
    implantation_includes_dependents = coalesce((e ->> 'implantation_includes_dependents')::boolean, false),
    implantation_status = coalesce(e ->> 'implantation_status', 'COBRAR'),
    implantation_prepaid_holders = (e ->> 'implantation_prepaid_holders')::int,
    min_term_months = (e ->> 'min_term_months')::int,
    early_exit_fee_cents = (e ->> 'early_exit_fee_cents')::bigint
  where c.id = p_company_id;

  if p is null or p = 'null'::jsonb then
    delete from empresarial.adhesion_pricing where company_id = p_company_id;
  else
    insert into empresarial.adhesion_pricing as a (
      company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents,
      dependent_family_extra_fee_cents, dependent_family_size, dependent_mode, max_installments
    ) values (
      p_company_id,
      (p ->> 'holder_fee_cents')::bigint,
      (p ->> 'dependent_individual_fee_cents')::bigint,
      (p ->> 'dependent_family_fee_cents')::bigint,
      (p ->> 'dependent_family_extra_fee_cents')::bigint,
      coalesce((p ->> 'dependent_family_size')::int, 3),
      coalesce(p ->> 'dependent_mode', 'FAMILY_PACKAGE'),
      coalesce((p ->> 'max_installments')::int, 24)
    )
    on conflict (company_id) do update set
      holder_fee_cents = excluded.holder_fee_cents,
      dependent_individual_fee_cents = excluded.dependent_individual_fee_cents,
      dependent_family_fee_cents = excluded.dependent_family_fee_cents,
      dependent_family_extra_fee_cents = excluded.dependent_family_extra_fee_cents,
      dependent_family_size = excluded.dependent_family_size,
      dependent_mode = excluded.dependent_mode,
      max_installments = excluded.max_installments;
  end if;

  delete from empresarial.company_price_tiers where company_id = p_company_id;
  insert into empresarial.company_price_tiers (company_id, min_quantity, price_cents)
  select p_company_id, (f ->> 'min_quantity')::int, (f ->> 'price_cents')::bigint
    from jsonb_array_elements(coalesce(p_terms -> 'faixas', '[]'::jsonb)) f;
end;
$$;
revoke all on function empresarial._aplicar_termos(uuid, jsonb) from public, anon, authenticated;

-- Aplica (R6: só o gestor; R2: com o aditivo anexado). Vale a partir da
-- próxima cobrança gerada (R3): nada já gerado muda.
create or replace function empresarial.apply_contract_revision(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r empresarial.contract_revisions;
  v_agora jsonb;
  v_status_antes text;
begin
  select * into r from empresarial.contract_revisions where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if auth.uid() is null or not empresarial.is_program_manager() then
    raise exception 'NOT_ALLOWED';
  end if;
  if r.status <> 'RASCUNHO' then raise exception 'REVISION_CLOSED'; end if;
  if r.document_file_id is null then raise exception 'DOCUMENT_REQUIRED'; end if;

  v_agora := empresarial._termos_da_empresa(r.company_id);
  if v_agora = r.terms_after then raise exception 'NO_CHANGES'; end if;
  v_status_antes := v_agora -> 'empresa' ->> 'implantation_status';

  perform set_config('empresarial.revisao_em_curso', r.company_id::text, true);
  perform empresarial._aplicar_termos(r.company_id, r.terms_after);
  perform set_config('empresarial.revisao_em_curso', '', true);

  -- R4 + R7: "já paga antes do sistema" cobre os dependentes de hoje — a
  -- implantação dos dependentes novos cobra só quem entrar depois.
  if (r.terms_after -> 'empresa' ->> 'implantation_status') = 'JA_PAGA'
     and coalesce(v_status_antes, 'COBRAR') <> 'JA_PAGA' then
    insert into empresarial.dependents_implantation_coverage
      (company_id, employee_id, dependents_covered, reason, created_by)
    select e.company_id, e.id, count(d.id)::int,
           'Revisão ' || r.code || ': implantação já paga antes do sistema', auth.uid()
      from empresarial.employees e
      join empresarial.dependents d on d.employee_id = e.id and d.status = 'ACTIVE'
     where e.company_id = r.company_id and e.status = 'ACTIVE'
     group by e.company_id, e.id;
  end if;

  update empresarial.contract_revisions
     set status = 'APLICADA', applied_terms_before = v_agora,
         applied_by = auth.uid(), applied_at = now(), updated_at = now()
   where id = p_id;
end;
$$;
revoke all on function empresarial.apply_contract_revision(uuid) from public, anon, authenticated;
grant execute on function empresarial.apply_contract_revision(uuid) to authenticated;

create or replace function empresarial.cancel_contract_revision(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r empresarial.contract_revisions;
begin
  select * into r from empresarial.contract_revisions where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if auth.uid() is null or not empresarial._pode_revisar(r.company_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if r.status <> 'RASCUNHO' then raise exception 'REVISION_CLOSED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'REASON_REQUIRED'; end if;
  update empresarial.contract_revisions
     set status = 'CANCELADA', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = btrim(p_reason), updated_at = now()
   where id = p_id;
end;
$$;
revoke all on function empresarial.cancel_contract_revision(uuid, text) from public, anon, authenticated;
grant execute on function empresarial.cancel_contract_revision(uuid, text) to authenticated;

-- As tabelas novas entram na auditoria.
select public.audit_attach_all();

-- CONFERÊNCIA (só leitura): 4 colunas novas, 2 tabelas, 3 gatilhos da trava e
-- as 5 portas.
select
  (select count(*) from information_schema.columns
    where table_schema = 'empresarial' and table_name = 'companies'
      and column_name in ('min_term_months', 'early_exit_fee_cents', 'implantation_status', 'implantation_prepaid_holders')) as colunas_na_empresa,
  (select count(*) from information_schema.tables
    where table_schema = 'empresarial'
      and table_name in ('contract_revisions', 'dependents_implantation_coverage')) as tabelas,
  (select count(*) from pg_trigger
    where tgname in ('companies_guard_terms', 'adhesion_pricing_guard_terms', 'company_price_tiers_guard_terms')) as gatilhos_da_trava,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial'
      and p.proname in ('open_contract_revision', 'save_contract_revision', 'attach_contract_revision_document',
                        'apply_contract_revision', 'cancel_contract_revision')) as portas;
