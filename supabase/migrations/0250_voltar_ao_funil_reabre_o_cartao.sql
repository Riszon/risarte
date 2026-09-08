-- =============================================================================
-- 0250 — Voltar à Fase 4 REABRE o cartão do Comercial
-- -----------------------------------------------------------------------------
-- Achado do dono testando a 0249: o cliente perdido foi para a Fase 7 como
-- combinado, ele o trouxe de volta para a Conversão Comercial — e o cartão
-- continuou "perdido". Resultado: o cliente ficou na Fase 4 e **invisível no
-- quadro**, porque o estágio do cartão manda na coluna:
--
--     if (cardStage === "perdido") return "perdido";   // → vai para o Histórico
--
-- ⚠️ E NÃO É SÓ O CAMINHO MANUAL. O resgate inteiro que a 0249 abriu termina
-- aqui: reavaliação → planejamento → o Planner envia ao Comercial → o cliente
-- entra na Fase 4 com o cartão ainda encerrado, e some. A 0249 abriu a porta de
-- saída e esqueceu a de entrada.
--
-- A REGRA, AGORA COMPLETA E SIMÉTRICA:
--
--     A FASE MANDA NO CARTÃO.
--     Sair do funil encerra o cartão (0249). Entrar no funil reabre (0250).
--
-- Não há botão para isto de propósito: um botão seria um segundo jeito de dizer
-- a mesma coisa, e os dois divergiriam no dia em que alguém usasse só um.
--
-- Idempotente.
-- =============================================================================

create or replace function public.commercial_reopen_on_phase_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card uuid;
  v_stage text;
  v_user uuid := (select auth.uid());
begin
  if new.journey_phase is distinct from 'commercial_conversion'::public.journey_phase then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.journey_phase = new.journey_phase then
    return new;
  end if;

  select id, stage into v_card, v_stage
    from public.commercial_cards where client_id = new.id;
  if v_card is null or v_stage not in ('perdido', 'cancelado') then
    return new;
  end if;

  -- ZERA A RODADA, mas não apaga a história.
  --
  -- As tentativas e o motivo da perda anterior continuam em
  -- `commercial_card_events` e em `commercial_followup_attempts` — é lá que a
  -- história mora. O que zera são os CONTADORES do cartão: quem volta começa uma
  -- rodada nova, e abrir o cartão dizendo "4ª tentativa" faria o consultor
  -- pensar que já falou com este cliente quatro vezes desta vez.
  update public.commercial_cards set
    stage = 'a_apresentar',
    outcome_reason = null,
    presenting_since = null,
    followup_started_at = null,
    followup_attempts = 0,
    next_attempt_at = null,
    followup_deadline = null,
    escalated_at = null,
    followup_by_clinic = false,
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

  perform public.commercial_log_card_event(
    v_card, new.id, new.clinic_id, 'reaberto',
    'Reaberto no funil — voltou para a Conversão Comercial (estava "'
      || v_stage || '")'
  );

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, new.clinic_id, 'update', 'commercial_card', new.id::text,
          jsonb_build_object('de', v_stage, 'para', 'a_apresentar',
                             'via', 'retorno_a_fase_4'));

  return new;
end;
$$;

-- ⚠️ SEM LAÇO ENTRE OS DOIS GATILHOS, e vale escrever por quê:
--   • cartão vira 'perdido' → a 0249 muda a fase para 'follow_up'; este gatilho
--     acorda, vê que a fase não é 'commercial_conversion', e sai.
--   • fase vira 'commercial_conversion' → este reabre o cartão; o da 0249
--     acorda, vê que o estágio não é encerrado, e sai.
-- Cada um tem uma condição de saída na primeira linha, de propósito.
drop trigger if exists commercial_reopen_on_phase_return on public.clients;
create trigger commercial_reopen_on_phase_return
  after insert or update of journey_phase on public.clients
  for each row execute function public.commercial_reopen_on_phase_return();

-- -----------------------------------------------------------------------------
-- Quem já está preso agora
-- -----------------------------------------------------------------------------
-- O caso do dono: já está na Fase 4 com o cartão encerrado. Sem isto ele
-- continuaria invisível até alguém mexer na fase de novo.
do $$
declare
  r record;
  v_card uuid;
begin
  for r in
    select c.id, c.clinic_id, cc.id as card_id, cc.stage
      from public.clients c
      join public.commercial_cards cc on cc.client_id = c.id
     where c.journey_phase = 'commercial_conversion'
       and cc.stage in ('perdido', 'cancelado')
  loop
    update public.commercial_cards set
      stage = 'a_apresentar',
      outcome_reason = null,
      presenting_since = null,
      followup_started_at = null,
      followup_attempts = 0,
      next_attempt_at = null,
      followup_deadline = null,
      escalated_at = null,
      followup_by_clinic = false,
      updated_at = now()
    where id = r.card_id;

    perform public.commercial_log_card_event(
      r.card_id, r.id, r.clinic_id, 'reaberto',
      'Reaberto no funil pela migração 0250 (estava "' || r.stage || '")'
    );
  end loop;
end $$;
