-- =============================================================================
-- 0413 — FUNÇÕES DE APOIO, ENTREGA F1: OS LEITORES PRONTOS PARA MAIS DE UMA
--        FUNÇÃO POR PESSOA NA MESMA UNIDADE
--
-- Plano aprovado pelo dono em 16/11/2026 (D1–D15 como recomendado):
-- docs/equipe/FUNCOES-DE-APOIO-PLANO.md. A ordem é de propósito: ANTES de
-- soltar a trava `unique (user_id, clinic_id)` (F2), corrigir tudo o que daria
-- erro calado com duas linhas de função na mesma unidade. Nada muda para
-- ninguém hoje: todas as funções existentes viram "principal".
--
--   1. `assignment_kind` (principal | apoio) na função; uma principal por
--      pessoa por unidade.
--   2. Dinheiro: o nível de carreira e o repasse leem a função PRINCIPAL (D8);
--      o relatório e o histórico deixam de somar em dobro.
--   3. A tranca do sistema real passa a ser por FUNÇÃO: certificada numa e não
--      na outra, só a outra fica fechada (antes fechava a unidade inteira).
--      Liberar/tirar o acesso recebem a função.
--   4. Avisos: o mesmo aviso para a mesma pessoa, no mesmo instante, sai uma
--      vez só (12 funções mandavam em dobro para quem tem duas das funções
--      avisadas; a trava fica no banco, para as de hoje e as que vierem).
--   5. Rótulo de quem pediu em Compras: a função principal.
--
-- Nada apaga dado de negócio. Idempotente.
-- =============================================================================

-- 1) Principal × apoio ---------------------------------------------------------
alter table public.user_clinic_roles_all
  add column if not exists assignment_kind text not null default 'principal';

alter table public.user_clinic_roles_all
  drop constraint if exists user_clinic_roles_assignment_kind_check;
alter table public.user_clinic_roles_all
  add constraint user_clinic_roles_assignment_kind_check
  check (assignment_kind in ('principal', 'apoio'));

comment on column public.user_clinic_roles_all.assignment_kind is
  'principal = o cargo da pessoa na unidade (uma só); apoio = cobertura temporária ou acúmulo fixo (funções de apoio, 0413/F2).';

-- Uma principal por pessoa por unidade (a trava antiga, uma função por unidade,
-- continua até a F2; esta é a que fica depois dela).
create unique index if not exists user_clinic_roles_one_principal
  on public.user_clinic_roles_all (user_id, clinic_id)
  where assignment_kind = 'principal';

-- 2) Dinheiro ------------------------------------------------------------------
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
  -- 0387: marcado "sem repasse" no cadastro — não paga por nenhum degrau.
  if exists (
    select 1 from public.procedure_commissions c
    where c.procedure_id = p_procedure_id and c.no_payout
  ) then
    return;
  end if;

  select ucr.career_level_id into v_level
  from public.user_clinic_roles ucr
  where ucr.user_id = p_provider_id and ucr.clinic_id = p_clinic_id
  -- 0413: o nível é o da função PRINCIPAL (decisão D8 das funções de apoio).
  order by (ucr.assignment_kind = 'principal') desc, (ucr.career_level_id is not null) desc
  limit 1;

  -- Degraus 1 e 2: tabela com vigência. Pessoa vence nível, unidade vence
  -- rede, e entre as vigentes a mais recente manda.
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
  order by (r.provider_id is not null) desc,
           (r.clinic_id is not null) desc,
           r.valid_from desc
  limit 1;

  if v_rate.id is not null then
    return query select v_rate.id, v_rate.amount_cents,
      case when v_rate.provider_id is not null then 'individual' else 'nivel' end;
    return;
  end if;

  -- Degraus 3 e 4: o cadastro do procedimento — na irmã (0364).
  select coalesce(c.commission_fixed_cents, 0) as commission_fixed_cents,
         coalesce(c.commission_percent, 0) as commission_percent,
         p.default_price_cents
    into v_proc
  from public.procedures p
  left join public.procedure_commissions c on c.procedure_id = p.id
  where p.id = p_procedure_id;

  if coalesce(v_proc.commission_fixed_cents, 0) > 0 then
    return query select null::uuid, v_proc.commission_fixed_cents::bigint,
                        'procedimento_fixo';
    return;
  end if;

  if coalesce(v_proc.commission_percent, 0) > 0 then
    return query select null::uuid,
      round(coalesce(v_proc.default_price_cents, 0)
            * v_proc.commission_percent / 100.0)::bigint,
      'procedimento_percentual';
    return;
  end if;

  return;
end;
$$;

create or replace function public.payout_report_candidates(p_clinic_id uuid, p_month date)
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
     -- 0413: só a linha principal — com função de apoio, o total dobraria.
     and u.assignment_kind = 'principal'
    left join public.career_levels l on l.id = u.career_level_id
   group by a.a_provider, pr.full_name, l.name
   order by pr.full_name;
end;
$$;

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
     -- 0413: o nível da função PRINCIPAL (D8).
     order by (u.assignment_kind = 'principal') desc, (u.career_level_id is not null) desc
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

create or replace function public.payout_history(
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
     -- 0413: só a linha principal — com função de apoio, a soma dobraria.
     and u.assignment_kind = 'principal'
    left join public.career_levels lv on lv.id = u.career_level_id
   group by l.month, l.provider_id, pr.full_name, lv.name
   having count(*) filter (where l.kind <> 'nao_pagar') > 0
   order by l.month, pr.full_name;
end;
$$;

-- 3) A tranca por FUNÇÃO --------------------------------------------------------
alter table public.system_closed_clinics
  add column if not exists role public.user_role;

-- DESTRUTIVO: system_closed_clinics é DERIVADA (0277, "nunca se escreve à mão") e é recalculada logo abaixo, por função, para todas as pessoas.
delete from public.system_closed_clinics where role is null;

alter table public.system_closed_clinics alter column role set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'system_closed_clinics_pkey'
       and array_length(conkey, 1) = 2
  ) then
    alter table public.system_closed_clinics drop constraint system_closed_clinics_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'system_closed_clinics_pkey'
  ) then
    alter table public.system_closed_clinics
      add constraint system_closed_clinics_pkey primary key (user_id, clinic_id, role);
  end if;
end $$;

comment on table public.system_closed_clinics is
  'DERIVADA da regra da 0276: (pessoa, unidade, FUNÇÃO) com o sistema real fechado. Por função desde a 0413. Recalculada por gatilho; nunca se escreve à mão.';

create or replace function public.refresh_system_closed(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  delete from public.system_closed_clinics where user_id = p_user_id;
  -- No treino não há tranca: lá é onde se pratica.
  if public.is_mirror_db() then
    return;
  end if;
  -- 0413: fecha a FUNÇÃO, não a unidade inteira (funções de apoio).
  insert into public.system_closed_clinics (user_id, clinic_id, role)
  select distinct p_user_id, r.clinic_id, r.role
    from public._system_access_raw(p_user_id) r
   where not r.allowed
  on conflict do nothing;
end;
$$;

revoke all on function public.refresh_system_closed(uuid) from public, anon, authenticated;

-- Recalcula todo mundo, já por função.
do $$
declare r record;
begin
  for r in select distinct user_id from public.user_clinic_roles_all loop
    perform public.refresh_system_closed(r.user_id);
  end loop;
end $$;

-- A janela esconde só a FUNÇÃO fechada (antes: todas as da unidade).
-- `select *` é expandido na criação: recriar traz a coluna nova.
create or replace view public.user_clinic_roles
with (security_invoker = true) as
  select *
    from public.user_clinic_roles_all r
   where r.user_id is distinct from auth.uid()
      or not exists (
        select 1 from public.system_closed_clinics c
         where c.user_id = r.user_id
           and c.clinic_id = r.clinic_id
           and c.role = r.role
      );

comment on view public.user_clinic_roles is
  'Janela sobre user_clinic_roles_all que esconde, de QUEM CHAMA, as funções fechadas para ela (0277; por função desde a 0413). Estrutura (gatilho, política, coluna) mexe-se em user_clinic_roles_all.';

alter view public.user_clinic_roles alter column id set default gen_random_uuid();
alter view public.user_clinic_roles alter column created_at set default now();
alter view public.user_clinic_roles alter column assignment_kind set default 'principal';

grant select, insert, update, delete on public.user_clinic_roles to anon, authenticated, service_role;

-- Liberar e tirar o acesso: com a função (nova assinatura → drop + create).
drop function if exists public.grant_clinic_access(uuid, uuid, text);
create or replace function public.grant_clinic_access(
  p_user_id uuid,
  p_clinic_id uuid,
  p_note text,
  p_role public.user_role default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'NOTE_REQUIRED';
  end if;

  -- 0413: com mais de uma função na unidade, o Admin diz QUAL libera.
  if p_role is not null then
    select ucr.role into v_role
      from public.user_clinic_roles_all ucr
     where ucr.user_id = p_user_id and ucr.clinic_id = p_clinic_id
       and ucr.role = p_role;
  else
    if (select count(*) from public.user_clinic_roles_all ucr
         where ucr.user_id = p_user_id and ucr.clinic_id = p_clinic_id) > 1 then
      raise exception 'ROLE_REQUIRED';
    end if;
    select ucr.role into v_role
      from public.user_clinic_roles_all ucr
     where ucr.user_id = p_user_id and ucr.clinic_id = p_clinic_id;
  end if;
  if v_role is null then
    raise exception 'NO_ROLE_IN_CLINIC';
  end if;

  insert into public.system_clinic_access
    (user_id, clinic_id, role, source, note, granted_by)
  values (p_user_id, p_clinic_id, v_role, 'manual', btrim(p_note), auth.uid())
  on conflict (user_id, clinic_id, role) do update
    set source = 'manual',
        note = excluded.note,
        granted_at = now(),
        granted_by = excluded.granted_by,
        revoked_at = null,
        revoked_by = null;
end;
$$;

revoke execute on function public.grant_clinic_access(uuid, uuid, text, public.user_role) from public, anon, authenticated;
grant execute on function public.grant_clinic_access(uuid, uuid, text, public.user_role) to authenticated, service_role;

drop function if exists public.revoke_clinic_access(uuid, uuid);
create or replace function public.revoke_clinic_access(
  p_user_id uuid,
  p_clinic_id uuid,
  p_role public.user_role default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.system_clinic_access
     set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id
     and clinic_id = p_clinic_id
     -- 0413: sem a função, tira todas (como antes); com ela, só aquela.
     and (p_role is null or role = p_role)
     and revoked_at is null;

  return found;
end;
$$;

revoke execute on function public.revoke_clinic_access(uuid, uuid, public.user_role) from public, anon, authenticated;
grant execute on function public.revoke_clinic_access(uuid, uuid, public.user_role) to authenticated, service_role;

-- 4) Avisos: um por pessoa, por fato --------------------------------------------
-- O mesmo aviso (pessoa, unidade, título, texto, link) no MESMO instante da
-- transação é o mesmo fato: a segunda linha não entra. Pega as 12 funções que
-- mandam para "quem tem a função X ou Y" sem `distinct` e as que vierem.
create or replace function public._notification_dedupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.notifications n
     where n.user_id = new.user_id
       and n.created_at = new.created_at
       and n.title is not distinct from new.title
       and n.body is not distinct from new.body
       and n.link is not distinct from new.link
       and n.clinic_id is not distinct from new.clinic_id
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function public._notification_dedupe() from public, anon, authenticated;

drop trigger if exists notifications_dedupe on public.notifications;
create trigger notifications_dedupe
  before insert on public.notifications
  for each row execute function public._notification_dedupe();

-- 5) Rótulo de quem pediu em Compras --------------------------------------------
create or replace function public.purchase_request_authors(p_ids uuid[])
returns table (
  request_id uuid,
  created_by_name text,
  created_by_role text,
  sent_by_name text,
  sent_by_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- A função de quem age NA UNIDADE da lista; sem função lá (Admin, ou o
  -- Financeiro da Franqueadora agindo numa unidade), a primeira que tiver.
  with pessoa as (
    select r.id as request_id, r.clinic_id, x.kind, x.user_id
    from public.purchase_requests r
    cross join lateral (values ('criou', r.created_by), ('enviou', r.sent_by)) as x(kind, user_id)
    where r.id = any(p_ids)
      and x.user_id is not null
      -- A MESMA régua de leitura da lista (0239): quem não vê a lista não vê
      -- quem a pediu.
      and (r.clinic_id in (select public.user_clinic_ids())
           or public.is_admin_master()
           or ((public.is_purchaser() or public.is_finance_franchisor())
               and r.status <> 'rascunho'))
  ),
  rotulo as (
    select p.request_id, p.kind,
           pr.full_name,
           coalesce(
             (select u.role::text from public.user_clinic_roles_all u
               where u.user_id = p.user_id and u.clinic_id = p.clinic_id
               order by (u.assignment_kind = 'principal') desc
               limit 1),
             case when pr.is_admin_master then 'admin_master' end,
             (select u.role::text from public.user_clinic_roles_all u
               where u.user_id = p.user_id
               order by u.role::text limit 1)
           ) as role
    from pessoa p
    join public.profiles pr on pr.id = p.user_id
  )
  select r.id,
         c.full_name, c.role,
         s.full_name, s.role
  from public.purchase_requests r
  left join rotulo c on c.request_id = r.id and c.kind = 'criou'
  left join rotulo s on s.request_id = r.id and s.kind = 'enviou'
  where r.id in (select request_id from pessoa);
$$;
