-- =============================================================================
-- Risarte Odontologia — Migration 0043 (LOTE B — B2/B3: config da agenda)
-- Horário de funcionamento, dias de atendimento e nº de cadeiras por unidade,
-- no padrão cascata (linha com clinic_id NULL = padrão da rede; linha com
-- clinic_id sobrescreve aquela unidade). A validação (fora do horário / dia
-- fechado / cadeiras lotadas) é aplicada no app ao agendar.
-- weekdays: 0 = domingo … 6 = sábado. Idempotente.
-- =============================================================================

create table if not exists public.clinic_agenda_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete cascade,
  open_time time not null default '08:00',
  close_time time not null default '18:00',
  weekdays smallint[] not null default '{1,2,3,4,5,6}',
  chairs smallint not null default 3,
  updated_at timestamptz not null default now()
);
create unique index if not exists clinic_agenda_settings_clinic_key
  on public.clinic_agenda_settings (clinic_id) nulls not distinct;
alter table public.clinic_agenda_settings enable row level security;

-- Leitura para qualquer usuário autenticado (é config, não dado de paciente);
-- escrita só Admin Master.
drop policy if exists "clinic_agenda_settings_select" on public.clinic_agenda_settings;
create policy "clinic_agenda_settings_select" on public.clinic_agenda_settings
  for select to authenticated using (true);

drop policy if exists "clinic_agenda_settings_write" on public.clinic_agenda_settings;
create policy "clinic_agenda_settings_write" on public.clinic_agenda_settings
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Padrão da rede (clinic_id NULL).
insert into public.clinic_agenda_settings (clinic_id)
values (null)
on conflict (clinic_id) do nothing;
