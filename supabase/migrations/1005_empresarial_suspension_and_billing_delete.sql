-- =============================================================================
-- 1005 — Empresarial: sair da suspensão quando a inadimplência acaba +
--        Admin Master pode EXCLUIR uma cobrança
-- -----------------------------------------------------------------------------
-- Bugs/pedidos do dono (30/07/2026, teste):
--
-- 1. "quando eu cancelo uma cobrança da empresa, ainda continua como suspenso".
--    A suspensão por atraso era só de IDA: `mark_overdue_and_suspend` colocava
--    SUSPENDED e nada devolvia para ACTIVE quando a dívida sumia (paga,
--    cancelada ou excluída).
--
--    CUIDADO que motiva a coluna nova: a empresa também pode ser suspensa À MÃO
--    pelo gestor (pendência cadastral, decisão comercial). Reativar sozinho
--    qualquer empresa suspensa desfaria essa decisão sem ninguém pedir. Por
--    isso `auto_suspended_at` marca que foi o SISTEMA que suspendeu por atraso —
--    e só essa suspensão é desfeita automaticamente.
--
-- 2. "como admin master deve ter como excluir uma cobrança emitida" — para
--    limpar cobranças de TESTE antes de a empresa receber um relatório.
--    Diferente de cancelar (que fica no histórico), aqui a linha é APAGADA.
--    Restrito ao Admin Master e sempre registrado em audit_logs ANTES de sumir,
--    para a exclusão em si deixar rastro.
-- Idempotente.
-- =============================================================================

alter table empresarial.companies
  add column if not exists auto_suspended_at timestamptz;

comment on column empresarial.companies.auto_suspended_at is
  'Preenchido quando FOI O SISTEMA que suspendeu por inadimplência. Só essa '
  'suspensão é desfeita sozinha; a suspensão manual do gestor permanece.';

-- 1) Suspender por atraso passa a marcar a origem -----------------------------
create or replace function empresarial.mark_overdue_and_suspend(
  p_grace_days int default 5
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_suspended int := 0;
begin
  update empresarial.adhesion_billing
    set status = 'OVERDUE'
  where status = 'PENDING'
    and due_date is not null
    and due_date < current_date;

  with overdue as (
    select distinct b.company_id
    from empresarial.adhesion_billing b
    where b.status = 'OVERDUE'
      and b.due_date is not null
      and b.due_date < current_date - p_grace_days
  )
  update empresarial.companies c
    set status = 'SUSPENDED',
        auto_suspended_at = now()
  from overdue o
  where c.id = o.company_id and c.status = 'ACTIVE';
  get diagnostics v_suspended = row_count;

  return v_suspended;
end $$;

-- 2) Devolve para ATIVA quando não há mais atraso -----------------------------
create or replace function empresarial.refresh_company_suspension(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só desfaz a suspensão que o SISTEMA aplicou por inadimplência.
  update empresarial.companies c
    set status = 'ACTIVE',
        auto_suspended_at = null
  where c.id = p_company_id
    and c.status = 'SUSPENDED'
    and c.auto_suspended_at is not null
    and not exists (
      select 1 from empresarial.adhesion_billing b
      where b.company_id = p_company_id
        and b.status = 'OVERDUE'
    );
end $$;

grant execute on function empresarial.refresh_company_suspension(uuid) to authenticated, service_role;

-- 3) Cancelar cobrança → reavalia a suspensão ---------------------------------
create or replace function empresarial.cancel_billing(
  p_billing_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_company uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'CANCEL_REASON_REQUIRED'
      using hint = 'Informe o motivo do cancelamento.';
  end if;

  select status, company_id into v_status, v_company
  from empresarial.adhesion_billing where id = p_billing_id;
  if v_status is null then
    raise exception 'BILLING_NOT_FOUND';
  end if;
  if v_status = 'PAID' then
    raise exception 'BILLING_ALREADY_PAID'
      using hint = 'Cobrança já paga não pode ser cancelada.';
  end if;

  update empresarial.adhesion_billing
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancel_reason = btrim(p_reason),
      cancelled_by = (select auth.uid())
  where id = p_billing_id;

  perform empresarial.refresh_company_suspension(v_company);
end $$;

-- 4) Liquidar cobrança → reavalia a suspensão ---------------------------------
create or replace function empresarial.settle_billing(
  p_billing_id uuid,
  p_paid_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_rules record;
  v_risarte_pct numeric(5,2);
  v_risarte bigint;
begin
  select * into v_bill from empresarial.adhesion_billing where id = p_billing_id;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;
  if v_bill.status = 'PAID' then return; end if;

  select * into v_rules
  from empresarial.split_rules
  where company_id = v_bill.company_id or company_id is null
  order by (company_id = v_bill.company_id) desc
  limit 1;

  v_risarte_pct := case
    when v_bill.billing_type = 'IMPLANTATION'
      then coalesce(v_rules.first_payment_risarte_pct, 0)
    else coalesce(v_rules.recurring_risarte_pct, 50)
  end;
  v_risarte := round(v_bill.total_amount_cents * v_risarte_pct / 100.0);

  update empresarial.adhesion_billing
    set status = 'PAID',
        paid_at = p_paid_at,
        split_risarte_cents = v_risarte,
        split_rislife_cents = v_bill.total_amount_cents - v_risarte
  where id = p_billing_id;

  -- Pagou: se não há mais atraso, a empresa volta a ficar ativa.
  perform empresarial.refresh_company_suspension(v_bill.company_id);
end $$;

-- 5) Excluir cobrança (Admin Master) ------------------------------------------
-- Diferente de cancelar: aqui a linha é APAGADA. Serve para limpar cobranças de
-- teste antes de a empresa receber um relatório. Registra em audit_logs ANTES
-- de apagar, para a exclusão deixar rastro mesmo sem a linha.
create or replace function empresarial.delete_billing(p_billing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_bill record;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED'
      using hint = 'Só o Admin Master pode excluir uma cobrança.';
  end if;

  select * into v_bill from empresarial.adhesion_billing where id = p_billing_id;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    (select auth.uid()), null, 'delete', 'empresarial_billing', p_billing_id::text,
    jsonb_build_object(
      'company_id', v_bill.company_id,
      'billing_type', v_bill.billing_type,
      'total_amount_cents', v_bill.total_amount_cents,
      'status', v_bill.status,
      'due_date', v_bill.due_date,
      'reference_month', v_bill.reference_month
    )
  );

  delete from empresarial.adhesion_billing where id = p_billing_id;

  perform empresarial.refresh_company_suspension(v_bill.company_id);
end $$;

grant execute on function empresarial.delete_billing(uuid) to authenticated;

-- 6) Corrige o que já está no banco: empresas suspensas sem atraso nenhum -----
-- (as suspensões desta fase de teste vieram todas da inadimplência automática)
do $$
declare r record;
begin
  for r in
    select c.id
    from empresarial.companies c
    where c.status = 'SUSPENDED'
      and not exists (
        select 1 from empresarial.adhesion_billing b
        where b.company_id = c.id and b.status = 'OVERDUE'
      )
  loop
    update empresarial.companies
      set status = 'ACTIVE', auto_suspended_at = null
    where id = r.id;
  end loop;
end $$;
