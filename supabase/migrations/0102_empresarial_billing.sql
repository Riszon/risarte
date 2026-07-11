-- =============================================================================
-- 0102 — Risarte Empresarial (Fase 4): financeiro (ASAAS) — liquidação + split +
-- inadimplência. A cobrança/webhook do ASAAS liga na Edge Function
-- supabase/functions/asaas-webhook; aqui ficam a regra do split e a suspensão.
-- Idempotente.
-- =============================================================================

-- Idempotência do webhook (o ASAAS pode reenviar o mesmo evento) ---------------
create table if not exists empresarial.asaas_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id varchar(120) unique not null,
  event_type varchar(60),
  payload jsonb,
  processed_at timestamptz not null default now()
);
alter table empresarial.asaas_webhook_events enable row level security;
-- Só o service_role (Edge Function) escreve/lê; sem policy = ninguém via API do usuário.
grant all on empresarial.asaas_webhook_events to service_role;

-- Liquidação: marca PAGO e grava o split conforme split_rules (empresa > rede) --
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

  -- Regra de split: da empresa, senão a da rede (company_id null).
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
end $$;

-- Inadimplência: marca vencidas e SUSPENDE empresas com atraso > N dias --------
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
  -- Cobranças PENDENTES vencidas → OVERDUE.
  update empresarial.adhesion_billing
    set status = 'OVERDUE'
  where status = 'PENDING'
    and due_date is not null
    and due_date < current_date;

  -- Empresas ATIVAS com cobrança OVERDUE há mais de N dias → SUSPENSA.
  with overdue as (
    select distinct b.company_id
    from empresarial.adhesion_billing b
    where b.status = 'OVERDUE'
      and b.due_date is not null
      and b.due_date < current_date - p_grace_days
  )
  update empresarial.companies c
    set status = 'SUSPENDED'
  from overdue o
  where c.id = o.company_id and c.status = 'ACTIVE';
  get diagnostics v_suspended = row_count;

  return v_suspended;
end $$;

grant execute on function empresarial.settle_billing(uuid, timestamptz) to authenticated, service_role;
grant execute on function empresarial.mark_overdue_and_suspend(int) to authenticated, service_role;

-- Agendamento diário da inadimplência (best-effort).
do $$
begin
  perform cron.schedule(
    'empresarial_overdue',
    '0 4 * * *',
    'select empresarial.mark_overdue_and_suspend();'
  );
exception when others then
  null;
end $$;
