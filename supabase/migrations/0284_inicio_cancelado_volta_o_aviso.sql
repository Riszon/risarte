-- =============================================================================
-- 0284 — INÍCIO CANCELADO OU FALTA: O AVISO VOLTA PARA A RECEPÇÃO (AP20)
-- -----------------------------------------------------------------------------
-- A 0283 fez o aviso "Fechamento! Iniciar tratamento" sair sozinho quando o
-- início é agendado. Faltava o caminho de volta: se esse início for CANCELADO
-- ou o paciente FALTAR, ele fica sem início agendado — e nada avisava a
-- recepção (só o prazo vermelho na Jornada).
--
-- Decisão do dono (27/09/2026):
--   * cancelado OU falta → a recepção recebe o aviso de novo, com o motivo;
--   * só se o paciente continua "Aguardando Iniciar Tratamento" e NÃO tem
--     outro início agendado (remarcar a data não dispara nada);
--   * a APRESENTAÇÃO fica como está: quem decide tentar de novo é o Comercial
--     ("Pedir novo agendamento", 0248), que conta as tentativas.
--
-- O aviso novo usa o mesmo título e o mesmo link dos outros, então entra no
-- mesmo pop-up e sai do mesmo jeito (gatilho da 0283) quando o início for
-- agendado de novo. Não duplica: se já existe um aviso em aberto desse cliente
-- para a pessoa, não cria outro.
--
-- Não apaga nada. Idempotente.
-- =============================================================================

create or replace function public._inicio_sem_agendamento_avisa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cli record;
  v_motivo text;
begin
  -- Só interessa quando um INÍCIO VIVO deixa de ser vivo: cancelado, falta,
  -- ou o tipo trocado. Remarcar (mudar a hora) não passa por aqui.
  if not (old.type = 'treatment_start' and old.status in ('scheduled', 'confirmed')) then
    return new;
  end if;
  if new.type = 'treatment_start' and new.status in ('scheduled', 'confirmed', 'completed') then
    return new;
  end if;

  select c.id, c.clinic_id, c.full_name, c.journey_phase, c.journey_status
    into v_cli
  from public.clients c where c.id = new.client_id;
  if v_cli.id is null then return new; end if;

  -- Só quem continua ESPERANDO o início (nulo conta como esperando, igual ao
  -- prazo da Fase 5 — `slaAppliesTo`).
  if v_cli.journey_phase <> 'treatment_start'
     or coalesce(v_cli.journey_status::text, 'awaiting_treatment_start') <> 'awaiting_treatment_start' then
    return new;
  end if;

  -- Tem outro início agendado? Então ninguém ficou sem início.
  if exists (
    select 1 from public.appointments a
    where a.client_id = new.client_id
      and a.id <> new.id
      and a.type = 'treatment_start'
      and a.status in ('scheduled', 'confirmed')
  ) then
    return new;
  end if;

  v_motivo := case
    when new.type <> 'treatment_start' then 'o início agendado foi trocado por outro tipo de atendimento'
    when new.status = 'no_show' then 'o paciente faltou ao início agendado'
    else 'o início agendado foi cancelado'
  end;

  -- Mesmo título e link do aviso do fechamento: entra no mesmo pop-up e sai
  -- sozinho quando o início for agendado de novo (0283).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_cli.clinic_id,
         'FECHAMENTO! Iniciar tratamento',
         coalesce(v_cli.full_name, 'Cliente') || ' — ' || v_motivo || '. Agende de novo.',
         '/agenda?cliente=' || v_cli.id::text
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_cli.clinic_id
    and ucr.role = 'receptionist'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.read_at is null
        and n.title ilike '%iniciar tratamento%'
        and n.link = '/agenda?cliente=' || v_cli.id::text
    );
  return new;
end;
$$;

-- Função de gatilho, interna: ninguém chama pela API (Regra 7).
revoke all on function public._inicio_sem_agendamento_avisa()
  from public, anon, authenticated;

drop trigger if exists trg_inicio_sem_agendamento_avisa on public.appointments;
create trigger trg_inicio_sem_agendamento_avisa
  after update of type, status on public.appointments
  for each row execute function public._inicio_sem_agendamento_avisa();
