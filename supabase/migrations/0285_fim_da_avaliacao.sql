-- =============================================================================
-- 0285 — O FIM DA AVALIAÇÃO TEM UMA PORTA SÓ (OC-00085 e OC-00086)
-- -----------------------------------------------------------------------------
-- Dois relatos, uma causa: a avaliação tinha DUAS saídas, e cada uma fazia
-- metade do trabalho.
--   * "Concluir" no Atendimento → parava o áudio, mas NÃO enviava ao
--     Planejamento nem conferia a avaliação (OC-00085);
--   * "Enviar ao Centro de Planejamento" no cockpit → enviava, mas só
--     encerrava o atendimento (e, com ele, o áudio) se fosse QUEM CHAMOU o
--     paciente (0270). Outro coordenador ou o Admin enviava, e o atendimento
--     e a gravação seguiam abertos (OC-00086).
--
-- Decisões do dono (27/09/2026):
--   1. QUEM ENVIA ENCERRA: enviar ao Planejamento ou concluir a reavaliação
--      fecha o atendimento do dia, seja quem for que tenha chamado — o envio é
--      o fim real da avaliação. (No painel, "quem chamou é quem conclui"
--      continua para os outros tipos.)
--   2. Avaliação e reavaliação não se concluem mais no painel; quando a
--      avaliação é INTERROMPIDA, há "Encerrar sem enviar", com motivo
--      obrigatório, registrado no histórico do agendamento.
--
-- Idempotente. Não apaga nada.
-- =============================================================================

-- 1) Quem envia encerra -------------------------------------------------------
--
-- A guarda era emprestada do `update_attendance` (NOT_CALLER). Sem ela, esta
-- função precisa da SUA: só fecha depois que a avaliação de fato terminou (o
-- cliente já saiu da Fase 2 / 6) e só a pedido de quem pode terminá-la
-- (Coordenador Clínico da unidade, ou o Admin Master — docs/JORNADA.md §4.2).
create or replace function public.finish_clinical_attendance(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt uuid;
  v_clinic uuid;
  v_fase public.journey_phase;
begin
  select c.clinic_id, c.journey_phase into v_clinic, v_fase
  from public.clients c where c.id = p_client_id;
  if v_clinic is null then return 'sem_atendimento'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    return 'nao_permitido';
  end if;

  -- Ainda na avaliação/reavaliação = a avaliação NÃO terminou; fechar aqui
  -- seria o atalho que o OC-00085 denunciou.
  if v_fase in ('clinical_conversion', 'reevaluation') then
    return 'ainda_na_avaliacao';
  end if;

  select a.id into v_appt
  from public.appointments a
  where a.client_id = p_client_id
    and a.attendance = 'in_service'
    and a.starts_at >= public.today_br()
    and a.starts_at < public.today_br() + 1
  order by a.starts_at
  limit 1;
  if v_appt is null then return 'sem_atendimento'; end if;

  -- O mesmo que o `update_attendance(…, 'done')` faz — sem a regra "quem
  -- chamou", que é justamente a decisão 1.
  update public.appointments
     set attendance = 'done', status = 'completed',
         done_at = now(), done_by = (select auth.uid())
   where id = v_appt;
  perform public.settle_treatment_sessions(v_appt);
  return 'concluido';
end;
$$;

revoke all on function public.finish_clinical_attendance(uuid)
  from public, anon, authenticated;
grant execute on function public.finish_clinical_attendance(uuid) to authenticated;

comment on function public.finish_clinical_attendance(uuid) is
  'O fim da avaliação (enviar ao Planejamento / concluir a reavaliação) encerra o atendimento do dia — quem envia encerra (0285). Devolve concluido / sem_atendimento / nao_permitido / ainda_na_avaliacao.';

-- 2) Encerrar sem enviar ------------------------------------------------------
--
-- A avaliação interrompida (o paciente passou mal, precisou sair). O
-- atendimento fecha; o cliente continua aguardando o envio (Fase 2 / 6) para
-- terminar depois. O motivo vai para o histórico do agendamento, que aparece
-- no prontuário — é contexto clínico, não auditoria (lá não entra texto livre).
create or replace function public.encerrar_avaliacao_sem_enviar(
  p_appointment_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo public.appointment_type;
  v_atendimento public.attendance_status;
  v_cliente uuid;
  v_clinica uuid;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if length(v_motivo) < 5 then raise exception 'MOTIVO_OBRIGATORIO'; end if;

  select a.type, a.attendance, a.client_id, a.clinic_id
    into v_tipo, v_atendimento, v_cliente, v_clinica
  from public.appointments a where a.id = p_appointment_id;
  if v_cliente is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if v_tipo not in ('evaluation', 'reevaluation') then raise exception 'NAO_E_AVALIACAO'; end if;
  if v_atendimento is distinct from 'in_service' then raise exception 'NAO_ESTA_EM_ATENDIMENTO'; end if;

  -- Quem pode: a mesma regra de concluir (quem chamou; o Admin sempre) — o
  -- `update_attendance` confere e levanta NOT_CALLER.
  perform public.update_attendance(p_appointment_id, 'done');

  insert into public.appointment_changes (appointment_id, client_id, clinic_id, changed_by, description)
  values (
    p_appointment_id, v_cliente, v_clinica, (select auth.uid()),
    'Avaliação encerrada SEM enviar ao Planejamento. Motivo: ' || v_motivo
  );
end;
$$;

revoke all on function public.encerrar_avaliacao_sem_enviar(uuid, text)
  from public, anon, authenticated;
grant execute on function public.encerrar_avaliacao_sem_enviar(uuid, text) to authenticated;

notify pgrst, 'reload schema';
