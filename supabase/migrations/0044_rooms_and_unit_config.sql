-- =============================================================================
-- Risarte Odontologia — Migration 0044 (LOTE G — G1: salas + config na unidade)
-- Transforma o "número de cadeiras" em SALAS de verdade (com nome) por unidade,
-- guarda a sala do Coordenador Clínico (avaliações/reavaliações) e libera a
-- configuração da agenda para a GERENTE DE UNIDADE (antes só Admin Master).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Salas de atendimento (antes só um número de cadeiras). Uma por linha, com
-- nome, ordem e ativo/inativo. clinic_id obrigatório (sala é sempre de uma
-- unidade; o padrão da rede não tem salas).
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_rooms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinic_rooms_clinic_idx on public.clinic_rooms (clinic_id);
alter table public.clinic_rooms enable row level security;

-- Sala em que o Coordenador Clínico faz avaliações/reavaliações.
alter table public.clinic_agenda_settings
  add column if not exists coordinator_room_id uuid
    references public.clinic_rooms (id) on delete set null;

-- -----------------------------------------------------------------------------
-- RLS das salas: leitura para qualquer usuário autenticado (é config, não dado
-- de paciente); escrita para Admin Master OU Gerente daquela unidade.
-- -----------------------------------------------------------------------------
drop policy if exists "clinic_rooms_select" on public.clinic_rooms;
create policy "clinic_rooms_select" on public.clinic_rooms
  for select to authenticated using (true);

drop policy if exists "clinic_rooms_write" on public.clinic_rooms;
create policy "clinic_rooms_write" on public.clinic_rooms
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
  );

-- -----------------------------------------------------------------------------
-- A configuração da agenda passa a poder ser editada pela Gerente da unidade
-- (apenas a da própria unidade; o padrão da rede continua só Admin Master).
-- -----------------------------------------------------------------------------
drop policy if exists "clinic_agenda_settings_write" on public.clinic_agenda_settings;
create policy "clinic_agenda_settings_write" on public.clinic_agenda_settings
  for all to authenticated
  using (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
  )
  with check (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
  );

-- -----------------------------------------------------------------------------
-- Semeia salas a partir do nº de cadeiras já existente, para nada quebrar:
-- cada unidade ativa que ainda não tem salas recebe "Sala 1..N", onde N é o
-- nº de cadeiras da unidade (ou o padrão da rede, ou 3).
-- -----------------------------------------------------------------------------
do $$
declare
  net_chairs integer;
  s record;
  n integer;
  i integer;
begin
  select chairs into net_chairs
  from public.clinic_agenda_settings where clinic_id is null;
  net_chairs := greatest(coalesce(net_chairs, 3), 1);

  for s in
    select c.id as clinic_id
    from public.clinics c
    where c.type = 'franchise_unit' and c.is_active
      and not exists (
        select 1 from public.clinic_rooms r where r.clinic_id = c.id
      )
  loop
    select greatest(coalesce(cas.chairs, net_chairs), 1) into n
    from public.clinic_agenda_settings cas
    where cas.clinic_id = s.clinic_id;
    if n is null then n := net_chairs; end if;

    for i in 1..n loop
      insert into public.clinic_rooms (clinic_id, name, sort_order)
      values (s.clinic_id, 'Sala ' || i, i);
    end loop;
  end loop;
end $$;
