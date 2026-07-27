-- =============================================================================
-- 0171 — I2: atendimento conjunto (H4.7) — 4 correções
-- -----------------------------------------------------------------------------
-- PROBLEMAS relatados no teste:
--   1. o card do agendamento não mostrava os dentistas adicionais;
--   2. o atendimento não aparecia na agenda do dentista B — e a agenda dele
--      ainda aceitava OUTRO cliente no mesmo horário;
--   3. a notificação do B não dizia com quem é o atendimento conjunto;
--   4. "Minha agenda" não mostrava o parceiro nem a sala.
--
-- CAUSA de 1 e 2: a política de escrita de `appointment_participants` (0116) só
-- libera recepção, SDR e admin. Quando quem agenda é o COORDENADOR, o GERENTE
-- ou o dentista, o insert é barrado em silêncio: nenhum participante é gravado
-- (por isso o card fica vazio e a agenda do B não mostra nada), mas o aviso ao
-- B era disparado assim mesmo — daí a sensação de "notificou e sumiu".
-- E a trava de conflito (0029) só olhava `appointments.provider_user_id`, então
-- o profissional ADICIONAL continuava "livre" para receber outro agendamento.
--
-- SOLUÇÃO: gravar os participantes por função SECURITY DEFINER estreita, com a
-- mesma régua de quem pode agendar, recusando choque de horário; ensinar a trava
-- de conflito a enxergar os participantes; enriquecer o aviso e a agenda do
-- profissional. Idempotente.
-- =============================================================================

-- 1) Trava de conflito enxerga o profissional ADICIONAL -----------------------
create or replace function public.check_appointment_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and new.provider_user_id is not distinct from old.provider_user_id
     and new.client_id = old.client_id then
    return new;
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
     and new.type not in ('urgency', 'emergency')
     and exists (
       select 1 from public.appointments a
       where a.provider_user_id = new.provider_user_id
         and a.id <> new.id
         and a.status not in ('cancelled', 'no_show')
         and a.type not in ('urgency', 'emergency')
         and a.starts_at < new.ends_at
         and a.ends_at > new.starts_at
     ) then
    raise exception 'PROVIDER_TIME_CONFLICT';
  end if;

  -- I2: o profissional também está ocupado quando entra como ADICIONAL em
  -- outro atendimento no mesmo horário (antes, essa agenda ficava "livre").
  if new.provider_user_id is not null
     and new.type not in ('urgency', 'emergency')
     and exists (
       select 1
       from public.appointment_participants ap
       join public.appointments a on a.id = ap.appointment_id
       where ap.provider_user_id = new.provider_user_id
         and a.id <> new.id
         and a.status not in ('cancelled', 'no_show')
         and a.type not in ('urgency', 'emergency')
         and a.starts_at < new.ends_at
         and a.ends_at > new.starts_at
     ) then
    raise exception 'PROVIDER_TIME_CONFLICT';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_conflict_check on public.appointments;
create trigger appointments_conflict_check
  before insert or update on public.appointments
  for each row execute function public.check_appointment_conflict();

-- 2) Gravar os participantes por função (não pela RLS) ------------------------
-- Devolve os que foram INCLUÍDOS agora, para o aviso sair só para eles.
create or replace function public.set_appointment_participants(
  p_appointment_id uuid,
  p_provider_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_created_by uuid;
  v_starts timestamptz;
  v_ends timestamptz;
  v_type text;
  v_main uuid;
  v_ids uuid[];
  v_added uuid[] := array[]::uuid[];
  v_pid uuid;
  v_busy_name text;
begin
  select a.clinic_id, a.created_by, a.starts_at, a.ends_at, a.type::text,
         a.provider_user_id
    into v_clinic, v_created_by, v_starts, v_ends, v_type, v_main
  from public.appointments a
  where a.id = p_appointment_id;

  if v_clinic is null then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  if not (
    public.is_admin_master()
    or v_clinic in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(
         v_clinic,
         array['receptionist','clinical_coordinator','dentist']::public.user_role[]
       )
    or (public.is_sdr() and v_created_by = (select auth.uid()))
    or (public.is_sdr() and v_clinic in (select public.user_full_access_clinic_ids()))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- O responsável principal não entra como adicional dele mesmo.
  select coalesce(array_agg(distinct x), array[]::uuid[])
    into v_ids
  from unnest(coalesce(p_provider_ids, array[]::uuid[])) as x
  where x is not null and x is distinct from v_main;

  -- Choque de horário do profissional adicional (encaixe de urgência/
  -- emergência continua liberado, igual à regra do responsável principal).
  if v_type not in ('urgency', 'emergency') then
    foreach v_pid in array v_ids loop
      select p.full_name into v_busy_name
      from public.profiles p
      where p.id = v_pid
        and (
          exists (
            select 1 from public.appointments a
            where a.provider_user_id = v_pid
              and a.id <> p_appointment_id
              and a.status not in ('cancelled', 'no_show')
              and a.type not in ('urgency', 'emergency')
              and a.starts_at < v_ends
              and a.ends_at > v_starts
          )
          or exists (
            select 1
            from public.appointment_participants ap
            join public.appointments a2 on a2.id = ap.appointment_id
            where ap.provider_user_id = v_pid
              and a2.id <> p_appointment_id
              and a2.status not in ('cancelled', 'no_show')
              and a2.type not in ('urgency', 'emergency')
              and a2.starts_at < v_ends
              and a2.ends_at > v_starts
          )
        );
      if v_busy_name is not null then
        raise exception 'PARTICIPANT_TIME_CONFLICT: %', v_busy_name;
      end if;
    end loop;
  end if;

  -- Quem saiu.
  delete from public.appointment_participants ap
   where ap.appointment_id = p_appointment_id
     and not (ap.provider_user_id = any (v_ids));

  -- Quem entrou (só os que ainda não estavam).
  select coalesce(array_agg(x), array[]::uuid[])
    into v_added
  from unnest(v_ids) as x
  where not exists (
    select 1 from public.appointment_participants ap
    where ap.appointment_id = p_appointment_id
      and ap.provider_user_id = x
  );

  if array_length(v_added, 1) is not null then
    insert into public.appointment_participants
      (appointment_id, clinic_id, provider_user_id, created_by)
    select p_appointment_id, v_clinic, x, (select auth.uid())
      from unnest(v_added) as x
    on conflict (appointment_id, provider_user_id) do nothing;
  end if;

  return v_added;
end;
$$;

grant execute on function public.set_appointment_participants(uuid, uuid[])
  to authenticated;

-- 3) Aviso ao profissional adicional diz COM QUEM e ONDE ----------------------
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
  v_main_name text;
  v_room text;
  v_is_online boolean;
  v_caller uuid := (select auth.uid());
  v_pid uuid;
  v_others text;
begin
  if p_provider_ids is null or array_length(p_provider_ids, 1) is null then
    return;
  end if;

  select c.full_name, cl.name, a.clinic_id,
         to_char(a.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
         pm.full_name, r.name, a.is_online
    into v_client_name, v_clinic_name, v_clinic_id, v_when,
         v_main_name, v_room, v_is_online
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.clinics cl on cl.id = a.clinic_id
  left join public.profiles pm on pm.id = a.provider_user_id
  left join public.clinic_rooms r on r.id = a.room_id
  where a.id = p_appointment_id;

  if v_client_name is null then
    return;
  end if;

  -- Mesma régua de quem pode agendar (agora inclui coordenador, dentista e
  -- quem tem acesso pleno à unidade — antes o aviso morria em silêncio).
  if not (
    public.is_admin_master()
    or v_clinic_id in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(
         v_clinic_id,
         array['receptionist','clinical_coordinator','dentist']::public.user_role[]
       )
    or (public.is_sdr() and v_clinic_id in (select public.user_full_access_clinic_ids()))
  ) then
    return;
  end if;

  foreach v_pid in array p_provider_ids loop
    if v_pid is null or v_pid = v_caller then
      continue;
    end if;

    -- Os OUTROS profissionais do atendimento, do ponto de vista de quem recebe.
    select string_agg(nome, ', ' order by nome) into v_others
    from (
      select pm2.full_name as nome
        from public.appointment_participants ap
        join public.profiles pm2 on pm2.id = ap.provider_user_id
       where ap.appointment_id = p_appointment_id
         and ap.provider_user_id <> v_pid
    ) t;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (
      v_pid,
      v_clinic_id,
      'Atendimento conjunto',
      'Atendimento conjunto com '
        || coalesce(v_main_name, 'o responsável')
        || case when v_others is null or v_others = '' then ''
                else ' e ' || v_others end
        || ' · Paciente ' || v_client_name
        || ' · ' || v_when
        || ' · ' || v_clinic_name
        || case when v_is_online then ' · ONLINE'
                when v_room is not null then ' · Sala ' || v_room
                else '' end,
      '/minha-agenda'
    );
  end loop;
end;
$$;

grant execute on function public.notify_appointment_participants(uuid, uuid[])
  to authenticated;

-- 4) "Minha agenda" mostra o parceiro e a sala --------------------------------
drop function if exists public.provider_multi_unit_agenda(timestamptz, timestamptz);

create function public.provider_multi_unit_agenda(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  id uuid,
  clinic_id uuid,
  clinic_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  type text,
  status text,
  attendance text,
  client_id uuid,
  client_name text,
  role text,
  is_joint boolean,
  room_name text,
  is_online boolean,
  partners text
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.clinic_id, c.name, a.starts_at, a.ends_at,
         a.type::text, a.status::text, a.attendance::text,
         a.client_id, cl.full_name,
         case
           when a.provider_user_id = (select auth.uid()) then 'principal'
           else 'participante'
         end as role,
         exists (
           select 1 from public.appointment_participants ap2
           where ap2.appointment_id = a.id
         ) as is_joint,
         r.name as room_name,
         a.is_online,
         -- Todos os OUTROS profissionais do atendimento (principal + adicionais).
         (
           select string_agg(nome, ', ' order by nome)
           from (
             select pm.full_name as nome
               from public.profiles pm
              where pm.id = a.provider_user_id
                and pm.id <> (select auth.uid())
             union
             select pp.full_name
               from public.appointment_participants ap3
               join public.profiles pp on pp.id = ap3.provider_user_id
              where ap3.appointment_id = a.id
                and ap3.provider_user_id <> (select auth.uid())
           ) t
         ) as partners
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  left join public.clients cl on cl.id = a.client_id
  left join public.clinic_rooms r on r.id = a.room_id
  where a.starts_at >= p_from
    and a.starts_at < p_to
    and a.status not in ('cancelled', 'no_show')
    and (
      a.provider_user_id = (select auth.uid())
      or exists (
        select 1 from public.appointment_participants ap
        where ap.appointment_id = a.id
          and ap.provider_user_id = (select auth.uid())
      )
    )
  order by a.starts_at;
$$;

grant execute on function public.provider_multi_unit_agenda(timestamptz, timestamptz)
  to authenticated;
