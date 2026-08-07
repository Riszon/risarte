-- =============================================================================
-- 0205 — CANCELAR VENDA FECHADA PELO COMERCIAL + PLANO SEM ACRÉSCIMO
-- -----------------------------------------------------------------------------
-- Duas assimetrias do comparativo (docs/COMPARATIVO-VENDAS.md), decididas pelo
-- dono em 06/08/2026.
--
-- 1) CANCELAR. A venda direta tinha `cancel_direct_sale`; o Comercial não tinha
--    nada. Um plano fechado por engano (ou uma desistência) só podia ser
--    desfeito cobrança por cobrança, e as sessões ficavam no prontuário.
--
--    Decisão: cancelar DESFAZ TUDO e devolve o cliente à **Fase 4 (Conversão
--    Comercial)** — de onde ele pode ser renegociado ou marcado como perdido,
--    sem recomeçar do zero.
--
--    **Se já houve recebimento, NÃO cancela** (`HAS_RECEIPTS`): dinheiro que
--    entrou não desaparece por cancelamento. O caminho é estornar a baixa ou
--    renegociar a dívida — os dois já existem e deixam rastro.
--
-- 2) SEM ACRÉSCIMO no plano de tratamento. O preço vem do orçamento aprovado
--    pelo Coordenador; somar valor por cima enfraquece a aprovação clínica e é
--    difícil de justificar ao paciente. A venda direta mantém acréscimo (item
--    avulso é outra conversa) e ele segue restrito ao Gerente.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Marcas do cancelamento
-- -----------------------------------------------------------------------------
alter table public.commercial_sales
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id),
  add column if not exists cancel_reason text;

comment on column public.commercial_sales.cancelled_at is
  'Venda fechada e depois cancelada. O registro CONTINUA aqui — cancelar não '
  'apaga histórico, só encerra os efeitos.';

-- A negociação precisa de uma situação para "cancelada" (a 0147 não previa).
alter table public.plan_negotiations
  drop constraint if exists plan_negotiations_status_check;
alter table public.plan_negotiations
  add constraint plan_negotiations_status_check
  check (status in ('em_negociacao', 'aguardando_autorizacao', 'aceita',
                    'devolvida', 'perdida', 'cancelada'));

-- -----------------------------------------------------------------------------
-- 2) Cancelar: desfaz os efeitos e devolve o cliente à Fase 4
-- -----------------------------------------------------------------------------
create or replace function public.cancel_negotiation(
  p_negotiation_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_sale record;
  v_user uuid := (select auth.uid());
  v_client_name text;
  v_recebido bigint;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;

  -- Cancelar venda é ato de gestão, não de balcão.
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_neg.clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_sale from public.commercial_sales
  where negotiation_id = p_negotiation_id;
  if v_sale.id is not null and v_sale.cancelled_at is not null then
    raise exception 'ALREADY_CANCELLED';
  end if;

  -- DINHEIRO QUE ENTROU NÃO SOME. Com recebimento, o caminho é estorno ou
  -- renegociação — nunca cancelamento silencioso.
  select coalesce(sum(r.amount_cents), 0) into v_recebido
  from public.payment_receipts r
  join public.payment_installments i on i.id = r.installment_id
  where i.negotiation_id = p_negotiation_id
    and not r.reversed and r.reversal_of is null;
  if v_recebido > 0 then raise exception 'HAS_RECEIPTS'; end if;

  if v_sale.id is not null then
    update public.commercial_sales set
      cancelled_at = now(), cancelled_by = v_user,
      cancel_reason = btrim(p_reason), updated_at = now()
    where id = v_sale.id;
  end if;

  update public.plan_negotiations set
    status = 'cancelada', updated_at = now()
  where id = p_negotiation_id;

  -- Sessões ainda não realizadas saem do prontuário como CANCELADAS (o
  -- histórico continua visível; o que já foi feito NÃO é desfeito).
  update public.treatment_sessions set
    status = 'cancelled', appointment_id = null
  where plan_id = v_neg.plan_id
    and status not in ('cancelled', 'done');

  -- Cobranças em aberto deixam de existir.
  update public.payment_installments set status = 'cancelada'
   where negotiation_id = p_negotiation_id and status = 'em_aberto';

  -- LIMITE CONHECIDO: o benefício do programa NÃO é devolvido aqui. Ao
  -- contrário da venda direta, o consumo (`ppr_benefit_usages`) não guarda
  -- vínculo com a negociação — ele nasce no atendimento, não no fechamento.
  -- Inventar um vínculo agora, sem dado para sustentá-lo, devolveria benefício
  -- errado. Fica como pendência para quando o consumo passar a apontar para a
  -- venda de origem.

  -- O cliente VOLTA à Conversão Comercial: de lá dá para renegociar ou marcar
  -- como perdido, sem refazer avaliação e planejamento.
  update public.journey_phase_history set exited_at = now()
  where client_id = v_neg.client_id and exited_at is null;
  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (v_neg.client_id, v_neg.clinic_id, 'commercial_conversion', v_user);
  update public.clients set
    journey_phase = 'commercial_conversion', phase_entered_at = now()
  where id = v_neg.client_id;

  select full_name into v_client_name from public.clients where id = v_neg.client_id;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_neg.clinic_id,
    'Venda cancelada — cliente voltou à negociação',
    coalesce(v_client_name, 'Cliente')
      || ' teve a venda cancelada: ' || btrim(p_reason)
      || '. As sessões não realizadas e as cobranças em aberto foram canceladas.',
    '/comercial/' || v_neg.client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_neg.clinic_id
    and ucr.role in ('receptionist', 'unit_manager', 'clinical_coordinator')
    and ucr.user_id is distinct from v_user;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'negotiation_cancel',
          p_negotiation_id::text,
          jsonb_build_object('back_to_phase', 'commercial_conversion'));
end;
$$;

grant execute on function public.cancel_negotiation(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Plano de tratamento não tem acréscimo
-- -----------------------------------------------------------------------------
-- A trava mora no banco porque a regra é de negócio, não de tela (lição da
-- 0203). Ajuste positivo simplesmente não passa.
create or replace function public.enforce_no_surcharge_on_plan()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.adjustment_cents, 0) > 0 then
    raise exception 'SURCHARGE_NOT_ALLOWED';
  end if;
  return new;
end;
$$;

comment on function public.enforce_no_surcharge_on_plan() is
  'Plano de tratamento não tem acréscimo (dono, 06/08/2026): o preço vem do '
  'orçamento aprovado pelo Coordenador. Venda direta mantém acréscimo.';

drop trigger if exists plan_negotiations_no_surcharge on public.plan_negotiations;
create trigger plan_negotiations_no_surcharge
  before insert or update of adjustment_cents on public.plan_negotiations
  for each row execute function public.enforce_no_surcharge_on_plan();

-- Negociações antigas com acréscimo: zeradas e recalculadas.
do $$
declare
  r record;
begin
  for r in select id from public.plan_negotiations where adjustment_cents > 0
  loop
    update public.plan_negotiations set adjustment_cents = 0 where id = r.id;
    perform public.evaluate_negotiation_rules(r.id, false);
  end loop;
end $$;

select
  (select count(*) from public.plan_negotiations where status = 'cancelada')
    as negociacoes_canceladas,
  (select count(*) from public.plan_negotiations where adjustment_cents > 0)
    as com_acrescimo_restante,
  (select count(*) from public.commercial_sales where cancelled_at is not null)
    as vendas_canceladas;
