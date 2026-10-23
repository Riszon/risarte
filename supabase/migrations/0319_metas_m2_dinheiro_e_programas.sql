-- =============================================================================
-- 0319 — METAS SMART, ETAPA M2: DINHEIRO E PROGRAMAS
-- -----------------------------------------------------------------------------
-- Plano e decisões do dono: docs/metas/METAS-PLANO.md, §9b (N1–N7, aprovadas
-- em 23/10/2026). Continua a 0318.
--
-- O que esta migração faz:
--   1. O catálogo do banco ganha 16 indicadores e duas colunas: o tipo
--      `point` (FOTOGRAFIA — o valor de hoje, N1) e `can_decrease` (soma que
--      aceita meta de "no máximo": o LIMITE, N2). `money` passa a querer dizer
--      "dado financeiro" (D3/N7): a taxa de inadimplência entra nele.
--   2. A medição (`_goal_measure_raw`) ganha os ramos novos e o recorte por
--      ESPECIALIDADE nas vendas (N4: em R$, a parte proporcional da venda).
--   3. A fotografia diária (`goal_daily_values`, N1): a rotina guarda, toda
--      madrugada, o valor de ontem de cada meta-fotografia em andamento. O
--      resultado final é o valor do último dia do prazo.
--   4. O percentual escondido da D3 respeita a direção, o limite e a linha de
--      base (`_goal_percent`, espelho de `percentual` no código).
--   5. A inadimplência ganha a "porta" da 0282 (`_clinic_overdue_rate_raw`):
--      a conta é a mesma da tela do Financeiro; a guarda fica na porta.
--   6. `goal_save` recusa: soma "reduzir" fora dos limites; fotografia mensal;
--      meta individual em indicador sem dono por pessoa; marco que não seja
--      soma de aumentar.
--
-- Fontes conferidas no banco de treino em 23/10/2026 (ver o plano).
-- Só leitura dos schemas `indica` e `empresarial` (D7).
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A FOTOGRAFIA DIÁRIA (N1)
-- -----------------------------------------------------------------------------
create table if not exists public.goal_daily_values (
  goal_id uuid not null references public.goals (id) on delete cascade,
  day date not null,
  snapshot jsonb not null,
  measured_at timestamptz not null default now(),
  primary key (goal_id, day)
);
alter table public.goal_daily_values enable row level security;
-- Sem regra de leitura: quem lê é `goal_measure` (D3).

-- -----------------------------------------------------------------------------
-- 1b) A INADIMPLÊNCIA GANHA UMA "PORTA" (padrão da 0282)
-- -----------------------------------------------------------------------------
-- `clinic_overdue_rate` (0253) só responde para quem vê o financeiro da
-- unidade — por isso a rotina da madrugada (sem usuário) e o participante sem
-- acesso receberiam VAZIO, e a barra mostraria um número falso. A conta passa
-- a morar em `_clinic_overdue_rate_raw` (sem guarda, só para funções internas)
-- e a função de sempre vira a porta, com a MESMA guarda. Uma conta só: a tela
-- do Financeiro e as Metas leem o mesmo número. A conta é a da 0253, copiada
-- sem mudar uma linha.
create or replace function public._clinic_overdue_rate_raw(p_clinic_id uuid)
returns table (
  open_cents bigint,
  overdue_cents bigint,
  overdue_count integer,
  open_count integer,
  overdue_percent numeric,
  limit_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      i.amount_cents - coalesce(i.paid_amount_cents, 0) as falta,
      coalesce(i.expected_settlement_date, i.due_date) < public.today_br() as vencida
    from public.payment_installments i
    where i.clinic_id = p_clinic_id
      and i.status in ('em_aberto', 'parcial')
      and i.amount_cents > coalesce(i.paid_amount_cents, 0)
  ),
  somas as (
    select
      coalesce(sum(falta), 0)::bigint as aberto,
      coalesce(sum(falta) filter (where vencida), 0)::bigint as vencido,
      count(*) filter (where vencida)::integer as n_vencidas,
      count(*)::integer as n_abertas
    from base
  )
  select
    s.aberto,
    s.vencido,
    s.n_vencidas,
    s.n_abertas,
    case when s.aberto > 0
      then round((s.vencido::numeric * 100) / s.aberto, 2)
      else null
    end as overdue_percent,
    public.overdue_limit_percent(p_clinic_id) as limit_percent
  from somas s;
$$;

create or replace function public.clinic_overdue_rate(p_clinic_id uuid)
returns table (
  open_cents bigint,
  overdue_cents bigint,
  overdue_count integer,
  open_count integer,
  overdue_percent numeric,
  limit_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.open_cents, r.overdue_cents, r.overdue_count, r.open_count, r.overdue_percent, r.limit_percent
    from public._clinic_overdue_rate_raw(p_clinic_id) r
   where public.can_see_clinic_finance(p_clinic_id);
$$;

revoke execute on function public._clinic_overdue_rate_raw(uuid) from public, anon, authenticated;
revoke execute on function public.clinic_overdue_rate(uuid) from public, anon, authenticated;
grant execute on function public.clinic_overdue_rate(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) O CATÁLOGO DO BANCO (espelho de src/lib/metas/indicadores.ts)
-- -----------------------------------------------------------------------------
-- kind: 'sum' (acumula) | 'rate' (num/den do período) | 'point' (fotografia).
-- per_person: a meta individual faz sentido. money: dado financeiro (D3).
-- can_decrease: soma que aceita meta de "no máximo" (limite).
-- ⚠️ A régua `metas-catalogo.test.ts` lê a lista entre as marcas abaixo.
drop function if exists public._goal_indicator_meta(text);
create or replace function public._goal_indicator_meta(p_indicator text)
returns table (kind text, per_person boolean, money boolean, can_decrease boolean)
language sql
immutable
set search_path = ''
as $$
  select m.kind, m.per_person, m.money, m.can_decrease
    from (values
      -- INDICADORES:INICIO
      ('sales_value',            'sum',   true,  true,  false),
      ('sales_count',            'sum',   true,  false, false),
      ('sales_ticket',           'rate',  true,  true,  false),
      ('conversion_rate',        'rate',  true,  false, false),
      ('revenue_received',       'sum',   false, true,  false),
      ('revenue_billed',         'sum',   false, true,  false),
      ('overdue_rate',           'point', false, true,  false),
      ('overdue_value',          'point', false, true,  false),
      ('overdue_recovery',       'sum',   false, true,  false),
      ('appointments_created',   'sum',   true,  false, false),
      ('appointments_done',      'sum',   true,  false, false),
      ('evaluations_done',       'sum',   true,  false, false),
      ('attendance_rate',        'rate',  true,  false, false),
      ('no_show_rate',           'rate',  true,  false, false),
      ('check_ins',              'sum',   true,  false, false),
      ('returns_scheduled',      'sum',   true,  false, false),
      ('procedures_done',        'sum',   true,  false, false),
      ('provider_production',    'sum',   true,  true,  false),
      ('plan_options_approved',  'sum',   true,  false, false),
      ('new_clients',            'sum',   true,  false, false),
      ('new_clients_evaluated',  'sum',   true,  false, false),
      ('ppr_adhesions',          'sum',   true,  false, false),
      ('ppr_cancellations',      'sum',   false, false, true),
      ('ppr_lives',              'point', false, false, false),
      ('indica_referrals',       'sum',   true,  false, false),
      ('indica_conversions',     'sum',   true,  false, false),
      ('indica_ambassadors',     'sum',   true,  false, false),
      ('empresarial_companies',  'sum',   true,  false, false),
      ('empresarial_lives',      'sum',   false, false, false)
      -- INDICADORES:FIM
    ) as m (indicator, kind, per_person, money, can_decrease)
   where m.indicator = p_indicator;
$$;

-- -----------------------------------------------------------------------------
-- 3) A MEDIÇÃO — uma consulta por indicador (interna, sem guarda)
-- -----------------------------------------------------------------------------
-- Devolve (unidade, pessoa, dia, num, den). Taxa em % já vem com num × 100.
-- FOTOGRAFIA ignora o período: devolve o valor de HOJE, com dia = hoje.
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
             coalesce((select sum(d.amount_cents) from public.dre_lines(c.id, p_from, p_to) d
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

  else
    raise exception 'GOAL_UNKNOWN_INDICATOR';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) O PERCENTUAL (espelho de `percentual` em src/lib/metas/regras.ts)
-- -----------------------------------------------------------------------------
-- LIMITE (soma + reduzir): o percentual é o USO do limite (valor ÷ limite).
create or replace function public._goal_percent(
  p_direction text, p_kind text, p_value numeric, p_target numeric, p_base numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_target is null then null
    when p_kind = 'sum' and p_direction = 'decrease' then
      case when p_target = 0 then case when p_value > 0 then 999 else 0 end
           else p_value / p_target * 100 end
    when p_direction = 'increase' then
      case when p_target = 0 then case when p_value > 0 then 100 else 0 end
           else p_value / p_target * 100 end
    when p_base is not null and p_base > p_target then greatest(0, (p_base - p_value) / (p_base - p_target) * 100)
    when p_value <= p_target then 100
    when p_value = 0 then 100
    else p_target / p_value * 100
  end;
$$;

-- O alvo de uma pessoa / unidade: taxa e fotografia não se dividem.
create or replace function public._goal_subject_target(
  p_goal public.goals, p_subject_kind text, p_subject_id uuid, p_n integer
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.target_value from public.goal_targets t
      where t.goal_id = p_goal.id and t.subject_kind = p_subject_kind and t.subject_id = p_subject_id),
    case
      when p_subject_kind = 'user' and p_goal.individual_rule = 'same' then p_goal.individual_value
      when (select m.kind from public._goal_indicator_meta(p_goal.indicator) m) <> 'sum' then
        case when p_subject_kind = 'user' then p_goal.individual_value else p_goal.target_value end
      when p_n > 0 then p_goal.target_value / p_n
      else null
    end);
$$;

-- -----------------------------------------------------------------------------
-- 5) O RESULTADO: a fotografia usa o valor guardado do dia, quando houver
-- -----------------------------------------------------------------------------
create or replace function public._goal_snapshot(
  p_goal_id uuid,
  p_from date,
  p_to date,
  p_indicator text default null,
  p_filters jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_ind text;
  v_cl uuid[];
  v_parts uuid[];
  v_restrict boolean;
  v_kind text;
  v_out jsonb;
  v_guardado jsonb;
  v_dias jsonb;
begin
  select * into g from public.goals where id = p_goal_id;
  if not found then return null; end if;
  v_ind := coalesce(p_indicator, g.indicator);
  select m.kind into v_kind from public._goal_indicator_meta(v_ind) m;
  v_cl := public._goal_clinic_ids(g.scope, g.clinic_ids);
  select coalesce(array_agg(p.user_id), '{}'::uuid[]) into v_parts from public._goal_participants(p_goal_id) p;
  v_restrict := coalesce((select m.per_person from public._goal_indicator_meta(v_ind) m), false)
                and not exists (select 1 from public.goal_participant_rules r
                                 where r.goal_id = p_goal_id and r.kind = 'all');

  -- FOTOGRAFIA de um dia que já passou: o valor guardado naquele dia (N1).
  if v_kind = 'point' and p_indicator is null and p_to < public.today_br() then
    select d.snapshot into v_guardado
      from public.goal_daily_values d where d.goal_id = p_goal_id and d.day = p_to;
  end if;

  if v_guardado is not null then
    v_out := v_guardado;
  else
    with raw as (
      select * from public._goal_measure_raw(v_ind, coalesce(p_filters, g.filters), v_cl, p_from, p_to)
    ),
    f as (
      select * from raw where not v_restrict or raw.user_id = any (v_parts)
    )
    select jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'kind', v_kind,
      'n_clinics', cardinality(v_cl),
      'n_participants', cardinality(v_parts),
      'restricted', v_restrict,
      'total', (select jsonb_build_object('num', coalesce(sum(f.num), 0), 'den', sum(f.den)) from f),
      'by_clinic', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.clinic_id, 'num', x.n, 'den', x.d))
          from (select f.clinic_id, sum(f.num) as n, sum(f.den) as d from f group by f.clinic_id) x), '[]'::jsonb),
      'by_user', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.user_id, 'num', x.n, 'den', x.d))
          from (select f.user_id, sum(f.num) as n, sum(f.den) as d
                  from f where f.user_id = any (v_parts) group by f.user_id) x), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', x.day, 'num', x.n, 'den', x.d) order by x.day)
          from (select f.day, sum(f.num) as n, sum(f.den) as d from f group by f.day) x), '[]'::jsonb)
    ) into v_out;
  end if;

  -- FOTOGRAFIA: a evolução vem das fotos guardadas (mais a de hoje, ao vivo).
  if v_kind = 'point' and p_indicator is null then
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'num', d.snapshot -> 'total' -> 'num',
                                                 'den', d.snapshot -> 'total' -> 'den') order by d.day), '[]'::jsonb)
      into v_dias
      from public.goal_daily_values d
     where d.goal_id = p_goal_id and d.day between p_from and p_to and d.day < public.today_br();
    if p_to >= public.today_br() and v_guardado is null then
      v_dias := v_dias || jsonb_build_array(jsonb_build_object(
                  'day', public.today_br(), 'num', v_out -> 'total' -> 'num', 'den', v_out -> 'total' -> 'den'));
    end if;
    v_out := jsonb_set(v_out, '{by_day}', v_dias);
    v_out := jsonb_set(v_out, '{from}', to_jsonb(p_from));
    v_out := jsonb_set(v_out, '{to}', to_jsonb(p_to));
  end if;
  return v_out;
end;
$$;

-- D3/N7: troca valores por percentual para quem não vê o financeiro. O
-- próprio número da pessoa continua visível para ela; a linha da unidade cujo
-- dinheiro a pessoa já vê continua em valor.
drop function if exists public._goal_hide_money(public.goals, jsonb, numeric);
create or replace function public._goal_hide_money(
  p_goal public.goals, p_snap jsonb, p_target numeric, p_direction text, p_base numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_kind text := p_snap ->> 'kind';
  v_out jsonb := p_snap;
begin
  if p_snap is null then return null; end if;
  v_out := jsonb_set(v_out, '{total}', jsonb_build_object('pct',
             round(public._goal_percent(p_direction, v_kind, public._goal_value(p_snap -> 'total'), p_target, p_base), 1)));
  v_out := jsonb_set(v_out, '{by_clinic}', coalesce((
    select jsonb_agg(case
           when coalesce(public.can_see_clinic_finance((e ->> 'id')::uuid), false)
             or public.has_role_in_clinic((e ->> 'id')::uuid, array['unit_manager', 'franchisee']::public.user_role[])
           then e
           else jsonb_build_object('id', e ->> 'id', 'pct',
             round(public._goal_percent(p_direction, v_kind, public._goal_value(e),
                     public._goal_subject_target(p_goal, 'clinic', (e ->> 'id')::uuid, (p_snap ->> 'n_clinics')::int),
                     p_base), 1)) end)
      from jsonb_array_elements(p_snap -> 'by_clinic') e), '[]'::jsonb));
  v_out := jsonb_set(v_out, '{by_user}', coalesce((
    select jsonb_agg(case when (e ->> 'id')::uuid = v_me then e
           else jsonb_build_object('id', e ->> 'id', 'pct',
             round(public._goal_percent(p_direction, v_kind, public._goal_value(e),
                     public._goal_subject_target(p_goal, 'user', (e ->> 'id')::uuid, (p_snap ->> 'n_participants')::int),
                     null), 1)) end)
      from jsonb_array_elements(p_snap -> 'by_user') e), '[]'::jsonb));
  v_out := jsonb_set(v_out, '{by_day}', case
    when v_kind = 'sum' and p_target > 0 then coalesce((
      select jsonb_agg(jsonb_build_object('day', e ->> 'day', 'pct', round((e ->> 'num')::numeric / p_target * 100, 2)))
        from jsonb_array_elements(p_snap -> 'by_day') e), '[]'::jsonb)
    when v_kind = 'point' then coalesce((
      select jsonb_agg(jsonb_build_object('day', e ->> 'day', 'pct',
               round(public._goal_percent(p_direction, v_kind, public._goal_value(e), p_target, p_base), 2)))
        from jsonb_array_elements(p_snap -> 'by_day') e), '[]'::jsonb)
    else '[]'::jsonb end);
  return v_out || jsonb_build_object('money_hidden', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) A PORTA DE LEITURA (mesma de antes, com a D3 ampliada)
-- -----------------------------------------------------------------------------
create or replace function public.goal_measure(p_goal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_today date := public.today_br();
  v_from date;
  v_to date;
  v_money boolean;
  v_sees boolean;
  v_sees_any boolean;
  v_live jsonb;
  v_frozen jsonb;
  v_marcos jsonb;
begin
  if (select auth.uid()) is null or not public.can_view_goal(p_goal_id) then
    raise exception 'GOAL_NOT_ALLOWED';
  end if;
  select * into g from public.goals where id = p_goal_id;
  v_money := coalesce((select m.money from public._goal_indicator_meta(g.indicator) m), false);
  v_sees_any := public._goal_sees_money(p_goal_id);
  v_sees := not v_money or v_sees_any;

  if g.status <> 'cancelled'
     and not exists (select 1 from public.goal_results r where r.goal_id = p_goal_id and r.kind = 'final')
     and g.starts_on <= v_today then
    v_to := least(g.ends_on, v_today);
    v_from := case when g.periodicity = 'monthly'
                   then greatest(g.starts_on, date_trunc('month', v_to)::date)
                   else g.starts_on end;
    v_live := public._goal_snapshot(p_goal_id, v_from, v_to);
    if not v_sees then
      v_live := public._goal_hide_money(g, v_live, g.target_value, g.direction, g.baseline_value);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', r.kind, 'from', r.period_start, 'to', r.period_end,
           'achieved', r.achieved, 'stretch', r.stretch_achieved,
           'people_achieved', r.people_achieved, 'people_total', r.people_total,
           'measured_at', r.measured_at,
           'snapshot', case when v_sees then r.snapshot
                            else public._goal_hide_money(g, r.snapshot, g.target_value, g.direction, g.baseline_value) end)
         order by r.kind desc, r.period_start), '[]'::jsonb)
    into v_frozen
    from public.goal_results r where r.goal_id = p_goal_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ms.id,
           'snapshot', case
             when g.starts_on > v_today or g.status = 'cancelled' then null
             when not coalesce((select m.money from public._goal_indicator_meta(ms.indicator) m), false) or v_sees_any
               then public._goal_snapshot(p_goal_id, g.starts_on, least(ms.due_on, v_today), ms.indicator, ms.filters)
             else public._goal_hide_money(g,
                    public._goal_snapshot(p_goal_id, g.starts_on, least(ms.due_on, v_today), ms.indicator, ms.filters),
                    ms.target_value, 'increase', null) end)
         order by ms.position), '[]'::jsonb)
    into v_marcos
    from public.goal_milestones ms where ms.goal_id = p_goal_id;

  return jsonb_build_object(
    'today', v_today,
    'money_hidden', not v_sees,
    'live', v_live,
    'frozen', v_frozen,
    'milestones', v_marcos);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) GRAVAR: as recusas novas
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
                    where m.kind = 'sum' and not m.can_decrease) then
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
-- 8) A ROTINA DIÁRIA: guarda a fotografia de ontem antes de congelar
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

  for r in select id from public.goals
            where status in ('scheduled', 'active', 'paused') and ends_on < v_today loop
    perform public._goal_finish(r.id);
    v_finished := v_finished + 1;
  end loop;

  return jsonb_build_object('started', v_started, 'finished', v_finished, 'photos', v_fotos);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) PERMISSÕES DE EXECUÇÃO (AP15) e AUDITORIA
-- -----------------------------------------------------------------------------
revoke execute on function public._goal_indicator_meta(text) from public, anon, authenticated;
revoke execute on function public._goal_measure_raw(text, jsonb, uuid[], date, date) from public, anon, authenticated;
revoke execute on function public._goal_percent(text, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public._goal_subject_target(public.goals, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public._goal_snapshot(uuid, date, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public._goal_hide_money(public.goals, jsonb, numeric, text, numeric) from public, anon, authenticated;
revoke execute on function public.goals_daily_run() from public, anon, authenticated;
revoke execute on function public.goal_measure(uuid) from public, anon, authenticated;
grant execute on function public.goal_measure(uuid) to authenticated;
revoke execute on function public.goal_save(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.goal_save(uuid, jsonb, text) to authenticated;

insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'goal_daily_values', 'Fotografia derivada (valor do dia guardado pela rotina diária).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();
