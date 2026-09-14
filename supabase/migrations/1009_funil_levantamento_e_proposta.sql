-- =============================================================================
-- 1009 — Risarte Empresarial: o levantamento do consultor e os dados da proposta
-- -----------------------------------------------------------------------------
-- Bloco C1 do funil (ver docs/risarte-empresarial/FUNIL-COMERCIAL.md).
--
-- A fase 4 (Apresentado) é onde o consultor sai da conversa com o que precisa
-- para montar uma proposta que sirva ÀQUELA empresa. Hoje isso mora na cabeça
-- dele e numa anotação solta; aqui vira campo, e campo vira número no painel.
--
-- UMA TABELA, DOIS ASSUNTOS, de propósito:
--
-- 1) O LEVANTAMENTO — convênio atual e quanto paga, outros benefícios, ações
--    sociais, interesse e chance de sucesso. É o que explica por que a proposta
--    ficou daquele jeito, e é o que permite comparar a oferta com o que a
--    empresa já tem.
--
-- 2) OS DADOS COMERCIAIS E DO CONTRATO — quem paga, quantos colaboradores,
--    dependentes, um CNPJ ou conjunto, por colaborador ou valor fixo, mais
--    razão social, endereço e representante legal.
--
--    ⚠️ Estes campos ESPELHAM `empresarial.companies` (mesmos nomes, mesmas
--    listas). Não é repetição à toa: a empresa só nasce no fechamento, e sem
--    um lugar para guardar antes, o consultor digitaria tudo duas vezes — uma
--    para a proposta e outra depois. No fechamento eles VIAJAM para a empresa.
--
-- Uma linha por lead (`unique`): levantamento é retrato do estado atual da
-- conversa, não histórico. O que muda ao longo do tempo já está na linha do
-- tempo e nas tentativas de contato.
--
-- Idempotente.
-- =============================================================================

create table if not exists empresarial.lead_qualification (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique
    references empresarial.commercial_leads (id) on delete cascade,

  -- 1) O levantamento -------------------------------------------------------
  -- `has_dental_plan` é ANULÁVEL de propósito: "não perguntei" e "não tem"
  -- são coisas diferentes, e tratá-las como iguais faria o painel contar como
  -- "sem convênio" toda empresa que ninguém investigou.
  has_dental_plan boolean,
  dental_plan_name varchar(255),
  dental_plan_monthly_cents bigint,          -- quanto a empresa paga HOJE, no total
  other_benefits text,
  social_projects boolean,
  social_projects_note text,
  interest_level varchar(10)
    check (interest_level is null or interest_level in ('LOW','MEDIUM','HIGH')),
  -- Percepção do consultor, 0 a 100. É palpite declarado como palpite.
  success_chance smallint
    check (success_chance is null or (success_chance >= 0 and success_chance <= 100)),

  -- 2) Dados comerciais da proposta -----------------------------------------
  payment_model varchar(20)
    check (payment_model is null or payment_model in
           ('COMPANY_PAYS','COMPANY_PARTIAL','EMPLOYEE_PAYS')),
  subsidy_type varchar(10)
    check (subsidy_type is null or subsidy_type in ('PERCENT','AMOUNT')),
  subsidy_value bigint,                      -- % (base 100) ou centavos POR COLABORADOR
  employee_count int check (employee_count is null or employee_count >= 0),
  includes_dependents boolean,
  dependents_estimate int
    check (dependents_estimate is null or dependents_estimate >= 0),
  -- 'unico' = uma empresa/CNPJ; 'por_cnpj' = conjunto (mesma lista de companies).
  billing_model varchar(10)
    check (billing_model is null or billing_model in ('unico','por_cnpj')),
  -- Por colaborador é o padrão. Valor fixo por empresa é a regra comercial
  -- alternativa, necessária para sindicato e associação.
  billing_basis varchar(20)
    check (billing_basis is null or billing_basis in
           ('PER_EMPLOYEE','FIXED_PER_COMPANY')),
  holder_fee_cents bigint,
  dependent_fee_cents bigint,
  fixed_monthly_cents bigint,
  implantation_per_employee_cents bigint,

  -- 3) Dados para gerar proposta e contrato ---------------------------------
  legal_name varchar(255),
  category varchar(20)
    check (category is null or category in (
      'empresa_privada','orgao_publico','consorcio','condominio',
      'produtor_rural','autonomo','obra_civil','estrangeiro'
    )),
  address jsonb,
  responsible_name varchar(255),
  responsible_role varchar(120),
  responsible_cpf varchar(14),
  responsible_email varchar(255),
  responsible_phone varchar(20),

  notes text,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_qualification_lead_idx
  on empresarial.lead_qualification (lead_id);

drop trigger if exists lead_qualification_set_updated_at
  on empresarial.lead_qualification;
create trigger lead_qualification_set_updated_at
  before update on empresarial.lead_qualification
  for each row execute function public.set_updated_at();

alter table empresarial.lead_qualification enable row level security;

drop policy if exists lead_qualification_select on empresarial.lead_qualification;
create policy lead_qualification_select on empresarial.lead_qualification
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

drop policy if exists lead_qualification_write on empresarial.lead_qualification;
create policy lead_qualification_write on empresarial.lead_qualification
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete
  on empresarial.lead_qualification to authenticated;
grant all on empresarial.lead_qualification to service_role;

comment on table empresarial.lead_qualification is
  'Levantamento do consultor e dados comerciais do lead (fase 4 do funil). '
  'Os campos de contrato espelham empresarial.companies e VIAJAM para lá no '
  'fechamento — a empresa só existe depois do ganho.';
