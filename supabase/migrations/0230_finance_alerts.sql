-- =============================================================================
-- 0230 — FIN7.3: os alertas do Financeiro
-- -----------------------------------------------------------------------------
-- Orçamento só serve se alguém for avisado ENQUANTO DÁ PARA REAGIR. Quatro
-- regras, uma vez por dia:
--
--   1. ORÇAMENTO — o gasto do mês já passou de 90% da meta antes de o mês
--      acabar. É o aviso do dia 12, não o do dia 30.
--   2. CAIXA — o saldo projetado fica negativo dentro dos próximos N dias.
--   3. EQUILÍBRIO — faltando poucos dias para o fim do mês, o faturamento
--      ainda não cobriu o ponto de equilíbrio.
--   4. ATRASO — o total vencido a receber passou de um limite.
--
-- ALERTA QUE REPETE TODO DIA É ALERTA QUE NINGUÉM LÊ. `finance_alerts` guarda
-- (unidade, regra, referência) e o aviso dispara UMA vez; só rearma quando a
-- condição some e volta. Sem isso o gerente ganharia quatro notificações por
-- dia até o fim do mês e passaria a ignorar todas — inclusive a que importava.
--
-- RODA NO BANCO, POR CRON. Se dependesse de alguém abrir a tela do Financeiro,
-- o aviso chegaria justamente para quem já estava olhando.
--
-- ISSO OBRIGA UMA SEPARAÇÃO: o cron roda SEM usuário, então `auth.uid()` é nulo
-- e toda guarda de permissão recusaria tudo. As contas foram para funções
-- `_raw` (sem guarda) e as versões públicas viraram casca com a guarda — mesmo
-- desenho de `apply_stock_movement` × `post_stock_movement` (0217). UMA conta
-- só: duplicar a matemática nos dois caminhos é como eles passam a divergir.
-- As `_raw` levam `revoke ... from public` explícito: no Postgres, função nova
-- nasce executável por TODO MUNDO, e uma conta sem guarda exposta assim
-- entregaria o número de qualquer unidade a qualquer usuário logado.
--
-- QUEM RECEBE: só a unidade (gerente e franqueado). A franqueadora fica fora de
-- propósito — com 200 unidades seriam centenas de notificações por dia, e o
-- acompanhamento da rede é assunto de painel (FIN8), não de sino.
--
-- O ALERTA DE ORÇAMENTO SÓ VALE PARA DESPESA. Estar com 90% da meta de RECEITA
-- no meio do mês é notícia boa; avisar seria ruído.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) OS LIMITES, na cascata que o sistema já usa
-- -----------------------------------------------------------------------------
-- Colunas ANULÁVEIS de propósito: assim a unidade sobrescreve campo a campo, e
-- quem não configurou nada herda a rede. Limite que não se ajusta vira alerta
-- desligado no dedo.
alter table public.finance_settings
  add column if not exists alerts_enabled boolean,
  add column if not exists alert_budget_percent numeric(5,2),
  add column if not exists alert_cash_days integer,
  add column if not exists alert_breakeven_days integer,
  add column if not exists alert_overdue_cents bigint;

update public.finance_settings set
  alerts_enabled = coalesce(alerts_enabled, true),
  alert_budget_percent = coalesce(alert_budget_percent, 90),
  alert_cash_days = coalesce(alert_cash_days, 15),
  alert_breakeven_days = coalesce(alert_breakeven_days, 7),
  alert_overdue_cents = coalesce(alert_overdue_cents, 500000)
where clinic_id is null;

-- CORREÇÃO DE UMA CASCATA QUE NUNCA FOI CASCATA. `finance_settings_for` sempre
-- disse resolver "campo a campo", mas as quatro colunas antigas eram NOT NULL
-- com padrão: qualquer linha de unidade já nascia com 2,00 / 1,00 / 0 /
-- half_up, e o `coalesce` nunca chegava na rede. Enquanto só a Franqueadora
-- criava linha de unidade, o efeito ficou escondido; agora a UNIDADE cria linha
-- para ajustar alerta, e sem isto ela congelaria multa e juros nos padrões —
-- uma mudança futura da rede nunca chegaria nela, sem nada na tela denunciando.
alter table public.finance_settings
  alter column late_fee_percent drop not null,
  alter column monthly_interest_percent drop not null,
  alter column grace_days drop not null,
  alter column rounding_mode drop not null;

-- Muda o tipo de retorno: `create or replace` não basta.
drop function if exists public.finance_settings_for(uuid);

create or replace function public.finance_settings_for(p_clinic_id uuid)
returns table (
  late_fee_percent numeric,
  monthly_interest_percent numeric,
  grace_days integer,
  rounding_mode text,
  alerts_enabled boolean,
  alert_budget_percent numeric,
  alert_cash_days integer,
  alert_breakeven_days integer,
  alert_overdue_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(u.late_fee_percent, n.late_fee_percent),
    coalesce(u.monthly_interest_percent, n.monthly_interest_percent),
    coalesce(u.grace_days, n.grace_days),
    coalesce(u.rounding_mode, n.rounding_mode),
    coalesce(u.alerts_enabled, n.alerts_enabled, true),
    coalesce(u.alert_budget_percent, n.alert_budget_percent, 90),
    coalesce(u.alert_cash_days, n.alert_cash_days, 15),
    coalesce(u.alert_breakeven_days, n.alert_breakeven_days, 7),
    coalesce(u.alert_overdue_cents, n.alert_overdue_cents, 500000)
  from (select 1) one
  left join public.finance_settings u on u.clinic_id = p_clinic_id
  left join public.finance_settings n on n.clinic_id is null;
$$;

grant execute on function public.finance_settings_for(uuid) to authenticated;

-- A UNIDADE ajusta os próprios limites de alerta — mas não mexe em multa e
-- juros, que são regra da rede. A policy de escrita da tabela é só da
-- Franqueadora; esta função abre uma porta estreita, só para as colunas de
-- alerta, para quem já lança dinheiro na unidade. Limite que não se ajusta vira
-- alerta desligado no dedo.
create or replace function public.save_alert_settings(
  p_clinic_id uuid,
  p_enabled boolean,
  p_budget_percent numeric,
  p_cash_days integer,
  p_breakeven_days integer,
  p_overdue_cents bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not (public.is_admin_master() or public.can_post_finance(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.finance_settings
    (clinic_id, alerts_enabled, alert_budget_percent, alert_cash_days,
     alert_breakeven_days, alert_overdue_cents, updated_by)
  values
    (p_clinic_id, p_enabled, p_budget_percent, p_cash_days,
     p_breakeven_days, p_overdue_cents, v_user)
  on conflict (clinic_id) do update
    set alerts_enabled = excluded.alerts_enabled,
        alert_budget_percent = excluded.alert_budget_percent,
        alert_cash_days = excluded.alert_cash_days,
        alert_breakeven_days = excluded.alert_breakeven_days,
        alert_overdue_cents = excluded.alert_overdue_cents,
        updated_at = now(),
        updated_by = v_user;
end;
$$;

revoke all on function public.save_alert_settings(
  uuid, boolean, numeric, integer, integer, bigint) from public;
grant execute on function public.save_alert_settings(
  uuid, boolean, numeric, integer, integer, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) DINHEIRO EM TEXTO, sem depender do idioma do servidor
-- -----------------------------------------------------------------------------
-- `to_char` com G e D usa a configuração regional do banco — o mesmo alerta
-- sairia "1,234.56" ou "1.234,56" conforme o servidor. Aqui o padrão usa
-- separadores literais e a troca para o formato brasileiro é explícita.
create or replace function public.brl(p_cents bigint)
returns text
language sql
immutable
as $$
  select 'R$ ' || replace(replace(replace(
    to_char(coalesce(p_cents, 0) / 100.0, 'FM9,999,999,990.00'),
    ',', '#'), '.', ','), '#', '.');
$$;

grant execute on function public.brl(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A MEMÓRIA DO QUE JÁ FOI AVISADO
-- -----------------------------------------------------------------------------
create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  rule text not null
    check (rule in ('orcamento', 'caixa', 'equilibrio', 'atraso')),
  -- Identifica ESTA ocorrência: o mês, a conta, o dia do buraco. É o que faz
  -- "estourou o marketing de agosto" ser um alerta só, e não trinta.
  reference text not null,
  detail text,
  amount_cents bigint,
  first_seen_at timestamptz not null default now(),
  notified_at timestamptz,
  -- Preenchido quando a condição some. Rearma o aviso se ela voltar.
  cleared_at timestamptz,
  constraint finance_alerts_unique unique (clinic_id, rule, reference)
);

create index if not exists finance_alerts_clinic_idx
  on public.finance_alerts (clinic_id, rule, cleared_at);

alter table public.finance_alerts enable row level security;

drop policy if exists "finance_alerts_select" on public.finance_alerts;
create policy "finance_alerts_select" on public.finance_alerts
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- -----------------------------------------------------------------------------
-- 4) AS CONTAS SEM GUARDA (o cron roda sem usuário)
-- -----------------------------------------------------------------------------
create or replace function public.cash_flow_series_raw(
  p_clinic_id uuid,
  p_from date,
  p_to date
)
returns table (
  day date,
  kind text,
  activity text,
  inflow_cents bigint,
  outflow_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.cash_date,
    'realizado'::text,
    case
      when e.account_code like '5.1%' then 'investimento'
      when e.account_code like '5.3%'
        or e.account_code like '5.4%'   then 'financiamento'
      else 'operacional'
    end,
    sum(case when e.direction = 'inflow' then e.amount_cents else 0 end)::bigint,
    sum(case when e.direction = 'outflow' then e.amount_cents else 0 end)::bigint
  from public.financial_entries e
  where e.clinic_id = p_clinic_id
    and e.cash_date between p_from and p_to
    and e.status = 'settled'
    and e.reversal_of is null
  group by 1, 2, 3

  union all

  select
    coalesce(i.expected_settlement_date, i.due_date),
    'previsto'::text,
    'operacional'::text,
    sum(i.amount_cents - coalesce(i.paid_amount_cents, 0))::bigint,
    0::bigint
  from public.payment_installments i
  where i.clinic_id = p_clinic_id
    and i.status in ('em_aberto', 'parcial')
    and i.amount_cents > coalesce(i.paid_amount_cents, 0)
    and coalesce(i.expected_settlement_date, i.due_date)
        between greatest(p_from, public.today_br()) and p_to
  group by 1, 2, 3

  union all

  select
    p.due_date,
    'previsto'::text,
    case
      when p.account_code like '5.1%' then 'investimento'
      when p.account_code like '5.3%'
        or p.account_code like '5.4%'   then 'financiamento'
      else 'operacional'
    end,
    0::bigint,
    sum(p.amount_cents - coalesce(p.paid_amount_cents, 0))::bigint
  from public.payables p
  where p.clinic_id = p_clinic_id
    and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
    and p.amount_cents > coalesce(p.paid_amount_cents, 0)
    and p.due_date between greatest(p_from, public.today_br()) and p_to
  group by 1, 2, 3;
$$;

revoke all on function public.cash_flow_series_raw(uuid, date, date) from public;

-- A versão pública vira casca com a guarda. Uma conta só.
create or replace function public.cash_flow_series(
  p_clinic_id uuid,
  p_from date,
  p_to date
)
returns table (
  day date,
  kind text,
  activity text,
  inflow_cents bigint,
  outflow_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.cash_flow_series_raw(p_clinic_id, p_from, p_to)
   where public.can_see_clinic_finance(p_clinic_id);
$$;

grant execute on function public.cash_flow_series(uuid, date, date) to authenticated;

create or replace function public.breakeven_lines_raw(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_cost_center_id uuid default null
)
returns table (
  account_code text,
  account_name text,
  role text,
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
      when e.account_code like '1.9%' then 'deducao'
      when e.account_code like '1%'   then 'receita'
      when e.account_code like '5.2%' then 'depreciacao'
      when e.account_code like '4.1%' then 'receita_financeira'
      when max(a.cost_behavior) = 'variable' then 'variavel'
      when max(a.cost_behavior) = 'fixed'    then 'fixo'
      else 'fora'
    end,
    sum(case when e.direction = 'inflow'
             then e.amount_cents else -e.amount_cents end)::bigint
  from public.financial_entries e
  left join public.chart_of_accounts a on a.code = e.account_code
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    and e.status in ('settled', 'open')
    and e.reversal_of is null
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

revoke all on function public.breakeven_lines_raw(uuid, date, date, uuid)
  from public;

create or replace function public.breakeven_lines(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_cost_center_id uuid default null
)
returns table (
  account_code text,
  account_name text,
  role text,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.breakeven_lines_raw(
           p_clinic_id, p_from, p_to, p_cost_center_id)
   where public.can_see_clinic_finance(p_clinic_id);
$$;

grant execute on function public.breakeven_lines(uuid, date, date, uuid)
  to authenticated;

-- `cash_balance_before` também precisa rodar sem usuário no cron: a guarda vale
-- para chamada COM usuário, e o cron (sem `auth.uid()`) passa.
create or replace function public.cash_balance_before(
  p_clinic_id uuid,
  p_date date
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null
     and not public.can_see_clinic_finance(p_clinic_id) then 0
    else
      coalesce((
        select sum(b.opening_balance_cents)
          from public.bank_accounts b
         where b.clinic_id = p_clinic_id and b.active
      ), 0)
      + coalesce((
        select sum(case when e.direction = 'inflow'
                        then e.amount_cents else -e.amount_cents end)
          from public.financial_entries e
         where e.clinic_id = p_clinic_id
           and e.cash_date is not null
           and e.cash_date < p_date
           and e.status = 'settled'
           and e.reversal_of is null
      ), 0)
  end::bigint;
$$;

grant execute on function public.cash_balance_before(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) O PRIMEIRO DIA EM QUE O CAIXA FICA NEGATIVO
-- -----------------------------------------------------------------------------
-- Mesma régua da tela (0227): a série é DIÁRIA, porque um buraco no dia 8
-- coberto por um recebimento no dia 25 some em qualquer agrupamento maior — e é
-- justamente ele que faz o cheque voltar.
create or replace function public.cash_first_negative(
  p_clinic_id uuid,
  p_days integer default 15
)
returns table (day date, balance_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select public.today_br() as d0,
           public.today_br() + greatest(coalesce(p_days, 15), 1) as d1
  ),
  opening as (
    select public.cash_balance_before(p_clinic_id, (select d0 from bounds)) as v
  ),
  moves as (
    select s.day as d, sum(s.inflow_cents - s.outflow_cents)::bigint as net
    from bounds b,
         public.cash_flow_series_raw(p_clinic_id, b.d0, b.d1) s
    group by s.day
  ),
  grid as (
    select generate_series((select d0 from bounds), (select d1 from bounds),
                           interval '1 day')::date as d
  ),
  running as (
    select g.d,
      ((select v from opening)
        + sum(coalesce(m.net, 0)) over (order by g.d
            rows between unbounded preceding and current row))::bigint as bal
    from grid g
    left join moves m on m.d = g.d
  )
  select r.d, r.bal from running r where r.bal < 0 order by r.d limit 1;
$$;

revoke all on function public.cash_first_negative(uuid, integer) from public;

-- -----------------------------------------------------------------------------
-- 6) DISPARAR E LIMPAR — o anti-ruído mora aqui
-- -----------------------------------------------------------------------------
-- Só notifica quando o alerta é NOVO (ou voltou depois de ter sumido). Repetir
-- todo dia é como um aviso vira paisagem.
create or replace function public.raise_finance_alert(
  p_clinic_id uuid,
  p_rule text,
  p_reference text,
  p_detail text,
  p_amount_cents bigint,
  p_title text,
  p_link text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_notified timestamptz;
begin
  insert into public.finance_alerts
    (clinic_id, rule, reference, detail, amount_cents)
  values (p_clinic_id, p_rule, p_reference, p_detail, p_amount_cents)
  on conflict (clinic_id, rule, reference) do update
    set detail = excluded.detail,
        amount_cents = excluded.amount_cents,
        -- Voltou depois de ter sumido: rearma.
        notified_at = case when finance_alerts.cleared_at is not null
                           then null else finance_alerts.notified_at end,
        cleared_at = null
  returning id, notified_at into v_id, v_notified;

  -- Já avisado e a condição nunca sumiu: silêncio é o comportamento certo.
  if v_notified is not null then
    return;
  end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select r.user_id, p_clinic_id, p_title, p_detail, p_link
  from public.user_clinic_roles r
  where r.clinic_id = p_clinic_id
    and r.role in ('unit_manager', 'franchisee');

  update public.finance_alerts set notified_at = now() where id = v_id;
end;
$$;

revoke all on function public.raise_finance_alert(
  uuid, text, text, text, bigint, text, text) from public;

create or replace function public.clear_finance_alert(
  p_clinic_id uuid,
  p_rule text,
  p_reference text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.finance_alerts
     set cleared_at = now(), notified_at = null
   where clinic_id = p_clinic_id and rule = p_rule
     and reference = p_reference and cleared_at is null;
$$;

revoke all on function public.clear_finance_alert(uuid, text, text) from public;

-- -----------------------------------------------------------------------------
-- 7) O MOTOR
-- -----------------------------------------------------------------------------
create or replace function public.check_finance_alerts(
  p_clinic_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_clinic record;
  v_cfg record;
  v_row record;
  v_today date := public.today_br();
  v_month_start date := date_trunc('month', public.today_br())::date;
  v_month_end date := (date_trunc('month', public.today_br())
                       + interval '1 month' - interval '1 day')::date;
  v_days_left integer;
  v_neg_day date;
  v_neg_bal bigint;
  v_ref text;
  v_sent integer := 0;
  v_rl bigint;
  v_mc bigint;
  v_fixo bigint;
  v_ponto bigint;
  v_overdue bigint;
begin
  -- Chamada manual precisa de permissão; o cron roda sem usuário e passa.
  if v_user is not null then
    if p_clinic_id is null then
      if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
    elsif not public.can_see_clinic_finance(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;

  v_days_left := v_month_end - v_today;

  for v_clinic in
    select c.id, c.name from public.clinics c
     where (p_clinic_id is null or c.id = p_clinic_id)
       and c.type <> 'franchisor'
  loop
    select * into v_cfg from public.finance_settings_for(v_clinic.id);
    if not coalesce(v_cfg.alerts_enabled, true) then
      continue;
    end if;

    -- ---------------------------------------------------------------------
    -- 1) ORÇAMENTO — só DESPESA (90% da meta de RECEITA é notícia boa).
    -- ---------------------------------------------------------------------
    for v_row in
      select
        b.account_code,
        coalesce(a.name, b.account_code) as name,
        abs(b.amount_cents) as meta,
        abs(coalesce(r.gasto, 0)) as gasto
      from public.budget_lines b
      left join public.chart_of_accounts a on a.code = b.account_code
      left join lateral (
        select sum(case when e.direction = 'inflow'
                        then e.amount_cents else -e.amount_cents end) as gasto
        from public.financial_entries e
        where e.clinic_id = v_clinic.id
          and e.account_code = b.account_code
          and e.accrual_date between v_month_start and v_month_end
          and e.status in ('settled', 'open')
          and e.reversal_of is null
          and e.source_type not in ('receipt_cash', 'payable_cash')
      ) r on true
      where b.clinic_id = v_clinic.id
        and b.year = extract(year from v_today)::integer
        and b.month = extract(month from v_today)::integer
        and b.amount_cents < 0
    loop
      v_ref := 'orcamento:' || to_char(v_today, 'YYYY-MM') || ':'
               || v_row.account_code;

      if v_row.meta > 0
         and v_row.gasto * 100 >= v_row.meta * v_cfg.alert_budget_percent then
        perform public.raise_finance_alert(
          v_clinic.id, 'orcamento', v_ref,
          v_row.account_code || ' ' || v_row.name || ' já consumiu '
            || round(v_row.gasto * 100.0 / v_row.meta) || '% da meta do mês ('
            || public.brl(v_row.gasto) || ' de ' || public.brl(v_row.meta)
            || ').',
          v_row.gasto,
          'Orçamento estourando — ' || v_row.name,
          '/financeiro/orcamento');
        v_sent := v_sent + 1;
      else
        perform public.clear_finance_alert(v_clinic.id, 'orcamento', v_ref);
      end if;
    end loop;

    -- ---------------------------------------------------------------------
    -- 2) CAIXA — o primeiro dia negativo dentro da janela.
    -- ---------------------------------------------------------------------
    v_neg_day := null;
    v_neg_bal := null;
    select n.day, n.balance_cents into v_neg_day, v_neg_bal
      from public.cash_first_negative(v_clinic.id, v_cfg.alert_cash_days) n;

    if v_neg_day is not null then
      v_ref := 'caixa:' || to_char(v_neg_day, 'YYYY-MM-DD');
      perform public.raise_finance_alert(
        v_clinic.id, 'caixa', v_ref,
        'O saldo projetado fica negativo em ' || to_char(v_neg_day, 'DD/MM')
          || ', faltando ' || public.brl(abs(v_neg_bal))
          || '. Antecipar um recebimento ou empurrar um pagamento resolve; '
          || 'descobrir no dia, não.',
        v_neg_bal,
        'Caixa negativo previsto para ' || to_char(v_neg_day, 'DD/MM'),
        '/financeiro/fluxo-de-caixa');
      v_sent := v_sent + 1;
    end if;

    -- O buraco que mudou de dia (ou sumiu) rearma o aviso.
    update public.finance_alerts set cleared_at = now(), notified_at = null
     where clinic_id = v_clinic.id and rule = 'caixa' and cleared_at is null
       and reference is distinct from
           ('caixa:' || to_char(v_neg_day, 'YYYY-MM-DD'));

    -- ---------------------------------------------------------------------
    -- 3) EQUILÍBRIO — perto do fim do mês e ainda abaixo do ponto.
    -- ---------------------------------------------------------------------
    v_ref := 'equilibrio:' || to_char(v_today, 'YYYY-MM');
    if v_days_left <= coalesce(v_cfg.alert_breakeven_days, 7) then
      select
        coalesce(sum(case when l.role in ('receita', 'deducao')
                          then l.amount_cents else 0 end), 0),
        coalesce(sum(case when l.role in ('receita', 'deducao', 'variavel')
                          then l.amount_cents else 0 end), 0),
        coalesce(-sum(case when l.role in ('fixo', 'depreciacao')
                           then l.amount_cents else 0 end)
                 - sum(case when l.role = 'receita_financeira'
                            then l.amount_cents else 0 end), 0)
        into v_rl, v_mc, v_fixo
      from public.breakeven_lines_raw(v_clinic.id, v_month_start, v_month_end) l;

      if v_rl > 0 and v_mc > 0 and v_fixo > 0 then
        v_ponto := round(v_fixo::numeric / (v_mc::numeric / v_rl::numeric));
        if v_rl < v_ponto then
          perform public.raise_finance_alert(
            v_clinic.id, 'equilibrio', v_ref,
            'Faltam ' || v_days_left || ' dias para o fim do mês e o '
              || 'faturamento ainda não cobriu o ponto de equilíbrio: '
              || public.brl(v_rl) || ' de ' || public.brl(v_ponto) || '.',
            v_ponto - v_rl,
            'Faturamento atrás do ponto de equilíbrio',
            '/financeiro/ponto-de-equilibrio');
          v_sent := v_sent + 1;
        else
          perform public.clear_finance_alert(v_clinic.id, 'equilibrio', v_ref);
        end if;
      end if;
    end if;

    -- ---------------------------------------------------------------------
    -- 4) ATRASO acumulado acima do limite.
    -- ---------------------------------------------------------------------
    select coalesce(sum(i.amount_cents - coalesce(i.paid_amount_cents, 0)), 0)
      into v_overdue
      from public.payment_installments i
     where i.clinic_id = v_clinic.id
       and i.status in ('em_aberto', 'parcial')
       and i.amount_cents > coalesce(i.paid_amount_cents, 0)
       and coalesce(i.expected_settlement_date, i.due_date) < v_today;

    v_ref := 'atraso:' || to_char(v_today, 'YYYY-MM');
    if v_overdue >= coalesce(v_cfg.alert_overdue_cents, 500000) then
      perform public.raise_finance_alert(
        v_clinic.id, 'atraso', v_ref,
        'O total vencido a receber chegou a ' || public.brl(v_overdue)
          || '. Ele não entra na projeção de caixa — precisa ser cobrado.',
        v_overdue,
        'Atraso a receber acima do limite',
        '/financeiro/fluxo-de-caixa');
      v_sent := v_sent + 1;
    else
      perform public.clear_finance_alert(v_clinic.id, 'atraso', v_ref);
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.check_finance_alerts(uuid) from public;
grant execute on function public.check_finance_alerts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) UMA VEZ POR DIA, 9h de Brasília (12h UTC)
-- -----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('risarte-finance-alerts');
exception when others then null;
end;
$$;
do $$
begin
  perform cron.schedule(
    'risarte-finance-alerts', '0 12 * * *',
    'select public.check_finance_alerts()'
  );
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.finance_alerts) as alertas_registrados,
  (select count(*) from public.finance_alerts where cleared_at is null)
    as alertas_ativos,
  (select alert_budget_percent from public.finance_settings_for(null))
    as limite_orcamento_da_rede,
  (select public.brl(123456)) as formato_de_moeda,
  (select count(*) from public.user_clinic_roles
    where role in ('unit_manager', 'franchisee')) as destinatarios_possiveis;
