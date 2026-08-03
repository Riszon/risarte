-- =============================================================================
-- 0185 — FIN0 (passo 2): FUNDAÇÃO CONTÁBIL do Módulo Financeiro
-- -----------------------------------------------------------------------------
-- Esqueleto que sustenta todas as telas financeiras. Nada aqui é tela: é a base
-- sobre a qual contas a receber, contas a pagar, DRE, DFC e consolidação são
-- apenas VISÕES. Ver docs/financeiro/DOCUMENTO-BASE-FINANCEIRO.md (6.1, 6.2,
-- 6.16) e o prompt do módulo.
--
-- O que entra:
--   1. clinics.ownership (own | franchised) — separa Resultado do Grupo de
--      Faturamento da Rede desde a fundação.
--   2. chart_of_accounts — plano de contas gerencial único da rede.
--   3. cost_centers — centros de custo por ÁREA (dados, não enum).
--   4. financial_entries — o RAZÃO. Competência (accrual_date) × caixa
--      (cash_date), rastreável até a origem, estorno por contra-lançamento.
--   5. finance_settings — multa/juros/carência/arredondamento em cascata.
--   6. fiscal_periods — estrutura do fechamento (a trava efetiva vem no FIN6).
--   7. Papel finance_franchisor na regra de ambiente + helpers de RLS.
--
-- DINHEIRO: BIGINT em centavos (decisão do dono, 31/07/2026). O núcleo antigo
-- usa INTEGER; a conversão daquelas colunas fica para uma janela dedicada.
--
-- REQUER a 0184 aplicada antes (valor de enum commitado).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A unidade é própria ou franqueada?
-- -----------------------------------------------------------------------------
-- Sem isto o FIN8 não consegue separar "Resultado do Grupo" (franqueadora +
-- unidades PRÓPRIAS, com eliminação do royalty) de "Faturamento da Rede"
-- (todas as unidades, só para benchmarking). Faturamento de franqueada NUNCA
-- entra no resultado da franqueadora.
alter table public.clinics
  add column if not exists ownership text not null default 'franchised'
    check (ownership in ('own', 'franchised'));

comment on column public.clinics.ownership is
  'own = unidade própria (entra no Resultado do Grupo); franchised = franqueada '
  '(entra só no Faturamento da Rede, e o royalty vira receita da franqueadora).';

-- A franqueadora é entidade financeira de primeira classe: ela É uma linha em
-- clinics (type = franchisor) e recebe lançamentos como qualquer unidade —
-- folha da matriz, marketing institucional, jurídico, expansão, riSZon.
update public.clinics set ownership = 'own' where type = 'franchisor';

-- -----------------------------------------------------------------------------
-- 2) Papel finance_franchisor na regra de ambiente (papel × tipo de clínica)
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
      'commercial_assistant','franchisor_staff','rislife_consultant',
      'finance_franchisor'
    )
    when 'franchise_unit' then p_role in (
      'receptionist','clinical_coordinator','dentist','unit_manager',
      'tsb','asb','franchisee'
    )
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3) Helpers de RLS do financeiro (SECURITY DEFINER, como os demais)
-- -----------------------------------------------------------------------------
-- Quem é Financeiro da Franqueadora (em qualquer clínica da matriz).
create or replace function public.is_finance_franchisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_clinic_roles ucr
    where ucr.user_id = (select auth.uid())
      and ucr.role = 'finance_franchisor'
  );
$$;

grant execute on function public.is_finance_franchisor() to authenticated;

-- Unidades cujo FINANCEIRO o usuário pode ver. Regra do dono: Gerente vê só a
-- sua; Financeiro da Franqueadora e Admin Master veem as do escopo. Franqueado
-- vê a(s) que possui (leitura). Recepção/dentista NÃO veem financeiro.
create or replace function public.finance_visible_clinic_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.clinics c
  where public.is_admin_master() or public.is_finance_franchisor()
  union
  select ucr.clinic_id
  from public.user_clinic_roles ucr
  where ucr.user_id = (select auth.uid())
    and ucr.role in ('unit_manager', 'franchisee', 'finance_franchisor');
$$;

grant execute on function public.finance_visible_clinic_ids() to authenticated;

-- Quem LANÇA/edita dinheiro numa unidade (franqueado é só leitura).
create or replace function public.can_post_finance(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or public.has_role_in_clinic(
           p_clinic_id, array['unit_manager']::public.user_role[]);
$$;

grant execute on function public.can_post_finance(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) PLANO DE CONTAS — gerencial, único da rede
-- -----------------------------------------------------------------------------
-- Exceção consciente ao "toda tabela tem clinic_id": é CATÁLOGO da rede, como
-- public.procedures. A separação franqueadora × unidade é feita pela coluna
-- `scope`, não por linha duplicada — assim a árvore é a MESMA e o consolidado
-- fecha. Leitura para todos; escrita só Admin Master / Financeiro.
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  -- Código numérico ordenável: '1', '1.1', '1.1.01'.
  code text not null unique,
  name text not null,
  parent_code text references public.chart_of_accounts (code),
  -- Tipo (R/D) do dicionário de dados (seção 7 do documento-base).
  kind text not null check (kind in ('revenue', 'expense')),
  -- Natureza: onde a conta entra na DRE.
  nature text not null check (nature in (
    'operational',   -- receita/despesa da operação
    'deduction',     -- redutora da receita bruta
    'direct_cost',   -- custo direto (materiais, repasse, taxas)
    'financial',     -- resultado financeiro
    'investment',    -- imobilizado, empréstimos, distribuição
    'intercompany'   -- royalty/fundo — espelhado entre matriz e unidade
  )),
  -- Fixo × variável: é o que permite calcular PONTO DE EQUILÍBRIO (9.20/9.21).
  -- 'none' para contas de receita e para os grupos sintéticos.
  cost_behavior text not null default 'none'
    check (cost_behavior in ('fixed', 'variable', 'none')),
  -- Onde a conta pode ser usada.
  scope text not null default 'both'
    check (scope in ('unit', 'franchisor', 'both')),
  -- Conta sintética (grupo) não recebe lançamento — só as analíticas recebem.
  is_analytic boolean not null default true,
  -- De-para com o plano contábil-fiscal (preenchido quando o contador validar).
  fiscal_account_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create index if not exists chart_of_accounts_parent_idx
  on public.chart_of_accounts (parent_code);
create index if not exists chart_of_accounts_active_idx
  on public.chart_of_accounts (active, code);

alter table public.chart_of_accounts enable row level security;

drop policy if exists "chart_of_accounts_select" on public.chart_of_accounts;
create policy "chart_of_accounts_select" on public.chart_of_accounts
  for select to authenticated using (true);

drop policy if exists "chart_of_accounts_write" on public.chart_of_accounts;
create policy "chart_of_accounts_write" on public.chart_of_accounts
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

-- Seed aprovado pelo dono (31/07/2026). 47 contas, gerencial e enxuto.
insert into public.chart_of_accounts
  (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic)
values
  -- 1 RECEITAS ---------------------------------------------------------------
  ('1',      'Receitas',                                   null,  'revenue', 'operational',  'none',     'both',       false),
  ('1.1',    'Receita de serviços clínicos',               '1',   'revenue', 'operational',  'none',     'unit',       false),
  ('1.1.01', 'Procedimentos — plano de tratamento',        '1.1', 'revenue', 'operational',  'none',     'unit',       true),
  ('1.1.02', 'Procedimentos — venda direta',               '1.1', 'revenue', 'operational',  'none',     'unit',       true),
  ('1.1.03', 'Urgência e emergência',                      '1.1', 'revenue', 'operational',  'none',     'unit',       true),
  ('1.2',    'Receita de programas',                       '1',   'revenue', 'operational',  'none',     'unit',       false),
  ('1.2.01', 'PPR+ — mensalidades',                        '1.2', 'revenue', 'operational',  'none',     'unit',       true),
  ('1.2.02', 'Risarte Empresarial — adesão e mensalidade', '1.2', 'revenue', 'operational',  'none',     'unit',       true),
  ('1.3',    'Receita da franqueadora',                    '1',   'revenue', 'operational',  'none',     'franchisor', false),
  ('1.3.01', 'Royalties',                                  '1.3', 'revenue', 'intercompany', 'none',     'franchisor', true),
  ('1.3.02', 'Taxa de franquia (adesão)',                  '1.3', 'revenue', 'operational',  'none',     'franchisor', true),
  ('1.3.03', 'Fundo de propaganda',                        '1.3', 'revenue', 'intercompany', 'none',     'franchisor', true),
  ('1.3.04', 'Taxa de sistema e suporte',                  '1.3', 'revenue', 'intercompany', 'none',     'franchisor', true),
  ('1.9',    'Deduções da receita',                        '1',   'revenue', 'deduction',    'none',     'both',       false),
  ('1.9.01', 'Impostos sobre serviços',                    '1.9', 'revenue', 'deduction',    'variable', 'both',       true),
  ('1.9.02', 'Descontos concedidos',                       '1.9', 'revenue', 'deduction',    'variable', 'unit',       true),
  ('1.9.03', 'Cancelamentos e estornos',                   '1.9', 'revenue', 'deduction',    'variable', 'both',       true),
  -- 2 CUSTOS DIRETOS (variáveis) ---------------------------------------------
  ('2',      'Custos diretos',                             null,  'expense', 'direct_cost',  'variable', 'both',       false),
  ('2.1',    'Repasse de profissionais',                   '2',   'expense', 'direct_cost',  'variable', 'unit',       false),
  ('2.1.01', 'Repasse de dentistas',                       '2.1', 'expense', 'direct_cost',  'variable', 'unit',       true),
  ('2.1.02', 'Bônus sobre repasse',                        '2.1', 'expense', 'direct_cost',  'variable', 'unit',       true),
  ('2.2',    'Materiais e insumos clínicos',               '2',   'expense', 'direct_cost',  'variable', 'unit',       true),
  ('2.3',    'Laboratório (prótese/ortodontia)',           '2',   'expense', 'direct_cost',  'variable', 'unit',       true),
  ('2.4',    'Taxas de recebimento',                       '2',   'expense', 'direct_cost',  'variable', 'both',       false),
  ('2.4.01', 'Taxa de adquirente (cartão)',                '2.4', 'expense', 'direct_cost',  'variable', 'unit',       true),
  ('2.4.02', 'Tarifa de boleto e PIX',                     '2.4', 'expense', 'direct_cost',  'variable', 'both',       true),
  ('2.5',    'Comissão comercial',                         '2',   'expense', 'direct_cost',  'variable', 'unit',       true),
  ('2.6',    'Royalties e fundo (unidade)',                '2',   'expense', 'intercompany', 'variable', 'unit',       false),
  ('2.6.01', 'Royalties',                                  '2.6', 'expense', 'intercompany', 'variable', 'unit',       true),
  ('2.6.02', 'Fundo de propaganda',                        '2.6', 'expense', 'intercompany', 'variable', 'unit',       true),
  -- 3 DESPESAS OPERACIONAIS (fixas por padrão) -------------------------------
  ('3',      'Despesas operacionais',                      null,  'expense', 'operational',  'fixed',    'both',       false),
  ('3.1',    'Pessoal',                                    '3',   'expense', 'operational',  'fixed',    'both',       false),
  ('3.1.01', 'Salários e encargos',                        '3.1', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.1.02', 'Benefícios',                                 '3.1', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.1.03', 'Pró-labore',                                 '3.1', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.1.04', 'Treinamento e capacitação',                  '3.1', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.2',    'Ocupação',                                   '3',   'expense', 'operational',  'fixed',    'both',       false),
  ('3.2.01', 'Aluguel',                                    '3.2', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.2.02', 'Condomínio e IPTU',                          '3.2', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.2.03', 'Energia, água e internet',                   '3.2', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.2.04', 'Manutenção e limpeza',                       '3.2', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.3',    'Administrativas',                            '3',   'expense', 'operational',  'fixed',    'both',       false),
  ('3.3.01', 'Contabilidade e jurídico',                   '3.3', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.3.02', 'Software e sistemas',                        '3.3', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.3.03', 'Material de escritório',                     '3.3', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.3.04', 'Seguros e taxas',                            '3.3', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.4',    'Marketing',                                  '3',   'expense', 'operational',  'fixed',    'both',       false),
  ('3.4.01', 'Mídia paga',                                 '3.4', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.4.02', 'Produção de conteúdo',                       '3.4', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.4.03', 'Eventos e patrocínios',                      '3.4', 'expense', 'operational',  'fixed',    'both',       true),
  ('3.5',    'Despesas da franqueadora',                   '3',   'expense', 'operational',  'fixed',    'franchisor', false),
  ('3.5.01', 'Expansão e prospecção de praças',            '3.5', 'expense', 'operational',  'fixed',    'franchisor', true),
  ('3.5.02', 'Desenvolvimento do riSZon',                  '3.5', 'expense', 'operational',  'fixed',    'franchisor', true),
  ('3.5.03', 'Suporte à rede',                             '3.5', 'expense', 'operational',  'fixed',    'franchisor', true),
  -- 4 RESULTADO FINANCEIRO ---------------------------------------------------
  ('4',      'Resultado financeiro',                       null,  'revenue', 'financial',    'none',     'both',       false),
  ('4.1',    'Receitas financeiras',                       '4',   'revenue', 'financial',    'none',     'both',       false),
  ('4.1.01', 'Juros e multa recebidos',                    '4.1', 'revenue', 'financial',    'none',     'unit',       true),
  ('4.1.02', 'Rendimento de aplicações',                   '4.1', 'revenue', 'financial',    'none',     'both',       true),
  ('4.2',    'Despesas financeiras',                       '4',   'expense', 'financial',    'variable', 'both',       false),
  ('4.2.01', 'Juros e multa pagos',                        '4.2', 'expense', 'financial',    'variable', 'both',       true),
  ('4.2.02', 'Tarifas bancárias',                          '4.2', 'expense', 'financial',    'fixed',    'both',       true),
  ('4.2.03', 'IOF',                                        '4.2', 'expense', 'financial',    'variable', 'both',       true),
  -- 5 INVESTIMENTOS E NÃO OPERACIONAIS ---------------------------------------
  ('5',      'Investimentos e não operacionais',           null,  'expense', 'investment',   'none',     'both',       false),
  ('5.1',    'Imobilizado',                                '5',   'expense', 'investment',   'none',     'both',       false),
  ('5.1.01', 'Equipamentos',                               '5.1', 'expense', 'investment',   'none',     'both',       true),
  ('5.1.02', 'Obras e benfeitorias',                       '5.1', 'expense', 'investment',   'none',     'both',       true),
  ('5.2.01', 'Depreciação',                                '5',   'expense', 'investment',   'fixed',    'both',       true),
  ('5.3.01', 'Empréstimos — principal',                    '5',   'expense', 'investment',   'none',     'both',       true),
  ('5.4.01', 'Distribuição de lucros',                     '5',   'expense', 'investment',   'none',     'both',       true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 5) CENTROS DE CUSTO — por ÁREA (decisão do dono; especialidade NÃO é centro)
-- -----------------------------------------------------------------------------
-- São DADOS, não enum: criar centro novo é operação de tela, sem migração.
-- A unidade só cria centro como FILHO de um centro 'network', para o
-- consolidado continuar comparável entre 200 unidades.
create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  -- Código imutável (trigger abaixo). O nome é editável.
  code text not null,
  name text not null,
  parent_id uuid references public.cost_centers (id),
  scope text not null check (scope in ('franchisor', 'network', 'unit')),
  -- Nulo quando scope é 'franchisor' ou 'network' (padrão da rede).
  clinic_id uuid references public.clinics (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint cost_centers_scope_clinic_check check (
    (scope = 'unit' and clinic_id is not null)
    or (scope in ('franchisor', 'network') and clinic_id is null)
  ),
  constraint cost_centers_code_unique unique nulls not distinct (clinic_id, code)
);

create index if not exists cost_centers_parent_idx on public.cost_centers (parent_id);
create index if not exists cost_centers_clinic_idx on public.cost_centers (clinic_id, active);

comment on table public.cost_centers is
  'Centros de custo por ÁREA. Unidade só cria filho de centro de scope network.';

-- Centro de unidade tem de pendurar num centro da REDE (comparabilidade).
create or replace function public.cost_center_parent_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent record;
begin
  if new.scope = 'unit' then
    if new.parent_id is null then
      raise exception 'PARENT_REQUIRED';
    end if;
    select scope, clinic_id into v_parent
    from public.cost_centers where id = new.parent_id;
    if v_parent.scope is distinct from 'network' then
      raise exception 'PARENT_MUST_BE_NETWORK';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cost_centers_parent_check on public.cost_centers;
create trigger cost_centers_parent_check
  before insert or update on public.cost_centers
  for each row execute function public.cost_center_parent_check();

-- Código nunca muda; centro com lançamento não é apagado (só desativado).
create or replace function public.cost_center_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'CODE_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.financial_entries e
               where e.cost_center_id = old.id) then
      raise exception 'COST_CENTER_IN_USE';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Seed: as 5 áreas padrão da rede (documento-base §4).
insert into public.cost_centers (code, name, scope, clinic_id)
values
  ('CLI', 'Clínico',                  'network', null),
  ('COM', 'Comercial',                'network', null),
  ('ADM', 'Administrativo',           'network', null),
  ('MKT', 'Marketing',                'network', null),
  ('INF', 'Infraestrutura/Ocupação',  'network', null)
on conflict do nothing;

alter table public.cost_centers enable row level security;

drop policy if exists "cost_centers_select" on public.cost_centers;
create policy "cost_centers_select" on public.cost_centers
  for select to authenticated
  using (
    clinic_id is null
    or clinic_id in (select public.finance_visible_clinic_ids())
  );

drop policy if exists "cost_centers_write" on public.cost_centers;
create policy "cost_centers_write" on public.cost_centers
  for all to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  )
  with check (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  );

-- -----------------------------------------------------------------------------
-- 6) RAZÃO DE LANÇAMENTOS — a base de tudo
-- -----------------------------------------------------------------------------
-- Contas a receber e a pagar são PROJEÇÕES sobre esta tabela, não bases
-- paralelas. Competência (accrual_date → DRE) × caixa (cash_date → DFC).
create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  account_code text not null references public.chart_of_accounts (code),
  cost_center_id uuid references public.cost_centers (id),
  -- Fato gerador (DRE). Sempre obrigatório.
  accrual_date date not null,
  -- Movimentação real (DFC). Nulo enquanto não houver caixa.
  cash_date date,
  -- Liquidação esperada do meio de pagamento (D+1 débito, D+30 crédito).
  -- Sem isto a projeção 30/60/90 do DFC mente (decisão do dono, 7.5).
  expected_settlement_date date,
  amount_cents bigint not null check (amount_cents > 0),
  direction text not null check (direction in ('inflow', 'outflow')),
  status text not null default 'open'
    check (status in ('planned', 'open', 'settled', 'reversed', 'cancelled')),
  -- Rastreabilidade: todo número faz drill-down até o documento.
  source_type text not null,
  source_id uuid,
  description text,
  -- Estorno: lançamento pago/conciliado nunca é editado nem apagado.
  reversal_of uuid references public.financial_entries (id),
  reversal_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create index if not exists financial_entries_clinic_accrual_idx
  on public.financial_entries (clinic_id, accrual_date);
create index if not exists financial_entries_clinic_cash_idx
  on public.financial_entries (clinic_id, cash_date);
create index if not exists financial_entries_account_idx
  on public.financial_entries (account_code, accrual_date);
create index if not exists financial_entries_source_idx
  on public.financial_entries (source_type, source_id);
create index if not exists financial_entries_cost_center_idx
  on public.financial_entries (cost_center_id);

comment on table public.financial_entries is
  'Razão do financeiro. accrual_date = competência (DRE); cash_date = caixa '
  '(DFC). Estorno vira contra-lançamento (reversal_of), nunca update/delete.';

-- Só conta ANALÍTICA recebe lançamento (grupo sintético não).
create or replace function public.financial_entry_account_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analytic boolean;
  v_active boolean;
begin
  select is_analytic, active into v_analytic, v_active
  from public.chart_of_accounts where code = new.account_code;
  if v_analytic is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if not v_analytic then raise exception 'ACCOUNT_NOT_ANALYTIC'; end if;
  if not v_active then raise exception 'ACCOUNT_INACTIVE'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists financial_entries_account_check on public.financial_entries;
create trigger financial_entries_account_check
  before insert or update on public.financial_entries
  for each row execute function public.financial_entry_account_check();

-- Lançamento liquidado/estornado não se edita nem se apaga: gera contrapartida.
create or replace function public.financial_entry_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ENTRY_IMMUTABLE_DELETE';
  end if;
  if old.status in ('settled', 'reversed')
     and new.status is not distinct from old.status
     and (new.amount_cents is distinct from old.amount_cents
          or new.account_code is distinct from old.account_code
          or new.accrual_date is distinct from old.accrual_date) then
    raise exception 'ENTRY_IMMUTABLE_UPDATE';
  end if;
  return new;
end;
$$;

drop trigger if exists financial_entries_immutability on public.financial_entries;
create trigger financial_entries_immutability
  before update or delete on public.financial_entries
  for each row execute function public.financial_entry_immutability();

alter table public.financial_entries enable row level security;

drop policy if exists "financial_entries_select" on public.financial_entries;
create policy "financial_entries_select" on public.financial_entries
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "financial_entries_write" on public.financial_entries;
create policy "financial_entries_write" on public.financial_entries
  for all to authenticated
  using (public.can_post_finance(clinic_id))
  with check (public.can_post_finance(clinic_id));

-- Agora que financial_entries existe, o guard do centro de custo pode ser criado.
drop trigger if exists cost_centers_guard on public.cost_centers;
create trigger cost_centers_guard
  before update or delete on public.cost_centers
  for each row execute function public.cost_center_guard();

-- -----------------------------------------------------------------------------
-- 7) CONFIGURAÇÃO FINANCEIRA — cascata (clinic_id null = padrão da rede)
-- -----------------------------------------------------------------------------
create table if not exists public.finance_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id),
  -- Teto de 2%: limite do CDC (art. 52, §1º) para multa em contrato de consumo
  -- parcelado. A tela também valida — mas a trava real é aqui.
  late_fee_percent numeric(5,2) not null default 2.00
    check (late_fee_percent >= 0 and late_fee_percent <= 2),
  monthly_interest_percent numeric(5,2) not null default 1.00
    check (monthly_interest_percent >= 0 and monthly_interest_percent <= 100),
  -- Carência antes de contar atraso (decisão do dono: 0 = dia seguinte).
  grace_days integer not null default 0 check (grace_days >= 0),
  rounding_mode text not null default 'half_up'
    check (rounding_mode in ('half_up', 'half_even')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint finance_settings_clinic_unique unique nulls not distinct (clinic_id)
);

insert into public.finance_settings (clinic_id) values (null)
on conflict do nothing;

alter table public.finance_settings enable row level security;

drop policy if exists "finance_settings_select" on public.finance_settings;
create policy "finance_settings_select" on public.finance_settings
  for select to authenticated
  using (
    clinic_id is null
    or clinic_id in (select public.finance_visible_clinic_ids())
  );

drop policy if exists "finance_settings_write" on public.finance_settings;
create policy "finance_settings_write" on public.finance_settings
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

-- Resolve a configuração efetiva de uma unidade (unidade > rede), campo a campo.
create or replace function public.finance_settings_for(p_clinic_id uuid)
returns table (
  late_fee_percent numeric,
  monthly_interest_percent numeric,
  grace_days integer,
  rounding_mode text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(u.late_fee_percent, n.late_fee_percent),
    coalesce(u.monthly_interest_percent, n.monthly_interest_percent),
    coalesce(u.grace_days, n.grace_days),
    coalesce(u.rounding_mode, n.rounding_mode)
  from (select 1) one
  left join public.finance_settings u on u.clinic_id = p_clinic_id
  left join public.finance_settings n on n.clinic_id is null;
$$;

grant execute on function public.finance_settings_for(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) FECHAMENTO DE PERÍODO — só a estrutura (trava efetiva no FIN6)
-- -----------------------------------------------------------------------------
create table if not exists public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  year integer not null check (year between 2020 and 2100),
  month integer not null check (month between 1 and 12),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  reopened_at timestamptz,
  reopened_by uuid references public.profiles (id),
  -- Reabrir período fechado exige justificativa (documento-base §13).
  reopen_reason text,
  created_at timestamptz not null default now(),
  constraint fiscal_periods_unique unique (clinic_id, year, month)
);

create index if not exists fiscal_periods_clinic_idx
  on public.fiscal_periods (clinic_id, year, month);

alter table public.fiscal_periods enable row level security;

drop policy if exists "fiscal_periods_select" on public.fiscal_periods;
create policy "fiscal_periods_select" on public.fiscal_periods
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "fiscal_periods_write" on public.fiscal_periods;
create policy "fiscal_periods_write" on public.fiscal_periods
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());
