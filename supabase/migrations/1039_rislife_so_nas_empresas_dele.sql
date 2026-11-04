-- 1039 — O CONSULTOR RISLIFE SÓ NAS EMPRESAS E NOS LEADS DELE (AP95, entrega 2; decisão do dono, 03/11/2026)
--
-- O papel, como o dono definiu: o Consultor RisLife faz o contato e a venda
-- do programa às empresas. Tem acesso só ao Empresarial e só às empresas e
-- aos leads em que é o responsável (`companies.assigned_consultant_id`,
-- `commercial_leads.consultant_id`). Lead sem responsável fica com o gestor
-- (Admin e Franqueadora/Rede), que atribui. Ele vê tudo das empresas dele e
-- dos beneficiários, mas no Empresarial; quando vão às unidades, não
-- acompanha (0353) — sabe do uso pelo resumo próprio (item 5).
--
-- Até aqui o banco o tratava como GESTOR DO PROGRAMA
-- (`empresarial.is_program_manager()`, 68 regras): via e mexia em todas as
-- empresas e em todo o funil.
--
-- O que muda:
--   1. `is_program_manager()` = Admin Master ou Franqueadora/Rede. As regras
--      que já tinham o ramo "é a empresa/o lead dele" (`accessible_company_ids`,
--      `can_access_lead`, `assigned_consultant_id`, `consultant_id`) seguem
--      valendo para ele: leitura, funil, proposta, contrato, termos, contatos.
--   2. `is_my_company(empresa)`: o consultor responsável por aquela empresa.
--      Ele converte o lead dele em empresa (que nasce com ele como responsável).
--   3. Dados próprios da empresa dele (decisão do dono: ver e editar):
--      unidades atendidas, documentos, arquivos, termos de inclusão,
--      vantagens, tabela de preços, indicações do Riso Social, preço de
--      adesão e benefícios negociados. As configurações da REDE (empresa
--      nula, grupos, modelos, regras do funil, divisão de receita) ficam com
--      o gestor.
--   4. Titulares e dependentes das empresas dele (decisão do dono: cadastrar
--      e editar, sem levar à unidade): cadastrar, editar, ativar/desativar,
--      excluir e restaurar. "Completar cadastro" e "ligar dependente" (que
--      criam o cliente na unidade) NÃO mudam: ficam com a unidade e o gestor.
--   5. `consultant_usage_summary(empresa)`: o uso do programa pelos
--      beneficiários, sem dado clínico (atendimentos, faltas, cancelamentos,
--      usos do benefício com procedimento, data e valores). Só o gestor ou o
--      consultor responsável. O relatório completo (sessões e pilares)
--      continua só com a gestão.
--   6. O contrato de adesão passa a ser assinado pela Risarte pelo consultor
--      responsável (sem ele, por quem envia); o texto o cita (dados da ficha,
--      0356).
--   7. Cobranças: ele só vê (decisão do dono). `is_program_finance()` lê o
--      gestor, que já não o inclui.
--
-- Na produção, em 03/11/2026, ninguém tinha o papel de Consultor RisLife.
-- Idempotente: `create or replace` e `drop policy if exists` + `create`.

-- 1. Gestor do programa: sem o Consultor RisLife.
create or replace function empresarial.is_program_manager()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  -- 1039: o Consultor RisLife saiu daqui; ele entra pelas regras "é a
  -- empresa/o lead dele".
  select public.is_admin_master()
      or public.is_network_viewer();
$function$;

-- 2. A empresa é do consultor que pergunta.
create or replace function empresarial.is_my_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select (select auth.uid()) is not null
     and exists (
       select 1 from empresarial.companies c
        where c.id = p_company_id
          and c.assigned_consultant_id = (select auth.uid())
     );
$function$;

revoke execute on function empresarial.is_my_company(uuid) from public, anon, authenticated;
grant execute on function empresarial.is_my_company(uuid) to authenticated;

-- 2b. A empresa nasce do lead: o consultor converte o lead DELE e a empresa
-- nasce com ele como responsável (`convertLeadToCompany`). Ele não cria
-- empresa em nome de outro consultor.
drop policy if exists companies_insert on empresarial.companies;
create policy companies_insert on empresarial.companies
  for insert to authenticated
  with check (empresarial.is_program_manager()
              or assigned_consultant_id = (select auth.uid()));

-- 3. Dados próprios da empresa: o gestor ou o consultor responsável.
drop policy if exists company_clinics_write on empresarial.company_clinics;
create policy company_clinics_write on empresarial.company_clinics
  for all to authenticated
  using (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  with check (empresarial.is_program_manager() or empresarial.is_my_company(company_id));

drop policy if exists company_documents_write on empresarial.company_documents;
create policy company_documents_write on empresarial.company_documents
  for all to authenticated
  using (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  with check (empresarial.is_program_manager() or empresarial.is_my_company(company_id));

drop policy if exists company_files_write on empresarial.company_files;
create policy company_files_write on empresarial.company_files
  for all to authenticated
  using (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  with check (empresarial.is_program_manager() or empresarial.is_my_company(company_id));

drop policy if exists company_inclusion_terms_write on empresarial.company_inclusion_terms;
create policy company_inclusion_terms_write on empresarial.company_inclusion_terms
  for all to authenticated
  using (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  with check (empresarial.is_program_manager() or empresarial.is_my_company(company_id));

drop policy if exists company_perks_write on empresarial.company_perks;
create policy company_perks_write on empresarial.company_perks
  for all to authenticated
  using (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  with check (empresarial.is_program_manager() or empresarial.is_my_company(company_id));

drop policy if exists company_price_tiers_write on empresarial.company_price_tiers;
create policy company_price_tiers_write on empresarial.company_price_tiers
  for all to authenticated
  using (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  with check (empresarial.is_program_manager() or empresarial.is_my_company(company_id));

drop policy if exists social_referrals_write on empresarial.social_referrals;
create policy social_referrals_write on empresarial.social_referrals
  for all to authenticated
  using (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  with check (empresarial.is_program_manager() or empresarial.is_my_company(company_id));

drop policy if exists adhesion_pricing_write on empresarial.adhesion_pricing;
create policy adhesion_pricing_write on empresarial.adhesion_pricing
  for all to authenticated
  using (case
    when company_id is null then (public.is_admin_master() or public.is_network_viewer())
    else (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  end)
  with check (case
    when company_id is null then (public.is_admin_master() or public.is_network_viewer())
    else (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  end);

drop policy if exists procedure_benefits_write on empresarial.procedure_benefits;
create policy procedure_benefits_write on empresarial.procedure_benefits
  for all to authenticated
  using (case
    when company_id is null then (public.is_admin_master() or public.is_network_viewer())
    else (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  end)
  with check (case
    when company_id is null then (public.is_admin_master() or public.is_network_viewer())
    else (empresarial.is_program_manager() or empresarial.is_my_company(company_id))
  end);

-- 4. Titulares e dependentes das empresas dele.
drop policy if exists employees_write on empresarial.employees;
create policy employees_write on empresarial.employees
  for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer() or empresarial.is_program_manager()
         or public.is_sdr() or clinic_id in (select public.user_full_access_clinic_ids())
         or empresarial.is_my_company(company_id))
  with check (public.is_admin_master() or public.is_network_viewer() or empresarial.is_program_manager()
         or public.is_sdr() or clinic_id in (select public.user_full_access_clinic_ids())
         or empresarial.is_my_company(company_id));

drop policy if exists dependents_write on empresarial.dependents;
create policy dependents_write on empresarial.dependents
  for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer() or empresarial.is_program_manager()
         or public.is_sdr() or clinic_id in (select public.user_full_access_clinic_ids())
         or employee_id in (select e.id from empresarial.employees e
                         where empresarial.is_my_company(e.company_id)))
  with check (public.is_admin_master() or public.is_network_viewer() or empresarial.is_program_manager()
         or public.is_sdr() or clinic_id in (select public.user_full_access_clinic_ids())
         or employee_id in (select e.id from empresarial.employees e
                         where empresarial.is_my_company(e.company_id)));

drop policy if exists employee_files_write on empresarial.employee_files;
create policy employee_files_write on empresarial.employee_files
  for all to authenticated
  using (employee_id in (
    select e.id from empresarial.employees e
     where public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
        or e.clinic_id in (select public.user_full_access_clinic_ids())
        or empresarial.is_my_company(e.company_id)))
  with check (employee_id in (
    select e.id from empresarial.employees e
     where public.is_admin_master() or empresarial.is_program_manager() or public.is_sdr()
        or e.clinic_id in (select public.user_full_access_clinic_ids())
        or empresarial.is_my_company(e.company_id)));

-- Ativar/desativar, restaurar e excluir: a mesma régua, com a empresa dele.
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
  -- 1039: o Consultor RisLife exclui titular das empresas DELE.
  if not (empresarial.can_manage_employees()
          or exists (select 1 from empresarial.employees e
                      where e.id = p_employee_id
                        and empresarial.is_my_company(e.company_id))) then
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

-- 4b. Quem assina o contrato de adesão pela Risarte: o consultor responsável
-- (sem ele, quem envia — a tela resolve; decisão do dono). Só troca enquanto
-- o modelo estiver como veio (o titular), para não desfazer ajuste do Admin.
update public.signature_templates
   set risarte_signer_role = 'rislife_consultant',
       updated_at = now()
 where code = 'adesao_empresarial'
   and risarte_signer_mode = 'role'
   and risarte_signer_role is null;

-- 5. O uso do programa, sem dado clínico.
create or replace function empresarial.consultant_usage_summary(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v jsonb;
begin
  if (select auth.uid()) is null
     or not (empresarial.is_program_manager() or empresarial.is_my_company(p_company_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  with membros as (
    select e.client_id, e.full_name::text as nome, 'HOLDER'::text as papel,
           null::text as parentesco, null::text as titular, e.status::text as situacao,
           e.clinic_id
      from empresarial.employees e
     where e.company_id = p_company_id and e.client_id is not null
    union all
    select d.client_id, coalesce(d.full_name, 'Dependente')::text, 'DEPENDENT',
           d.relationship::text, e.full_name::text, d.status::text, d.clinic_id
      from empresarial.dependents d
      join empresarial.employees e on e.id = d.employee_id
     where e.company_id = p_company_id and d.client_id is not null
  )
  select jsonb_build_object(
    'membros', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', m.nome,
        'papel', m.papel,
        'parentesco', m.parentesco,
        'titular', m.titular,
        'situacao', m.situacao,
        'unidade', (select cl.name from public.clinics cl where cl.id = m.clinic_id),
        'usos', (select count(*) from empresarial.benefit_usage u
                  where u.company_id = p_company_id and u.client_id = m.client_id),
        'cheio_cents', (select coalesce(sum(u.amount_full_cents), 0) from empresarial.benefit_usage u
                         where u.company_id = p_company_id and u.client_id = m.client_id),
        'pago_cents', (select coalesce(sum(u.amount_charged_cents), 0) from empresarial.benefit_usage u
                        where u.company_id = p_company_id and u.client_id = m.client_id),
        'economia_cents', (select coalesce(sum(u.amount_saved_cents), 0) from empresarial.benefit_usage u
                            where u.company_id = p_company_id and u.client_id = m.client_id),
        'atendimentos', (select count(*) from public.appointments a
                          where a.client_id = m.client_id
                            and (a.status = 'completed' or a.attendance = 'done')),
        'agendados', (select count(*) from public.appointments a
                       where a.client_id = m.client_id
                         and a.status in ('scheduled', 'confirmed') and a.starts_at > now()),
        'faltas', (select count(*) from public.appointments a
                    where a.client_id = m.client_id and a.status = 'no_show'),
        'cancelados', (select count(*) from public.appointments a
                        where a.client_id = m.client_id and a.status = 'cancelled'),
        'ultimo_atendimento', (select max(a.starts_at) from public.appointments a
                                where a.client_id = m.client_id
                                  and (a.status = 'completed' or a.attendance = 'done'))
      ) order by m.nome)
      from membros m), '[]'::jsonb),
    'usos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'data', u.used_at,
        'nome', m.nome,
        'procedimento', p.name,
        'unidade', cl.name,
        'cheio_cents', coalesce(u.amount_full_cents, 0),
        'pago_cents', coalesce(u.amount_charged_cents, 0),
        'economia_cents', coalesce(u.amount_saved_cents, 0)
      ) order by u.used_at desc)
      from empresarial.benefit_usage u
      join (select distinct client_id, nome from membros) m on m.client_id = u.client_id
      left join public.procedures p on p.id = u.procedure_id
      left join public.clinics cl on cl.id = u.clinic_id
      where u.company_id = p_company_id), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

revoke execute on function empresarial.consultant_usage_summary(uuid) from public, anon, authenticated;
grant execute on function empresarial.consultant_usage_summary(uuid) to authenticated;

-- Conferência (rodar e olhar): false · 1 · 1 · 12 · false · rislife_consultant
select
  (pg_get_functiondef('empresarial.is_program_manager()'::regprocedure) like '%rislife_consultant%') as gestor_tem_rislife,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial' and p.proname = 'is_my_company') as funcao_da_empresa,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial' and p.proname = 'consultant_usage_summary') as resumo_do_uso,
  (select count(*) from pg_policies
    where schemaname = 'empresarial' and coalesce(qual, '') like '%is_my_company%') as regras_com_a_empresa,
  has_function_privilege('anon', 'empresarial.consultant_usage_summary(uuid)', 'execute') as sem_login_executa,
  (select risarte_signer_role::text from public.signature_templates where code = 'adesao_empresarial') as quem_assina_a_adesao;
