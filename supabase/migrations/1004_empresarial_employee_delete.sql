-- =============================================================================
-- 1004 — Empresarial: excluir colaborador (exclusão LÓGICA) + restaurar
-- -----------------------------------------------------------------------------
-- Pedido do dono (30/07/2026): "em colaboradores deve ter a opção de excluir o
-- colaborador" e, no relatório, poder filtrar "todos / ativos / inativos /
-- excluídos".
--
-- POR QUE LÓGICA, e não apagar de verdade: o colaborador aponta para um CLIENTE
-- do riSZon e carrega histórico que não pode sumir — uso de benefício
-- (benefit_usage), período no programa (membership_history) e cobranças já
-- emitidas. Apagar a linha deixaria esses registros órfãos e quebraria o extrato
-- e a auditoria (mesma regra do riSZon: cliente nunca é apagado). Além disso, o
-- próprio pedido de "filtrar os excluídos" só faz sentido se eles continuarem
-- existindo. Então: status 'DELETED' + carimbo de quem e quando.
--
-- Efeito de excluir: sai das contagens, da mensalidade e do selo (o cliente
-- deixa de ser membro ativo), os dependentes são inativados junto e o período no
-- programa é encerrado — igual à saída, só que também some das listas do dia a
-- dia. Dá para RESTAURAR (volta como inativo, para o gestor decidir reativar).
-- Idempotente.
-- =============================================================================

-- 1) Novo estado + carimbo -----------------------------------------------------
alter table empresarial.employees
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

do $$
begin
  alter table empresarial.employees
    drop constraint if exists employees_status_check;
  alter table empresarial.employees
    add constraint employees_status_check
      check (status in ('ACTIVE', 'INACTIVE', 'DELETED'));
exception when others then null; end $$;

comment on column empresarial.employees.deleted_at is
  'Exclusão LÓGICA: o registro fica para preservar histórico (benefit_usage, '
  'membership_history, cobranças). status = DELETED some das listas.';

-- 2) Excluir ------------------------------------------------------------------
create or replace function empresarial.delete_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp record;
  v_dep record;
begin
  select * into v_emp from empresarial.employees where id = p_employee_id;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;

  update empresarial.employees
    set status = 'DELETED',
        deleted_at = now(),
        deleted_by = (select auth.uid()),
        left_at = coalesce(left_at, now())
  where id = p_employee_id;

  -- Encerra o período no programa do titular.
  update empresarial.membership_history
    set ended_at = now()
  where client_id = v_emp.client_id
    and company_id = v_emp.company_id
    and member_role = 'HOLDER'
    and ended_at is null;

  -- Titular excluído → dependentes saem junto (mesma regra da saída).
  for v_dep in
    select * from empresarial.dependents
    where employee_id = p_employee_id and status = 'ACTIVE'
  loop
    update empresarial.dependents set status = 'INACTIVE' where id = v_dep.id;
    update empresarial.membership_history
      set ended_at = now()
    where client_id = v_dep.client_id
      and company_id = v_emp.company_id
      and member_role = 'DEPENDENT'
      and ended_at is null;
    if v_dep.client_id is not null then
      perform empresarial.refresh_client_badge(v_dep.client_id);
    end if;
  end loop;

  -- Tira o selo do cliente do titular (deixou de ser membro ativo).
  if v_emp.client_id is not null then
    perform empresarial.refresh_client_badge(v_emp.client_id);
  end if;
end $$;

-- 3) Restaurar (volta como INATIVO — reativar é decisão à parte) ---------------
create or replace function empresarial.restore_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_emp record;
begin
  select * into v_emp from empresarial.employees where id = p_employee_id;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
  if v_emp.status <> 'DELETED' then return; end if;

  update empresarial.employees
    set status = 'INACTIVE', deleted_at = null, deleted_by = null
  where id = p_employee_id;

  if v_emp.client_id is not null then
    perform empresarial.refresh_client_badge(v_emp.client_id);
  end if;
end $$;

grant execute on function empresarial.delete_employee(uuid) to authenticated;
grant execute on function empresarial.restore_employee(uuid) to authenticated;
