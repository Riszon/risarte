-- H4.7 Bloco 1 — Atendimento conjunto (2+ profissionais no mesmo atendimento).
-- O "responsável principal" continua em appointments.provider_user_id; os
-- profissionais adicionais ficam aqui. Um cliente, uma sala, um horário, vários
-- profissionais. O limite (nº de cadeiras da unidade) é validado na aplicação.
-- -----------------------------------------------------------------------------

create table if not exists public.appointment_participants (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  -- Denormalizado do agendamento para escopar a RLS sem subconsulta recursiva.
  clinic_id uuid not null references public.clinics (id),
  provider_user_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (appointment_id, provider_user_id)
);

create index if not exists appointment_participants_appt_idx
  on public.appointment_participants (appointment_id);
create index if not exists appointment_participants_provider_idx
  on public.appointment_participants (provider_user_id, clinic_id);

alter table public.appointment_participants enable row level security;

-- SELECT: espelha appointments — Admin, quem tem acesso pleno à unidade, o
-- próprio participante, ou o responsável principal do agendamento.
drop policy if exists "appt_participants_select" on public.appointment_participants;
create policy "appt_participants_select"
  on public.appointment_participants for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or provider_user_id = (select auth.uid())
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.provider_user_id = (select auth.uid())
    )
  );

-- INSERT/UPDATE/DELETE: quem agenda na unidade (mesma regra de appointments).
drop policy if exists "appt_participants_insert" on public.appointment_participants;
create policy "appt_participants_insert"
  on public.appointment_participants for insert
  to authenticated
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

drop policy if exists "appt_participants_delete" on public.appointment_participants;
create policy "appt_participants_delete"
  on public.appointment_participants for delete
  to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

-- -----------------------------------------------------------------------------
-- Notifica os profissionais recém-incluídos num atendimento conjunto.
-- SECURITY DEFINER porque notifications não tem policy de insert (avisos entre
-- usuários passam por RPC). Guarda: só quem pode agendar na unidade dispara.
-- -----------------------------------------------------------------------------
create or replace function public.notify_appointment_participants(
  p_appointment_id uuid,
  p_provider_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_name text;
  v_clinic_name text;
  v_clinic_id uuid;
  v_when text;
  v_caller uuid := (select auth.uid());
  v_pid uuid;
begin
  if p_provider_ids is null or array_length(p_provider_ids, 1) is null then
    return;
  end if;

  select c.full_name, cl.name, a.clinic_id,
         to_char(a.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
    into v_client_name, v_clinic_name, v_clinic_id, v_when
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.clinics cl on cl.id = a.clinic_id
  where a.id = p_appointment_id;

  if v_client_name is null then
    return;
  end if;

  -- Só quem pode agendar naquela unidade dispara o aviso.
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic_id, array['receptionist']::public.user_role[])
    or (public.is_sdr() and v_clinic_id in (select public.user_full_access_clinic_ids()))
  ) then
    return;
  end if;

  foreach v_pid in array p_provider_ids loop
    if v_pid is null or v_pid = v_caller then
      continue; -- não notifica quem está agendando
    end if;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (
      v_pid,
      v_clinic_id,
      'Atendimento conjunto',
      'Você foi incluído no atendimento de ' || v_client_name || ' · '
        || v_clinic_name || ' · ' || v_when,
      '/agenda'
    );
  end loop;
end;
$$;

grant execute on function public.notify_appointment_participants(uuid, uuid[]) to authenticated;
