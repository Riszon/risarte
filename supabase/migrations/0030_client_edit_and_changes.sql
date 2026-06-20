-- =============================================================================
-- Risarte Odontologia — Migration 0030 (LOTE E — E4)
--   - A SDR (com acesso à unidade) pode EDITAR os dados de clientes da unidade
--     (antes só quem tinha papel NA clínica do cliente).
--   - client_changes: histórico visível das alterações cadastrais (quem, quando,
--     quais campos). LGPD: guarda os CAMPOS alterados, não os valores.
-- Idempotente.
-- =============================================================================

-- 1) UPDATE de clientes: recepcionista da unidade, SDR-com-acesso, ou Admin.
drop policy if exists "clients_update_receptionist" on public.clients;
create policy "clients_update_receptionist"
  on public.clients for update
  to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and clinic_id in (select public.user_full_access_clinic_ids()))
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

-- 2) Histórico de alterações cadastrais.
create table if not exists public.client_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  fields text not null  -- rótulos dos campos alterados, ex.: "Telefone, E-mail"
);
create index if not exists client_changes_client_idx
  on public.client_changes (client_id);
alter table public.client_changes enable row level security;

drop policy if exists "client_changes_select" on public.client_changes;
create policy "client_changes_select" on public.client_changes
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
  );

drop policy if exists "client_changes_insert" on public.client_changes;
create policy "client_changes_insert" on public.client_changes
  for insert to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and clinic_id in (select public.user_full_access_clinic_ids()))
  );
