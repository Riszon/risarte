-- =============================================================================
-- 0389 — INICIAR A APRESENTAÇÃO MOVE QUEM CHEGOU (OC-00146)
--
-- Relato (28/10/2026, treino, recepção): a apresentação comercial ficava em
-- "A chegar"/"Em espera" e virava pendência de dia anterior para sempre.
--
-- Regra do dono (10/11/2026): a recepção REGISTRA A CHEGADA (inclusive da
-- apresentação online — o cliente pode vir à clínica e o consultor entrar por
-- vídeo); quando o consultor INICIA a apresentação, o cliente vai para "Em
-- atendimento"; quando FINALIZA, para "Concluído". O que sobrar em "A chegar"
-- ou "Em espera" quer dizer que a apresentação NÃO aconteceu: a recepção
-- reagenda e conversa com o Comercial.
--
-- O defeito (lido no treino, 10/11/2026): de 37 apresentações passadas em
-- aberto, 27 tinham o cliente "em espera" E a apresentação INICIADA no funil.
-- O início (0269/0293) só procurava o agendamento a ±1 dia de agora; a
-- chegada era de um agendamento de dias antes, e nada mudava de coluna.
--
-- A correção: ao iniciar, vale primeiro o agendamento em que o cliente está
-- em espera, de qualquer dia; sem ele, a janela de sempre. O resto da função
-- é o da 0293 (encerrar continua pegando o atendimento aberto de qualquer
-- dia), com a guarda de execução da 0295.
--
-- Não mexe nos 27 que já estão presos (são do treino; decisão do dono).
-- Idempotente.
-- =============================================================================

create or replace function public.commercial_set_stage(
  p_client_id uuid,
  p_stage text,
  p_reason text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_card uuid;
  v_user uuid := (select auth.uid());
  v_desc text;
  v_appt uuid;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.commercial_is_team(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if p_stage not in ('a_apresentar','acontecendo_agora','apresentado','follow_up','cancelado','perdido') then
    raise exception 'INVALID_STAGE';
  end if;
  if p_stage in ('cancelado','perdido') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  v_card := public.commercial_ensure_card(p_client_id);

  update public.commercial_cards set
    stage = p_stage,
    outcome_reason = case when p_stage in ('cancelado','perdido') then btrim(p_reason) else outcome_reason end,
    outcome_at = case when p_stage in ('cancelado','perdido') then now() else outcome_at end,
    outcome_by = case when p_stage in ('cancelado','perdido') then v_user else outcome_by end,
    presenting_since = case when p_stage = 'acontecendo_agora' then now() else null end,
    followup_by_clinic = case when p_stage = 'follow_up' then followup_by_clinic else false end,
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

  -- ⚠️ QUEM MOVE O ATENDIMENTO É O `update_attendance` (0269), com as travas
  -- dele. Aqui só se escolhe QUAL agendamento.
  --
  -- 0293: para ENCERRAR, primeiro o atendimento que está ABERTO (em
  -- atendimento), de qualquer dia. A janela de ±1 dia da 0269 escolhia pelo
  -- horário mais perto de agora — e um atendimento aberto fora dela ficava
  -- aberto para sempre, prendendo o consultor.
  if p_stage in ('apresentado', 'cancelado', 'perdido', 'follow_up') then
    select a.id into v_appt
    from public.appointments a
    where a.client_id = p_client_id
      and a.type = 'commercial_presentation'
      and a.attendance = 'in_service'
    order by a.called_at desc nulls last, a.starts_at desc
    limit 1;
  end if;

  -- 0389 (OC-00146): para INICIAR, primeiro o agendamento em que o cliente
  -- JÁ ESTÁ EM ESPERA (a recepção registrou a chegada), de qualquer dia — a
  -- chegada é o sinal de onde a apresentação acontece. A janela de ±1 dia
  -- abaixo deixava de fora o agendamento de dias antes (marcado para 04/11,
  -- chegada e início em 09/11): nada ia para "em atendimento", e ele ficava
  -- "em espera" para sempre na sala de espera.
  if p_stage = 'acontecendo_agora' then
    select a.id into v_appt
    from public.appointments a
    where a.client_id = p_client_id
      and a.type = 'commercial_presentation'
      and a.status not in ('cancelled', 'no_show')
      and a.attendance = 'waiting'
    order by a.checked_in_at desc nulls last, a.starts_at desc
    limit 1;
  end if;

  -- Follow-up só encerra o que estava ACONTECENDO: mandar para follow-up quem
  -- nem foi apresentado não pode marcar a apresentação como feita.
  if v_appt is null and p_stage <> 'follow_up' then
    select a.id into v_appt
    from public.appointments a
    where a.client_id = p_client_id
      and a.type = 'commercial_presentation'
      and a.status not in ('cancelled', 'no_show')
      and a.attendance is distinct from 'done'
      and a.starts_at > now() - interval '1 day'
      and a.starts_at < now() + interval '1 day'
    order by abs(extract(epoch from (a.starts_at - now())))
    limit 1;
  end if;

  if v_appt is not null then
    if p_stage = 'acontecendo_agora' then
      perform public.update_attendance(v_appt, 'in_service');
    elsif p_stage in ('apresentado', 'cancelado', 'perdido', 'follow_up') then
      -- Cancelado e perdido também encerram (dono, 22/09/2026); follow-up
      -- também (dono, 14/10/2026, OC-00091): a apresentação acabou.
      perform public.update_attendance(v_appt, 'done');
    end if;
  end if;

  v_desc := case p_stage
    when 'acontecendo_agora' then 'Apresentação iniciada'
    when 'apresentado' then 'Marcado como apresentado'
    when 'follow_up' then 'Follow-up (funil)'
    when 'a_apresentar' then 'Voltou para "A apresentar"'
    when 'cancelado' then 'Cancelado — ' || coalesce(btrim(p_reason), '')
    when 'perdido' then 'Perdido — ' || coalesce(btrim(p_reason), '')
    else p_stage
  end;
  perform public.commercial_log_card_event(v_card, p_client_id, v_clinic, p_stage, v_desc);

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'commercial_card', p_client_id::text,
    jsonb_build_object('stage', p_stage));
end;
$$;
revoke execute on function public.commercial_set_stage(uuid, text, text) from public, anon, authenticated;
grant execute on function public.commercial_set_stage(uuid, text, text) to authenticated;
