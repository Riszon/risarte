-- =============================================================================
-- 0113 — Aviso de conflito entre unidades no agendamento (H4.6 E2)
-- -----------------------------------------------------------------------------
-- Ao agendar um dentista, avisar (aviso forte, NÃO bloqueia) se ele já tem
-- atendimento em OUTRA unidade no mesmo dia — para a Recepção (na hora) e para o
-- Dentista (notificação). Como a Recepção não enxerga agendamentos de outras
-- unidades pela RLS normal, as duas checagens usam RPC SECURITY DEFINER.
-- Também informa se o dia é/ não é dia de atendimento do dentista naquela unidade
-- (config E1, staff_clinic_schedule). Idempotente.
-- =============================================================================

-- Checagem na hora do agendamento (para o formulário da Recepção).
create or replace function public.provider_cross_unit_check(
  p_provider uuid,
  p_clinic uuid,
  p_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_others jsonb;
  v_staff uuid;
  v_wd int := extract(dow from p_date)::int;   -- 0=Dom … 6=Sáb
  v_known boolean := false;
  v_priority boolean := false;
begin
  if (select auth.uid()) is null then return '{}'::jsonb; end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('clinic', c.name, 'time', to_char(a.starts_at, 'HH24:MI'))
             order by a.starts_at
           ),
           '[]'::jsonb
         )
    into v_others
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  where a.provider_user_id = p_provider
    and a.clinic_id <> p_clinic
    and a.starts_at >= p_date::timestamp
    and a.starts_at < (p_date + 1)::timestamp
    and a.status in ('scheduled', 'confirmed', 'completed');

  select sm.id into v_staff
  from public.staff_members sm
  where sm.user_id = p_provider
  limit 1;

  if v_staff is not null then
    select true, (v_wd = any (s.weekdays) or p_date = any (s.specific_dates))
      into v_known, v_priority
    from public.staff_clinic_schedule s
    where s.staff_member_id = v_staff and s.clinic_id = p_clinic;
    if not found then
      v_known := false;
      v_priority := false;
    end if;
  end if;

  return jsonb_build_object(
    'otherUnits', coalesce(v_others, '[]'::jsonb),
    'scheduleKnown', coalesce(v_known, false),
    'isPriorityDay', coalesce(v_priority, false)
  );
end;
$$;

grant execute on function public.provider_cross_unit_check(uuid, uuid, date) to authenticated;

-- Depois de agendar: se o dentista ficou com atendimento em mais de uma unidade
-- neste dia, avisa-o (deduplicado por dia/data).
create or replace function public.notify_provider_cross_unit(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider uuid;
  v_clinic uuid;
  v_date date;
  v_count int;
  v_names text;
  v_title text;
begin
  select provider_user_id, clinic_id, starts_at::date
    into v_provider, v_clinic, v_date
  from public.appointments where id = p_appointment_id;
  if v_provider is null then return; end if;

  select count(*), string_agg(distinct c.name, ', ')
    into v_count, v_names
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  where a.provider_user_id = v_provider
    and a.clinic_id <> v_clinic
    and a.starts_at >= v_date::timestamp
    and a.starts_at < (v_date + 1)::timestamp
    and a.status in ('scheduled', 'confirmed', 'completed');
  if coalesce(v_count, 0) = 0 then return; end if;

  v_title := 'Atendimentos em mais de uma unidade em ' || to_char(v_date, 'DD/MM');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select v_provider, v_clinic, v_title,
         'Você tem atendimentos em outra(s) unidade(s) neste dia: ' || v_names
           || '. Confira se consegue atender em todas.',
         '/agenda'
  where not exists (
    select 1 from public.notifications n
    where n.user_id = v_provider
      and n.title = v_title
      and n.created_at >= current_date
  );
end;
$$;

grant execute on function public.notify_provider_cross_unit(uuid) to authenticated;
