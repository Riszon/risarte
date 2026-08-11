-- =============================================================================
-- 0213 — ESTOQUE E1+E2: CADASTRO, SALDO, MOVIMENTOS E KIT DO PROCEDIMENTO
-- -----------------------------------------------------------------------------
-- O DOCUMENTO BASE JÁ DIZ COMO ESTE MÓDULO MORRE: "falta de baixa no uso"
-- (§7, risco da tabela Estoque). Todo controle de estoque de clínica quebra no
-- mesmo ponto — alguém teria de digitar "usei 2 anestésicos" no meio do
-- atendimento, ninguém digita, e em três meses o saldo não vale nada.
--
-- Por isso o KIT DO PROCEDIMENTO (E2) nasce junto com a fundação (E1), mesmo
-- que a baixa automática só entre na E3: sem a lista do que cada procedimento
-- consome, não existe baixa automática — e sem baixa automática o módulo
-- inteiro depende de disciplina humana no pior momento possível.
--
-- REGRA ESTRUTURAL (a mesma do Financeiro): O SALDO NÃO É A BASE. Tudo nasce
-- em `stock_movements`; `stock_balances` é PROJEÇÃO. Estoque em que se digita o
-- saldo direto é estoque que ninguém consegue auditar: quando o número está
-- errado, não há como saber por quê.
--
-- CUSTO MÉDIO PONDERADO (§7 do documento base). Entrada recalcula o médio;
-- saída sai pelo médio VIGENTE e o valor fica CONGELADO no movimento. Mesma
-- regra do repasse ao dentista: comprar mais caro amanhã não reescreve o custo
-- do que foi usado ontem.
--
-- DECISÕES DO DONO (11/08/2026):
--   • Operação: Gerente + Admin lançam entrada e inventário; dentista, TSB e
--     ASB registram consumo avulso; recepção fica de fora (pagar/receber
--     mercadoria não é ato de balcão — mesma lógica de contas a pagar).
--   • A compra vira ESTOQUE (ativo), e só vira despesa em 2.2 no CONSUMO.
--     Material comprado em janeiro e usado em março não pode afundar janeiro.
--     Por isso o grupo 6 no plano de contas (as contas 1–5 são todas de
--     resultado; faltava onde o estoque pousar).
--   • Transferência entre unidades fica para o fim da E5.
--
-- ESTA MIGRAÇÃO NÃO MEXE NO CLÍNICO. A baixa automática na conclusão da sessão
-- é a E3, sozinha, porque mexe em caminho crítico de atendimento.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ONDE O ESTOQUE POUSA NO PLANO DE CONTAS
-- -----------------------------------------------------------------------------
-- As contas 1 a 5 são de RESULTADO. Comprar material não é resultado: é trocar
-- dinheiro por material. Vira custo (2.2) quando o material é usado.
--
-- Por isso a natureza `asset` entra no plano de contas: TODA natureza existente
-- diz onde a conta cai na DRE, e estoque não cai em lugar nenhum dela. Quem
-- montar a DRE (FIN6) exclui `asset` — é a única natureza que não é resultado.
alter table public.chart_of_accounts
  drop constraint if exists chart_of_accounts_nature_check;

alter table public.chart_of_accounts
  add constraint chart_of_accounts_nature_check check (nature in (
    'operational',
    'deduction',
    'direct_cost',
    'financial',
    'investment',
    'intercompany',
    'asset'        -- 0213: patrimônio, NÃO entra na DRE
  ));

insert into public.chart_of_accounts
  (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic)
values
  ('6',      'Ativos',               null,  'expense', 'asset', 'none', 'both', false),
  ('6.1',    'Estoques',             '6',   'expense', 'asset', 'none', 'unit', false),
  ('6.1.01', 'Estoque de materiais', '6.1', 'expense', 'asset', 'none', 'unit', true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2) O ITEM é da REDE
-- -----------------------------------------------------------------------------
-- Mesmo padrão do catálogo de procedimentos: item cadastrado uma vez, todas as
-- unidades falam a mesma língua. Duas unidades chamando a mesma resina de nomes
-- diferentes tornam qualquer consolidado da rede inútil.
create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  -- Unidade de MEDIDA (caixa, unidade, ml). Não confundir com unidade/clínica.
  unit_of_measure text not null default 'un',
  category text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists stock_items_name_idx on public.stock_items (name);
create index if not exists stock_items_active_idx on public.stock_items (is_active);

comment on table public.stock_items is
  'Catálogo de insumos da REDE. O saldo e o custo são por unidade '
  '(stock_balances) — cada unidade compra pelo seu preço.';

alter table public.stock_items enable row level security;

drop policy if exists "stock_items_select" on public.stock_items;
create policy "stock_items_select" on public.stock_items
  for select to authenticated using (true);

drop policy if exists "stock_items_write" on public.stock_items;
create policy "stock_items_write" on public.stock_items
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

-- Código sequencial legível (INS-00001), no mesmo espírito dos outros códigos
-- do sistema: o código acompanha o registro para sempre.
create or replace function public.next_stock_item_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'INS-' || lpad((
    coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 5, '0')
  from public.stock_items
  where code like 'INS-%';
$$;

grant execute on function public.next_stock_item_code() to authenticated;

create or replace function public.set_stock_item_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.next_stock_item_code();
  end if;
  return new;
end;
$$;

drop trigger if exists stock_items_code on public.stock_items;
create trigger stock_items_code
  before insert on public.stock_items
  for each row execute function public.set_stock_item_code();

-- -----------------------------------------------------------------------------
-- 3) QUEM PODE O QUÊ
-- -----------------------------------------------------------------------------
-- Entrada e inventário movem dinheiro e patrimônio: Gerente + Admin/Financeiro.
create or replace function public.can_manage_stock(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_finance_franchisor()
      or (p_clinic_id is not null and public.has_role_in_clinic(
            p_clinic_id, array['unit_manager']::public.user_role[]));
$$;

-- Consumo avulso é ato de atendimento: quem está na cadeira registra o que
-- fugiu do kit. Recepção não entra.
create or replace function public.can_consume_stock(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_stock(p_clinic_id)
      or (p_clinic_id is not null and public.has_role_in_clinic(
            p_clinic_id,
            array['dentist', 'clinical_coordinator', 'planner_dentist',
                  'tsb', 'asb']::public.user_role[]));
$$;

grant execute on function public.can_manage_stock(uuid) to authenticated;
grant execute on function public.can_consume_stock(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) SALDO (projeção) e MOVIMENTOS (a base)
-- -----------------------------------------------------------------------------
create table if not exists public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  item_id uuid not null references public.stock_items (id),
  quantity numeric(14,3) not null default 0,
  -- Abaixo disto, alerta (E5). Zero = sem controle de mínimo.
  min_quantity numeric(14,3) not null default 0,
  avg_cost_cents bigint not null default 0 check (avg_cost_cents >= 0),
  updated_at timestamptz not null default now(),
  unique (clinic_id, item_id)
);

create index if not exists stock_balances_clinic_idx
  on public.stock_balances (clinic_id);

comment on table public.stock_balances is
  'PROJEÇÃO dos movimentos — nunca a base. Reconstruível a partir de '
  'stock_movements; por isso ninguém escreve aqui direto.';

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  item_id uuid not null references public.stock_items (id),
  -- transferencia_* já entram no check para a E5 não precisar recriar a
  -- restrição depois; ainda não têm tela.
  kind text not null check (kind in (
    'entrada', 'consumo', 'perda',
    'ajuste_entrada', 'ajuste_saida',
    'transferencia_entrada', 'transferencia_saida'
  )),
  -- Sempre POSITIVA: a direção vem do `kind`. Quantidade negativa é o tipo de
  -- coisa que passa despercebida numa soma e some num relatório.
  quantity numeric(14,3) not null check (quantity > 0),
  -- CONGELADO no momento do movimento (custo médio vigente na saída, custo da
  -- nota na entrada). Reajuste depois disto não mexe aqui.
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  total_cents bigint not null default 0,
  movement_date date not null default public.today_br(),
  -- Rastreabilidade (invariante do módulo financeiro): de onde este movimento
  -- veio — sessão concluída, nota de entrada, inventário.
  source_type text,
  source_id uuid,
  reason text,
  -- Fotografia do saldo depois deste movimento: permite auditar sem recalcular
  -- a série inteira.
  balance_after numeric(14,3),
  avg_cost_after bigint,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists stock_movements_lookup_idx
  on public.stock_movements (clinic_id, item_id, movement_date);
create index if not exists stock_movements_source_idx
  on public.stock_movements (source_type, source_id);

comment on table public.stock_movements is
  'O razão do estoque. Nada se apaga: erro se corrige com movimento de ajuste '
  'e motivo — a diferença É a informação (perda, furto, kit errado).';

alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "stock_balances_select" on public.stock_balances;
create policy "stock_balances_select" on public.stock_balances
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or clinic_id in (select public.user_clinic_ids())
  );

-- Ninguém escreve saldo à mão: quem escreve é a função de movimento.
drop policy if exists "stock_balances_write" on public.stock_balances;
create policy "stock_balances_write" on public.stock_balances
  for update to authenticated
  using (public.can_manage_stock(clinic_id))
  with check (public.can_manage_stock(clinic_id));

drop policy if exists "stock_movements_select" on public.stock_movements;
create policy "stock_movements_select" on public.stock_movements
  for select to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or clinic_id in (select public.user_clinic_ids())
  );

-- Sem INSERT/UPDATE/DELETE direto de propósito: tudo passa por
-- post_stock_movement(), que é quem sabe recalcular saldo e custo médio.

-- -----------------------------------------------------------------------------
-- 5) O MOVIMENTO — a única porta de entrada
-- -----------------------------------------------------------------------------
-- Faz tudo de uma vez e sob trava: valida, calcula o custo médio novo, grava o
-- movimento com o custo congelado e atualiza a projeção. Em duas idas ao banco
-- pela tela, uma falha no meio deixaria saldo e movimento discordando — e a
-- partir daí nenhum número do módulo valeria nada.
create or replace function public.post_stock_movement(
  p_clinic_id uuid,
  p_item_id uuid,
  p_kind text,
  p_quantity numeric,
  p_unit_cost_cents bigint default null,
  p_movement_date date default null,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in boolean;
  v_bal record;
  v_qty numeric;
  v_avg bigint;
  v_new_qty numeric;
  v_new_avg bigint;
  v_unit bigint;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  v_in := p_kind in ('entrada', 'ajuste_entrada', 'transferencia_entrada');

  -- Entrada e inventário são atos de gestão; consumo/perda são de atendimento.
  if v_in or p_kind in ('ajuste_saida', 'transferencia_saida') then
    if not public.can_manage_stock(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  else
    if not public.can_consume_stock(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;

  -- Trava a linha do saldo: dois atendimentos simultâneos consumindo o mesmo
  -- item não podem ler o mesmo saldo e gravar por cima um do outro.
  select * into v_bal from public.stock_balances
   where clinic_id = p_clinic_id and item_id = p_item_id
   for update;

  if v_bal.id is null then
    insert into public.stock_balances (clinic_id, item_id)
    values (p_clinic_id, p_item_id)
    on conflict (clinic_id, item_id) do nothing;

    select * into v_bal from public.stock_balances
     where clinic_id = p_clinic_id and item_id = p_item_id
     for update;
  end if;

  v_qty := coalesce(v_bal.quantity, 0);
  v_avg := coalesce(v_bal.avg_cost_cents, 0);

  if v_in then
    v_unit := coalesce(p_unit_cost_cents, v_avg);
    v_new_qty := v_qty + p_quantity;
    -- MÉDIA PONDERADA. Com saldo zerado ou negativo não há média a ponderar:
    -- o custo da entrada passa a ser o custo. Ponderar contra saldo negativo
    -- devolveria um custo médio sem significado nenhum.
    if v_qty > 0 and v_new_qty > 0 then
      v_new_avg := round(((v_qty * v_avg) + (p_quantity * v_unit)) / v_new_qty);
    else
      v_new_avg := v_unit;
    end if;
  else
    -- SAÍDA sai pelo médio vigente — é isso que congela o custo do que foi
    -- usado hoje, independentemente do que a próxima compra custar.
    v_unit := v_avg;
    v_new_qty := v_qty - p_quantity;
    v_new_avg := v_avg;
  end if;

  insert into public.stock_movements (
    clinic_id, item_id, kind, quantity, unit_cost_cents, total_cents,
    movement_date, source_type, source_id, reason,
    balance_after, avg_cost_after, created_by
  ) values (
    p_clinic_id, p_item_id, p_kind, p_quantity, v_unit,
    round(p_quantity * v_unit), coalesce(p_movement_date, public.today_br()),
    p_source_type, p_source_id, nullif(btrim(coalesce(p_reason, '')), ''),
    v_new_qty, v_new_avg, v_user
  )
  returning id into v_id;

  update public.stock_balances
     set quantity = v_new_qty,
         avg_cost_cents = v_new_avg,
         updated_at = now()
   where id = v_bal.id;

  return v_id;
end;
$$;

grant execute on function public.post_stock_movement(
  uuid, uuid, text, numeric, bigint, date, text, text, uuid) to authenticated;

comment on function public.post_stock_movement(
  uuid, uuid, text, numeric, bigint, date, text, text, uuid) is
  'Única porta de entrada do estoque. NÃO recusa saldo insuficiente: registra '
  'negativo e deixa o alerta aparecer. Travar atendimento por causa de '
  'cadastro é o erro que a baixa da adquirente já ensinou a não repetir.';

-- Definir o mínimo é ato de gestão, não movimento.
create or replace function public.set_stock_min(
  p_clinic_id uuid,
  p_item_id uuid,
  p_min numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_stock(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.stock_balances (clinic_id, item_id, min_quantity)
  values (p_clinic_id, p_item_id, greatest(coalesce(p_min, 0), 0))
  on conflict (clinic_id, item_id)
  do update set min_quantity = greatest(coalesce(p_min, 0), 0),
                updated_at = now();
end;
$$;

grant execute on function public.set_stock_min(uuid, uuid, numeric)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O KIT DO PROCEDIMENTO
-- -----------------------------------------------------------------------------
-- O que cada procedimento consome. Padrão da REDE com ajuste por unidade —
-- mesma cascata do preço e do protocolo de sessões.
create table if not exists public.procedure_kits (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  clinic_id uuid references public.clinics (id),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create unique index if not exists procedure_kits_scope_unique
  on public.procedure_kits (procedure_id, clinic_id) nulls not distinct;

create table if not exists public.procedure_kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.procedure_kits (id) on delete cascade,
  item_id uuid not null references public.stock_items (id),
  quantity numeric(10,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (kit_id, item_id)
);

alter table public.procedure_kits enable row level security;
alter table public.procedure_kit_items enable row level security;

drop policy if exists "procedure_kits_select" on public.procedure_kits;
create policy "procedure_kits_select" on public.procedure_kits
  for select to authenticated using (true);

drop policy if exists "procedure_kits_write" on public.procedure_kits;
create policy "procedure_kits_write" on public.procedure_kits
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_manage_stock(clinic_id))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_manage_stock(clinic_id))
  );

drop policy if exists "procedure_kit_items_select" on public.procedure_kit_items;
create policy "procedure_kit_items_select" on public.procedure_kit_items
  for select to authenticated using (true);

drop policy if exists "procedure_kit_items_write" on public.procedure_kit_items;
create policy "procedure_kit_items_write" on public.procedure_kit_items
  for all to authenticated
  using (
    exists (select 1 from public.procedure_kits k
            where k.id = kit_id
              and (public.is_admin_master() or public.is_finance_franchisor()
                   or (k.clinic_id is not null
                       and public.can_manage_stock(k.clinic_id))))
  )
  with check (
    exists (select 1 from public.procedure_kits k
            where k.id = kit_id
              and (public.is_admin_master() or public.is_finance_franchisor()
                   or (k.clinic_id is not null
                       and public.can_manage_stock(k.clinic_id))))
  );

-- O kit vigente para um procedimento numa unidade: o da unidade vence o da rede.
create or replace function public.kit_for(
  p_procedure_id uuid,
  p_clinic_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select k.id from public.procedure_kits k
  where k.procedure_id = p_procedure_id
    and (k.clinic_id = p_clinic_id or k.clinic_id is null)
  order by (k.clinic_id is not null) desc
  limit 1;
$$;

grant execute on function public.kit_for(uuid, uuid) to authenticated;

-- Quanto o kit custa HOJE, ao custo médio daquela unidade.
create or replace function public.kit_cost_cents(
  p_procedure_id uuid,
  p_clinic_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(round(ki.quantity * coalesce(b.avg_cost_cents, 0))), 0)::bigint
  from public.procedure_kit_items ki
  left join public.stock_balances b
    on b.item_id = ki.item_id and b.clinic_id = p_clinic_id
  where ki.kit_id = public.kit_for(p_procedure_id, p_clinic_id);
$$;

grant execute on function public.kit_cost_cents(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O KIT ALIMENTA O PRECIFICADOR — SEM MEXER EM QUEM JÁ CONSOME O CUSTO
-- -----------------------------------------------------------------------------
-- `procedure_costs.materials_cents` já é lido pelo precificador, pela margem da
-- negociação e pela venda direta. Em vez de mudar os três, o kit passa a
-- ESCREVER nesse campo: quem já lê continua lendo, e o número passa a ser o
-- custo real. Menos peça nova = menos lugar para divergir.
alter table public.procedure_costs
  add column if not exists materials_source text not null default 'manual';

do $$
begin
  alter table public.procedure_costs
    add constraint procedure_costs_materials_source_check
    check (materials_source in ('manual', 'kit'));
exception when duplicate_object then null;
end $$;

comment on column public.procedure_costs.materials_source is
  'kit = o valor vem do consumo cadastrado, ao custo médio da unidade; '
  'manual = valor informado à mão (o que existia antes do Estoque).';

-- O trigger da 0211 (itens de texto livre) não pode sobrescrever o que o kit
-- calculou: com kit cadastrado, o kit manda.
create or replace function public.sync_procedure_cost_materials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost uuid := coalesce(new.cost_id, old.cost_id);
  v_total bigint;
  v_source text;
begin
  select materials_source into v_source
  from public.procedure_costs where id = v_cost;

  if coalesce(v_source, 'manual') = 'kit' then
    return null;
  end if;

  select coalesce(sum(round(quantity * unit_cost_cents)), 0) into v_total
  from public.procedure_cost_items where cost_id = v_cost;

  update public.procedure_costs
     set materials_cents = v_total, updated_at = now()
   where id = v_cost;

  return null;
end;
$$;

-- Recalcula o custo de material a partir do kit. Chamado quando o kit muda e
-- quando o custo médio de um item se move (comprar mais caro muda o custo de
-- todo procedimento que usa aquele item — e isso precisa aparecer no preço).
create or replace function public.refresh_kit_costs(
  p_clinic_id uuid,
  p_item_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
  v_cost bigint;
begin
  -- Custo de material é sempre DA UNIDADE (é ela que compra pelo seu preço).
  if p_clinic_id is null then return 0; end if;

  for v_row in
    select distinct k.procedure_id
    from public.procedure_kits k
    join public.procedure_kit_items ki on ki.kit_id = k.id
    where (k.clinic_id is null or k.clinic_id = p_clinic_id)
      and (p_item_id is null or ki.item_id = p_item_id)
  loop
    v_cost := public.kit_cost_cents(v_row.procedure_id, p_clinic_id);

    insert into public.procedure_costs (
      procedure_id, clinic_id, materials_cents, materials_source, updated_at
    ) values (
      v_row.procedure_id, p_clinic_id, v_cost, 'kit', now()
    )
    -- O índice único da 0211 é por EXPRESSÃO (clinic_id nulo vira um uuid
    -- zerado); `on conflict (procedure_id, clinic_id)` não casaria com ele.
    on conflict (procedure_id,
                 coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set materials_cents = excluded.materials_cents,
                  materials_source = 'kit',
                  updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.refresh_kit_costs(uuid, uuid) to authenticated;

-- Movimento que muda o custo médio → o custo dos procedimentos que usam o item
-- muda junto. Sem isto, o precificador continuaria mostrando o custo da compra
-- anterior e ninguém notaria.
create or replace function public.stock_movement_refreshes_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.avg_cost_after is distinct from
     (select avg_cost_after from public.stock_movements
      where clinic_id = new.clinic_id and item_id = new.item_id
        and id <> new.id
      order by created_at desc limit 1)
  then
    perform public.refresh_kit_costs(new.clinic_id, new.item_id);
  end if;
  return null;
end;
$$;

drop trigger if exists stock_movements_refresh_cost on public.stock_movements;
create trigger stock_movements_refresh_cost
  after insert on public.stock_movements
  for each row execute function public.stock_movement_refreshes_cost();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_items where is_active) as itens_ativos,
  (select count(*) from public.stock_balances) as saldos,
  (select count(*) from public.stock_movements) as movimentos,
  (select count(*) from public.procedure_kits) as kits,
  (select count(*) from public.procedure_costs
    where materials_source = 'kit') as custos_vindos_do_kit,
  (select count(*) from public.chart_of_accounts
    where code like '6%') as contas_de_ativo;
