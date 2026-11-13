-- =============================================================================
-- 0404 — LEVANTAMENTO DE DÍVIDAS, FASE 1: A BASE
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/Financeiro/DIVIDAS-PLANO.md.
--
-- O que a rede DEVE a terceiros (bancos, fornecedores, tributos…), por CNPJ
-- devedor — cada unidade e a própria franqueadora. NÃO é inadimplência de
-- paciente (`payment_installments`).
--
--   * O DEVEDOR é sempre uma linha de `clinics` (unidade ou a franqueadora,
--     type = 'franchisor'): multi-tenant intacto, vale para N unidades.
--   * O CREDOR é um FORNECEDOR (`suppliers`, decisão D4): um cadastro só. O que
--     é sensível de dívida (contatos de cobrança, assessoria) fica aqui.
--   * Data de implantação do riSZon por CNPJ (`clinics.go_live_on`, D2): a
--     origem A (anterior) × B (nova) é decidida pela data em que a dívida
--     NASCEU (emissão/competência), nunca pelo vencimento.
--   * Categorização em camadas: categoria/subcategoria, natureza, conta do
--     plano de contas (na categoria; a dívida herda e pode trocar) e etiquetas.
--   * Situação calculada por UMA regra (`_debt_compute_status`), gravada pela
--     gravação e pela rotina diária (00:10), com evento no histórico.
--   * Nesta fase a dívida NÃO gera título no Contas a Pagar: a origem fica
--     gravada e a fase 3 gera (`finance_synced_at` nulo = ainda não gerou).
--
-- ⚠️ QUEM PODE: a matriz de permissões, com TETO no banco — só o Financeiro da
-- Franqueadora (e o Admin Master/Principal), mesmo que outro papel seja
-- marcado. Nenhuma tabela tem regra de escrita: só as funções gravam.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) DATA DE IMPLANTAÇÃO DO riSZon POR CNPJ
-- -----------------------------------------------------------------------------
alter table public.clinics add column if not exists go_live_on date;
comment on column public.clinics.go_live_on is
  'Data de implantação do riSZon neste CNPJ. Dívida que nasceu antes = saldo de implantação (origem A); depois = nova (origem B). Decisão D2 do plano de dívidas (0404).';

-- D2 (dono, 13/11/2026): 16/11/2026 nos três CNPJs — Londrina, Cambé e a
-- franqueadora (Administração). Só preenche o vazio.
update public.clinics
   set go_live_on = date '2026-11-16'
 where go_live_on is null
   and code in ('LDN', 'CBE', 'RF');

-- -----------------------------------------------------------------------------
-- 2) QUEM PODE — a matriz, com teto
-- -----------------------------------------------------------------------------
-- Padrões de fábrica (iguais a `src/lib/permissions.ts`; há teste comparando).
create or replace function public._debt_cap_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'modulo.dividas' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.lancar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.excluir' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.configurar' then array['finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_default_roles(text) from public, anon, authenticated;

-- O único papel que estas capacidades PODEM alcançar (seção 4 do pedido: dado
-- sensível, só a franqueadora). Marcar outro papel na matriz não abre nada.
create or replace function public._debt_cap_ceiling(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_capability in ('modulo.dividas', 'acao.dividas.lancar',
                          'acao.dividas.excluir', 'acao.dividas.configurar')
      then array['finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_ceiling(text) from public, anon, authenticated;

-- Quem pergunta tem a capacidade? O Financeiro da Franqueadora vê a REDE
-- inteira (como em todo o financeiro), então a unidade não restringe — o
-- parâmetro fica para a futura leitura da própria unidade (fase 7).
create or replace function public.debt_can(p_capability text, p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed public.user_role[];
begin
  if v_uid is null then return false; end if;
  if public.is_admin_master() or public.is_owner() then return true; end if;

  if exists (select 1 from public.permission_matrix) then
    select coalesce(array_agg(pm.role), '{}') into v_allowed
      from public.permission_matrix pm
     where pm.capability = p_capability and pm.allowed;
  else
    v_allowed := public._debt_cap_default_roles(p_capability);
  end if;
  select coalesce(array_agg(x), '{}') into v_allowed
    from unnest(v_allowed) x
   where x = any (public._debt_cap_ceiling(p_capability));

  return 'finance_franchisor' = any (v_allowed)
     and exists (select 1 from public.user_clinic_roles ucr
                  where ucr.user_id = v_uid and ucr.role = 'finance_franchisor');
end;
$$;
revoke execute on function public.debt_can(text, uuid) from public, anon, authenticated;
grant execute on function public.debt_can(text, uuid) to authenticated;

do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select cap, r
      from (values ('modulo.dividas'), ('acao.dividas.lancar'),
                   ('acao.dividas.excluir'), ('acao.dividas.configurar')) as caps(cap)
      cross join lateral unnest(public._debt_cap_default_roles(cap)) as r
    on conflict (capability, role) do nothing;
  end if;
end;
$$;
insert into public.permission_defaults (capability, roles)
select cap, public._debt_cap_default_roles(cap)
  from (values ('modulo.dividas'), ('acao.dividas.lancar'),
               ('acao.dividas.excluir'), ('acao.dividas.configurar')) as caps(cap)
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 3) TIPOS DE CREDOR QUE FALTAVAM (o credor é fornecedor — D4)
-- -----------------------------------------------------------------------------
insert into public.supplier_kinds (code, label, sort_order, active) values
  ('tributo_federal',   'Tributo federal (Receita, PGFN)', 161, true),
  ('tributo_estadual',  'Tributo estadual',                162, true),
  ('tributo_municipal', 'Tributo municipal',               163, true),
  ('trabalhista',       'Trabalhista e encargos',          165, true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 4) CONFIGURAÇÃO
-- -----------------------------------------------------------------------------
-- Cascata: clinic_id nulo = rede; linha da unidade sobrescreve campo a campo
-- (colunas ANULÁVEIS — a lição da 0230). Reconhecimento do desconto/encargos e
-- o valor de aprovação de acordo são só da rede.
create table if not exists public.debt_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade,
  days_to_default integer check (days_to_default is null or days_to_default between 1 and 365),
  about_to_default_days integer check (about_to_default_days is null or about_to_default_days between 0 and 60),
  proposal_alert_days integer[],
  negativation_removal_bdays integer check (negativation_removal_bdays is null or negativation_removal_bdays between 1 and 60),
  closing_stale_days integer check (closing_stale_days is null or closing_stale_days between 1 and 365),
  agreement_broken_tolerance_bdays integer check (agreement_broken_tolerance_bdays is null or agreement_broken_tolerance_bdays between 0 and 60),
  agreement_approval_threshold_cents bigint check (agreement_approval_threshold_cents is null or agreement_approval_threshold_cents > 0),
  discount_recognition text check (discount_recognition is null or discount_recognition in ('na_data_do_acordo', 'proporcional')),
  surcharge_recognition text check (surcharge_recognition is null or surcharge_recognition in ('na_data_do_acordo', 'proporcional')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint debt_settings_one_per_scope unique nulls not distinct (clinic_id),
  constraint debt_settings_network_only check (
    clinic_id is null or (agreement_approval_threshold_cents is null
                          and discount_recognition is null and surcharge_recognition is null))
);
comment on table public.debt_settings is
  'Regras do Levantamento de Dívidas. clinic_id nulo = rede; a linha do devedor sobrescreve campo a campo (0404).';

insert into public.debt_settings (clinic_id, days_to_default, about_to_default_days, proposal_alert_days,
  negativation_removal_bdays, closing_stale_days, agreement_broken_tolerance_bdays,
  agreement_approval_threshold_cents, discount_recognition, surcharge_recognition)
values (null, 30, 5, '{7,2}', 5, 15, 3, null, 'na_data_do_acordo', 'na_data_do_acordo')
on conflict (clinic_id) do nothing;

-- Prazo de inadimplência por TIPO de credor (ex.: tributos e bancos menor).
create table if not exists public.debt_default_rules (
  supplier_kind text primary key references public.supplier_kinds(code) on update cascade on delete cascade,
  days_to_default integer not null check (days_to_default between 1 and 365),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
comment on table public.debt_default_rules is
  'Prazo para virar inadimplente por tipo de credor; ganha do prazo do devedor e da rede (0404).';

create table if not exists public.debt_natures (
  code text primary key,
  label text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  system boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
comment on table public.debt_natures is
  'Natureza contábil da dívida (Financeira, Operacional, Tributária, Trabalhista). Desativar não apaga (0404).';

insert into public.debt_natures (code, label, sort_order, system) values
  ('financeira',  'Financeira',  10, true),
  ('operacional', 'Operacional', 20, true),
  ('tributaria',  'Tributária',  30, true),
  ('trabalhista', 'Trabalhista', 40, true)
on conflict (code) do nothing;

create table if not exists public.debt_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.debt_categories(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  nature_code text references public.debt_natures(code) on update cascade,
  opening_account_code text references public.chart_of_accounts(code) on update cascade,
  expense_account_code text references public.chart_of_accounts(code) on update cascade,
  sort_order integer not null default 0,
  active boolean not null default true,
  system boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
comment on table public.debt_categories is
  'Categoria e subcategoria (parent_id) da dívida, com natureza e contas do plano de contas: opening = saldo de implantação (origem A), expense = despesa (origem B). A dívida herda e pode trocar (0404).';
create unique index if not exists debt_categories_name_uniq
  on public.debt_categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

-- Só dois níveis: subcategoria não tem filha.
create or replace function public.debt_categories_two_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A categoria não pode ser subcategoria dela mesma.';
    end if;
    if exists (select 1 from public.debt_categories p where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'Subcategoria não pode ter subcategoria (só dois níveis).';
    end if;
    if exists (select 1 from public.debt_categories c where c.parent_id = new.id) then
      raise exception 'Esta categoria tem subcategorias; ela não pode virar subcategoria.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists debt_categories_two_levels on public.debt_categories;
create trigger debt_categories_two_levels before insert or update on public.debt_categories
  for each row execute function public.debt_categories_two_levels();

-- Categorias iniciais do pedido (3.1.1) + subcategorias comuns + "A classificar"
-- (para a importação e para quem ainda não sabe).
do $$
declare
  v_id uuid;
  r record;
begin
  for r in select * from (values
      ('Empréstimos e financiamentos', 'financeira', 10),
      ('Capital de giro / limite / cheque especial', 'financeira', 20),
      ('Antecipação de recebíveis', 'financeira', 30),
      ('Fornecedores odontológicos', 'operacional', 40),
      ('Laboratório e prótese', 'operacional', 50),
      ('Equipamentos', 'operacional', 60),
      ('Ocupação (aluguel, condomínio, IPTU)', 'operacional', 70),
      ('Utilidades (energia, água, telefonia, internet)', 'operacional', 80),
      ('Serviços de terceiros e software', 'operacional', 90),
      ('Tributos', 'tributaria', 100),
      ('Trabalhistas e encargos', 'trabalhista', 110),
      ('Marketing', 'operacional', 120),
      ('Outros', 'operacional', 130),
      ('A classificar', null, 999)
    ) as t(name, nature, ord)
  loop
    insert into public.debt_categories (name, nature_code, sort_order, system)
    values (r.name, r.nature, r.ord, true)
    on conflict do nothing;
  end loop;

  for r in select * from (values
      ('Empréstimos e financiamentos', 'Empréstimo', 10),
      ('Empréstimos e financiamentos', 'Refinanciamento (REFIN)', 20),
      ('Empréstimos e financiamentos', 'Financiamento de equipamento', 30),
      ('Capital de giro / limite / cheque especial', 'Limite da conta', 10),
      ('Capital de giro / limite / cheque especial', 'Capital de giro com recebíveis de cartão', 20),
      ('Fornecedores odontológicos', 'Materiais e implantes', 10),
      ('Fornecedores odontológicos', 'Produtos para saúde', 20),
      ('Utilidades (energia, água, telefonia, internet)', 'Energia', 10),
      ('Utilidades (energia, água, telefonia, internet)', 'Água', 20),
      ('Utilidades (energia, água, telefonia, internet)', 'Telefonia e internet', 30),
      ('Tributos', 'Simples Nacional', 10),
      ('Tributos', 'Previdenciário (INSS)', 20),
      ('Tributos', 'ISS', 30),
      ('Tributos', 'Tributos federais', 40)
    ) as t(parent, name, ord)
  loop
    select id into v_id from public.debt_categories where parent_id is null and name = r.parent;
    if v_id is not null then
      insert into public.debt_categories (parent_id, name, sort_order, system)
      values (v_id, r.name, r.ord, true)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

create table if not exists public.debt_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  color text,
  active boolean not null default true,
  system boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
comment on table public.debt_tags is 'Etiquetas livres das dívidas (0404).';
create unique index if not exists debt_tags_name_uniq on public.debt_tags (lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- 5) CONTATOS DE COBRANÇA DO CREDOR (o fornecedor fica como está)
-- -----------------------------------------------------------------------------
create table if not exists public.debt_creditor_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  kind text not null default 'credor'
    check (kind in ('credor', 'assessoria', 'advogado', 'cartorio')),
  organization text,
  person_name text,
  phone text,
  whatsapp text,
  email text,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint debt_creditor_contacts_has_name check (
    coalesce(btrim(person_name), '') <> '' or coalesce(btrim(organization), '') <> '')
);
comment on table public.debt_creditor_contacts is
  'Com quem a rede fala sobre as dívidas de um credor: atendente, assessoria de cobrança, advogado, cartório (0404).';
create index if not exists debt_creditor_contacts_supplier on public.debt_creditor_contacts (supplier_id);

-- -----------------------------------------------------------------------------
-- 6) GRUPOS E DÍVIDAS
-- -----------------------------------------------------------------------------
create sequence if not exists public.debt_group_code_seq;
create sequence if not exists public.debt_code_seq;

create table if not exists public.debt_groups (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  label text not null check (btrim(label) <> ''),
  contract_number text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
comment on table public.debt_groups is
  'Dívidas do mesmo contrato/pedido (ex.: os boletos de uma compra), negociáveis juntas. Código GD- (0404).';

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  group_id uuid references public.debt_groups(id) on delete set null,
  collection_contact_id uuid references public.debt_creditor_contacts(id) on delete set null,

  debt_type text not null default 'outro' check (debt_type in (
    'emprestimo', 'capital_de_giro', 'limite_de_conta', 'antecipacao_recebiveis',
    'boleto_de_compra', 'fatura', 'imposto', 'parcelamento_anterior', 'outro')),
  contract_number text,
  installment_label text,
  description text,

  bundled_count integer not null default 1 check (bundled_count >= 1),
  needs_split boolean not null default false,

  has_guarantor boolean not null default false,
  guarantor_name text,
  real_guarantee text,
  receivables_assignment boolean not null default false,
  guarantee_notes text,

  category_id uuid references public.debt_categories(id) on delete restrict,
  subcategory_id uuid references public.debt_categories(id) on delete restrict,
  nature_code text references public.debt_natures(code) on update cascade,
  account_code text references public.chart_of_accounts(code) on update cascade,
  tax_active_debt boolean not null default false,

  original_cents bigint check (original_cents is null or original_cents >= 0),
  updated_cents bigint check (updated_cents is null or updated_cents >= 0),
  updated_ref_date date,
  interest_cents bigint check (interest_cents is null or interest_cents >= 0),
  fine_cents bigint check (fine_cents is null or fine_cents >= 0),
  charges_cents bigint check (charges_cents is null or charges_cents >= 0),
  contract_rate_percent numeric(9,4) check (contract_rate_percent is null or contract_rate_percent >= 0),

  accrual_month date,
  issue_date date,
  due_date date not null,

  origin text not null check (origin in ('A', 'B', 'C')),
  origin_suggested text check (origin_suggested is null or origin_suggested in ('A', 'B')),
  origin_override_reason text,
  finance_synced_at timestamptz,

  status text not null default 'a_vencer' check (status in (
    'a_vencer', 'em_atraso', 'inadimplente', 'em_negociacao',
    'acordo_em_andamento', 'acordo_quebrado', 'quitada_pendencias',
    'quitada_encerrada', 'contestada', 'judicial', 'baixada')),
  status_changed_at timestamptz not null default now(),
  manual_stage text check (manual_stage is null or manual_stage in (
    'em_negociacao', 'contestada', 'judicial', 'baixada')),
  stage_reason text,

  priority text check (priority is null or priority in ('alta', 'media', 'baixa')),
  priority_reasons text[] not null default '{}',
  owner_user_id uuid references auth.users(id),
  next_action text,
  next_action_on date,
  notes text,

  import_batch_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deleted_reason text,
  constraint debts_has_value check (coalesce(original_cents, 0) > 0 or coalesce(updated_cents, 0) > 0),
  constraint debts_deleted_reason check (deleted_at is null or coalesce(btrim(deleted_reason), '') <> ''),
  constraint debts_subcategory_needs_category check (subcategory_id is null or category_id is not null)
);
comment on table public.debts is
  'Levantamento de Dívidas: o que a rede deve a terceiros, por CNPJ devedor (clinic_id). Saldo e pagos vêm do Contas a Pagar a partir da fase 3. Código DV- (0404).';
create index if not exists debts_clinic on public.debts (clinic_id) where deleted_at is null;
create index if not exists debts_supplier on public.debts (supplier_id);
create index if not exists debts_group on public.debts (group_id);

create table if not exists public.debt_tag_links (
  debt_id uuid not null references public.debts(id) on delete cascade,
  tag_id uuid not null references public.debt_tags(id) on delete restrict,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (debt_id, tag_id)
);
comment on table public.debt_tag_links is 'Etiquetas de cada dívida (0404).';

-- O código nunca some — e nunca é truncado (lição da 0245).
create or replace function public.debt_set_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
begin
  if new.code is null or btrim(new.code) = '' then
    if tg_table_name = 'debts' then
      v := nextval('public.debt_code_seq');
      new.code := 'DV-' || lpad(v::text, greatest(6, length(v::text)), '0');
    else
      v := nextval('public.debt_group_code_seq');
      new.code := 'GD-' || lpad(v::text, greatest(5, length(v::text)), '0');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists debts_set_code on public.debts;
create trigger debts_set_code before insert on public.debts
  for each row execute function public.debt_set_code();
drop trigger if exists debt_groups_set_code on public.debt_groups;
create trigger debt_groups_set_code before insert on public.debt_groups
  for each row execute function public.debt_set_code();

-- -----------------------------------------------------------------------------
-- 7) O HISTÓRICO DE NEGÓCIO (só cresce)
-- -----------------------------------------------------------------------------
create table if not exists public.debt_events (
  id bigint generated always as identity primary key,
  debt_id uuid not null references public.debts(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  kind text not null,
  from_status text,
  to_status text,
  note text,
  data jsonb
);
comment on table public.debt_events is
  'Linha do tempo de negócio da dívida (criada, situação manual e AUTOMÁTICA, excluída…). Só cresce (0404).';
create index if not exists debt_events_debt on public.debt_events (debt_id, occurred_at desc);

create or replace function public.debt_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O histórico da dívida não pode ser alterado nem apagado.';
end;
$$;
drop trigger if exists debt_events_immutable on public.debt_events;
create trigger debt_events_immutable before update or delete on public.debt_events
  for each row execute function public.debt_events_immutable();

-- -----------------------------------------------------------------------------
-- 8) A SITUAÇÃO — uma regra só (espelho: `situacaoDaDivida` em
--    src/lib/finance/dividas.ts)
-- -----------------------------------------------------------------------------
-- Prazo para virar inadimplente: tipo do credor → devedor → rede → 30.
-- (O mais específico manda, como na alçada do Contas a Pagar.)
create or replace function public._debt_days_to_default(p_clinic_id uuid, p_supplier_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.days_to_default from public.debt_default_rules r
       join public.suppliers s on s.kind = r.supplier_kind
      where s.id = p_supplier_id),
    (select u.days_to_default from public.debt_settings u where u.clinic_id = p_clinic_id),
    (select n.days_to_default from public.debt_settings n where n.clinic_id is null),
    30);
$$;
revoke execute on function public._debt_days_to_default(uuid, uuid) from public, anon, authenticated;

create or replace function public._debt_compute_status(p_debt_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.debts%rowtype;
  v_late integer;
begin
  select * into d from public.debts where id = p_debt_id;
  if not found then return null; end if;

  -- Precedência (plano, 4.1). Quitação e acordo entram nas fases 3 e 5.
  if d.manual_stage = 'baixada' then return 'baixada'; end if;
  if d.manual_stage = 'contestada' then return 'contestada'; end if;
  if d.manual_stage = 'judicial' then return 'judicial'; end if;
  if d.manual_stage = 'em_negociacao' then return 'em_negociacao'; end if;

  v_late := public.today_br() - d.due_date;
  if v_late <= 0 then return 'a_vencer'; end if;
  if v_late <= public._debt_days_to_default(d.clinic_id, d.supplier_id) then return 'em_atraso'; end if;
  return 'inadimplente';
end;
$$;
revoke execute on function public._debt_compute_status(uuid) from public, anon, authenticated;

-- Grava a situação nova (se mudou) e registra no histórico. `p_auto` = mudou
-- sozinha (o tempo passou), não por um ato de alguém.
create or replace function public._debt_refresh_status(p_debt_id uuid, p_auto boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text;
begin
  select status into v_old from public.debts where id = p_debt_id and deleted_at is null for update;
  if not found then return null; end if;
  v_new := public._debt_compute_status(p_debt_id);
  if v_new is distinct from v_old then
    update public.debts set status = v_new, status_changed_at = now() where id = p_debt_id;
    insert into public.debt_events (debt_id, user_id, kind, from_status, to_status)
    values (p_debt_id, case when p_auto then null else (select auth.uid()) end,
            case when p_auto then 'situacao_automatica' else 'situacao' end, v_old, v_new);
  end if;
  return v_new;
end;
$$;
revoke execute on function public._debt_refresh_status(uuid, boolean) from public, anon, authenticated;

-- A rotina da madrugada: a situação só depende da data de hoje (e das
-- gravações, que já recalculam), então rodar logo depois da meia-noite deixa
-- todas certas o dia inteiro.
create or replace function public.debt_daily_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_old text;
begin
  for r in select id, status from public.debts where deleted_at is null loop
    v_old := r.status;
    if public._debt_refresh_status(r.id, true) is distinct from v_old then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.debt_daily_run() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('risarte-debts-daily');
exception when others then null;
end;
$$;
do $$
begin
  perform cron.schedule('risarte-debts-daily', '10 3 * * *', 'select public.debt_daily_run()');
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) A PORTA DE GRAVAÇÃO DA DÍVIDA
-- -----------------------------------------------------------------------------
-- A origem sugerida: a data em que a dívida NASCEU (emissão, senão competência)
-- antes da implantação = A; depois = B. Sem data ou sem implantação = nada.
create or replace function public.debt_suggest_origin(p_clinic_id uuid, p_issue_date date, p_accrual_month date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_issue_date, p_accrual_month) is null then null
    when c.go_live_on is null then null
    when coalesce(p_issue_date, p_accrual_month) < c.go_live_on then 'A'
    else 'B'
  end
    from public.clinics c
   where c.id = p_clinic_id;
$$;
revoke execute on function public.debt_suggest_origin(uuid, date, date) from public, anon, authenticated;
grant execute on function public.debt_suggest_origin(uuid, date, date) to authenticated;

create or replace function public._debt_text(p jsonb, k text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p ->> k), '');
$$;
revoke execute on function public._debt_text(jsonb, text) from public, anon, authenticated;

create or replace function public.debt_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_old public.debts%rowtype;
  v_clinic uuid := nullif(p ->> 'clinic_id', '')::uuid;
  v_supplier uuid := nullif(p ->> 'supplier_id', '')::uuid;
  v_category uuid := nullif(p ->> 'category_id', '')::uuid;
  v_sub uuid := nullif(p ->> 'subcategory_id', '')::uuid;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_contact uuid := nullif(p ->> 'collection_contact_id', '')::uuid;
  v_owner uuid := nullif(p ->> 'owner_user_id', '')::uuid;
  v_nature text := public._debt_text(p, 'nature_code');
  v_account text := public._debt_text(p, 'account_code');
  v_issue date := nullif(p ->> 'issue_date', '')::date;
  v_accrual date := date_trunc('month', nullif(p ->> 'accrual_month', '')::date)::date;
  v_due date := nullif(p ->> 'due_date', '')::date;
  v_origin text := public._debt_text(p, 'origin');
  v_reason text := public._debt_text(p, 'origin_override_reason');
  v_suggested text;
  v_original bigint := nullif(p ->> 'original_cents', '')::bigint;
  v_updated bigint := nullif(p ->> 'updated_cents', '')::bigint;
  v_tags uuid[];
  v_priority_reasons text[];
begin
  if v_uid is null then raise exception 'Entre no sistema para lançar dívidas.'; end if;

  if v_id is not null then
    select * into v_old from public.debts where id = v_id and deleted_at is null for update;
    if not found then raise exception 'Dívida não encontrada (ou excluída).'; end if;
    -- Depois de gerar títulos no Financeiro (fase 3), o devedor não muda.
    if v_old.finance_synced_at is not null and v_clinic is distinct from v_old.clinic_id then
      raise exception 'Esta dívida já tem títulos no Contas a Pagar; o devedor não pode mudar.';
    end if;
  end if;

  if v_clinic is null then raise exception 'Informe o devedor (unidade ou franqueadora).'; end if;
  if not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para lançar dívidas.';
  end if;
  if not exists (select 1 from public.clinics where id = v_clinic) then
    raise exception 'Devedor não encontrado.';
  end if;
  if v_supplier is null or not exists (select 1 from public.suppliers where id = v_supplier) then
    raise exception 'Informe o credor (cadastro de fornecedores).';
  end if;
  if v_due is null then raise exception 'Informe a data de vencimento.'; end if;
  if coalesce(v_original, 0) <= 0 and coalesce(v_updated, 0) <= 0 then
    raise exception 'Informe o valor da dívida (original ou atualizado).';
  end if;

  if v_category is not null and not exists (
       select 1 from public.debt_categories where id = v_category and parent_id is null) then
    raise exception 'Categoria inválida.';
  end if;
  if v_sub is not null and not exists (
       select 1 from public.debt_categories where id = v_sub and parent_id = v_category) then
    raise exception 'A subcategoria não pertence à categoria escolhida.';
  end if;
  -- Categoria desativada some para lançamento NOVO; a dívida antiga que já a
  -- usa continua podendo ser editada sem trocar.
  if v_category is not null and v_category is distinct from v_old.category_id
     and exists (select 1 from public.debt_categories where id = v_category and not active) then
    raise exception 'Esta categoria está desativada.';
  end if;
  if v_sub is not null and v_sub is distinct from v_old.subcategory_id
     and exists (select 1 from public.debt_categories where id = v_sub and not active) then
    raise exception 'Esta subcategoria está desativada.';
  end if;
  -- A natureza vem da categoria quando não foi escolhida.
  if v_nature is null and v_category is not null then
    select nature_code into v_nature from public.debt_categories where id = v_category;
  end if;
  if v_nature is not null and not exists (select 1 from public.debt_natures where code = v_nature) then
    raise exception 'Natureza inválida.';
  end if;
  if v_account is not null and not exists (
       select 1 from public.chart_of_accounts where code = v_account and is_analytic and active) then
    raise exception 'Conta do plano de contas inválida (escolha uma conta analítica ativa).';
  end if;
  if v_group is not null and not exists (
       select 1 from public.debt_groups where id = v_group and clinic_id = v_clinic and supplier_id = v_supplier) then
    raise exception 'O grupo precisa ser do mesmo devedor e do mesmo credor.';
  end if;
  if v_contact is not null and not exists (
       select 1 from public.debt_creditor_contacts where id = v_contact and supplier_id = v_supplier) then
    raise exception 'O contato de cobrança precisa ser do mesmo credor.';
  end if;
  if v_owner is not null and not exists (select 1 from public.profiles where id = v_owner) then
    raise exception 'Responsável não encontrado.';
  end if;

  -- A origem: sugerida pela data em que a dívida nasceu (D2). Discordar da
  -- sugestão (A ↔ B) exige justificativa; C (já está no Contas a Pagar) não.
  v_suggested := public.debt_suggest_origin(v_clinic, v_issue, v_accrual);
  if v_origin is null or v_origin not in ('A', 'B', 'C') then
    raise exception 'Escolha a origem do lançamento (A, B ou C).';
  end if;
  if v_suggested is not null and v_origin <> 'C' and v_origin <> v_suggested
     and coalesce(length(v_reason), 0) < 5 then
    raise exception 'A origem escolhida difere da sugerida pela data de implantação: escreva a justificativa.';
  end if;
  if v_origin = v_suggested then v_reason := null; end if;

  select coalesce(array_agg(x), '{}') into v_priority_reasons
    from jsonb_array_elements_text(coalesce(p -> 'priority_reasons', '[]'::jsonb)) x
   where x in ('fornecedor_essencial', 'trava_credito', 'risco_protesto_acao',
               'avalista_pf', 'desconto_alto_prazo_curto');

  if v_id is null then
    insert into public.debts (
      clinic_id, supplier_id, group_id, collection_contact_id, debt_type, contract_number,
      installment_label, description, bundled_count, needs_split, has_guarantor, guarantor_name,
      real_guarantee, receivables_assignment, guarantee_notes, category_id, subcategory_id,
      nature_code, account_code, tax_active_debt, original_cents, updated_cents, updated_ref_date,
      interest_cents, fine_cents, charges_cents, contract_rate_percent, accrual_month, issue_date,
      due_date, origin, origin_suggested, origin_override_reason, priority, priority_reasons,
      owner_user_id, next_action, next_action_on, notes, created_by, updated_by)
    values (
      v_clinic, v_supplier, v_group, v_contact, coalesce(public._debt_text(p, 'debt_type'), 'outro'),
      public._debt_text(p, 'contract_number'), public._debt_text(p, 'installment_label'),
      public._debt_text(p, 'description'), greatest(1, coalesce(nullif(p ->> 'bundled_count', '')::integer, 1)),
      coalesce((p ->> 'needs_split')::boolean, false), coalesce((p ->> 'has_guarantor')::boolean, false),
      public._debt_text(p, 'guarantor_name'), public._debt_text(p, 'real_guarantee'),
      coalesce((p ->> 'receivables_assignment')::boolean, false), public._debt_text(p, 'guarantee_notes'),
      v_category, v_sub, v_nature, v_account, coalesce((p ->> 'tax_active_debt')::boolean, false),
      v_original, v_updated, nullif(p ->> 'updated_ref_date', '')::date,
      nullif(p ->> 'interest_cents', '')::bigint, nullif(p ->> 'fine_cents', '')::bigint,
      nullif(p ->> 'charges_cents', '')::bigint, nullif(p ->> 'contract_rate_percent', '')::numeric,
      v_accrual, v_issue, v_due, v_origin, v_suggested, v_reason,
      public._debt_text(p, 'priority'), v_priority_reasons, v_owner,
      public._debt_text(p, 'next_action'), nullif(p ->> 'next_action_on', '')::date,
      public._debt_text(p, 'notes'), v_uid, v_uid)
    returning id into v_id;
    insert into public.debt_events (debt_id, user_id, kind, data)
    values (v_id, v_uid, 'criada', jsonb_build_object('origin', v_origin, 'origin_suggested', v_suggested));
  else
    update public.debts set
      clinic_id = v_clinic, supplier_id = v_supplier, group_id = v_group,
      collection_contact_id = v_contact,
      debt_type = coalesce(public._debt_text(p, 'debt_type'), 'outro'),
      contract_number = public._debt_text(p, 'contract_number'),
      installment_label = public._debt_text(p, 'installment_label'),
      description = public._debt_text(p, 'description'),
      bundled_count = greatest(1, coalesce(nullif(p ->> 'bundled_count', '')::integer, 1)),
      needs_split = coalesce((p ->> 'needs_split')::boolean, false),
      has_guarantor = coalesce((p ->> 'has_guarantor')::boolean, false),
      guarantor_name = public._debt_text(p, 'guarantor_name'),
      real_guarantee = public._debt_text(p, 'real_guarantee'),
      receivables_assignment = coalesce((p ->> 'receivables_assignment')::boolean, false),
      guarantee_notes = public._debt_text(p, 'guarantee_notes'),
      category_id = v_category, subcategory_id = v_sub, nature_code = v_nature, account_code = v_account,
      tax_active_debt = coalesce((p ->> 'tax_active_debt')::boolean, false),
      original_cents = v_original, updated_cents = v_updated,
      updated_ref_date = nullif(p ->> 'updated_ref_date', '')::date,
      interest_cents = nullif(p ->> 'interest_cents', '')::bigint,
      fine_cents = nullif(p ->> 'fine_cents', '')::bigint,
      charges_cents = nullif(p ->> 'charges_cents', '')::bigint,
      contract_rate_percent = nullif(p ->> 'contract_rate_percent', '')::numeric,
      accrual_month = v_accrual, issue_date = v_issue, due_date = v_due,
      origin = v_origin, origin_suggested = v_suggested, origin_override_reason = v_reason,
      priority = public._debt_text(p, 'priority'), priority_reasons = v_priority_reasons,
      owner_user_id = v_owner, next_action = public._debt_text(p, 'next_action'),
      next_action_on = nullif(p ->> 'next_action_on', '')::date,
      notes = public._debt_text(p, 'notes'),
      updated_by = v_uid, updated_at = now()
    where id = v_id;
  end if;

  -- Etiquetas: a lista inteira vem do formulário (só as que existem).
  if p ? 'tag_ids' then
    select coalesce(array_agg(t.id), '{}') into v_tags
      from public.debt_tags t
     where t.id in (select x::uuid from jsonb_array_elements_text(p -> 'tag_ids') x);
    delete from public.debt_tag_links where debt_id = v_id and not (tag_id = any (v_tags));
    insert into public.debt_tag_links (debt_id, tag_id, created_by)
    select v_id, t, v_uid from unnest(v_tags) t
    on conflict do nothing;
  end if;

  perform public._debt_refresh_status(v_id, false);
  return v_id;
end;
$$;
revoke execute on function public.debt_save(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save(jsonb) to authenticated;

-- Exclusão LÓGICA, com motivo (3.8). Fica no histórico e nos relatórios de
-- auditoria; some da lista.
create or replace function public.debt_delete(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.debts%rowtype;
begin
  select * into d from public.debts where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Dívida não encontrada (ou já excluída).'; end if;
  if not public.debt_can('acao.dividas.excluir', d.clinic_id) then
    raise exception 'Você não tem permissão para excluir dívidas.';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escreva o motivo da exclusão.';
  end if;
  -- A fase 3 acrescenta: cancelar os títulos gerados (e recusar se houver pago).
  if d.finance_synced_at is not null then
    raise exception 'Esta dívida já tem títulos no Contas a Pagar; a exclusão com estorno chega na fase 3.';
  end if;
  update public.debts
     set deleted_at = now(), deleted_by = v_uid, deleted_reason = btrim(p_reason),
         updated_by = v_uid, updated_at = now()
   where id = p_id;
  insert into public.debt_events (debt_id, user_id, kind, note)
  values (p_id, v_uid, 'excluida', btrim(p_reason));
end;
$$;
revoke execute on function public.debt_delete(uuid, text) from public, anon, authenticated;
grant execute on function public.debt_delete(uuid, text) to authenticated;

-- O que só gente decide: em negociação (D10), contestada, judicial, baixada.
-- Nulo = volta à situação pelo vencimento.
create or replace function public.debt_set_stage(p_id uuid, p_stage text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.debts%rowtype;
  v_stage text := nullif(btrim(p_stage), '');
begin
  select * into d from public.debts where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', d.clinic_id) then
    raise exception 'Você não tem permissão para mudar a situação.';
  end if;
  if v_stage is not null and v_stage not in ('em_negociacao', 'contestada', 'judicial', 'baixada') then
    raise exception 'Situação inválida.';
  end if;
  if v_stage is distinct from d.manual_stage and coalesce(length(btrim(p_reason)), 0) < 5
     and (v_stage in ('contestada', 'judicial', 'baixada') or d.manual_stage in ('contestada', 'judicial', 'baixada')) then
    raise exception 'Escreva o motivo da mudança de situação.';
  end if;
  update public.debts
     set manual_stage = v_stage, stage_reason = nullif(btrim(p_reason), ''),
         updated_by = v_uid, updated_at = now()
   where id = p_id;
  if v_stage is distinct from d.manual_stage then
    insert into public.debt_events (debt_id, user_id, kind, note, data)
    values (p_id, v_uid, 'etapa_manual', nullif(btrim(p_reason), ''),
            jsonb_build_object('de', d.manual_stage, 'para', v_stage));
  end if;
  return public._debt_refresh_status(p_id, false);
end;
$$;
revoke execute on function public.debt_set_stage(uuid, text, text) from public, anon, authenticated;
grant execute on function public.debt_set_stage(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10) AS OUTRAS PORTAS (grupo, contato, configuração)
-- -----------------------------------------------------------------------------
create or replace function public.debt_save_group(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_clinic uuid := nullif(p ->> 'clinic_id', '')::uuid;
  v_supplier uuid := nullif(p ->> 'supplier_id', '')::uuid;
  v_label text := public._debt_text(p, 'label');
begin
  if v_clinic is null or not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para criar grupos de dívidas.';
  end if;
  if v_supplier is null then raise exception 'Informe o credor do grupo.'; end if;
  if v_label is null then raise exception 'Dê um nome ao grupo.'; end if;
  if v_id is null then
    insert into public.debt_groups (clinic_id, supplier_id, label, contract_number, notes, created_by, updated_by)
    values (v_clinic, v_supplier, v_label, public._debt_text(p, 'contract_number'),
            public._debt_text(p, 'notes'), v_uid, v_uid)
    returning id into v_id;
  else
    -- Devedor e credor do grupo não mudam (as dívidas dele dependem disso).
    update public.debt_groups
       set label = v_label, contract_number = public._debt_text(p, 'contract_number'),
           notes = public._debt_text(p, 'notes'), updated_by = v_uid, updated_at = now()
     where id = v_id and clinic_id = v_clinic and supplier_id = v_supplier;
    if not found then raise exception 'Grupo não encontrado.'; end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_save_group(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_group(jsonb) to authenticated;

create or replace function public.debt_save_creditor_contact(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_supplier uuid := nullif(p ->> 'supplier_id', '')::uuid;
  v_kind text := coalesce(public._debt_text(p, 'kind'), 'credor');
begin
  if not public.debt_can('acao.dividas.lancar', null) then
    raise exception 'Você não tem permissão para editar contatos de cobrança.';
  end if;
  if v_supplier is null or not exists (select 1 from public.suppliers where id = v_supplier) then
    raise exception 'Credor não encontrado.';
  end if;
  if v_kind not in ('credor', 'assessoria', 'advogado', 'cartorio') then
    raise exception 'Tipo de contato inválido.';
  end if;
  if public._debt_text(p, 'person_name') is null and public._debt_text(p, 'organization') is null then
    raise exception 'Informe o nome da pessoa ou da empresa.';
  end if;
  if v_id is null then
    insert into public.debt_creditor_contacts (supplier_id, kind, organization, person_name, phone,
      whatsapp, email, notes, active, created_by, updated_by)
    values (v_supplier, v_kind, public._debt_text(p, 'organization'), public._debt_text(p, 'person_name'),
      regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'),
      regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'),
      lower(public._debt_text(p, 'email')), public._debt_text(p, 'notes'),
      coalesce((p ->> 'active')::boolean, true), v_uid, v_uid)
    returning id into v_id;
  else
    update public.debt_creditor_contacts
       set kind = v_kind, organization = public._debt_text(p, 'organization'),
           person_name = public._debt_text(p, 'person_name'),
           phone = regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'),
           whatsapp = regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'),
           email = lower(public._debt_text(p, 'email')), notes = public._debt_text(p, 'notes'),
           active = coalesce((p ->> 'active')::boolean, true),
           updated_by = v_uid, updated_at = now()
     where id = v_id and supplier_id = v_supplier;
    if not found then raise exception 'Contato não encontrado.'; end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_save_creditor_contact(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_creditor_contact(jsonb) to authenticated;

-- Etiqueta: criar na hora é de quem lança; editar/desativar é configuração.
create or replace function public.debt_save_tag(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := public._debt_text(p, 'name');
begin
  if v_name is null then raise exception 'Dê um nome à etiqueta.'; end if;
  if v_id is null then
    if not public.debt_can('acao.dividas.lancar', null) then
      raise exception 'Você não tem permissão para criar etiquetas.';
    end if;
    select id into v_id from public.debt_tags where lower(btrim(name)) = lower(v_name);
    if v_id is not null then return v_id; end if; -- já existe: usa a mesma
    insert into public.debt_tags (name, color, created_by, updated_by)
    values (v_name, public._debt_text(p, 'color'), v_uid, v_uid)
    returning id into v_id;
  else
    if not public.debt_can('acao.dividas.configurar', null) then
      raise exception 'Você não tem permissão para editar etiquetas.';
    end if;
    update public.debt_tags
       set name = v_name, color = public._debt_text(p, 'color'),
           active = coalesce((p ->> 'active')::boolean, true),
           updated_by = v_uid, updated_at = now()
     where id = v_id;
    if not found then raise exception 'Etiqueta não encontrada.'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe uma etiqueta com esse nome.';
end;
$$;
revoke execute on function public.debt_save_tag(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_tag(jsonb) to authenticated;

create or replace function public.debt_save_category(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_parent uuid := nullif(p ->> 'parent_id', '')::uuid;
  v_name text := public._debt_text(p, 'name');
  v_nature text := public._debt_text(p, 'nature_code');
  v_open text := public._debt_text(p, 'opening_account_code');
  v_exp text := public._debt_text(p, 'expense_account_code');
begin
  if not public.debt_can('acao.dividas.configurar', null) then
    raise exception 'Você não tem permissão para configurar as categorias.';
  end if;
  if v_name is null then raise exception 'Dê um nome à categoria.'; end if;
  if v_nature is not null and not exists (select 1 from public.debt_natures where code = v_nature) then
    raise exception 'Natureza inválida.';
  end if;
  if v_open is not null and not exists (select 1 from public.chart_of_accounts where code = v_open and is_analytic) then
    raise exception 'Conta de saldo de implantação inválida.';
  end if;
  if v_exp is not null and not exists (select 1 from public.chart_of_accounts where code = v_exp and is_analytic) then
    raise exception 'Conta de despesa inválida.';
  end if;
  if v_id is null then
    insert into public.debt_categories (parent_id, name, nature_code, opening_account_code,
      expense_account_code, sort_order, active, created_by, updated_by)
    values (v_parent, v_name, v_nature, v_open, v_exp,
      coalesce(nullif(p ->> 'sort_order', '')::integer, 0), coalesce((p ->> 'active')::boolean, true), v_uid, v_uid)
    returning id into v_id;
  else
    update public.debt_categories
       set parent_id = v_parent, name = v_name, nature_code = v_nature,
           opening_account_code = v_open, expense_account_code = v_exp,
           sort_order = coalesce(nullif(p ->> 'sort_order', '')::integer, sort_order),
           active = coalesce((p ->> 'active')::boolean, active),
           updated_by = v_uid, updated_at = now()
     where id = v_id;
    if not found then raise exception 'Categoria não encontrada.'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe uma categoria com esse nome neste nível.';
end;
$$;
revoke execute on function public.debt_save_category(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_category(jsonb) to authenticated;

create or replace function public.debt_save_nature(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := public._debt_text(p, 'code');
  v_label text := public._debt_text(p, 'label');
begin
  if not public.debt_can('acao.dividas.configurar', null) then
    raise exception 'Você não tem permissão para configurar as naturezas.';
  end if;
  if v_label is null then raise exception 'Dê um nome à natureza.'; end if;
  if v_code is null then
    v_code := left(regexp_replace(lower(translate(v_label,
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '_', 'g'), 40);
    v_code := btrim(v_code, '_');
    if v_code = '' then v_code := 'natureza'; end if;
    while exists (select 1 from public.debt_natures where code = v_code) loop
      v_code := v_code || '_2';
    end loop;
    insert into public.debt_natures (code, label, sort_order, active, updated_by)
    values (v_code, v_label, coalesce(nullif(p ->> 'sort_order', '')::integer, 100), true, v_uid);
  else
    update public.debt_natures
       set label = v_label,
           sort_order = coalesce(nullif(p ->> 'sort_order', '')::integer, sort_order),
           active = coalesce((p ->> 'active')::boolean, active),
           updated_by = v_uid, updated_at = now()
     where code = v_code;
    if not found then raise exception 'Natureza não encontrada.'; end if;
  end if;
  return v_code;
end;
$$;
revoke execute on function public.debt_save_nature(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_nature(jsonb) to authenticated;

-- Regra da rede (p_clinic_id nulo) ou do devedor. Na linha do devedor, campo
-- vazio = segue a rede.
create or replace function public.debt_save_settings(p_clinic_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_alerts integer[];
begin
  if not public.debt_can('acao.dividas.configurar', p_clinic_id) then
    raise exception 'Você não tem permissão para configurar o Levantamento de Dívidas.';
  end if;
  if p ? 'proposal_alert_days' and jsonb_typeof(p -> 'proposal_alert_days') = 'array' then
    select array_agg(distinct x::integer order by x::integer desc) into v_alerts
      from jsonb_array_elements_text(p -> 'proposal_alert_days') x
     where x ~ '^\d+$' and x::integer between 0 and 60;
  end if;
  if p_clinic_id is null and (nullif(p ->> 'days_to_default', '') is null) then
    raise exception 'A regra da rede precisa do prazo para virar inadimplente.';
  end if;
  insert into public.debt_settings (clinic_id, days_to_default, about_to_default_days, proposal_alert_days,
    negativation_removal_bdays, closing_stale_days, agreement_broken_tolerance_bdays,
    agreement_approval_threshold_cents, discount_recognition, surcharge_recognition, updated_by, updated_at)
  values (p_clinic_id,
    nullif(p ->> 'days_to_default', '')::integer,
    nullif(p ->> 'about_to_default_days', '')::integer,
    v_alerts,
    nullif(p ->> 'negativation_removal_bdays', '')::integer,
    nullif(p ->> 'closing_stale_days', '')::integer,
    nullif(p ->> 'agreement_broken_tolerance_bdays', '')::integer,
    case when p_clinic_id is null then nullif(p ->> 'agreement_approval_threshold_cents', '')::bigint end,
    case when p_clinic_id is null then public._debt_text(p, 'discount_recognition') end,
    case when p_clinic_id is null then public._debt_text(p, 'surcharge_recognition') end,
    v_uid, now())
  on conflict (clinic_id) do update set
    days_to_default = excluded.days_to_default,
    about_to_default_days = excluded.about_to_default_days,
    proposal_alert_days = excluded.proposal_alert_days,
    negativation_removal_bdays = excluded.negativation_removal_bdays,
    closing_stale_days = excluded.closing_stale_days,
    agreement_broken_tolerance_bdays = excluded.agreement_broken_tolerance_bdays,
    agreement_approval_threshold_cents = excluded.agreement_approval_threshold_cents,
    discount_recognition = excluded.discount_recognition,
    surcharge_recognition = excluded.surcharge_recognition,
    updated_by = v_uid, updated_at = now();

  -- Prazo mudou: a situação das dívidas abertas é recalculada já.
  perform public._debt_refresh_status(d.id, false)
     from public.debts d
    where d.deleted_at is null and (p_clinic_id is null or d.clinic_id = p_clinic_id);
end;
$$;
revoke execute on function public.debt_save_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_settings(uuid, jsonb) to authenticated;

-- Linha da unidade sem nada próprio: apagar = voltar a seguir a rede.
create or replace function public.debt_reset_settings(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_clinic_id is null then raise exception 'A regra da rede não se apaga.'; end if;
  if not public.debt_can('acao.dividas.configurar', p_clinic_id) then
    raise exception 'Você não tem permissão para configurar o Levantamento de Dívidas.';
  end if;
  delete from public.debt_settings where clinic_id = p_clinic_id;
  perform public._debt_refresh_status(d.id, false)
     from public.debts d where d.deleted_at is null and d.clinic_id = p_clinic_id;
end;
$$;
revoke execute on function public.debt_reset_settings(uuid) from public, anon, authenticated;
grant execute on function public.debt_reset_settings(uuid) to authenticated;

-- Prazo por tipo de credor; dias nulo = tira a regra (segue devedor/rede).
create or replace function public.debt_save_default_rule(p_supplier_kind text, p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.debt_can('acao.dividas.configurar', null) then
    raise exception 'Você não tem permissão para configurar o Levantamento de Dívidas.';
  end if;
  if p_days is null then
    delete from public.debt_default_rules where supplier_kind = p_supplier_kind;
  else
    insert into public.debt_default_rules (supplier_kind, days_to_default, updated_by, updated_at)
    values (p_supplier_kind, p_days, (select auth.uid()), now())
    on conflict (supplier_kind) do update
      set days_to_default = excluded.days_to_default, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform public._debt_refresh_status(d.id, false)
     from public.debts d join public.suppliers s on s.id = d.supplier_id
    where d.deleted_at is null and s.kind = p_supplier_kind;
end;
$$;
revoke execute on function public.debt_save_default_rule(text, integer) from public, anon, authenticated;
grant execute on function public.debt_save_default_rule(text, integer) to authenticated;

create or replace function public.debt_set_go_live(p_clinic_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.debt_can('acao.dividas.configurar', p_clinic_id) then
    raise exception 'Você não tem permissão para mudar a data de implantação.';
  end if;
  update public.clinics set go_live_on = p_date where id = p_clinic_id;
  if not found then raise exception 'Unidade não encontrada.'; end if;
end;
$$;
revoke execute on function public.debt_set_go_live(uuid, date) from public, anon, authenticated;
grant execute on function public.debt_set_go_live(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 11) A ABA HISTÓRICO: a trilha campo a campo + os eventos de negócio
-- -----------------------------------------------------------------------------
create or replace function public.debt_history(p_debt_id uuid)
returns table (
  source text,
  occurred_at timestamptz,
  user_name text,
  actor text,
  table_name text,
  op text,
  changes jsonb,
  event_kind text,
  from_status text,
  to_status text,
  note text
)
language sql
stable
security definer
set search_path = ''
as $$
  with alvo as (
    select d.id from public.debts d
     where d.id = p_debt_id and public.debt_can('modulo.dividas', d.clinic_id)
  )
  select 'trilha', a.occurred_at, pr.full_name, a.actor, a.table_name, a.op, a.changes,
         null, null, null, null
    from public.audit_changes a
    join alvo on true
    left join public.profiles pr on pr.id = a.user_id
   where a.schema_name = 'public'
     and ((a.table_name = 'debts' and a.row_id = p_debt_id::text)
       or (a.table_name = 'debt_tag_links' and a.row_id like p_debt_id::text || ',%'))
  union all
  select 'evento', e.occurred_at, pr.full_name, case when e.user_id is null then 'sistema' else 'usuario' end,
         null, null, e.data, e.kind, e.from_status, e.to_status, e.note
    from public.debt_events e
    join alvo on alvo.id = e.debt_id
    left join public.profiles pr on pr.id = e.user_id
  order by 2 desc
  limit 500;
$$;
revoke execute on function public.debt_history(uuid) from public, anon, authenticated;
grant execute on function public.debt_history(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 12) LEITURA (RLS) — só quem tem o módulo; nenhuma regra de escrita
-- -----------------------------------------------------------------------------
alter table public.debt_settings enable row level security;
alter table public.debt_default_rules enable row level security;
alter table public.debt_natures enable row level security;
alter table public.debt_categories enable row level security;
alter table public.debt_tags enable row level security;
alter table public.debt_tag_links enable row level security;
alter table public.debt_creditor_contacts enable row level security;
alter table public.debt_groups enable row level security;
alter table public.debts enable row level security;
alter table public.debt_events enable row level security;

drop policy if exists "debt_settings_select" on public.debt_settings;
create policy "debt_settings_select" on public.debt_settings for select to authenticated
  using (public.debt_can('modulo.dividas', clinic_id));
drop policy if exists "debt_default_rules_select" on public.debt_default_rules;
create policy "debt_default_rules_select" on public.debt_default_rules for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_natures_select" on public.debt_natures;
create policy "debt_natures_select" on public.debt_natures for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_categories_select" on public.debt_categories;
create policy "debt_categories_select" on public.debt_categories for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_tags_select" on public.debt_tags;
create policy "debt_tags_select" on public.debt_tags for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_creditor_contacts_select" on public.debt_creditor_contacts;
create policy "debt_creditor_contacts_select" on public.debt_creditor_contacts for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_groups_select" on public.debt_groups;
create policy "debt_groups_select" on public.debt_groups for select to authenticated
  using (public.debt_can('modulo.dividas', clinic_id));
drop policy if exists "debts_select" on public.debts;
create policy "debts_select" on public.debts for select to authenticated
  using (public.debt_can('modulo.dividas', clinic_id));
drop policy if exists "debt_tag_links_select" on public.debt_tag_links;
create policy "debt_tag_links_select" on public.debt_tag_links for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
drop policy if exists "debt_events_select" on public.debt_events;
create policy "debt_events_select" on public.debt_events for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));

-- -----------------------------------------------------------------------------
-- 13) AUDITORIA (regra 7 do CLAUDE.md)
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'debt_events', 'Linha do tempo da dívida: ela própria é o histórico, só cresce (0404).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois): o esperado é 10 · 4 · 15+ · 3 · true
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from pg_tables where schemaname = 'public' and tablename like 'debt%') as tabelas,
--   (select count(*) from public.debt_natures) as naturezas,
--   (select count(*) from public.debt_categories where parent_id is null) as categorias,
--   (select count(*) from public.clinics where go_live_on = date '2026-11-16') as implantacao,
--   (select count(*) from public.debt_settings where clinic_id is null) = 1 as regra_da_rede;
