-- =============================================================================
-- Risarte Odontologia — Migration 0169 (PPR6 — mensalidades, inadimplência e
-- pontos do Riso+ Social) + conserto das vendas com desconto congelado
--
-- 1) CONSERTO: vendas diretas ABERTAS de cliente com PPR+ ficaram com o
--    desconto de uma escolha anterior de parcelas (bug corrigido na v0.136.1).
--    Aqui o desconto é recalculado pela faixa do parcelamento gravado.
--
-- 2) PPR6 — o ciclo do dinheiro do programa:
--    - ppr_generate_charges(mês): gera a mensalidade de cada adesão ATIVA;
--    - ppr_mark_charge_paid(cobrança): baixa o pagamento, ativa a adesão quando
--      é a primeira e credita os pontos do Riso+ Social;
--    - ppr_refresh_delinquency(): aplica os prazos de ppr_settings — suspende
--      quem passou do prazo e cancela quem passou do limite.
-- Idempotente.
-- =============================================================================

-- 1) Conserto do desconto congelado -------------------------------------------
with alvo as (
  select
    s.id,
    s.subtotal_cents,
    s.program_discount_cents,
    coalesce((
      select sum(i.final_cents) from public.direct_sale_items i
      where i.sale_id = s.id and coalesce(i.program_discount_cents, 0) > 0
    ), 0) as covered_cents,
    coalesce(public.ppr_client_tier_percent(s.client_id, s.installments), 0) as pct
  from public.direct_sales s
  where s.cancelled is not true
    and s.closed_at is null
    and coalesce(s.discount_cents, 0) > 0
    and exists (
      select 1 from public.ppr_beneficiaries b
      join public.ppr_memberships m on m.id = b.membership_id
      where b.client_id = s.client_id and b.left_at is null and m.status = 'ativo'
    )
)
update public.direct_sales s set
  discount_cents = round(
    greatest(0, a.subtotal_cents - a.program_discount_cents - a.covered_cents)
      * a.pct / 100.0
  ),
  final_cents = greatest(0,
    a.subtotal_cents - a.program_discount_cents
      - round(
          greatest(0, a.subtotal_cents - a.program_discount_cents - a.covered_cents)
            * a.pct / 100.0)
      + coalesce(s.surcharge_cents, 0)),
  updated_at = now()
from alvo a
where s.id = a.id
  and s.discount_cents is distinct from round(
        greatest(0, a.subtotal_cents - a.program_discount_cents - a.covered_cents)
          * a.pct / 100.0);

-- 2) Prazos de inadimplência efetivos da unidade (cascata rede → unidade) -----
create or replace function public.ppr_effective_settings(p_clinic_id uuid)
returns table (suspend_after_days integer, cancel_after_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(u.suspend_after_days, n.suspend_after_days, 30),
    coalesce(u.cancel_after_days, n.cancel_after_days, 90)
  from (select 1) one
  left join public.ppr_settings u on u.clinic_id = p_clinic_id
  left join public.ppr_settings n on n.clinic_id is null;
$$;

grant execute on function public.ppr_effective_settings(uuid) to authenticated;

-- 3) Gerar as mensalidades do mês ---------------------------------------------
-- Uma cobrança por adesão por competência (unique já existe na tabela). O
-- vencimento usa o dia de cobrança escolhido na adesão.
create or replace function public.ppr_generate_charges(
  p_month date default date_trunc('month', now())::date,
  p_clinic_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, now()))::date;
  v_count integer := 0;
begin
  if not (
    public.is_admin_master()
    or (p_clinic_id is not null and public.has_role_in_clinic(p_clinic_id,
          array['unit_manager','receptionist']::public.user_role[]))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.ppr_charges
    (membership_id, clinic_id, reference_month, due_date, amount_cents, status)
  select
    m.id, m.clinic_id, v_month,
    (v_month + ((coalesce(m.billing_day, 10) - 1) || ' days')::interval)::date,
    m.monthly_cents,
    'em_aberto'
  from public.ppr_memberships m
  where m.status in ('ativo','suspenso')
    and (p_clinic_id is null or m.clinic_id = p_clinic_id)
    and m.monthly_cents > 0
  on conflict (membership_id, reference_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.ppr_generate_charges(date, uuid) to authenticated;

-- 4) Baixa do pagamento (+ ativação + pontos do Riso+ Social) ------------------
create or replace function public.ppr_mark_charge_paid(
  p_charge_id uuid,
  p_paid boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge public.ppr_charges;
  v_membership public.ppr_memberships;
  v_plan public.ppr_plans;
  v_user uuid := (select auth.uid());
  v_points integer;
begin
  select * into v_charge from public.ppr_charges where id = p_charge_id;
  if v_charge.id is null then raise exception 'NOT_FOUND'; end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_charge.clinic_id,
         array['unit_manager','receptionist']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_membership from public.ppr_memberships where id = v_charge.membership_id;
  select * into v_plan from public.ppr_plans where id = v_membership.plan_id;

  update public.ppr_charges set
    status = case when p_paid then 'paga' else 'em_aberto' end,
    paid_at = case when p_paid then now() else null end,
    paid_by = case when p_paid then v_user else null end
  where id = p_charge_id;

  if not p_paid then
    delete from public.ppr_social_points
    where membership_id = v_charge.membership_id
      and reference_month = v_charge.reference_month;
    return;
  end if;

  -- Primeira mensalidade paga = metade da regra de ouro (a outra é o contrato).
  if not v_membership.first_payment_confirmed then
    update public.ppr_memberships set
      first_payment_confirmed = true,
      first_payment_at = now(),
      first_payment_by = v_user,
      status = case
        when contract_signed and status = 'aguardando_ativacao' then 'ativo'
        else status end,
      activated_at = case
        when contract_signed and activated_at is null then now()
        else activated_at end,
      updated_at = now()
    where id = v_membership.id;
  elsif v_membership.status = 'suspenso' then
    -- Regularizou: volta a valer se não há mais nada vencido.
    if not exists (
      select 1 from public.ppr_charges c
      where c.membership_id = v_membership.id
        and c.status in ('em_aberto','atrasada')
        and c.due_date < current_date
    ) then
      update public.ppr_memberships set
        status = 'ativo', suspended_at = null, updated_at = now()
      where id = v_membership.id;
      insert into public.ppr_events (membership_id, clinic_id, event_type, description, created_by)
      values (v_membership.id, v_membership.clinic_id, 'reativacao',
              'Plano reativado — mensalidades regularizadas', v_user);
    end if;
  end if;

  -- Riso+ Social: pontos proporcionais ao valor pago (Light não pontua).
  if coalesce(v_plan.social_enabled, false) then
    v_points := floor(v_charge.amount_cents::numeric
                      / greatest(1, v_plan.social_points_per_cents));
    if v_points > 0 then
      insert into public.ppr_social_points
        (membership_id, clinic_id, client_id, reference_month, points, source_cents)
      values (v_membership.id, v_membership.clinic_id, v_membership.holder_client_id,
              v_charge.reference_month, v_points, v_charge.amount_cents)
      on conflict (membership_id, reference_month) do update
        set points = excluded.points, source_cents = excluded.source_cents;
    end if;
  end if;
end;
$$;

grant execute on function public.ppr_mark_charge_paid(uuid, boolean) to authenticated;

-- 5) Inadimplência: suspende e cancela pelos prazos configurados --------------
create or replace function public.ppr_refresh_delinquency(
  p_clinic_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_days integer;
  v_susp integer;
  v_canc integer;
  v_changed integer := 0;
begin
  -- Marca como ATRASADA o que venceu e não foi pago.
  update public.ppr_charges set status = 'atrasada'
  where status = 'em_aberto' and due_date < current_date
    and (p_clinic_id is null or clinic_id = p_clinic_id);

  for v_row in
    select m.id, m.clinic_id, m.status,
           max(current_date - c.due_date) as days_late
    from public.ppr_memberships m
    join public.ppr_charges c on c.membership_id = m.id
    where m.status in ('ativo','suspenso')
      and c.status in ('em_aberto','atrasada')
      and c.due_date < current_date
      and (p_clinic_id is null or m.clinic_id = p_clinic_id)
    group by m.id, m.clinic_id, m.status
  loop
    select s.suspend_after_days, s.cancel_after_days into v_susp, v_canc
    from public.ppr_effective_settings(v_row.clinic_id) s;
    v_days := coalesce(v_row.days_late, 0);

    if v_canc > 0 and v_days >= v_canc then
      update public.ppr_memberships set
        status = 'cancelado', cancelled_at = now(),
        cancel_reason = 'Cancelado por falta de pagamento ('
          || v_days || ' dias de atraso)',
        updated_at = now()
      where id = v_row.id;
      insert into public.ppr_events (membership_id, clinic_id, event_type, description)
      values (v_row.id, v_row.clinic_id, 'cancelamento',
              'Cancelado automaticamente — ' || v_days || ' dias de atraso');
      v_changed := v_changed + 1;
    elsif v_susp > 0 and v_days >= v_susp and v_row.status = 'ativo' then
      update public.ppr_memberships set
        status = 'suspenso', suspended_at = now(), updated_at = now()
      where id = v_row.id;
      insert into public.ppr_events (membership_id, clinic_id, event_type, description)
      values (v_row.id, v_row.clinic_id, 'suspensao',
              'Suspenso automaticamente — ' || v_days || ' dias de atraso');
      -- Avisa a unidade para cobrar o cliente.
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_row.clinic_id,
        'PPR+ — plano suspenso por falta de pagamento',
        'Mensalidade com ' || v_days || ' dias de atraso. Os benefícios estão'
          || ' bloqueados até a regularização.',
        '/ppr/adesoes/' || v_row.id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_row.clinic_id
        and ucr.role in ('receptionist','unit_manager');
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;

grant execute on function public.ppr_refresh_delinquency(uuid) to authenticated;
