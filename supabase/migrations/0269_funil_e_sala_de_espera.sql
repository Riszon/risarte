-- =============================================================================
-- 0269 — O FUNIL COMERCIAL E A SALA DE ESPERA PASSAM A SE FALAR
-- =============================================================================
-- Relato OC-00073 (22/09/2026). O fluxo que o dono descreveu:
--
--   recepção agenda → confirma com o cliente → recepciona e coloca "em espera"
--   → o consultor vê "em espera" no cartão → inicia a apresentação (o cliente
--   vira "em atendimento" na tela da recepção) → encerra (vira "concluído").
--
-- Duas coisas faltavam, e as duas eram buraco, não regra:
--   1. mover o cartão não mexia no atendimento (esta migração);
--   2. o cartão não mostrava o estado da recepção (a tela, no mesmo commit).
--
-- E uma terceira, que NÃO é código: o menu "Atendimento" do Consultor
-- Comercial. O padrão do código mudou junto, mas ele não bastaria — a matriz
-- de permissões tem uma LINHA GRAVADA liberando aquele menu, e linha de banco
-- ganha de padrão de código. É ela que sai abaixo.

-- -----------------------------------------------------------------------------
-- 1) O Consultor Comercial deixa de ver o menu "Atendimento"
-- -----------------------------------------------------------------------------
-- ⚠️ ISTO MEXE NA MATRIZ DE PERMISSÕES, que é DADO do dono e não viaja entre
-- ambientes sozinha (§0b do CLAUDE.md) — por isso está aqui, para rodar nos
-- dois. Ele continua podendo devolver o menu em Administração → Permissões: o
-- que se apaga é a linha, não o direito de recriá-la.
-- DESTRUTIVO: apaga 1 linha da matriz de permissões (menu Atendimento do
-- Consultor Comercial), a pedido do dono no relato OC-00073.
delete from public.permission_matrix
 where capability = 'menu.atendimento'
   and role = 'commercial_consultant';

-- -----------------------------------------------------------------------------
-- 2) Mover o cartão no funil move o atendimento
-- -----------------------------------------------------------------------------
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

  -- =========================================================================
  -- 0269: O FUNIL MOVE O ATENDIMENTO (relato OC-00073)
  -- =========================================================================
  -- A recepção prepara o cliente e o coloca "em espera"; o consultor conduz a
  -- apresentação pelo funil. Antes, as duas telas não se falavam: a recepção
  -- ficava com o cliente parado "em espera" até alguém lembrar de encerrar à
  -- mão — e ninguém lembra, porque quem terminou a apresentação foi o outro.
  --
  -- CADA ESTADO TEM UM DONO (decisão do dono, 22/09/2026): a recepção manda no
  -- "em espera"; o consultor manda no "em atendimento" e no "concluído". Sem
  -- isso, os dois mexeriam no mesmo ponto e um desfaria o outro.
  --
  -- ⚠️ QUEM MOVE O ATENDIMENTO É O `update_attendance`, não um UPDATE daqui.
  -- Ele já guarda quem chamou, quem concluiu, a hora, o aviso de desistência e
  -- as travas ("o cliente não pode estar em dois lugares", "o profissional já
  -- está atendendo"). Escrever um segundo caminho para a mesma coisa é como os
  -- dois passam a divergir — e a trava que vale ficaria só num deles.
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

  -- Sem apresentação marcada não há o que espelhar. O funil já avisa em
  -- vermelho quando falta agendamento, então isto não é silêncio: é o caso
  -- que a própria tela denuncia antes de chegar aqui.
  if v_appt is not null then
    if p_stage = 'acontecendo_agora' then
      perform public.update_attendance(v_appt, 'in_service');
    elsif p_stage in ('apresentado', 'cancelado', 'perdido') then
      -- Cancelado e perdido também encerram (decisão do dono): a apresentação
      -- acabou, mesmo sem venda, e deixar o cliente na sala de espera faria a
      -- recepção cobrar um atendimento que já terminou.
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

comment on function public.commercial_set_stage(uuid, text, text) is
  'Move o cartão do funil comercial e, junto, o atendimento do cliente: "acontecendo agora" chama (em atendimento) e "apresentado/cancelado/perdido" conclui. Quem move o atendimento é o update_attendance, com as travas dele (0269).';
