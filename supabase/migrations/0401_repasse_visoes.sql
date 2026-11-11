-- =============================================================================
-- 0401 — REPASSE DOS DENTISTAS, ETAPA 5: AS VISÕES
--
-- Plano e decisões do dono: docs/Financeiro/REPASSE-PLANO.md. Desta etapa
-- (11/11/2026, as seis como recomendado):
--   V1) PRODUÇÃO = o valor VENDIDO do procedimento: o preço no plano com o
--       desconto da negociação repartido (final ÷ subtotal da negociação
--       aceita); na venda direta, o valor final do item;
--   V2) conta pelo MÊS EM QUE O PROCEDIMENTO FOI FINALIZADO (competência,
--       como a DRE e o relatório de repasse);
--   V3) Franqueadora vê tudo; Gerente e franqueado, a própria unidade; o
--       DENTISTA vê só a evolução do próprio repasse, sem a produção;
--   V4) comparar dentistas lado a lado só para Franqueadora e Gerente, sem
--       ranking;
--   V5) Ortodontia: o repasse aparece; a produção "não se aplica" (nulo);
--   V6) planilha no histórico e no consolidado; impressão na página do
--       dentista.
--
-- SÓ LEITURA. Nenhuma tabela nova, nenhuma regra de pagamento muda. As linhas
-- saem de `provider_payouts`, classificadas por uma conta só
-- (`_payout_lines`), e as três portas somam essa mesma conta:
--   • payout_history          — a unidade, mês a mês e dentista a dentista;
--   • payout_network_summary  — a rede, unidade a unidade (Franqueadora);
--   • my_payout_evolution     — o dentista, o próprio repasse (sem produção).
--
-- AS REGRAS DA CONTA (as mesmas das etapas 1–4B):
--   • REPASSE = o repasse positivo apurado no mês. Fica de fora o que não vai
--     ser pago: "sem repasse", "não pagar" e o anulado por falha que não
--     chegou a ser pago (`nao_pagar`). O anulado por falha que JÁ entrou em
--     relatório continua contando: ele é corrigido pela linha de desconto.
--   • DESCONTO = as linhas negativas (falha do dentista), no mês da decisão.
--   • PRODUÇÃO = só dos repasses vivos (o anulado por falha não produziu; quem
--     refez, sim). Nula quando não se aplica (Ortodontia, desconto) ou quando
--     não há preço para ler.
--   • PAGO = no fechamento antigo, ou numa conta do repasse paga ou
--     compensada. PROGRAMADO = numa conta ainda não paga. O resto espera
--     (em relatório ou fora dele).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A conta de cada linha (interna)
-- -----------------------------------------------------------------------------
drop function if exists public._payout_lines(uuid[], date, date, uuid);
create function public._payout_lines(
  p_clinic_ids uuid[], p_from date, p_to date, p_provider_id uuid default null
)
returns table (
  payout_id uuid,
  clinic_id uuid,
  provider_id uuid,
  month date,
  kind text,
  amount_cents bigint,
  produced_cents bigint,
  state text,
  due_date date,
  voided boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select p.*,
           date_trunc('month', p.accrual_date)::date as mes,
           (select f.outcome from public.payout_failures f
             where f.payout_id = p.id and f.status = 'falha' limit 1) as falha
      from public.provider_payouts p
     where p.clinic_id = any (coalesce(p_clinic_ids, array[]::uuid[]))
       and (p_provider_id is null or p.provider_id = p_provider_id)
       and p.accrual_date >= date_trunc('month', p_from)::date
       and p.accrual_date < (date_trunc('month', p_to) + interval '1 month')::date
  ),
  classe as (
    select b.*,
           case
             when b.failure_id is not null then 'desconto'
             when b.no_payout or b.withheld or b.amount_cents <= 0 then 'nao_pagar'
             when b.failure_voided_at is not null and b.falha = 'nao_pagar' then 'nao_pagar'
             when b.ortho_maintenance_id is not null then 'ortodontia'
             else 'repasse'
           end as tipo
      from base b
  ),
  pagamento as (
    select c.id,
           case
             when c.closing_id is not null then 'pago'
             when pp.id is not null and pp.payable_id is null then 'pago'
             when pa.status = 'paga' then 'pago'
             when pp.id is not null then 'programado'
             when i.id is not null then 'em_relatorio'
             else 'fora'
           end as situacao,
           pa.due_date as vencimento
      from classe c
      left join public.payout_report_items i
        on i.payout_id = c.id and i.active and i.status = 'incluido'
      left join public.payout_payments pp
        on pp.id = i.payment_id and pp.status = 'ativa'
      left join public.payables pa on pa.id = pp.payable_id
  )
  select c.id, c.clinic_id, c.provider_id, c.mes, c.tipo,
         case when c.tipo = 'nao_pagar' then 0 else c.amount_cents end::bigint,
         -- V1/V5: a produção.
         case
           when c.tipo <> 'repasse' or c.failure_voided_at is not null then null
           when ti.id is not null then round(
             ti.unit_price_cents::numeric
             * greatest(coalesce(c.units, 1), 1)
             * coalesce(c.sessions_done::numeric / nullif(c.sessions_total, 0), 1)
             * coalesce((select n.final_cents::numeric / nullif(n.subtotal_cents, 0)
                           from public.plan_negotiations n
                          where n.plan_id = s.plan_id and n.status = 'aceita'
                          limit 1), 1))
           when di.id is not null then round(di.final_cents::numeric / greatest(di.quantity, 1))
           else null
         end::bigint,
         pg.situacao,
         pg.vencimento,
         c.failure_voided_at is not null
    from classe c
    join pagamento pg on pg.id = c.id
    left join public.treatment_sessions s on s.id = c.session_id
    left join public.treatment_plan_option_items ti on ti.id = s.item_id
    left join lateral (
      select d.* from public.direct_sale_items d
       where s.item_id is null and d.session_id = s.id
       limit 1
    ) di on true;
$$;
revoke execute on function public._payout_lines(uuid[], date, date, uuid) from public, anon, authenticated;

-- Período pedido: começo ≤ fim e no máximo 36 meses (a tela pede 12).
create or replace function public._payout_period_ok(p_from date, p_to date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from is not null and p_to is not null and p_from <= p_to
     and p_to < (date_trunc('month', p_from) + interval '36 months')::date;
$$;
revoke execute on function public._payout_period_ok(date, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A UNIDADE, mês a mês e dentista a dentista (V3/V4: quem vê o financeiro
--    da unidade — Franqueadora, Gerente, franqueado)
-- -----------------------------------------------------------------------------
drop function if exists public.payout_history(uuid, date, date, uuid);
create function public.payout_history(
  p_clinic_id uuid, p_from date, p_to date, p_provider_id uuid default null
)
returns table (
  month date,
  provider_id uuid,
  provider_name text,
  level_name text,
  procedures integer,
  produced_cents bigint,
  produced_missing integer,
  ortho_count integer,
  payout_cents bigint,
  discount_cents bigint,
  paid_cents bigint,
  scheduled_cents bigint,
  waiting_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_clinic_id is null
     or not (p_clinic_id in (select public.finance_visible_clinic_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not public._payout_period_ok(p_from, p_to) then raise exception 'INVALID_PERIOD'; end if;

  return query
  select l.month, l.provider_id, pr.full_name, lv.name,
         (count(*) filter (where l.kind in ('repasse', 'ortodontia')))::integer,
         coalesce(sum(l.produced_cents), 0)::bigint,
         (count(*) filter (where l.kind = 'repasse' and l.produced_cents is null and not l.voided))::integer,
         (count(*) filter (where l.kind = 'ortodontia'))::integer,
         coalesce(sum(l.amount_cents) filter (where l.kind in ('repasse', 'ortodontia')), 0)::bigint,
         coalesce(sum(l.amount_cents) filter (where l.kind = 'desconto'), 0)::bigint,
         coalesce(sum(l.amount_cents) filter (where l.state = 'pago' and l.kind <> 'nao_pagar'), 0)::bigint,
         coalesce(sum(l.amount_cents) filter (where l.state = 'programado' and l.kind <> 'nao_pagar'), 0)::bigint,
         coalesce(sum(l.amount_cents) filter (where l.state in ('em_relatorio', 'fora') and l.kind <> 'nao_pagar'), 0)::bigint
    from public._payout_lines(array[p_clinic_id], p_from, p_to, p_provider_id) l
    left join public.profiles pr on pr.id = l.provider_id
    left join public.user_clinic_roles_all u
      on u.user_id = l.provider_id and u.clinic_id = p_clinic_id
    left join public.career_levels lv on lv.id = u.career_level_id
   group by l.month, l.provider_id, pr.full_name, lv.name
   having count(*) filter (where l.kind <> 'nao_pagar') > 0
   order by l.month, pr.full_name;
end;
$$;
revoke execute on function public.payout_history(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.payout_history(uuid, date, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A REDE, unidade a unidade (só a Franqueadora)
-- -----------------------------------------------------------------------------
drop function if exists public.payout_network_summary(date, date);
create function public.payout_network_summary(p_from date, p_to date)
returns table (
  clinic_id uuid,
  clinic_name text,
  ownership text,
  dentists integer,
  procedures integer,
  produced_cents bigint,
  payout_cents bigint,
  discount_cents bigint,
  paid_cents bigint,
  scheduled_cents bigint,
  waiting_cents bigint,
  overdue_cents bigint,
  open_failures integer,
  reports_in_review integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  if not public._payout_period_ok(p_from, p_to) then raise exception 'INVALID_PERIOD'; end if;

  select array_agg(c.id) into v_ids
    from public.clinics c
   where c.is_active and c.type <> 'franchisor'
     and c.id in (select public.finance_visible_clinic_ids());

  return query
  with l as (
    select * from public._payout_lines(v_ids, p_from, p_to, null)
  )
  select c.id, c.name, c.ownership::text,
         (select count(distinct x.provider_id) from l x
           where x.clinic_id = c.id and x.kind in ('repasse', 'ortodontia'))::integer,
         (select count(*) from l x
           where x.clinic_id = c.id and x.kind in ('repasse', 'ortodontia'))::integer,
         coalesce((select sum(x.produced_cents) from l x where x.clinic_id = c.id), 0)::bigint,
         coalesce((select sum(x.amount_cents) from l x
                    where x.clinic_id = c.id and x.kind in ('repasse', 'ortodontia')), 0)::bigint,
         coalesce((select sum(x.amount_cents) from l x
                    where x.clinic_id = c.id and x.kind = 'desconto'), 0)::bigint,
         coalesce((select sum(x.amount_cents) from l x
                    where x.clinic_id = c.id and x.state = 'pago' and x.kind <> 'nao_pagar'), 0)::bigint,
         coalesce((select sum(x.amount_cents) from l x
                    where x.clinic_id = c.id and x.state = 'programado' and x.kind <> 'nao_pagar'), 0)::bigint,
         coalesce((select sum(x.amount_cents) from l x
                    where x.clinic_id = c.id and x.state in ('em_relatorio', 'fora')
                      and x.kind <> 'nao_pagar'), 0)::bigint,
         coalesce((select sum(x.amount_cents) from l x
                    where x.clinic_id = c.id and x.state = 'programado'
                      and x.kind <> 'nao_pagar' and x.due_date < public.today_br()), 0)::bigint,
         (select count(*) from public.payout_failures f
           where f.clinic_id = c.id and f.status = 'aberta')::integer,
         (select count(*) from public.payout_reports r
           where r.clinic_id = c.id
             and r.status in ('com_gerente', 'com_dentista', 'em_contestacao', 'em_desempate'))::integer
    from public.clinics c
   where c.id = any (coalesce(v_ids, array[]::uuid[]))
   order by c.name;
end;
$$;
revoke execute on function public.payout_network_summary(date, date) from public, anon, authenticated;
grant execute on function public.payout_network_summary(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O DENTISTA, o próprio repasse (V3: sem a produção), em todas as unidades
-- -----------------------------------------------------------------------------
drop function if exists public.my_payout_evolution(date, date);
create function public.my_payout_evolution(p_from date, p_to date)
returns table (
  month date,
  clinic_id uuid,
  clinic_name text,
  procedures integer,
  payout_cents bigint,
  discount_cents bigint,
  paid_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
  v_ids uuid[];
begin
  if v_user is null then return; end if;
  if not public._payout_period_ok(p_from, p_to) then raise exception 'INVALID_PERIOD'; end if;

  select array_agg(distinct p.clinic_id) into v_ids
    from public.provider_payouts p where p.provider_id = v_user;

  return query
  select l.month, l.clinic_id, c.name,
         (count(*) filter (where l.kind in ('repasse', 'ortodontia')))::integer,
         coalesce(sum(l.amount_cents) filter (where l.kind in ('repasse', 'ortodontia')), 0)::bigint,
         coalesce(sum(l.amount_cents) filter (where l.kind = 'desconto'), 0)::bigint,
         coalesce(sum(l.amount_cents) filter (where l.state = 'pago' and l.kind <> 'nao_pagar'), 0)::bigint
    from public._payout_lines(v_ids, p_from, p_to, v_user) l
    join public.clinics c on c.id = l.clinic_id
   group by l.month, l.clinic_id, c.name
   having count(*) filter (where l.kind <> 'nao_pagar') > 0
   order by l.month, c.name;
end;
$$;
revoke execute on function public.my_payout_evolution(date, date) from public, anon, authenticated;
grant execute on function public.my_payout_evolution(date, date) to authenticated;

-- Conferência (só leitura) ------------------------------------------------------
-- Esperado: funcoes = 3 · internas_fechadas = 2 · tabelas_novas = 0
select
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('payout_history', 'payout_network_summary', 'my_payout_evolution')) as funcoes,
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('_payout_lines', '_payout_period_ok')
      and not has_function_privilege('authenticated', p.oid, 'execute')) as internas_fechadas,
  0 as tabelas_novas;
