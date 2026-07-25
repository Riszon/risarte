-- =============================================================================
-- Risarte Odontologia — Migration 0162 (PPR1 — Programa de Prevenção Riso+)
--
-- Fundação do PPR+: catálogo de planos configuráveis, vantagens, faixas de
-- desconto por parcelamento, benefícios por procedimento (cobertura/carência/
-- frequência), adesões (titular + dependentes), mensalidades, uso de
-- benefícios, histórico e pontos do Riso+ Social.
--
-- Regras confirmadas pelo dono (docs/PPR.md §14):
--   1) valor do plano = MENSALIDADE (sem taxa de adesão);
--   2) parcelamento trava pelo VALOR MÍNIMO DA PARCELA;
--   3) desconto no parcelado vem de uma TABELA por nº de parcelas;
--   5) plano só ativa com CONTRATO ASSINADO + 1ª MENSALIDADE PAGA (a carência
--      conta a partir daí);
--   6) 30 dias de atraso SUSPENDE, 90 dias CANCELA (configurável);
--   7) cliente ganha o campo "Indicado por";
--   8) dependente com CPF opcional, mesma unidade do titular;
--   9) valores dos planos são da REDE (sem ajuste por unidade);
--  10) vende: Consultor Comercial (comercial) / Recepção, Gerente e
--      Coordenador (venda direta). Cancela/suspende: Gerente e Admin;
--  11) escova entregue a cada limpeza é controlada;
--  12) pontos do Riso+ Social proporcionais ao valor pago (Light não pontua).
-- Idempotente.
-- =============================================================================

-- 1) Catálogo de planos ---------------------------------------------------------
create table if not exists public.ppr_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  description text,
  -- Mensalidade do plano (decisão 1). Valores da REDE (decisão 9).
  monthly_cents integer not null default 0 check (monthly_cents >= 0),
  -- Dependentes (decisão 8).
  allows_dependents boolean not null default false,
  included_dependents integer not null default 0 check (included_dependents >= 0),
  allows_extra_dependents boolean not null default false,
  extra_dependent_cents integer not null default 0 check (extra_dependent_cents >= 0),
  max_dependents integer,
  -- Regras comerciais do plano (ficam ACIMA da regra da rede/unidade).
  cash_discount_percent numeric(5,2) not null default 0,
  max_installments integer not null default 1 check (max_installments >= 1),
  -- Decisão 2: o parcelamento trava pelo valor mínimo da parcela.
  min_installment_cents integer not null default 0 check (min_installment_cents >= 0),
  allowed_methods text[],
  -- Formas de pagamento da MENSALIDADE (recorrentes).
  recurring_methods text[] not null
    default array['credito_recorrente','debito_recorrente','pix_recorrente']::text[],
  -- Carência geral do plano, em dias, contada da ATIVAÇÃO (decisão 5).
  grace_period_days integer not null default 0 check (grace_period_days >= 0),
  -- Riso+ Social (decisão 12): pontos por faixa de valor pago.
  social_enabled boolean not null default false,
  social_points_per_cents integer not null default 5000
    check (social_points_per_cents > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

-- Vantagens em texto (aparecem na venda e no contrato de adesão).
create table if not exists public.ppr_plan_perks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ppr_plans (id) on delete cascade,
  label text not null,
  sort_order integer not null default 0
);
create index if not exists ppr_plan_perks_plan_idx
  on public.ppr_plan_perks (plan_id, sort_order);

-- Decisão 3: desconto do parcelado por faixa de parcelas (o sistema aplica).
create table if not exists public.ppr_plan_installment_tiers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ppr_plans (id) on delete cascade,
  up_to_installments integer not null check (up_to_installments >= 1),
  discount_percent numeric(5,2) not null default 0,
  unique (plan_id, up_to_installments)
);

-- Benefício por procedimento (ou por especialidade quando procedure_id é nulo).
create table if not exists public.ppr_plan_benefits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ppr_plans (id) on delete cascade,
  procedure_id uuid references public.procedures (id),
  specialty text,
  -- free = isento (100%), percent = desconto, none = sem benefício.
  benefit_type text not null default 'percent'
    check (benefit_type in ('free','percent','none')),
  benefit_value numeric(5,2),
  grace_period_days integer not null default 0 check (grace_period_days >= 0),
  -- Frequência: libera de novo depois de N meses (limpeza a cada 4/6 meses).
  frequency_months integer,
  usage_limit_count integer,
  usage_period_months integer,
  -- Decisão 11: brinde entregue junto (escova a cada limpeza).
  gift_label text,
  created_at timestamptz not null default now()
);
create index if not exists ppr_plan_benefits_plan_idx
  on public.ppr_plan_benefits (plan_id);
create index if not exists ppr_plan_benefits_procedure_idx
  on public.ppr_plan_benefits (procedure_id);

-- 2) Configuração de inadimplência (cascata rede/unidade) ----------------------
create table if not exists public.ppr_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id),
  -- Decisão 6.
  suspend_after_days integer not null default 30 check (suspend_after_days >= 0),
  cancel_after_days integer not null default 90 check (cancel_after_days >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
create unique index if not exists ppr_settings_clinic_key
  on public.ppr_settings (coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid));
insert into public.ppr_settings (clinic_id, suspend_after_days, cancel_after_days)
select null, 30, 90
where not exists (select 1 from public.ppr_settings where clinic_id is null);

-- 3) Adesões (o plano vendido) --------------------------------------------------
create table if not exists public.ppr_memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  plan_id uuid not null references public.ppr_plans (id),
  holder_client_id uuid not null references public.clients (id),
  -- aguardando_ativacao → ativo → suspenso → cancelado (decisões 5 e 6).
  status text not null default 'aguardando_ativacao'
    check (status in ('aguardando_ativacao','ativo','suspenso','cancelado')),
  monthly_cents integer not null default 0,
  extra_dependents integer not null default 0,
  payment_method text
    check (payment_method is null or payment_method in
      ('credito_recorrente','debito_recorrente','pix_recorrente')),
  billing_day integer check (billing_day is null or (billing_day between 1 and 28)),
  -- Regra de ouro do PPR+ (decisão 5).
  contract_signed boolean not null default false,
  contract_signed_at timestamptz,
  contract_signed_by uuid references public.profiles (id),
  first_payment_confirmed boolean not null default false,
  first_payment_at timestamptz,
  first_payment_by uuid references public.profiles (id),
  activated_at timestamptz,
  suspended_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  -- De onde veio a venda (decisão 10).
  sale_origin text not null default 'venda_direta'
    check (sale_origin in ('comercial','venda_direta')),
  sold_by uuid references public.profiles (id),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ppr_memberships_clinic_idx
  on public.ppr_memberships (clinic_id, status);
create index if not exists ppr_memberships_holder_idx
  on public.ppr_memberships (holder_client_id);

-- Beneficiários: titular + dependentes (cada um com prontuário próprio).
create table if not exists public.ppr_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.ppr_memberships (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  role text not null default 'dependente'
    check (role in ('titular','dependente')),
  relationship text,
  -- Cartão rastreável do beneficiário (PPR4).
  card_code text unique,
  is_extra boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ppr_beneficiaries_membership_idx
  on public.ppr_beneficiaries (membership_id);
create index if not exists ppr_beneficiaries_client_idx
  on public.ppr_beneficiaries (client_id);

-- Mensalidades.
create table if not exists public.ppr_charges (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.ppr_memberships (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  reference_month date not null,
  due_date date not null,
  amount_cents integer not null default 0,
  status text not null default 'em_aberto'
    check (status in ('em_aberto','paga','atrasada','cancelada')),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id),
  external_id text,
  created_at timestamptz not null default now(),
  unique (membership_id, reference_month)
);
create index if not exists ppr_charges_clinic_idx
  on public.ppr_charges (clinic_id, status, due_date);

-- Uso dos benefícios (controla carência e frequência; alimenta a projeção).
create table if not exists public.ppr_benefit_usages (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.ppr_memberships (id) on delete cascade,
  beneficiary_id uuid not null references public.ppr_beneficiaries (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  procedure_id uuid references public.procedures (id),
  benefit_id uuid references public.ppr_plan_benefits (id),
  appointment_id uuid references public.appointments (id),
  used_at timestamptz not null default now(),
  -- Quando o benefício libera de novo (fez a limpeza → +N meses).
  next_available_at timestamptz,
  -- Decisão 11: brinde entregue no atendimento.
  gift_delivered boolean not null default false,
  gift_delivered_at timestamptz,
  registered_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists ppr_benefit_usages_client_idx
  on public.ppr_benefit_usages (client_id, used_at);
create index if not exists ppr_benefit_usages_next_idx
  on public.ppr_benefit_usages (clinic_id, next_available_at);

-- Histórico do plano.
create table if not exists public.ppr_events (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.ppr_memberships (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  event_type text not null,
  description text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists ppr_events_membership_idx
  on public.ppr_events (membership_id, created_at);

-- Pontos do Riso+ Social (o módulo social usa depois).
create table if not exists public.ppr_social_points (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.ppr_memberships (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  reference_month date not null,
  points integer not null default 0,
  source_cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (membership_id, reference_month)
);
create index if not exists ppr_social_points_clinic_idx
  on public.ppr_social_points (clinic_id, reference_month);

-- 4) Marcação no cliente --------------------------------------------------------
alter table public.clients
  add column if not exists ppr_membership_id uuid references public.ppr_memberships (id);
alter table public.clients
  add column if not exists ppr_active boolean;
-- Decisão 7: "Indicado por" (habilita os benefícios de indicação do PPR+).
alter table public.clients
  add column if not exists referred_by_client_id uuid references public.clients (id);

comment on column public.clients.ppr_membership_id is
  'Adesão do PPR+ a que este cliente pertence (titular ou dependente).';
comment on column public.clients.ppr_active is
  'Selo PPR+ no prontuário: true = ativo, false = suspenso, null = fora do programa.';
comment on column public.clients.referred_by_client_id is
  'Cliente que indicou este cliente (benefícios de indicação do PPR+).';

create index if not exists clients_ppr_membership_idx
  on public.clients (ppr_membership_id);
create index if not exists clients_referred_by_idx
  on public.clients (referred_by_client_id);

-- 5) RLS ------------------------------------------------------------------------
-- Catálogo/configuração: TODOS os autenticados leem (a venda e o orçamento
-- precisam); só o Admin Master escreve (valores são da rede — decisão 9).
do $$
declare t text;
begin
  foreach t in array array[
    'ppr_plans','ppr_plan_perks','ppr_plan_installment_tiers',
    'ppr_plan_benefits','ppr_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format(
      'create policy "%s_select" on public.%I for select to authenticated using (true)',
      t, t);
    execute format('drop policy if exists "%s_write" on public.%I', t, t);
    execute format(
      'create policy "%s_write" on public.%I for all to authenticated
         using (public.is_admin_master()) with check (public.is_admin_master())',
      t, t);
  end loop;
end $$;

-- Adesões e tabelas ligadas: escopo por unidade.
alter table public.ppr_memberships enable row level security;

drop policy if exists "ppr_memberships_select" on public.ppr_memberships;
create policy "ppr_memberships_select" on public.ppr_memberships
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','franchisee','receptionist','clinical_coordinator',
               'dentist','planner_dentist','tsb','asb']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

-- Escrita: quem vende (decisão 10) + gestão da unidade.
drop policy if exists "ppr_memberships_write" on public.ppr_memberships;
create policy "ppr_memberships_write" on public.ppr_memberships
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','receptionist','clinical_coordinator']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','receptionist','clinical_coordinator']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  );

-- Tabelas filhas seguem a visibilidade/escrita da adesão-mãe.
do $$
declare t text;
begin
  foreach t in array array[
    'ppr_beneficiaries','ppr_charges','ppr_benefit_usages','ppr_events',
    'ppr_social_points'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format(
      'create policy "%s_select" on public.%I for select to authenticated
         using (exists (select 1 from public.ppr_memberships m where m.id = membership_id))',
      t, t);
    execute format('drop policy if exists "%s_write" on public.%I', t, t);
    execute format(
      'create policy "%s_write" on public.%I for all to authenticated
         using (exists (
           select 1 from public.ppr_memberships m
           where m.id = membership_id
             and (public.is_admin_master()
                  or public.has_role_in_clinic(m.clinic_id,
                       array[''unit_manager'',''receptionist'',''clinical_coordinator'',
                             ''dentist'',''tsb'',''asb'']::public.user_role[])
                  or exists (select 1 from public.providers_with_access(m.clinic_id, ''commercial_consultant'') p
                             where p.user_id = (select auth.uid())))
         ))
         with check (exists (
           select 1 from public.ppr_memberships m
           where m.id = membership_id
             and (public.is_admin_master()
                  or public.has_role_in_clinic(m.clinic_id,
                       array[''unit_manager'',''receptionist'',''clinical_coordinator'',
                             ''dentist'',''tsb'',''asb'']::public.user_role[])
                  or exists (select 1 from public.providers_with_access(m.clinic_id, ''commercial_consultant'') p
                             where p.user_id = (select auth.uid())))
         ))',
      t, t);
  end loop;
end $$;

-- 6) Seed dos 4 planos iniciais -------------------------------------------------
-- Valores e vantagens passados pelo dono; tudo editável na tela de configuração.
insert into public.ppr_plans (
  slug, name, description, monthly_cents,
  allows_dependents, included_dependents, allows_extra_dependents,
  extra_dependent_cents, max_dependents,
  cash_discount_percent, max_installments, min_installment_cents,
  allowed_methods, grace_period_days,
  social_enabled, social_points_per_cents, sort_order
) values
  ('light', 'Plano Light',
   'Plano individual de prevenção: consultas e radiografias sem custo, limpeza a cada 6 meses.',
   7990, false, 0, false, 0, 0,
   10, 12, 5000,
   array['pix','boleto','cartao','cartao_parcelado']::text[], 0,
   false, 5000, 1),
  ('standard', 'Plano Standard',
   'Plano individual completo: limpeza a cada 4 meses, escova nova e participação no Riso+ Social.',
   9990, false, 0, false, 0, 0,
   10, 18, 5000,
   array['pix','boleto','cartao','cartao_parcelado']::text[], 0,
   true, 5000, 2),
  ('familia', 'Plano Família',
   'Adesão familiar: 1 titular e 1 dependente, com todos os benefícios do Standard.',
   17980, true, 1, false, 0, 1,
   10, 18, 5000,
   array['pix','boleto','cartao','cartao_parcelado']::text[], 0,
   true, 5000, 3),
  ('familia_plus', 'Plano Família+',
   'Adesão familiar+: 1 titular e 2 dependentes, podendo incluir mais dependentes em condição diferenciada.',
   19990, true, 2, true, 5990, null,
   10, 18, 5000,
   array['pix','boleto','cartao','cartao_parcelado']::text[], 0,
   true, 5000, 4)
on conflict (slug) do nothing;

-- Vantagens de cada plano.
do $$
declare
  v_light uuid; v_std uuid; v_fam uuid; v_famp uuid;
begin
  select id into v_light from public.ppr_plans where slug = 'light';
  select id into v_std from public.ppr_plans where slug = 'standard';
  select id into v_fam from public.ppr_plans where slug = 'familia';
  select id into v_famp from public.ppr_plans where slug = 'familia_plus';

  if v_light is not null and not exists (select 1 from public.ppr_plan_perks where plan_id = v_light) then
    insert into public.ppr_plan_perks (plan_id, label, sort_order) values
      (v_light, 'Consultas sem custo', 1),
      (v_light, 'Radiografias sem custo (periapicais e interproximais)', 2),
      (v_light, 'Desconto de 10% para pagamento à vista', 3),
      (v_light, 'Parcelamento diferenciado em até 12x', 4),
      (v_light, 'Forma de pagamento facilitada (inclui boletos)', 5),
      (v_light, 'Indicados não pagam consulta', 6),
      (v_light, 'Limpeza grátis a cada 6 meses', 7);
  end if;

  if v_std is not null and not exists (select 1 from public.ppr_plan_perks where plan_id = v_std) then
    insert into public.ppr_plan_perks (plan_id, label, sort_order) values
      (v_std, 'Consultas sem custo', 1),
      (v_std, 'Radiografias sem custo (periapicais e interproximais)', 2),
      (v_std, 'Desconto de 10% para pagamento à vista', 3),
      (v_std, 'Desconto de 5% a 15% no pagamento parcelado', 4),
      (v_std, 'Parcelamento diferenciado em até 18x', 5),
      (v_std, 'Forma de pagamento facilitada (inclui boletos)', 6),
      (v_std, 'Indicados não pagam consulta', 7),
      (v_std, 'Indicado ganha 5% de desconto no primeiro tratamento', 8),
      (v_std, 'Limpeza grátis a cada 4 meses', 9),
      (v_std, 'Escova nova a cada limpeza', 10),
      (v_std, 'Participação no Riso+ Social', 11);
  end if;

  if v_fam is not null and not exists (select 1 from public.ppr_plan_perks where plan_id = v_fam) then
    insert into public.ppr_plan_perks (plan_id, label, sort_order) values
      (v_fam, 'Adesão familiar: 1 titular e 1 dependente', 1),
      (v_fam, 'Consultas sem custo', 2),
      (v_fam, 'Radiografias sem custo (periapicais e interproximais)', 3),
      (v_fam, 'Desconto de 10% para pagamento à vista', 4),
      (v_fam, 'Desconto de 5% a 15% no pagamento parcelado', 5),
      (v_fam, 'Parcelamento diferenciado em até 18x', 6),
      (v_fam, 'Forma de pagamento facilitada (inclui boletos)', 7),
      (v_fam, 'Indicados não pagam consulta', 8),
      (v_fam, 'Indicado ganha 5% de desconto no primeiro tratamento', 9),
      (v_fam, 'Limpeza grátis a cada 4 meses', 10),
      (v_fam, 'Escova nova a cada limpeza', 11),
      (v_fam, 'Participação no Riso+ Social', 12);
  end if;

  if v_famp is not null and not exists (select 1 from public.ppr_plan_perks where plan_id = v_famp) then
    insert into public.ppr_plan_perks (plan_id, label, sort_order) values
      (v_famp, 'Adesão familiar+: 1 titular e 2 dependentes', 1),
      (v_famp, 'Pode incluir dependentes extras por R$ 59,90 cada', 2),
      (v_famp, 'Consultas sem custo', 3),
      (v_famp, 'Radiografias sem custo (periapicais e interproximais)', 4),
      (v_famp, 'Desconto de 10% para pagamento à vista', 5),
      (v_famp, 'Desconto de 5% a 15% no pagamento parcelado', 6),
      (v_famp, 'Parcelamento diferenciado em até 18x', 7),
      (v_famp, 'Forma de pagamento facilitada (inclui boletos)', 8),
      (v_famp, 'Indicados não pagam consulta', 9),
      (v_famp, 'Indicado ganha 5% de desconto no primeiro tratamento', 10),
      (v_famp, 'Limpeza grátis a cada 4 meses', 11),
      (v_famp, 'Escova nova a cada limpeza', 12),
      (v_famp, 'Participação no Riso+ Social', 13);
  end if;

  -- Faixas de desconto do parcelado (decisão 3). O Light não tem desconto no
  -- parcelado; os demais vão de 15% (curto) a 5% (longo).
  if v_std is not null and not exists (select 1 from public.ppr_plan_installment_tiers where plan_id = v_std) then
    insert into public.ppr_plan_installment_tiers (plan_id, up_to_installments, discount_percent) values
      (v_std, 6, 15), (v_std, 12, 10), (v_std, 18, 5);
  end if;
  if v_fam is not null and not exists (select 1 from public.ppr_plan_installment_tiers where plan_id = v_fam) then
    insert into public.ppr_plan_installment_tiers (plan_id, up_to_installments, discount_percent) values
      (v_fam, 6, 15), (v_fam, 12, 10), (v_fam, 18, 5);
  end if;
  if v_famp is not null and not exists (select 1 from public.ppr_plan_installment_tiers where plan_id = v_famp) then
    insert into public.ppr_plan_installment_tiers (plan_id, up_to_installments, discount_percent) values
      (v_famp, 6, 15), (v_famp, 12, 10), (v_famp, 18, 5);
  end if;
end $$;

-- 7) Selo do PPR+ no prontuário (mantido pelo banco) ---------------------------
-- Sempre que a adesão muda de situação, os clientes ligados a ela recebem o
-- selo certo: ativo = true, suspenso = false, cancelado = sai do programa
-- (fica só no histórico, decisão do dono).
create or replace function public.ppr_sync_client_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelado' then
    update public.clients c
    set ppr_membership_id = null, ppr_active = null
    where c.ppr_membership_id = new.id;
  else
    update public.clients c
    set ppr_membership_id = new.id,
        ppr_active = (new.status = 'ativo')
    where c.id in (
      select b.client_id from public.ppr_beneficiaries b
      where b.membership_id = new.id and b.left_at is null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ppr_sync_client_flags on public.ppr_memberships;
create trigger trg_ppr_sync_client_flags
  after insert or update of status on public.ppr_memberships
  for each row execute function public.ppr_sync_client_flags();

-- Entrou/saiu beneficiário: acerta o selo daquele cliente.
create or replace function public.ppr_sync_beneficiary_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select m.status into v_status
  from public.ppr_memberships m where m.id = new.membership_id;

  if new.left_at is not null or v_status = 'cancelado' then
    update public.clients set ppr_membership_id = null, ppr_active = null
    where id = new.client_id and ppr_membership_id = new.membership_id;
  else
    update public.clients
    set ppr_membership_id = new.membership_id,
        ppr_active = (v_status = 'ativo')
    where id = new.client_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ppr_sync_beneficiary_flag on public.ppr_beneficiaries;
create trigger trg_ppr_sync_beneficiary_flag
  after insert or update of left_at on public.ppr_beneficiaries
  for each row execute function public.ppr_sync_beneficiary_flag();
