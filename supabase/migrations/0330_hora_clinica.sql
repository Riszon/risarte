-- =============================================================================
-- 0330 — A HORA CLÍNICA CALCULADA (pedido do dono, 27/10/2026)
--
-- A Precificação tinha o campo "Hora de cadeira" digitado à mão. O dono pediu
-- que ele seja CALCULADO pela fórmula do custo da hora clínica da unidade, e
-- que o número apareça no Painel da rede para comparar as unidades.
--
-- Decisões do dono (27/10/2026, as quatro como recomendado):
--   HC1 — hora clínica = custo fixo ÷ (horas de cadeira × ocupação esperada).
--         A ocupação esperada é configurável (padrão da rede 80%, a unidade
--         pode ter a sua). A hora "real" (sobre as horas trabalhadas) aparece
--         ao lado, para comparar — não é a que precifica.
--   HC2 — o período são os ÚLTIMOS 3 MESES FECHADOS.
--   HC3 — calculada sempre; o valor digitado vale SÓ quando não há dados
--         (sem custo fixo lançado ou sem horas na agenda), e a tela avisa.
--   HC4 — a DEPRECIAÇÃO dos bens entra no custo fixo.
--
-- A conta é feita no servidor (TypeScript, `src/lib/finance/hora-clinica.ts`),
-- porque as horas de cadeira já são calculadas lá (`horas-da-agenda.ts`, a
-- conta do Planejamento Anual: jornada, cadeiras, feriados, recessos,
-- fechamentos e horários avulsos). O banco entrega só o que é dele: o custo
-- fixo de cada mês.
--
-- ⚠️ O CUSTO FIXO É O MESMO DO PONTO DE EQUILÍBRIO (`breakeven_lines`, 0228):
-- mesmas contas (comportamento "fixo" no plano de contas + depreciação 5.2),
-- mesmo recorte (competência, aberto ou pago, sem estorno, sem o espelho de
-- caixa, sem 6.x / 5.1 / 5.3 / 5.4). A régua `hora-clinica.test.ts` compara as
-- duas — mudou uma, muda a outra.
--
-- Idempotente.
-- =============================================================================

-- 1) A ocupação esperada, em cascata (rede → unidade) --------------------------
-- Nulo na unidade = vale a da rede. Nulo na rede = 80% (o padrão do código).
alter table public.clinic_cost_settings
  add column if not exists expected_occupancy_percent numeric(5,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinic_cost_settings_occupancy_chk') then
    alter table public.clinic_cost_settings
      add constraint clinic_cost_settings_occupancy_chk
      check (expected_occupancy_percent is null
             or (expected_occupancy_percent >= 1 and expected_occupancy_percent <= 100));
  end if;
end $$;

update public.clinic_cost_settings
   set expected_occupancy_percent = 80
 where clinic_id is null
   and expected_occupancy_percent is null;

-- 2) O custo fixo de cada mês da unidade ---------------------------------------
-- Valores POSITIVOS (gasto). `fixed_cents` = contas de comportamento fixo;
-- `depreciation_cents` = 5.2 (depreciação dos bens). Mês sem lançamento não
-- vem — a conta trata a ausência como "mês sem dado", não como "custo zero".
--
-- Quem lê: quem enxerga a unidade (a mesma porta de `cost_settings_for`). A
-- negociação e a venda direta precisam da hora clínica para a margem, e quem
-- negocia não lê o Financeiro. Sai só o total do mês, nunca as contas.
create or replace function public.clinic_fixed_costs_by_month(
  p_clinic uuid,
  p_from date,
  p_to date
)
returns table (
  month date,
  fixed_cents bigint,
  depreciation_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_clinic is null or not public.can_read_clinic_data(p_clinic) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
  select
    date_trunc('month', e.accrual_date)::date,
    coalesce(sum(case when e.account_code not like '5.2%'
                      then case when e.direction = 'outflow'
                                then e.amount_cents else -e.amount_cents end
                      else 0 end), 0)::bigint,
    coalesce(sum(case when e.account_code like '5.2%'
                      then case when e.direction = 'outflow'
                                then e.amount_cents else -e.amount_cents end
                      else 0 end), 0)::bigint
  from public.financial_entries e
  left join public.chart_of_accounts a on a.code = e.account_code
  where e.clinic_id = p_clinic
    and e.accrual_date between p_from and p_to
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and e.account_code not like '6%'
    and e.account_code not like '5.1%'
    and e.account_code not like '5.3%'
    and e.account_code not like '5.4%'
    and e.account_code not like '1%'
    and e.account_code not like '4.1%'
    and (e.account_code like '5.2%' or a.cost_behavior = 'fixed')
  group by 1
  order by 1;
end;
$$;
revoke execute on function public.clinic_fixed_costs_by_month(uuid, date, date) from public, anon, authenticated;
grant execute on function public.clinic_fixed_costs_by_month(uuid, date, date) to authenticated, service_role;
