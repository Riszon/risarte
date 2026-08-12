-- =============================================================================
-- 0216 — O CUSTO DE MATERIAL PASSA A SER CALCULADO, NÃO GUARDADO
-- -----------------------------------------------------------------------------
-- BUG ACHADO PELO DONO NO TESTE (11/08/2026). Ele somou os kits do procedimento
-- "Restauração em resina 1 face" e deu R$ 17,92; a Precificação mostrava
-- R$ 11,69. Diferença: R$ 6,23 — exatamente a linha da resina (0,2 × R$ 31,125).
--
-- CAUSA, E O ERRO É DE DESENHO MEU. Na 0213 eu fiz o kit ESCREVER o resultado
-- em `procedure_costs.materials_cents` em vez de calcular na hora. A intenção
-- era não mexer nas três telas que já liam aquele campo (precificador, margem
-- da negociação, venda direta). Mas valor guardado é FOTO: fica certo no
-- instante em que é tirada e envelhece sozinho, e todo caminho que muda o custo
-- passa a ter de lembrar de tirar outra. Um deles não lembrou.
--
-- E o buraco era maior que o caso dele. No banco, no momento do diagnóstico:
--   • Cambé:   R$ 11,69 guardado  ×  R$ 17,92 real
--   • Roteiro: R$ 220,00 guardado ×  R$  0,00 real
--
-- O da Roteiro mostra o defeito estrutural: `refresh_kit_costs` recalculava
-- APENAS a clínica ativa. Salvar um kit DA REDE estando em Cambé deixava
-- Londrina e Roteiro com o número velho — e nada na tela denunciava.
--
-- A CORREÇÃO NÃO É LEMBRAR DE TIRAR A FOTO EM MAIS LUGARES. É PARAR DE GUARDAR.
-- O custo de material vira cálculo no momento da leitura: kits do procedimento
-- × custo médio da unidade. Não existe "velho" porque não existe foto. Custa
-- alguns milissegundos por tela — barato perto de formar preço de venda com
-- custo errado.
--
-- O campo `materials_cents` continua existindo para quem informa o valor À MÃO
-- (procedimento sem kit). Quando há kit, o kit manda e o campo é ignorado.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O CACHE SAI DE CIRCULAÇÃO
-- -----------------------------------------------------------------------------
drop trigger if exists stock_movements_refresh_cost on public.stock_movements;
drop function if exists public.stock_movement_refreshes_cost();
drop function if exists public.refresh_kit_costs(uuid, uuid);

-- Os valores que o cache deixou para trás não podem ficar no banco parecendo
-- verdade: ninguém mais os lê, mas quem consultar a tabela direto amanhã leria.
update public.procedure_costs
   set materials_cents = 0, materials_source = 'manual', updated_at = now()
 where materials_source = 'kit';

-- -----------------------------------------------------------------------------
-- 2) O CUSTO DE MATERIAL, CALCULADO
-- -----------------------------------------------------------------------------
-- Regra: TEM KIT, O KIT MANDA; não tem, vale o valor informado à mão. É a mesma
-- regra de antes — o que muda é que agora ela é resolvida na hora da pergunta.
create or replace function public.material_cost_for(
  p_procedure_id uuid,
  p_clinic_id uuid
)
returns table (
  materials_cents bigint,
  lab_cents bigint,
  from_kit boolean,
  kit_count integer,
  items_without_cost integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kits integer;
  v_cost record;
  v_material bigint;
  v_missing integer;
begin
  select count(*) into v_kits
  from public.kits_for(p_procedure_id, p_clinic_id);

  -- Laboratório continua vindo do cadastro: não é insumo de estoque.
  select * into v_cost from public.procedure_costs c
  where c.procedure_id = p_procedure_id
    and (c.clinic_id = p_clinic_id or c.clinic_id is null)
  order by (c.clinic_id is not null) desc
  limit 1;

  if v_kits = 0 then
    return query select
      coalesce(v_cost.materials_cents, 0)::bigint,
      coalesce(v_cost.lab_cents, 0)::bigint,
      false, 0, 0;
    return;
  end if;

  select
    coalesce(sum(round(ki.quantity * coalesce(b.avg_cost_cents, 0))), 0)::bigint,
    count(*) filter (where coalesce(b.avg_cost_cents, 0) <= 0)::integer
    into v_material, v_missing
  from public.kits_for(p_procedure_id, p_clinic_id) f
  join public.stock_kit_items ki on ki.kit_id = f.kit_id
  left join public.stock_balances b
    on b.item_id = ki.item_id and b.clinic_id = p_clinic_id;

  return query select
    v_material,
    coalesce(v_cost.lab_cents, 0)::bigint,
    true, v_kits, coalesce(v_missing, 0);
end;
$$;

grant execute on function public.material_cost_for(uuid, uuid) to authenticated;

-- Versão em lote, para a tela não fazer uma chamada por procedimento.
create or replace function public.material_costs_for_clinic(p_clinic_id uuid)
returns table (
  procedure_id uuid,
  materials_cents bigint,
  lab_cents bigint,
  from_kit boolean,
  kit_count integer,
  items_without_cost integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, m.materials_cents, m.lab_cents, m.from_kit, m.kit_count,
         m.items_without_cost
  from public.procedures p
  cross join lateral public.material_cost_for(p.id, p_clinic_id) m
  where p.is_active;
$$;

grant execute on function public.material_costs_for_clinic(uuid) to authenticated;

-- Os kits de cada procedimento, com o custo de cada um — para a tela de
-- Procedimentos mostrar "quais kits" e "quanto cada um pesa" sem abrir edição.
create or replace function public.procedure_kits_detail(p_clinic_id uuid)
returns table (
  procedure_id uuid,
  kit_id uuid,
  kit_name text,
  kit_scope text,
  kit_cost_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    k.id,
    k.name,
    case when k.clinic_id is null then 'rede' else 'unidade' end,
    coalesce((
      select sum(round(ki.quantity * coalesce(b.avg_cost_cents, 0)))
      from public.stock_kit_items ki
      left join public.stock_balances b
        on b.item_id = ki.item_id and b.clinic_id = p_clinic_id
      where ki.kit_id = k.id
    ), 0)::bigint
  from public.procedures p
  cross join lateral public.kits_for(p.id, p_clinic_id) f
  join public.stock_kits k on k.id = f.kit_id
  where p.is_active;
$$;

grant execute on function public.procedure_kits_detail(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) QUEM CONSOME O CUSTO PASSA A PERGUNTAR EM VEZ DE LER O GUARDADO
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
  v_mat record;
  v_payout bigint;
  v_chair bigint;
begin
  select p.estimated_minutes, p.default_price_cents into v_proc
  from public.procedures p where p.id = p_procedure_id;

  select * into v_set from public.cost_settings_for(p_clinic_id);

  -- 0216: material CALCULADO (kit manda; sem kit, o valor informado à mão).
  select * into v_mat from public.material_cost_for(p_procedure_id, p_clinic_id);

  select coalesce(pr.amount_cents, 0) into v_payout
  from public.payout_rate_for(p_procedure_id, null, p_clinic_id, public.today_br()) pr;

  v_chair := round(
    coalesce(v_set.chair_cost_per_hour_cents, 0)
    * coalesce(v_proc.estimated_minutes, 0) / 60.0);

  return query select
    coalesce(v_proc.estimated_minutes, 0),
    v_chair,
    coalesce(v_mat.materials_cents, 0),
    coalesce(v_mat.lab_cents, 0),
    coalesce(v_payout, 0),
    v_chair + coalesce(v_mat.materials_cents, 0)
            + coalesce(v_mat.lab_cents, 0) + coalesce(v_payout, 0),
    v_set.tax_percent,
    v_set.avg_acquirer_fee_percent,
    v_set.target_margin_percent,
    coalesce(v_proc.default_price_cents, 0)::bigint;
end;
$$;

grant execute on function public.procedure_cost_breakdown(uuid, uuid)
  to authenticated;

-- A margem da negociação e da venda direta usam a MESMA conta — se usassem
-- outra, o consultor veria uma margem e o precificador outra.
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
    (m.materials_cents + m.lab_cents) * greatest(1, coalesce(oi.quantity, 1))
  ), 0)::bigint
  from public.treatment_plan_option_items oi
  cross join lateral public.material_cost_for(oi.procedure_id, p_clinic_id) m
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
    (m.materials_cents + m.lab_cents) * greatest(1, coalesce(i.quantity, 1))
  ), 0)::bigint
  from public.direct_sale_items i
  join public.direct_sales s on s.id = i.sale_id
  cross join lateral public.material_cost_for(i.procedure_id, s.clinic_id) m
  where i.sale_id = p_sale_id and i.procedure_id is not null;
$$;

grant execute on function public.estimated_direct_sale_material(uuid)
  to authenticated;

-- O gatilho da 0211 (itens de texto livre) volta a valer sempre: não há mais
-- `materials_source = 'kit'` para respeitar.
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

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.procedure_costs
    where materials_source = 'kit') as caches_restantes_deve_ser_zero,
  (select count(*) from public.stock_kits where active) as kits_ativos,
  (select count(*) from public.procedure_kit_links) as vinculos,
  (select count(*) from public.procedures p
    where p.is_active
      and exists (select 1 from public.procedure_kit_links l
                  where l.procedure_id = p.id)) as procedimentos_com_kit;
