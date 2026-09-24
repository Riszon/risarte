-- =============================================================================
-- 1019 — AS UNIDADES DA PARCERIA (OC-00083, I3)
--
-- Pedido do dono (24/09/2026): "quando vai criar uma proposta deve ter como
-- indicar qual é a unidade principal para esta parceria e quais são as outras
-- unidades que os beneficiários estarão vinculados e poderão utilizar.
-- Inclusive durante a definição dos benefícios quais são as unidades que
-- poderão realizar os procedimentos de custo zero por exemplo."
--
-- Decisão dele entre as três formas: **unidade principal + vinculadas, com
-- exceção por benefício**. Por padrão todo benefício vale em todas as
-- unidades da parceria; cada um pode restringir as suas.
--
-- ⚠️ NULO E VAZIO SIGNIFICAM "TODAS", e isso é o que faz toda proposta e toda
-- empresa que já existem continuarem exatamente como estão. Parceria sem
-- unidade declarada não é parceria sem atendimento — é parceria que não
-- combinou restrição nenhuma.
--
-- Idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A unidade principal e as unidades da PROPOSTA
-- -----------------------------------------------------------------------------
alter table empresarial.lead_qualification
  add column if not exists main_clinic_id uuid
    references public.clinics (id) on delete set null;

comment on column empresarial.lead_qualification.main_clinic_id is
  'A unidade principal desta parceria — a que responde pela empresa. NULO '
  'enquanto não foi combinada.';

-- As outras unidades onde os beneficiários podem ser atendidos.
--
-- Tabela e não `uuid[]` de propósito: a chave estrangeira impede que uma
-- unidade apagada deixe um id solto apontando para lugar nenhum, e é por esta
-- lista que a tela do benefício monta as opções.
create table if not exists empresarial.lead_clinics (
  lead_id uuid not null references empresarial.commercial_leads (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lead_id, clinic_id)
);

alter table empresarial.lead_clinics enable row level security;

drop policy if exists lead_clinics_all on empresarial.lead_clinics;
create policy lead_clinics_all
  on empresarial.lead_clinics
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete on empresarial.lead_clinics to authenticated;
grant all on empresarial.lead_clinics to service_role;

-- -----------------------------------------------------------------------------
-- 2) A exceção POR BENEFÍCIO
-- -----------------------------------------------------------------------------
--
-- ⚠️ AQUI É `uuid[]`, e a diferença com a tabela acima é deliberada: os
-- benefícios da proposta são APAGADOS E REESCRITOS a cada salvar (o conjunto
-- é substituído inteiro). Uma tabela filha exigiria recriar os vínculos a cada
-- gravação, e bastaria um esquecimento para a restrição sumir em silêncio —
-- que é o pior defeito possível numa regra de "onde este benefício vale".
--
-- NULO ou VAZIO = todas as unidades da parceria. Id que não esteja mais entre
-- as unidades da parceria é ignorado na leitura, e não vira erro: unidade que
-- saiu da parceria simplesmente deixa de contar.
alter table empresarial.lead_benefits
  add column if not exists clinic_ids uuid[];

comment on column empresarial.lead_benefits.clinic_ids is
  'Em quais unidades ESTE benefício vale. NULO ou vazio = todas as unidades '
  'da parceria. Sem chave estrangeira de propósito: a linha é reescrita a '
  'cada salvar, e a leitura cruza com as unidades da parceria.';

-- -----------------------------------------------------------------------------
-- 3) O mesmo no CADASTRO da empresa, para o fechamento ter onde escrever
-- -----------------------------------------------------------------------------
alter table empresarial.companies
  add column if not exists main_clinic_id uuid
    references public.clinics (id) on delete set null;

comment on column empresarial.companies.main_clinic_id is
  'A unidade principal da parceria, vinda da proposta no fechamento.';

create table if not exists empresarial.company_clinics (
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, clinic_id)
);

alter table empresarial.company_clinics enable row level security;

drop policy if exists company_clinics_select on empresarial.company_clinics;
create policy company_clinics_select
  on empresarial.company_clinics for select to authenticated
  using (company_id in (select empresarial.accessible_company_ids()));

drop policy if exists company_clinics_write on empresarial.company_clinics;
create policy company_clinics_write
  on empresarial.company_clinics for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

grant select, insert, update, delete on empresarial.company_clinics to authenticated;
grant all on empresarial.company_clinics to service_role;

-- O "onde vale" também no benefício da empresa — é esta tabela que o motor de
-- orçamento consulta, e sem a coluna aqui a restrição feita na proposta se
-- perderia no fechamento (a mesma lição do "para quem vale", na 1016).
alter table empresarial.procedure_benefits
  add column if not exists clinic_ids uuid[];

comment on column empresarial.procedure_benefits.clinic_ids is
  'Em quais unidades este benefício vale. NULO ou vazio = todas as unidades '
  'da parceria (e, sem parceria declarada, todas em que a pessoa for '
  'atendida). É o motor de orçamento que aplica.';
