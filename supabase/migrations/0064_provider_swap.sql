-- =============================================================================
-- 0064 — Troca de profissional de última hora (LOTE H3: item H3.6)
-- -----------------------------------------------------------------------------
-- No check-in / sala de espera, a Recepção ou a Gerente (ou Admin) pode trocar
-- o profissional do atendimento (imprevisto de última hora). Tudo fica
-- registrado (appointment_provider_swaps); notifica o profissional anterior, o
-- novo profissional, o Coordenador Clínico e a Gerente da unidade. Se as trocas
-- ficarem frequentes no mês, um alerta extra vai para Coordenador/Gerente.
-- Idempotente.
-- =============================================================================

create table if not exists public.appointment_provider_swaps (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  from_provider uuid references public.profiles (id),
  to_provider uuid not null references public.profiles (id),
  reason text,
  swapped_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists app_provider_swaps_clinic_idx
  on public.appointment_provider_swaps (clinic_id, created_at);

alter table public.appointment_provider_swaps enable row level security;

drop policy if exists "provider_swaps_select" on public.appointment_provider_swaps;
create policy "provider_swaps_select" on public.appointment_provider_swaps
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(
      clinic_id,
      array['receptionist', 'clinical_coordinator', 'unit_manager', 'dentist']::public.user_role[]
    )
  );

-- Quantas trocas no mês corrente disparam o alerta de "frequência".
-- (Fixo por ora; pode virar configurável depois.)
-- -----------------------------------------------------------------------------
create or replace function public.swap_appointment_provider(
  p_appointment_id uuid,
  p_new_provider uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_old uuid;
  v_attendance public.attendance_status;
  v_status public.appointment_status;
  v_starts timestamptz;
  v_client uuid;
  v_client_name text;
  v_new_name text;
  v_old_name text;
  v_user uuid := (select auth.uid());
  v_month_count int;
  v_freq_threshold int := 5;
begin
  select clinic_id, provider_user_id, attendance, status, starts_at, client_id
    into v_clinic, v_old, v_attendance, v_status, v_starts, v_client
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  -- Permissão: Recepção ou Gerente da unidade (ou Admin).
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
      v_clinic,
      array['receptionist', 'unit_manager']::public.user_role[]
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_new_provider is null then raise exception 'NO_PROVIDER'; end if;
  if p_new_provider = v_old then raise exception 'SAME_PROVIDER'; end if;
  if v_status in ('cancelled', 'no_show') or v_attendance in ('done', 'gave_up') then
    raise exception 'NOT_SWAPPABLE';
  end if;

  -- Aplica a troca (o trigger de conflito valida o horário do novo profissional).
  update public.appointments
  set provider_user_id = p_new_provider
  where id = p_appointment_id;

  insert into public.appointment_provider_swaps
    (appointment_id, clinic_id, from_provider, to_provider, reason, swapped_by)
  values (p_appointment_id, v_clinic, v_old, p_new_provider, p_reason, v_user);

  select full_name into v_client_name from public.clients where id = v_client;
  select full_name into v_new_name from public.profiles where id = p_new_provider;
  select full_name into v_old_name from public.profiles where id = v_old;

  -- Notifica o profissional anterior.
  if v_old is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (
      v_old, v_clinic,
      'Você saiu de um atendimento',
      'O atendimento de ' || coalesce(v_client_name, 'um cliente') ||
        ' às ' || to_char(v_starts at time zone 'America/Sao_Paulo', 'HH24:MI') ||
        ' foi remanejado para ' || coalesce(v_new_name, 'outro profissional') || '.',
      '/atendimento'
    );
  end if;

  -- Notifica o novo profissional.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  values (
    p_new_provider, v_clinic,
    'Você assumiu um atendimento',
    'Você foi designado para o atendimento de ' ||
      coalesce(v_client_name, 'um cliente') || ' às ' ||
      to_char(v_starts at time zone 'America/Sao_Paulo', 'HH24:MI') || '.',
    '/atendimento'
  );

  -- Notifica Coordenador Clínico e Gerente da unidade (registro/relatório).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic,
         'Troca de profissional no atendimento',
         coalesce(v_client_name, 'Um cliente') || ': ' ||
           coalesce(v_old_name, 'sem profissional') || ' → ' ||
           coalesce(v_new_name, 'novo profissional') ||
           coalesce(' (' || nullif(btrim(p_reason), '') || ')', '') || '.',
         '/atendimento'
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic
    and ucr.role in ('clinical_coordinator', 'unit_manager')
    and ucr.user_id <> v_user;

  -- Alerta de frequência: muitas trocas no mês corrente.
  select count(*) into v_month_count
  from public.appointment_provider_swaps s
  where s.clinic_id = v_clinic
    and (s.created_at at time zone 'America/Sao_Paulo')
        >= date_trunc('month', now() at time zone 'America/Sao_Paulo');
  if v_month_count >= v_freq_threshold then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
           'Trocas de profissional frequentes',
           'Já são ' || v_month_count ||
             ' trocas de profissional neste mês nesta unidade. Verifique a causa.',
           '/atendimento'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('clinical_coordinator', 'unit_manager');
  end if;
end;
$$;

grant execute on function public.swap_appointment_provider(uuid, uuid, text) to authenticated;
