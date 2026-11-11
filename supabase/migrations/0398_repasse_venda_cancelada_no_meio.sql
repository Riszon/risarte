-- =============================================================================
-- 0398 — REPASSE: VENDA CANCELADA NO MEIO DE UM PROCEDIMENTO PAGA O QUE FOI
--        FEITO, PROPORCIONAL ÀS SESSÕES (AP141)
--
-- O QUE ESTAVA ERRADO (lido no código, 11/11/2026):
--   O repasse de um procedimento de várias sessões só nasce quando TODAS as
--   sessões dele estão concluídas (0352/0387). Ao cancelar a venda
--   (`apply_plan_cancellation`, 0360), as sessões que faltavam viram
--   "canceladas" — e nunca mais ficam "concluídas". O procedimento ficava em
--   andamento para sempre e o dentista não recebia nada pelas sessões que já
--   tinha feito. Ninguém era avisado.
--
-- DECISÃO DO DONO (11/11/2026): PROPORCIONAL. Fez 2 de 3 sessões, recebe 2/3
-- do repasse do procedimento.
--
-- O QUE MUDA:
--   1) `provider_payouts` ganha `sessions_done` e `sessions_total` (vazias =
--      procedimento inteiro). Preenchidas = pago em parte, "2 de 3 sessões";
--   2) a conta do bloco saiu do gatilho para `_payout_accrue_block` (interna),
--      com uma diferença só: sessão CANCELADA não segura mais o procedimento.
--      Quando o bloco não tem mais nada por fazer (só concluídas e canceladas)
--      e tem pelo menos uma concluída, o repasse nasce:
--        valor = tabela × procedimentos × concluídas ÷ sessões do bloco;
--      recebe quem concluiu a última sessão feita (decisão 10 do repasse);
--   3) o gatilho chama a conta também quando uma sessão de item é CANCELADA
--      (é o cancelamento que fecha o procedimento, não uma conclusão);
--   4) `payout_recalculate` e `payout_watchlist` respeitam a fração (o
--      recálculo de linha zerada não pode pagar o procedimento inteiro);
--   5) os casos que já estavam presos são lançados agora (data = a da última
--      sessão concluída; só linha nova, nada existente é alterado).
--
-- O QUE NÃO MUDA: revisão não paga nem conta; refação não paga de novo;
-- venda direta (sessão sem item) segue sessão a sessão; valor diferente de
-- zero continua congelado; bloco sem nenhuma sessão concluída não paga nada.
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas novas
-- -----------------------------------------------------------------------------
alter table public.provider_payouts
  add column if not exists sessions_done integer,
  add column if not exists sessions_total integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.provider_payouts'::regclass
       and conname = 'provider_payouts_partial_check'
  ) then
    alter table public.provider_payouts
      add constraint provider_payouts_partial_check check (
        (sessions_done is null) = (sessions_total is null)
        and (sessions_total is null or (sessions_done >= 1 and sessions_done < sessions_total))
      );
  end if;
end $$;

comment on column public.provider_payouts.sessions_done is
  'AP141 (0398): pago em parte — sessões concluídas do procedimento. Vazio = procedimento inteiro.';
comment on column public.provider_payouts.sessions_total is
  'AP141 (0398): pago em parte — sessões do procedimento (as outras foram canceladas com a venda). Vazio = procedimento inteiro.';

-- -----------------------------------------------------------------------------
-- 2) A conta do bloco (interna)
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
  -- AP141: a cancelada (venda cancelada no meio) não segura mais o procedimento.
  if exists (
    select 1 from public.treatment_sessions s
    where s.id = any(v_block) and s.status not in ('done', 'cancelled')
  ) then
    return;
  end if;

  -- O procedimento já tem repasse (refação concluída de novo): não paga outra vez.
  if exists (
    select 1 from public.provider_payouts p where p.session_id = any(v_block)
  ) then
    return;
  end if;

  -- Quem recebe: quem concluiu a última sessão feita (a que disparou, se foi
  -- ela). Nenhuma concluída = nada foi feito, nada a pagar.
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
    -- Pago em parte: proporcional às sessões concluídas (decisão do dono).
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

comment on function public._payout_accrue_block(uuid) is
  'Repasse do procedimento (bloco de sessões de um item) — 0352/0387 + AP141 (0398): sessão cancelada não segura o bloco; pago em parte = proporcional às concluídas.';

-- -----------------------------------------------------------------------------
-- 3) O gatilho: conclusão OU cancelamento de sessão de item
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
  v_block uuid[];
begin
  -- AP141 (0398): cancelar a sessão que faltava pode fechar o procedimento.
  if new.status = 'cancelled' and new.item_id is not null
     and (TG_OP = 'INSERT' or old.status is distinct from 'cancelled') then
    perform public._payout_accrue_block(new.id);
    return new;
  end if;

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

  if new.item_id is null then
    -- Venda direta (e sessão avulsa): cada sessão já é um procedimento.
    v_block := array[new.id];
  else
    -- Item do plano: a conta do bloco mora em `_payout_accrue_block`.
    perform public._payout_accrue_block(new.id);
    return new;
  end if;

  v_provider := coalesce(new.executed_by, new.planner_provider_id);
  if v_provider is null then return new; end if;

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
    v_when, coalesce(v_rate.amount_cents, 0), v_rate.rate_id, 1
  )
  on conflict do nothing;

  return new;
end;
$$;

comment on function public.accrue_session_payout() is
  'Repasse por PROCEDIMENTO concluído (0352, AP61; units na 0387). 0398 (AP141): também dispara quando uma sessão de item é cancelada — o procedimento fecha pago em parte. A conta do bloco mora em _payout_accrue_block.';

revoke execute on function public.accrue_session_payout() from public, anon, authenticated;

drop trigger if exists treatment_sessions_accrue_payout on public.treatment_sessions;
create trigger treatment_sessions_accrue_payout
  after insert or update on public.treatment_sessions
  for each row execute function public.accrue_session_payout();

-- -----------------------------------------------------------------------------
-- 4) Recalcular linha zerada respeita a fração (corpo da 0387 + a fração)
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
  -- AP141 (0398): pago em parte continua em parte.
  if v_p.sessions_total is not null then
    v_new := round(v_new::numeric * v_p.sessions_done / v_p.sessions_total)::bigint;
  end if;

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

-- -----------------------------------------------------------------------------
-- 5) Pendências: o "pagaria" da linha zerada respeita a fração
-- -----------------------------------------------------------------------------
create or replace function public.payout_watchlist(p_clinic_id uuid)
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
           p.sessions_done as z_done, p.sessions_total as z_total,
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
         case when z.z_total is null
              then (coalesce(z.z_rate, 0) * z.z_units)::bigint
              -- AP141 (0398): pago em parte, proporcional às sessões concluídas.
              else round(coalesce(z.z_rate, 0) * z.z_units * z.z_done::numeric / z.z_total)::bigint
         end
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

-- -----------------------------------------------------------------------------
-- 6) Os procedimentos que já estavam presos por uma sessão cancelada
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select s.id
      from public.treatment_sessions s
     where s.status = 'cancelled'
       and s.item_id is not null
       and s.redo_kind is distinct from 'revisao'
       and exists (
         select 1 from public.treatment_sessions d
          where d.item_id = s.item_id and d.status = 'done'
            and d.redo_kind is distinct from 'revisao')
     order by s.item_id, s.session_index
  loop
    perform public._payout_accrue_block(r.id);
  end loop;
end $$;

-- CONFERÊNCIA (só leitura). Esperado: colunas = 2, funcao_interna_fechada = true,
-- gatilho = 1, presos_restantes = 0; pagos_em_parte = quantos casos presos
-- foram lançados agora (0 se não havia nenhum).
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'provider_payouts'
      and column_name in ('sessions_done', 'sessions_total')) as colunas,
  not has_function_privilege('authenticated',
    'public._payout_accrue_block(uuid)'::regprocedure, 'execute') as funcao_interna_fechada,
  (select count(*) from pg_trigger
    where not tgisinternal and tgname = 'treatment_sessions_accrue_payout') as gatilho,
  (select count(*) from public.provider_payouts where sessions_total is not null) as pagos_em_parte,
  (select count(distinct s.item_id)
     from public.treatment_sessions s
    where s.status = 'cancelled' and s.item_id is not null
      and s.redo_kind is distinct from 'revisao'
      and exists (select 1 from public.treatment_sessions d
                   where d.item_id = s.item_id and d.status = 'done'
                     and d.redo_kind is distinct from 'revisao')
      and not exists (select 1 from public.treatment_sessions d
                       where d.item_id = s.item_id
                         and d.status not in ('done', 'cancelled')
                         and d.redo_kind is distinct from 'revisao')
      and not exists (select 1 from public.provider_payouts p
                       join public.treatment_sessions d on d.id = p.session_id
                      where d.item_id = s.item_id)) as presos_restantes;
