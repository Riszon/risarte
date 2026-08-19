-- =============================================================================
-- 0229 — FIN7.1/7.2: orçamento e orçado × realizado
-- -----------------------------------------------------------------------------
-- O sistema responde o que ACONTECEU. Aqui entra o que DEVERIA ter acontecido —
-- e é a diferença entre descobrir no dia 30 que o marketing estourou e ser
-- avisado no dia 12.
--
-- DECISÕES DO DONO (17/08/2026):
--   • A UNIDADE FAZ O SEU ORÇAMENTO; a franqueadora enxerga, não impõe. Sem
--     cascata rede→unidade: número que o gerente assumiu ele defende, número
--     que caiu de cima ele explica.
--   • RECEITA E DESPESA. Sem meta de faturamento não dá para dizer se o mês foi
--     ruim porque gastou demais ou porque vendeu de menos — e é essa distinção
--     que muda a decisão.
--   • REALIZADO = COMPETÊNCIA, o mesmo recorte da DRE (0226). O aluguel de
--     agosto conta em agosto mesmo que seja pago em setembro. Comparar com o
--     que já foi pago faria toda conta em aberto parecer economia, e o mês
--     fecharia parecendo melhor do que foi.
--
-- O SINAL VEM DA CONTA, E A VARIAÇÃO TEM UMA REGRA SÓ.
-- A meta é guardada com o mesmo sinal do realizado (receita soma, despesa
-- subtrai). Assim `realizado − orçado` positivo significa SEMPRE "melhor que o
-- previsto": receita acima da meta dá positivo, e despesa de 4.000 contra meta
-- de 5.000 (−4.000 − (−5.000)) também. A alternativa seria uma tabela de "nesta
-- conta subir é bom, naquela é ruim" — a mesma que a DRE não precisou ter.
--
-- LIMITE DECLARADO: o orçamento é por conta e por mês, SEM centro de custo.
-- Orçar por centro exigiria ratear o realizado que hoje nasce sem centro, e
-- rateio inventado é pior que ausência de rateio.
-- Idempotente.
-- =============================================================================

create table if not exists public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  year integer not null check (year between 2020 and 2100),
  month integer not null check (month between 1 and 12),
  account_code text not null references public.chart_of_accounts (code),
  -- Assinado como o realizado: receita positiva, despesa negativa.
  amount_cents bigint not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint budget_lines_unique unique (clinic_id, year, month, account_code)
);

create index if not exists budget_lines_clinic_period_idx
  on public.budget_lines (clinic_id, year, month);

comment on table public.budget_lines is
  'Meta por conta e por mês (FIN7). Valor ASSINADO como o realizado: receita '
  'positiva, despesa negativa — assim realizado − orçado positivo é sempre '
  '"melhor que o previsto", sem tabela de exceções por conta.';

alter table public.budget_lines enable row level security;

drop policy if exists "budget_lines_select" on public.budget_lines;
create policy "budget_lines_select" on public.budget_lines
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- Quem lança no financeiro da unidade orça; a franqueadora enxerga pelo select
-- acima, mas não escreve no orçamento da unidade (decisão do dono).
drop policy if exists "budget_lines_write" on public.budget_lines;
create policy "budget_lines_write" on public.budget_lines
  for all to authenticated
  using (public.is_admin_master() or public.can_post_finance(clinic_id))
  with check (public.is_admin_master() or public.can_post_finance(clinic_id));

-- -----------------------------------------------------------------------------
-- 1) O SINAL DA CONTA — uma regra só, usada ao salvar e ao sugerir
-- -----------------------------------------------------------------------------
-- Receita (1, menos as deduções) soma; todo o resto subtrai. A tela mostra
-- número positivo; o sinal é responsabilidade do banco, para não depender de
-- cada caminho lembrar de aplicá-lo.
create or replace function public.budget_sign(p_account_code text)
returns integer
language sql
immutable
as $$
  select case
    when p_account_code like '1.9%' then -1
    when p_account_code like '1%'   then  1
    else -1
  end;
$$;

grant execute on function public.budget_sign(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) SALVAR UMA META
-- -----------------------------------------------------------------------------
-- Recebe SEMPRE magnitude positiva e aplica o sinal. Zero apaga a linha: meta
-- zerada e meta inexistente são a mesma coisa, e guardar as duas faria a tela
-- mostrar "0,00" onde ninguém orçou nada.
create or replace function public.save_budget_line(
  p_clinic_id uuid,
  p_year integer,
  p_month integer,
  p_account_code text,
  p_amount_cents bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_abs bigint := abs(coalesce(p_amount_cents, 0));
begin
  if not (public.is_admin_master() or public.can_post_finance(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  if not exists (
    select 1 from public.chart_of_accounts
     where code = p_account_code and is_analytic and active
  ) then
    raise exception 'ACCOUNT_NOT_ANALYTIC';
  end if;

  if v_abs = 0 then
    delete from public.budget_lines
     where clinic_id = p_clinic_id and year = p_year
       and month = p_month and account_code = p_account_code;
    return;
  end if;

  insert into public.budget_lines
    (clinic_id, year, month, account_code, amount_cents, created_by, updated_by)
  values
    (p_clinic_id, p_year, p_month, p_account_code,
     v_abs * public.budget_sign(p_account_code), v_user, v_user)
  on conflict (clinic_id, year, month, account_code) do update
    set amount_cents = excluded.amount_cents,
        updated_at = now(),
        updated_by = v_user;
end;
$$;

grant execute on function public.save_budget_line(uuid, integer, integer, text, bigint)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) ORÇADO × REALIZADO
-- -----------------------------------------------------------------------------
-- Devolve o mês E o acumulado do ano até ele. O acumulado importa porque
-- despesa não é uniforme: quem paga o seguro anual em março estoura março e
-- fecha o ano no lugar — olhar só o mês transformaria isso em alarme falso.
create or replace function public.budget_vs_actual(
  p_clinic_id uuid,
  p_year integer,
  p_month integer
)
returns table (
  account_code text,
  account_name text,
  block text,
  budget_cents bigint,
  actual_cents bigint,
  ytd_budget_cents bigint,
  ytd_actual_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.can_see_clinic_finance(p_clinic_id) as ok
  ),
  -- Mesmo recorte da DRE (0226): competência, sem liquidação, sem ativo.
  actual as (
    select
      e.account_code,
      sum(case when extract(month from e.accrual_date) = p_month
               then (case when e.direction = 'inflow'
                          then e.amount_cents else -e.amount_cents end)
               else 0 end)::bigint as m,
      sum(case when e.direction = 'inflow'
               then e.amount_cents else -e.amount_cents end)::bigint as ytd
    from public.financial_entries e, allowed
    where allowed.ok
      and e.clinic_id = p_clinic_id
      and extract(year from e.accrual_date) = p_year
      and extract(month from e.accrual_date) <= p_month
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and e.account_code not like '6%'
      and e.account_code not like '5.1%'
      and e.account_code not like '5.3%'
      and e.account_code not like '5.4%'
    group by e.account_code
  ),
  budget as (
    select
      b.account_code,
      sum(case when b.month = p_month then b.amount_cents else 0 end)::bigint as m,
      sum(b.amount_cents)::bigint as ytd
    from public.budget_lines b, allowed
    where allowed.ok
      and b.clinic_id = p_clinic_id
      and b.year = p_year
      and b.month <= p_month
    group by b.account_code
  )
  select
    coalesce(a.account_code, b.account_code),
    coalesce(c.name, coalesce(a.account_code, b.account_code)),
    case
      when coalesce(a.account_code, b.account_code) like '1.9%' then 'deducoes'
      when coalesce(a.account_code, b.account_code) like '1%'   then 'receita_bruta'
      when coalesce(a.account_code, b.account_code) like '2%'   then 'custos_diretos'
      when coalesce(a.account_code, b.account_code) like '3%'   then 'despesas_operacionais'
      when coalesce(a.account_code, b.account_code) like '4%'   then 'resultado_financeiro'
      when coalesce(a.account_code, b.account_code) like '5.2%' then 'depreciacao'
      else 'fora'
    end,
    coalesce(b.m, 0)::bigint,
    coalesce(a.m, 0)::bigint,
    coalesce(b.ytd, 0)::bigint,
    coalesce(a.ytd, 0)::bigint
  from actual a
  full outer join budget b on b.account_code = a.account_code
  left join public.chart_of_accounts c
    on c.code = coalesce(a.account_code, b.account_code)
  where coalesce(a.m, 0) <> 0 or coalesce(b.m, 0) <> 0
     or coalesce(a.ytd, 0) <> 0 or coalesce(b.ytd, 0) <> 0
  order by 1;
$$;

grant execute on function public.budget_vs_actual(uuid, integer, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) COPIAR O ANO ANTERIOR, COM REAJUSTE
-- -----------------------------------------------------------------------------
-- Orçamento em branco não é preenchido: doze meses vezes trinta contas é
-- trabalho que ninguém faz duas vezes. Partir do ano passado com um percentual
-- entrega um rascunho para corrigir, que é o que de fato acontece.
create or replace function public.copy_budget_year(
  p_clinic_id uuid,
  p_from_year integer,
  p_to_year integer,
  p_percent numeric default 0,
  p_overwrite boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer := 0;
begin
  if not (public.is_admin_master() or public.can_post_finance(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_from_year = p_to_year then
    raise exception 'SAME_YEAR';
  end if;

  if p_overwrite then
    delete from public.budget_lines
     where clinic_id = p_clinic_id and year = p_to_year;
  end if;

  insert into public.budget_lines
    (clinic_id, year, month, account_code, amount_cents, created_by, updated_by)
  select
    p_clinic_id, p_to_year, b.month, b.account_code,
    round(b.amount_cents * (1 + coalesce(p_percent, 0) / 100.0))::bigint,
    v_user, v_user
  from public.budget_lines b
  where b.clinic_id = p_clinic_id and b.year = p_from_year
  on conflict (clinic_id, year, month, account_code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.copy_budget_year(uuid, integer, integer, numeric, boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) SUGERIR PELA MÉDIA DO REALIZADO
-- -----------------------------------------------------------------------------
-- A média dos últimos N meses, com reajuste, para os doze meses do ano alvo.
-- É rascunho declarado: a média achata o sazonal (janeiro nunca é igual a
-- dezembro), e a tela diz isso.
create or replace function public.fill_budget_from_actual(
  p_clinic_id uuid,
  p_to_year integer,
  p_months_back integer default 3,
  p_percent numeric default 0,
  p_overwrite boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer := 0;
  v_from date := (date_trunc('month', public.today_br())
                  - (greatest(coalesce(p_months_back, 3), 1) || ' months')::interval)::date;
  v_to date := (date_trunc('month', public.today_br()) - interval '1 day')::date;
  v_months integer := greatest(coalesce(p_months_back, 3), 1);
begin
  if not (public.is_admin_master() or public.can_post_finance(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_overwrite then
    delete from public.budget_lines
     where clinic_id = p_clinic_id and year = p_to_year;
  end if;

  insert into public.budget_lines
    (clinic_id, year, month, account_code, amount_cents, created_by, updated_by)
  select
    p_clinic_id, p_to_year, m.month, a.account_code,
    round(a.media * (1 + coalesce(p_percent, 0) / 100.0))::bigint,
    v_user, v_user
  from (
    select
      e.account_code,
      sum(case when e.direction = 'inflow'
               then e.amount_cents else -e.amount_cents end)::numeric / v_months
        as media
    from public.financial_entries e
    where e.clinic_id = p_clinic_id
      and e.accrual_date between v_from and v_to
      and e.status in ('settled', 'open')
      and e.reversal_of is null
      and e.source_type not in ('receipt_cash', 'payable_cash')
      and e.account_code not like '6%'
      and e.account_code not like '5.1%'
      and e.account_code not like '5.3%'
      and e.account_code not like '5.4%'
    group by e.account_code
    having sum(case when e.direction = 'inflow'
                    then e.amount_cents else -e.amount_cents end) <> 0
  ) a
  cross join (select generate_series(1, 12) as month) m
  on conflict (clinic_id, year, month, account_code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.fill_budget_from_actual(uuid, integer, integer, numeric, boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.budget_lines) as linhas_de_orcamento,
  (select count(distinct clinic_id) from public.budget_lines)
    as unidades_com_orcamento,
  (select count(*) from public.chart_of_accounts
    where is_analytic and active and scope in ('unit', 'both')
      and (code like '1%' or code like '2%' or code like '3%'
           or code like '4%' or code like '5.2%'))
    as contas_orcaveis;
