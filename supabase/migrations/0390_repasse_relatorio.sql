-- =============================================================================
-- 0390 — REPASSE DOS DENTISTAS, ETAPA 2: O RELATÓRIO DE REPASSE
--
-- Plano e as 14 decisões do dono: docs/Financeiro/REPASSE-PLANO.md. Decisões
-- desta etapa (dono, 10/11/2026, as quatro como recomendado):
--   R1) procedimento apurado com R$ 0,00 NÃO entra no relatório (fica nas
--       pendências da 0387; a tela de geração avisa quantos ficaram de fora);
--   R2) o relatório do mês pega tudo o que foi finalizado ATÉ o último dia do
--       mês escolhido e ainda não entrou em relatório (atrasados inclusive);
--   R3) o relatório mostra o nome do cliente; o link abre o prontuário e só
--       funciona para quem já tem acesso a ele (o repasse não dá acesso);
--   R4) imprimir pelo navegador; PDF próprio fica para depois.
--
-- O QUE NASCE:
--   • `payout_reports`: um relatório por DENTISTA e por UNIDADE, com número
--     (RP-000001), mês, o nível do dentista na geração e o total;
--   • `payout_report_items`: os procedimentos do relatório, com o valor
--     CONGELADO na geração; cada um pode ser EXCLUÍDO COM MOTIVO —
--     "adiar" (volta no próximo relatório) ou "nao_pagar" (fora de vez);
--   • `payout_report_events`: a linha do tempo (quem, quando, o quê);
--   • `provider_payouts.withheld`: o "não pagar", com motivo, quem e quando.
--
-- AS TRAVAS (no banco):
--   • um procedimento só está em UM relatório por vez (índice único sobre o
--     item ativo) — é isto que impede pagar duas vezes;
--   • um rascunho por dentista e unidade (gerar de novo completa o rascunho);
--   • "não pagar" não entra em relatório nenhum até alguém reverter, com
--     motivo (`payout_release_withheld`);
--   • o "Fechar o mês" antigo (0209, sai na Etapa 4) não leva o que está em
--     relatório nem o que está em "não pagar" (PAYOUT_IN_REPORT se tentar);
--   • ninguém grava nas tabelas pela API: só as funções.
--
-- QUEM (decisão 1 do dono): gerar, excluir, cancelar e reverter é do
-- FINANCEIRO DA FRANQUEADORA (e do Admin Master). O Gerente da unidade e o
-- franqueado LEEM os relatórios da própria unidade. O dentista ainda não vê
-- nada: passa a ver na Etapa 3, depois da aprovação do Gerente.
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Tabelas
-- -----------------------------------------------------------------------------
create sequence if not exists public.payout_report_code_seq;

create table if not exists public.payout_reports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  provider_id uuid not null references public.profiles (id),
  code text not null unique
    default ('RP-' || lpad(nextval('public.payout_report_code_seq')::text, 6, '0')),
  -- Primeiro dia do mês do relatório (pega o finalizado até o fim dele).
  period_month date not null,
  -- O nível do dentista NA GERAÇÃO (mudar o nível depois não reescreve).
  level_id uuid references public.career_levels (id),
  level_name text,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'cancelado')),
  total_cents bigint not null default 0,
  item_count integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text
);

-- Um rascunho por dentista e unidade.
create unique index if not exists payout_reports_one_draft
  on public.payout_reports (clinic_id, provider_id) where status = 'rascunho';
create index if not exists payout_reports_clinic_idx
  on public.payout_reports (clinic_id, period_month desc);

create table if not exists public.payout_report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.payout_reports (id) on delete restrict,
  clinic_id uuid not null references public.clinics (id),
  payout_id uuid not null references public.provider_payouts (id) on delete restrict,
  -- CONGELADOS na geração.
  finished_on date not null,
  procedure_id uuid references public.procedures (id),
  procedure_name text,
  amount_cents bigint not null,
  status text not null default 'incluido'
    check (status in ('incluido', 'excluido')),
  -- Enquanto verdadeiro, o procedimento está PRESO a este relatório.
  active boolean not null default true,
  exclusion_kind text check (exclusion_kind in ('adiar', 'nao_pagar')),
  exclusion_reason text,
  excluded_by uuid references public.profiles (id),
  excluded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payout_report_items_exclusion_chk
    check ((status = 'excluido') = (exclusion_kind is not null)),
  constraint payout_report_items_active_chk
    check (not (active and status = 'excluido')),
  constraint payout_report_items_once_per_report unique (report_id, payout_id)
);

-- A TRAVA CONTRA PAGAR DUAS VEZES: um procedimento, um relatório por vez.
create unique index if not exists payout_report_items_one_active
  on public.payout_report_items (payout_id) where active;
create index if not exists payout_report_items_report_idx
  on public.payout_report_items (report_id);

create table if not exists public.payout_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.payout_reports (id) on delete restrict,
  item_id uuid references public.payout_report_items (id) on delete restrict,
  clinic_id uuid not null references public.clinics (id),
  action text not null,
  note text,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists payout_report_events_report_idx
  on public.payout_report_events (report_id, created_at);

-- O "não pagar" mora no procedimento apurado.
alter table public.provider_payouts
  add column if not exists withheld boolean not null default false,
  add column if not exists withheld_reason text,
  add column if not exists withheld_by uuid references public.profiles (id),
  add column if not exists withheld_at timestamptz;
comment on column public.provider_payouts.withheld is
  'Não pagar (0390): excluído de vez do repasse, com motivo. Não entra em relatório até alguém reverter.';

-- -----------------------------------------------------------------------------
-- 2) Leitura pela regra da unidade; escrita só pelas funções
-- -----------------------------------------------------------------------------
alter table public.payout_reports enable row level security;
alter table public.payout_report_items enable row level security;
alter table public.payout_report_events enable row level security;

drop policy if exists "payout_reports_select" on public.payout_reports;
create policy "payout_reports_select" on public.payout_reports
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "payout_report_items_select" on public.payout_report_items;
create policy "payout_report_items_select" on public.payout_report_items
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

drop policy if exists "payout_report_events_select" on public.payout_report_events;
create policy "payout_report_events_select" on public.payout_report_events
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));

-- Quem monta o relatório (decisão 1): Financeiro da Franqueadora e Admin.
create or replace function public.can_manage_payout_reports()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or public.is_finance_franchisor();
$$;
revoke execute on function public.can_manage_payout_reports() from public, anon, authenticated;
grant execute on function public.can_manage_payout_reports() to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Internas: totais e linha do tempo
-- -----------------------------------------------------------------------------
create or replace function public._payout_report_refresh(p_report_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payout_reports r
     set total_cents = coalesce((
           select sum(i.amount_cents) from public.payout_report_items i
            where i.report_id = r.id and i.status = 'incluido'), 0),
         item_count = (
           select count(*) from public.payout_report_items i
            where i.report_id = r.id and i.status = 'incluido'),
         updated_at = now()
   where r.id = p_report_id;
$$;
revoke execute on function public._payout_report_refresh(uuid) from public, anon, authenticated;

create or replace function public._payout_report_event(
  p_report_id uuid, p_item_id uuid, p_clinic_id uuid, p_action text, p_note text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.payout_report_events
    (report_id, item_id, clinic_id, action, note, actor_id)
  values (p_report_id, p_item_id, p_clinic_id, p_action, p_note, (select auth.uid()));
$$;
revoke execute on function public._payout_report_event(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) GERAR — um dentista ou todos os da unidade
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_generate(
  p_clinic_id uuid,
  p_month date,
  p_provider_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_next date;
  v_user uuid := (select auth.uid());
  r record;
  v_report uuid;
  v_is_new boolean;
  v_level uuid;
  v_level_name text;
  v_added integer;
  v_done integer := 0;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  if p_clinic_id is null or p_month is null then raise exception 'INVALID_INPUT'; end if;

  v_month := date_trunc('month', p_month)::date;
  v_next := (v_month + interval '1 month')::date;
  if v_month > date_trunc('month', public.today_br())::date then
    raise exception 'FUTURE_MONTH';
  end if;

  for r in
    select distinct p.provider_id
      from public.provider_payouts p
     where p.clinic_id = p_clinic_id
       and (p_provider_id is null or p.provider_id = p_provider_id)
       and p.accrual_date < v_next
       and p.closing_id is null
       and p.amount_cents > 0
       and not p.no_payout
       and not p.withheld
       and not exists (
         select 1 from public.payout_report_items i
          where i.payout_id = p.id and i.active)
  loop
    select pr.id into v_report
      from public.payout_reports pr
     where pr.clinic_id = p_clinic_id and pr.provider_id = r.provider_id
       and pr.status = 'rascunho'
     for update;
    v_is_new := v_report is null;

    select u.career_level_id, l.name into v_level, v_level_name
      from public.user_clinic_roles_all u
      left join public.career_levels l on l.id = u.career_level_id
     where u.user_id = r.provider_id and u.clinic_id = p_clinic_id
     limit 1;

    if v_is_new then
      insert into public.payout_reports
        (clinic_id, provider_id, period_month, level_id, level_name, created_by)
      values (p_clinic_id, r.provider_id, v_month, v_level, v_level_name, v_user)
      returning id into v_report;
    end if;

    -- O que foi ADIADO neste mesmo rascunho não volta para ele: volta no próximo.
    insert into public.payout_report_items
      (report_id, clinic_id, payout_id, finished_on, procedure_id, procedure_name, amount_cents)
    select v_report, p_clinic_id, p.id, p.accrual_date, p.procedure_id, p.procedure_name, p.amount_cents
      from public.provider_payouts p
     where p.clinic_id = p_clinic_id
       and p.provider_id = r.provider_id
       and p.accrual_date < v_next
       and p.closing_id is null
       and p.amount_cents > 0
       and not p.no_payout
       and not p.withheld
       and not exists (
         select 1 from public.payout_report_items i
          where i.payout_id = p.id and (i.active or i.report_id = v_report));
    get diagnostics v_added = row_count;

    if v_added = 0 then
      continue;   -- só havia adiados deste rascunho: nada a fazer
    end if;

    if v_is_new then
      perform public._payout_report_event(v_report, null, p_clinic_id, 'gerado',
        v_added || ' procedimento(s)');
    else
      update public.payout_reports
         set period_month = greatest(period_month, v_month),
             level_id = v_level, level_name = v_level_name
       where id = v_report;
      perform public._payout_report_event(v_report, null, p_clinic_id, 'itens_adicionados',
        v_added || ' procedimento(s)');
    end if;

    perform public._payout_report_refresh(v_report);
    v_done := v_done + 1;
  end loop;

  return v_done;
end;
$$;
revoke execute on function public.payout_report_generate(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.payout_report_generate(uuid, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) EXCLUIR COM MOTIVO, desfazer, cancelar o rascunho, reverter o "não pagar"
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_exclude_item(
  p_item_id uuid, p_kind text, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_status text;
  v_user uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select pr.status into v_status from public.payout_reports pr where pr.id = v_i.report_id for update;
  if v_status <> 'rascunho' then raise exception 'REPORT_NOT_DRAFT'; end if;
  if v_i.status <> 'incluido' then raise exception 'ALREADY_EXCLUDED'; end if;
  if p_kind is null or p_kind not in ('adiar', 'nao_pagar') then raise exception 'INVALID_KIND'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  update public.payout_report_items
     set status = 'excluido', active = false, exclusion_kind = p_kind,
         exclusion_reason = v_reason, excluded_by = v_user, excluded_at = now()
   where id = p_item_id;

  if p_kind = 'nao_pagar' then
    update public.provider_payouts
       set withheld = true, withheld_reason = v_reason,
           withheld_by = v_user, withheld_at = now()
     where id = v_i.payout_id;
  end if;

  perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id,
    case when p_kind = 'adiar' then 'item_adiado' else 'item_nao_pagar' end, v_reason);
  perform public._payout_report_refresh(v_i.report_id);
end;
$$;
revoke execute on function public.payout_report_exclude_item(uuid, text, text) from public, anon, authenticated;
grant execute on function public.payout_report_exclude_item(uuid, text, text) to authenticated;

create or replace function public.payout_report_restore_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_status text;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select pr.status into v_status from public.payout_reports pr where pr.id = v_i.report_id for update;
  if v_status <> 'rascunho' then raise exception 'REPORT_NOT_DRAFT'; end if;
  if v_i.status <> 'excluido' then raise exception 'NOT_EXCLUDED'; end if;
  if exists (
    select 1 from public.payout_report_items o
     where o.payout_id = v_i.payout_id and o.active and o.id <> p_item_id
  ) then
    raise exception 'PAYOUT_IN_OTHER_REPORT';
  end if;

  if v_i.exclusion_kind = 'nao_pagar' then
    update public.provider_payouts
       set withheld = false, withheld_reason = null, withheld_by = null, withheld_at = null
     where id = v_i.payout_id;
  end if;

  update public.payout_report_items
     set status = 'incluido', active = true, exclusion_kind = null,
         exclusion_reason = null, excluded_by = null, excluded_at = null
   where id = p_item_id;

  perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id,
    'item_devolvido', 'Era: ' || v_i.exclusion_kind || ' — ' || coalesce(v_i.exclusion_reason, ''));
  perform public._payout_report_refresh(v_i.report_id);
end;
$$;
revoke execute on function public.payout_report_restore_item(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_restore_item(uuid) to authenticated;

create or replace function public.payout_report_cancel(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_r.status <> 'rascunho' then raise exception 'REPORT_NOT_DRAFT'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  -- Solta os procedimentos: voltam a poder entrar em outro relatório.
  -- (O que estava em "não pagar" continua em "não pagar".)
  update public.payout_report_items set active = false
   where report_id = p_report_id and active;

  update public.payout_reports
     set status = 'cancelado', cancelled_by = (select auth.uid()),
         cancelled_at = now(), cancel_reason = v_reason, updated_at = now()
   where id = p_report_id;

  perform public._payout_report_event(p_report_id, null, v_r.clinic_id, 'cancelado', v_reason);
end;
$$;
revoke execute on function public.payout_report_cancel(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_report_cancel(uuid, text) to authenticated;

create or replace function public.payout_release_withheld(p_payout_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.provider_payouts%rowtype;
  v_user uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_item record;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_p from public.provider_payouts where id = p_payout_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not v_p.withheld then raise exception 'NOT_WITHHELD'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  update public.provider_payouts
     set withheld = false, withheld_reason = null, withheld_by = null, withheld_at = null
   where id = p_payout_id;

  -- Fica na linha do tempo do relatório de onde ele saiu.
  select i.id, i.report_id into v_item
    from public.payout_report_items i
   where i.payout_id = p_payout_id and i.exclusion_kind = 'nao_pagar'
   order by i.excluded_at desc nulls last
   limit 1;
  if v_item.report_id is not null then
    perform public._payout_report_event(v_item.report_id, v_item.id, v_p.clinic_id,
      'nao_pagar_revertido', v_reason);
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_p.clinic_id, 'update', 'provider_payout', p_payout_id::text,
          jsonb_build_object('withheld_released', true));
end;
$$;
revoke execute on function public.payout_release_withheld(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_release_withheld(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O "Fechar o mês" antigo não leva o que está em relatório nem em "não pagar"
-- -----------------------------------------------------------------------------
create or replace function public.provider_payouts_report_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closing_id is not null and old.closing_id is null then
    if old.withheld or exists (
      select 1 from public.payout_report_items i
       where i.payout_id = old.id and i.active
    ) then
      raise exception 'PAYOUT_IN_REPORT'
        using hint = 'Este procedimento está em um relatório de repasse (ou marcado "não pagar") e não entra no fechamento do mês.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.provider_payouts_report_guard() from public, anon, authenticated;

drop trigger if exists provider_payouts_report_guard on public.provider_payouts;
create trigger provider_payouts_report_guard
  before update of closing_id on public.provider_payouts
  for each row execute function public.provider_payouts_report_guard();

-- Corpo da 0209 com um filtro a mais nos três lugares que escolhem as linhas:
-- fora o que está em relatório ativo e o que está em "não pagar".
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

  select coalesce(sum(pp.amount_cents), 0) into v_fixed
  from public.provider_payouts pp
  where pp.clinic_id = p_clinic_id
    and pp.accrual_date >= v_month and pp.accrual_date < v_next
    and pp.closing_id is null
    and not pp.withheld
    and not exists (select 1 from public.payout_report_items i
                     where i.payout_id = pp.id and i.active);

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
  update public.provider_payouts pp set closing_id = v_id
  where pp.clinic_id = p_clinic_id
    and pp.accrual_date >= v_month and pp.accrual_date < v_next
    and pp.closing_id is null
    and not pp.withheld
    and not exists (select 1 from public.payout_report_items i
                     where i.payout_id = pp.id and i.active);

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
revoke execute on function public.close_payout_month(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.close_payout_month(uuid, date, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) LEITURAS (com os nomes; a guarda é a do financeiro da unidade)
-- -----------------------------------------------------------------------------
-- 7a) Quem tem o que para entrar no relatório do mês.
drop function if exists public.payout_report_candidates(uuid, date);
create function public.payout_report_candidates(p_clinic_id uuid, p_month date)
returns table (
  provider_id uuid,
  provider_name text,
  level_name text,
  ready_count integer,
  ready_cents bigint,
  zero_count integer,
  draft_id uuid,
  draft_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if p_clinic_id is null or p_month is null
     or not (p_clinic_id in (select public.finance_visible_clinic_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  with abertos as (
    select p.id as a_id, p.provider_id as a_provider, p.amount_cents as a_cents,
           d.id as a_draft, d.code as a_code
      from public.provider_payouts p
      left join public.payout_reports d
        on d.clinic_id = p.clinic_id and d.provider_id = p.provider_id
       and d.status = 'rascunho'
     where p.clinic_id = p_clinic_id
       and p.accrual_date < v_next
       and p.closing_id is null
       and not p.no_payout
       and not p.withheld
       and not exists (
         select 1 from public.payout_report_items i
          where i.payout_id = p.id and (i.active or i.report_id = d.id))
  )
  select a.a_provider, pr.full_name, l.name,
         (count(*) filter (where a.a_cents > 0))::integer,
         coalesce(sum(a.a_cents) filter (where a.a_cents > 0), 0)::bigint,
         (count(*) filter (where a.a_cents = 0))::integer,
         (array_agg(a.a_draft))[1],
         (array_agg(a.a_code))[1]
    from abertos a
    left join public.profiles pr on pr.id = a.a_provider
    left join public.user_clinic_roles_all u
      on u.user_id = a.a_provider and u.clinic_id = p_clinic_id
    left join public.career_levels l on l.id = u.career_level_id
   group by a.a_provider, pr.full_name, l.name
   order by pr.full_name;
end;
$$;
revoke execute on function public.payout_report_candidates(uuid, date) from public, anon, authenticated;
grant execute on function public.payout_report_candidates(uuid, date) to authenticated;

-- 7b) Os relatórios da unidade (ou um só, pelo id).
drop function if exists public.payout_report_list(uuid, uuid);
create function public.payout_report_list(p_clinic_id uuid, p_report_id uuid default null)
returns table (
  id uuid,
  code text,
  clinic_id uuid,
  clinic_name text,
  provider_id uuid,
  provider_name text,
  period_month date,
  level_name text,
  status text,
  total_cents bigint,
  item_count integer,
  excluded_count integer,
  created_at timestamptz,
  created_by_name text,
  cancelled_at timestamptz,
  cancelled_by_name text,
  cancel_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  select r.id, r.code, r.clinic_id, c.name, r.provider_id, pr.full_name,
         r.period_month, r.level_name, r.status, r.total_cents, r.item_count,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'excluido')::integer,
         r.created_at, cb.full_name, r.cancelled_at, xb.full_name, r.cancel_reason
    from public.payout_reports r
    join public.clinics c on c.id = r.clinic_id
    left join public.profiles pr on pr.id = r.provider_id
    left join public.profiles cb on cb.id = r.created_by
    left join public.profiles xb on xb.id = r.cancelled_by
   where r.clinic_id in (select public.finance_visible_clinic_ids())
     and (p_clinic_id is null or r.clinic_id = p_clinic_id)
     and (p_report_id is null or r.id = p_report_id)
     and (p_clinic_id is not null or p_report_id is not null)
   order by r.created_at desc;
end;
$$;
revoke execute on function public.payout_report_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public.payout_report_list(uuid, uuid) to authenticated;

-- 7c) Os procedimentos de um relatório, com o cliente e de onde veio.
drop function if exists public.payout_report_items_detail(uuid);
create function public.payout_report_items_detail(p_report_id uuid)
returns table (
  item_id uuid,
  payout_id uuid,
  finished_on date,
  procedure_name text,
  client_id uuid,
  client_name text,
  session_id uuid,
  origin text,
  amount_cents bigint,
  status text,
  exclusion_kind text,
  exclusion_reason text,
  excluded_by_name text,
  excluded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.payout_reports r
     where r.id = p_report_id
       and r.clinic_id in (select public.finance_visible_clinic_ids())
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select i.id, i.payout_id, i.finished_on, i.procedure_name,
         coalesce(s.client_id, m.client_id),
         cl.full_name,
         p.session_id,
         case when p.ortho_maintenance_id is not null then 'ortodontia' else 'sessao' end::text,
         i.amount_cents, i.status, i.exclusion_kind, i.exclusion_reason,
         eb.full_name, i.excluded_at
    from public.payout_report_items i
    join public.provider_payouts p on p.id = i.payout_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id)
    left join public.profiles eb on eb.id = i.excluded_by
   where i.report_id = p_report_id
   order by i.finished_on, i.procedure_name, i.id;
end;
$$;
revoke execute on function public.payout_report_items_detail(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_items_detail(uuid) to authenticated;

-- 7d) A linha do tempo do relatório.
drop function if exists public.payout_report_history(uuid);
create function public.payout_report_history(p_report_id uuid)
returns table (
  created_at timestamptz,
  action text,
  note text,
  actor_name text,
  procedure_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.payout_reports r
     where r.id = p_report_id
       and r.clinic_id in (select public.finance_visible_clinic_ids())
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select e.created_at, e.action, e.note, a.full_name, i.procedure_name
    from public.payout_report_events e
    left join public.profiles a on a.id = e.actor_id
    left join public.payout_report_items i on i.id = e.item_id
   where e.report_id = p_report_id
   order by e.created_at desc, e.id;
end;
$$;
revoke execute on function public.payout_report_history(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_history(uuid) to authenticated;

-- 7e) O que está em "não pagar" na unidade.
drop function if exists public.payout_withheld_list(uuid);
create function public.payout_withheld_list(p_clinic_id uuid)
returns table (
  payout_id uuid,
  provider_name text,
  procedure_name text,
  finished_on date,
  amount_cents bigint,
  reason text,
  withheld_by_name text,
  withheld_at timestamptz
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

  return query
  select p.id, pr.full_name, p.procedure_name, p.accrual_date, p.amount_cents,
         p.withheld_reason, wb.full_name, p.withheld_at
    from public.provider_payouts p
    left join public.profiles pr on pr.id = p.provider_id
    left join public.profiles wb on wb.id = p.withheld_by
   where p.clinic_id = p_clinic_id and p.withheld
   order by p.withheld_at desc nulls last;
end;
$$;
revoke execute on function public.payout_withheld_list(uuid) from public, anon, authenticated;
grant execute on function public.payout_withheld_list(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) Permissão na matriz (a tela segue o banco) e auditoria
-- -----------------------------------------------------------------------------
insert into public.permission_matrix (capability, role) values
  ('acao.financeiro.repasse.relatorio', 'finance_franchisor')
on conflict do nothing;

-- A linha do tempo já É o histórico (só cresce); as outras duas são auditadas.
insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('public', 'payout_report_events',
        'Linha do tempo do relatório de repasse: ela própria é o histórico, só cresce (0390).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- Conferência (só leitura) ------------------------------------------------------
-- Esperado: tabelas = 3 · funcoes = 10 · trava_um_relatorio_por_vez = 1 ·
-- regras_de_escrita = 0 · permissao = 1 · nao_pagar_no_repasse = 1
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('payout_reports', 'payout_report_items', 'payout_report_events')) as tabelas,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('payout_report_generate', 'payout_report_exclude_item',
                      'payout_report_restore_item', 'payout_report_cancel',
                      'payout_release_withheld', 'payout_report_candidates',
                      'payout_report_list', 'payout_report_items_detail',
                      'payout_report_history', 'payout_withheld_list')) as funcoes,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'payout_report_items_one_active')
    as trava_um_relatorio_por_vez,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('payout_reports', 'payout_report_items', 'payout_report_events')
      and cmd <> 'SELECT') as regras_de_escrita,
  (select count(*) from public.permission_matrix
    where capability = 'acao.financeiro.repasse.relatorio') as permissao,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'provider_payouts'
      and column_name = 'withheld') as nao_pagar_no_repasse;
