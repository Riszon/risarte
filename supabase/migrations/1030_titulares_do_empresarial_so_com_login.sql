-- =============================================================================
-- 1030 — TITULARES E DEPENDENTES DO EMPRESARIAL: SÓ COM LOGIN E COM PERMISSÃO (AP50)
--
-- Varredura pedida pelo dono (16/10/2026), depois do OC-00105: as 37 funções
-- chamáveis do schema `empresarial` (mais 16 de gatilho). O AP16 tinha varrido
-- só o `public`.
--
-- 🔴 TRÊS GRAVAVAM SEM LOGIN E SEM CONFERIR QUEM CHAMA (confirmado na
-- PRODUÇÃO, de fora, com identificador inexistente — pararam no NOT_FOUND,
-- isto é, executaram):
--   - delete_employee:   marca o titular como EXCLUÍDO, encerra a
--                        participação dele e dos dependentes, tira o selo;
--   - complete_employee: completa o cadastro e pode CRIAR UM CLIENTE no
--                        cadastro geral (prontuário);
--   - link_dependent:    o mesmo, para o dependente.
-- Bastava o identificador. Pela tela, a regra sempre existiu
-- (`canManageEmployees` + `canUseClinic`); o banco não a conhecia.
--
-- O QUE MUDA:
--   1. `can_manage_employees()` — nova: a régua da tela no banco (gestor do
--      programa, SDR, recepção, gerente de unidade, franqueado).
--   2. As três funções conferem essa régua; as duas que criam cliente também
--      conferem a UNIDADE escolhida (a mesma regra da tela). Corpo vindo do
--      banco, com a guarda acrescentada no começo.
--   3. As três fecham para quem não está logado; de carona, `delete_billing`
--      e `check_funnel_alerts` também (elas já recusavam pela guarda, mas
--      rodavam até lá). A rotina agendada do funil usa `check_funnel_alerts_raw`.
--
-- Ficam como estão, declarado: as funções que as REGRAS das tabelas chamam
-- (`is_program_manager`, `accessible_company_ids`, `can_access_lead`,
-- `can_manage_company_files`) — sem login elas respondem "não"/vazio; e
-- `format_cpf`/`dependent_plan_for`, que só formatam/calculam.
--
-- Nenhuma tabela nova. Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) A régua de quem mexe nos titulares --------------------------------------
create or replace function empresarial.can_manage_employees()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or empresarial.is_program_manager()
      or exists (
        select 1 from public.user_clinic_roles ucr
        where ucr.user_id = (select auth.uid())
          and ucr.role in ('sdr', 'receptionist', 'unit_manager', 'franchisee')
      );
$$;

revoke execute on function empresarial.can_manage_employees() from public, anon, authenticated;
grant execute on function empresarial.can_manage_employees() to authenticated;

-- 2) As três funções, com a guarda -------------------------------------------
CREATE OR REPLACE FUNCTION empresarial.delete_employee(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp record;
  v_dep record;
begin
  -- AP50: só quem a tela deixa mexer nos titulares (gestor do programa, SDR,
  -- recepção, gerente de unidade, franqueado). Antes a função atendia QUALQUER
  -- chamada — inclusive sem login.
  if not empresarial.can_manage_employees() then
    raise exception 'NOT_ALLOWED';
  end if;

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
end $function$;

CREATE OR REPLACE FUNCTION empresarial.complete_employee(p_employee_id uuid, p_clinic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp record;
  v_client_id uuid;
  v_client_clinic uuid;
begin
  -- AP50: só quem a tela deixa mexer nos titulares (gestor do programa, SDR,
  -- recepção, gerente de unidade, franqueado). Antes a função atendia QUALQUER
  -- chamada — inclusive sem login.
  if not empresarial.can_manage_employees() then
    raise exception 'NOT_ALLOWED';
  end if;
  -- AP50: a unidade escolhida tem de estar no alcance de quem chama — a mesma
  -- regra da tela (`canUseClinic`): Admin, gestor do programa e SDR escolhem
  -- qualquer unidade; os demais, só as do seu escopo.
  if p_clinic_id is not null
     and not (public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
              or p_clinic_id in (select public.user_full_access_clinic_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_emp from empresarial.employees where id = p_employee_id;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  if v_emp.client_id is not null then
    v_client_id := v_emp.client_id;
    select clinic_id into v_client_clinic from public.clients where id = v_client_id;
  else
    -- Cliente já existente pelo CPF (rede toda) → MANTÉM o código dele.
    select id, clinic_id into v_client_id, v_client_clinic
    from public.clients
    where public.cpf_digits(cpf) = public.cpf_digits(v_emp.cpf)
    order by created_at asc
    limit 1;

    if v_client_id is null then
      if p_clinic_id is null then
        raise exception 'CLINIC_REQUIRED';
      end if;
      -- I5: cliente NOVO nascido no programa → código PRE- e origem gravada.
      insert into public.clients
        (clinic_id, full_name, cpf, phone, created_by, code,
         origin_program, origin_clinic_id, origin_at)
      values (p_clinic_id, v_emp.full_name, empresarial.format_cpf(v_emp.cpf),
              v_emp.phone, (select auth.uid()),
              public.next_client_code_prefixed(p_clinic_id, 'PRE'),
              'empresarial', p_clinic_id, now())
      returning id, clinic_id into v_client_id, v_client_clinic;
    end if;
  end if;

  update empresarial.employees
    set client_id = v_client_id,
        clinic_id = v_client_clinic,
        registration_stage = 'COMPLETED'
  where id = p_employee_id;

  if not exists (
    select 1 from empresarial.membership_history
    where client_id = v_client_id and company_id = v_emp.company_id
      and member_role = 'HOLDER' and ended_at is null
  ) then
    insert into empresarial.membership_history
      (client_id, clinic_id, company_id, member_role, started_at)
    values (v_client_id, v_client_clinic, v_emp.company_id, 'HOLDER', now());
  end if;

  perform empresarial.refresh_client_badge(v_client_id);
  return v_client_id;
end $function$;

CREATE OR REPLACE FUNCTION empresarial.link_dependent(p_dependent_id uuid, p_clinic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dep record;
  v_company uuid;
  v_client_id uuid;
  v_client_clinic uuid;
begin
  -- AP50: só quem a tela deixa mexer nos titulares (gestor do programa, SDR,
  -- recepção, gerente de unidade, franqueado). Antes a função atendia QUALQUER
  -- chamada — inclusive sem login.
  if not empresarial.can_manage_employees() then
    raise exception 'NOT_ALLOWED';
  end if;
  -- AP50: a unidade escolhida tem de estar no alcance de quem chama — a mesma
  -- regra da tela (`canUseClinic`): Admin, gestor do programa e SDR escolhem
  -- qualquer unidade; os demais, só as do seu escopo.
  if p_clinic_id is not null
     and not (public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
              or p_clinic_id in (select public.user_full_access_clinic_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;

  select d.*, e.company_id as company_id into v_dep
  from empresarial.dependents d
  join empresarial.employees e on e.id = d.employee_id
  where d.id = p_dependent_id;
  if not found then
    raise exception 'DEPENDENT_NOT_FOUND';
  end if;
  v_company := v_dep.company_id;

  if v_dep.client_id is not null then
    v_client_id := v_dep.client_id;
    select clinic_id into v_client_clinic from public.clients where id = v_client_id;
  else
    select id, clinic_id into v_client_id, v_client_clinic
    from public.clients
    where public.cpf_digits(cpf) = public.cpf_digits(v_dep.cpf)
    order by created_at asc
    limit 1;

    if v_client_id is null then
      if p_clinic_id is null then
        raise exception 'CLINIC_REQUIRED';
      end if;
      insert into public.clients
        (clinic_id, full_name, cpf, phone, created_by, code,
         origin_program, origin_clinic_id, origin_at)
      values (p_clinic_id,
              coalesce(v_dep.full_name, 'Dependente'),
              empresarial.format_cpf(v_dep.cpf),
              v_dep.phone, (select auth.uid()),
              public.next_client_code_prefixed(p_clinic_id, 'PRE'),
              'empresarial', p_clinic_id, now())
      returning id, clinic_id into v_client_id, v_client_clinic;
    end if;
  end if;

  update empresarial.dependents
     set client_id = v_client_id,
         clinic_id = v_client_clinic
   where id = p_dependent_id;

  if not exists (
    select 1 from empresarial.membership_history
    where client_id = v_client_id and company_id = v_company
      and member_role = 'DEPENDENT' and ended_at is null
  ) then
    insert into empresarial.membership_history
      (client_id, clinic_id, company_id, member_role, started_at)
    values (v_client_id, v_client_clinic, v_company, 'DEPENDENT', now());
  end if;

  perform empresarial.refresh_client_badge(v_client_id);
  return v_client_id;
end $function$;

-- 3) Fechadas para quem não está logado --------------------------------------
revoke execute on function empresarial.delete_employee(uuid) from public, anon, authenticated;
grant execute on function empresarial.delete_employee(uuid) to authenticated;
revoke execute on function empresarial.complete_employee(uuid, uuid) from public, anon, authenticated;
grant execute on function empresarial.complete_employee(uuid, uuid) to authenticated;
revoke execute on function empresarial.link_dependent(uuid, uuid) from public, anon, authenticated;
grant execute on function empresarial.link_dependent(uuid, uuid) to authenticated;
revoke execute on function empresarial.delete_billing(uuid) from public, anon, authenticated;
grant execute on function empresarial.delete_billing(uuid) to authenticated;
revoke execute on function empresarial.check_funnel_alerts() from public, anon, authenticated;
grant execute on function empresarial.check_funnel_alerts() to authenticated;
