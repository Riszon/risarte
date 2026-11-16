-- =============================================================================
-- 1048 — AS PERMISSÕES DO EMPRESARIAL NA MATRIZ (Empresarial 0.108.0,
--         16/11/2026; pedido do dono)
--
-- "Em permissões deve ter como eu ver para personalizar melhor as permissões
-- do Empresarial; hoje eu não consigo ver quem pode editar as empresas."
--
-- ANTES: quem gere, cobra, cadastra titulares e configura o programa estava
-- ESCRITO nas funções do banco (e no app) — "franchisor_staff",
-- "finance_franchisor", "rislife_consultant", "sdr"… — e não aparecia em
-- Administração → Permissões.
--
-- AGORA: cinco permissões na matriz (grupo "Ações — Empresarial"), e as
-- funções que decidem quem pode perguntam a ela por `empresarial.pode`:
--   acao.empresarial.gerir ...... is_program_manager()  (toda a rede)
--   acao.empresarial.carteira ... is_my_company / can_access_lead / o
--                                 "consultor responsável" das regras
--   acao.empresarial.cobrancas .. is_program_finance()
--   acao.empresarial.titulares .. can_manage_employees() + escrita de titulares
--   acao.empresarial.configurar . can_configure_program() (regras da rede)
--
-- ⚠️ NADA MUDA ATÉ ALGUÉM MEXER NA TELA: as permissões nascem com os papéis de
-- hoje (a semente abaixo), e a conta de cada função dá o mesmo resultado de
-- antes com a matriz padrão. O ensaio (scripts/empresarial-ensaio-1048.mjs)
-- prova isso papel por papel.
--
-- ⚠️ O QUE NÃO PASSA PELA MATRIZ: o Admin Master (sempre pode) e o ALCANCE —
-- quem tem "carteira" só alcança as empresas/leads em que é o responsável;
-- quem cadastra titulares só nas empresas que alcança (unidade, carteira,
-- rede). A matriz diz O QUE a pessoa faz; o alcance diz ONDE.
--
-- ⚠️ Padrões do banco (`_padrao_da_permissao`) = `permissions.ts`; a régua
-- `permissoes-empresarial.test.ts` compara.
--
-- Nada é apagado: funções recriadas, regras de linha recriadas com a mesma
-- leitura e a semente das permissões.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A pergunta: esta pessoa tem a permissão (em qualquer unidade)?
-- -----------------------------------------------------------------------------
create or replace function empresarial._padrao_da_permissao(p_cap text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_cap
    when 'acao.empresarial.gerir' then array['franchisor_staff']::public.user_role[]
    when 'acao.empresarial.carteira' then array['rislife_consultant']::public.user_role[]
    when 'acao.empresarial.cobrancas' then array['franchisor_staff','finance_franchisor']::public.user_role[]
    when 'acao.empresarial.titulares' then
      array['franchisor_staff','rislife_consultant','sdr','receptionist','unit_manager','franchisee']::public.user_role[]
    when 'acao.empresarial.configurar' then array['franchisor_staff']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function empresarial._padrao_da_permissao(text) from public, anon, authenticated;

create or replace function empresarial.pode(p_cap text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_roles public.user_role[];
begin
  if v_uid is null or p_cap is null then
    return false;
  end if;
  if public.is_admin_master() then
    return true;
  end if;

  -- As funções de hoje, em qualquer unidade (a janela respeita a tranca).
  select coalesce(array_agg(distinct ucr.role), '{}'::public.user_role[])
    into v_roles
    from public.user_clinic_roles ucr
   where ucr.user_id = v_uid;
  if coalesce(array_length(v_roles, 1), 0) = 0 then
    return false;
  end if;

  -- Matriz gravada (produção e treino): ela manda. Sem nenhuma linha (banco
  -- novo), valem os padrões — o mesmo combinado de `signature_can`.
  if exists (select 1 from public.permission_matrix) then
    return exists (
      select 1 from public.permission_matrix pm
       where pm.capability = p_cap
         and pm.allowed
         and pm.role = any (v_roles)
    );
  end if;
  return exists (
    select 1 from unnest(empresarial._padrao_da_permissao(p_cap)) r
     where r = any (v_roles)
  );
end;
$$;
revoke execute on function empresarial.pode(text) from public, anon, authenticated;
grant execute on function empresarial.pode(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. As funções que decidem, agora pela matriz
-- -----------------------------------------------------------------------------
create or replace function empresarial.is_program_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or empresarial.pode('acao.empresarial.gerir');
$$;

create or replace function empresarial.is_program_finance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select empresarial.is_program_manager() or empresarial.pode('acao.empresarial.cobrancas');
$$;

create or replace function empresarial.is_my_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and empresarial.pode('acao.empresarial.carteira')
     and exists (
       select 1 from empresarial.companies c
        where c.id = p_company_id
          and c.assigned_consultant_id = (select auth.uid())
     );
$$;

create or replace function empresarial.can_access_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select empresarial.is_program_manager()
      or (
        empresarial.pode('acao.empresarial.carteira')
        and exists (
          select 1 from empresarial.commercial_leads l
          where l.id = p_lead_id and l.consultant_id = (select auth.uid())
        )
      );
$$;

create or replace function empresarial.can_manage_employees()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or empresarial.pode('acao.empresarial.titulares');
$$;

create or replace function empresarial.can_configure_program()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or empresarial.pode('acao.empresarial.configurar');
$$;
revoke execute on function empresarial.can_configure_program() from public, anon, authenticated;
grant execute on function empresarial.can_configure_program() to authenticated, service_role;

create or replace function empresarial.accessible_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from empresarial.companies c
  where empresarial.is_program_manager()
     or empresarial.is_program_finance()  -- quem cobra, cobra todas (OC-00105)
     or (c.assigned_consultant_id = (select auth.uid())
         and empresarial.pode('acao.empresarial.carteira'))
  union
  select distinct e.company_id
  from empresarial.employees e
  where e.clinic_id in (select public.user_full_access_clinic_ids());
$$;

-- -----------------------------------------------------------------------------
-- 3. As regras de linha que tinham o papel escrito no próprio texto
-- -----------------------------------------------------------------------------
-- O "consultor responsável" passa a exigir a permissão "carteira".
drop policy if exists commercial_leads_select on empresarial.commercial_leads;
create policy commercial_leads_select on empresarial.commercial_leads
  for select to authenticated
  using (empresarial.is_program_manager()
         or (consultant_id = (select auth.uid()) and empresarial.pode('acao.empresarial.carteira')));
drop policy if exists commercial_leads_write on empresarial.commercial_leads;
create policy commercial_leads_write on empresarial.commercial_leads
  for all to authenticated
  using (empresarial.is_program_manager()
         or (consultant_id = (select auth.uid()) and empresarial.pode('acao.empresarial.carteira')))
  with check (empresarial.is_program_manager()
         or (consultant_id = (select auth.uid()) and empresarial.pode('acao.empresarial.carteira')));

drop policy if exists companies_insert on empresarial.companies;
create policy companies_insert on empresarial.companies
  for insert to authenticated
  with check (empresarial.is_program_manager()
         or (assigned_consultant_id = (select auth.uid()) and empresarial.pode('acao.empresarial.carteira')));
drop policy if exists companies_update on empresarial.companies;
create policy companies_update on empresarial.companies
  for update to authenticated
  using (empresarial.is_program_manager()
         or (assigned_consultant_id = (select auth.uid()) and empresarial.pode('acao.empresarial.carteira')))
  with check (empresarial.is_program_manager()
         or (assigned_consultant_id = (select auth.uid()) and empresarial.pode('acao.empresarial.carteira')));
drop policy if exists companies_select on empresarial.companies;
create policy companies_select on empresarial.companies
  for select to authenticated
  using (empresarial.is_program_manager()
         or (assigned_consultant_id = (select auth.uid()) and empresarial.pode('acao.empresarial.carteira'))
         or id in (select empresarial.accessible_company_ids()));

-- As regras da REDE passam a ser das "Configurações do programa".
do $$
declare t text;
begin
  foreach t in array array['benefit_group_items','benefit_group_perks','benefit_groups',
                           'perks','funnel_settings','funnel_stage_limits','contract_settings']
  loop
    execute format('drop policy if exists %I on empresarial.%I', t || '_write', t);
    execute format(
      'create policy %I on empresarial.%I for all to authenticated
         using (empresarial.can_configure_program())
         with check (empresarial.can_configure_program())',
      t || '_write', t);
  end loop;

  foreach t in array array['contract_templates','presentation_templates','proposal_templates']
  loop
    execute format('drop policy if exists %I on empresarial.%I', t || '_write', t);
    execute format(
      'create policy %I on empresarial.%I for all to authenticated
         using (case when lead_id is null then empresarial.can_configure_program()
                     else empresarial.can_access_lead(lead_id) end)
         with check (case when lead_id is null then empresarial.can_configure_program()
                          else empresarial.can_access_lead(lead_id) end)',
      t || '_write', t);
  end loop;

  foreach t in array array['adhesion_pricing','procedure_benefits']
  loop
    execute format('drop policy if exists %I on empresarial.%I', t || '_write', t);
    execute format(
      'create policy %I on empresarial.%I for all to authenticated
         using (case when company_id is null then empresarial.can_configure_program()
                     else (empresarial.is_program_manager() or empresarial.is_my_company(company_id)) end)
         with check (case when company_id is null then empresarial.can_configure_program()
                          else (empresarial.is_program_manager() or empresarial.is_my_company(company_id)) end)',
      t || '_write', t);
  end loop;
end;
$$;

drop policy if exists split_rules_write on empresarial.split_rules;
create policy split_rules_write on empresarial.split_rules
  for all to authenticated
  using (case when company_id is null then empresarial.can_configure_program()
              else (empresarial.is_program_manager()
                    and company_id in (select empresarial.accessible_company_ids())) end)
  with check (case when company_id is null then empresarial.can_configure_program()
                   else (empresarial.is_program_manager()
                         and company_id in (select empresarial.accessible_company_ids())) end);

-- As cobranças: "Cobranças das empresas".
drop policy if exists adhesion_billing_write on empresarial.adhesion_billing;
create policy adhesion_billing_write on empresarial.adhesion_billing
  for all to authenticated
  using (empresarial.is_program_finance())
  with check (empresarial.is_program_finance());

-- Os titulares: "Cadastrar titulares e dependentes" E o alcance de antes.
drop policy if exists employees_write on empresarial.employees;
create policy employees_write on empresarial.employees
  for all to authenticated
  using (empresarial.can_manage_employees() and (
           public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
           or clinic_id in (select public.user_full_access_clinic_ids())
           or empresarial.is_my_company(company_id)))
  with check (empresarial.can_manage_employees() and (
           public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
           or clinic_id in (select public.user_full_access_clinic_ids())
           or empresarial.is_my_company(company_id)));

drop policy if exists dependents_write on empresarial.dependents;
create policy dependents_write on empresarial.dependents
  for all to authenticated
  using (empresarial.can_manage_employees() and (
           public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
           or clinic_id in (select public.user_full_access_clinic_ids())
           or employee_id in (select e.id from empresarial.employees e
                               where empresarial.is_my_company(e.company_id))))
  with check (empresarial.can_manage_employees() and (
           public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
           or clinic_id in (select public.user_full_access_clinic_ids())
           or employee_id in (select e.id from empresarial.employees e
                               where empresarial.is_my_company(e.company_id))));

drop policy if exists employee_files_write on empresarial.employee_files;
create policy employee_files_write on empresarial.employee_files
  for all to authenticated
  using (empresarial.can_manage_employees() and employee_id in (
           select e.id from empresarial.employees e
            where public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
               or e.clinic_id in (select public.user_full_access_clinic_ids())
               or empresarial.is_my_company(e.company_id)))
  with check (empresarial.can_manage_employees() and employee_id in (
           select e.id from empresarial.employees e
            where public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
               or e.clinic_id in (select public.user_full_access_clinic_ids())
               or empresarial.is_my_company(e.company_id)));

-- -----------------------------------------------------------------------------
-- 4. As portas que passam por fora da regra da tabela (security definer).
--    • inativar/reativar e restaurar titular: a guarda de antes, com a
--      permissão "titulares" na frente;
--    • LEVAR À UNIDADE (completar cadastro, vincular dependente): além da
--      permissão, exige ter unidade no alcance — a regra da tela
--      (`canUseClinic`). Sem isto, quem só tem a CARTEIRA (o Consultor
--      RisLife, que não enxerga pacientes — 0353) passaria a ligar titular a
--      paciente pelo CPF, o que hoje não faz.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION empresarial.set_employee_active(p_employee_id uuid, p_active boolean, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp record;
  v_dep record;
begin
  -- AP16: a mesma régua da política employees_write, para ESTE titular.
  if auth.uid() is not null and not exists (
    select 1 from empresarial.employees e
     where e.id = p_employee_id
       and empresarial.can_manage_employees()
       and (public.is_admin_master() or public.is_network_viewer()
            or empresarial.is_program_manager() or public.is_sdr()
            or empresarial.is_my_company(e.company_id)
            or e.clinic_id in (select public.user_full_access_clinic_ids()))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

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
end $function$;

CREATE OR REPLACE FUNCTION empresarial.restore_employee(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_emp record;
begin
  -- AP16: a mesma régua da política employees_write, para ESTE titular.
  if auth.uid() is not null and not exists (
    select 1 from empresarial.employees e
     where e.id = p_employee_id
       and empresarial.can_manage_employees()
       and (public.is_admin_master() or public.is_network_viewer()
            or empresarial.is_program_manager() or public.is_sdr()
            or empresarial.is_my_company(e.company_id)
            or e.clinic_id in (select public.user_full_access_clinic_ids()))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_emp from empresarial.employees where id = p_employee_id;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
  if v_emp.status <> 'DELETED' then return; end if;

  update empresarial.employees
    set status = 'INACTIVE', deleted_at = null, deleted_by = null
  where id = p_employee_id;

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
  if not empresarial.can_manage_employees()
     or not (public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
             or exists (select 1 from public.user_full_access_clinic_ids())) then
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
  if not empresarial.can_manage_employees()
     or not (public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
             or exists (select 1 from public.user_full_access_clinic_ids())) then
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

-- -----------------------------------------------------------------------------
-- 5. A semente: com a matriz gravada (produção e treino), as permissões
--    novas nascem com os papéis de hoje; o padrão fixado (0292) também.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select cap, r
      from (values ('acao.empresarial.gerir'), ('acao.empresarial.carteira'),
                   ('acao.empresarial.cobrancas'), ('acao.empresarial.titulares'),
                   ('acao.empresarial.configurar')) as caps(cap)
      cross join lateral unnest(empresarial._padrao_da_permissao(cap)) as r
    on conflict (capability, role) do nothing;
  end if;
end;
$$;
insert into public.permission_defaults (capability, roles)
select cap, empresarial._padrao_da_permissao(cap)
  from (values ('acao.empresarial.gerir'), ('acao.empresarial.carteira'),
               ('acao.empresarial.cobrancas'), ('acao.empresarial.titulares'),
               ('acao.empresarial.configurar')) as caps(cap)
on conflict (capability) do nothing;

-- CONFERÊNCIA (só leitura): 5 permissões semeadas (linhas na matriz), as 2
-- funções novas fechadas a anônimos, e quantas regras de linha usam a nova.
select
  (select count(distinct capability) from public.permission_matrix
    where capability like 'acao.empresarial.%') as permissoes_na_matriz,
  (select count(*) from public.permission_defaults
    where capability like 'acao.empresarial.%') as padroes_fixados,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial' and p.proname in ('pode', 'can_configure_program')
      and not has_function_privilege('anon', p.oid, 'execute')) as funcoes_fechadas,
  (select count(*) from pg_policies
    where schemaname = 'empresarial'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'can_configure_program|pode\(') as regras_com_a_matriz;
