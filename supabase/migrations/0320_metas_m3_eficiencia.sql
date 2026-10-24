-- =============================================================================
-- 0320 — METAS SMART, ETAPA M3: EFICIÊNCIA
-- -----------------------------------------------------------------------------
-- Plano e decisões do dono: docs/metas/METAS-PLANO.md, §9c (O1–O7, aprovadas
-- em 24/10/2026). Continua a 0318 e a 0319.
--
-- O que esta migração faz:
--   1. O catálogo do banco ganha 13 indicadores e a coluna `in_app`: indicador
--      MEDIDO NO CÓDIGO (O2 — ocupação e horas ociosas da cadeira, pela mesma
--      conta do Planejamento Anual, que não existe no banco).
--   2. A medição ganha os ramos novos. Margens e ponto de equilíbrio REUSAM
--      `dre_lines` e `breakeven_lines_raw` e repetem as somas de `buildDre` /
--      `buildBreakeven` (ponderado entre unidades — O4).
--   3. `goal_record_app_final`: só o SERVIDOR (chave de serviço) grava o
--      resultado final de uma meta medida no código, depois de medir — como
--      `record_training_completion` (0281). A rotina diária não as encerra.
--   4. `goal_breakeven_reading`: as duas leituras do ponto de equilíbrio (O1)
--      — em R$ e em atendimentos — para quem vê o financeiro.
--   5. `goal_save`: meta medida no código só para o período inteiro, e não
--      vira marco.
--   0. ⚠️ A DRE ganha a "porta" da 0282 (`_dre_lines_raw`): a guarda escondida
--      em `dre_lines` fazia a receita faturada (M2) e a margem lerem zero na
--      rotina e para quem não vê o financeiro. A tela da DRE não muda.
--
-- Fontes conferidas no banco de treino em 24/10/2026 (ver o plano).
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) A DRE GANHA UMA "PORTA" (padrão da 0282, como a inadimplência na 0319)
-- -----------------------------------------------------------------------------
-- ⚠️ ACHADO NA M3: `dre_lines` (0227) só responde para quem vê o financeiro
-- da unidade. A "receita faturada" da M2 (já na produção) e a margem líquida
-- desta etapa leriam ZERO na rotina da madrugada (sem usuário) — o resultado
-- congelado sairia falso — e o participante sem financeiro veria "0%". A conta
-- passa a morar em `_dre_lines_raw` (sem guarda, só para funções internas) e
-- a função de sempre vira a porta, com a MESMA guarda. A tela da DRE não muda.
-- A conta é a da 0227, copiada sem mudar uma linha (só a guarda saiu dela).
create or replace function public._dre_lines_raw(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_cost_center_id uuid default null
)
returns table (
  account_code text,
  account_name text,
  block text,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.account_code,
    coalesce(max(a.name), e.account_code),
    case
      when e.account_code like '1.9%' then 'deducoes'
      when e.account_code like '1%'   then 'receita_bruta'
      when e.account_code like '2%'   then 'custos_diretos'
      when e.account_code like '3%'   then 'despesas_operacionais'
      when e.account_code like '4%'   then 'resultado_financeiro'
      when e.account_code like '5.2%' then 'depreciacao'
      else 'fora'
    end,
    -- O SINAL VEM DA DIREÇÃO: entrada soma, saída subtrai.
    sum(case when e.direction = 'inflow'
             then e.amount_cents else -e.amount_cents end)::bigint
  from public.financial_entries e
  left join public.chart_of_accounts a on a.code = e.account_code
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    -- LIQUIDAÇÃO NÃO É COMPETÊNCIA (0226): estas duas origens são o caixa.
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
    and e.account_code not like '6%'
    and e.account_code not like '5.1%'
    and e.account_code not like '5.3%'
    and e.account_code not like '5.4%'
  group by e.account_code
  having sum(case when e.direction = 'inflow'
                  then e.amount_cents else -e.amount_cents end) <> 0
  order by e.account_code;
$$;

create or replace function public.dre_lines(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_cost_center_id uuid default null
)
returns table (
  account_code text,
  account_name text,
  block text,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.account_code, r.account_name, r.block, r.amount_cents
    from public._dre_lines_raw(p_clinic_id, p_from, p_to, p_cost_center_id) r
   where public.can_see_clinic_finance(p_clinic_id)
   order by r.account_code;
$$;

revoke execute on function public._dre_lines_raw(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function public.dre_lines(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.dre_lines(uuid, date, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 1) O CATÁLOGO DO BANCO (espelho de src/lib/metas/indicadores.ts)
-- -----------------------------------------------------------------------------
-- kind: 'sum' | 'rate' | 'point'. per_person · money (dado financeiro, D3) ·
-- can_decrease (limite) · in_app (medido no código — O2).
-- ⚠️ A régua `metas-catalogo.test.ts` lê a lista entre as marcas abaixo.
drop function if exists public._goal_indicator_meta(text);
create or replace function public._goal_indicator_meta(p_indicator text)
returns table (kind text, per_person boolean, money boolean, can_decrease boolean, in_app boolean)
language sql
immutable
set search_path = ''
as $$
  select m.kind, m.per_person, m.money, m.can_decrease, m.in_app
    from (values
      -- INDICADORES:INICIO
      ('sales_value',            'sum',   true,  true,  false, false),
      ('sales_count',            'sum',   true,  false, false, false),
      ('sales_ticket',           'rate',  true,  true,  false, false),
      ('conversion_rate',        'rate',  true,  false, false, false),
      ('discount_avg',           'rate',  true,  false, false, false),
      ('sales_cancelled',        'sum',   false, false, true,  false),
      ('revenue_received',       'sum',   false, true,  false, false),
      ('revenue_billed',         'sum',   false, true,  false, false),
      ('overdue_rate',           'point', false, true,  false, false),
      ('overdue_value',          'point', false, true,  false, false),
      ('overdue_recovery',       'sum',   false, true,  false, false),
      ('net_margin',             'rate',  false, true,  false, false),
      ('contribution_margin',    'rate',  false, true,  false, false),
      ('breakeven_reached',      'rate',  false, true,  false, false),
      ('on_time_payment',        'rate',  false, true,  false, false),
      ('appointments_created',   'sum',   true,  false, false, false),
      ('appointments_done',      'sum',   true,  false, false, false),
      ('evaluations_done',       'sum',   true,  false, false, false),
      ('attendance_rate',        'rate',  true,  false, false, false),
      ('no_show_rate',           'rate',  true,  false, false, false),
      ('check_ins',              'sum',   true,  false, false, false),
      ('returns_scheduled',      'sum',   true,  false, false, false),
      ('chair_occupancy',        'rate',  false, false, false, true),
      ('chair_idle_hours',       'sum',   false, false, true,  true),
      ('procedures_done',        'sum',   true,  false, false, false),
      ('provider_production',    'sum',   true,  true,  false, false),
      ('plan_options_approved',  'sum',   true,  false, false, false),
      ('treatments_completed',   'sum',   false, false, false, false),
      ('new_clients',            'sum',   true,  false, false, false),
      ('new_clients_evaluated',  'sum',   true,  false, false, false),
      ('journey_conversion',     'rate',  false, false, false, false),
      ('reactivated_clients',    'sum',   false, false, false, false),
      ('ppr_adhesions',          'sum',   true,  false, false, false),
      ('ppr_cancellations',      'sum',   false, false, true,  false),
      ('ppr_lives',              'point', false, false, false, false),
      ('indica_referrals',       'sum',   true,  false, false, false),
      ('indica_conversions',     'sum',   true,  false, false, false),
      ('indica_ambassadors',     'sum',   true,  false, false, false),
      ('empresarial_companies',  'sum',   true,  false, false, false),
      ('empresarial_lives',      'sum',   false, false, false, false),
      ('certifications',         'sum',   true,  false, false, false),
      ('reports_sent',           'sum',   true,  false, false, false)
      -- INDICADORES:FIM
    ) as m (indicator, kind, per_person, money, can_decrease, in_app)
   where m.indicator = p_indicator;
$$;

-- -----------------------------------------------------------------------------
-- 2) A MEDIÇÃO — uma consulta por indicador (interna, sem guarda)
-- -----------------------------------------------------------------------------
create or replace function public._goal_measure_raw(
  p_indicator text,
  p_filters jsonb,
  p_clinic_ids uuid[],
  p_from date,
  p_to date
)
returns table (clinic_id uuid, user_id uuid, day date, num numeric, den numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_from timestamptz := (p_from::timestamp at time zone 'America/Sao_Paulo');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_today date := public.today_br();
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_types text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'appointment_types', '[]'::jsonb)) as t (x));
  v_specialties text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'specialties', '[]'::jsonb)) as t (x));
  v_origins text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'client_origins', '[]'::jsonb)) as t (x));
  v_plans text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'ppr_plans', '[]'::jsonb)) as t (x));
  v_sale_origin text := nullif(v_f ->> 'sale_origin', '');
  v_esp boolean;
begin
  if p_from is null or p_to is null or p_to < p_from or coalesce(cardinality(p_clinic_ids), 0) = 0 then
    return;
  end if;
  v_esp := cardinality(v_specialties) > 0;

  if p_indicator in ('sales_value', 'sales_count', 'sales_ticket') then
    -- Venda fechada = contrato + pagamento (closed_at), sem cancelamento.
    -- Quem vendeu: o consultor da negociação; venda direta: quem a criou.
    -- N4: com recorte de especialidade, em R$ conta a PARTE proporcional dos
    -- procedimentos dela (o desconto se reparte na mesma proporção); em
    -- quantidade, conta a venda que tem ao menos um procedimento dela.
    return query
      with plano as (
        select cs.clinic_id, pn.consultant_id as user_id, cs.closed_at as at, cs.final_cents::numeric as cents,
               cs.negotiation_id
          from public.commercial_sales cs
          join public.plan_negotiations pn on pn.id = cs.negotiation_id
         where cs.closed_at >= v_from and cs.closed_at < v_to
           and cs.cancelled_at is null
           and cs.clinic_id = any (p_clinic_ids)
           and (v_sale_origin is null or v_sale_origin = 'plan')
      ),
      plano_parte as (
        select pl.negotiation_id,
               sum(it.unit_price_cents::numeric * it.quantity) as total,
               coalesce(sum(it.unit_price_cents::numeric * it.quantity)
                          filter (where pr.specialty = any (v_specialties)), 0) as parte
          from plano pl
          join public.plan_negotiation_items ni on ni.negotiation_id = pl.negotiation_id and ni.included
          join public.treatment_plan_option_items it on it.id = ni.item_id
          left join public.procedures pr on pr.id = it.procedure_id
         where v_esp
         group by pl.negotiation_id
      ),
      direta as (
        select ds.id, ds.clinic_id, ds.created_by as user_id, ds.closed_at as at, ds.final_cents::numeric as cents
          from public.direct_sales ds
         where ds.closed_at >= v_from and ds.closed_at < v_to
           and ds.status <> 'cancelada' and not ds.cancelled and ds.cancelled_at is null
           and ds.clinic_id = any (p_clinic_ids)
           and (v_sale_origin is null or v_sale_origin = 'direct')
      ),
      direta_parte as (
        select d.id,
               sum(di.final_cents::numeric) as total,
               coalesce(sum(di.final_cents::numeric) filter (where pr.specialty = any (v_specialties)), 0) as parte
          from direta d
          join public.direct_sale_items di on di.sale_id = d.id
          left join public.procedures pr on pr.id = di.procedure_id
         where v_esp
         group by d.id
      ),
      s as (
        select pl.clinic_id, pl.user_id, pl.at,
               case when not v_esp then pl.cents
                    when coalesce(pp.total, 0) = 0 then 0
                    else pl.cents * pp.parte / pp.total end as cents,
               (not v_esp or coalesce(pp.parte, 0) > 0) as conta
          from plano pl
          left join plano_parte pp on pp.negotiation_id = pl.negotiation_id
        union all
        select d.clinic_id, d.user_id, d.at,
               case when not v_esp then d.cents
                    when coalesce(dp.total, 0) = 0 then 0
                    else d.cents * dp.parte / dp.total end,
               (not v_esp or coalesce(dp.parte, 0) > 0)
          from direta d
          left join direta_parte dp on dp.id = d.id
      )
      select s.clinic_id, s.user_id, (s.at at time zone v_tz)::date,
             case when p_indicator = 'sales_count' then count(*)::numeric else round(sum(s.cents)) end,
             case when p_indicator = 'sales_ticket' then count(*)::numeric else null::numeric end
        from s
       where s.conta
       group by 1, 2, 3;

  elsif p_indicator = 'conversion_rate' then
    -- A mesma conta do painel do Comercial: das negociações ABERTAS no
    -- período, quantas % foram aceitas. Versão substituída não conta.
    return query
      select pn.clinic_id, pn.consultant_id, (pn.created_at at time zone v_tz)::date,
             100 * (count(*) filter (where pn.status = 'aceita'))::numeric,
             count(*)::numeric
        from public.plan_negotiations pn
       where pn.created_at >= v_from and pn.created_at < v_to
         and pn.clinic_id = any (p_clinic_ids)
         and pn.status <> 'substituida'
       group by 1, 2, 3;

  elsif p_indicator = 'revenue_received' then
    -- Recebimentos válidos (sem estorno). N5: só coletiva.
    return query
      select r.clinic_id, null::uuid, r.received_at, sum(r.amount_cents)::numeric, null::numeric
        from public.payment_receipts r
       where r.received_at between p_from and p_to
         and not r.reversed and r.reversal_of is null
         and r.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'revenue_billed' then
    -- A própria DRE (competência): receita bruta − deduções. N3: por período.
    return query
      select c.id, null::uuid, p_to,
             coalesce((select sum(d.amount_cents) from public._dre_lines_raw(c.id, p_from, p_to) d
                        where d.block in ('receita_bruta', 'deducoes')), 0)::numeric,
             null::numeric
        from unnest(p_clinic_ids) as c (id);

  elsif p_indicator = 'overdue_recovery' then
    -- Recebido DEPOIS do vencimento, em parcela que ficou vencida.
    return query
      select r.clinic_id, null::uuid, r.received_at, sum(r.amount_cents)::numeric, null::numeric
        from public.payment_receipts r
        join public.payment_installments i on i.id = r.installment_id
       where r.received_at between p_from and p_to
         and not r.reversed and r.reversal_of is null
         and i.was_overdue
         and r.received_at > coalesce(i.expected_settlement_date, i.due_date)
         and r.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator in ('overdue_rate', 'overdue_value') then
    -- FOTOGRAFIA: a mesma conta da tela do Financeiro (a porta da 1b).
    return query
      select c.id, null::uuid, v_today,
             case when p_indicator = 'overdue_rate' then 100 * o.overdue_cents::numeric
                  else o.overdue_cents::numeric end,
             case when p_indicator = 'overdue_rate' then o.open_cents::numeric else null::numeric end
        from unnest(p_clinic_ids) as c (id)
        cross join lateral public._clinic_overdue_rate_raw(c.id) o;

  elsif p_indicator in ('appointments_created', 'returns_scheduled') then
    if p_indicator = 'returns_scheduled' and cardinality(v_types) = 0 then
      v_types := array['return_visit', 'reevaluation'];
    end if;
    return query
      select a.clinic_id, a.created_by, (a.created_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.appointments a
       where a.created_at >= v_from and a.created_at < v_to
         and a.clinic_id = any (p_clinic_ids)
         and a.status::text <> 'cancelled'
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator in ('appointments_done', 'evaluations_done') then
    if p_indicator = 'evaluations_done' then
      v_types := array['evaluation'];
    end if;
    return query
      select a.clinic_id, a.provider_user_id, (coalesce(a.done_at, a.ends_at) at time zone v_tz)::date,
             count(*)::numeric, null::numeric
        from public.appointments a
       where coalesce(a.done_at, a.ends_at) >= v_from and coalesce(a.done_at, a.ends_at) < v_to
         and a.clinic_id = any (p_clinic_ids)
         and (a.attendance::text = 'done' or a.status::text = 'completed')
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator in ('attendance_rate', 'no_show_rate') then
    return query
      with b as (
        select a.clinic_id, a.created_by as user_id, (a.starts_at at time zone v_tz)::date as d,
               (a.checked_in_at is not null
                or a.attendance::text in ('done', 'gave_up', 'in_service')
                or a.status::text = 'completed') as came,
               a.status::text = 'no_show' as missed
          from public.appointments a
         where a.starts_at >= v_from and a.starts_at < v_to and a.starts_at < now()
           and a.clinic_id = any (p_clinic_ids)
           and a.status::text <> 'cancelled'
           and (cardinality(v_types) = 0 or a.type::text = any (v_types))
      )
      select b.clinic_id, b.user_id, b.d,
             100 * (count(*) filter (where b.came = (p_indicator = 'attendance_rate')))::numeric,
             count(*)::numeric
        from b
       where b.came or b.missed
       group by 1, 2, 3;

  elsif p_indicator = 'check_ins' then
    return query
      select a.clinic_id, a.checked_in_by, (a.checked_in_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.appointments a
       where a.checked_in_at >= v_from and a.checked_in_at < v_to
         and a.clinic_id = any (p_clinic_ids)
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator = 'procedures_done' then
    return query
      select ts.clinic_id, coalesce(ts.executed_by, ts.planner_provider_id),
             (ts.done_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.treatment_sessions ts
        left join public.procedures p on p.id = ts.procedure_id
       where ts.status = 'done'
         and ts.done_at >= v_from and ts.done_at < v_to
         and ts.clinic_id = any (p_clinic_ids)
         and (cardinality(v_specialties) = 0 or p.specialty = any (v_specialties))
       group by 1, 2, 3;

  elsif p_indicator = 'provider_production' then
    -- O repasse congelado de cada sessão concluída (o mesmo do Repasse).
    return query
      select pp.clinic_id, pp.provider_id, pp.accrual_date, sum(pp.amount_cents)::numeric, null::numeric
        from public.provider_payouts pp
        left join public.procedures p on p.id = pp.procedure_id
       where pp.accrual_date between p_from and p_to
         and pp.clinic_id = any (p_clinic_ids)
         and (cardinality(v_specialties) = 0 or p.specialty = any (v_specialties))
       group by 1, 2, 3;

  elsif p_indicator = 'plan_options_approved' then
    -- Opção aprovada pelo Coordenador; o número é do Planner que montou o plano.
    return query
      select tp.clinic_id, tp.created_by, (o.reviewed_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.treatment_plan_options o
        join public.treatment_plans tp on tp.id = o.plan_id
       where o.review_status::text = 'approved'
         and o.reviewed_at >= v_from and o.reviewed_at < v_to
         and tp.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator in ('new_clients', 'new_clients_evaluated') then
    return query
      select coalesce(c.origin_clinic_id, c.clinic_id), c.created_by, (c.created_at at time zone v_tz)::date,
             count(*)::numeric, null::numeric
        from public.clients c
       where c.created_at >= v_from and c.created_at < v_to
         and coalesce(c.origin_clinic_id, c.clinic_id) = any (p_clinic_ids)
         and (cardinality(v_origins) = 0 or coalesce(c.origin_program, 'unidade') = any (v_origins))
         and (p_indicator = 'new_clients'
              or exists (select 1 from public.appointments a
                          where a.client_id = c.id and a.type::text = 'evaluation'
                            and (a.attendance::text = 'done' or a.status::text = 'completed')))
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_adhesions' then
    return query
      select m.clinic_id, m.sold_by, (m.activated_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.ppr_memberships m
       where m.activated_at >= v_from and m.activated_at < v_to
         and m.transferred_from_id is null
         and m.clinic_id = any (p_clinic_ids)
         and (cardinality(v_plans) = 0 or m.plan_id::text = any (v_plans))
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_cancellations' then
    -- Cancelamento de verdade: a adesão que virou outra (transferência) não conta.
    return query
      select m.clinic_id, null::uuid, (m.cancelled_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.ppr_memberships m
       where m.cancelled_at >= v_from and m.cancelled_at < v_to
         and m.clinic_id = any (p_clinic_ids)
         and not exists (select 1 from public.ppr_memberships n where n.transferred_from_id = m.id)
         and (cardinality(v_plans) = 0 or m.plan_id::text = any (v_plans))
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_lives' then
    -- FOTOGRAFIA: beneficiários (titulares + dependentes) de adesões ativas hoje.
    return query
      select m.clinic_id, null::uuid, v_today, count(*)::numeric, null::numeric
        from public.ppr_beneficiaries b
        join public.ppr_memberships m on m.id = b.membership_id
       where m.status = 'ativo' and b.left_at is null
         and m.clinic_id = any (p_clinic_ids)
         and (cardinality(v_plans) = 0 or m.plan_id::text = any (v_plans))
       group by 1, 2, 3;

  elsif p_indicator = 'indica_referrals' then
    return query
      select i.unidade_id, i.risartano_origem_id, (i.registrada_em at time zone v_tz)::date, count(*)::numeric, null::numeric
        from indica.indicacoes i
       where i.registrada_em >= v_from and i.registrada_em < v_to
         and i.unidade_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'indica_conversions' then
    -- A mesma régua da apuração do Indica: convertida, pela data do fechamento.
    return query
      select i.unidade_id, i.risartano_conversao_id, (i.fechou_em at time zone v_tz)::date, count(*)::numeric, null::numeric
        from indica.indicacoes i
       where i.status::text = 'convertida'
         and i.fechou_em >= v_from and i.fechou_em < v_to
         and i.unidade_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'indica_ambassadors' then
    return query
      select e.unidade_cadastro_id, e.criado_por, (e.criado_em at time zone v_tz)::date, count(*)::numeric, null::numeric
        from indica.embaixadores e
       where e.criado_em >= v_from and e.criado_em < v_to
         and e.unidade_cadastro_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'empresarial_companies' then
    -- N6: adesão = a PRIMEIRA entrada do lead em "Fechado (ganho)" no funil
    -- (a linha semeada pela migração, `is_initial`, não conta). Unidade = a
    -- principal da empresa. Número do consultor RisLife do lead.
    return query
      with ganho as (
        select h.lead_id, min(h.entered_at) as at
          from empresarial.commercial_lead_stage_history h
         where h.stage::text = 'CLOSED_WON' and not coalesce(h.is_initial, false)
         group by h.lead_id
      )
      select co.main_clinic_id, l.consultant_id, (g.at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from ganho g
        join empresarial.commercial_leads l on l.id = g.lead_id
        join empresarial.companies co on co.id = l.company_id
       where g.at >= v_from and g.at < v_to
         and co.main_clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'empresarial_lives' then
    return query
      select mh.clinic_id, null::uuid, (mh.started_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from empresarial.membership_history mh
       where mh.started_at >= v_from and mh.started_at < v_to
         and mh.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  -- ======================================================================
  -- ETAPA M3 (0320)
  -- ======================================================================
  elsif p_indicator = 'discount_avg' then
    -- O5: desconto ÷ valor de tabela das vendas de plano FECHADAS no período
    -- (a mesma conta da autorização de desconto: −ajuste ÷ subtotal).
    return query
      select cs.clinic_id, pn.consultant_id, (cs.closed_at at time zone v_tz)::date,
             100 * sum(greatest(-pn.adjustment_cents, 0))::numeric,
             sum(pn.final_cents - pn.adjustment_cents)::numeric
        from public.commercial_sales cs
        join public.plan_negotiations pn on pn.id = cs.negotiation_id
       where cs.closed_at >= v_from and cs.closed_at < v_to
         and cs.cancelled_at is null
         and cs.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'sales_cancelled' then
    -- LIMITE: vendas de plano e diretas canceladas no período.
    return query
      with c as (
        select cs.clinic_id, cs.cancelled_at as at
          from public.commercial_sales cs
         where cs.cancelled_at >= v_from and cs.cancelled_at < v_to
           and cs.clinic_id = any (p_clinic_ids)
        union all
        select ds.clinic_id, ds.cancelled_at
          from public.direct_sales ds
         where ds.cancelled_at >= v_from and ds.cancelled_at < v_to
           and ds.clinic_id = any (p_clinic_ids)
      )
      select c.clinic_id, null::uuid, (c.at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from c
       group by 1, 2, 3;

  elsif p_indicator = 'net_margin' then
    -- A mesma conta da tela DRE (`buildDre`/`netMarginPercent`): lucro líquido
    -- (todos os blocos menos "fora") ÷ receita líquida. O4: ponderado.
    return query
      select c.id, null::uuid, p_to,
             100 * coalesce(sum(d.amount_cents) filter (where d.block <> 'fora'), 0)::numeric,
             coalesce(sum(d.amount_cents) filter (where d.block in ('receita_bruta', 'deducoes')), 0)::numeric
        from unnest(p_clinic_ids) as c (id)
        left join lateral public._dre_lines_raw(c.id, p_from, p_to) d on true
       group by 1, 2, 3
      having coalesce(sum(d.amount_cents) filter (where d.block in ('receita_bruta', 'deducoes')), 0) <> 0;

  elsif p_indicator in ('contribution_margin', 'breakeven_reached') then
    -- A mesma conta da tela Ponto de equilíbrio (`buildBreakeven`):
    --   receita líquida = receita + deduções; margem = líquida + variáveis;
    --   custo fixo = −(fixos + depreciação + receita financeira) [caixa: sem
    --   depreciação]; ponto = custo fixo ÷ (margem ÷ líquida).
    -- O1: "% do ponto atingido" = receita líquida ÷ ponto.
    return query
      with p as (
        select c.id as clinic_id,
               coalesce(sum(b.amount_cents) filter (where b.role in ('receita', 'deducao')), 0)::numeric as rl,
               coalesce(sum(b.amount_cents) filter (where b.role in ('receita', 'deducao', 'variavel')), 0)::numeric as mc,
               (-coalesce(sum(b.amount_cents) filter (where b.role in ('fixo', 'receita_financeira')), 0)
                - case when coalesce(v_f ->> 'breakeven_view', '') = 'cash' then 0
                       else coalesce(sum(b.amount_cents) filter (where b.role = 'depreciacao'), 0) end)::numeric as cf
          from unnest(p_clinic_ids) as c (id)
          left join lateral public.breakeven_lines_raw(c.id, p_from, p_to, null) b on true
         group by c.id
      )
      select p.clinic_id, null::uuid, p_to,
             case when p_indicator = 'contribution_margin' then 100 * p.mc else 100 * p.rl end,
             case when p_indicator = 'contribution_margin' then p.rl
                  else round(p.cf / (p.mc / p.rl)) end
        from p
       where p.rl > 0
         and (p_indicator = 'contribution_margin' or (p.mc > 0 and p.cf > 0));

  elsif p_indicator = 'on_time_payment' then
    -- Das parcelas que VENCERAM no período (data efetiva, com o prazo da
    -- adquirente) e até ontem: quantas % foram pagas até o vencimento.
    return query
      select i.clinic_id, null::uuid, coalesce(i.expected_settlement_date, i.due_date),
             100 * (count(*) filter (where i.status = 'paga' and i.paid_at is not null
                                       and (i.paid_at at time zone v_tz)::date
                                           <= coalesce(i.expected_settlement_date, i.due_date)))::numeric,
             count(*)::numeric
        from public.payment_installments i
       where coalesce(i.expected_settlement_date, i.due_date) between p_from and least(p_to, v_today - 1)
         and i.status not in ('cancelada', 'renegociada')
         and i.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'treatments_completed' then
    -- Clientes que entraram na Fase 6 (reavaliação) no período.
    return query
      select h.clinic_id, null::uuid, (h.entered_at at time zone v_tz)::date,
             count(distinct h.client_id)::numeric, null::numeric
        from public.journey_phase_history h
       where h.phase::text = 'reevaluation'
         and h.entered_at >= v_from and h.entered_at < v_to
         and h.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'journey_conversion' then
    -- Dos clientes AVALIADOS no período (avaliação concluída), quantos % já
    -- fecharam venda de plano (em qualquer data, sem cancelamento).
    return query
      with av as (
        select a.client_id, a.clinic_id,
               min((coalesce(a.done_at, a.ends_at) at time zone v_tz)::date) as d
          from public.appointments a
         where a.type::text = 'evaluation'
           and (a.attendance::text = 'done' or a.status::text = 'completed')
           and coalesce(a.done_at, a.ends_at) >= v_from and coalesce(a.done_at, a.ends_at) < v_to
           and a.clinic_id = any (p_clinic_ids)
         group by a.client_id, a.clinic_id
      )
      select av.clinic_id, null::uuid, av.d,
             100 * (count(*) filter (where exists (
               select 1 from public.commercial_sales cs
                where cs.client_id = av.client_id and cs.closed_at is not null and cs.cancelled_at is null)))::numeric,
             count(*)::numeric
        from av
       group by 1, 2, 3;

  elsif p_indicator = 'reactivated_clients' then
    -- O3: atendido no período cujo atendimento concluído ANTERIOR foi há mais
    -- de N dias — N = "dias sem atendimento" (inactivity_settings, cascata).
    return query
      with feitos as (
        select a.client_id, a.clinic_id, coalesce(a.done_at, a.ends_at) as at
          from public.appointments a
         where (a.attendance::text = 'done' or a.status::text = 'completed')
      ),
      no_periodo as (
        select f.client_id, f.clinic_id, min(f.at) as at
          from feitos f
         where f.at >= v_from and f.at < v_to and f.clinic_id = any (p_clinic_ids)
         group by f.client_id, f.clinic_id
      )
      select np.clinic_id, null::uuid, (np.at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from no_periodo np
        cross join lateral (
          select max(f.at) as anterior from feitos f where f.client_id = np.client_id and f.at < np.at
        ) ant
        cross join lateral (
          select coalesce(
                   (select s.value_days from public.inactivity_settings s
                     where s.setting_key = 'no_attendance_days' and s.clinic_id = np.clinic_id),
                   (select s.value_days from public.inactivity_settings s
                     where s.setting_key = 'no_attendance_days' and s.clinic_id is null),
                   365) as dias
        ) n
       where ant.anterior is not null
         and ant.anterior < np.at - make_interval(days => n.dias)
       group by 1, 2, 3;

  elsif p_indicator = 'certifications' then
    -- O7: certificados emitidos no período (portão de certificação).
    return query
      select tc.clinic_id, tc.user_id, (tc.certified_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.training_certifications tc
       where tc.certified_at >= v_from and tc.certified_at < v_to
         and tc.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'reports_sent' then
    -- O7: relatos de problema e sugestões registrados.
    return query
      select r.clinic_id, r.reporter_id, (r.created_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.system_reports r
       where r.created_at >= v_from and r.created_at < v_to
         and r.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator in ('chair_occupancy', 'chair_idle_hours') then
    -- O2: MEDIDOS NO CÓDIGO, pela mesma conta do Planejamento Anual
    -- (`src/lib/horas-da-agenda.ts` — 7 fontes e a conta de intervalos).
    -- O banco não tem essa conta; o servidor mede e grava o resultado final
    -- por `goal_record_app_final`. Aqui não sai linha nenhuma, de propósito.
    return;

  else
    raise exception 'GOAL_UNKNOWN_INDICATOR';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) GRAVAR: meta medida no código só no período inteiro, e não vira marco
-- -----------------------------------------------------------------------------
create or replace function public.goal_save(p_goal_id uuid, p_data jsonb, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date := public.today_br();
  g public.goals;
  v_id uuid := p_goal_id;
  v_scope text := p_data ->> 'scope';
  v_clinics uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'clinic_ids', '[]'::jsonb)) as t (x));
  v_meta record;
  v_before jsonb;
  v_after jsonb;
  v_starts date := (p_data ->> 'starts_on')::date;
  v_ends date := (p_data ->> 'ends_on')::date;
  v_direction text := coalesce(p_data ->> 'direction', 'increase');
  r jsonb;
  i int := 0;
begin
  if v_user is null then raise exception 'GOAL_NOT_ALLOWED'; end if;
  if v_scope = 'network' then v_clinics := '{}'; end if;
  if nullif(trim(coalesce(p_data ->> 'name', '')), '') is null then raise exception 'GOAL_NAME_REQUIRED'; end if;
  select * into v_meta from public._goal_indicator_meta(p_data ->> 'indicator') m;
  if v_meta.kind is null then raise exception 'GOAL_UNKNOWN_INDICATOR'; end if;
  if v_starts is null or v_ends is null or v_ends < v_starts then raise exception 'GOAL_BAD_PERIOD'; end if;
  if v_meta.kind = 'sum' and v_direction <> 'increase' and not v_meta.can_decrease then
    raise exception 'GOAL_BAD_DIRECTION';
  end if;
  if v_meta.kind = 'sum' and v_meta.can_decrease and v_direction <> 'decrease' then
    raise exception 'GOAL_BAD_DIRECTION';
  end if;
  if v_meta.kind <> 'sum' and p_data ->> 'individual_rule' = 'split' then raise exception 'GOAL_RATE_SPLIT'; end if;
  if v_meta.kind = 'point' and coalesce(p_data ->> 'periodicity', 'whole') <> 'whole' then
    raise exception 'GOAL_POINT_MONTHLY';
  end if;
  if v_meta.in_app and coalesce(p_data ->> 'periodicity', 'whole') <> 'whole' then
    raise exception 'GOAL_APP_MONTHLY';
  end if;
  if not v_meta.per_person and coalesce(p_data ->> 'target_mode', 'collective') <> 'collective' then
    raise exception 'GOAL_NOT_PER_PERSON';
  end if;
  if v_scope = 'clinics' and exists (
       select 1 from unnest(v_clinics) as c (id)
        where not exists (select 1 from public.clinics k where k.id = c.id and k.type = 'franchise_unit')) then
    raise exception 'GOAL_BAD_CLINIC';
  end if;
  if not public._goal_can_create(v_scope, v_clinics) then raise exception 'GOAL_NOT_ALLOWED'; end if;

  if v_id is null then
    insert into public.goals (name, indicator, filters, scope, clinic_ids, starts_on, ends_on, created_by)
    values (trim(p_data ->> 'name'), p_data ->> 'indicator', coalesce(p_data -> 'filters', '{}'::jsonb),
            v_scope, v_clinics, v_starts, v_ends, v_user)
    returning id into v_id;
    select * into g from public.goals where id = v_id;
  else
    select * into g from public.goals where id = v_id for update;
    if not found then raise exception 'GOAL_NOT_FOUND'; end if;
    if not public._goal_can_create(g.scope, g.clinic_ids) then raise exception 'GOAL_NOT_ALLOWED'; end if;
    if g.status in ('finished', 'cancelled') then raise exception 'GOAL_CLOSED'; end if;
    if g.status <> 'draft' then
      if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'GOAL_REASON_REQUIRED'; end if;
      if g.indicator <> p_data ->> 'indicator'
         or g.filters <> coalesce(p_data -> 'filters', '{}'::jsonb)
         or g.scope <> v_scope
         or g.clinic_ids <> v_clinics
         or g.target_mode <> coalesce(p_data ->> 'target_mode', g.target_mode)
         or g.direction <> v_direction
         or g.periodicity <> coalesce(p_data ->> 'periodicity', g.periodicity) then
        raise exception 'GOAL_LOCKED_FIELD';
      end if;
      if g.starts_on <> v_starts and g.starts_on <= v_today then raise exception 'GOAL_STARTED'; end if;
      if v_ends < v_today then raise exception 'GOAL_END_IN_PAST'; end if;
      v_before := public._goal_export(v_id);
    end if;
  end if;

  update public.goals set
    name = trim(p_data ->> 'name'),
    indicator = p_data ->> 'indicator',
    filters = coalesce(p_data -> 'filters', '{}'::jsonb),
    scope = v_scope,
    clinic_ids = v_clinics,
    how_text = nullif(trim(coalesce(p_data ->> 'how_text', '')), ''),
    direction = v_direction,
    target_mode = coalesce(p_data ->> 'target_mode', 'collective'),
    target_value = (p_data ->> 'target_value')::numeric,
    individual_rule = nullif(p_data ->> 'individual_rule', ''),
    individual_value = (p_data ->> 'individual_value')::numeric,
    stretch_value = (p_data ->> 'stretch_value')::numeric,
    baseline_value = (p_data ->> 'baseline_value')::numeric,
    baseline_from = (p_data ->> 'baseline_from')::date,
    baseline_to = (p_data ->> 'baseline_to')::date,
    resources_text = nullif(trim(coalesce(p_data ->> 'resources_text', '')), ''),
    attainable_note = nullif(trim(coalesce(p_data ->> 'attainable_note', '')), ''),
    strategic_objective = nullif(p_data ->> 'strategic_objective', ''),
    relevance_text = nullif(trim(coalesce(p_data ->> 'relevance_text', '')), ''),
    periodicity = coalesce(p_data ->> 'periodicity', 'whole'),
    starts_on = v_starts,
    ends_on = v_ends,
    updated_by = v_user,
    updated_at = now()
  where id = v_id;

  delete from public.goal_participant_rules where goal_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'rules', '[]'::jsonb)) loop
    insert into public.goal_participant_rules (goal_id, kind, role, user_id)
    values (v_id, r ->> 'kind', (nullif(r ->> 'role', ''))::public.user_role, (nullif(r ->> 'user_id', ''))::uuid)
    on conflict do nothing;
  end loop;

  delete from public.goal_targets where goal_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'targets', '[]'::jsonb)) loop
    insert into public.goal_targets (goal_id, subject_kind, subject_id, target_value)
    values (v_id, r ->> 'subject_kind', (r ->> 'subject_id')::uuid, (r ->> 'target_value')::numeric)
    on conflict (goal_id, subject_kind, subject_id) do update set target_value = excluded.target_value;
  end loop;

  delete from public.goal_milestones where goal_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'milestones', '[]'::jsonb)) loop
    -- Marco é sempre "chegar a X até a data": só soma de aumentar.
    if not exists (select 1 from public._goal_indicator_meta(r ->> 'indicator') m
                    where m.kind = 'sum' and not m.can_decrease and not m.in_app) then
      raise exception 'GOAL_BAD_MILESTONE';
    end if;
    insert into public.goal_milestones (goal_id, position, label, indicator, filters, due_on, target_value)
    values (v_id, i, trim(r ->> 'label'), r ->> 'indicator', coalesce(r -> 'filters', '{}'::jsonb),
            (r ->> 'due_on')::date, (r ->> 'target_value')::numeric);
    i := i + 1;
  end loop;

  if v_before is not null then
    v_after := public._goal_export(v_id);
    if v_after is distinct from v_before then
      insert into public.goal_changes (goal_id, changed_by, kind, reason, before, after)
      values (v_id, v_user, 'edit', trim(p_reason), v_before, v_after);
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) A ROTINA DIÁRIA: não encerra a meta medida no código (O2)
-- -----------------------------------------------------------------------------
create or replace function public.goals_daily_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
  v_ontem date := public.today_br() - 1;
  v_started int := 0;
  v_finished int := 0;
  v_fotos int := 0;
  r record;
  m date;
begin
  -- N1: a foto de ONTEM (o estado no fim do dia) de cada meta-fotografia que
  -- estava correndo ontem — inclusive a que terminou ontem: é ela que vira o
  -- resultado final, logo abaixo.
  for r in select g.id, g.scope, g.clinic_ids, g.indicator, g.filters, g.starts_on, g.ends_on
             from public.goals g
            where g.status in ('active', 'paused', 'scheduled')
              and g.starts_on <= v_ontem and g.ends_on >= v_ontem
              and (select m.kind from public._goal_indicator_meta(g.indicator) m) = 'point' loop
    insert into public.goal_daily_values (goal_id, day, snapshot)
    values (r.id, v_ontem, public._goal_snapshot(r.id, v_ontem, v_ontem, r.indicator, r.filters))
    on conflict (goal_id, day) do nothing;
    v_fotos := v_fotos + 1;
  end loop;

  update public.goals set status = 'active', updated_at = now()
   where status = 'scheduled' and starts_on <= v_today;
  get diagnostics v_started = row_count;

  for r in select id, starts_on, ends_on from public.goals
            where periodicity = 'monthly' and status in ('active', 'paused') loop
    m := date_trunc('month', r.starts_on)::date;
    while (m + interval '1 month')::date - 1 < v_today and m <= r.ends_on loop
      perform public._goal_freeze(r.id, 'period', greatest(m, r.starts_on),
                                  least((m + interval '1 month')::date - 1, r.ends_on));
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  -- O2: meta medida no código é encerrada pelo SERVIDOR (goal_record_app_final),
  -- que tem a conta; a rotina não a congela com o zero que o banco veria.
  for r in select g.id from public.goals g
            where g.status in ('scheduled', 'active', 'paused') and g.ends_on < v_today
              and not coalesce((select m.in_app from public._goal_indicator_meta(g.indicator) m), false) loop
    perform public._goal_finish(r.id);
    v_finished := v_finished + 1;
  end loop;

  return jsonb_build_object('started', v_started, 'finished', v_finished, 'photos', v_fotos);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) O RESULTADO FINAL DA META MEDIDA NO CÓDIGO (O2) — só o servidor grava
-- -----------------------------------------------------------------------------
-- O servidor mede pela conta do Planejamento Anual e chama esta função com a
-- chave de serviço. Ela confere que a meta é mesmo medida no código e que o
-- prazo acabou, grava o resultado UMA vez e encerra a meta.
create or replace function public.goal_record_app_final(p_goal_id uuid, p_snapshot jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_value numeric;
  v_achieved boolean;
  v_stretch boolean;
begin
  select * into g from public.goals where id = p_goal_id for update;
  if not found then raise exception 'GOAL_NOT_FOUND'; end if;
  if not coalesce((select m.in_app from public._goal_indicator_meta(g.indicator) m), false) then
    raise exception 'GOAL_NOT_APP';
  end if;
  if g.status in ('finished', 'cancelled', 'draft') then return g.status; end if;
  if g.ends_on >= public.today_br() then raise exception 'GOAL_NOT_ENDED'; end if;

  v_value := public._goal_value(p_snapshot -> 'total');
  v_achieved := public._goal_achieved(g.direction, v_value, g.target_value);
  v_stretch := case when g.stretch_value is not null then public._goal_achieved(g.direction, v_value, g.stretch_value) end;
  insert into public.goal_results (goal_id, kind, period_start, period_end, snapshot, value, achieved, stretch_achieved)
  values (p_goal_id, 'final', g.starts_on, g.ends_on, p_snapshot, v_value, v_achieved, v_stretch)
  on conflict (goal_id, kind, period_start) do nothing;

  update public.goal_pauses set resumed_at = now() where goal_id = p_goal_id and resumed_at is null;
  update public.goals
     set status = 'finished',
         outcome = case when v_achieved is null then 'no_data'
                        when v_achieved and coalesce(v_stretch, false) then 'stretch'
                        when v_achieved then 'achieved'
                        else 'not_achieved' end,
         finished_at = now(),
         updated_at = now()
   where id = p_goal_id;
  return 'finished';
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) O1 — AS DUAS LEITURAS DO PONTO DE EQUILÍBRIO (R$ e atendimentos)
-- -----------------------------------------------------------------------------
-- Atendimentos necessários = custo fixo ÷ (margem ÷ atendimentos concluídos):
-- quantos atendimentos, na margem média por atendimento do período, pagam a
-- estrutura. Só para quem vê o financeiro de todas as unidades da meta.
create or replace function public.goal_breakeven_reading(p_goal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_cl uuid[];
  v_to date;
  v_out jsonb;
begin
  if (select auth.uid()) is null or not public.can_view_goal(p_goal_id) then
    raise exception 'GOAL_NOT_ALLOWED';
  end if;
  select * into g from public.goals where id = p_goal_id;
  if g.indicator <> 'breakeven_reached' then return null; end if;
  if not public._goal_sees_money(p_goal_id) then return null; end if;
  if g.starts_on > public.today_br() then return null; end if;
  v_cl := public._goal_clinic_ids(g.scope, g.clinic_ids);
  v_to := least(g.ends_on, public.today_br());

  with p as (
    select coalesce(sum(b.amount_cents) filter (where b.role in ('receita', 'deducao')), 0)::numeric as rl,
           coalesce(sum(b.amount_cents) filter (where b.role in ('receita', 'deducao', 'variavel')), 0)::numeric as mc,
           (-coalesce(sum(b.amount_cents) filter (where b.role in ('fixo', 'receita_financeira')), 0)
            - case when coalesce(g.filters ->> 'breakeven_view', '') = 'cash' then 0
                   else coalesce(sum(b.amount_cents) filter (where b.role = 'depreciacao'), 0) end)::numeric as cf
      from unnest(v_cl) as c (id)
      left join lateral public.breakeven_lines_raw(c.id, g.starts_on, v_to, null) b on true
  ),
  a as (
    select coalesce(sum(r.num), 0) as feitos
      from public._goal_measure_raw('appointments_done', '{}'::jsonb, v_cl, g.starts_on, v_to) r
  )
  select jsonb_build_object(
    'receita_liquida', p.rl,
    'margem_contribuicao', p.mc,
    'custo_fixo', p.cf,
    'ponto', case when p.rl > 0 and p.mc > 0 and p.cf > 0 then round(p.cf / (p.mc / p.rl)) end,
    'atendimentos', a.feitos,
    'atendimentos_necessarios', case when p.mc > 0 and a.feitos > 0 and p.cf > 0
                                     then ceil(p.cf / (p.mc / a.feitos)) end
  ) into v_out
  from p, a;
  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) PERMISSÕES DE EXECUÇÃO (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function public._goal_indicator_meta(text) from public, anon, authenticated;
revoke execute on function public._goal_measure_raw(text, jsonb, uuid[], date, date) from public, anon, authenticated;
revoke execute on function public.goals_daily_run() from public, anon, authenticated;
revoke execute on function public.goal_save(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.goal_save(uuid, jsonb, text) to authenticated;
revoke execute on function public.goal_record_app_final(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.goal_record_app_final(uuid, jsonb) to service_role;
revoke execute on function public.goal_breakeven_reading(uuid) from public, anon, authenticated;
grant execute on function public.goal_breakeven_reading(uuid) to authenticated;
