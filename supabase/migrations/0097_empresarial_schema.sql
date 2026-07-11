-- =============================================================================
-- 0097 — Módulo Risarte Empresarial (Fase 0, passo 2): schema + tabelas + RLS
-- -----------------------------------------------------------------------------
-- Camada B2B do riSZon: empresas parceiras cujos colaboradores/dependentes viram
-- clientes da Jornada. Mesmo banco, schema PRÓPRIO `empresarial` (ao lado de
-- `public`). Dinheiro sempre em CENTAVOS inteiros (padrão do projeto). FKs para o
-- riSZon: public.clients(id), public.procedures(id), public.clinics(id),
-- public.profiles(id), public.appointments(id).
--
-- REUSA os helpers de RLS do public (is_admin_master, is_network_viewer,
-- user_full_access_clinic_ids, is_sdr) — não recriar.
--
-- >>> PASSO MANUAL DO DONO, UMA VEZ (senão a API não enxerga o schema):
--     Supabase → Project Settings → API → "Exposed schemas" → adicionar
--     `empresarial` → Save. (O código acessa via .schema('empresarial').)
--
-- Idempotente (create ... if not exists, drop policy if exists + create).
-- =============================================================================

create schema if not exists empresarial;

-- -----------------------------------------------------------------------------
-- 1) Papel novo entra na regra de AMBIENTE (Franqueadora). Reescreve a função
--    hardcoded da 0011 incluindo 'rislife_consultant' no ambiente franchisor.
--    (O valor do enum já foi commitado na 0096.)
-- -----------------------------------------------------------------------------
create or replace function public.role_allowed_for_clinic(
  p_role public.user_role,
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (select type from public.clinics where id = p_clinic_id)
    when 'franchisor' then p_role in (
      'sdr','planner_dentist','commercial_consultant',
      'commercial_assistant','franchisor_staff','rislife_consultant'
    )
    when 'franchise_unit' then p_role in (
      'receptionist','clinical_coordinator','dentist','unit_manager',
      'tsb','asb','franchisee'
    )
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- 2) Tabelas
-- -----------------------------------------------------------------------------

-- Empresas parceiras -----------------------------------------------------------
create table if not exists empresarial.companies (
  id uuid primary key default gen_random_uuid(),
  cnpj varchar(14) not null unique,
  legal_name varchar(255) not null,
  trade_name varchar(255),
  state_registration varchar(20),
  address jsonb,
  employee_count int,
  status varchar(20) not null default 'ACTIVE'
    check (status in ('ACTIVE','SUSPENDED','TERMINATED')),
  payment_model varchar(20) not null default 'EMPLOYEE_PAYS'
    check (payment_model in ('COMPANY_PAYS','COMPANY_PARTIAL','EMPLOYEE_PAYS')),
  company_subsidy_type varchar(10)
    check (company_subsidy_type in ('PERCENT','AMOUNT')),
  company_subsidy_value bigint,                     -- % (base 100) ou centavos, conforme o tipo
  due_day int not null default 5,
  assigned_consultant_id uuid references public.profiles (id) on delete set null,
  -- Pagamento e carência (Adendo 01) ------------------------------------------
  payment_methods text[] not null default '{BOLETO,PIX,CARD}',
  default_max_installments int not null default 24,
  contract_started_at date,                         -- início da vigência (base da carência da empresa)
  grace_period_days int not null default 0,         -- carência da EMPRESA (a partir do contrato)
  employee_grace_period_days int not null default 0,-- carência PADRÃO do colaborador (da entrada dele)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists companies_status_idx on empresarial.companies (status);
create index if not exists companies_consultant_idx on empresarial.companies (assigned_consultant_id);

-- Colaboradores (titulares) ----------------------------------------------------
create table if not exists empresarial.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  clinic_id uuid references public.clinics (id) on delete set null, -- espelha clients.clinic_id (RLS por unidade)
  cpf varchar(14) not null,
  full_name varchar(255) not null,
  phone varchar(20) not null,
  email varchar(255),
  status varchar(20) not null default 'ACTIVE'
    check (status in ('ACTIVE','INACTIVE')),
  registration_stage varchar(20) not null default 'PRE_REGISTERED'
    check (registration_stage in ('PRE_REGISTERED','COMPLETED')),
  dependent_plan varchar(20) not null default 'NONE'
    check (dependent_plan in ('NONE','INDIVIDUAL','FAMILY','FAMILY_EXTRA')),
  grace_period_days int,                            -- override da carência deste colaborador (senão usa a da empresa)
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  left_reason varchar(50)
    check (left_reason in ('RESIGNED','DISMISSED','COMPANY_TERMINATED','VOLUNTARY')),
  created_at timestamptz not null default now(),
  unique (company_id, cpf)                          -- CPF único por empresa (não global)
);
create index if not exists employees_company_idx on empresarial.employees (company_id);
create index if not exists employees_client_idx on empresarial.employees (client_id);
create index if not exists employees_clinic_idx on empresarial.employees (clinic_id);
create index if not exists employees_cpf_idx on empresarial.employees (cpf);

-- Dependentes ------------------------------------------------------------------
create table if not exists empresarial.dependents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references empresarial.employees (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  clinic_id uuid references public.clinics (id) on delete set null,
  cpf varchar(14) not null,
  full_name varchar(255),
  phone varchar(20),
  relationship varchar(30) not null
    check (relationship in ('SPOUSE','CHILD','PARENT','OTHER')),
  status varchar(20) not null default 'ACTIVE'
    check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  unique (employee_id, cpf)
);
create index if not exists dependents_employee_idx on empresarial.dependents (employee_id);
create index if not exists dependents_client_idx on empresarial.dependents (client_id);
create index if not exists dependents_clinic_idx on empresarial.dependents (clinic_id);

-- Preços de adesão (company_id NULL = padrão da rede) --------------------------
create table if not exists empresarial.adhesion_pricing (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references empresarial.companies (id) on delete cascade,
  holder_fee_cents bigint not null default 3990,
  dependent_individual_fee_cents bigint not null default 3990,
  dependent_family_fee_cents bigint not null default 5990,
  dependent_family_extra_fee_cents bigint not null default 1990,
  max_installments int not null default 24,
  created_at timestamptz not null default now(),
  unique nulls not distinct (company_id)
);

-- Regras de split (company_id NULL = padrão da rede) ---------------------------
create table if not exists empresarial.split_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references empresarial.companies (id) on delete cascade,
  first_payment_risarte_pct numeric(5,2) not null default 0,
  first_payment_rislife_pct numeric(5,2) not null default 100,
  recurring_risarte_pct numeric(5,2) not null default 50,
  recurring_rislife_pct numeric(5,2) not null default 50,
  created_at timestamptz not null default now(),
  unique nulls not distinct (company_id)
);

-- Benefícios clínicos por procedimento (company_id NULL = padrão da rede) ------
-- Enriquecida (Adendo 01): cobertura, desconto, frequência, limite, carência,
-- parcelamento. Regra: até usage_limit_count usos a cada usage_period_months.
create table if not exists empresarial.procedure_benefits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references empresarial.companies (id) on delete cascade,
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  benefit_type varchar(20) not null
    check (benefit_type in ('DISCOUNT_PERCENT','DISCOUNT_AMOUNT','FREE','NOT_COVERED')),
  benefit_value numeric(12,2),                      -- % (0-100) p/ PERCENT; centavos p/ AMOUNT; ignorado p/ FREE/NOT_COVERED
  usage_limit_count int,                            -- NULL = ilimitado
  usage_period_months int,                          -- NULL = sem janela; ex.: 6 = a cada 6 meses
  grace_period_months int not null default 0,       -- carência do benefício (da entrada do colaborador)
  max_installments int,                             -- parcelamento do procedimento (override)
  created_at timestamptz not null default now(),
  unique nulls not distinct (company_id, procedure_id)
);
create index if not exists procedure_benefits_company_idx on empresarial.procedure_benefits (company_id);
create index if not exists procedure_benefits_procedure_idx on empresarial.procedure_benefits (procedure_id);

-- Uso de benefícios (acompanhamento, bloqueio de frequência, economia) ---------
create table if not exists empresarial.benefit_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid references public.clinics (id) on delete set null,
  company_id uuid references empresarial.companies (id) on delete set null,
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  benefit_id uuid references empresarial.procedure_benefits (id) on delete set null,
  member_role varchar(20) not null default 'HOLDER'
    check (member_role in ('HOLDER','DEPENDENT')),
  used_at timestamptz not null default now(),
  appointment_id uuid references public.appointments (id) on delete set null,
  amount_full_cents bigint,
  amount_charged_cents bigint,
  amount_saved_cents bigint,
  created_at timestamptz not null default now()
);
create index if not exists benefit_usage_client_proc_idx
  on empresarial.benefit_usage (client_id, procedure_id, used_at);
create index if not exists benefit_usage_company_idx on empresarial.benefit_usage (company_id);
create index if not exists benefit_usage_clinic_idx on empresarial.benefit_usage (clinic_id);

-- Faturamento de adesão --------------------------------------------------------
create table if not exists empresarial.adhesion_billing (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  billing_type varchar(20) not null
    check (billing_type in ('IMPLANTATION','MONTHLY')),
  reference_month date,
  asaas_billing_id varchar(100),
  total_amount_cents bigint not null,
  status varchar(20) not null default 'PENDING'
    check (status in ('PENDING','PAID','OVERDUE')),
  due_date date,
  paid_at timestamptz,
  split_risarte_cents bigint,
  split_rislife_cents bigint,
  created_at timestamptz not null default now()
);
create index if not exists adhesion_billing_company_idx on empresarial.adhesion_billing (company_id, status);

-- Histórico de vínculo com o programa (mantido após a saída) -------------------
create table if not exists empresarial.membership_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid references public.clinics (id) on delete set null,
  company_id uuid references empresarial.companies (id) on delete set null,
  member_role varchar(20) not null
    check (member_role in ('HOLDER','DEPENDENT')),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists membership_history_client_idx on empresarial.membership_history (client_id);
create index if not exists membership_history_company_idx on empresarial.membership_history (company_id);

-- Riso+ Social -----------------------------------------------------------------
create table if not exists empresarial.social_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references empresarial.companies (id) on delete cascade,
  trigger_type varchar(30) not null
    check (trigger_type in ('EMPLOYEE_COUNT','TIME_IN_PROGRAM','ATTENDANCE','TREATMENT_SPEND')),
  is_pool boolean not null default false,
  status varchar(20) not null default 'AVAILABLE'
    check (status in ('AVAILABLE','ASSIGNED','USED')),
  beneficiary_client_id uuid references public.clients (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists social_tokens_company_idx on empresarial.social_tokens (company_id);

-- Funil comercial (leads de empresas) ------------------------------------------
create table if not exists empresarial.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  company_name varchar(255) not null,
  cnpj varchar(14),
  contact_name varchar(255),
  contact_phone varchar(20),
  stage varchar(30) not null default 'CAPTURE'
    check (stage in ('CAPTURE','CONTACT','MEETING_SCHEDULED','PRESENTED',
                     'PROPOSAL_SENT','FOLLOW_UP','CLOSED_WON','CLOSED_LOST')),
  consultant_id uuid references public.profiles (id) on delete set null,
  lost_reason varchar(255),
  company_id uuid references empresarial.companies (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commercial_leads_stage_idx on empresarial.commercial_leads (stage);
create index if not exists commercial_leads_consultant_idx on empresarial.commercial_leads (consultant_id);

-- updated_at ------------------------------------------------------------------
drop trigger if exists companies_set_updated_at on empresarial.companies;
create trigger companies_set_updated_at
  before update on empresarial.companies
  for each row execute function public.set_updated_at();

drop trigger if exists commercial_leads_set_updated_at on empresarial.commercial_leads;
create trigger commercial_leads_set_updated_at
  before update on empresarial.commercial_leads
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3) Helpers de RLS do módulo (SECURITY DEFINER, evitam recursão de policy)
-- -----------------------------------------------------------------------------
-- Quem gerencia o programa por inteiro: Admin, Franqueadora (rede) ou Consultor
-- RisLife (em qualquer clínica).
create or replace function empresarial.is_program_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_network_viewer()
      or exists (
        select 1 from public.user_clinic_roles ucr
        where ucr.user_id = (select auth.uid())
          and ucr.role = 'rislife_consultant'
      );
$$;

-- Empresas que o usuário pode ver: gestor do programa vê todas; o consultor vê
-- as que gerencia; a unidade vê as que têm colaborador na sua clínica.
create or replace function empresarial.accessible_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from empresarial.companies c
  where empresarial.is_program_manager()
     or c.assigned_consultant_id = (select auth.uid())
  union
  select distinct e.company_id
  from empresarial.employees e
  where e.clinic_id in (select public.user_full_access_clinic_ids());
$$;

grant execute on function empresarial.is_program_manager() to authenticated;
grant execute on function empresarial.accessible_company_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- 4) Row Level Security
-- -----------------------------------------------------------------------------
alter table empresarial.companies enable row level security;
alter table empresarial.employees enable row level security;
alter table empresarial.dependents enable row level security;
alter table empresarial.adhesion_pricing enable row level security;
alter table empresarial.split_rules enable row level security;
alter table empresarial.procedure_benefits enable row level security;
alter table empresarial.benefit_usage enable row level security;
alter table empresarial.adhesion_billing enable row level security;
alter table empresarial.membership_history enable row level security;
alter table empresarial.social_tokens enable row level security;
alter table empresarial.commercial_leads enable row level security;

-- companies ---------------------------------------------------------------------
drop policy if exists companies_select on empresarial.companies;
create policy companies_select on empresarial.companies for select to authenticated
  using (id in (select empresarial.accessible_company_ids()));

drop policy if exists companies_insert on empresarial.companies;
create policy companies_insert on empresarial.companies for insert to authenticated
  with check (empresarial.is_program_manager());

drop policy if exists companies_update on empresarial.companies;
create policy companies_update on empresarial.companies for update to authenticated
  using (empresarial.is_program_manager()
         or assigned_consultant_id = (select auth.uid()))
  with check (empresarial.is_program_manager()
              or assigned_consultant_id = (select auth.uid()));

drop policy if exists companies_delete on empresarial.companies;
create policy companies_delete on empresarial.companies for delete to authenticated
  using (public.is_admin_master());

-- employees / dependents / membership_history / benefit_usage (por unidade) -----
-- Leitura: admin/rede, unidade dona (clinic_id) ou consultor pela empresa.
drop policy if exists employees_select on empresarial.employees;
create policy employees_select on empresarial.employees for select to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or clinic_id in (select public.user_full_access_clinic_ids())
         or company_id in (select empresarial.accessible_company_ids()));

drop policy if exists employees_write on empresarial.employees;
create policy employees_write on empresarial.employees for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager() or public.is_sdr()
         or clinic_id in (select public.user_full_access_clinic_ids()))
  with check (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager() or public.is_sdr()
         or clinic_id in (select public.user_full_access_clinic_ids()));

drop policy if exists dependents_select on empresarial.dependents;
create policy dependents_select on empresarial.dependents for select to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or clinic_id in (select public.user_full_access_clinic_ids())
         or employee_id in (select e.id from empresarial.employees e
                            where e.company_id in (select empresarial.accessible_company_ids())));

drop policy if exists dependents_write on empresarial.dependents;
create policy dependents_write on empresarial.dependents for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager() or public.is_sdr()
         or clinic_id in (select public.user_full_access_clinic_ids()))
  with check (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager() or public.is_sdr()
         or clinic_id in (select public.user_full_access_clinic_ids()));

drop policy if exists membership_history_select on empresarial.membership_history;
create policy membership_history_select on empresarial.membership_history for select to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or clinic_id in (select public.user_full_access_clinic_ids())
         or company_id in (select empresarial.accessible_company_ids()));

drop policy if exists membership_history_write on empresarial.membership_history;
create policy membership_history_write on empresarial.membership_history for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager()
         or clinic_id in (select public.user_full_access_clinic_ids()))
  with check (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager()
         or clinic_id in (select public.user_full_access_clinic_ids()));

drop policy if exists benefit_usage_select on empresarial.benefit_usage;
create policy benefit_usage_select on empresarial.benefit_usage for select to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or clinic_id in (select public.user_full_access_clinic_ids())
         or company_id in (select empresarial.accessible_company_ids()));

drop policy if exists benefit_usage_write on empresarial.benefit_usage;
create policy benefit_usage_write on empresarial.benefit_usage for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager()
         or clinic_id in (select public.user_full_access_clinic_ids()))
  with check (public.is_admin_master() or public.is_network_viewer()
         or empresarial.is_program_manager()
         or clinic_id in (select public.user_full_access_clinic_ids()));

-- Config do programa: pricing / split / procedure_benefits ----------------------
-- Leitura: gestor do programa OU linha da rede (company_id null) OU empresa acessível.
-- Escrita: linha da rede = admin/rede; linha de empresa = gestor do programa da empresa.
do $$
declare t text;
begin
  foreach t in array array['adhesion_pricing','split_rules','procedure_benefits'] loop
    execute format('drop policy if exists %I_select on empresarial.%I', t, t);
    execute format($f$
      create policy %1$I_select on empresarial.%1$I for select to authenticated
      using (empresarial.is_program_manager()
             or company_id is null
             or company_id in (select empresarial.accessible_company_ids()))
    $f$, t);

    execute format('drop policy if exists %I_write on empresarial.%I', t, t);
    execute format($f$
      create policy %1$I_write on empresarial.%1$I for all to authenticated
      using (
        case when company_id is null
          then (public.is_admin_master() or public.is_network_viewer())
          else (empresarial.is_program_manager()
                and company_id in (select empresarial.accessible_company_ids()))
        end)
      with check (
        case when company_id is null
          then (public.is_admin_master() or public.is_network_viewer())
          else (empresarial.is_program_manager()
                and company_id in (select empresarial.accessible_company_ids()))
        end)
    $f$, t);
  end loop;
end $$;

-- adhesion_billing --------------------------------------------------------------
drop policy if exists adhesion_billing_select on empresarial.adhesion_billing;
create policy adhesion_billing_select on empresarial.adhesion_billing for select to authenticated
  using (empresarial.is_program_manager()
         or company_id in (select empresarial.accessible_company_ids()));

drop policy if exists adhesion_billing_write on empresarial.adhesion_billing;
create policy adhesion_billing_write on empresarial.adhesion_billing for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer())
  with check (public.is_admin_master() or public.is_network_viewer());

-- social_tokens -----------------------------------------------------------------
drop policy if exists social_tokens_select on empresarial.social_tokens;
create policy social_tokens_select on empresarial.social_tokens for select to authenticated
  using (empresarial.is_program_manager()
         or company_id in (select empresarial.accessible_company_ids()));

drop policy if exists social_tokens_write on empresarial.social_tokens;
create policy social_tokens_write on empresarial.social_tokens for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer())
  with check (public.is_admin_master() or public.is_network_viewer());

-- commercial_leads --------------------------------------------------------------
drop policy if exists commercial_leads_select on empresarial.commercial_leads;
create policy commercial_leads_select on empresarial.commercial_leads for select to authenticated
  using (empresarial.is_program_manager()
         or consultant_id = (select auth.uid()));

drop policy if exists commercial_leads_write on empresarial.commercial_leads;
create policy commercial_leads_write on empresarial.commercial_leads for all to authenticated
  using (empresarial.is_program_manager() or consultant_id = (select auth.uid()))
  with check (empresarial.is_program_manager() or consultant_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 5) Grants (a RLS acima é a barreira real; sem grant a API nem chega na tabela)
-- -----------------------------------------------------------------------------
grant usage on schema empresarial to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema empresarial to authenticated;
grant all on all tables in schema empresarial to service_role;
alter default privileges in schema empresarial
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema empresarial
  grant all on tables to service_role;

-- -----------------------------------------------------------------------------
-- 6) Seeds: padrão da rede (company_id NULL). Só cria se ainda não existir.
-- -----------------------------------------------------------------------------
insert into empresarial.adhesion_pricing (company_id)
select null
where not exists (select 1 from empresarial.adhesion_pricing where company_id is null);

insert into empresarial.split_rules (company_id)
select null
where not exists (select 1 from empresarial.split_rules where company_id is null);
