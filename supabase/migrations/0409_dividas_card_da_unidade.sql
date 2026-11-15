-- =============================================================================
-- 0409 — LEVANTAMENTO DE DÍVIDAS, FASE 7: O CARD "DÍVIDAS DA UNIDADE" (DESLIGADO)
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/Financeiro/DIVIDAS-PLANO.md
-- (1.3 "Visões", 2.7, fase 7).
--
--   * Permissão nova `acao.dividas.ver_unidade`: NASCE SEM NENHUM PAPEL (o
--     card fica pronto e desligado). O teto é o Gerente e o Franqueado, e só
--     da PRÓPRIA unidade — marcar outro papel na matriz não abre nada.
--   * A porta `debt_unit_summary(clinic)` devolve SÓ NÚMEROS da unidade
--     (quanto deve, em atraso, inadimplente, restrições, acordos). Nada de
--     credor, contato, anexo ou dívida uma a uma: as tabelas `debt_*` continuam
--     fechadas para quem não é do Financeiro da Franqueadora.
--   * O saldo é o da regra única `_debt_positions` (0408).
--
-- Idempotente. Não apaga dado. Recria `_debt_cap_default_roles` e
-- `_debt_cap_ceiling` (partindo da 0408).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A PERMISSÃO (padrão: ninguém; teto: Gerente e Franqueado da unidade)
-- -----------------------------------------------------------------------------
-- Padrões de fábrica (iguais a `src/lib/permissions.ts`; há teste comparando).
create or replace function public._debt_cap_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'modulo.dividas' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.lancar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.excluir' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.configurar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.importar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.renegociar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.ver_unidade' then '{}'::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_default_roles(text) from public, anon, authenticated;

create or replace function public._debt_cap_ceiling(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_capability in ('modulo.dividas', 'acao.dividas.lancar',
                          'acao.dividas.excluir', 'acao.dividas.configurar',
                          'acao.dividas.importar', 'acao.dividas.renegociar')
      then array['finance_franchisor']::public.user_role[]
    -- O card da unidade: só quem responde pela unidade, e só a dela.
    when p_capability = 'acao.dividas.ver_unidade'
      then array['unit_manager', 'franchisee']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_ceiling(text) from public, anon, authenticated;

-- Nasce sem papel: a matriz não ganha linha; o padrão registrado é vazio.
insert into public.permission_defaults (capability, roles)
values ('acao.dividas.ver_unidade', '{}'::public.user_role[])
on conflict (capability) do nothing;

-- Quem pode ver o card desta unidade: o Admin Master, quem já tem o módulo,
-- ou o papel da pessoa NESTA unidade marcado na matriz e dentro do teto.
create or replace function public._debt_can_see_unit(p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed public.user_role[];
begin
  if v_uid is null or p_clinic_id is null then return false; end if;
  if public.debt_can('modulo.dividas', p_clinic_id) then return true; end if;

  if exists (select 1 from public.permission_matrix) then
    select coalesce(array_agg(pm.role), '{}') into v_allowed
      from public.permission_matrix pm
     where pm.capability = 'acao.dividas.ver_unidade' and pm.allowed;
  else
    v_allowed := public._debt_cap_default_roles('acao.dividas.ver_unidade');
  end if;

  return exists (
    select 1 from public.user_clinic_roles ucr
     where ucr.user_id = v_uid
       and ucr.clinic_id = p_clinic_id
       and ucr.role = any (v_allowed)
       and ucr.role = any (public._debt_cap_ceiling('acao.dividas.ver_unidade')));
end;
$$;
revoke execute on function public._debt_can_see_unit(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A PORTA DO CARD: só números da unidade
-- -----------------------------------------------------------------------------
create or replace function public.debt_unit_summary(p_clinic_id uuid)
returns table (
  debts integer,
  balance_cents bigint,
  overdue_count integer,
  overdue_cents bigint,
  defaulted_count integer,
  defaulted_cents bigint,
  restricted_count integer,
  agreements integer,
  agreement_balance_cents bigint,
  agreement_next30_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_em30 date := public.today_br() + 30;
begin
  if not public._debt_can_see_unit(p_clinic_id) then return; end if;

  select coalesce(array_agg(d.id), '{}') into v_ids
    from public.debts d
   where d.clinic_id = p_clinic_id and d.deleted_at is null and d.status <> 'baixada';

  return query
  with pos as (
    select p.debt_id, p.balance_cents from public._debt_positions(v_ids) p
  ),
  d as (
    select x.id, x.status, coalesce(pos.balance_cents, 0) as saldo,
           (exists (select 1 from public.debt_negativations n
                     where n.debt_id = x.id and n.removed_at is null and n.removal_confirmed_on is null)
            or exists (select 1 from public.debt_protests pr
                        where (pr.debt_id = x.id or (x.group_id is not null and pr.group_id = x.group_id))
                          and pr.removed_at is null and pr.cancel_status <> 'cancelado')
            or exists (select 1 from public.debt_lawsuits l
                        where l.debt_id = x.id and l.removed_at is null and l.closed_on is null)) as restrita
      from public.debts x
      left join pos on pos.debt_id = x.id
     where x.id = any (v_ids)
  ),
  ag as (
    select a.id from public.debt_agreements a
     where a.clinic_id = p_clinic_id and a.status in ('em_andamento', 'quebrado')
  ),
  parc as (
    select p.amount_cents - coalesce(p.paid_amount_cents, 0) as falta, p.due_date
      from public.payables p
     where p.debt_agreement_id in (select id from ag) and p.debt_link = 'acordo'
       and p.status in ('aberta', 'parcial')
  )
  select
    (select count(*) from d where d.status not in ('quitada_pendencias', 'quitada_encerrada'))::integer,
    (select coalesce(sum(d.saldo), 0) from d)::bigint,
    (select count(*) from d where d.status = 'em_atraso')::integer,
    (select coalesce(sum(d.saldo), 0) from d where d.status = 'em_atraso')::bigint,
    (select count(*) from d where d.status = 'inadimplente')::integer,
    (select coalesce(sum(d.saldo), 0) from d where d.status = 'inadimplente')::bigint,
    (select count(*) from d where d.restrita and d.status not in ('quitada_pendencias', 'quitada_encerrada'))::integer,
    (select count(*) from ag)::integer,
    (select coalesce(sum(parc.falta), 0) from parc)::bigint,
    (select coalesce(sum(parc.falta), 0) from parc where parc.due_date <= v_em30)::bigint;
end;
$$;
revoke execute on function public.debt_unit_summary(uuid) from public, anon, authenticated;
grant execute on function public.debt_unit_summary(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois): o esperado é true · 0 · 1
-- -----------------------------------------------------------------------------
-- select
--   (select 'acao.dividas.ver_unidade' = any (select capability from public.permission_defaults)) as permissao,
--   (select count(*) from public.permission_matrix where capability = 'acao.dividas.ver_unidade') as papeis_marcados,
--   (select count(*) from pg_proc where proname = 'debt_unit_summary') as porta;
