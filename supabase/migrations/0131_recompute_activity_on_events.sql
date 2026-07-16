-- =============================================================================
-- 0131 — Correção: recalcular ATIVO/INATIVO na hora (não só no cron diário)
-- -----------------------------------------------------------------------------
-- O status ativo/inativo (regra da 0020) só era recalculado por um cron diário
-- (3h) — e o pg_cron pode não estar ligado. Resultado: mover o cliente de fase
-- ou agendar um atendimento NÃO atualizava o status na hora. Agora recalculamos
-- o cliente imediatamente por gatilho: (1) quando muda de fase; (2) quando um
-- atendimento é criado/alterado/removido. Também recalcula todos uma vez ao
-- aplicar. Idempotente.
-- =============================================================================

-- Recalcula ativo/inativo de UM cliente (mesma regra da recompute_client_activity).
create or replace function public.recompute_client_activity_one(p_client_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clients c
  set status = case when (
    case c.journey_phase
      when 'acquisition' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase1_max_days')
      when 'clinical_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase2_max_days')
      when 'commercial_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase4_max_days')
      when 'treatment_start' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'reevaluation' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'planning_center' then
        coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a
             where a.client_id = c.id
               and (a.status = 'completed' or a.attendance = 'done')),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'no_attendance_days')
      when 'follow_up' then
        coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'phase7_inactivity_days')
      else false
    end
  ) then 'inactive'::public.client_status
    else 'active'::public.client_status end
  where c.id = p_client_id
    and c.status <> 'anonymized';
$$;

-- (1) Cliente mudou de fase → recalcula. O gatilho dispara SÓ quando muda
-- journey_phase/phase_entered_at; o recálculo altera apenas `status`, então não
-- re-dispara (sem recursão).
create or replace function public.trg_recompute_activity_on_phase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_client_activity_one(new.id);
  return null;
end;
$$;

drop trigger if exists clients_recompute_activity on public.clients;
create trigger clients_recompute_activity
  after update of journey_phase, phase_entered_at on public.clients
  for each row execute function public.trg_recompute_activity_on_phase();

-- (2) Atendimento criado/alterado/removido → recalcula o cliente afetado
-- (essencial em Início de Tratamento/Reavaliação: atendimento futuro = ativo).
create or replace function public.trg_recompute_activity_on_appt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_client_activity_one(
    coalesce(new.client_id, old.client_id)
  );
  return null;
end;
$$;

drop trigger if exists appointments_recompute_activity on public.appointments;
create trigger appointments_recompute_activity
  after insert or update or delete on public.appointments
  for each row execute function public.trg_recompute_activity_on_appt();

-- Corrige todos os clientes agora (sincroniza o que estava desatualizado).
select public.recompute_client_activity();
