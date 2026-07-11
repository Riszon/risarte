-- =============================================================================
-- 0098 — Risarte Empresarial (Fase 1): ponte colaborador↔cliente + selo
-- -----------------------------------------------------------------------------
-- Liga o colaborador/dependente do programa a um CLIENTE do riSZon (public.
-- clients), criando o cliente se o CPF ainda não existir, e copia a clinic_id do
-- cliente para o registro do programa (necessário para a RLS por unidade).
-- Põe o SELO "Risarte Empresarial" na ficha (colunas em public.clients mantidas
-- em sincronia por gatilho — mesmo molde do selo Risartano da 0078).
-- Idempotente.
-- =============================================================================

-- 1) Selo na ficha (public.clients) --------------------------------------------
alter table public.clients
  add column if not exists empresarial_company_id uuid
    references empresarial.companies (id) on delete set null;
alter table public.clients
  add column if not exists empresarial_active boolean;

create index if not exists clients_empresarial_company_idx
  on public.clients (empresarial_company_id);

-- 2) Recalcula o selo de um cliente a partir dos vínculos ativos ---------------
create or replace function empresarial.refresh_client_badge(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_active boolean;
begin
  if p_client_id is null then return; end if;

  -- Empresa do vínculo mais relevante (colaborador ativo tem prioridade;
  -- senão, empresa do titular de um dependente ativo).
  select coalesce(
    (select e.company_id from empresarial.employees e
      where e.client_id = p_client_id
      order by (e.status = 'ACTIVE') desc, e.joined_at desc limit 1),
    (select emp.company_id from empresarial.dependents d
       join empresarial.employees emp on emp.id = d.employee_id
      where d.client_id = p_client_id
      order by (d.status = 'ACTIVE') desc limit 1)
  ) into v_company;

  v_active :=
    exists (select 1 from empresarial.employees e
              where e.client_id = p_client_id and e.status = 'ACTIVE')
    or exists (select 1 from empresarial.dependents d
                 where d.client_id = p_client_id and d.status = 'ACTIVE');

  update public.clients c
    set empresarial_company_id = v_company,
        empresarial_active = case when v_company is null then null else v_active end
  where c.id = p_client_id
    and (c.empresarial_company_id is distinct from v_company
         or c.empresarial_active is distinct from
            (case when v_company is null then null else v_active end));
end $$;

-- 3) Gatilhos: qualquer mudança de vínculo/status recalcula o selo ------------
create or replace function empresarial.employees_badge_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.client_id is not null then
    perform empresarial.refresh_client_badge(old.client_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.client_id is not null then
    perform empresarial.refresh_client_badge(new.client_id);
  end if;
  return null;
end $$;

drop trigger if exists employees_badge on empresarial.employees;
create trigger employees_badge
  after insert or update of client_id, status or delete on empresarial.employees
  for each row execute function empresarial.employees_badge_trg();

create or replace function empresarial.dependents_badge_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.client_id is not null then
    perform empresarial.refresh_client_badge(old.client_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.client_id is not null then
    perform empresarial.refresh_client_badge(new.client_id);
  end if;
  return null;
end $$;

drop trigger if exists dependents_badge on empresarial.dependents;
create trigger dependents_badge
  after insert or update of client_id, status or delete on empresarial.dependents
  for each row execute function empresarial.dependents_badge_trg();

-- 4) CPF formatado (000.000.000-00) a partir dos dígitos ----------------------
create or replace function empresarial.format_cpf(p text)
returns text language sql immutable as $$
  select case
    when length(public.cpf_digits(p)) = 11 then
      regexp_replace(public.cpf_digits(p), '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4')
    else p
  end;
$$;

-- 5) Ponte: completa o colaborador — cria/vincula o cliente do riSZon ----------
-- Retorna o client_id. Copia clients.clinic_id → employees.clinic_id. Se o CPF
-- já existe como cliente (em qualquer unidade), vincula sem duplicar; senão cria
-- o cliente em p_clinic_id (o gatilho de código do riSZon gera o código).
create or replace function empresarial.complete_employee(
  p_employee_id uuid,
  p_clinic_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp record;
  v_client_id uuid;
  v_client_clinic uuid;
begin
  select * into v_emp from empresarial.employees where id = p_employee_id;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  if v_emp.client_id is not null then
    v_client_id := v_emp.client_id;
    select clinic_id into v_client_clinic from public.clients where id = v_client_id;
  else
    -- Cliente já existente pelo CPF (rede toda)?
    select id, clinic_id into v_client_id, v_client_clinic
    from public.clients
    where public.cpf_digits(cpf) = public.cpf_digits(v_emp.cpf)
    order by created_at asc
    limit 1;

    if v_client_id is null then
      if p_clinic_id is null then
        raise exception 'CLINIC_REQUIRED';
      end if;
      insert into public.clients (clinic_id, full_name, cpf, phone, created_by)
      values (p_clinic_id, v_emp.full_name, empresarial.format_cpf(v_emp.cpf),
              v_emp.phone, (select auth.uid()))
      returning id, clinic_id into v_client_id, v_client_clinic;
    end if;
  end if;

  update empresarial.employees
    set client_id = v_client_id,
        clinic_id = v_client_clinic,
        registration_stage = 'COMPLETED'
  where id = p_employee_id;

  -- Histórico de vínculo (abre um período se não houver aberto).
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
end $$;

-- 6) Ponte para dependente -----------------------------------------------------
create or replace function empresarial.link_dependent(
  p_dependent_id uuid,
  p_clinic_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep record;
  v_company uuid;
  v_client_id uuid;
  v_client_clinic uuid;
begin
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
      insert into public.clients (clinic_id, full_name, cpf, phone, created_by)
      values (p_clinic_id, coalesce(v_dep.full_name, 'Dependente'),
              empresarial.format_cpf(v_dep.cpf), v_dep.phone, (select auth.uid()))
      returning id, clinic_id into v_client_id, v_client_clinic;
    end if;
  end if;

  update empresarial.dependents
    set client_id = v_client_id, clinic_id = v_client_clinic
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
end $$;

-- 7) Saída de colaborador (INACTIVE): titular sai → dependentes saem ----------
-- Fecha o membership, inativa dependentes e recalcula os selos. Reativar volta
-- o titular (dependentes seguem manuais).
create or replace function empresarial.set_employee_active(
  p_employee_id uuid,
  p_active boolean,
  p_reason text default null
)
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
    set status = case when p_active then 'ACTIVE' else 'INACTIVE' end,
        left_at = case when p_active then null else now() end,
        left_reason = case when p_active then null else p_reason end
  where id = p_employee_id;

  if not p_active then
    -- Fecha o histórico do titular.
    update empresarial.membership_history
      set ended_at = now()
    where client_id = v_emp.client_id and company_id = v_emp.company_id
      and member_role = 'HOLDER' and ended_at is null;

    -- Titular sai → dependentes saem.
    for v_dep in
      select * from empresarial.dependents where employee_id = p_employee_id and status = 'ACTIVE'
    loop
      update empresarial.dependents set status = 'INACTIVE' where id = v_dep.id;
      update empresarial.membership_history
        set ended_at = now()
      where client_id = v_dep.client_id and company_id = v_emp.company_id
        and member_role = 'DEPENDENT' and ended_at is null;
      if v_dep.client_id is not null then
        perform empresarial.refresh_client_badge(v_dep.client_id);
      end if;
    end loop;
  end if;

  if v_emp.client_id is not null then
    perform empresarial.refresh_client_badge(v_emp.client_id);
  end if;
end $$;

grant execute on function empresarial.format_cpf(text) to authenticated;
grant execute on function empresarial.complete_employee(uuid, uuid) to authenticated;
grant execute on function empresarial.link_dependent(uuid, uuid) to authenticated;
grant execute on function empresarial.set_employee_active(uuid, boolean, text) to authenticated;
grant execute on function empresarial.refresh_client_badge(uuid) to authenticated;
