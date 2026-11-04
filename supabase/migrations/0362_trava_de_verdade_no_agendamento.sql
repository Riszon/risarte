-- =============================================================================
-- 0362 — AGENDA: TRAVA DE VERDADE NO AGENDAMENTO + CONFLITO DE SALA NO BANCO
--        (AP103; plano docs/sdr/PLANO-CORRECOES-SECAO-2.md §5b, aprovado pelo
--        dono em 03/11/2026)
--
-- O QUE HAVIA: `check_appointment_conflict` (0029, recriada na 0171) decidia
-- por um `exists` sem serialização nenhuma. Dois agendamentos gravados AO
-- MESMO TEMPO para o mesmo profissional passavam os dois: cada transação
-- conferia antes de a outra ter gravado, e nenhuma via a outra. Com uma
-- recepção por unidade o risco era baixo; com um processo agendando ao mesmo
-- tempo (a Rita, Fase 1) deixa de ser. E o conflito de SALA só era conferido
-- na tela (`checkAgendaRules`) — pela API, nada impedia duas pessoas na mesma
-- sala na mesma hora.
--
-- O QUE MUDA (duas camadas, sem mudar o modelo):
--   1. No início do gatilho, `pg_advisory_xact_lock` por CLIENTE, por
--      PROFISSIONAL e por SALA (quando preenchidos), sempre nesta ordem — a
--      ordem fixa é o que impede duas transações de esperarem uma pela outra
--      em círculo. Quem chega segundo espera a primeira terminar, e aí a
--      conferência dele já enxerga o que ela gravou (a função é VOLATILE: cada
--      consulta dentro dela ganha a foto mais recente do banco). O custo é um
--      lock por transação, só na escrita da agenda.
--   2. Conflito de SALA no mesmo gatilho (`ROOM_TIME_CONFLICT`), com a mesma
--      exceção de urgência/emergência da regra do profissional. A tela traduz
--      a mensagem nova (criar e alterar agendamento).
--
-- FORA, DE PROPÓSITO: fechamento de agenda, feriado, horário de funcionamento,
-- almoço e plano anual continuam na action — são regras de "deve", não de
-- integridade. `exclude using gist` (btree_gist + tstzrange) fica como
-- alternativa futura: exigiria extensão nova, não cobre
-- `appointment_participants` e muda a mensagem que a tela traduz.
--
-- Idempotente. A assinatura do gatilho não muda. Nada apaga dado.
-- =============================================================================

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

  -- Alteração que não mexe em horário, profissional, cliente nem sala não
  -- precisa conferir nada (nem esperar lock nenhum).
  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and new.provider_user_id is not distinct from old.provider_user_id
     and new.client_id = old.client_id
     and new.room_id is not distinct from old.room_id then
    return new;
  end if;

  -- AP103: serializa quem agenda a mesma pessoa, o mesmo profissional e a
  -- mesma sala. ORDEM FIXA (cliente → profissional → sala): duas transações
  -- que precisem dos mesmos locks os pedem na mesma sequência e nunca ficam
  -- esperando uma pela outra em círculo. O lock morre com a transação.
  perform pg_advisory_xact_lock(hashtext('appt:client:' || new.client_id::text));
  if new.provider_user_id is not null then
    perform pg_advisory_xact_lock(hashtext('appt:provider:' || new.provider_user_id::text));
  end if;
  if new.room_id is not null then
    perform pg_advisory_xact_lock(hashtext('appt:room:' || new.room_id::text));
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

  -- AP103 (2): a sala atende um cliente por vez — agora no banco, não só na
  -- tela. O encaixe (urgência/emergência) passa, como na regra do profissional.
  if new.room_id is not null
     and new.type not in ('urgency', 'emergency')
     and exists (
       select 1 from public.appointments a
       where a.room_id = new.room_id
         and a.id <> new.id
         and a.status not in ('cancelled', 'no_show')
         and a.type not in ('urgency', 'emergency')
         and a.starts_at < new.ends_at
         and a.ends_at > new.starts_at
     ) then
    raise exception 'ROOM_TIME_CONFLICT';
  end if;

  return new;
end;
$$;

-- Função de gatilho: nunca é chamada pela API.
revoke execute on function public.check_appointment_conflict() from public, anon, authenticated;

drop trigger if exists appointments_conflict_check on public.appointments;
create trigger appointments_conflict_check
  before insert or update on public.appointments
  for each row execute function public.check_appointment_conflict();

-- Conferência (o dono roda depois de aplicar; esperado: 1 · true · true · true)
-- select
--   (select count(*) from pg_trigger
--     where tgrelid = 'public.appointments'::regclass
--       and tgname = 'appointments_conflict_check') as gatilho,
--   (select prosrc like '%pg_advisory_xact_lock%' from pg_proc
--     where proname = 'check_appointment_conflict') as com_lock,
--   (select prosrc like '%ROOM_TIME_CONFLICT%' from pg_proc
--     where proname = 'check_appointment_conflict') as com_sala,
--   (select not has_function_privilege('anon', 'public.check_appointment_conflict()', 'execute')) as fechada;
