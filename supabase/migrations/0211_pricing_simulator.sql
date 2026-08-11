-- =============================================================================
-- 0211 — PRECIFICADOR: quanto o procedimento custa e por quanto vender
-- -----------------------------------------------------------------------------
-- Mora em PROCEDIMENTOS, não no Financeiro (decisão do dono, 08/08/2026): o
-- preço nasce do procedimento, e quem simula é quem conhece a clínica por
-- dentro. Ficar ao lado do preço que ele justifica evita copiar número entre
-- telas — simula, vê que o custo pede R$ 480, e aplica ali mesmo.
--
-- DOIS TIPOS DE CUSTO, e confundi-los é o erro clássico da precificação:
--   • DIRETO (R$): material, laboratório, repasse, cadeira. Não muda com o
--     preço — é o mesmo cobrando R$ 300 ou R$ 900.
--   • PROPORCIONAL (%): imposto e taxa do meio de pagamento. Sobem junto com o
--     preço.
--
-- Por isso o preço sugerido usa markup, não "custo + margem":
--     preço = custo direto ÷ (1 − imposto% − taxa% − margem%)
-- Custo R$ 200 com imposto 6%, taxa 3% e margem 40%: "custo + 40%" daria
-- R$ 280, que entrega só 19,6% de margem real. A fórmula devolve R$ 392.
--
-- O QUE ISTO NÃO É: controle de estoque. É o CUSTO PADRÃO informado por quem
-- conhece a clínica. Quando o Estoque existir, ele substitui a estimativa pelo
-- consumo real — e a estrutura aqui não muda.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Configuração de custo da UNIDADE (cascata rede → unidade)
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_cost_settings (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = padrão da rede.
  clinic_id uuid references public.clinics (id),
  -- Aluguel, luz, equipe indireta... diluídos por hora de cadeira.
  chair_cost_per_hour_cents bigint not null default 0
    check (chair_cost_per_hour_cents >= 0),
  tax_percent numeric(5,2) not null default 0
    check (tax_percent >= 0 and tax_percent <= 100),
  -- Taxa MÉDIA do meio de pagamento, para a simulação (a real vem da
  -- adquirente, na hora da venda).
  avg_acquirer_fee_percent numeric(5,2) not null default 0
    check (avg_acquirer_fee_percent >= 0 and avg_acquirer_fee_percent <= 100),
  target_margin_percent numeric(5,2) not null default 0
    check (target_margin_percent >= 0 and target_margin_percent <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create unique index if not exists clinic_cost_settings_scope_unique
  on public.clinic_cost_settings (coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.clinic_cost_settings enable row level security;

drop policy if exists "clinic_cost_settings_select" on public.clinic_cost_settings;
create policy "clinic_cost_settings_select" on public.clinic_cost_settings
  for select to authenticated using (true);

drop policy if exists "clinic_cost_settings_write" on public.clinic_cost_settings;
create policy "clinic_cost_settings_write" on public.clinic_cost_settings
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  );

insert into public.clinic_cost_settings (clinic_id)
select null
where not exists (
  select 1 from public.clinic_cost_settings where clinic_id is null);

create or replace function public.cost_settings_for(p_clinic uuid)
returns table (
  chair_cost_per_hour_cents bigint,
  tax_percent numeric,
  avg_acquirer_fee_percent numeric,
  target_margin_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(u.chair_cost_per_hour_cents, n.chair_cost_per_hour_cents, 0),
    coalesce(u.tax_percent, n.tax_percent, 0),
    coalesce(u.avg_acquirer_fee_percent, n.avg_acquirer_fee_percent, 0),
    coalesce(u.target_margin_percent, n.target_margin_percent, 0)
  from (select 1) one
  left join public.clinic_cost_settings u on u.clinic_id = p_clinic
  left join public.clinic_cost_settings n on n.clinic_id is null;
$$;

grant execute on function public.cost_settings_for(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) CUSTO DO PROCEDIMENTO — material e laboratório
-- -----------------------------------------------------------------------------
create table if not exists public.procedure_costs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  materials_cents bigint not null default 0 check (materials_cents >= 0),
  lab_cents bigint not null default 0 check (lab_cents >= 0),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create unique index if not exists procedure_costs_scope_unique
  on public.procedure_costs (
    procedure_id,
    coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table public.procedure_costs is
  'Custo PADRÃO de material e laboratório do procedimento. Não é estoque: é a '
  'estimativa de quem conhece a clínica. O Estoque, quando vier, substitui '
  'pela baixa real.';

alter table public.procedure_costs enable row level security;

drop policy if exists "procedure_costs_select" on public.procedure_costs;
create policy "procedure_costs_select" on public.procedure_costs
  for select to authenticated using (true);

drop policy if exists "procedure_costs_write" on public.procedure_costs;
create policy "procedure_costs_write" on public.procedure_costs
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  );

-- Itens de material, para o custo ser explicável em vez de um número solto.
create table if not exists public.procedure_cost_items (
  id uuid primary key default gen_random_uuid(),
  cost_id uuid not null references public.procedure_costs (id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists procedure_cost_items_cost_idx
  on public.procedure_cost_items (cost_id);

alter table public.procedure_cost_items enable row level security;

drop policy if exists "procedure_cost_items_select" on public.procedure_cost_items;
create policy "procedure_cost_items_select" on public.procedure_cost_items
  for select to authenticated using (true);

drop policy if exists "procedure_cost_items_write" on public.procedure_cost_items;
create policy "procedure_cost_items_write" on public.procedure_cost_items
  for all to authenticated
  using (
    exists (select 1 from public.procedure_costs c
            where c.id = cost_id
              and (public.is_admin_master() or public.is_finance_franchisor()
                   or (c.clinic_id is not null
                       and public.can_post_finance(c.clinic_id))))
  )
  with check (
    exists (select 1 from public.procedure_costs c
            where c.id = cost_id
              and (public.is_admin_master() or public.is_finance_franchisor()
                   or (c.clinic_id is not null
                       and public.can_post_finance(c.clinic_id))))
  );

-- O material total sai dos ITENS quando eles existem; senão, do valor digitado.
create or replace function public.sync_procedure_cost_materials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost uuid := coalesce(new.cost_id, old.cost_id);
  v_total bigint;
begin
  select coalesce(sum(round(quantity * unit_cost_cents)), 0) into v_total
  from public.procedure_cost_items where cost_id = v_cost;

  update public.procedure_costs
     set materials_cents = v_total, updated_at = now()
   where id = v_cost;

  return null;
end;
$$;

drop trigger if exists procedure_cost_items_sync on public.procedure_cost_items;
create trigger procedure_cost_items_sync
  after insert or update or delete on public.procedure_cost_items
  for each row execute function public.sync_procedure_cost_materials();

-- -----------------------------------------------------------------------------
-- 3) O CUSTO COMPLETO de um procedimento (espelha pricing-simulator.ts)
-- -----------------------------------------------------------------------------
create or replace function public.procedure_cost_breakdown(
  p_procedure_id uuid,
  p_clinic_id uuid
)
returns table (
  minutes integer,
  chair_cents bigint,
  materials_cents bigint,
  lab_cents bigint,
  payout_cents bigint,
  direct_cents bigint,
  tax_percent numeric,
  acquirer_fee_percent numeric,
  target_margin_percent numeric,
  current_price_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_proc record;
  v_set record;
  v_cost record;
  v_payout bigint;
  v_chair bigint;
begin
  select p.estimated_minutes, p.default_price_cents into v_proc
  from public.procedures p where p.id = p_procedure_id;

  select * into v_set from public.cost_settings_for(p_clinic_id);

  -- Custo da unidade primeiro; se não houver, o padrão da rede.
  select * into v_cost from public.procedure_costs c
  where c.procedure_id = p_procedure_id
    and (c.clinic_id = p_clinic_id or c.clinic_id is null)
  order by (c.clinic_id is not null) desc
  limit 1;

  -- Repasse pelos quatro degraus (0210), sem profissional específico.
  select coalesce(pr.amount_cents, 0) into v_payout
  from public.payout_rate_for(p_procedure_id, null, p_clinic_id, public.today_br()) pr;

  v_chair := round(
    coalesce(v_set.chair_cost_per_hour_cents, 0)
    * coalesce(v_proc.estimated_minutes, 0) / 60.0);

  return query select
    coalesce(v_proc.estimated_minutes, 0),
    v_chair,
    coalesce(v_cost.materials_cents, 0)::bigint,
    coalesce(v_cost.lab_cents, 0)::bigint,
    coalesce(v_payout, 0),
    v_chair + coalesce(v_cost.materials_cents, 0)
            + coalesce(v_cost.lab_cents, 0) + coalesce(v_payout, 0),
    v_set.tax_percent,
    v_set.avg_acquirer_fee_percent,
    v_set.target_margin_percent,
    coalesce(v_proc.default_price_cents, 0)::bigint;
end;
$$;

grant execute on function public.procedure_cost_breakdown(uuid, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O MATERIAL entra na margem da venda (fecha o buraco declarado no FIN5)
-- -----------------------------------------------------------------------------
create or replace function public.estimated_option_material(
  p_option_id uuid,
  p_clinic_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    (coalesce(c.materials_cents, 0) + coalesce(c.lab_cents, 0))
    * greatest(1, coalesce(oi.quantity, 1))
  ), 0)
  from public.treatment_plan_option_items oi
  left join lateral (
    select * from public.procedure_costs pc
    where pc.procedure_id = oi.procedure_id
      and (pc.clinic_id = p_clinic_id or pc.clinic_id is null)
    order by (pc.clinic_id is not null) desc
    limit 1
  ) c on true
  where oi.option_id = p_option_id and oi.procedure_id is not null;
$$;

grant execute on function public.estimated_option_material(uuid, uuid)
  to authenticated;

create or replace function public.estimated_direct_sale_material(p_sale_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    (coalesce(c.materials_cents, 0) + coalesce(c.lab_cents, 0))
    * greatest(1, coalesce(i.quantity, 1))
  ), 0)
  from public.direct_sale_items i
  join public.direct_sales s on s.id = i.sale_id
  left join lateral (
    select * from public.procedure_costs pc
    where pc.procedure_id = i.procedure_id
      and (pc.clinic_id = s.clinic_id or pc.clinic_id is null)
    order by (pc.clinic_id is not null) desc
    limit 1
  ) c on true
  where i.sale_id = p_sale_id and i.procedure_id is not null;
$$;

grant execute on function public.estimated_direct_sale_material(uuid)
  to authenticated;

select
  (select count(*) from public.procedure_costs) as procedimentos_com_custo,
  (select count(*) from public.procedures where is_active) as procedimentos_ativos,
  (select chair_cost_per_hour_cents from public.cost_settings_for(null))
    as custo_hora_cadeira_rede,
  (select target_margin_percent from public.cost_settings_for(null))
    as margem_alvo_rede;
