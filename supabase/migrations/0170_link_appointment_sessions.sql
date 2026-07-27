-- =============================================================================
-- 0170 — I1: sessão já agendada não pode ser agendada de novo
-- -----------------------------------------------------------------------------
-- PROBLEMA (relatado no teste): ao agendar as sessões que faltam, as sessões
-- que JÁ tinham atendimento marcado continuavam aparecendo no formulário e
-- podiam ser agendadas outra vez.
--
-- CAUSA: quem agenda pode ser a RECEPÇÃO **ou a SDR** (e o gerente, pelo escopo
-- da unidade), mas a política de escrita de `treatment_sessions` (migração
-- 0058) só libera recepção, coordenador e dentista. Quando a SDR agendava, o
-- `update ... set status = 'scheduled'` era barrado em silêncio pela RLS: a
-- sessão continuava "a agendar" e voltava para a lista do formulário.
--
-- SOLUÇÃO: o vínculo passa a ser feito por uma função SECURITY DEFINER estreita
-- (só mexe em status/appointment_id), que autoriza pela MESMA regra de quem
-- pode mexer no agendamento e **recusa** vincular uma sessão que já pertence a
-- outro atendimento vivo. Inclui reparo dos dados que ficaram inconsistentes.
-- Idempotente.
-- =============================================================================

-- 1) Vincular/desvincular as sessões de um agendamento -----------------------
create or replace function public.link_appointment_sessions(
  p_appointment_id uuid,
  p_session_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_created_by uuid;
  v_ids uuid[] := coalesce(p_session_ids, array[]::uuid[]);
  v_busy int;
begin
  select clinic_id, client_id, created_by
    into v_clinic, v_client, v_created_by
  from public.appointments
  where id = p_appointment_id;

  if v_clinic is null then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  -- Mesma régua de quem pode criar/alterar o agendamento (migração 0016),
  -- somada a quem tem acesso pleno à unidade (gerente/franqueadora/admin).
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

  -- Sessão pedida que já está presa a OUTRO atendimento (não concluído) =
  -- agendamento em duplicidade. Recusa antes de mexer em qualquer coisa.
  select count(*) into v_busy
  from public.treatment_sessions ts
  where ts.id = any (v_ids)
    and ts.appointment_id is not null
    and ts.appointment_id <> p_appointment_id;

  if v_busy > 0 then
    raise exception 'SESSION_ALREADY_SCHEDULED';
  end if;

  -- Desmarcadas voltam para "a agendar".
  update public.treatment_sessions
     set status = 'pending', appointment_id = null
   where appointment_id = p_appointment_id
     and status <> 'done'
     and not (id = any (v_ids));

  -- Marcadas ficam vinculadas (só as do mesmo cliente e não concluídas).
  if array_length(v_ids, 1) is not null then
    update public.treatment_sessions
       set status = 'scheduled', appointment_id = p_appointment_id
     where id = any (v_ids)
       and client_id = v_client
       and status <> 'done';
  end if;

  -- Referência principal do agendamento (primeira sessão da lista).
  update public.appointments
     set treatment_session_id = (
       select ts.id from public.treatment_sessions ts
        where ts.appointment_id = p_appointment_id
          and ts.status <> 'done'
        order by ts.plan_order nulls last, ts.created_at
        limit 1
     )
   where id = p_appointment_id;
end;
$$;

grant execute on function public.link_appointment_sessions(uuid, uuid[])
  to authenticated;

-- 2) Reparo dos dados que ficaram inconsistentes ------------------------------
do $$
begin
  -- (a) Sessão presa a um agendamento cancelado/falta → volta para "a agendar".
  update public.treatment_sessions ts
     set status = 'pending', appointment_id = null
   where ts.appointment_id is not null
     and ts.status <> 'done'
     and exists (
       select 1 from public.appointments a
        where a.id = ts.appointment_id
          and a.status in ('cancelled','no_show')
     );

  -- (b) Sessão vinculada a um agendamento vivo mas ainda marcada como
  --     "a agendar" (o caso da SDR barrada pela RLS) → passa a "agendada".
  update public.treatment_sessions ts
     set status = 'scheduled'
   where ts.appointment_id is not null
     and ts.status = 'pending'
     and exists (
       select 1 from public.appointments a
        where a.id = ts.appointment_id
          and a.status not in ('cancelled','no_show')
     );

  -- (c) Sessão "agendada" sem agendamento nenhum → volta para "a agendar".
  update public.treatment_sessions
     set status = 'pending'
   where status = 'scheduled'
     and appointment_id is null;
exception when others then
  raise notice 'Reparo das sessões ignorado: %', sqlerrm;
end $$;
