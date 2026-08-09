-- =============================================================================
-- 0210 — UMA FONTE SÓ PARA O REPASSE + NÍVEIS DE CARREIRA EDITÁVEIS
-- -----------------------------------------------------------------------------
-- O dono viu o que eu não vi: `procedures` JÁ TINHA `commission_percent` e
-- `commission_fixed_cents` desde a 0039. A 0209 criou uma segunda fonte para a
-- mesma informação — e duas fontes sem precedência declarada é exatamente o
-- que faz dentista receber errado.
--
-- Elas não são iguais, e por isso nenhuma some:
--   • `procedures`  — um valor para todos, sem vigência. É o que o dono já
--     preencheu.
--   • `provider_payout_rates` (0209) — por nível de carreira, com vigência. É o
--     modelo que o briefing decidiu.
--
-- DECISÃO DO DONO (08/08/2026): quatro degraus, nesta ordem.
--   1. valor INDIVIDUAL do profissional
--   2. valor do NÍVEL de carreira
--   3. valor FIXO do procedimento          (procedures.commission_fixed_cents)
--   4. PERCENTUAL do procedimento sobre o preço (commission_percent)
--
-- Nada do que ele preencheu se perde, e a precedência vive no BANCO — não na
-- cabeça de quem lê a tela.
--
-- E os NÍVEIS ganham o que faltava: nome editável e os requisitos para evoluir
-- (tempo, produção, resultado, formação). Os requisitos são DESCRITIVOS: o
-- sistema não promove ninguém sozinho. Promover é decisão de gestão — o que o
-- sistema faz é deixar o critério escrito e visível para os dois lados.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Níveis: descrição e requisitos de evolução
-- -----------------------------------------------------------------------------
alter table public.career_levels
  add column if not exists description text,
  add column if not exists req_months_min integer check (req_months_min is null or req_months_min >= 0),
  add column if not exists req_monthly_production_cents bigint
    check (req_monthly_production_cents is null or req_monthly_production_cents >= 0),
  add column if not exists req_results text,
  add column if not exists req_education text,
  add column if not exists req_other text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles (id);

comment on column public.career_levels.req_results is
  'Indicadores de resultado esperados (NPS, retorno, retrabalho...). Texto de '
  'propósito: o sistema NÃO promove sozinho — promover é decisão de gestão. '
  'O que ele faz é deixar o critério escrito e visível para os dois lados.';

-- -----------------------------------------------------------------------------
-- 2) O REPASSE com os quatro degraus
-- -----------------------------------------------------------------------------
drop function if exists public.payout_rate_for(uuid, uuid, uuid, date);

create or replace function public.payout_rate_for(
  p_procedure_id uuid,
  p_provider_id uuid,
  p_clinic_id uuid,
  p_date date default current_date
)
returns table (rate_id uuid, amount_cents bigint, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level uuid;
  v_rate record;
  v_proc record;
begin
  select ucr.career_level_id into v_level
  from public.user_clinic_roles ucr
  where ucr.user_id = p_provider_id and ucr.clinic_id = p_clinic_id
  limit 1;

  -- Degraus 1 e 2: tabela com vigência. Individual vence nível; entre as
  -- vigentes, a mais recente manda.
  select r.id, r.amount_cents, r.provider_id into v_rate
  from public.provider_payout_rates r
  where r.procedure_id = p_procedure_id
    and r.valid_from <= p_date
    and (r.valid_to is null or r.valid_to >= p_date)
    and (r.clinic_id is null or r.clinic_id = p_clinic_id)
    and (
      r.provider_id = p_provider_id
      or (r.provider_id is null and v_level is not null and r.level_id = v_level)
    )
  order by (r.provider_id is not null) desc, r.valid_from desc
  limit 1;

  if v_rate.id is not null then
    return query select v_rate.id, v_rate.amount_cents,
      case when v_rate.provider_id is not null then 'individual' else 'nivel' end;
    return;
  end if;

  -- Degraus 3 e 4: o que já estava no CADASTRO DO PROCEDIMENTO (0039).
  select p.commission_fixed_cents, p.commission_percent, p.default_price_cents
    into v_proc
  from public.procedures p where p.id = p_procedure_id;

  if coalesce(v_proc.commission_fixed_cents, 0) > 0 then
    return query select null::uuid, v_proc.commission_fixed_cents::bigint,
                        'procedimento_fixo';
    return;
  end if;

  if coalesce(v_proc.commission_percent, 0) > 0 then
    -- Percentual sobre o preço padrão do procedimento. O briefing decidiu
    -- repasse fixo, mas quem já usa percentual não pode ficar sem repasse.
    return query select null::uuid,
      round(coalesce(v_proc.default_price_cents, 0)
            * v_proc.commission_percent / 100.0)::bigint,
      'procedimento_percentual';
    return;
  end if;

  -- Nenhum degrau: devolve NADA. A apuração registra zero e AVISA — inventar
  -- valor faria o dentista receber errado sem ninguém notar.
  return;
end;
$$;

grant execute on function public.payout_rate_for(uuid, uuid, uuid, date)
  to authenticated;

-- A apuração e a estimativa continuam valendo (a assinatura mudou, o uso não).
create or replace function public.accrue_session_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate record;
  v_provider uuid;
  v_when date;
begin
  if new.status <> 'done' or coalesce(old.status, '') = 'done' then
    return new;
  end if;

  v_provider := coalesce(new.executed_by, new.planner_provider_id);
  if v_provider is null then return new; end if;

  v_when := coalesce(new.done_at::date, public.today_br());

  select * into v_rate
  from public.payout_rate_for(
    new.procedure_id, v_provider, new.clinic_id, v_when);

  insert into public.provider_payouts
    (clinic_id, provider_id, session_id, procedure_id, procedure_name,
     accrual_date, amount_cents, rate_id)
  values (
    new.clinic_id, v_provider, new.id, new.procedure_id, new.procedure_name,
    v_when, coalesce(v_rate.amount_cents, 0), v_rate.rate_id)
  on conflict (session_id) do nothing;

  return new;
end;
$$;

create or replace function public.estimated_option_payout(
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
    coalesce((select amount_cents from public.payout_rate_for(
      oi.procedure_id, oi.suggested_provider_id, p_clinic_id, public.today_br())), 0)
    * greatest(1, coalesce(oi.quantity, 1))
  ), 0)
  from public.treatment_plan_option_items oi
  where oi.option_id = p_option_id and oi.procedure_id is not null;
$$;

-- -----------------------------------------------------------------------------
-- 3) O MESMO cálculo para a VENDA DIRETA (o alerta de margem lá também)
-- -----------------------------------------------------------------------------
create or replace function public.estimated_direct_sale_payout(p_sale_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    coalesce((select amount_cents from public.payout_rate_for(
      i.procedure_id, null, s.clinic_id, public.today_br())), 0)
    * greatest(1, coalesce(i.quantity, 1))
  ), 0)
  from public.direct_sale_items i
  join public.direct_sales s on s.id = i.sale_id
  where i.sale_id = p_sale_id and i.procedure_id is not null;
$$;

grant execute on function public.estimated_direct_sale_payout(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) Conferência: de onde cada procedimento tira o repasse hoje
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.provider_payout_rates) as linhas_por_nivel,
  (select count(*) from public.procedures
    where coalesce(commission_fixed_cents, 0) > 0) as procedimentos_com_valor_fixo,
  (select count(*) from public.procedures
    where coalesce(commission_fixed_cents, 0) = 0
      and coalesce(commission_percent, 0) > 0) as procedimentos_so_com_percentual,
  (select count(*) from public.procedures
    where is_active
      and coalesce(commission_fixed_cents, 0) = 0
      and coalesce(commission_percent, 0) = 0) as procedimentos_sem_repasse;
