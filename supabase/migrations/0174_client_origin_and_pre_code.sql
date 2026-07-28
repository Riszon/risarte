-- =============================================================================
-- 0174 — I5: por onde o cliente entrou (código PRE + origem registrada)
-- -----------------------------------------------------------------------------
-- Regra do dono: todo colaborador cadastrado pelo Risarte Empresarial ganha um
-- código próprio indicando que o cadastro nasceu no programa — do mesmo jeito
-- que o PPR+ usa `PPR-` e a unidade usa a sigla dela. Quem JÁ era cliente da
-- Risarte mantém o código que sempre teve.
--
-- Além do código, fica gravado **onde** e **por qual programa** foi o primeiro
-- cadastro (`origin_program`, `origin_clinic_id`, `origin_at`). Essa marca é
-- imutável: transferir o cliente de unidade não apaga de onde ele veio.
--
-- ⚠ Esta migração toca `empresarial.complete_employee` / `link_dependent`
-- (schema do outro projeto) por decisão do dono (28/07/2026), que pediu o
-- LOTE I inteiro nesta sessão. Mudança mínima e aditiva: só o código e a
-- origem do cliente novo. Numeração na faixa do core (0106+).
-- Idempotente.
-- =============================================================================

-- 1) Origem do cadastro -------------------------------------------------------
alter table public.clients
  add column if not exists origin_program text,
  add column if not exists origin_clinic_id uuid references public.clinics (id),
  add column if not exists origin_at timestamptz;

do $$
begin
  alter table public.clients
    add constraint clients_origin_program_check
    check (origin_program is null
           or origin_program in ('unidade','empresarial','ppr'));
exception when duplicate_object then null;
end $$;

create index if not exists clients_origin_idx
  on public.clients (origin_program, origin_clinic_id);

-- Preenche na criação e PROTEGE depois (a origem nunca muda).
create or replace function public.clients_set_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.origin_program := coalesce(new.origin_program, 'unidade');
    new.origin_clinic_id := coalesce(new.origin_clinic_id, new.clinic_id);
    new.origin_at := coalesce(new.origin_at, now());
  else
    -- Transferir de unidade não reescreve de onde o cliente veio.
    new.origin_program := coalesce(old.origin_program, new.origin_program, 'unidade');
    new.origin_clinic_id := coalesce(old.origin_clinic_id, new.origin_clinic_id, new.clinic_id);
    new.origin_at := coalesce(old.origin_at, new.origin_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists clients_set_origin_trg on public.clients;
create trigger clients_set_origin_trg
  before insert or update on public.clients
  for each row execute function public.clients_set_origin();

-- Retroativo: quem já existe recebe a unidade de origem = unidade atual.
do $$
begin
  update public.clients
     set origin_program = coalesce(origin_program, 'unidade'),
         origin_clinic_id = coalesce(origin_clinic_id, clinic_id),
         origin_at = coalesce(origin_at, created_at)
   where origin_program is null
      or origin_clinic_id is null
      or origin_at is null;
  -- Quem já está ligado ao Empresarial nasceu no programa.
  update public.clients c
     set origin_program = 'empresarial'
   where c.empresarial_company_id is not null
     and c.origin_program = 'unidade'
     and c.code like 'PRE-%';
exception when others then
  raise notice 'Backfill de origem ignorado: %', sqlerrm;
end $$;

-- 2) Ponte do colaborador: código PRE + origem --------------------------------
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
end $$;

grant execute on function empresarial.complete_employee(uuid, uuid) to authenticated;

-- 3) Ponte do dependente: mesma regra -----------------------------------------
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
end $$;

grant execute on function empresarial.link_dependent(uuid, uuid) to authenticated;
