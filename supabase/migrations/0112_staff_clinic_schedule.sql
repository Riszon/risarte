-- =============================================================================
-- 0112 — Dias prioritários do dentista por unidade (H4.6 E1)
-- -----------------------------------------------------------------------------
-- Para cada Risartano (dentista) e cada unidade em que atende, quais são os dias
-- de atendimento ali: dias da semana (0=Dom … 6=Sáb) + datas específicas + nota.
-- Usado para (E2) avisar conflito entre unidades no agendamento e (E4) a previsão
-- semanal. Escrita: Admin + Gerente/Franqueado da unidade. Leitura: equipe da
-- unidade (a Recepção precisa ver ao agendar). Idempotente.
-- =============================================================================

create table if not exists public.staff_clinic_schedule (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  weekdays int[] not null default '{}',        -- 0=Dom … 6=Sáb
  specific_dates date[] not null default '{}',
  note text,
  updated_at timestamptz not null default now(),
  unique (staff_member_id, clinic_id)
);
create index if not exists staff_clinic_schedule_clinic_idx
  on public.staff_clinic_schedule (clinic_id);
alter table public.staff_clinic_schedule enable row level security;

-- Leitura ampla (não é dado sensível): equipe da unidade + Planner + escopo/Admin.
drop policy if exists "staff_clinic_schedule_select" on public.staff_clinic_schedule;
create policy "staff_clinic_schedule_select" on public.staff_clinic_schedule
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_planner()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(clinic_id, array['receptionist','sdr','dentist','clinical_coordinator','unit_manager','franchisee']::public.user_role[])
  );

-- Escrita: Admin + Gerente/Franqueado da unidade.
drop policy if exists "staff_clinic_schedule_write" on public.staff_clinic_schedule;
create policy "staff_clinic_schedule_write" on public.staff_clinic_schedule
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager','franchisee']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager','franchisee']::public.user_role[])
  );
