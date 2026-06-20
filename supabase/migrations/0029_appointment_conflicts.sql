-- =============================================================================
-- Risarte Odontologia — Migration 0029 (LOTE E — E3 Agendamento)
-- Trava de conflito de horário:
--   - o MESMO cliente não pode ter 2 agendamentos no mesmo horário;
--   - o MESMO profissional não pode ter 2 agendamentos no mesmo horário
--     (exceto Urgência/Emergência, que permitem encaixe).
-- Cancelados/faltas não contam. Na edição, só checa se mudou horário/
-- profissional/cliente (atualizar status/atendimento não dispara a trava).
-- Idempotente.
-- =============================================================================

create or replace function public.check_appointment_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Cancelado / faltou não ocupa horário.
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  -- Na edição, só revalida se algo relevante ao horário mudou.
  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and new.provider_user_id is not distinct from old.provider_user_id
     and new.client_id = old.client_id then
    return new;
  end if;

  -- Mesmo cliente em dois lugares ao mesmo tempo.
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

  -- Mesmo profissional com dois clientes no mesmo horário (encaixe de
  -- Urgência/Emergência é permitido: não bloqueia).
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

  return new;
end;
$$;

drop trigger if exists appointments_conflict_check on public.appointments;
create trigger appointments_conflict_check
  before insert or update on public.appointments
  for each row execute function public.check_appointment_conflict();
