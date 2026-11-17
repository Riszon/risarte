-- =============================================================================
-- 4021a — ASA6: a CONFERÊNCIA DAS TAXAS da rede (spec 20.17, aprovada com 1a–6a
-- e os ajustes de 16/11/2026 — 20.17.8)
-- -----------------------------------------------------------------------------
--   * Só CONFERE e MOSTRA: não cobra, não dispensa e não muda nenhum lançamento.
--   * A conta do mês, por unidade, do 1º mês da cobrança mensal (o que o dono
--     ligar na Central) até o último mês fechado:
--       devido = retido + a reter + faturado + dispensado + ainda a cobrar.
--   * A rotina da noite grava em `reconciliation_issues` o que não bater: linha
--     em dois donos, linha sem dono, pago diferente do faturado, caixa diferente,
--     split a mais (acima da tolerância da Central), conta a pagar desatualizada
--     e a diferença da conta do mês. Fecha sozinha quando o problema some.
--   * Ignorar: só o Financeiro da Franqueadora ou o Admin Master, com motivo;
--     se o valor mudar, reabre. As ignoradas ficam numa lista própria.
--   * O resumo do dia ao Financeiro, só com divergência nova.
--   * O Gerente e o franqueado veem a da própria unidade, só leitura.
-- Depende da 4021. Nenhuma chamada ao Asaas. Idempotente. Não apaga dado.
-- =============================================================================

create table if not exists public.reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null,
  clinic_id uuid not null references public.clinics(id),
  period date not null,
  kind text not null check (kind in ('linha_dois_donos', 'linha_sem_dono', 'pago_diferente', 'caixa_diferente',
                                     'split_a_mais', 'conta_desatualizada', 'diferenca_do_mes')),
  ref_type text,
  ref_id uuid,
  amount_cents bigint not null default 0,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'aberta' check (status in ('aberta', 'ignorada', 'resolvida')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  ignored_at timestamptz,
  ignored_by uuid,
  ignored_reason text,
  ignored_amount_cents bigint,
  reopened_at timestamptz,
  created_at timestamptz not null default now()
);
-- Uma só por tipo, linha e mês enquanto não resolvida.
create unique index if not exists reconciliation_issues_open_key
  on public.reconciliation_issues (issue_key) where status <> 'resolvida';
create index if not exists reconciliation_issues_clinic on public.reconciliation_issues (clinic_id, period);
alter table public.reconciliation_issues enable row level security;

-- As rodadas da rotina (o resumo do dia sai uma vez).
create table if not exists public.reconciliation_runs (
  run_on date primary key,
  ran_at timestamptz not null default now(),
  new_issues integer not null default 0,
  open_issues integer not null default 0,
  notified_at timestamptz
);
alter table public.reconciliation_runs enable row level security;

-- -----------------------------------------------------------------------------
-- 1) A CONTA DO MÊS, linha a linha (cada linha de taxa e cada taxa fixa)
-- -----------------------------------------------------------------------------
create or replace function public._franchise_month_lines(p_clinic_id uuid, p_period date)
returns table (ref_type text, ref_id uuid, fee text, devido bigint, retido bigint, a_reter bigint,
               dispensado bigint, faturado bigint, ainda bigint)
language sql stable security definer set search_path = '' as $$
  -- As taxas percentuais: a linha estornada não é devida (o que já foi faturado dela volta como ajuste).
  select 'split_charge'::text, sc.id, sc.fee,
         case when sc.reversed then 0 else sc.amount_cents end,
         case when not sc.reversed and not public._split_charge_awaiting(sc.id) then sc.retained_cents else 0 end,
         case when not sc.reversed and public._split_charge_awaiting(sc.id) then sc.retained_cents else 0 end,
         case when not sc.reversed and sc.waived_at is not null then greatest(sc.amount_cents - sc.retained_cents, 0) else 0 end,
         public._franchise_invoiced_line(sc.id),
         public._franchise_line_due(sc.id) - public._franchise_invoiced_line(sc.id)
    from public.split_charges sc
   where sc.clinic_id = p_clinic_id and sc.period_month = p_period
  union all
  -- As taxas fixas: a dispensada é devida e dispensada; a cancelada sem dispensa não é devida.
  select 'payable', p.id, p.network_fee,
         case when w.clinic_id is not null or p.status <> 'cancelada' then p.amount_cents else 0 end,
         0, 0,
         case when w.clinic_id is not null then p.amount_cents else 0 end,
         public._franchise_invoiced_payable(p.id),
         case when w.clinic_id is not null or p.status = 'cancelada' then 0 else p.amount_cents end
           - public._franchise_invoiced_payable(p.id)
    from public.payables p
    join public.network_fee_types t on t.key = p.network_fee and t.kind = 'fixed'
    left join public.network_fee_fixed_waivers w on w.clinic_id = p.clinic_id and w.fee = p.network_fee and w.period = p.fee_period
   where p.clinic_id = p_clinic_id and p.fee_period = p_period;
$$;

-- O faturado do mês contado À PARTE (todas as linhas de cobrança mensal do mês,
-- fora o saldo anterior): é o que faz a conta fechar ser uma conferência.
create or replace function public._franchise_month_invoiced(p_clinic_id uuid, p_period date)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(i.amount_cents), 0)::bigint
    from public.franchise_monthly_items i join public.franchise_monthly_batches b on b.id = i.batch_id
   where i.clinic_id = p_clinic_id and i.origin_period = p_period and i.kind <> 'saldo_anterior'
     and i.status in ('ativo', 'contestado') and public._franchise_batch_holds(b.status);
$$;

create or replace function public._franchise_month_account(p_clinic_id uuid, p_period date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with l as (select * from public._franchise_month_lines(p_clinic_id, p_period)),
  s as (
    select coalesce(sum(devido), 0) devido, coalesce(sum(retido), 0) retido, coalesce(sum(a_reter), 0) a_reter,
           coalesce(sum(dispensado), 0) dispensado, coalesce(sum(ainda), 0) ainda
      from l)
  select jsonb_build_object(
    'devido', s.devido, 'retido', s.retido, 'a_reter', s.a_reter,
    'faturado', public._franchise_month_invoiced(p_clinic_id, p_period),
    'dispensado', s.dispensado, 'ainda', s.ainda,
    'diferenca', s.devido - (s.retido + s.a_reter + public._franchise_month_invoiced(p_clinic_id, p_period) + s.dispensado + s.ainda))
  from s;
$$;

-- -----------------------------------------------------------------------------
-- 2) A ROTINA: acha as divergências, fecha as que sumiram, avisa as novas
-- -----------------------------------------------------------------------------
create or replace function public._franchise_reconcile_found(p_clinic_id uuid)
returns table (kind text, period date, ref_type text, ref_id uuid, amount_cents bigint, detail jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg record;
  v_last date := (date_trunc('month', public.today_br()) - interval '1 month')::date;
  v_tol bigint;
  v_p date;
  v_acc jsonb;
  pb public.franchise_prior_balance%rowtype;
begin
  select * into cfg from public._franchise_billing_cfg(p_clinic_id);
  if cfg.monthly_from is null then return; end if;
  select coalesce(tolerance_cents, 10) into v_tol from public.gateway_split_settings where id;
  v_tol := coalesce(v_tol, 10);
  select * into pb from public.franchise_prior_balance where clinic_id = p_clinic_id;

  v_p := cfg.monthly_from;
  while v_p <= v_last loop
    -- Linha em dois donos: faturada a mais do que vale hoje.
    return query
      select 'linha_dois_donos', v_p, l.ref_type, l.ref_id, -l.ainda,
             jsonb_build_object('fee', l.fee, 'devido_hoje', l.devido - l.retido - l.a_reter - l.dispensado, 'faturado', l.faturado)
        from public._franchise_month_lines(p_clinic_id, v_p) l
       where l.ainda < 0
         -- o crédito já montado numa prévia aberta ou aprovada vai resolver: ainda conta como divergência até ser faturado.
         ;
    -- Linha sem dono: devia ter entrado numa cobrança mensal aberta depois que ela nasceu.
    return query
      select 'linha_sem_dono', v_p, 'split_charge', sc.id, public._franchise_line_due(sc.id) - public._franchise_invoiced_line(sc.id),
             jsonb_build_object('fee', sc.fee, 'criada_em', sc.created_at)
        from public.split_charges sc
       where sc.clinic_id = p_clinic_id and sc.period_month = v_p
         and public._franchise_line_due(sc.id) - public._franchise_invoiced_line(sc.id) > 0
         and exists (select 1 from public.franchise_monthly_batches b
                      where b.clinic_id = p_clinic_id and public._franchise_batch_holds(b.status)
                        and b.period >= sc.period_month and b.opened_at > sc.created_at);
    return query
      select 'linha_sem_dono', v_p, 'payable', p.id, p.amount_cents - public._franchise_invoiced_payable(p.id),
             jsonb_build_object('fee', p.network_fee)
        from public.payables p join public.network_fee_types t on t.key = p.network_fee and t.kind = 'fixed'
       where p.clinic_id = p_clinic_id and p.fee_period = v_p and p.status <> 'cancelada'
         and not exists (select 1 from public.network_fee_fixed_waivers w where w.clinic_id = p.clinic_id and w.fee = p.network_fee and w.period = p.fee_period)
         and p.amount_cents - public._franchise_invoiced_payable(p.id) > 0
         and exists (select 1 from public.franchise_monthly_batches b
                      where b.clinic_id = p_clinic_id and public._franchise_batch_holds(b.status)
                        and b.period >= p.fee_period and b.opened_at > p.created_at);
    -- Conta a pagar desatualizada: a conta do mês não bate com as linhas dela.
    return query
      select 'conta_desatualizada', v_p, 'payable', p.id,
             p.amount_cents - x.esperado,
             jsonb_build_object('fee', p.network_fee, 'conta', p.amount_cents, 'linhas', x.esperado)
        from public.payables p
        join public.network_fee_types t on t.key = p.network_fee and t.kind = 'percent'
        cross join lateral (
          select coalesce(sum(greatest(sc.amount_cents - sc.retained_cents, 0)), 0)::bigint as esperado
            from public.split_charges sc
           where sc.clinic_id = p.clinic_id and sc.fee = p.network_fee and sc.period_month = p.fee_period
             and not sc.reversed and sc.waived_at is null) x
       where p.clinic_id = p_clinic_id and p.fee_period = v_p and p.status <> 'cancelada'
         and p.amount_cents <> x.esperado;
    -- A diferença da conta do mês (tolerância zero).
    v_acc := public._franchise_month_account(p_clinic_id, v_p);
    if (v_acc->>'diferenca')::bigint <> 0 then
      return query select 'diferenca_do_mes', v_p, null::text, null::uuid, (v_acc->>'diferenca')::bigint, v_acc;
    end if;
    v_p := (v_p + interval '1 month')::date;
  end loop;

  -- A cobrança paga: o pago e o caixa (tolerância zero).
  return query
    select 'pago_diferente', b.period, 'batch', b.id, coalesce(b.paid_cents, 0) - coalesce(b.late_cents, 0) - coalesce(b.total_cents, 0),
           jsonb_build_object('faturado', b.total_cents, 'pago', b.paid_cents, 'multa_e_juros', b.late_cents, 'baixa_feita', b.settled_at is not null)
      from public.franchise_monthly_batches b
     where b.clinic_id = p_clinic_id and b.status = 'paga'
       and (b.settled_at is null or coalesce(b.paid_cents, 0) - coalesce(b.late_cents, 0) <> coalesce(b.total_cents, 0));
  return query
    select 'caixa_diferente', b.period, 'batch', b.id, x.unidade - b.total_cents,
           jsonb_build_object('faturado', b.total_cents, 'caixa_unidade', x.unidade, 'caixa_franqueadora', x.franqueadora)
      from public.franchise_monthly_batches b
      cross join lateral (
        select coalesce(sum(f.amount_cents) filter (where f.source_type = 'payable_cash' and f.clinic_id = b.clinic_id), 0)::bigint as unidade,
               coalesce(sum(f.amount_cents) filter (where f.source_type = 'receipt_cash' and f.clinic_id <> b.clinic_id), 0)::bigint as franqueadora
          from public.payable_payments pp
          join public.financial_entries f on f.source_id = pp.id and f.source_type in ('payable_cash', 'receipt_cash')
         where pp.franchise_batch_id = b.id) x
     where b.clinic_id = p_clinic_id and b.status = 'paga' and b.settled_at is not null
       and (x.unidade <> b.total_cents or x.franqueadora <> b.total_cents);
  -- O split a mais (acima da tolerância da Central), dos pagamentos desde o 1º mês.
  return query
    select 'split_a_mais', date_trunc('month', c.paid_on)::date, 'charge_split', cs.id, cs.excess_cents,
           jsonb_build_object('cobranca', c.id, 'recebido', cs.settled_cents, 'tolerancia', v_tol)
      from public.charge_splits cs join public.charges c on c.id = cs.charge_id
     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol
       and c.paid_on >= cfg.monthly_from;
end;
$$;

create or replace function public._franchise_reconcile_run()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u record;
  f record;
  v_key text;
  v_now timestamptz := now();
  v_new integer := 0;
  v_seen text[] := '{}';
  r public.reconciliation_issues%rowtype;
  v_open integer;
  v_closed integer;
begin
  for u in select s.clinic_id from public.franchise_billing_unit_settings s where s.monthly_from is not null loop
    for f in select * from public._franchise_reconcile_found(u.clinic_id) loop
      v_key := f.kind || '|' || u.clinic_id || '|' || f.period || '|' || coalesce(f.ref_id::text, '');
      v_seen := v_seen || v_key;
      select * into r from public.reconciliation_issues where issue_key = v_key and status <> 'resolvida';
      if r.id is null then
        insert into public.reconciliation_issues (issue_key, clinic_id, period, kind, ref_type, ref_id, amount_cents, detail)
        values (v_key, u.clinic_id, f.period, f.kind, f.ref_type, f.ref_id, f.amount_cents, f.detail);
        v_new := v_new + 1;
      elsif r.status = 'ignorada' and r.ignored_amount_cents is distinct from f.amount_cents then
        -- O valor mudou: a ignorada volta a abrir.
        update public.reconciliation_issues set status = 'aberta', reopened_at = v_now, amount_cents = f.amount_cents,
               detail = f.detail, last_seen_at = v_now where id = r.id;
        v_new := v_new + 1;
      else
        update public.reconciliation_issues set amount_cents = f.amount_cents, detail = f.detail, last_seen_at = v_now where id = r.id;
      end if;
    end loop;
  end loop;

  -- O que sumiu fecha sozinho (as ignoradas também, se o problema sumiu).
  update public.reconciliation_issues set status = 'resolvida', resolved_at = v_now
   where status in ('aberta', 'ignorada') and not (issue_key = any (v_seen));
  get diagnostics v_closed = row_count;
  select count(*) into v_open from public.reconciliation_issues where status = 'aberta';

  insert into public.reconciliation_runs (run_on, ran_at, new_issues, open_issues)
  values (public.today_br(), v_now, v_new, v_open)
  on conflict (run_on) do update set ran_at = excluded.ran_at,
    new_issues = public.reconciliation_runs.new_issues + excluded.new_issues, open_issues = excluded.open_issues;

  -- O resumo do dia ao Financeiro, só com divergência nova (uma vez por dia).
  if v_new > 0 and (select notified_at from public.reconciliation_runs where run_on = public.today_br()) is null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, null::uuid, 'Conferência das taxas: divergência nova',
           v_new || ' divergência(s) nova(s) na conferência das taxas da rede (' || v_open || ' aberta(s) no total).',
           '/financeiro/cobranca-da-rede?aba=conferencia'
      from public.user_clinic_roles ucr where ucr.role = 'finance_franchisor';
    update public.reconciliation_runs set notified_at = v_now where run_on = public.today_br();
  end if;
  return jsonb_build_object('novas', v_new, 'abertas', v_open, 'fechadas', v_closed);
end;
$$;

-- "Conferir agora" (Financeiro ou Admin).
create or replace function public.franchise_reconciliation_run_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  return public._franchise_reconcile_run();
end;
$$;

-- Ignorar, com motivo (Financeiro ou Admin). Reabre se o valor mudar.
create or replace function public.franchise_reconciliation_ignore(p_issue_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reconciliation_issues%rowtype;
begin
  if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into r from public.reconciliation_issues where id = p_issue_id for update;
  if r.id is null then raise exception 'ISSUE_NOT_FOUND'; end if;
  if r.status <> 'aberta' then raise exception 'ISSUE_NOT_OPEN'; end if;
  update public.reconciliation_issues set status = 'ignorada', ignored_at = now(), ignored_by = (select auth.uid()),
         ignored_reason = btrim(p_reason), ignored_amount_cents = r.amount_cents
   where id = r.id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), r.clinic_id, 'update', 'reconciliation_issue', r.id::text,
          jsonb_build_object('ignored', true, 'reason', btrim(p_reason), 'kind', r.kind, 'amount_cents', r.amount_cents));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) A LEITURA DO PAINEL
-- -----------------------------------------------------------------------------
create or replace function public.franchise_reconciliation_read(p_period date default null, p_clinic_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_manage boolean := public._franchise_can_manage();
  v_period date := coalesce(date_trunc('month', p_period)::date, (date_trunc('month', public.today_br()) - interval '1 month')::date);
  v_units uuid[];
begin
  if p_clinic_id is not null and not public._franchise_can_see(p_clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  select array_agg(s.clinic_id) into v_units
    from public.franchise_billing_unit_settings s
   where s.monthly_from is not null
     and (p_clinic_id is null or s.clinic_id = p_clinic_id)
     and public._franchise_can_see(s.clinic_id);
  v_units := coalesce(v_units, '{}');
  return jsonb_build_object(
    'period', v_period,
    'can_manage', v_manage,
    'last_run', (select to_jsonb(x) from public.reconciliation_runs x order by run_on desc limit 1),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('clinic_id', c.id, 'name', c.name, 'monthly_from', s.monthly_from,
               'account', case when v_period >= s.monthly_from then public._franchise_month_account(c.id, v_period) end)
             order by c.name)
        from public.clinics c join public.franchise_billing_unit_settings s on s.clinic_id = c.id
       where c.id = any (v_units)), '[]'::jsonb),
    'lines', case when p_clinic_id is null then null else coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object('fee_label', public.network_fee_label(l.fee)) order by l.fee, l.ref_type)
        from public._franchise_month_lines(p_clinic_id, v_period) l), '[]'::jsonb) end,
    'issues', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'clinic_id', r.clinic_id, 'clinic_name', c.name, 'period', r.period,
               'kind', r.kind, 'ref_type', r.ref_type, 'ref_id', r.ref_id, 'amount_cents', r.amount_cents, 'detail', r.detail,
               'status', r.status, 'first_seen_at', r.first_seen_at, 'reopened_at', r.reopened_at,
               'ignored_at', r.ignored_at, 'ignored_reason', r.ignored_reason, 'ignored_amount_cents', r.ignored_amount_cents,
               'ignored_by', (select full_name from public.profiles where id = r.ignored_by))
             order by r.status, r.period desc, c.name, r.kind)
        from public.reconciliation_issues r join public.clinics c on c.id = r.clinic_id
       where r.status in ('aberta', 'ignorada') and r.clinic_id = any (v_units)), '[]'::jsonb),
    'overdue', coalesce((
      select jsonb_agg(jsonb_build_object('batch_id', b.id, 'clinic_name', c.name, 'period', b.period, 'total_cents', b.total_cents,
               'due_date', ch.due_date, 'days', public.today_br() - ch.due_date) order by ch.due_date)
        from public.franchise_monthly_batches b join public.clinics c on c.id = b.clinic_id
        join public.charges ch on ch.id = b.charge_id
       where b.status = 'emitida' and ch.status = 'vencida' and public.today_br() - ch.due_date >= 30
         and b.clinic_id = any (v_units)), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) PERMISSÕES, AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
revoke execute on function public._franchise_month_lines(uuid, date) from public, anon, authenticated;
revoke execute on function public._franchise_month_invoiced(uuid, date) from public, anon, authenticated;
revoke execute on function public._franchise_month_account(uuid, date) from public, anon, authenticated;
revoke execute on function public._franchise_reconcile_found(uuid) from public, anon, authenticated;
revoke execute on function public._franchise_reconcile_run() from public, anon, authenticated;
revoke execute on function public.franchise_reconciliation_run_now() from public, anon, authenticated;
revoke execute on function public.franchise_reconciliation_ignore(uuid, text) from public, anon, authenticated;
revoke execute on function public.franchise_reconciliation_read(date, uuid) from public, anon, authenticated;
grant execute on function public.franchise_reconciliation_run_now() to authenticated;
grant execute on function public.franchise_reconciliation_ignore(uuid, text) to authenticated;
grant execute on function public.franchise_reconciliation_read(date, uuid) to authenticated;

select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('reconciliation_issues', 'reconciliation_runs')) as tabelas_novas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('_franchise_month_lines', '_franchise_month_invoiced', '_franchise_month_account', '_franchise_reconcile_found',
                      '_franchise_reconcile_run', 'franchise_reconciliation_run_now', 'franchise_reconciliation_ignore',
                      'franchise_reconciliation_read')) as funcoes_novas,
  (select count(*) from public.reconciliation_issues) as divergencias;
