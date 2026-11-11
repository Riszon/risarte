-- =============================================================================
-- 0400 — REPASSE DOS DENTISTAS, ETAPA 4B: O DESCONTO POR FALHA DO DENTISTA
--
-- Plano e decisões do dono: docs/Financeiro/REPASSE-PLANO.md (decisão 12 e,
-- desta etapa, F1–F6 — 11/11/2026, as seis como recomendado):
--   F1) refação pelo MESMO dentista não desconta: ele já recebeu uma vez e
--       refaz sem receber de novo;
--   F2) refação por OUTRO dentista, com falha do primeiro: o primeiro é
--       descontado e quem refez recebe normalmente;
--   F3) desconta o valor que foi pago; quem decide pode descontar menos (com
--       motivo), nunca mais;
--   F4) desconto maior que o repasse do pagamento: o que sobra passa para o
--       relatório seguinte, até zerar;
--   F5) sem prazo limite no sistema;
--   F6) ocorrência sem decisão não trava nada: lembrete a quem decide.
--
-- A OCORRÊNCIA (`payout_failures`), uma por procedimento com repasse:
--   • nasce SOZINHA quando o controle de qualidade REPROVA um procedimento
--     que já tem repasse, e quando uma venda cancelada tinha procedimentos com
--     repasse; ou À MÃO ("Registrar falha do dentista");
--   • QUEM DECIDE é quem aprova a equipe (Gerente; sem Gerente, Coordenador;
--     nunca o próprio dentista); sem ninguém na unidade, o Financeiro da
--     Franqueadora;
--   • "não foi falha" → encerra, nada muda;
--   • "foi falha":
--       refação pelo mesmo dentista ............ nada a descontar (F1);
--       repasse já em relatório, conta ou pago . LINHA NEGATIVA no próximo
--                                                relatório do dentista, pelas
--                                                mesmas aprovações;
--       repasse ainda fora de relatório ........ não é pago (sai da fila).
--     Nos dois últimos casos o repasse original fica ANULADO POR FALHA
--     (`provider_payouts.failure_voided_at`): quem refizer recebe (F2).
--
-- A LINHA NEGATIVA é um `provider_payouts` com valor negativo e
-- `failure_id`, sem sessão. Ela só entra em relatório junto com repasse
-- positivo do mesmo dentista e unidade, e a conta a pagar abate o desconto;
-- o que sobrar passa adiante (F4). Desconto que consome tudo vira um
-- pagamento COMPENSADO, sem conta a pagar.
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A ocorrência
-- -----------------------------------------------------------------------------
create table if not exists public.payout_failures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  provider_id uuid not null references public.profiles (id),
  payout_id uuid not null references public.provider_payouts (id) on delete restrict,
  source text not null check (source in ('qualidade', 'cancelamento', 'manual')),
  source_note text,
  quality_review_id uuid,
  resolution text,
  cancellation_id uuid,
  status text not null default 'aberta' check (status in ('aberta', 'falha', 'sem_falha')),
  outcome text check (outcome in ('desconto', 'nao_pagar', 'refaz_sem_custo')),
  base_cents bigint,
  discount_cents bigint,
  decision_reason text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  reminded_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint payout_failures_decided_chk
    check ((status = 'aberta') = (decided_at is null)),
  constraint payout_failures_outcome_chk
    check ((status = 'falha') = (outcome is not null))
);

-- UM PROCEDIMENTO, UM DESCONTO: só uma ocorrência viva (aberta ou "foi falha").
create unique index if not exists payout_failures_one_live
  on public.payout_failures (payout_id) where status in ('aberta', 'falha');
create index if not exists payout_failures_clinic_idx
  on public.payout_failures (clinic_id, status, created_at);

comment on table public.payout_failures is
  'Ocorrência de falha do dentista sobre um repasse (0400). Decide quem aprova a equipe; "foi falha" desconta (linha negativa) ou deixa de pagar.';

alter table public.payout_failures enable row level security;
drop policy if exists "payout_failures_select" on public.payout_failures;
create policy "payout_failures_select" on public.payout_failures
  for select to authenticated
  using (clinic_id in (select public.finance_visible_clinic_ids()));
-- Sem regra de escrita: só as funções gravam.

-- -----------------------------------------------------------------------------
-- 2) O repasse ganha a linha de desconto e a marca de anulado por falha
-- -----------------------------------------------------------------------------
alter table public.provider_payouts
  add column if not exists failure_id uuid references public.payout_failures (id),
  add column if not exists failure_voided_at timestamptz;

comment on column public.provider_payouts.failure_id is
  'Linha de DESCONTO por falha do dentista (0400): valor negativo, sem sessão.';
comment on column public.provider_payouts.failure_voided_at is
  'Repasse anulado por falha do dentista (0400): o procedimento pode ser pago a quem refizer, e ele não entra mais em relatório.';

-- A linha de desconto não tem sessão nem manutenção.
alter table public.provider_payouts drop constraint if exists provider_payouts_one_origin;
alter table public.provider_payouts
  add constraint provider_payouts_one_origin check (
    ((session_id is null) <> (ortho_maintenance_id is null) and failure_id is null)
    or (failure_id is not null and session_id is null and ortho_maintenance_id is null)
  );

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'provider_payouts_discount_sign') then
    alter table public.provider_payouts
      add constraint provider_payouts_discount_sign
      check ((failure_id is null and amount_cents >= 0) or (failure_id is not null and amount_cents < 0));
  end if;
end $$;

-- Uma apuração VIVA por sessão: a anulada por falha libera a sessão para o
-- repasse de quem refez (F2).
drop index if exists public.provider_payouts_session_unique;
create unique index if not exists provider_payouts_session_live_unique
  on public.provider_payouts (session_id)
  where session_id is not null and failure_voided_at is null;

-- O repasse de um mês fechado pelo caminho antigo continua imutável — menos a
-- marca de anulado por falha (ele foi pago; o desconto é que corrige).
create or replace function public.provider_payouts_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.closing_id is not null then
    if TG_OP = 'UPDATE'
       and (to_jsonb(new) - 'failure_voided_at') = (to_jsonb(old) - 'failure_voided_at') then
      return new;
    end if;
    raise exception 'PAYOUT_LOCKED'
      using hint = 'Este repasse já entrou em fechamento e não pode ser alterado nem apagado.';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.provider_payouts_lock() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) A conta do bloco (corpo da 0398): o repasse ANULADO POR FALHA não segura
--    mais o procedimento — quem refez recebe (F2)
-- -----------------------------------------------------------------------------
create or replace function public._payout_accrue_block(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.treatment_sessions%rowtype;
  v_pay public.treatment_sessions%rowtype;
  v_rate record;
  v_provider uuid;
  v_when date;
  v_total integer;
  v_qty integer;
  v_per integer;
  v_units integer := 1;
  v_from integer;
  v_to integer;
  v_block uuid[];
  v_size integer;
  v_done integer;
  v_amount integer;
begin
  select * into v_s from public.treatment_sessions where id = p_session_id;
  if v_s.id is null or v_s.item_id is null then return; end if;
  if v_s.redo_kind is not distinct from 'revisao' then return; end if;

  select count(*) into v_total
  from public.treatment_sessions s
  where s.item_id = v_s.item_id
    and s.redo_kind is distinct from 'revisao';

  select greatest(1, coalesce(i.quantity, 1)) into v_qty
  from public.treatment_plan_option_items i
  where i.id = v_s.item_id;
  v_qty := coalesce(v_qty, 1);

  if v_total >= v_qty and v_total % v_qty = 0 then
    v_per := v_total / v_qty;          -- um procedimento a cada v_per sessões
  else
    v_per := greatest(v_total, 1);     -- o item inteiro é um bloco só
    v_units := v_qty;
  end if;

  v_from := ((greatest(v_s.session_index, 1) - 1) / v_per) * v_per + 1;
  v_to := v_from + v_per - 1;

  select coalesce(array_agg(s.id), array[]::uuid[]) into v_block
  from public.treatment_sessions s
  where s.item_id = v_s.item_id
    and s.redo_kind is distinct from 'revisao'
    and s.session_index between v_from and v_to;

  if not (v_s.id = any(v_block)) then
    v_block := v_block || v_s.id;
  end if;

  -- Falta sessão do procedimento (nem concluída, nem cancelada): ainda não é a hora.
  if exists (
    select 1 from public.treatment_sessions s
    where s.id = any(v_block) and s.status not in ('done', 'cancelled')
  ) then
    return;
  end if;

  -- O procedimento já tem repasse (refação concluída de novo): não paga outra
  -- vez. Só o anulado por falha COM refação por outro dentista (0400) deixa de
  -- contar: aí quem refez recebe (F2). Nos outros casos de falha o
  -- procedimento não é pago de novo a ninguém.
  if exists (
    select 1 from public.provider_payouts p where p.session_id = any(v_block)
       and (p.failure_voided_at is null
            or not exists (
              select 1 from public.payout_failures f
               where f.payout_id = p.id and f.status = 'falha'
                 and f.resolution = 'redo_other'))
  ) then
    return;
  end if;

  select * into v_pay
  from public.treatment_sessions s
  where s.id = any(v_block) and s.status = 'done'
  order by (s.id = p_session_id) desc, s.done_at desc nulls last, s.session_index desc
  limit 1;
  if v_pay.id is null then return; end if;
  if v_pay.procedure_id is null or v_pay.clinic_id is null then return; end if;

  v_provider := coalesce(v_pay.executed_by, v_pay.planner_provider_id);
  if v_provider is null then return; end if;

  v_size := cardinality(v_block);
  select count(*) into v_done
  from public.treatment_sessions s
  where s.id = any(v_block) and s.status = 'done';

  v_when := coalesce(v_pay.done_at::date, public.today_br());

  select * into v_rate
  from public.payout_rate_for(v_pay.procedure_id, v_provider, v_pay.clinic_id, v_when);

  v_amount := coalesce(v_rate.amount_cents, 0) * v_units;
  if v_done < v_size then
    v_amount := round(v_amount::numeric * v_done / v_size)::integer;
  end if;

  insert into public.provider_payouts (
    clinic_id, provider_id, session_id, procedure_id, procedure_name,
    accrual_date, amount_cents, rate_id, units, sessions_done, sessions_total
  ) values (
    v_pay.clinic_id, v_provider, v_pay.id, v_pay.procedure_id, v_pay.procedure_name,
    v_when, v_amount, v_rate.rate_id, v_units,
    case when v_done < v_size then v_done end,
    case when v_done < v_size then v_size end
  )
  on conflict do nothing;
end;
$$;
revoke execute on function public._payout_accrue_block(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) Quem decide, quem lê
-- -----------------------------------------------------------------------------
-- Os aprovadores da equipe do dentista na unidade (a regra da 0391):
-- Gerentes; sem Gerente, Coordenadores; nunca o próprio dentista.
create or replace function public._payout_failure_deciders(p_clinic_id uuid, p_provider_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with mgr as (
    select u.user_id
      from public.user_clinic_roles_all u
      join public.profiles p on p.id = u.user_id and p.is_active
     where u.clinic_id = p_clinic_id and u.role = 'unit_manager'
  ),
  coord as (
    select u.user_id
      from public.user_clinic_roles_all u
      join public.profiles p on p.id = u.user_id and p.is_active
     where u.clinic_id = p_clinic_id and u.role = 'clinical_coordinator'
  )
  select m.user_id from mgr m where m.user_id <> p_provider_id
  union
  select c.user_id from coord c
   where not exists (select 1 from mgr) and c.user_id <> p_provider_id;
$$;
revoke execute on function public._payout_failure_deciders(uuid, uuid) from public, anon, authenticated;

-- Para quem vai o aviso: quem decide, ou o Financeiro quando não há ninguém.
create or replace function public._payout_failure_reviewers(p_clinic_id uuid, p_provider_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public._payout_failure_deciders(p_clinic_id, p_provider_id))
      then array(select public._payout_failure_deciders(p_clinic_id, p_provider_id))
    else array(select public._payout_finance_users())
  end;
$$;
revoke execute on function public._payout_failure_reviewers(uuid, uuid) from public, anon, authenticated;

create or replace function public.can_decide_payout_failure(p_failure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.payout_failures f
        where f.id = p_failure_id
          and f.provider_id <> (select auth.uid())
          and (
            (select auth.uid()) in (select public._payout_failure_deciders(f.clinic_id, f.provider_id))
            or (
              not exists (select 1 from public._payout_failure_deciders(f.clinic_id, f.provider_id))
              and public.can_manage_payout_reports()
            )
          )
     );
$$;
revoke execute on function public.can_decide_payout_failure(uuid) from public, anon, authenticated;
grant execute on function public.can_decide_payout_failure(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) ABRIR a ocorrência (interna; e a porta "Registrar falha do dentista")
-- -----------------------------------------------------------------------------
create or replace function public._payout_failure_open(
  p_payout_id uuid, p_source text, p_note text,
  p_quality_review_id uuid default null, p_resolution text default null,
  p_cancellation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.provider_payouts%rowtype;
  v_id uuid;
begin
  select * into v_p from public.provider_payouts where id = p_payout_id;
  if v_p.id is null or v_p.failure_id is not null or v_p.failure_voided_at is not null
     or coalesce(v_p.amount_cents, 0) <= 0 then
    return null;
  end if;

  insert into public.payout_failures
    (clinic_id, provider_id, payout_id, source, source_note, quality_review_id,
     resolution, cancellation_id, created_by)
  values (v_p.clinic_id, v_p.provider_id, v_p.id, p_source, nullif(btrim(coalesce(p_note, '')), ''),
          p_quality_review_id, p_resolution, p_cancellation_id, (select auth.uid()))
  on conflict (payout_id) where status in ('aberta', 'falha') do nothing
  returning id into v_id;

  if v_id is null then return null; end if;

  perform public._payout_report_notify(
    public._payout_failure_reviewers(v_p.clinic_id, v_p.provider_id)
      || array(select public._payout_finance_users()),
    v_p.clinic_id,
    'Repasse: decidir se houve falha do dentista',
    'Um procedimento que já tem repasse '
      || case p_source when 'qualidade' then 'foi reprovado no controle de qualidade'
                       when 'cancelamento' then 'era de uma venda cancelada'
                       else 'teve uma ocorrência registrada' end
      || '. Decida se foi falha do dentista.',
    '/repasses/ocorrencias');
  return v_id;
end;
$$;
revoke execute on function public._payout_failure_open(uuid, text, text, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.payout_failure_open(p_payout_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.provider_payouts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  select * into v_p from public.provider_payouts where id = p_payout_id;
  if v_p.id is null then raise exception 'NOT_FOUND'; end if;
  if v_user is null or v_p.provider_id = v_user then raise exception 'NOT_ALLOWED'; end if;
  if not (public.can_manage_payout_reports()
          or v_user in (select public._payout_failure_deciders(v_p.clinic_id, v_p.provider_id))) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if v_p.failure_id is not null or v_p.failure_voided_at is not null
     or coalesce(v_p.amount_cents, 0) <= 0 then
    raise exception 'INVALID_ITEM';
  end if;
  if exists (select 1 from public.payout_failures f
              where f.payout_id = p_payout_id and f.status in ('aberta', 'falha')) then
    raise exception 'ALREADY_OPEN';
  end if;

  v_id := public._payout_failure_open(p_payout_id, 'manual', v_reason);
  if v_id is null then raise exception 'ALREADY_OPEN'; end if;
  return v_id;
end;
$$;
revoke execute on function public.payout_failure_open(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_failure_open(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) SOZINHA: reprovação no controle de qualidade e venda cancelada
--    (gatilhos blindados: um erro aqui nunca derruba a reprovação nem o
--    cancelamento — vira aviso no log do banco)
-- -----------------------------------------------------------------------------
create or replace function public.plan_quality_reviews_payout_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  begin
    if new.status <> 'reprovado' then return null; end if;
    if tg_op = 'UPDATE' and old.status = new.status
       and old.resolution is not distinct from new.resolution then
      return null;
    end if;

    -- A resolução mudou com a ocorrência ainda aberta: acompanha.
    update public.payout_failures f
       set resolution = new.resolution
     where f.quality_review_id = new.id and f.status = 'aberta';

    for r in
      select p.id
        from public.provider_payouts p
        join public.treatment_sessions s on s.id = p.session_id
       where s.item_id = new.item_id
         and p.failure_voided_at is null and p.failure_id is null
         and p.amount_cents > 0
    loop
      perform public._payout_failure_open(r.id, 'qualidade',
        coalesce(new.note, '')
          || case when new.replan_reason = 'inviabilidade' then ' (replanejado por inviabilidade clínica)'
                  when new.replan_reason = 'falha' then ' (replanejado por falha profissional)'
                  else '' end,
        new.id, new.resolution, null);
    end loop;
  exception when others then
    raise warning 'plan_quality_reviews_payout_failure: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.plan_quality_reviews_payout_failure() from public, anon, authenticated;

drop trigger if exists plan_quality_reviews_payout_failure on public.plan_quality_reviews;
create trigger plan_quality_reviews_payout_failure
  after insert or update on public.plan_quality_reviews
  for each row execute function public.plan_quality_reviews_payout_failure();

create or replace function public.plan_cancellations_payout_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  begin
    if new.status <> 'efetivado' or old.status = 'efetivado' or new.plan_id is null then
      return null;
    end if;
    for r in
      select p.id
        from public.provider_payouts p
        join public.treatment_sessions s on s.id = p.session_id
       where s.plan_id = new.plan_id
         and p.failure_voided_at is null and p.failure_id is null
         and p.amount_cents > 0
    loop
      perform public._payout_failure_open(r.id, 'cancelamento',
        'Venda cancelada: ' || coalesce(new.reason, ''), null, null, new.id);
    end loop;
  exception when others then
    raise warning 'plan_cancellations_payout_failure: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.plan_cancellations_payout_failure() from public, anon, authenticated;

drop trigger if exists plan_cancellations_payout_failure on public.plan_cancellations;
create trigger plan_cancellations_payout_failure
  after update of status on public.plan_cancellations
  for each row execute function public.plan_cancellations_payout_failure();

-- -----------------------------------------------------------------------------
-- 7) DECIDIR — uma ocorrência por vez, com motivo
-- -----------------------------------------------------------------------------
create or replace function public.payout_failure_decide(
  p_failure_id uuid, p_is_failure boolean, p_reason text,
  p_discount_cents bigint default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.payout_failures%rowtype;
  v_p public.provider_payouts%rowtype;
  v_user uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_item public.payout_report_items%rowtype;
  v_base bigint;
  v_amount bigint;
  v_outcome text;
  v_new uuid;
begin
  select * into v_f from public.payout_failures where id = p_failure_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.can_decide_payout_failure(p_failure_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_f.status <> 'aberta' then raise exception 'WRONG_STAGE'; end if;
  if p_is_failure is null then raise exception 'INVALID_KIND'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  select * into v_p from public.provider_payouts where id = v_f.payout_id for update;

  if not p_is_failure then
    update public.payout_failures
       set status = 'sem_falha', decision_reason = v_reason,
           decided_by = v_user, decided_at = now()
     where id = p_failure_id;
    return 'sem_falha';
  end if;

  -- Em qual relatório o repasse está (o valor pode ter sido corrigido lá).
  select i.* into v_item
    from public.payout_report_items i
    join public.payout_reports r on r.id = i.report_id and r.status <> 'cancelado'
   where i.payout_id = v_p.id and i.active and i.status = 'incluido'
   limit 1;
  v_base := coalesce(v_item.amount_cents, v_p.amount_cents, 0);

  if v_f.source = 'qualidade' and v_f.resolution = 'redo_same' then
    -- F1: o mesmo dentista refaz sem receber de novo. Nada a descontar.
    v_outcome := 'refaz_sem_custo';
    v_amount := 0;
  elsif (v_item.id is not null or v_p.closing_id is not null) and v_base > 0 then
    -- Já em relatório, em conta ou pago: desconto no próximo relatório.
    v_outcome := 'desconto';
    v_amount := coalesce(p_discount_cents, v_base);
    if v_amount <= 0 or v_amount > v_base then raise exception 'INVALID_AMOUNT'; end if;
  else
    -- Ainda fora de relatório: simplesmente não é pago.
    v_outcome := 'nao_pagar';
    v_amount := 0;
  end if;

  update public.payout_failures
     set status = 'falha', outcome = v_outcome, base_cents = v_base,
         discount_cents = v_amount, decision_reason = v_reason,
         decided_by = v_user, decided_at = now()
   where id = p_failure_id;

  if v_outcome in ('desconto', 'nao_pagar') then
    update public.provider_payouts set failure_voided_at = now() where id = v_p.id;
  end if;

  if v_outcome = 'desconto' then
    insert into public.provider_payouts
      (clinic_id, provider_id, session_id, procedure_id, procedure_name,
       accrual_date, amount_cents, failure_id)
    values (v_p.clinic_id, v_p.provider_id, null, null,
            'Desconto por falha — ' || coalesce(v_p.procedure_name, 'procedimento'),
            public.today_br(), -v_amount, p_failure_id)
    returning id into v_new;

    perform public._payout_report_notify(
      array[v_p.provider_id], v_p.clinic_id,
      'Desconto no seu repasse',
      'Foi registrada falha em ' || coalesce(v_p.procedure_name, 'um procedimento')
        || '. O desconto de ' || public.brl(v_amount)
        || ' entra no seu próximo relatório, onde você pode conferir e contestar.',
      '/repasses');
  end if;

  -- F2: anulado o repasse do primeiro, quem refez (se já concluiu) recebe.
  if v_outcome in ('desconto', 'nao_pagar') and v_p.session_id is not null
     and v_f.resolution = 'redo_other' then
    perform public._payout_accrue_block(v_p.session_id);
  end if;

  perform public._payout_report_notify(
    array(select public._payout_finance_users()), v_p.clinic_id,
    'Repasse: falha do dentista registrada',
    case v_outcome
      when 'desconto' then 'Desconto de ' || public.brl(v_amount) || ' no próximo relatório.'
      when 'nao_pagar' then 'O repasse do procedimento não será pago.'
      else 'Refação pelo mesmo dentista: nada a descontar.' end,
    '/repasses/ocorrencias');
  return v_outcome;
end;
$$;
revoke execute on function public.payout_failure_decide(uuid, boolean, text, bigint) from public, anon, authenticated;
grant execute on function public.payout_failure_decide(uuid, boolean, text, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) LEMBRETE (F6): ocorrência aberta há 3 dias úteis — uma vez; nada trava
-- -----------------------------------------------------------------------------
create or replace function public.payout_failure_reminder_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select f.* from public.payout_failures f
     where f.status = 'aberta' and f.reminded_at is null
       and public.today_br() >= public._payout_add_business_days(
             (f.created_at at time zone 'America/Sao_Paulo')::date, 3)
  loop
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct x.uid, r.clinic_id,
           'Lembrete: ocorrência de repasse sem decisão',
           'Há uma ocorrência de falha do dentista esperando a sua decisão.',
           '/repasses/ocorrencias'
      from unnest(public._payout_failure_reviewers(r.clinic_id, r.provider_id)) as x(uid)
     where x.uid is not null;
    update public.payout_failures set reminded_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.payout_failure_reminder_run() from public, anon, authenticated;

do $$
begin
  perform cron.schedule(
    'risarte-payout-failures-daily', '25 8 * * *',
    'select public.payout_failure_reminder_run()'
  );
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) O RELATÓRIO leva o desconto (corpos da 0390 com o desconto e sem o anulado)
-- -----------------------------------------------------------------------------
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
  draft_code text,
  discount_count integer,
  discount_cents bigint
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
       and p.failure_voided_at is null
       and not exists (
         select 1 from public.payout_report_items i
          where i.payout_id = p.id and (i.active or i.report_id = d.id))
  )
  select a.a_provider, pr.full_name, l.name,
         (count(*) filter (where a.a_cents > 0))::integer,
         coalesce(sum(a.a_cents) filter (where a.a_cents > 0), 0)::bigint,
         (count(*) filter (where a.a_cents = 0))::integer,
         (array_agg(a.a_draft))[1],
         (array_agg(a.a_code))[1],
         (count(*) filter (where a.a_cents < 0))::integer,
         coalesce(sum(a.a_cents) filter (where a.a_cents < 0), 0)::bigint
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

-- Gerar: só abre relatório para quem tem repasse POSITIVO; o desconto entra
-- junto (nunca um relatório só de desconto).
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
       and p.failure_voided_at is null
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

    insert into public.payout_report_items
      (report_id, clinic_id, payout_id, finished_on, procedure_id, procedure_name, amount_cents)
    select v_report, p_clinic_id, p.id, p.accrual_date, p.procedure_id, p.procedure_name, p.amount_cents
      from public.provider_payouts p
     where p.clinic_id = p_clinic_id
       and p.provider_id = r.provider_id
       and p.accrual_date < v_next
       and p.closing_id is null
       and p.amount_cents <> 0
       and not p.no_payout
       and not p.withheld
       and p.failure_voided_at is null
       and not exists (
         select 1 from public.payout_report_items i
          where i.payout_id = p.id and (i.active or i.report_id = v_report));
    get diagnostics v_added = row_count;

    if v_added = 0 then
      continue;
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

-- A decisão do Financeiro (corpo da 0391): numa linha de DESCONTO, corrigir é
-- descontar MENOS (o valor continua negativo e menor que o original).
create or replace function public.payout_report_finance_decide(
  p_item_id uuid, p_action text, p_reason text,
  p_new_amount_cents bigint default null, p_exclusion_kind text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new text;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_r from public.payout_reports where id = v_i.report_id for update;
  if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_i.status <> 'incluido' or v_i.review_state <> 'no_financeiro' then raise exception 'WRONG_STAGE'; end if;
  if p_action is null or p_action not in ('manter', 'corrigir', 'excluir') then raise exception 'INVALID_KIND'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  if p_action = 'manter' then
    update public.payout_report_items
       set review_state = 'aprovado', released = true, released_at = now(),
           finance_action = 'manter', finance_reason = v_reason, finance_by = v_user, finance_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'financeiro_manteve', v_reason);

  elsif p_action = 'corrigir' then
    if p_new_amount_cents is null or p_new_amount_cents = v_i.amount_cents
       or (v_i.amount_cents > 0 and p_new_amount_cents <= 0)
       or (v_i.amount_cents < 0 and (p_new_amount_cents >= 0 or p_new_amount_cents < v_i.amount_cents)) then
      raise exception 'INVALID_AMOUNT';
    end if;
    update public.payout_report_items
       set original_amount_cents = coalesce(original_amount_cents, amount_cents),
           amount_cents = p_new_amount_cents,
           review_state = 'aprovado', released = true, released_at = now(),
           finance_action = 'corrigir', finance_reason = v_reason, finance_by = v_user, finance_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'financeiro_corrigiu',
      'De ' || public.brl(v_i.amount_cents) || ' para ' || public.brl(p_new_amount_cents) || ' — ' || v_reason);
    perform public._payout_report_refresh(v_i.report_id);

  else
    if p_exclusion_kind is null or p_exclusion_kind not in ('adiar', 'nao_pagar') then
      raise exception 'INVALID_KIND';
    end if;
    update public.payout_report_items
       set status = 'excluido', active = false, review_state = null,
           exclusion_kind = p_exclusion_kind, exclusion_reason = v_reason,
           excluded_by = v_user, excluded_at = now(),
           finance_action = 'excluir', finance_reason = v_reason, finance_by = v_user, finance_at = now()
     where id = p_item_id;
    if p_exclusion_kind = 'nao_pagar' then
      update public.provider_payouts
         set withheld = true, withheld_reason = v_reason, withheld_by = v_user, withheld_at = now()
       where id = v_i.payout_id;
    end if;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id,
      case when p_exclusion_kind = 'adiar' then 'item_adiado' else 'item_nao_pagar' end,
      'Decisão do Financeiro: ' || v_reason);
    perform public._payout_report_refresh(v_i.report_id);
  end if;

  v_new := public._payout_report_sync(v_i.report_id);
  perform public._payout_report_notify(
    array[v_r.provider_id] || public._payout_report_reviewers(v_i.report_id), v_i.clinic_id,
    'Repasse: decisão do Financeiro — ' || v_r.code,
    'O Financeiro da Franqueadora decidiu sobre um procedimento contestado.',
    '/repasses/' || v_i.report_id);
  return v_new;
end;
$$;
revoke execute on function public.payout_report_finance_decide(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.payout_report_finance_decide(uuid, text, text, bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10) A CONTA A PAGAR abate o desconto (corpo da 0393 + F4)
--     • só gera quando há repasse POSITIVO liberado;
--     • os descontos entram do mais antigo ao mais novo até o positivo;
--     • o desconto que não cabe inteiro é PARTIDO: a parte que cabe fica,
--       o saldo vira outra linha de desconto que vai ao próximo relatório;
--     • o desconto que não cabe nada sai deste relatório ("adiado");
--     • desconto que consome tudo = pagamento COMPENSADO, sem conta a pagar.
-- -----------------------------------------------------------------------------
alter table public.payout_payments alter column payable_id drop not null;
alter table public.payout_payments drop constraint if exists payout_payments_amount_cents_check;
alter table public.payout_payments drop constraint if exists payout_payments_compensated_chk;
alter table public.payout_payments
  add constraint payout_payments_compensated_chk check (
    amount_cents >= 0 and ((payable_id is null) = (amount_cents = 0))
  );

create or replace function public.payout_report_bill(p_report_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_today date := public.today_br();
  v_ids uuid[] := array[]::uuid[];
  v_pos bigint;
  v_room bigint;
  v_total bigint;
  v_count integer;
  v_released date;
  v_due date;
  v_accrual date;
  v_name text;
  v_payable uuid;
  v_payment uuid;
  n record;
  v_rest uuid;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_r.status not in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado') then
    raise exception 'WRONG_STAGE';
  end if;

  -- O repasse positivo liberado e ainda sem conta.
  select coalesce(array_agg(x.id), array[]::uuid[]), coalesce(sum(x.amount_cents), 0)::bigint,
         max((x.released_at at time zone 'America/Sao_Paulo')::date)
    into v_ids, v_pos, v_released
    from (
      select i.id, i.amount_cents, i.released_at
        from public.payout_report_items i
       where i.report_id = p_report_id
         and i.status = 'incluido' and i.active and i.released
         and i.payment_id is null and i.amount_cents > 0
       for update
    ) x;

  if v_pos <= 0 then raise exception 'NOTHING_TO_BILL'; end if;
  v_room := v_pos;

  -- Os descontos liberados, do mais antigo ao mais novo.
  for n in
    select i.*
      from public.payout_report_items i
     where i.report_id = p_report_id
       and i.status = 'incluido' and i.active and i.released
       and i.payment_id is null and i.amount_cents < 0
     order by i.finished_on, i.created_at, i.id
     for update
  loop
    if v_room + n.amount_cents >= 0 then
      v_ids := v_ids || n.id;
      v_room := v_room + n.amount_cents;
    elsif v_room > 0 then
      -- Parte: fica o que cabe; o saldo vira outra linha de desconto.
      insert into public.provider_payouts
        (clinic_id, provider_id, session_id, procedure_id, procedure_name,
         accrual_date, amount_cents, failure_id)
      select p.clinic_id, p.provider_id, null, null,
             coalesce(p.procedure_name, 'Desconto por falha') || ' (saldo)',
             v_today, n.amount_cents + v_room, p.failure_id
        from public.provider_payouts p where p.id = n.payout_id
      returning id into v_rest;
      update public.provider_payouts set amount_cents = -v_room where id = n.payout_id;
      update public.payout_report_items
         set original_amount_cents = coalesce(original_amount_cents, amount_cents),
             amount_cents = -v_room
       where id = n.id;
      perform public._payout_report_event(p_report_id, n.id, v_r.clinic_id, 'desconto_partido',
        public.brl(v_room) || ' descontado agora; ' || public.brl(-(n.amount_cents + v_room))
          || ' passa para o próximo relatório.');
      v_ids := v_ids || n.id;
      v_room := 0;
    else
      -- Não cabe nada: sai deste relatório e volta no próximo.
      update public.payout_report_items
         set status = 'excluido', active = false, exclusion_kind = 'adiar',
             exclusion_reason = 'Desconto maior que o repasse deste pagamento: passa para o próximo relatório.',
             excluded_by = v_user, excluded_at = now()
       where id = n.id;
      perform public._payout_report_event(p_report_id, n.id, v_r.clinic_id, 'item_adiado',
        'Desconto maior que o repasse deste pagamento: passa para o próximo relatório.');
    end if;
  end loop;

  perform public._payout_report_refresh(p_report_id);

  v_total := v_room;
  v_count := cardinality(v_ids);
  v_due := public._payout_due_date(coalesce(v_released, v_today), v_today);

  v_accrual := v_r.period_month;
  if exists (
    select 1 from public.fiscal_periods fp
     where fp.clinic_id = v_r.clinic_id and fp.status = 'closed'
       and fp.year = extract(year from v_accrual)::integer
       and fp.month = extract(month from v_accrual)::integer
  ) then
    v_accrual := v_today;
  end if;

  if v_total > 0 then
    select full_name into v_name from public.profiles where id = v_r.provider_id;
    insert into public.payables
      (clinic_id, account_code, description, reference, accrual_date, due_date,
       amount_cents, status, approval_mode, requires_approval, notes, created_by)
    values (
      v_r.clinic_id, '2.1.01',
      'Repasse — ' || coalesce(v_name, 'profissional') || ' · ' || v_r.code
        || ' · ' || to_char(v_r.period_month, 'MM/YYYY'),
      v_r.code, v_accrual, v_due, v_total, 'aberta', 'automatica', false,
      'Gerada do relatório de repasse ' || v_r.code || ' (' || v_count
        || ' linha(s), descontos inclusos). Aprovada pelo aprovador da unidade e pelo dentista.',
      v_user)
    returning id into v_payable;
    perform public.post_payable_accrual(v_payable);
  end if;

  insert into public.payout_payments
    (report_id, clinic_id, provider_id, payable_id, amount_cents, item_count,
     accrual_date, due_date, created_by)
  values (p_report_id, v_r.clinic_id, v_r.provider_id, v_payable, v_total, v_count,
          v_accrual, v_due, v_user)
  returning id into v_payment;

  update public.payout_report_items set payment_id = v_payment
   where id = any (v_ids);

  perform public._payout_report_event(p_report_id, null, v_r.clinic_id,
    case when v_total > 0 then 'conta_gerada' else 'compensado' end,
    v_count || ' linha(s), ' || public.brl(v_total)
      || case when v_total > 0 then ', vence em ' || to_char(v_due, 'DD/MM/YYYY') else '' end);
  perform public._payout_report_notify(
    array[v_r.provider_id], v_r.clinic_id,
    case when v_total > 0 then 'Pagamento do repasse programado — ' else 'Repasse compensado pelo desconto — ' end
      || v_r.code,
    case when v_total > 0
         then public.brl(v_total) || ' com pagamento previsto para ' || to_char(v_due, 'DD/MM/YYYY') || '.'
         else 'O desconto consumiu todo o repasse liberado; não há valor a receber neste pagamento.' end,
    '/repasses/' || p_report_id);

  return v_payment;
end;
$$;
revoke execute on function public.payout_report_bill(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_bill(uuid) to authenticated;

-- Todos da unidade: só os que têm repasse POSITIVO liberado sem conta.
create or replace function public.payout_reports_bill_all(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  if p_clinic_id is null then raise exception 'NOT_FOUND'; end if;

  for r in
    select pr.id
      from public.payout_reports pr
     where pr.clinic_id = p_clinic_id
       and pr.status in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado')
       and pr.provider_id is distinct from (select auth.uid())
       and exists (
         select 1 from public.payout_report_items i
          where i.report_id = pr.id and i.status = 'incluido' and i.active
            and i.released and i.payment_id is null and i.amount_cents > 0)
     order by pr.created_at
  loop
    perform public.payout_report_bill(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.payout_reports_bill_all(uuid) from public, anon, authenticated;
grant execute on function public.payout_reports_bill_all(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 11) LEITURAS
-- -----------------------------------------------------------------------------
-- 11a) As contas de um relatório (corpo da 0393): o pagamento COMPENSADO não
--      tem conta a pagar.
drop function if exists public.payout_report_payments(uuid);
create function public.payout_report_payments(p_report_id uuid)
returns table (
  payment_id uuid,
  payable_id uuid,
  amount_cents bigint,
  item_count integer,
  accrual_date date,
  due_date date,
  state text,
  paid_cents bigint,
  paid_on date,
  created_at timestamptz,
  created_by_name text,
  cancel_reason text,
  item_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_internal boolean := public._payout_report_can_read(p_report_id);
begin
  if not public._payout_report_can_read_payment(p_report_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select pp.id, pp.payable_id, pp.amount_cents, pp.item_count, pp.accrual_date,
         coalesce(pa.due_date, pp.due_date),
         case when pp.status = 'cancelada' then 'cancelado'
              when pp.payable_id is null then 'compensado'
              when pa.status = 'paga' then 'pago'
              when pa.status = 'parcial' then 'parcial'
              else 'programado' end::text,
         coalesce(pa.paid_amount_cents, 0)::bigint,
         case when pa.status = 'paga' then (
           select max(x.paid_at) from public.payable_payments x
            where x.payable_id = pa.id and not x.reversed and x.reversal_of is null)
         end,
         pp.created_at,
         case when v_internal then cb.full_name end,
         case when v_internal then pp.cancel_reason end,
         coalesce(array(select i.id from public.payout_report_items i
                         where i.payment_id = pp.id), array[]::uuid[])
    from public.payout_payments pp
    left join public.payables pa on pa.id = pp.payable_id
    left join public.profiles cb on cb.id = pp.created_by
   where pp.report_id = p_report_id
     and (v_internal or pp.status = 'ativa')
   order by pp.created_at;
end;
$$;
revoke execute on function public.payout_report_payments(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_payments(uuid) to authenticated;

-- 11b) O resumo das listas (corpo da 0393): "a gerar" é o repasse POSITIVO
--      liberado sem conta, já abatido o desconto liberado.
drop function if exists public.payout_report_billing(uuid[]);
create function public.payout_report_billing(p_report_ids uuid[])
returns table (
  report_id uuid,
  to_bill_cents bigint,
  to_bill_count integer,
  scheduled_cents bigint,
  paid_cents bigint,
  next_due date,
  last_paid_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then return; end if;
  return query
  select r.id,
         case when exists (
                select 1 from public.payout_report_items i
                 where i.report_id = r.id and i.status = 'incluido' and i.active
                   and i.released and i.payment_id is null and i.amount_cents > 0)
              then greatest(0, coalesce((select sum(i.amount_cents) from public.payout_report_items i
                    where i.report_id = r.id and i.status = 'incluido' and i.active
                      and i.released and i.payment_id is null), 0))
              else 0 end::bigint,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'incluido' and i.active
             and i.released and i.payment_id is null)::integer,
         coalesce((select sum(pp.amount_cents) from public.payout_payments pp
                     join public.payables pa on pa.id = pp.payable_id
                    where pp.report_id = r.id and pp.status = 'ativa'
                      and pa.status <> 'paga'), 0)::bigint,
         coalesce((select sum(pp.amount_cents) from public.payout_payments pp
                     join public.payables pa on pa.id = pp.payable_id
                    where pp.report_id = r.id and pp.status = 'ativa'
                      and pa.status = 'paga'), 0)::bigint,
         (select min(pa.due_date) from public.payout_payments pp
            join public.payables pa on pa.id = pp.payable_id
           where pp.report_id = r.id and pp.status = 'ativa' and pa.status <> 'paga'),
         (select max(x.paid_at) from public.payout_payments pp
            join public.payables pa on pa.id = pp.payable_id and pa.status = 'paga'
            join public.payable_payments x on x.payable_id = pa.id
                 and not x.reversed and x.reversal_of is null
           where pp.report_id = r.id and pp.status = 'ativa')
    from public.payout_reports r
   where r.id = any (coalesce(p_report_ids, array[]::uuid[]))
     and public._payout_report_can_read_payment(r.id);
end;
$$;
revoke execute on function public.payout_report_billing(uuid[]) from public, anon, authenticated;
grant execute on function public.payout_report_billing(uuid[]) to authenticated;

-- 11c) Os procedimentos do relatório (corpo da 0391) + o motivo do desconto.
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
  excluded_at timestamptz,
  review_state text,
  released boolean,
  contest_kind text,
  contest_text text,
  contest_round integer,
  manager_response text,
  finance_action text,
  finance_reason text,
  original_amount_cents bigint,
  failure_reason text,
  has_failure boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public._payout_report_can_read(p_report_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select i.id, i.payout_id, i.finished_on, i.procedure_name,
         coalesce(s.client_id, m.client_id, os.client_id),
         cl.full_name,
         coalesce(p.session_id, op.session_id),
         case when p.failure_id is not null then 'desconto'
              when p.ortho_maintenance_id is not null then 'ortodontia'
              else 'sessao' end::text,
         i.amount_cents, i.status, i.exclusion_kind, i.exclusion_reason,
         eb.full_name, i.excluded_at,
         i.review_state, i.released, i.contest_kind, i.contest_text, i.contest_round,
         i.manager_response, i.finance_action, i.finance_reason, i.original_amount_cents,
         f.decision_reason,
         exists (select 1 from public.payout_failures x
                  where x.payout_id = p.id and x.status in ('aberta', 'falha'))
    from public.payout_report_items i
    join public.provider_payouts p on p.id = i.payout_id
    left join public.payout_failures f on f.id = p.failure_id
    left join public.provider_payouts op on op.id = f.payout_id
    left join public.treatment_sessions os on os.id = op.session_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id, os.client_id)
    left join public.profiles eb on eb.id = i.excluded_by
   where i.report_id = p_report_id
   order by i.finished_on, i.procedure_name, i.id;
end;
$$;
revoke execute on function public.payout_report_items_detail(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_items_detail(uuid) to authenticated;

-- 11d) A visão do dentista (corpo da 0391) + o motivo do desconto.
drop function if exists public.my_payout_report_detail(uuid);
create function public.my_payout_report_detail(p_report_id uuid)
returns table (
  item_id uuid,
  finished_on date,
  procedure_name text,
  client_id uuid,
  client_name text,
  amount_cents bigint,
  review_state text,
  released boolean,
  contest_kind text,
  contest_text text,
  contest_round integer,
  manager_response text,
  finance_action text,
  finance_reason text,
  original_amount_cents bigint,
  failure_reason text
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
       and r.provider_id = (select auth.uid())
       and r.status in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado')
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select i.id, i.finished_on, i.procedure_name,
         coalesce(s.client_id, m.client_id, os.client_id), cl.full_name,
         i.amount_cents, i.review_state, i.released,
         i.contest_kind, i.contest_text, i.contest_round, i.manager_response,
         i.finance_action, i.finance_reason, i.original_amount_cents,
         f.decision_reason
    from public.payout_report_items i
    join public.provider_payouts p on p.id = i.payout_id
    left join public.payout_failures f on f.id = p.failure_id
    left join public.provider_payouts op on op.id = f.payout_id
    left join public.treatment_sessions os on os.id = op.session_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id, os.client_id)
   where i.report_id = p_report_id and i.status = 'incluido'
   order by i.finished_on, i.procedure_name, i.id;
end;
$$;
revoke execute on function public.my_payout_report_detail(uuid) from public, anon, authenticated;
grant execute on function public.my_payout_report_detail(uuid) to authenticated;

-- 11e) As ocorrências — de uma unidade (Financeiro) ou todas as que eu leio ou
--      decido (p_clinic_id nulo). O dentista não lê ocorrências: ele vê o
--      desconto, com o motivo, no relatório dele.
drop function if exists public.payout_failure_list(uuid);
create function public.payout_failure_list(p_clinic_id uuid default null)
returns table (
  id uuid,
  clinic_id uuid,
  clinic_name text,
  provider_id uuid,
  provider_name text,
  payout_id uuid,
  procedure_name text,
  finished_on date,
  client_id uuid,
  client_name text,
  payout_cents bigint,
  source text,
  source_note text,
  resolution text,
  status text,
  outcome text,
  base_cents bigint,
  discount_cents bigint,
  decision_reason text,
  decided_by_name text,
  decided_at timestamptz,
  created_by_name text,
  created_at timestamptz,
  can_decide boolean,
  paid_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then return; end if;
  return query
  select f.id, f.clinic_id, c.name, f.provider_id, pr.full_name, f.payout_id,
         p.procedure_name, p.accrual_date,
         coalesce(s.client_id, m.client_id), cl.full_name,
         p.amount_cents, f.source, f.source_note, f.resolution, f.status, f.outcome,
         f.base_cents, f.discount_cents, f.decision_reason, db.full_name, f.decided_at,
         cb.full_name, f.created_at,
         public.can_decide_payout_failure(f.id),
         case
           when p.closing_id is not null then 'pago'
           when exists (select 1 from public.payout_report_items i
                          join public.payout_payments pp on pp.id = i.payment_id and pp.status = 'ativa'
                         where i.payout_id = p.id) then 'em_conta'
           when exists (select 1 from public.payout_report_items i
                         where i.payout_id = p.id and i.active and i.status = 'incluido') then 'em_relatorio'
           else 'fora_de_relatorio'
         end::text
    from public.payout_failures f
    join public.clinics c on c.id = f.clinic_id
    join public.provider_payouts p on p.id = f.payout_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id)
    left join public.profiles pr on pr.id = f.provider_id
    left join public.profiles db on db.id = f.decided_by
    left join public.profiles cb on cb.id = f.created_by
   where (p_clinic_id is null or f.clinic_id = p_clinic_id)
     and f.provider_id <> (select auth.uid())
     and (
       f.clinic_id in (select public.finance_visible_clinic_ids())
       or (select auth.uid()) in (select public._payout_failure_deciders(f.clinic_id, f.provider_id))
     )
   order by (f.status = 'aberta') desc, f.created_at desc;
end;
$$;
revoke execute on function public.payout_failure_list(uuid) from public, anon, authenticated;
grant execute on function public.payout_failure_list(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 12) Auditoria
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- Conferência (só leitura) ------------------------------------------------------
-- Esperado: tabela = 1 · colunas_do_repasse = 2 · gatilhos = 2 · funcoes = 6 ·
-- regras_de_escrita = 0 · uma_sessao_viva = 1 · rotina_diaria = 1
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'payout_failures') as tabela,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'provider_payouts'
      and column_name in ('failure_id', 'failure_voided_at')) as colunas_do_repasse,
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgname in ('plan_quality_reviews_payout_failure', 'plan_cancellations_payout_failure')) as gatilhos,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('payout_failure_open', 'payout_failure_decide', 'payout_failure_list',
                      'can_decide_payout_failure', 'payout_failure_reminder_run',
                      '_payout_failure_deciders')) as funcoes,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'payout_failures' and cmd <> 'SELECT') as regras_de_escrita,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'provider_payouts_session_live_unique') as uma_sessao_viva,
  (select count(*) from cron.job where jobname = 'risarte-payout-failures-daily') as rotina_diaria;
