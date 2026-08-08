-- =============================================================================
-- 0209 — FIN5: REPASSE AO DENTISTA + MARGEM MÍNIMA
-- -----------------------------------------------------------------------------
-- Decisão do dono (briefing, §RESOLVIDO — regras de repasse):
--
--   • VALOR FIXO POR PROCEDIMENTO, não percentual.
--   • Tabela com VIGÊNCIA, chaveada por NÍVEL DO PLANO DE CARREIRA. O dentista
--     aponta para um nível e herda os valores; valor individual é exceção.
--   • Apuração por COMPETÊNCIA na data do procedimento realizado; liberação
--     para pagamento no fechamento mensal.
--   • BÔNUS percentual sobre o total do período — nunca procedimento a
--     procedimento: ele premia o conjunto (campanha, meta, evolução de
--     carreira), não cada ato isolado.
--   • REAJUSTE NUNCA RECALCULA REPASSE JÁ APURADO. A apuração usa a tabela
--     vigente na data do procedimento, e o valor fica CONGELADO na linha.
--
-- CONSEQUÊNCIA DE GESTÃO, e o motivo do alerta de margem: como o repasse é
-- fixo, o desconto concedido na negociação **não reduz o repasse** — ele sai
-- integralmente da margem da clínica. Um desconto que parece pequeno pode
-- comer um terço do resultado, e o consultor não tem como perceber isso de
-- cabeça no meio da conversa. Por isso `min_margin_percent`.
--
-- LIMITE DECLARADO: material e laboratório ainda NÃO entram na margem — eles
-- são do módulo de Estoque, que vem depois. A tela diz isso; margem incompleta
-- apresentada como completa é pior que margem nenhuma.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Plano de carreira
-- -----------------------------------------------------------------------------
create table if not exists public.career_levels (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = nível da REDE (padrão cascata, como o resto das configurações).
  clinic_id uuid references public.clinics (id),
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists career_levels_scope_idx
  on public.career_levels (clinic_id, sort_order);

comment on table public.career_levels is
  'Níveis do plano de carreira. A tabela de repasse é chaveada por nível — se '
  'valor individual virar regra, o plano de carreira deixa de significar algo.';

alter table public.career_levels enable row level security;

drop policy if exists "career_levels_select" on public.career_levels;
create policy "career_levels_select" on public.career_levels
  for select to authenticated using (true);

drop policy if exists "career_levels_write" on public.career_levels;
create policy "career_levels_write" on public.career_levels
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null
        and public.has_role_in_clinic(
              clinic_id, array['unit_manager']::public.user_role[]))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null
        and public.has_role_in_clinic(
              clinic_id, array['unit_manager']::public.user_role[]))
  );

-- O dentista aponta para um nível NA UNIDADE (ele pode ter níveis diferentes
-- em unidades diferentes — por isso aqui e não em `profiles`).
alter table public.user_clinic_roles
  add column if not exists career_level_id uuid references public.career_levels (id);

-- -----------------------------------------------------------------------------
-- 2) A TABELA DE REPASSE, com vigência
-- -----------------------------------------------------------------------------
create table if not exists public.provider_payout_rates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id),
  procedure_id uuid not null references public.procedures (id),
  -- Uma linha vale para um NÍVEL **ou** para uma PESSOA, nunca os dois.
  level_id uuid references public.career_levels (id),
  provider_id uuid references public.profiles (id),
  amount_cents bigint not null check (amount_cents >= 0),
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint payout_rate_target_check check (
    (level_id is not null and provider_id is null)
    or (level_id is null and provider_id is not null)
  )
);

create index if not exists provider_payout_rates_lookup_idx
  on public.provider_payout_rates (procedure_id, valid_from);

alter table public.provider_payout_rates enable row level security;

drop policy if exists "provider_payout_rates_select" on public.provider_payout_rates;
create policy "provider_payout_rates_select" on public.provider_payout_rates
  for select to authenticated
  using (
    clinic_id is null or clinic_id in (select public.finance_visible_clinic_ids())
  );

drop policy if exists "provider_payout_rates_write" on public.provider_payout_rates;
create policy "provider_payout_rates_write" on public.provider_payout_rates
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_post_finance(clinic_id))
  );

-- O valor vigente NA DATA do procedimento. Individual vence nível; entre as
-- vigentes, a mais recente manda. Espelha src/lib/finance/payout.ts.
create or replace function public.payout_rate_for(
  p_procedure_id uuid,
  p_provider_id uuid,
  p_clinic_id uuid,
  p_date date default current_date
)
returns table (rate_id uuid, amount_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with lvl as (
    select ucr.career_level_id
    from public.user_clinic_roles ucr
    where ucr.user_id = p_provider_id and ucr.clinic_id = p_clinic_id
    limit 1
  )
  select r.id, r.amount_cents
  from public.provider_payout_rates r
  where r.procedure_id = p_procedure_id
    and r.valid_from <= p_date
    and (r.valid_to is null or r.valid_to >= p_date)
    and (r.clinic_id is null or r.clinic_id = p_clinic_id)
    and (
      r.provider_id = p_provider_id
      or (r.provider_id is null
          and r.level_id = (select career_level_id from lvl))
    )
  -- Individual primeiro; depois a vigência mais recente.
  order by (r.provider_id is not null) desc, r.valid_from desc
  limit 1;
$$;

grant execute on function public.payout_rate_for(uuid, uuid, uuid, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A APURAÇÃO — nasce quando o procedimento é CONCLUÍDO
-- -----------------------------------------------------------------------------
create table if not exists public.provider_payouts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  provider_id uuid not null references public.profiles (id),
  session_id uuid not null references public.treatment_sessions (id) on delete cascade,
  procedure_id uuid references public.procedures (id),
  procedure_name text,
  -- Competência: a data em que o procedimento foi FEITO. Quem produziu em
  -- julho aparece no resultado de julho, mesmo recebendo em agosto.
  accrual_date date not null,
  -- CONGELADO: reajuste de tabela depois disto não mexe aqui.
  amount_cents bigint not null default 0,
  rate_id uuid references public.provider_payout_rates (id),
  closing_id uuid,
  created_at timestamptz not null default now()
);

-- Uma apuração por sessão: concluir de novo não duplica repasse.
create unique index if not exists provider_payouts_session_unique
  on public.provider_payouts (session_id);
create index if not exists provider_payouts_period_idx
  on public.provider_payouts (clinic_id, accrual_date, provider_id);

alter table public.provider_payouts enable row level security;

drop policy if exists "provider_payouts_select" on public.provider_payouts;
create policy "provider_payouts_select" on public.provider_payouts
  for select to authenticated
  using (
    clinic_id in (select public.finance_visible_clinic_ids())
    -- O dentista vê o PRÓPRIO repasse (e só ele).
    or provider_id = (select auth.uid())
  );

drop policy if exists "provider_payouts_write" on public.provider_payouts;
create policy "provider_payouts_write" on public.provider_payouts
  for all to authenticated
  using (public.can_post_finance(clinic_id))
  with check (public.can_post_finance(clinic_id));

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
  -- Só quando a sessão PASSA a concluída.
  if new.status <> 'done' or coalesce(old.status, '') = 'done' then
    return new;
  end if;

  -- Quem EXECUTOU manda; sem isso, o profissional que o Planner indicou.
  v_provider := coalesce(new.executed_by, new.planner_provider_id);
  if v_provider is null then return new; end if;

  v_when := coalesce(new.done_at::date, public.today_br());

  select * into v_rate
  from public.payout_rate_for(
    new.procedure_id, v_provider, new.clinic_id, v_when);

  -- Sem tabela cadastrada: registra com valor ZERO em vez de não registrar.
  -- Assim o procedimento aparece na apuração e alguém percebe que falta
  -- cadastrar — silêncio aqui viraria dentista recebendo a menos.
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

drop trigger if exists treatment_sessions_accrue_payout on public.treatment_sessions;
create trigger treatment_sessions_accrue_payout
  after update of status on public.treatment_sessions
  for each row execute function public.accrue_session_payout();

-- -----------------------------------------------------------------------------
-- 4) O FECHAMENTO MENSAL
-- -----------------------------------------------------------------------------
create table if not exists public.payout_closings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  -- Primeiro dia do mês de competência.
  period_month date not null,
  bonus_percent numeric(5,2) not null default 0
    check (bonus_percent >= 0 and bonus_percent <= 100),
  fixed_cents bigint not null default 0,
  bonus_cents bigint not null default 0,
  total_cents bigint not null default 0,
  status text not null default 'aberto'
    check (status in ('aberto', 'fechado')),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create unique index if not exists payout_closings_period_unique
  on public.payout_closings (clinic_id, period_month);

alter table public.payout_closings enable row level security;

drop policy if exists "payout_closings_select" on public.payout_closings;
create policy "payout_closings_select" on public.payout_closings
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "payout_closings_write" on public.payout_closings;
create policy "payout_closings_write" on public.payout_closings
  for all to authenticated
  using (public.can_post_finance(clinic_id))
  with check (public.can_post_finance(clinic_id));

/**
 * Fecha o mês: consolida por dentista, aplica o bônus sobre o TOTAL do período
 * e gera UMA conta a pagar por dentista.
 *
 * NÃO paga ninguém: quem paga é o Financeiro, pelo fluxo de contas a pagar que
 * já existe, com a alçada da conta.
 */
create or replace function public.close_payout_month(
  p_clinic_id uuid,
  p_month date,
  p_bonus_percent numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_id uuid;
  v_fixed bigint := 0;
  v_bonus bigint := 0;
  v_user uuid := (select auth.uid());
  r record;
  v_provider_total bigint;
  v_provider_bonus bigint;
  v_name text;
begin
  if not public.can_post_finance(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if exists (select 1 from public.payout_closings
             where clinic_id = p_clinic_id and period_month = v_month
               and status = 'fechado') then
    raise exception 'ALREADY_CLOSED';
  end if;

  select coalesce(sum(amount_cents), 0) into v_fixed
  from public.provider_payouts
  where clinic_id = p_clinic_id
    and accrual_date >= v_month and accrual_date < v_next
    and closing_id is null;

  if v_fixed = 0 then raise exception 'NOTHING_TO_CLOSE'; end if;

  v_bonus := round(v_fixed * greatest(0, coalesce(p_bonus_percent, 0)) / 100.0);

  insert into public.payout_closings
    (clinic_id, period_month, bonus_percent, fixed_cents, bonus_cents,
     total_cents, status, closed_at, closed_by)
  values (p_clinic_id, v_month, coalesce(p_bonus_percent, 0), v_fixed, v_bonus,
          v_fixed + v_bonus, 'fechado', now(), v_user)
  on conflict (clinic_id, period_month) do update set
    bonus_percent = excluded.bonus_percent,
    fixed_cents = excluded.fixed_cents,
    bonus_cents = excluded.bonus_cents,
    total_cents = excluded.total_cents,
    status = 'fechado', closed_at = now(), closed_by = v_user
  returning id into v_id;

  -- Trava o período: procedimento lançado depois cai no mês seguinte.
  update public.provider_payouts set closing_id = v_id
  where clinic_id = p_clinic_id
    and accrual_date >= v_month and accrual_date < v_next
    and closing_id is null;

  -- Uma conta a pagar POR DENTISTA — é assim que o Financeiro paga e concilia.
  for r in
    select provider_id, sum(amount_cents) as fixed
    from public.provider_payouts
    where closing_id = v_id
    group by provider_id
  loop
    v_provider_bonus := round(
      r.fixed * greatest(0, coalesce(p_bonus_percent, 0)) / 100.0);
    v_provider_total := r.fixed + v_provider_bonus;
    select full_name into v_name from public.profiles where id = r.provider_id;

    -- REPASSE FIXO em 2.1.01 e BÔNUS em 2.1.02, separados: o plano de contas
    -- tem uma conta para cada, e juntar impediria a DRE de mostrar quanto do
    -- custo direto é produção e quanto é premiação.
    insert into public.payables
      (clinic_id, account_code, description, reference, accrual_date, due_date,
       amount_cents, status, created_by)
    values (
      p_clinic_id, '2.1.01',
      'Repasse — ' || coalesce(v_name, 'profissional') || ' · '
        || to_char(v_month, 'MM/YYYY'),
      'REP-' || to_char(v_month, 'YYYYMM'),
      v_month, (v_next + 4), r.fixed, 'aberta', v_user);

    if v_provider_bonus > 0 then
      insert into public.payables
        (clinic_id, account_code, description, reference, accrual_date,
         due_date, amount_cents, status, notes, created_by)
      values (
        p_clinic_id, '2.1.02',
        'Bônus sobre repasse — ' || coalesce(v_name, 'profissional') || ' · '
          || to_char(v_month, 'MM/YYYY'),
        'REP-' || to_char(v_month, 'YYYYMM'),
        v_month, (v_next + 4), v_provider_bonus, 'aberta',
        p_bonus_percent || '% sobre o repasse do período.', v_user);
    end if;
  end loop;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, p_clinic_id, 'create', 'payout_closing', v_id::text,
          jsonb_build_object('month', v_month, 'total', v_fixed + v_bonus));

  return v_id;
end;
$$;

grant execute on function public.close_payout_month(uuid, date, numeric)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) MARGEM MÍNIMA (o alerta da negociação)
-- -----------------------------------------------------------------------------
alter table public.commercial_rules
  add column if not exists min_margin_percent numeric(5,2)
    check (min_margin_percent is null
           or (min_margin_percent >= 0 and min_margin_percent <= 100));

comment on column public.commercial_rules.min_margin_percent is
  'Margem mínima da venda. Abaixo dela o sistema AVISA na negociação — não '
  'bloqueia: o teto de desconto já é a trava, e travar duas vezes a mesma '
  'coisa só ensina a ignorar o aviso.';

create or replace function public.min_margin_percent(p_clinic uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.min_margin_percent from public.commercial_rules u
      where u.clinic_id = p_clinic),
    (select n.min_margin_percent from public.commercial_rules n
      where n.clinic_id is null));
$$;

grant execute on function public.min_margin_percent(uuid) to authenticated;

/**
 * O repasse ESTIMADO de uma opção de plano — para o alerta de margem, antes de
 * qualquer procedimento existir. Usa a tabela vigente hoje e o profissional
 * indicado pelo Planner; sem indicação, o nível do próprio item não existe e a
 * linha entra como zero (a tela avisa que a estimativa está incompleta).
 */
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

grant execute on function public.estimated_option_payout(uuid, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6) Níveis iniciais da rede (o dono ajusta depois)
-- -----------------------------------------------------------------------------
insert into public.career_levels (clinic_id, name, sort_order)
select null, v.name, v.ord
from (values ('Júnior', 1), ('Pleno', 2), ('Sênior', 3), ('Especialista', 4))
  as v(name, ord)
where not exists (select 1 from public.career_levels where clinic_id is null);

select
  (select count(*) from public.career_levels) as niveis_de_carreira,
  (select count(*) from public.provider_payout_rates) as linhas_de_repasse,
  (select count(*) from public.provider_payouts) as repasses_apurados,
  (select public.min_margin_percent(null)) as margem_minima_da_rede;
