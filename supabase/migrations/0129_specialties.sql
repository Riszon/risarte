-- =============================================================================
-- 0129 — H4.13: cadastro de especialidades (lista padronizada e gerenciável)
-- -----------------------------------------------------------------------------
-- Antes a especialidade era texto livre no procedimento e a lista do Risartano
-- vinha do "apanhado" desses textos. Agora há uma tabela `specialties` no nível
-- da REDE (sem clinic_id), com lista padrão já populada. Admin Master + Dentista
-- Planner gerenciam (adicionar / renomear / ativar-desativar / reordenar).
-- Procedimentos e Risartanos continuam guardando o NOME da especialidade (texto);
-- renomear cascateia via RPC para não deixar nada órfão. Idempotente.
-- =============================================================================

create table if not exists public.specialties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.specialties enable row level security;

-- Todos os autenticados leem (alimenta as listas suspensas); só Admin/Planner
-- escrevem (mesma regra do catálogo de procedimentos).
drop policy if exists specialties_select on public.specialties;
create policy specialties_select on public.specialties
  for select to authenticated
  using (true);

drop policy if exists specialties_write on public.specialties;
create policy specialties_write on public.specialties
  for all to authenticated
  using (public.is_admin_master() or public.is_planner())
  with check (public.is_admin_master() or public.is_planner());

-- Lista padrão (o dono ajusta depois na tela). on conflict = já existe → segue.
insert into public.specialties (name, sort_order) values
  ('Ortodontia', 10),
  ('Endodontia', 20),
  ('Periodontia', 30),
  ('Implantodontia', 40),
  ('Prótese', 50),
  ('Dentística/Estética', 60),
  ('Odontopediatria', 70),
  ('Cirurgia (Bucomaxilo)', 80),
  ('Radiologia', 90),
  ('DTM e Dor Orofacial', 100),
  ('Harmonização Orofacial', 110),
  ('Odontologia Preventiva', 120),
  ('Clínica Geral', 130)
on conflict (name) do nothing;

-- Preserva o que já existe: qualquer especialidade digitada nos procedimentos
-- que não esteja na lista entra ativa, no fim, para o dono organizar/renomear.
insert into public.specialties (name, sort_order)
select distinct btrim(p.specialty), 900
from public.procedures p
where p.specialty is not null and btrim(p.specialty) <> ''
on conflict (name) do nothing;

-- Renomear com cascata: atualiza a especialidade nos procedimentos e nos
-- Risartanos que usavam o nome antigo. SECURITY DEFINER (checa permissão aqui).
create or replace function public.rename_specialty(p_id uuid, p_new_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text := btrim(p_new_name);
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_new = '' then
    raise exception 'EMPTY_NAME';
  end if;
  select name into v_old from public.specialties where id = p_id;
  if v_old is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_new = v_old then
    return;
  end if;
  if exists (select 1 from public.specialties where name = v_new and id <> p_id) then
    raise exception 'DUPLICATE';
  end if;

  update public.specialties set name = v_new, updated_at = now() where id = p_id;
  update public.procedures
    set specialty = v_new, updated_at = now()
    where specialty = v_old;
  update public.staff_members
    set specialties = array_replace(specialties, v_old, v_new)
    where v_old = any(specialties);
end;
$$;
grant execute on function public.rename_specialty(uuid, text) to authenticated;
