-- =============================================================================
-- 0224 — FIN6.0: BENS E DEPRECIAÇÃO
-- -----------------------------------------------------------------------------
-- Decisão do dono (12/08/2026): construir o controle de bens em vez de lançar a
-- depreciação à mão. Eu havia recomendado o lançamento manual pelo prazo; ele
-- escolheu o cadastro, e a escolha é melhor a longo prazo — a DRE passa a
-- consumir um número calculado em vez de um número digitado.
--
-- COMPRAR UM BEM NÃO É GASTAR — a mesma regra que já vale para o estoque. Uma
-- cadeira de R$ 30 mil não afunda o mês em que foi comprada: ela vira R$ 250 por
-- mês durante dez anos, que é o que de fato custa usá-la. Por isso o bem nasce
-- em 6.2.01 (ativo) e só toca o resultado pela DEPRECIAÇÃO, em 5.2.01.
--
-- REGRAS TRAVADAS AQUI:
--
--   • DEPRECIAÇÃO LINEAR, e a ÚLTIMA PARCELA ABSORVE O RESÍDUO — a mesma regra
--     de arredondamento das parcelas de venda (invariante do módulo). Sem ela,
--     R$ 10.000 em 36 meses deixaria centavos órfãos e o bem nunca zeraria.
--   • COMEÇA NO MÊS SEGUINTE À ENTRADA EM USO. Convenção contábil, e evita meio
--     mês de conta esquisita. `in_service_date` ≠ data da compra: equipamento
--     comprado em dezembro e instalado em fevereiro só deprecia a partir de
--     março.
--   • VALOR RESIDUAL ZERO. Para gestão, estimar revenda de cadeira odontológica
--     é inventar precisão.
--   • DEPRECIAR DE NOVO NÃO DUPLICA: índice único por (bem, mês). Rodar o
--     fechamento duas vezes é normal; dobrar a despesa não é.
--   • NUNCA DEPRECIA ALÉM DO CUSTO. Bem totalmente depreciado para sozinho.
--   • VIDA ÚTIL COM PADRÃO POR CATEGORIA, EDITÁVEL. Padrão que ninguém pode
--     mudar vira número errado com cara de oficial.
--   • BAIXA: parou de depreciar e o valor que restava vai para resultado. Sem
--     isso o sistema depreciaria para sempre uma cadeira que foi para o lixo.
--
-- LIMITE DECLARADO: quando o bem é VENDIDO, esta etapa registra a baixa do valor
-- contábil; o dinheiro recebido é lançado à parte pelo Financeiro. Tratar ganho
-- e perda de capital direito exige mais conta do que a DRE gerencial precisa
-- agora.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ONDE O BEM MORA E POR ONDE ELE SAI
-- -----------------------------------------------------------------------------
-- 5.2.01 (Depreciação) já existe desde a 0185. Falta o ATIVO — sem ele, comprar
-- um bem viraria despesa no mês da compra, que é exatamente o que a depreciação
-- existe para evitar.
insert into public.chart_of_accounts
  (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic)
values
  ('6.2',    'Bens em uso (imobilizado)', '6',   'expense', 'asset', 'none', 'both', false),
  ('6.2.01', 'Bens em uso',               '6.2', 'expense', 'asset', 'none', 'both', true),
  ('5.2.02', 'Baixa de bens',             '5',   'expense', 'investment', 'none', 'both', true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2) CATEGORIAS, com vida útil padrão EDITÁVEL
-- -----------------------------------------------------------------------------
create table if not exists public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = categoria da REDE (padrão cascata, como o resto).
  clinic_id uuid references public.clinics (id),
  name text not null,
  default_useful_life_months integer not null default 120
    check (default_useful_life_months > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists asset_categories_scope_idx
  on public.asset_categories (clinic_id, name);

alter table public.asset_categories enable row level security;

drop policy if exists "asset_categories_select" on public.asset_categories;
create policy "asset_categories_select" on public.asset_categories
  for select to authenticated using (true);

drop policy if exists "asset_categories_write" on public.asset_categories;
create policy "asset_categories_write" on public.asset_categories
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  );

-- Padrões da Receita Federal para vida útil, como PONTO DE PARTIDA.
insert into public.asset_categories (clinic_id, name, default_useful_life_months)
select null, v.name, v.months
from (values
  ('Equipamento odontológico', 120),
  ('Informática', 60),
  ('Móveis e utensílios', 120),
  ('Instalações e benfeitorias', 120),
  ('Veículos', 60),
  ('Outros', 120)
) as v(name, months)
where not exists (
  select 1 from public.asset_categories c
  where c.clinic_id is null and c.name = v.name
);

-- -----------------------------------------------------------------------------
-- 3) O BEM
-- -----------------------------------------------------------------------------
create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  -- O CÓDIGO ACOMPANHA O REGISTRO PARA SEMPRE (regra do dono, 07/08/2026).
  code text unique,
  clinic_id uuid not null references public.clinics (id),
  category_id uuid references public.asset_categories (id),
  name text not null,
  description text,
  supplier_id uuid references public.suppliers (id),
  invoice_number text,
  payable_id uuid references public.payables (id),
  acquisition_date date not null default public.today_br(),
  -- Diferente da compra de propósito: equipamento comprado em dezembro e
  -- instalado em fevereiro só começa a depreciar em março.
  in_service_date date not null default public.today_br(),
  cost_cents bigint not null check (cost_cents > 0),
  useful_life_months integer not null check (useful_life_months > 0),
  -- Zero por decisão: estimar revenda de cadeira odontológica é inventar
  -- precisão. O campo existe para o dia em que fizer sentido.
  residual_cents bigint not null default 0 check (residual_cents >= 0),
  status text not null default 'ativo'
    check (status in ('ativo', 'baixado')),
  disposal_date date,
  disposal_reason text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists fixed_assets_clinic_idx
  on public.fixed_assets (clinic_id, status);

comment on table public.fixed_assets is
  'Bem do imobilizado. Nasce em 6.2.01 (ativo) e só toca o resultado pela '
  'depreciação — comprar um bem não é gastar.';

alter table public.fixed_assets enable row level security;

drop policy if exists "fixed_assets_select" on public.fixed_assets;
create policy "fixed_assets_select" on public.fixed_assets
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or clinic_id in (select public.finance_visible_clinic_ids())
  );

drop policy if exists "fixed_assets_write" on public.fixed_assets;
create policy "fixed_assets_write" on public.fixed_assets
  for all to authenticated
  using (public.can_post_finance(clinic_id))
  with check (public.can_post_finance(clinic_id));

create or replace function public.next_asset_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'AT-' || lpad((
    coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 5, '0')
  from public.fixed_assets where code like 'AT-%';
$$;

create or replace function public.set_asset_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.next_asset_code();
  end if;
  return new;
end;
$$;

drop trigger if exists fixed_assets_code on public.fixed_assets;
create trigger fixed_assets_code
  before insert on public.fixed_assets
  for each row execute function public.set_asset_code();

-- O bem entra como ATIVO no razão: 6.2.01 sobe no valor do bem.
create or replace function public.post_asset_acquisition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents,
    direction, status, source_type, source_id, description, created_by
  ) values (
    new.clinic_id, '6.2.01', new.acquisition_date, null, new.cost_cents,
    'outflow', 'settled', 'asset_acquisition', new.id,
    new.code || ' — ' || new.name, new.created_by
  )
  on conflict do nothing;
  return null;
end;
$$;

drop trigger if exists fixed_assets_post_acquisition on public.fixed_assets;
create trigger fixed_assets_post_acquisition
  after insert on public.fixed_assets
  for each row execute function public.post_asset_acquisition();

-- -----------------------------------------------------------------------------
-- 4) A DEPRECIAÇÃO DO MÊS
-- -----------------------------------------------------------------------------
create table if not exists public.asset_depreciations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.fixed_assets (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  -- Primeiro dia do mês de competência.
  period_month date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  accumulated_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- DEPRECIAR DE NOVO NÃO DUPLICA. Rodar o fechamento duas vezes é normal;
-- dobrar a despesa não é.
create unique index if not exists asset_depreciations_unique
  on public.asset_depreciations (asset_id, period_month);

create index if not exists asset_depreciations_period_idx
  on public.asset_depreciations (clinic_id, period_month);

alter table public.asset_depreciations enable row level security;

drop policy if exists "asset_depreciations_select" on public.asset_depreciations;
create policy "asset_depreciations_select" on public.asset_depreciations
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or clinic_id in (select public.finance_visible_clinic_ids())
  );

-- Valor contábil hoje: custo menos o que já foi depreciado.
create or replace function public.asset_book_value(p_asset_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select cost_cents from public.fixed_assets where id = p_asset_id)
    - coalesce((select sum(amount_cents) from public.asset_depreciations
                where asset_id = p_asset_id), 0),
    0
  )::bigint;
$$;

grant execute on function public.asset_book_value(uuid) to authenticated;

/**
 * Roda a depreciação de um mês para a unidade inteira.
 *
 * A ÚLTIMA PARCELA ABSORVE O RESÍDUO — mesma regra das parcelas de venda. Sem
 * ela, R$ 10.000 em 36 meses deixaria centavos órfãos e o bem nunca zeraria no
 * balanço.
 */
create or replace function public.depreciate_month(
  p_clinic_id uuid,
  p_month date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_asset record;
  v_monthly bigint;
  v_done bigint;
  v_remaining bigint;
  v_amount bigint;
  v_count integer := 0;
  v_user uuid := (select auth.uid());
begin
  if not public.can_post_finance(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  for v_asset in
    select * from public.fixed_assets
    where clinic_id = p_clinic_id
      and status = 'ativo'
      -- COMEÇA NO MÊS SEGUINTE à entrada em uso.
      and date_trunc('month', in_service_date)::date < v_month
  loop
    v_monthly := round(
      (v_asset.cost_cents - v_asset.residual_cents)::numeric
      / v_asset.useful_life_months
    );

    select coalesce(sum(amount_cents), 0) into v_done
    from public.asset_depreciations where asset_id = v_asset.id;

    v_remaining := v_asset.cost_cents - v_asset.residual_cents - v_done;
    if v_remaining <= 0 then continue; end if;

    -- O último mês leva o que sobrou: nunca deprecia além do custo.
    v_amount := least(v_monthly, v_remaining);

    insert into public.asset_depreciations (
      asset_id, clinic_id, period_month, amount_cents, accumulated_cents,
      created_by
    ) values (
      v_asset.id, p_clinic_id, v_month, v_amount, v_done + v_amount, v_user
    )
    on conflict (asset_id, period_month) do nothing;

    if not found then continue; end if;

    -- A DESPESA (competência no mês) e a BAIXA DO ATIVO, como no estoque:
    -- sem a segunda, 6.2.01 seria só compras e nunca bateria com o valor real.
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      p_clinic_id, '5.2.01', (v_month + interval '1 month - 1 day')::date,
      null, v_amount, 'outflow', 'settled', 'asset_depreciation',
      (select id from public.asset_depreciations
        where asset_id = v_asset.id and period_month = v_month),
      'Depreciação — ' || v_asset.code || ' ' || v_asset.name, v_user
    )
    on conflict do nothing;

    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      p_clinic_id, '6.2.01', (v_month + interval '1 month - 1 day')::date,
      null, v_amount, 'inflow', 'settled', 'asset_depreciation_asset',
      (select id from public.asset_depreciations
        where asset_id = v_asset.id and period_month = v_month),
      'Depreciação — ' || v_asset.code, v_user
    )
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.depreciate_month(uuid, date) to authenticated;

create unique index if not exists financial_entries_asset_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('asset_acquisition', 'asset_depreciation',
                        'asset_depreciation_asset', 'asset_disposal',
                        'asset_disposal_asset');

-- -----------------------------------------------------------------------------
-- 5) BAIXA DO BEM
-- -----------------------------------------------------------------------------
-- Vendeu, quebrou ou descartou: para de depreciar e o valor que restava vai
-- para resultado. Sem isto, o sistema depreciaria para sempre uma cadeira que
-- já foi para o lixo.
create or replace function public.dispose_asset(
  p_asset_id uuid,
  p_date date,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset record;
  v_book bigint;
  v_when date := coalesce(p_date, public.today_br());
  v_user uuid := (select auth.uid());
begin
  select * into v_asset from public.fixed_assets where id = p_asset_id;
  if v_asset.id is null then raise exception 'ASSET_NOT_FOUND'; end if;
  if not public.can_post_finance(v_asset.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_asset.status = 'baixado' then raise exception 'ALREADY_DISPOSED'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;

  v_book := public.asset_book_value(p_asset_id);

  update public.fixed_assets
     set status = 'baixado', disposal_date = v_when,
         disposal_reason = btrim(p_reason)
   where id = p_asset_id;

  -- O que restava de valor vira resultado no mês da baixa.
  if v_book > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_asset.clinic_id, '5.2.02', v_when, null, v_book, 'outflow', 'settled',
      'asset_disposal', p_asset_id,
      'Baixa — ' || v_asset.code || ' ' || v_asset.name || ' (' || btrim(p_reason) || ')',
      v_user
    )
    on conflict do nothing;

    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by
    ) values (
      v_asset.clinic_id, '6.2.01', v_when, null, v_book, 'inflow', 'settled',
      'asset_disposal_asset', p_asset_id,
      'Baixa — ' || v_asset.code, v_user
    )
    on conflict do nothing;
  end if;

  return v_book;
end;
$$;

grant execute on function public.dispose_asset(uuid, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) A LISTA, com valor contábil e quanto falta depreciar
-- -----------------------------------------------------------------------------
create or replace function public.assets_overview(p_clinic_id uuid)
returns table (
  asset_id uuid,
  code text,
  name text,
  category_name text,
  in_service_date date,
  cost_cents bigint,
  monthly_cents bigint,
  accumulated_cents bigint,
  book_value_cents bigint,
  months_done integer,
  useful_life_months integer,
  status text,
  disposal_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id, a.code, a.name, c.name, a.in_service_date, a.cost_cents,
    round((a.cost_cents - a.residual_cents)::numeric / a.useful_life_months)::bigint,
    coalesce(d.total, 0)::bigint,
    greatest(a.cost_cents - coalesce(d.total, 0), 0)::bigint,
    coalesce(d.months, 0)::integer,
    a.useful_life_months,
    a.status,
    a.disposal_date
  from public.fixed_assets a
  left join public.asset_categories c on c.id = a.category_id
  left join lateral (
    select sum(amount_cents) as total, count(*) as months
    from public.asset_depreciations where asset_id = a.id
  ) d on true
  where a.clinic_id = p_clinic_id
  order by (a.status = 'baixado'), a.name;
$$;

grant execute on function public.assets_overview(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.asset_categories where clinic_id is null)
    as categorias_da_rede,
  (select count(*) from public.fixed_assets) as bens,
  (select count(*) from public.fixed_assets where status = 'ativo') as bens_ativos,
  (select count(*) from public.asset_depreciations) as meses_depreciados,
  (select count(*) from public.chart_of_accounts
    where code in ('6.2', '6.2.01', '5.2.01', '5.2.02')) as contas_do_imobilizado;
