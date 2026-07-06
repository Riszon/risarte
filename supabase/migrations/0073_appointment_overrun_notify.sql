-- =============================================================================
-- 0073 — Aviso de atendimento fora do horário (Ajuste pré-Grupo 4 #2 / AJ2)
-- -----------------------------------------------------------------------------
-- Agora o agendamento é PERMITIDO quando começa dentro do horário mas termina
-- depois do fechamento, ou avança sobre o almoço. Quem agenda recebe um alerta
-- na hora (retornado pela action → toast). O PROFISSIONAL do atendimento recebe
-- uma notificação persistente avisando que aquele atendimento extrapola o
-- horário normal da unidade. Como notifications não tem policy de insert, o
-- aviso é criado por esta função security-definer. Idempotente (create or replace).
-- =============================================================================

create or replace function public.notify_appointment_overrun(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider uuid;
  v_clinic uuid;
  v_created_by uuid;
  v_client uuid;
  v_starts timestamptz;
  v_ends timestamptz;
  v_client_name text;
  v_clinic_name text;
  v_when text;
  v_uid uuid := (select auth.uid());
begin
  select a.provider_user_id, a.clinic_id, a.created_by, a.client_id,
         a.starts_at, a.ends_at
    into v_provider, v_clinic, v_created_by, v_client, v_starts, v_ends
  from public.appointments a where a.id = p_appointment_id;

  if v_clinic is null then return; end if;

  -- Só quem tem relação com o agendamento/unidade pode disparar o aviso.
  if not (
    public.is_admin_master()
    or v_created_by = v_uid
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.user_id = v_uid
    )
    or v_clinic in (select public.user_full_access_clinic_ids())
  ) then
    return;
  end if;

  -- Sem profissional definido não há quem avisar.
  if v_provider is null then return; end if;

  select full_name into v_client_name from public.clients where id = v_client;
  select name into v_clinic_name from public.clinics where id = v_clinic;

  v_when := to_char(v_starts at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24":"MI')
    || '–' || to_char(v_ends at time zone 'America/Sao_Paulo', 'HH24":"MI');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  values (
    v_provider, v_clinic,
    'Atendimento fora do horário normal',
    coalesce(v_client_name, 'Cliente') || ' — ' || v_when
      || coalesce(' na ' || v_clinic_name, '')
      || '. Este atendimento passa do horário normal de atendimento da unidade.',
    '/agenda?vista=dia&ref='
      || to_char(v_starts at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
  );
end;
$$;

grant execute on function public.notify_appointment_overrun(uuid) to authenticated;
