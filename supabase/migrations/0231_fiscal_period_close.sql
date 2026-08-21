-- =============================================================================
-- 0231 — FIN7.4: fechamento de competência
-- -----------------------------------------------------------------------------
-- A trava que o dono adiou no FIN6 ("trava é assunto de processo, e travar
-- antes de conferir os primeiros meses só atrapalharia"). A estrutura
-- (`fiscal_periods`) existe desde o FIN0; aqui vem o efeito.
--
-- Depois que alguém conferiu janeiro e disse "janeiro está fechado", o
-- resultado de janeiro não pode mudar sozinho na semana seguinte.
--
-- A TRAVA NÃO VALE PARA PAGAMENTO E RECEBIMENTO. Pagar hoje uma conta de
-- janeiro NÃO altera o resultado de janeiro — desde a 0226 `receipt_cash` e
-- `payable_cash` nem entram na DRE. Se a trava pegasse nelas, fechar o mês
-- quebraria o trabalho da recepção e do financeiro no dia seguinte, e o
-- resultado seria previsível: ninguém fecharia mês nenhum.
--
-- NEM TODA ALTERAÇÃO MUDA O RESULTADO. Conciliar um lançamento escreve
-- `reconciled_at` e não move um centavo; travar isso impediria conciliar o
-- extrato de um mês fechado, que é justamente quando se concilia. O gatilho só
-- reage ao que muda dinheiro: valor, direção, conta, data de competência,
-- status e centro de custo.
--
-- QUEM FECHA × QUEM REABRE (decisão do dono, 17/08/2026): a UNIDADE fecha — é
-- ela que sabe se terminou de lançar o mês; a FRANQUEADORA reabre. Trava que
-- quem está travado destrava sozinho protege pouco; vira lembrete, não
-- controle. Reabrir exige justificativa escrita (campo do FIN0).
--
-- NÃO SE FECHA FORA DE ORDEM. Se fevereiro está aberto e tem movimento, março
-- não fecha — senão "fechado" não significa nada.
--
-- A CONFERÊNCIA NÃO BLOQUEIA. Ela lista o que ficou pendente e o botão passa a
-- dizer "fechar mesmo assim". Bloquear faria o mês nunca fechar, que dá no
-- mesmo que não ter trava.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O GUARDA
-- -----------------------------------------------------------------------------
create or replace function public.fiscal_period_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dates date[];
  v_d date;
begin
  -- Liquidação não é competência (ver cabeçalho).
  if new.source_type in ('receipt_cash', 'payable_cash') then
    return new;
  end if;
  -- Patrimônio não é resultado: estoque e bens seguem entrando.
  if new.account_code like '6%' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Nada que mude dinheiro? Deixa passar (conciliação, por exemplo).
    if new.amount_cents is not distinct from old.amount_cents
       and new.direction is not distinct from old.direction
       and new.account_code is not distinct from old.account_code
       and new.accrual_date is not distinct from old.accrual_date
       and new.status is not distinct from old.status
       and new.cost_center_id is not distinct from old.cost_center_id then
      return new;
    end if;
    -- Tirar um lançamento de um mês fechado é tão proibido quanto pôr.
    v_dates := array[new.accrual_date, old.accrual_date];
  else
    v_dates := array[new.accrual_date];
  end if;

  foreach v_d in array v_dates loop
    if v_d is not null and exists (
      select 1 from public.fiscal_periods p
       where p.clinic_id = new.clinic_id
         and p.status = 'closed'
         and p.year = extract(year from v_d)::integer
         and p.month = extract(month from v_d)::integer
    ) then
      raise exception 'PERIOD_CLOSED';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists financial_entries_period_guard on public.financial_entries;
create trigger financial_entries_period_guard
  before insert or update on public.financial_entries
  for each row execute function public.fiscal_period_guard();

-- -----------------------------------------------------------------------------
-- 2) A CONFERÊNCIA ANTES DE FECHAR
-- -----------------------------------------------------------------------------
-- Fechar sem olhar é carimbo. `severity`: 'alta' = o resultado do mês fica
-- errado se fechar assim; 'media' = vale conferir.
create or replace function public.fiscal_period_checklist(
  p_clinic_id uuid,
  p_year integer,
  p_month integer
)
returns table (
  key text,
  label text,
  items integer,
  amount_cents bigint,
  severity text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      make_date(p_year, p_month, 1) as d0,
      (make_date(p_year, p_month, 1) + interval '1 month'
        - interval '1 day')::date as d1
  ),
  allowed as (select public.can_see_clinic_finance(p_clinic_id) as ok)

  -- O mais perigoso: fechar sem depreciar deixa o resultado subestimado, e
  -- corrigir depois exige reabrir o período.
  select
    'depreciacao'::text,
    'Bens em uso sem depreciação lançada neste mês'::text,
    count(*)::integer,
    0::bigint,
    'alta'::text
  from public.fixed_assets a, bounds b, allowed
  where allowed.ok
    and a.clinic_id = p_clinic_id
    and a.status = 'ativo'
    and a.in_service_date < b.d0
    and not exists (
      select 1 from public.asset_depreciations d
       where d.asset_id = a.id
         and d.period_month = b.d0
    )
  having count(*) > 0

  union all

  select
    'contas_vencidas'::text,
    'Contas a pagar do mês vencidas e não pagas'::text,
    count(*)::integer,
    coalesce(sum(p.amount_cents - coalesce(p.paid_amount_cents, 0)), 0)::bigint,
    'media'::text
  from public.payables p, bounds b, allowed
  where allowed.ok
    and p.clinic_id = p_clinic_id
    and p.due_date between b.d0 and b.d1
    and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
    and p.amount_cents > coalesce(p.paid_amount_cents, 0)
  having count(*) > 0

  union all

  select
    'parcelas_vencidas'::text,
    'Parcelas do mês vencidas sem baixa'::text,
    count(*)::integer,
    coalesce(sum(i.amount_cents - coalesce(i.paid_amount_cents, 0)), 0)::bigint,
    'media'::text
  from public.payment_installments i, bounds b, allowed
  where allowed.ok
    and i.clinic_id = p_clinic_id
    and coalesce(i.expected_settlement_date, i.due_date) between b.d0 and b.d1
    and i.status in ('em_aberto', 'parcial')
    and i.amount_cents > coalesce(i.paid_amount_cents, 0)
  having count(*) > 0

  union all

  select
    'banco'::text,
    'Movimentos do banco ainda não conciliados'::text,
    count(*)::integer,
    coalesce(sum(abs(t.amount_cents)), 0)::bigint,
    'media'::text
  from public.bank_transactions t, bounds b, allowed
  where allowed.ok
    and t.clinic_id = p_clinic_id
    and t.posted_at between b.d0 and b.d1
    and t.status = 'pendente'
  having count(*) > 0

  union all

  select
    'estoque'::text,
    'Sessões concluídas no mês que não baixaram material'::text,
    count(*)::integer,
    0::bigint,
    'media'::text
  from public.treatment_sessions s, bounds b, allowed
  where allowed.ok
    and s.clinic_id = p_clinic_id
    and s.status = 'done'
    and s.done_at::date between b.d0 and b.d1
    and not exists (
      -- O movimento aponta para a sessão por (source_type, source_id) — é
      -- assim que a baixa automática grava desde a 0217.
      select 1 from public.stock_movements m
       where m.source_type = 'session' and m.source_id = s.id
    )
  having count(*) > 0;
$$;

grant execute on function public.fiscal_period_checklist(uuid, integer, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) FECHAR — a unidade
-- -----------------------------------------------------------------------------
create or replace function public.close_fiscal_period(
  p_clinic_id uuid,
  p_year integer,
  p_month integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_end date := (make_date(p_year, p_month, 1) + interval '1 month'
                 - interval '1 day')::date;
  v_earlier date;
begin
  if not (public.is_admin_master() or public.can_post_finance(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Mês que ainda não terminou não fecha: sempre entraria lançamento depois.
  if v_end >= public.today_br() then
    raise exception 'PERIOD_NOT_ENDED';
  end if;

  -- Fora de ordem, "fechado" não significa nada.
  select min(e.accrual_date) into v_earlier
    from public.financial_entries e
   where e.clinic_id = p_clinic_id
     and e.accrual_date < make_date(p_year, p_month, 1)
     and e.status in ('settled', 'open')
     and not exists (
       select 1 from public.fiscal_periods p
        where p.clinic_id = p_clinic_id
          and p.status = 'closed'
          and p.year = extract(year from e.accrual_date)::integer
          and p.month = extract(month from e.accrual_date)::integer
     );
  if v_earlier is not null then
    raise exception 'EARLIER_PERIOD_OPEN: %', to_char(v_earlier, 'MM/YYYY');
  end if;

  insert into public.fiscal_periods
    (clinic_id, year, month, status, closed_at, closed_by)
  values (p_clinic_id, p_year, p_month, 'closed', now(), v_user)
  on conflict (clinic_id, year, month) do update
    set status = 'closed',
        closed_at = now(),
        closed_by = v_user,
        reopened_at = null,
        reopened_by = null,
        reopen_reason = null;
end;
$$;

revoke all on function public.close_fiscal_period(uuid, integer, integer) from public;
grant execute on function public.close_fiscal_period(uuid, integer, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) REABRIR — a franqueadora, com justificativa
-- -----------------------------------------------------------------------------
create or replace function public.reopen_fiscal_period(
  p_clinic_id uuid,
  p_year integer,
  p_month integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  -- Quem fechou não reabre: é o que separa um controle de um botão.
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.fiscal_periods set
    status = 'open',
    reopened_at = now(),
    reopened_by = v_user,
    reopen_reason = btrim(p_reason)
  where clinic_id = p_clinic_id and year = p_year and month = p_month;
end;
$$;

revoke all on function public.reopen_fiscal_period(uuid, integer, integer, text)
  from public;
grant execute on function public.reopen_fiscal_period(uuid, integer, integer, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A SITUAÇÃO DE CADA MÊS DO ANO
-- -----------------------------------------------------------------------------
create or replace function public.fiscal_year_status(
  p_clinic_id uuid,
  p_year integer
)
returns table (
  month integer,
  status text,
  closed_at timestamptz,
  closed_by_name text,
  reopened_at timestamptz,
  reopen_reason text,
  entries integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.month,
    coalesce(p.status, 'open'),
    p.closed_at,
    prof.full_name,
    p.reopened_at,
    p.reopen_reason,
    (select count(*) from public.financial_entries e
      where e.clinic_id = p_clinic_id
        and extract(year from e.accrual_date)::integer = p_year
        and extract(month from e.accrual_date)::integer = m.month
        and e.status in ('settled', 'open'))::integer
  from (select generate_series(1, 12) as month) m
  left join public.fiscal_periods p
    on p.clinic_id = p_clinic_id and p.year = p_year and p.month = m.month
  left join public.profiles prof on prof.id = p.closed_by
  where public.can_see_clinic_finance(p_clinic_id)
  order by m.month;
$$;

grant execute on function public.fiscal_year_status(uuid, integer) to authenticated;

-- Consulta barata para as telas de relatório marcarem o selo.
create or replace function public.is_period_closed(
  p_clinic_id uuid,
  p_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fiscal_periods p
     where p.clinic_id = p_clinic_id
       and p.status = 'closed'
       and p.year = extract(year from p_date)::integer
       and p.month = extract(month from p_date)::integer
  ) and public.can_see_clinic_finance(p_clinic_id);
$$;

grant execute on function public.is_period_closed(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.fiscal_periods where status = 'closed')
    as periodos_fechados,
  (select count(*) from public.fiscal_periods where reopened_at is not null)
    as periodos_ja_reabertos,
  (select count(*) from pg_trigger
    where tgname = 'financial_entries_period_guard') as guarda_instalada;
