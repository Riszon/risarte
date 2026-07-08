-- =============================================================================
-- 0078 — Vínculo Risartano ↔ cliente — H4.1 Lote 2
-- -----------------------------------------------------------------------------
-- Muitos colaboradores (Risartanos) também são pacientes. Este vínculo liga o
-- cliente ao cadastro de RH pelo CPF, de forma AUTOMÁTICA (gatilhos), e mantém
-- os dois lados em sincronia:
--   * clients.staff_member_id  — o Risartano ligado (por CPF), ou NULL.
--   * clients.risartano_active — espelho do is_active do colaborador (NULL se
--                                não for Risartano). A recepção vê só isto (o
--                                selo "é um Risartano"), nunca os dados de RH.
-- Ao inativar/reativar um Risartano, registra no histórico do prontuário
-- (client_changes) dos clientes ligados. Idempotente.
-- =============================================================================

-- 1) Colunas de vínculo em clients ----------------------------------------------
alter table public.clients
  add column if not exists staff_member_id uuid
    references public.staff_members (id) on delete set null;
alter table public.clients
  add column if not exists risartano_active boolean;

create index if not exists clients_staff_member_idx
  on public.clients (staff_member_id);

-- Compara CPF ignorando máscara (só os dígitos; NULL quando vazio).
create or replace function public.cpf_digits(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

-- 2) BEFORE em clients: resolve o vínculo pelo CPF ------------------------------
create or replace function public.clients_link_risartano()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
begin
  if public.cpf_digits(new.cpf) is null then
    new.staff_member_id := null;
    new.risartano_active := null;
    return new;
  end if;

  select sm.id, sm.is_active
    into v_staff
  from public.staff_members sm
  where public.cpf_digits(sm.cpf) = public.cpf_digits(new.cpf)
  order by sm.is_active desc, sm.created_at asc
  limit 1;

  if found then
    new.staff_member_id := v_staff.id;
    new.risartano_active := v_staff.is_active;
  else
    new.staff_member_id := null;
    new.risartano_active := null;
  end if;
  return new;
end $$;

drop trigger if exists clients_link_risartano_trg on public.clients;
create trigger clients_link_risartano_trg
  before insert or update of cpf on public.clients
  for each row execute function public.clients_link_risartano();

-- 3) AFTER em staff_members: sincroniza clientes + histórico na (in)ativação ----
create or replace function public.staff_sync_risartano()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client record;
begin
  -- (a) Vincula/atualiza clientes com o mesmo CPF deste Risartano.
  if public.cpf_digits(new.cpf) is not null then
    for v_client in
      select id, clinic_id, staff_member_id, risartano_active
      from public.clients
      where public.cpf_digits(cpf) = public.cpf_digits(new.cpf)
    loop
      -- Histórico do prontuário quando o status do colaborador muda.
      if tg_op = 'UPDATE'
         and v_client.staff_member_id = new.id
         and v_client.risartano_active is distinct from new.is_active then
        insert into public.client_changes (client_id, clinic_id, changed_by, fields)
        values (
          v_client.id,
          v_client.clinic_id,
          auth.uid(),
          case when new.is_active
            then 'Voltou a ser Risartano ativo'
            else 'Deixou de ser Risartano (colaborador inativado)'
          end
        );
      end if;

      update public.clients
      set staff_member_id = new.id,
          risartano_active = new.is_active
      where id = v_client.id
        and (staff_member_id is distinct from new.id
             or risartano_active is distinct from new.is_active);
    end loop;
  end if;

  -- (b) Se o CPF mudou, desvincula clientes que apontavam para este Risartano
  --     mas não batem mais com o CPF novo.
  if tg_op = 'UPDATE' then
    update public.clients
    set staff_member_id = null, risartano_active = null
    where staff_member_id = new.id
      and (public.cpf_digits(new.cpf) is null
           or public.cpf_digits(cpf) is distinct from public.cpf_digits(new.cpf));
  end if;

  return new;
end $$;

drop trigger if exists staff_sync_risartano_trg on public.staff_members;
create trigger staff_sync_risartano_trg
  after insert or update of cpf, is_active on public.staff_members
  for each row execute function public.staff_sync_risartano();

-- 4) Backfill dos vínculos já existentes ----------------------------------------
update public.clients c
set staff_member_id = s.staff_id,
    risartano_active = s.is_active
from (
  select distinct on (public.cpf_digits(cpf))
    public.cpf_digits(cpf) as cpf_key,
    id as staff_id,
    is_active
  from public.staff_members
  where public.cpf_digits(cpf) is not null
  order by public.cpf_digits(cpf), is_active desc, created_at asc
) s
where public.cpf_digits(c.cpf) = s.cpf_key
  and (c.staff_member_id is distinct from s.staff_id
       or c.risartano_active is distinct from s.is_active);

-- 5) Autopreenchimento: dados de um Risartano pelo CPF (tela de novo cliente) ---
-- Escopo: colaboradores das unidades a que o usuário tem papel (ou admin/rede).
-- Não expõe o RH de toda a rede por sondagem de CPF. O vínculo/selo (gatilhos
-- acima) acontece de qualquer forma; só o autopreenchimento é limitado.
create or replace function public.lookup_risartano_by_cpf(p_cpf text)
returns table (
  staff_id uuid,
  code text,
  full_name text,
  birth_date date,
  phone text,
  email text,
  address text,
  address_number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  zip_code text,
  role_title text,
  is_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.code, s.full_name, s.birth_date, s.whatsapp, s.email,
         s.address, s.address_number, s.complement, s.neighborhood, s.city,
         s.state, s.zip_code, s.role_title, s.is_active
  from public.staff_members s
  where public.cpf_digits(p_cpf) is not null
    and public.cpf_digits(s.cpf) = public.cpf_digits(p_cpf)
    and (
      public.is_admin_master()
      or public.is_network_viewer()
      or s.clinic_id in (select public.user_clinic_ids())
    )
  order by s.is_active desc, s.created_at asc
  limit 1;
$$;

grant execute on function public.cpf_digits(text) to authenticated;
grant execute on function public.lookup_risartano_by_cpf(text) to authenticated;
