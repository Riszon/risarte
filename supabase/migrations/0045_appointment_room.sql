-- =============================================================================
-- Risarte Odontologia — Migration 0045 (LOTE G — G2: agendar com sala)
-- O agendamento passa a ter SALA (cadeira) e marca atendimentos ONLINE (quando
-- o profissional é o Consultor Comercial — apresentação comercial). A regra de
-- ocupação passa a ser POR SALA (uma sala atende um cliente por vez); a checagem
-- continua no app (Urgência/Emergência seguem livres para encaixe).
-- Idempotente.
-- =============================================================================

alter table public.appointments
  add column if not exists room_id uuid
    references public.clinic_rooms (id) on delete set null,
  add column if not exists is_online boolean not null default false;

create index if not exists appointments_room_idx
  on public.appointments (room_id, starts_at);
