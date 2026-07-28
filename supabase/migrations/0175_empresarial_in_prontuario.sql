-- =============================================================================
-- 0175 — I6: Risarte Empresarial visível no prontuário
-- -----------------------------------------------------------------------------
-- O selo "Risarte Empresarial" já existia, mas faltava o essencial no dia a dia:
--   1. POR QUAL EMPRESA o cliente faz parte do programa;
--   2. o vínculo titular ↔ dependentes, que não aparecia em prontuário nenhum.
--
-- Para o núcleo (prontuário, listas, cockpit) não precisar conversar com o
-- schema `empresarial`, o nome da empresa passa a ser copiado para
-- `clients.empresarial_company_name` (mantido pelo mesmo gatilho do selo) e o
-- vínculo familiar sai por uma função SECURITY DEFINER com guarda de acesso.
--
-- ⚠ Toca funções do schema `empresarial` (decisão do dono para o LOTE I).
-- Idempotente.
-- =============================================================================

-- 1) Nome da empresa junto do selo --------------------------------------------
alter table public.clients
  add column if not exists empresarial_company_name text;

create or replace function empresarial.refresh_client_badge(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_company_name text;
  v_active boolean;
begin
  if p_client_id is null then return; end if;

  select coalesce(
    (select e.company_id from empresarial.employees e
      where e.client_id = p_client_id
      order by (e.status = 'ACTIVE') desc, e.joined_at desc limit 1),
    (select emp.company_id from empresarial.dependents d
       join empresarial.employees emp on emp.id = d.employee_id
      where d.client_id = p_client_id
      order by (d.status = 'ACTIVE') desc limit 1)
  ) into v_company;

  -- I6: o nome vem junto, para o prontuário não precisar do schema empresarial.
  select coalesce(nullif(btrim(c.trade_name), ''), c.legal_name)
    into v_company_name
  from empresarial.companies c where c.id = v_company;

  v_active :=
    exists (select 1 from empresarial.employees e
              where e.client_id = p_client_id and e.status = 'ACTIVE')
    or exists (select 1 from empresarial.dependents d
                 where d.client_id = p_client_id and d.status = 'ACTIVE');

  update public.clients c
    set empresarial_company_id = v_company,
        empresarial_company_name = v_company_name,
        empresarial_active = case when v_company is null then null else v_active end
  where c.id = p_client_id
    and (c.empresarial_company_id is distinct from v_company
         or c.empresarial_company_name is distinct from v_company_name
         or c.empresarial_active is distinct from
            (case when v_company is null then null else v_active end));
end $$;

-- Recalcula quem já está vinculado (preenche o nome retroativamente).
do $$
declare r record;
begin
  for r in select id from public.clients where empresarial_company_id is not null
  loop
    perform empresarial.refresh_client_badge(r.id);
  end loop;
exception when others then
  raise notice 'Backfill do nome da empresa ignorado: %', sqlerrm;
end $$;

-- 2) Titular ↔ dependentes ----------------------------------------------------
-- Devolve as pessoas ligadas ao cliente dentro do programa: se ele é titular,
-- os dependentes; se é dependente, o titular (e os demais dependentes do mesmo
-- titular). Só devolve para quem já pode ver o cliente.
create or replace function public.empresarial_client_family(p_client_id uuid)
returns table (
  role text,
  client_id uuid,
  full_name text,
  relationship text,
  active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_employee uuid;
begin
  select c.clinic_id into v_clinic from public.clients c where c.id = p_client_id;
  if v_clinic is null then return; end if;

  -- Guarda: mesma régua de quem enxerga a ficha do cliente.
  if not (
    public.is_admin_master()
    or v_clinic in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.is_planner()
    or public.user_has_client_history_access(p_client_id)
    or public.has_role_in_clinic(
         v_clinic,
         array['receptionist','clinical_coordinator','dentist']::public.user_role[]
       )
  ) then
    return;
  end if;

  -- É titular?
  select e.id into v_employee
  from empresarial.employees e
  where e.client_id = p_client_id
  order by (e.status = 'ACTIVE') desc, e.joined_at desc
  limit 1;

  if v_employee is not null then
    return query
      select 'dependente'::text,
             d.client_id,
             coalesce(cl.full_name, d.full_name, 'Dependente'),
             d.relationship::text,
             d.status = 'ACTIVE'
        from empresarial.dependents d
        left join public.clients cl on cl.id = d.client_id
       where d.employee_id = v_employee
       order by 3;
    return;
  end if;

  -- Senão, é dependente: devolve o titular + os "irmãos" do mesmo titular.
  select d.employee_id into v_employee
  from empresarial.dependents d
  where d.client_id = p_client_id
  order by (d.status = 'ACTIVE') desc
  limit 1;

  if v_employee is null then return; end if;

  return query
    select 'titular'::text,
           e.client_id,
           coalesce(cl.full_name, e.full_name),
           null::text,
           e.status = 'ACTIVE'
      from empresarial.employees e
      left join public.clients cl on cl.id = e.client_id
     where e.id = v_employee
    union all
    select 'dependente'::text,
           d.client_id,
           coalesce(cl2.full_name, d.full_name, 'Dependente'),
           d.relationship::text,
           d.status = 'ACTIVE'
      from empresarial.dependents d
      left join public.clients cl2 on cl2.id = d.client_id
     where d.employee_id = v_employee
       and d.client_id is distinct from p_client_id;
end $$;

grant execute on function public.empresarial_client_family(uuid) to authenticated;
