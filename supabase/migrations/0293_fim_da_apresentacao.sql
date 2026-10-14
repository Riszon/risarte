-- =============================================================================
-- 0293 — A APRESENTAÇÃO TERMINA QUANDO O TRABALHO TERMINA (relato OC-00091)
--
-- "Ao finalizar uma apresentação comercial, a apresentação fica em standby, e
-- não aparece nenhum local para finalizar. Ao chamar o próximo paciente ele
-- não deixa, falando que o profissional está em outro atendimento."
--
-- O que aconteceu no treino em 28/09/2026 (lido no banco, 14/10/2026):
--   18:25 o consultor inicia a apresentação de um cliente (cartão em
--         "acontecendo agora") — e o agendamento escolhido era o de AMANHÃ,
--         14:00, que virou "em atendimento";
--   18:26 contrato + pagamento → VENDA CONCLUÍDA. O atendimento continuou
--         aberto: só "apresentado", "cancelado" e "perdido" encerravam (0269);
--   18:40 ao chamar o próximo cliente: "o profissional já está em atendimento".
--         O atendimento aberto era de outro dia e não aparecia no quadro.
--
-- Decisões do dono (14/10/2026):
--   - a VENDA CONCLUÍDA e o FOLLOW-UP também encerram o atendimento da
--     apresentação (a apresentação acabou, com ou sem venda);
--   - a regra "o profissional já está em atendimento" (H3.4b) continua valendo.
--
-- O quadro de Atendimento passa a mostrar o atendimento aberto de QUALQUER dia
-- (na tela, no mesmo commit) — esta migração cuida de ele não ficar aberto.
--
-- Nada apaga. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O funil: Follow-up também encerra, e o encerramento acha o atendimento
--    ABERTO de qualquer dia
-- -----------------------------------------------------------------------------
-- Igual à 0269 em tudo, menos o trecho marcado "0293".
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

comment on function public.commercial_set_stage(uuid, text, text) is
  'Move o cartão do funil comercial e, junto, o atendimento do cliente: "acontecendo agora" chama (em atendimento); "apresentado", "follow-up", "cancelado" e "perdido" encerram — primeiro o atendimento aberto de qualquer dia (0269, 0293).';

-- -----------------------------------------------------------------------------
-- 2) Venda concluída encerra a apresentação
-- -----------------------------------------------------------------------------
-- Um gatilho na VENDA, e não uma linha a mais no passo de fechamento: vale
-- para todo caminho que conclui a venda, hoje e amanhã.
--
-- QUEM CONCLUI: o `update_attendance` só deixa encerrar quem CHAMOU o cliente
-- ("quem chamou conclui", LOTE D). Quem confirma o pagamento pode ser a
-- Assistente Comercial — e aí a trava recusaria, e o atendimento ficaria
-- aberto do mesmo jeito. A venda concluída É o fim da apresentação, seja quem
-- for que confirmou o pagamento (decisão do dono, OC-00091): nesse caso, e só
-- nele, o encerramento é feito aqui, com o mesmo efeito (concluído, hora, quem).
--
-- ⚠️ ESTE GATILHO NUNCA DERRUBA A VENDA. Qualquer erro vira aviso no log do
-- banco: a venda (contrato + pagamento) vale mais que o estado da sala de
-- espera — mesma regra da 0270 para o ato clínico.
create or replace function public.commercial_sale_ends_presentation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt record;
begin
  if not (new.closed_at is not null and old.closed_at is null) then
    return new;
  end if;

  for v_appt in
    select a.id
    from public.appointments a
    where a.client_id = new.client_id
      and a.type = 'commercial_presentation'
      and a.attendance = 'in_service'
  loop
    begin
      perform public.update_attendance(v_appt.id, 'done');
    exception
      when others then
        if sqlerrm like '%NOT_CALLER%' then
          update public.appointments
             set attendance = 'done',
                 status = 'completed',
                 done_at = now(),
                 done_by = (select auth.uid())
           where id = v_appt.id
             and attendance = 'in_service';
        else
          raise warning 'commercial_sale_ends_presentation (%): %', v_appt.id, sqlerrm;
        end if;
    end;
  end loop;
  return new;
exception
  when others then
    raise warning 'commercial_sale_ends_presentation: %', sqlerrm;
    return new;
end;
$$;

revoke execute on function public.commercial_sale_ends_presentation()
  from public, anon, authenticated;

drop trigger if exists commercial_sales_end_presentation on public.commercial_sales;
create trigger commercial_sales_end_presentation
  after update of closed_at on public.commercial_sales
  for each row execute function public.commercial_sale_ends_presentation();

notify pgrst, 'reload schema';
