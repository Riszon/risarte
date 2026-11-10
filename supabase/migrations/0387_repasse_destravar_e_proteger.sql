-- =============================================================================
-- 0387 — REPASSE DOS DENTISTAS, ETAPA 1: DESTRAVAR E PROTEGER
--
-- PEDIDO DO DONO (10/11/2026): refazer o repasse "de forma segura, inteligente
-- e funcional" — "está confuso, difícil de achar, poucas informações e não
-- conseguimos gerar nenhum repasse até agora". Plano em 5 etapas e as 14
-- decisões em docs/Financeiro/REPASSE-PLANO.md. Esta é a primeira.
--
-- O QUE ESTAVA ERRADO (lido no treino, onde o repasse é testado):
--   • todo repasse apurado nasceu com R$ 0,00: o valor é congelado na hora em
--     que o procedimento é concluído, e quem testou definiu o nível do
--     dentista / cadastrou a tabela DEPOIS. Não havia como recalcular, e o
--     "Fechar o mês" recusa mês cuja soma é zero (NOTHING_TO_CLOSE);
--   • a tela só dizia "R$ 0,00", sem o motivo; procedimento de várias sessões
--     ainda incompleto (regra da 0352) e sessão sem procedimento do catálogo
--     simplesmente não apareciam;
--   • quem lança dinheiro podia ALTERAR ou APAGAR uma linha de repasse pela
--     API (regra `for all`), inclusive de mês já fechado; e apagar a sessão
--     levava o repasse junto (`on delete cascade`).
--
-- O QUE MUDA:
--   1) "SEM REPASSE" no cadastro do procedimento (decisão 13):
--      `procedure_commissions.no_payout`. `payout_rate_for` não devolve valor
--      para ele, e a linha apurada nasce marcada (`provider_payouts.no_payout`)
--      — não é pendência nem entra em relatório;
--   2) a linha guarda QUANTOS procedimentos paga (`units`, o "bloco único" da
--      0352), para o recálculo não precisar adivinhar;
--   3) RECALCULAR o que saiu zerado: `payout_recalculate` (uma linha) e
--      `payout_recalculate_zeros` (a unidade). Só linha com R$ 0,00 e fora de
--      fechamento; usa a tabela que vale NA DATA do procedimento; grava quem
--      e quando. Valor diferente de zero continua congelado (regra do FIN5);
--   4) PENDÊNCIAS COM O MOTIVO: `payout_watchlist` devolve o que saiu zerado
--      (e por quê), o que está em andamento (faltam sessões), a sessão
--      concluída sem procedimento do catálogo e a sem profissional;
--   5) TRAVAS:
--      • linha que entrou em fechamento não é alterada nem apagada
--        (PAYOUT_LOCKED);
--      • apagar a sessão não apaga mais o repasse (a exclusão é recusada);
--      • ninguém grava em `provider_payouts` direto pela API: só as funções.
--
-- O QUE NÃO MUDA: a regra da 0352 (por procedimento concluído; revisão não
-- paga; refação não paga de novo; recebe quem concluiu a última sessão —
-- confirmado pelo dono, decisão 10) e o `close_payout_month`, que sai na
-- Etapa 4. `accrue_session_payout` é o corpo da 0352 mais a coluna `units`.
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas novas
-- -----------------------------------------------------------------------------
alter table public.procedure_commissions
  add column if not exists no_payout boolean not null default false;
comment on column public.procedure_commissions.no_payout is
  'Sem repasse (0387): o procedimento não paga o dentista de propósito. Não vira pendência nem entra em relatório.';

alter table public.provider_payouts
  add column if not exists units integer not null default 1 check (units >= 1),
  add column if not exists no_payout boolean not null default false,
  add column if not exists recalculated_at timestamptz,
  add column if not exists recalculated_by uuid references public.profiles (id);
comment on column public.provider_payouts.units is
  'Quantos procedimentos esta linha paga (0387). Maior que 1 só no bloco único da 0352.';
comment on column public.provider_payouts.no_payout is
  'O procedimento estava marcado "sem repasse" quando a linha nasceu (0387).';

-- -----------------------------------------------------------------------------
-- 2) O valor da tabela: procedimento "sem repasse" não devolve nada
--    (corpo da 0364 + a saída no começo)
-- -----------------------------------------------------------------------------
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

revoke execute on function public.payout_rate_for(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.payout_rate_for(uuid, uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A linha nasce marcada quando o procedimento é "sem repasse"
--    (uma porta só: vale para a sessão e para a manutenção da Ortodontia)
-- -----------------------------------------------------------------------------
create or replace function public.provider_payouts_mark_no_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.procedure_id is not null and exists (
    select 1 from public.procedure_commissions c
    where c.procedure_id = new.procedure_id and c.no_payout
  ) then
    new.no_payout := true;
    new.amount_cents := 0;
    new.rate_id := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.provider_payouts_mark_no_payout() from public, anon, authenticated;

drop trigger if exists provider_payouts_mark_no_payout on public.provider_payouts;
create trigger provider_payouts_mark_no_payout
  before insert on public.provider_payouts
  for each row execute function public.provider_payouts_mark_no_payout();

-- -----------------------------------------------------------------------------
-- 4) A apuração guarda quantos procedimentos a linha paga
--    (corpo da 0352, sem mudar a regra; só a coluna `units` no insert)
-- -----------------------------------------------------------------------------
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
  v_was_done boolean := (TG_OP = 'UPDATE' and coalesce(old.status, '') = 'done');
  v_total integer;
  v_qty integer;
  v_per integer;
  v_units integer := 1;
  v_from integer;
  v_to integer;
  v_block uuid[];
begin
  if new.status <> 'done' or v_was_done then
    return new;
  end if;
  if new.procedure_id is null or new.clinic_id is null then
    return new;
  end if;
  -- Revisão não é procedimento novo.
  if new.redo_kind is not distinct from 'revisao' then
    return new;
  end if;

  v_provider := coalesce(new.executed_by, new.planner_provider_id);
  if v_provider is null then return new; end if;

  if new.item_id is null then
    -- Venda direta (e sessão avulsa): cada sessão já é um procedimento.
    v_block := array[new.id];
  else
    select count(*) into v_total
    from public.treatment_sessions s
    where s.item_id = new.item_id
      and s.redo_kind is distinct from 'revisao';

    select greatest(1, coalesce(i.quantity, 1)) into v_qty
    from public.treatment_plan_option_items i
    where i.id = new.item_id;
    v_qty := coalesce(v_qty, 1);

    if v_total >= v_qty and v_total % v_qty = 0 then
      v_per := v_total / v_qty;          -- um procedimento a cada v_per sessões
    else
      v_per := greatest(v_total, 1);     -- o item inteiro é um bloco só
      v_units := v_qty;
    end if;

    v_from := ((greatest(new.session_index, 1) - 1) / v_per) * v_per + 1;
    v_to := v_from + v_per - 1;

    select coalesce(array_agg(s.id), array[]::uuid[]) into v_block
    from public.treatment_sessions s
    where s.item_id = new.item_id
      and s.redo_kind is distinct from 'revisao'
      and s.session_index between v_from and v_to;

    -- Falta sessão do procedimento: ainda não é a hora.
    if exists (
      select 1 from public.treatment_sessions s
      where s.id = any(v_block) and s.status <> 'done'
    ) then
      return new;
    end if;

    if not (new.id = any(v_block)) then
      v_block := v_block || new.id;
    end if;
  end if;

  -- O procedimento já tem repasse (refação concluída de novo): não paga outra vez.
  if exists (
    select 1 from public.provider_payouts p where p.session_id = any(v_block)
  ) then
    return new;
  end if;

  v_when := coalesce(new.done_at::date, public.today_br());

  select * into v_rate
  from public.payout_rate_for(new.procedure_id, v_provider, new.clinic_id, v_when);

  insert into public.provider_payouts (
    clinic_id, provider_id, session_id, procedure_id, procedure_name,
    accrual_date, amount_cents, rate_id, units
  ) values (
    new.clinic_id, v_provider, new.id, new.procedure_id, new.procedure_name,
    v_when, coalesce(v_rate.amount_cents, 0) * v_units, v_rate.rate_id, v_units
  )
  on conflict do nothing;

  return new;
end;
$$;

comment on function public.accrue_session_payout() is
  'Repasse por PROCEDIMENTO concluído (0352, AP61): lança uma vez, quando a última sessão do procedimento termina; revisão não paga; refação não paga de novo. 0387: guarda `units`.';

revoke execute on function public.accrue_session_payout() from public, anon, authenticated;

drop trigger if exists treatment_sessions_accrue_payout on public.treatment_sessions;
create trigger treatment_sessions_accrue_payout
  after insert or update on public.treatment_sessions
  for each row execute function public.accrue_session_payout();

-- As linhas que já existem: `units` pelo mesmo critério do bloco único. Só as
-- que ainda não entraram em fechamento (as fechadas não são tocadas).
update public.provider_payouts p
   set units = x.qty
  from (
    select s.id as session_id,
           greatest(1, coalesce(i.quantity, 1)) as qty,
           (select count(*) from public.treatment_sessions t
             where t.item_id = s.item_id
               and t.redo_kind is distinct from 'revisao') as total
      from public.treatment_sessions s
      join public.treatment_plan_option_items i on i.id = s.item_id
  ) x
 where p.session_id = x.session_id
   and p.closing_id is null
   and not (x.total >= x.qty and x.total % x.qty = 0)
   and p.units is distinct from x.qty;

-- -----------------------------------------------------------------------------
-- 5) TRAVAS
-- -----------------------------------------------------------------------------
-- 5a) Linha em fechamento não muda nem some.
create or replace function public.provider_payouts_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.closing_id is not null then
    raise exception 'PAYOUT_LOCKED'
      using hint = 'Este repasse já entrou em fechamento e não pode ser alterado nem apagado.';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.provider_payouts_lock() from public, anon, authenticated;

drop trigger if exists provider_payouts_lock on public.provider_payouts;
create trigger provider_payouts_lock
  before update or delete on public.provider_payouts
  for each row execute function public.provider_payouts_lock();

-- 5b) Apagar a sessão não apaga mais o repasse: a exclusão é recusada.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'public.provider_payouts'::regclass
     and c.contype = 'f'
     and c.confrelid = 'public.treatment_sessions'::regclass
     and c.confdeltype <> 'r'
   limit 1;
  if v_name is not null then
    execute format('alter table public.provider_payouts drop constraint %I', v_name);
    alter table public.provider_payouts
      add constraint provider_payouts_session_id_fkey
      foreign key (session_id) references public.treatment_sessions (id) on delete restrict;
  end if;
end $$;

-- 5c) Ninguém grava direto pela API: só as funções (apuração, recálculo,
--     fechamento, Ortodontia), que rodam com a própria guarda.
drop policy if exists "provider_payouts_write" on public.provider_payouts;

-- -----------------------------------------------------------------------------
-- 6) RECALCULAR o que saiu zerado
-- -----------------------------------------------------------------------------
create or replace function public.payout_recalculate(p_payout_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.provider_payouts%rowtype;
  v_rate record;
  v_new bigint;
  v_user uuid := (select auth.uid());
  v_flagged boolean;
begin
  select * into v_p from public.provider_payouts where id = p_payout_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.can_post_finance(v_p.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_p.closing_id is not null then raise exception 'PAYOUT_LOCKED'; end if;
  -- Valor apurado diferente de zero fica CONGELADO (FIN5): reajuste de tabela
  -- nunca reescreve o que já foi produzido.
  if v_p.amount_cents <> 0 then raise exception 'PAYOUT_NOT_ZERO'; end if;
  if v_p.procedure_id is null then return 0; end if;

  select coalesce(c.no_payout, false) into v_flagged
    from public.procedure_commissions c where c.procedure_id = v_p.procedure_id;
  v_flagged := coalesce(v_flagged, false);

  if v_flagged then
    -- Marcado "sem repasse" depois: a linha sai das pendências.
    if not v_p.no_payout then
      update public.provider_payouts
         set no_payout = true, recalculated_at = now(), recalculated_by = v_user
       where id = p_payout_id;
    end if;
    return 0;
  end if;

  select * into v_rate
    from public.payout_rate_for(v_p.procedure_id, v_p.provider_id, v_p.clinic_id, v_p.accrual_date);
  v_new := coalesce(v_rate.amount_cents, 0) * v_p.units;

  if v_new = 0 and not v_p.no_payout then
    return 0;   -- continua pendente; a tela mostra o motivo
  end if;

  update public.provider_payouts
     set amount_cents = v_new,
         rate_id = v_rate.rate_id,
         no_payout = false,
         recalculated_at = now(),
         recalculated_by = v_user
   where id = p_payout_id;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_p.clinic_id, 'update', 'provider_payout', p_payout_id::text,
          jsonb_build_object('recalculated', true, 'from_cents', 0, 'to_cents', v_new));

  return v_new;
end;
$$;
revoke execute on function public.payout_recalculate(uuid) from public, anon, authenticated;
grant execute on function public.payout_recalculate(uuid) to authenticated;

create or replace function public.payout_recalculate_zeros(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_fixed integer := 0;
begin
  if p_clinic_id is null or not public.can_post_finance(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  for r in
    select p.id from public.provider_payouts p
     where p.clinic_id = p_clinic_id
       and p.closing_id is null
       and p.amount_cents = 0
     order by p.accrual_date, p.id
  loop
    if public.payout_recalculate(r.id) > 0 then
      v_fixed := v_fixed + 1;
    end if;
  end loop;
  return v_fixed;
end;
$$;
revoke execute on function public.payout_recalculate_zeros(uuid) from public, anon, authenticated;
grant execute on function public.payout_recalculate_zeros(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) PENDÊNCIAS COM O MOTIVO
--    kind:   zerado | em_andamento | sem_procedimento | sem_profissional
--    reason (só no zerado): recalculavel | sem_nivel | sem_valor
-- -----------------------------------------------------------------------------
drop function if exists public.payout_watchlist(uuid);
create function public.payout_watchlist(p_clinic_id uuid)
returns table (
  kind text,
  payout_id uuid,
  session_id uuid,
  provider_id uuid,
  provider_name text,
  procedure_id uuid,
  procedure_name text,
  ref_date date,
  done_count integer,
  total_count integer,
  reason text,
  would_pay_cents bigint
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
  with zerados as (
    select p.id as z_id, p.session_id as z_session, p.provider_id as z_provider,
           p.procedure_id as z_proc, p.procedure_name as z_name,
           p.accrual_date as z_date, p.units as z_units,
           (select r.amount_cents
              from public.payout_rate_for(p.procedure_id, p.provider_id, p.clinic_id, p.accrual_date) r
             limit 1) as z_rate
      from public.provider_payouts p
      left join public.procedure_commissions c on c.procedure_id = p.procedure_id
     where p.clinic_id = p_clinic_id
       and p.closing_id is null
       and p.amount_cents = 0
       and not coalesce(c.no_payout, false)
  ),
  base as (
    select s.id as b_id, s.item_id as b_item, s.session_index as b_index,
           s.status as b_status, s.done_at as b_done_at,
           s.procedure_id as b_proc, s.procedure_name as b_name,
           coalesce(s.executed_by, s.planner_provider_id) as b_provider
      from public.treatment_sessions s
     where s.clinic_id = p_clinic_id
       and s.item_id is not null
       and s.redo_kind is distinct from 'revisao'
  ),
  itens as (
    select b.b_item as i_item, count(*)::integer as i_total,
           greatest(1, coalesce(max(i.quantity), 1))::integer as i_qty
      from base b
      left join public.treatment_plan_option_items i on i.id = b.b_item
     group by b.b_item
  ),
  tamanho as (
    select t.i_item as t_item,
           case when t.i_total >= t.i_qty and t.i_total % t.i_qty = 0
                then t.i_total / t.i_qty
                else greatest(t.i_total, 1) end as t_per
      from itens t
  ),
  blocos as (
    select b.b_item as k_item,
           ((greatest(b.b_index, 1) - 1) / t.t_per) as k_bloco,
           count(*)::integer as k_total,
           (count(*) filter (where b.b_status = 'done'))::integer as k_done,
           max(b.b_done_at) as k_last,
           min(b.b_name) as k_name,
           (array_agg(b.b_proc))[1] as k_proc,
           (array_agg(b.b_provider order by b.b_done_at desc nulls last)
              filter (where b.b_status = 'done'))[1] as k_provider,
           array_agg(b.b_id) as k_ids
      from base b
      join tamanho t on t.t_item = b.b_item
     group by b.b_item, ((greatest(b.b_index, 1) - 1) / t.t_per)
  )
  -- a) Repasse apurado com R$ 0,00, e o motivo.
  select 'zerado'::text, z.z_id, z.z_session, z.z_provider, pr.full_name,
         z.z_proc, z.z_name, z.z_date, null::integer, null::integer,
         case
           when coalesce(z.z_rate, 0) > 0 then 'recalculavel'
           when not exists (
             select 1 from public.user_clinic_roles_all u
              where u.user_id = z.z_provider and u.clinic_id = p_clinic_id
                and u.career_level_id is not null
           ) then 'sem_nivel'
           else 'sem_valor'
         end::text,
         (coalesce(z.z_rate, 0) * z.z_units)::bigint
    from zerados z
    left join public.profiles pr on pr.id = z.z_provider

  union all
  -- b) Procedimento de várias sessões ainda incompleto (regra da 0352).
  select 'em_andamento'::text, null::uuid, null::uuid, k.k_provider, pr.full_name,
         k.k_proc, k.k_name,
         (k.k_last at time zone 'America/Sao_Paulo')::date,
         k.k_done, k.k_total, null::text, null::bigint
    from blocos k
    left join public.profiles pr on pr.id = k.k_provider
    left join public.procedure_commissions c on c.procedure_id = k.k_proc
   where k.k_done > 0 and k.k_done < k.k_total
     and k.k_proc is not null
     and not coalesce(c.no_payout, false)
     and not exists (
       select 1 from public.provider_payouts p where p.session_id = any(k.k_ids))

  union all
  -- c) Sessão concluída sem procedimento do catálogo: o sistema não sabe
  --    quanto pagar (itens antigos, escritos em texto livre).
  select 'sem_procedimento'::text, null::uuid, s.id,
         coalesce(s.executed_by, s.planner_provider_id), pr.full_name,
         null::uuid, s.procedure_name,
         (s.done_at at time zone 'America/Sao_Paulo')::date,
         null::integer, null::integer, null::text, null::bigint
    from public.treatment_sessions s
    left join public.profiles pr on pr.id = coalesce(s.executed_by, s.planner_provider_id)
   where s.clinic_id = p_clinic_id
     and s.status = 'done'
     and s.procedure_id is null
     and s.redo_kind is distinct from 'revisao'

  union all
  -- d) Sessão concluída sem profissional: não há a quem pagar.
  select 'sem_profissional'::text, null::uuid, s.id, null::uuid, null::text,
         s.procedure_id, s.procedure_name,
         (s.done_at at time zone 'America/Sao_Paulo')::date,
         null::integer, null::integer, null::text, null::bigint
    from public.treatment_sessions s
    left join public.procedure_commissions c on c.procedure_id = s.procedure_id
   where s.clinic_id = p_clinic_id
     and s.status = 'done'
     and s.procedure_id is not null
     and s.executed_by is null and s.planner_provider_id is null
     and s.redo_kind is distinct from 'revisao'
     and not coalesce(c.no_payout, false);
end;
$$;
revoke execute on function public.payout_watchlist(uuid) from public, anon, authenticated;
grant execute on function public.payout_watchlist(uuid) to authenticated;

-- Conferência (só leitura) ------------------------------------------------------
-- Esperado: sem_repasse_no_cadastro = 1 · colunas_novas_no_repasse = 4 ·
-- funcoes = 3 · gatilhos = 3 · regra_de_escrita_livre = 0 · sessao_restrita = 1
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'procedure_commissions'
      and column_name = 'no_payout') as sem_repasse_no_cadastro,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'provider_payouts'
      and column_name in ('units', 'no_payout', 'recalculated_at', 'recalculated_by'))
    as colunas_novas_no_repasse,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('payout_recalculate', 'payout_recalculate_zeros', 'payout_watchlist'))
    as funcoes,
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgname in ('provider_payouts_lock', 'provider_payouts_mark_no_payout',
                     'treatment_sessions_accrue_payout')) as gatilhos,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'provider_payouts'
      and policyname = 'provider_payouts_write') as regra_de_escrita_livre,
  (select count(*) from pg_constraint
    where conrelid = 'public.provider_payouts'::regclass and contype = 'f'
      and confrelid = 'public.treatment_sessions'::regclass and confdeltype = 'r')
    as sessao_restrita;
