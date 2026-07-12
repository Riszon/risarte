-- =============================================================================
-- 0110 — Definições de status consistentes (H4.14)
-- -----------------------------------------------------------------------------
-- Regra do dono: na Fase 5, "Início de Tratamento" = plano aprovado e nada
-- executado; passa a "Em Tratamento" assim que a 1ª sessão é executada. O
-- gatilho da 0017 já define "Aguardando Iniciar Tratamento" ao ENTRAR na fase;
-- aqui fechamos o outro lado: ao dar baixa (status -> 'done') na primeira sessão,
-- o cliente vira 'in_treatment' automaticamente — refletindo igual em Jornada,
-- Agenda e ficha, sem ninguém precisar marcar à mão. Cobre todos os caminhos de
-- baixa (settle_treatment_sessions e conclude_attendance_partial). Idempotente.
-- =============================================================================

create or replace function public.trg_mark_in_treatment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    update public.clients
    set journey_status = 'in_treatment'
    where id = new.client_id
      and journey_phase = 'treatment_start'
      and journey_status = 'awaiting_treatment_start';
  end if;
  return new;
end;
$$;

drop trigger if exists mark_in_treatment on public.treatment_sessions;
create trigger mark_in_treatment
  after update of status on public.treatment_sessions
  for each row
  execute function public.trg_mark_in_treatment();
