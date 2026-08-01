-- =============================================================================
-- 1002 — Empresarial: plano de dependentes AUTOMÁTICO + boleto com confirmação,
--        edição e cancelamento
-- -----------------------------------------------------------------------------
-- Pedidos do dono (30/07/2026, teste do módulo):
--   1. "o plano de dependentes deve preencher automaticamente conforme é
--      cadastrado os dependentes" — deixa de ser escolha manual (que dava erro
--      de cobrança) e passa a ser CALCULADO pela quantidade de dependentes
--      ativos, pela regra da Seção 5.1 do briefing:
--        0 dependentes  → NONE
--        1 dependente   → INDIVIDUAL     (R$ 39,90)
--        2 a 3          → FAMILY         (R$ 59,90, cobre até 3)
--        4 ou mais      → FAMILY_EXTRA   (familiar + extras além de 3)
--   2. A cobrança precisa poder ser CANCELADA (com motivo) e EDITADA depois de
--      gerada, e o boleto precisa saber a QUE se refere e QUEM é o pagador
--      (o CNPJ da empresa, quando ela tem mais de um documento).
-- Idempotente.
-- =============================================================================

-- 1) Plano de dependentes calculado ------------------------------------------
create or replace function empresarial.dependent_plan_for(p_count int)
returns text
language sql
immutable
as $$
  select case
    when p_count <= 0 then 'NONE'
    when p_count = 1 then 'INDIVIDUAL'
    when p_count <= 3 then 'FAMILY'
    else 'FAMILY_EXTRA'
  end;
$$;

create or replace function empresarial.refresh_dependent_plan(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_plan text;
begin
  if p_employee_id is null then return; end if;

  select count(*) into v_count
  from empresarial.dependents
  where employee_id = p_employee_id and status = 'ACTIVE';

  v_plan := empresarial.dependent_plan_for(v_count);

  update empresarial.employees
  set dependent_plan = v_plan
  where id = p_employee_id and dependent_plan is distinct from v_plan;
end $$;

create or replace function empresarial.dependents_plan_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.employee_id is not null then
    perform empresarial.refresh_dependent_plan(old.employee_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.employee_id is not null then
    perform empresarial.refresh_dependent_plan(new.employee_id);
  end if;
  return null;
end $$;

drop trigger if exists dependents_refresh_plan on empresarial.dependents;
create trigger dependents_refresh_plan
  after insert or update of status, employee_id or delete
  on empresarial.dependents
  for each row execute function empresarial.dependents_plan_trg();

grant execute on function empresarial.dependent_plan_for(int) to authenticated;
grant execute on function empresarial.refresh_dependent_plan(uuid) to authenticated;

-- Alinha todos os colaboradores existentes com a regra.
do $$
declare r record;
begin
  for r in select id from empresarial.employees loop
    perform empresarial.refresh_dependent_plan(r.id);
  end loop;
end $$;

-- 2) Cobrança: descrição, pagador (documento), cancelamento -------------------
alter table empresarial.adhesion_billing
  add column if not exists description text,
  add column if not exists company_document_id uuid
    references empresarial.company_documents (id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null;

comment on column empresarial.adhesion_billing.company_document_id is
  'CNPJ/documento pagador. NULL = a empresa toda (boleto único consolidado).';

-- Situação CANCELADA passa a existir.
do $$
begin
  alter table empresarial.adhesion_billing
    drop constraint if exists adhesion_billing_status_check;
  alter table empresarial.adhesion_billing
    add constraint adhesion_billing_status_check
      check (status in ('PENDING','PAID','OVERDUE','CANCELLED'));
exception when others then null; end $$;

-- Cancelar exige motivo (regra no banco, não só na tela).
create or replace function empresarial.cancel_billing(
  p_billing_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'CANCEL_REASON_REQUIRED'
      using hint = 'Informe o motivo do cancelamento.';
  end if;

  select status into v_status
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
end $$;

grant execute on function empresarial.cancel_billing(uuid, text) to authenticated;

-- A rotina de inadimplência ignora canceladas (recria a 0102 com o filtro).
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
    set status = 'SUSPENDED'
  from overdue o
  where c.id = o.company_id and c.status = 'ACTIVE';
  get diagnostics v_suspended = row_count;

  return v_suspended;
end $$;
