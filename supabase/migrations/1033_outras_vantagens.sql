-- =============================================================================
-- 1033 — AS OUTRAS VANTAGENS DO PROGRAMA (além dos procedimentos)
-- -----------------------------------------------------------------------------
-- Pedido do dono (26/10/2026): "além dos procedimentos deve ter como inserir
-- outras formas de benefícios como por exemplo: desconto em parceiros,
-- palestras na empresa, publicidade da empresa nas tvs das unidades Risarte
-- que for selecionada como principal, criar unidade específica para
-- atendimento da empresa e etc."
--
-- Decisões dele, na mesma conversa:
--   1. CATÁLOGO DA REDE + DETALHE NA PROPOSTA. A rede cadastra a vantagem
--      (nome e descrição); a proposta escolhe quais entram e escreve o
--      detalhe daquela empresa ("2 palestras por ano"). Entram nos grupos.
--   2. VIRAM COMPROMISSOS no fechamento, com situação acompanhada (pendente,
--      em andamento, entregue) — é promessa de entrega, não desconto.
--   3. ENTRAM NO CONTRATO gerado pelo sistema.
--
-- ⚠️ O COMPROMISSO GUARDA O NOME E O DETALHE (cópia), não só a referência ao
-- catálogo: o que foi assinado não pode mudar porque alguém renomeou a
-- vantagem em Configurações depois. Mesma lei do preço congelado.
--
-- Só cria tabelas novas. Não altera nem apaga nada. Idempotente.
-- =============================================================================

-- ---- 1) O catálogo da rede ---------------------------------------------------
create table if not exists empresarial.perks (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);
comment on table empresarial.perks is
  'Outras vantagens do programa (além dos procedimentos): desconto em '
  'parceiros, palestras, publicidade nas TVs, unidade exclusiva… (1033).';

drop trigger if exists perks_set_updated_at on empresarial.perks;
create trigger perks_set_updated_at
  before update on empresarial.perks
  for each row execute function public.set_updated_at();

alter table empresarial.perks enable row level security;
drop policy if exists perks_select on empresarial.perks;
create policy perks_select
  on empresarial.perks for select to authenticated
  using (true);
drop policy if exists perks_write on empresarial.perks;
create policy perks_write
  on empresarial.perks for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());
grant select, insert, update, delete on empresarial.perks to authenticated;
grant all on empresarial.perks to service_role;

-- ---- 2) As vantagens da proposta ---------------------------------------------
create table if not exists empresarial.lead_perks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references empresarial.commercial_leads (id) on delete cascade,
  -- RESTRICT: vantagem usada numa proposta não se apaga; desativa-se.
  perk_id uuid not null references empresarial.perks (id) on delete restrict,
  detail text,
  sort_order int not null default 0,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, perk_id)
);
create index if not exists lead_perks_lead_idx on empresarial.lead_perks (lead_id);

drop trigger if exists lead_perks_set_updated_at on empresarial.lead_perks;
create trigger lead_perks_set_updated_at
  before update on empresarial.lead_perks
  for each row execute function public.set_updated_at();

alter table empresarial.lead_perks enable row level security;
drop policy if exists lead_perks_all on empresarial.lead_perks;
create policy lead_perks_all
  on empresarial.lead_perks
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));
grant select, insert, update, delete on empresarial.lead_perks to authenticated;
grant all on empresarial.lead_perks to service_role;

-- ---- 3) As vantagens dos grupos ----------------------------------------------
create table if not exists empresarial.benefit_group_perks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references empresarial.benefit_groups (id) on delete cascade,
  perk_id uuid not null references empresarial.perks (id) on delete restrict,
  -- O detalhe que o grupo sugere; a proposta pode reescrever.
  detail text,
  created_at timestamptz not null default now(),
  unique (group_id, perk_id)
);
create index if not exists benefit_group_perks_group_idx
  on empresarial.benefit_group_perks (group_id);

alter table empresarial.benefit_group_perks enable row level security;
drop policy if exists benefit_group_perks_select on empresarial.benefit_group_perks;
create policy benefit_group_perks_select
  on empresarial.benefit_group_perks for select to authenticated
  using (true);
drop policy if exists benefit_group_perks_write on empresarial.benefit_group_perks;
create policy benefit_group_perks_write
  on empresarial.benefit_group_perks for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());
grant select, insert, update, delete on empresarial.benefit_group_perks to authenticated;
grant all on empresarial.benefit_group_perks to service_role;

-- ---- 4) Os compromissos da empresa (o que foi prometido, e se foi entregue) --
create table if not exists empresarial.company_perks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  perk_id uuid references empresarial.perks (id) on delete set null,
  -- CÓPIA do que foi vendido: renomear a vantagem no catálogo não reescreve o
  -- que a empresa assinou.
  name varchar(120) not null,
  detail text,
  status varchar(16) not null default 'PENDING'
    check (status in ('PENDING', 'IN_PROGRESS', 'DELIVERED')),
  status_note text,
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id) on delete set null,
  origin_lead_id uuid references empresarial.commercial_leads (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_perks_company_idx on empresarial.company_perks (company_id);

drop trigger if exists company_perks_set_updated_at on empresarial.company_perks;
create trigger company_perks_set_updated_at
  before update on empresarial.company_perks
  for each row execute function public.set_updated_at();

alter table empresarial.company_perks enable row level security;
drop policy if exists company_perks_select on empresarial.company_perks;
create policy company_perks_select
  on empresarial.company_perks for select to authenticated
  using (company_id in (select empresarial.accessible_company_ids()));
drop policy if exists company_perks_write on empresarial.company_perks;
create policy company_perks_write
  on empresarial.company_perks for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());
grant select, insert, update, delete on empresarial.company_perks to authenticated;
grant all on empresarial.company_perks to service_role;

-- ---- 5) O ponto de partida: as vantagens do pedido ---------------------------
-- Semeadas ATIVAS porque foram ditadas pelo dono; nenhuma entra em proposta
-- sozinha — alguém escolhe. Renomear ou desativar é pela tela.
insert into empresarial.perks (name, description) values
  ('Desconto em parceiros', 'Descontos em estabelecimentos parceiros da Risarte.'),
  ('Palestras na empresa', 'Palestras de saúde bucal ministradas na empresa.'),
  ('Publicidade nas TVs das unidades', 'Divulgação da empresa nas TVs da unidade Risarte principal da parceria.'),
  ('Unidade exclusiva de atendimento', 'Uma unidade Risarte dedicada ao atendimento dos colaboradores da empresa.')
on conflict (name) do nothing;

-- A auditoria de toda tabela de cadastro (0288).
select public.audit_attach_all();
