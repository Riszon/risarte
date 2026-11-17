-- =============================================================================
-- 0424 — VENDA DIRETA V3, VD3-4: O ENCAIXE E A SALA ESCOLHIDA AO CHAMAR
--
-- Decisões do dono (17/11/2026, docs/comercial/VENDA-DIRETA-V3-PLANO.md §9):
--   A1 — o "Atender agora" do caixa agenda como ENCAIXE, enquadrado como
--        Avaliação ou Urgência. Até aqui "encaixe" era só o TIPO Urgência ou
--        Emergência; agora é também uma MARCA do agendamento (`is_fit_in`).
--   A4 — o encaixe sem cadeira livre fica SEM SALA até o dentista chamar; ao
--        chamar um atendimento presencial sem sala, o dentista ESCOLHE a sala
--        (obrigatório) — para não travar o encaixe nem mexer em outros
--        horários.
--
-- O que muda:
--   1) `appointments.is_fit_in` (padrão falso: nada muda no que já existe);
--   2) `check_appointment_conflict`: o encaixe (urgência, emergência OU a
--      marca) passa pelo conflito de horário do profissional e da sala — a
--      mesma regra da 0362, com a marca somada;
--   3) `update_attendance` (chamar): atendimento PRESENCIAL sem sala, numa
--      unidade com sala ativa, é recusado (ROOM_REQUIRED). Unidade sem sala
--      cadastrada continua como antes;
--   4) `call_attendance_with_room`: grava a sala escolhida e chama, numa
--      transação; a sala já ocupada por atendimento em curso é recusada
--      (ROOM_BUSY), como no chamar de sempre.
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- 1) A marca ---------------------------------------------------------------------
alter table public.appointments add column if not exists is_fit_in boolean not null default false;
comment on column public.appointments.is_fit_in is
  'VD3-4 (0424): ENCAIXE — agendado por cima da agenda (o "Atender agora" do caixa da venda direta). Passa pelo conflito de horário do profissional e da sala, como Urgência/Emergência. Pode ficar sem sala: o dentista escolhe ao chamar.';

-- 2) O conflito -------------------------------------------------------------------
-- A mesma função da 0362; a única troca é o que conta como encaixe.
create or replace function public.check_appointment_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_encaixe boolean := new.type in ('urgency', 'emergency') or coalesce(new.is_fit_in, false);
begin
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  -- Alteração que não mexe em horário, profissional, cliente nem sala não
  -- precisa conferir nada (nem esperar lock nenhum).
  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and new.provider_user_id is not distinct from old.provider_user_id
     and new.client_id = old.client_id
     and new.room_id is not distinct from old.room_id then
    return new;
  end if;

  -- AP103: serializa quem agenda a mesma pessoa, o mesmo profissional e a
  -- mesma sala, em ordem fixa (cliente → profissional → sala).
  perform pg_advisory_xact_lock(hashtext('appt:client:' || new.client_id::text));
  if new.provider_user_id is not null then
    perform pg_advisory_xact_lock(hashtext('appt:provider:' || new.provider_user_id::text));
  end if;
  if new.room_id is not null then
    perform pg_advisory_xact_lock(hashtext('appt:room:' || new.room_id::text));
  end if;

  if exists (
    select 1 from public.appointments a
    where a.client_id = new.client_id
      and a.id <> new.id
      and a.status not in ('cancelled', 'no_show')
      and a.starts_at < new.ends_at
      and a.ends_at > new.starts_at
  ) then
    raise exception 'CLIENT_TIME_CONFLICT';
  end if;

  if new.provider_user_id is not null
     and not v_encaixe
     and exists (
       select 1 from public.appointments a
       where a.provider_user_id = new.provider_user_id
         and a.id <> new.id
         and a.status not in ('cancelled', 'no_show')
         and not (a.type in ('urgency', 'emergency') or a.is_fit_in)
         and a.starts_at < new.ends_at
         and a.ends_at > new.starts_at
     ) then
    raise exception 'PROVIDER_TIME_CONFLICT';
  end if;

  -- I2: o profissional também está ocupado quando entra como ADICIONAL.
  if new.provider_user_id is not null
     and not v_encaixe
     and exists (
       select 1
       from public.appointment_participants ap
       join public.appointments a on a.id = ap.appointment_id
       where ap.provider_user_id = new.provider_user_id
         and a.id <> new.id
         and a.status not in ('cancelled', 'no_show')
         and not (a.type in ('urgency', 'emergency') or a.is_fit_in)
         and a.starts_at < new.ends_at
         and a.ends_at > new.starts_at
     ) then
    raise exception 'PROVIDER_TIME_CONFLICT';
  end if;

  -- AP103 (2): a sala atende um cliente por vez. O encaixe passa.
  if new.room_id is not null
     and not v_encaixe
     and exists (
       select 1 from public.appointments a
       where a.room_id = new.room_id
         and a.id <> new.id
         and a.status not in ('cancelled', 'no_show')
         and not (a.type in ('urgency', 'emergency') or a.is_fit_in)
         and a.starts_at < new.ends_at
         and a.ends_at > new.starts_at
     ) then
    raise exception 'ROOM_TIME_CONFLICT';
  end if;

  return new;
end;
$$;
revoke execute on function public.check_appointment_conflict() from public, anon, authenticated;

drop trigger if exists appointments_conflict_check on public.appointments;
create trigger appointments_conflict_check
  before insert or update on public.appointments
  for each row execute function public.check_appointment_conflict();

-- 3) Chamar: a sala é obrigatória no presencial (unidade com sala) ---------------
-- A função como está no banco (0065, fechada sem login na 0379), com a
-- conferência da sala somada ao "in_service".
create or replace function public.update_attendance(p_appointment_id uuid, p_state public.attendance_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_provider uuid;
  v_room uuid;
  v_online boolean;
  v_called_by uuid;
  v_client uuid;
  v_attendance public.attendance_status;
  v_status public.journey_status;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  if p_state = 'waiting' then raise exception 'USE_CHECK_IN'; end if;

  select clinic_id, provider_user_id, room_id, is_online, called_by,
         client_id, attendance
    into v_clinic, v_provider, v_room, v_online, v_called_by,
         v_client, v_attendance
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if p_state = 'in_service' then
    -- H1.4: só o profissional do agendamento chama (Admin sempre pode).
    if not (
      public.is_admin_master()
      or v_provider = v_user
      or (
        v_provider is null
        and public.has_role_in_clinic(
          v_clinic,
          array['clinical_coordinator', 'dentist', 'commercial_consultant']::public.user_role[]
        )
      )
    ) then
      raise exception 'NOT_PROVIDER';
    end if;

    -- VD3-4 (0424, decisão A4): presencial sem sala, numa unidade com sala
    -- ativa → quem chama escolhe a sala antes (call_attendance_with_room).
    if v_room is null and not coalesce(v_online, false)
       and exists (select 1 from public.clinic_rooms r
                    where r.clinic_id = v_clinic and r.is_active and r.deleted_at is null) then
      raise exception 'ROOM_REQUIRED';
    end if;

    -- H1.3: o cliente não pode estar em dois lugares ao mesmo tempo.
    if exists (
      select 1 from public.appointments a
      where a.client_id = v_client
        and a.id <> p_appointment_id
        and a.attendance = 'in_service'
    ) then
      raise exception 'CLIENT_BUSY';
    end if;

    -- H3.4b: o profissional já está em atendimento não concluído (ocupado).
    if v_provider is not null and exists (
      select 1 from public.appointments a
      where a.provider_user_id = v_provider
        and a.id <> p_appointment_id
        and a.attendance = 'in_service'
    ) then
      raise exception 'PROVIDER_BUSY';
    end if;

    -- H3.4b: a sala/cadeira já está ocupada por um atendimento não concluído.
    if v_room is not null and not coalesce(v_online, false) and exists (
      select 1 from public.appointments a
      where a.room_id = v_room
        and a.id <> p_appointment_id
        and a.attendance = 'in_service'
    ) then
      raise exception 'ROOM_BUSY';
    end if;

    update public.appointments
    set attendance = 'in_service',
        called_by = v_user,
        called_at = coalesce(called_at, now())
    where id = p_appointment_id;

  elsif p_state = 'gave_up' then
    if not (
      public.is_admin_master()
      or v_provider = v_user
      or public.has_role_in_clinic(
        v_clinic,
        array['receptionist', 'clinical_coordinator', 'unit_manager']::public.user_role[]
      )
    ) then
      raise exception 'NOT_ALLOWED';
    end if;
    if v_attendance is distinct from 'waiting' then
      raise exception 'NOT_WAITING';
    end if;

    update public.appointments
    set attendance = 'gave_up', status = 'cancelled'
    where id = p_appointment_id;

    if v_provider is not null then
      select full_name into v_name from public.clients where id = v_client;
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (
        v_provider, v_clinic,
        'Cliente desistiu da espera',
        coalesce(v_name, 'Cliente') || ' desistiu de esperar e saiu da fila de atendimento.',
        '/atendimento'
      );
    end if;

  elsif p_state = 'done' then
    if not (
      public.is_admin_master()
      or v_called_by = v_user
      or (v_called_by is null and v_provider = v_user)
    ) then
      raise exception 'NOT_CALLER';
    end if;
    update public.appointments
    set attendance = 'done', status = 'completed',
        done_at = now(), done_by = v_user
    where id = p_appointment_id;

    perform public.settle_treatment_sessions(p_appointment_id);

    select journey_status, full_name into v_status, v_name
    from public.clients where id = v_client;
    if v_status = 'in_treatment' and not exists (
      select 1 from public.appointments a
      where a.client_id = v_client
        and a.type = 'treatment_session'
        and a.starts_at > now()
        and a.status in ('scheduled', 'confirmed')
    ) then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic,
             'Agendar próxima sessão de tratamento: ' || v_name,
             v_name || ' concluiu uma sessão e não tem a próxima agendada.',
             '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
    end if;
  end if;
end;
$$;
revoke execute on function public.update_attendance(uuid, public.attendance_status) from public, anon, authenticated;
grant execute on function public.update_attendance(uuid, public.attendance_status) to authenticated, service_role;

-- 4) Escolher a sala e chamar, juntos ----------------------------------------------
create or replace function public.call_attendance_with_room(p_appointment_id uuid, p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  -- Quem pode chamar (a mesma regra do chamar): o profissional, o Admin, ou
  -- sem profissional definido, quem atende na unidade.
  if not (
    public.is_admin_master()
    or v_appt.provider_user_id = v_user
    or (
      v_appt.provider_user_id is null
      and public.has_role_in_clinic(
        v_appt.clinic_id,
        array['clinical_coordinator', 'dentist', 'commercial_consultant']::public.user_role[]
      )
    )
  ) then
    raise exception 'NOT_PROVIDER';
  end if;
  if coalesce(v_appt.is_online, false) then raise exception 'ROOM_NOT_NEEDED'; end if;
  if not exists (select 1 from public.clinic_rooms r
                  where r.id = p_room_id and r.clinic_id = v_appt.clinic_id
                    and r.is_active and r.deleted_at is null) then
    raise exception 'ROOM_INVALID';
  end if;
  -- A sala com alguém em atendimento agora não serve (a regra do chamar).
  if exists (select 1 from public.appointments a
              where a.room_id = p_room_id and a.id <> p_appointment_id and a.attendance = 'in_service') then
    raise exception 'ROOM_BUSY';
  end if;

  update public.appointments set room_id = p_room_id, updated_at = now() where id = p_appointment_id;
  perform public.update_attendance(p_appointment_id, 'in_service');
end;
$$;
revoke execute on function public.call_attendance_with_room(uuid, uuid) from public, anon, authenticated;
grant execute on function public.call_attendance_with_room(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Conferência (rodar depois; esperado: 1 · true · true · 1 · false):
-- select
--   (select count(*) from information_schema.columns where table_schema = 'public'
--      and table_name = 'appointments' and column_name = 'is_fit_in') as marca,
--   position('is_fit_in' in pg_get_functiondef('public.check_appointment_conflict()'::regprocedure)) > 0 as conflito,
--   position('ROOM_REQUIRED' in pg_get_functiondef('public.update_attendance(uuid, public.attendance_status)'::regprocedure)) > 0 as sala_ao_chamar,
--   (select count(*) from pg_proc where proname = 'call_attendance_with_room') as chamar_com_sala,
--   has_function_privilege('anon', 'public.call_attendance_with_room(uuid, uuid)', 'execute') as chamar_sem_login;
