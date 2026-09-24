-- =============================================================================
-- 1016 — OS BENEFÍCIOS ENTRAM NA PROPOSTA, E VIRAM GRUPOS (OC-00083, H2)
--
-- Pedido do dono (23/09/2026): "Na proposta deve ter como configurar a
-- vantagem e os benefícios... Cada benefício deve ter como assinalar se vale
-- para os Titulares e para os Dependentes (como padrão vir marcado para os
-- dois). Deve ter a possibilidade de criar grupos de benefícios dos
-- procedimentos, para não precisar ficar configurando um benefício por vez em
-- cada elaboração de proposta."
--
-- Três coisas aqui, e a ordem importa:
--
--   1) `procedure_benefits` ganha PARA QUEM VALE. É a tabela que o motor de
--      benefícios já consulta na hora do orçamento — sem a coluna lá, a marca
--      feita na proposta seria enfeite: o fechamento a perderia, e o desconto
--      apareceria para o dependente de qualquer jeito.
--   2) `lead_benefits` — o que foi combinado NA PROPOSTA, antes de existir
--      empresa. Tabela própria de propósito: enquanto o negócio não fecha, não
--      há `company_id` para pendurar, e escrever em `procedure_benefits` com
--      empresa nula sobrescreveria o PADRÃO DA REDE inteiro.
--   3) `benefit_groups` — combinações prontas (Básico, Completo, Preventivo),
--      para não configurar procedimento por procedimento em toda proposta.
--
-- Tudo idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Para quem o benefício vale
-- -----------------------------------------------------------------------------
--
-- ⚠️ NOT NULL COM PADRÃO `true`, e aqui isto NÃO contraria a lição da 0230
-- (coluna anulável em cascata). Não é configuração que herda da rede: é uma
-- afirmação sobre o benefício, e "não sei para quem vale" não é uma resposta
-- útil no meio de um orçamento. Todo benefício que já existe valia para os
-- dois — `true` preserva exatamente o comportamento de hoje.
alter table empresarial.procedure_benefits
  add column if not exists for_holder boolean not null default true,
  add column if not exists for_dependent boolean not null default true;

comment on column empresarial.procedure_benefits.for_holder is
  'O benefício vale para o TITULAR. Falso nos dois campos seria benefício que '
  'não alcança ninguém — a trava abaixo recusa.';
comment on column empresarial.procedure_benefits.for_dependent is
  'O benefício vale para o DEPENDENTE.';

-- Benefício que não vale para ninguém é linha que só confunde: quem quer tirar
-- a cobertura usa `NOT_COVERED`, que é uma decisão declarada.
do $$
begin
  alter table empresarial.procedure_benefits
    add constraint procedure_benefits_vale_para_alguem
    check (for_holder or for_dependent);
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Os benefícios combinados na PROPOSTA
-- -----------------------------------------------------------------------------
create table if not exists empresarial.lead_benefits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references empresarial.commercial_leads (id) on delete cascade,
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  benefit_type varchar(20) not null
    check (benefit_type in ('DISCOUNT_PERCENT','DISCOUNT_AMOUNT','FREE','NOT_COVERED')),
  -- % (0-100) para PERCENT; centavos para AMOUNT; ignorado nos demais.
  benefit_value numeric(12,2),
  usage_limit_count int,        -- NULL = ilimitado
  usage_period_months int,      -- NULL = sem janela
  grace_period_months int not null default 0,
  max_installments int,
  for_holder boolean not null default true,
  for_dependent boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, procedure_id),
  constraint lead_benefits_vale_para_alguem check (for_holder or for_dependent)
);
create index if not exists lead_benefits_lead_idx
  on empresarial.lead_benefits (lead_id);

drop trigger if exists lead_benefits_set_updated_at on empresarial.lead_benefits;
create trigger lead_benefits_set_updated_at
  before update on empresarial.lead_benefits
  for each row execute function public.set_updated_at();

alter table empresarial.lead_benefits enable row level security;

drop policy if exists lead_benefits_all on empresarial.lead_benefits;
create policy lead_benefits_all
  on empresarial.lead_benefits
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete on empresarial.lead_benefits to authenticated;
grant all on empresarial.lead_benefits to service_role;

-- -----------------------------------------------------------------------------
-- 3) Grupos de benefícios — combinações prontas, da REDE
-- -----------------------------------------------------------------------------
--
-- Sem escopo de empresa ou de consultor, por decisão do dono: os grupos são da
-- rede, para que as propostas se pareçam entre si. Quem monta uma combinação
-- boa numa proposta pode salvá-la como grupo novo para todo mundo.
create table if not exists empresarial.benefit_groups (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

drop trigger if exists benefit_groups_set_updated_at on empresarial.benefit_groups;
create trigger benefit_groups_set_updated_at
  before update on empresarial.benefit_groups
  for each row execute function public.set_updated_at();

create table if not exists empresarial.benefit_group_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references empresarial.benefit_groups (id) on delete cascade,
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  benefit_type varchar(20) not null
    check (benefit_type in ('DISCOUNT_PERCENT','DISCOUNT_AMOUNT','FREE','NOT_COVERED')),
  benefit_value numeric(12,2),
  usage_limit_count int,
  usage_period_months int,
  grace_period_months int not null default 0,
  max_installments int,
  for_holder boolean not null default true,
  for_dependent boolean not null default true,
  created_at timestamptz not null default now(),
  unique (group_id, procedure_id),
  constraint benefit_group_items_vale_para_alguem check (for_holder or for_dependent)
);
create index if not exists benefit_group_items_group_idx
  on empresarial.benefit_group_items (group_id);

alter table empresarial.benefit_groups enable row level security;
alter table empresarial.benefit_group_items enable row level security;

-- Quem enxerga o programa LÊ os grupos (o consultor precisa aplicá-los);
-- criar, alterar e apagar é ato de gestor do programa, porque muda o que a
-- rede inteira oferece.
drop policy if exists benefit_groups_select on empresarial.benefit_groups;
create policy benefit_groups_select
  on empresarial.benefit_groups for select to authenticated
  using (true);

drop policy if exists benefit_groups_write on empresarial.benefit_groups;
create policy benefit_groups_write
  on empresarial.benefit_groups for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

drop policy if exists benefit_group_items_select on empresarial.benefit_group_items;
create policy benefit_group_items_select
  on empresarial.benefit_group_items for select to authenticated
  using (true);

drop policy if exists benefit_group_items_write on empresarial.benefit_group_items;
create policy benefit_group_items_write
  on empresarial.benefit_group_items for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

grant select, insert, update, delete on empresarial.benefit_groups to authenticated;
grant select, insert, update, delete on empresarial.benefit_group_items to authenticated;
grant all on empresarial.benefit_groups to service_role;
grant all on empresarial.benefit_group_items to service_role;

-- -----------------------------------------------------------------------------
-- 4) Um grupo de partida, semeado do que a REDE já oferece
-- -----------------------------------------------------------------------------
--
-- Nasce do padrão da rede (`procedure_benefits` com company_id nulo) em vez de
-- uma lista inventada aqui: é o que a Risarte já pratica hoje. Se ainda não
-- houver padrão da rede, NENHUM grupo é criado — grupo vazio com nome bonito
-- seria pior que grupo nenhum, porque alguém o aplicaria achando que faz algo.
do $$
declare
  v_group uuid;
  v_qtd int;
begin
  select count(*) into v_qtd
  from empresarial.procedure_benefits
  where company_id is null;

  if v_qtd = 0 then
    return;
  end if;

  select id into v_group from empresarial.benefit_groups where name = 'Padrão da rede';
  if v_group is null then
    insert into empresarial.benefit_groups (name, description)
    values (
      'Padrão da rede',
      'O que a rede já oferece hoje. Serve de ponto de partida: aplique e ajuste o que a negociação pedir.'
    )
    returning id into v_group;
  end if;

  insert into empresarial.benefit_group_items (
    group_id, procedure_id, benefit_type, benefit_value,
    usage_limit_count, usage_period_months, grace_period_months, max_installments
  )
  select
    v_group, b.procedure_id, b.benefit_type, b.benefit_value,
    b.usage_limit_count, b.usage_period_months, b.grace_period_months, b.max_installments
  from empresarial.procedure_benefits b
  where b.company_id is null
  on conflict (group_id, procedure_id) do nothing;
end $$;
