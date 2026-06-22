-- =============================================================================
-- Risarte Odontologia — Migration 0036 (Etapa 5.2 — Orçamento do plano)
-- Tabela de preços (catálogo de procedimentos) no padrão cascata
-- (padrão da rede → ajuste por unidade) e orçamento por OPÇÃO de plano.
--   - procedures               : catálogo da rede (nome, categoria, preço padrão)
--   - clinic_procedure_prices  : preço sobrescrito por unidade (opcional)
--   - treatment_plan_option_items : itens do orçamento de cada opção do plano
-- Valores em CENTAVOS (integer) para evitar arredondamento de ponto flutuante.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catálogo de procedimentos (rede). Gerido pelo Admin Master.
-- -----------------------------------------------------------------------------
create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  category text,
  default_price_cents integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.procedures enable row level security;

-- Preço por unidade (sobrescreve o padrão da rede). Ausência = usa o padrão.
create table if not exists public.clinic_procedure_prices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  price_cents integer not null,
  updated_at timestamptz not null default now(),
  unique (clinic_id, procedure_id)
);
alter table public.clinic_procedure_prices enable row level security;

-- Itens do orçamento de cada opção do plano. clinic_id denormalizado para a RLS
-- ser autossuficiente (sem subconsulta cruzada → sem recursão). O preço é
-- "fotografado" no momento da inclusão (unit_price_cents) — o orçamento não muda
-- se a tabela de preços for ajustada depois.
create table if not exists public.treatment_plan_option_items (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.treatment_plan_options (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  procedure_id uuid references public.procedures (id),
  description text not null,
  quantity integer not null default 1,
  unit_price_cents integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists treatment_plan_option_items_option_idx
  on public.treatment_plan_option_items (option_id);
alter table public.treatment_plan_option_items enable row level security;

-- -----------------------------------------------------------------------------
-- RLS. Catálogo/preços = configuração da rede (não é dado de paciente): leitura
-- para qualquer usuário autenticado; escrita só Admin Master. Itens do orçamento
-- seguem a mesma regra dos planos (Planner edita; unidade/Planner/Admin leem).
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['procedures', 'clinic_procedure_prices']
  loop
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format(
      'create policy "%1$s_select" on public.%1$I for select to authenticated using (true)',
      t);

    execute format('drop policy if exists "%s_write" on public.%I', t, t);
    execute format($f$
      create policy "%1$s_write" on public.%1$I for all to authenticated
      using (public.is_admin_master())
      with check (public.is_admin_master())$f$, t);
  end loop;
end $$;

drop policy if exists "tpo_items_select" on public.treatment_plan_option_items;
create policy "tpo_items_select" on public.treatment_plan_option_items
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "tpo_items_insert" on public.treatment_plan_option_items;
create policy "tpo_items_insert" on public.treatment_plan_option_items
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

drop policy if exists "tpo_items_update" on public.treatment_plan_option_items;
create policy "tpo_items_update" on public.treatment_plan_option_items
  for update to authenticated
  using (public.is_admin_master() or public.is_planner());

drop policy if exists "tpo_items_delete" on public.treatment_plan_option_items;
create policy "tpo_items_delete" on public.treatment_plan_option_items
  for delete to authenticated
  using (public.is_admin_master() or public.is_planner());

-- -----------------------------------------------------------------------------
-- Exemplos para começar (o Admin Master edita/desativa e cadastra os reais).
-- -----------------------------------------------------------------------------
insert into public.procedures (code, name, category, default_price_cents) values
  ('AVAL',  'Avaliação clínica',            'Diagnóstico',   0),
  ('PROF',  'Profilaxia / limpeza',         'Prevenção',     15000),
  ('REST',  'Restauração em resina',        'Dentística',    25000),
  ('EXTR',  'Extração simples',             'Cirurgia',      20000),
  ('CLAR',  'Clareamento dental',           'Estética',      80000),
  ('CANAL', 'Tratamento de canal',          'Endodontia',    90000)
on conflict (code) do nothing;
