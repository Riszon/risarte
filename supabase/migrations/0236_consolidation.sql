-- =============================================================================
-- 0236 — FIN8.2: consolidação (Resultado do Grupo × Faturamento da Rede)
-- -----------------------------------------------------------------------------
-- DUAS COISAS QUE NÃO PODEM SE MISTURAR, e é por isso que nascem juntas:
--
--   • RESULTADO DO GRUPO = franqueadora + unidades PRÓPRIAS. É o resultado de
--     quem é dono do negócio.
--   • FATURAMENTO DA REDE = todas as unidades, lado a lado, só para comparar.
--     FATURAMENTO DE FRANQUEADA NUNCA ENTRA NO RESULTADO DA FRANQUEADORA — ela
--     ganha o royalty, não a receita da cadeira. Somar os dois é o erro que faz
--     uma rede parecer dez vezes maior do que é.
--
-- A ELIMINAÇÃO É MENOS DRAMÁTICA DO QUE PARECE, E MAIS IMPORTANTE DO QUE SOA.
-- Quando uma unidade PRÓPRIA paga royalty à franqueadora, o dinheiro trocou de
-- bolso dentro de casa. Somando as duas demonstrações isso JÁ SE ANULA no lucro
-- (−1.000 de despesa lá, +1.000 de receita cá). O problema não é o lucro: é o
-- FATURAMENTO. Sem eliminar, o grupo apareceria faturando mil a mais e gastando
-- mil a mais. Consolidar é isso — o lucro não muda, as linhas ficam honestas.
--
-- QUEM É O PAR DE QUEM: a despesa intercompany de uma unidade do grupo tem
-- sempre a franqueadora do outro lado, então elimina. Já a RECEITA intercompany
-- da franqueadora só elimina quando veio de unidade DO GRUPO — a que veio de
-- franqueada é dinheiro de fora, e é receita de verdade.
--
-- LIMITE DECLARADO: só elimina o que dá para rastrear até a conta de taxa que
-- gerou o par (`network_fee_revenue` e `network_fee_discount`). Lançamento
-- intercompany feito à mão, sem essa origem, fica de fora — e a tela avisa, em
-- vez de eliminar por conta própria e errar em silêncio.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) PRÓPRIA OU FRANQUEADA — o interruptor que decide quem entra no grupo
-- -----------------------------------------------------------------------------
-- A coluna existe desde o FIN0 e nunca teve tela. Sem ela editável, o Resultado
-- do Grupo mostraria só a franqueadora para sempre, e ninguém saberia por quê.
create or replace function public.set_clinic_ownership(
  p_clinic_id uuid,
  p_ownership text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_ownership not in ('own', 'franchised') then
    raise exception 'INVALID_OWNERSHIP';
  end if;

  update public.clinics set ownership = p_ownership
   where id = p_clinic_id and type <> 'franchisor';
end;
$$;

revoke all on function public.set_clinic_ownership(uuid, text) from public;
grant execute on function public.set_clinic_ownership(uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A DEMONSTRAÇÃO CONSOLIDADA
-- -----------------------------------------------------------------------------
create or replace function public.consolidated_dre(
  p_from date,
  p_to date,
  p_scope text default 'grupo'
)
returns table (
  account_code text,
  account_name text,
  block text,
  amount_cents bigint,
  eliminated_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with permitido as (
    select (public.is_admin_master() or public.is_finance_franchisor()) as ok
  ),
  franqueadora as (
    select id from public.clinics where type = 'franchisor' limit 1
  ),
  escopo as (
    select c.id
    from public.clinics c
    where c.is_active
      and case
        -- O grupo: a franqueadora e as unidades próprias.
        when p_scope = 'grupo'
          then c.type = 'franchisor' or c.ownership = 'own'
        -- A rede: as unidades. A franqueadora não é uma unidade.
        else c.type <> 'franchisor'
      end
  ),
  base as (
    select
      e.id,
      e.clinic_id,
      e.account_code,
      e.source_type,
      e.source_id,
      coalesce(a.nature, '') as nature,
      (case when e.direction = 'inflow'
            then e.amount_cents else -e.amount_cents end)::bigint as v
    from public.financial_entries e
    left join public.chart_of_accounts a on a.code = e.account_code
    where (select ok from permitido)
      and e.clinic_id in (select id from escopo)
      and e.accrual_date between p_from and p_to
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and e.account_code not like '6%'
      and e.account_code not like '5.1%'
      and e.account_code not like '5.3%'
      and e.account_code not like '5.4%'
  ),
  marcado as (
    select
      b.*,
      case
        -- Só no grupo se elimina: a rede é comparação, não consolidação.
        when p_scope <> 'grupo' then false
        when b.nature <> 'intercompany' then false
        -- Unidade do grupo pagando taxa: o outro lado é a franqueadora, que
        -- está no grupo por definição.
        when b.clinic_id <> (select id from franqueadora) then true
        -- Receita da franqueadora: elimina só o que veio de unidade DO GRUPO.
        when b.source_type = 'network_fee_revenue' then exists (
          select 1 from public.payables p
           where p.id = b.source_id and p.clinic_id in (select id from escopo)
        )
        when b.source_type = 'network_fee_discount' then exists (
          select 1 from public.payable_payments pp
          join public.payables p on p.id = pp.payable_id
           where pp.id = b.source_id and p.clinic_id in (select id from escopo)
        )
        -- Sem origem rastreável, não elimina (ver cabeçalho).
        else false
      end as eliminado
    from base b
  )
  select
    m.account_code,
    coalesce(max(a.name), m.account_code),
    case
      when m.account_code like '1.9%' then 'deducoes'
      when m.account_code like '1%'   then 'receita_bruta'
      when m.account_code like '2%'   then 'custos_diretos'
      when m.account_code like '3%'   then 'despesas_operacionais'
      when m.account_code like '4%'   then 'resultado_financeiro'
      when m.account_code like '5.2%' then 'depreciacao'
      else 'fora'
    end,
    -- Conta inteiramente eliminada devolve nulo no `filter`; sem o coalesce a
    -- linha apareceria vazia em vez de zerada.
    coalesce(sum(m.v) filter (where not m.eliminado), 0)::bigint,
    coalesce(sum(m.v) filter (where m.eliminado), 0)::bigint
  from marcado m
  left join public.chart_of_accounts a on a.code = m.account_code
  group by m.account_code
  having sum(m.v) <> 0
  order by m.account_code;
$$;

grant execute on function public.consolidated_dre(date, date, text)
  to authenticated;

-- De onde veio cada linha: o mesmo recorte, aberto por unidade.
create or replace function public.consolidated_by_clinic(
  p_from date,
  p_to date,
  p_scope text,
  p_account_code text
)
returns table (
  clinic_name text,
  ownership text,
  amount_cents bigint,
  eliminated_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with permitido as (
    select (public.is_admin_master() or public.is_finance_franchisor()) as ok
  ),
  franqueadora as (
    select id from public.clinics where type = 'franchisor' limit 1
  ),
  escopo as (
    select c.id
    from public.clinics c
    where c.is_active
      and case
        when p_scope = 'grupo'
          then c.type = 'franchisor' or c.ownership = 'own'
        else c.type <> 'franchisor'
      end
  )
  select
    c.name,
    case when c.type = 'franchisor' then 'franqueadora' else c.ownership end,
    coalesce(sum(case when not x.eliminado then x.v end), 0)::bigint,
    coalesce(sum(case when x.eliminado then x.v end), 0)::bigint
  from (
    select
      e.clinic_id,
      (case when e.direction = 'inflow'
            then e.amount_cents else -e.amount_cents end)::bigint as v,
      case
        when p_scope <> 'grupo' then false
        when coalesce(a.nature, '') <> 'intercompany' then false
        when e.clinic_id <> (select id from franqueadora) then true
        when e.source_type = 'network_fee_revenue' then exists (
          select 1 from public.payables p
           where p.id = e.source_id and p.clinic_id in (select id from escopo)
        )
        when e.source_type = 'network_fee_discount' then exists (
          select 1 from public.payable_payments pp
          join public.payables p on p.id = pp.payable_id
           where pp.id = e.source_id and p.clinic_id in (select id from escopo)
        )
        else false
      end as eliminado
    from public.financial_entries e
    left join public.chart_of_accounts a on a.code = e.account_code
    where (select ok from permitido)
      and e.clinic_id in (select id from escopo)
      and e.accrual_date between p_from and p_to
      and e.account_code = p_account_code
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
  ) x
  join public.clinics c on c.id = x.clinic_id
  group by c.name, c.type, c.ownership
  order by c.name;
$$;

grant execute on function public.consolidated_by_clinic(date, date, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) AS UNIDADES LADO A LADO
-- -----------------------------------------------------------------------------
-- Aqui NÃO se elimina nada: é comparação entre unidades, não soma de grupo.
-- Cada linha é a unidade inteira, como ela mesma se vê.
create or replace function public.network_units_summary(
  p_from date,
  p_to date
)
returns table (
  clinic_id uuid,
  clinic_name text,
  ownership text,
  gross_revenue_cents bigint,
  net_revenue_cents bigint,
  result_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.ownership,
    coalesce(sum(x.v) filter (
      where x.account_code like '1%' and x.account_code not like '1.9%'), 0)::bigint,
    coalesce(sum(x.v) filter (where x.account_code like '1%'), 0)::bigint,
    coalesce(sum(x.v), 0)::bigint
  from public.clinics c
  left join lateral (
    select
      e.account_code,
      (case when e.direction = 'inflow'
            then e.amount_cents else -e.amount_cents end)::bigint as v
    from public.financial_entries e
    where e.clinic_id = c.id
      and e.accrual_date between p_from and p_to
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and e.account_code not like '6%'
      and e.account_code not like '5.1%'
      and e.account_code not like '5.3%'
      and e.account_code not like '5.4%'
  ) x on true
  where c.is_active
    and c.type <> 'franchisor'
    and (public.is_admin_master() or public.is_finance_franchisor())
  group by c.id, c.name, c.ownership
  order by 4 desc, c.name;
$$;

grant execute on function public.network_units_summary(date, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.clinics
    where is_active and type <> 'franchisor' and ownership = 'own')
    as unidades_proprias,
  (select count(*) from public.clinics
    where is_active and type <> 'franchisor' and ownership = 'franchised')
    as unidades_franqueadas,
  (select count(*) from public.financial_entries e
    join public.chart_of_accounts a on a.code = e.account_code
   where a.nature = 'intercompany'
     and e.status in ('settled', 'open') and e.reversal_of is null)
    as lancamentos_intercompany,
  (select count(*) from public.financial_entries
    where source_type in ('network_fee_revenue', 'network_fee_discount'))
    as lancamentos_rastreaveis;
