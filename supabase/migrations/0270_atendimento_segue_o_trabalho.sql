-- =============================================================================
-- 0270 — A SALA DE ESPERA SEGUE O TRABALHO CLÍNICO
-- =============================================================================
-- Relato OC-00075 (Coordenador Clínico, 23/09/2026): *"não apertei na caixinha
-- de CHAMAR e fui direto para o atendimento, fiz o preenchimento da ficha e
-- finalizei a gravação. Mas a caixinha 'em espera' não seguiu para 'em
-- atendimento'"*.
--
-- O SISTEMA FAZIA O COMBINADO — e o combinado tinha um preço que só aparece no
-- uso. Quem move "em espera → em atendimento" era só o botão **Chamar**, no
-- painel. Pulado ele, o paciente fica marcado como esperando para sempre: o
-- alerta de espera longa dispara, os indicadores de tempo mentem, e — o pior —
-- **o atendimento não pode nem ser concluído**, porque concluir exige ter
-- chamado (`NOT_CALLER`). O profissional fica preso num estado que ele não
-- sabia que precisava criar.
--
-- A DECISÃO (dono, 23/09/2026) é a mesma que valeu para o Comercial na 0269:
-- cada estado tem um dono, e o estado anda pelo TRABALHO, não por um clique
-- extra. Aqui: **o primeiro ato clínico chama**; abrir a tela, não — olhar uma
-- ficha para conferir um dado não é atender, e mover estado por curiosidade
-- criaria um desfazer para alguém.

create or replace function public.start_clinical_attendance(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt uuid;
  v_clinic uuid;
  v_provider uuid;
  v_user uuid := (select auth.uid());
begin
  -- SÓ QUEM ESTÁ EM ESPERA. Atendimento sem check-in não é "esquecimento do
  -- Chamar": é gente que não passou pela recepção — e o check-in é quem move a
  -- FASE da jornada (1→2). Chamar por cima disso pularia a passagem de fase em
  -- silêncio, que é um estrago maior do que o que se conserta aqui.
  select a.id, a.clinic_id, a.provider_user_id
    into v_appt, v_clinic, v_provider
  from public.appointments a
  where a.client_id = p_client_id
    and a.attendance = 'waiting'
    and a.starts_at >= public.today_br()
    and a.starts_at < public.today_br() + 1
  order by a.starts_at
  limit 1;

  if v_appt is null then return 'sem_espera'; end if;

  -- A MESMA REGRA DO BOTÃO CHAMAR (H1.4): o profissional do agendamento, ou
  -- alguém da clínica quando não há profissional marcado. Não se inventa
  -- permissão aqui — se esta pessoa não podia chamar pelo painel, também não
  -- chama por escrever na ficha.
  if not (
    public.is_admin_master()
    or v_provider = v_user
    or (
      v_provider is null
      and public.has_role_in_clinic(
        v_clinic,
        array['clinical_coordinator', 'dentist', 'commercial_consultant']::public.user_role[]
      )
    )
  ) then
    return 'nao_permitido';
  end if;

  -- Quem move é o `update_attendance`, com as travas dele (cliente em dois
  -- lugares, profissional ocupado, sala ocupada). Um caminho paralelo nasceria
  -- sem elas. Se alguma trava disparar, o ato clínico NÃO pode cair junto: o
  -- registro da consulta vale mais que o estado da sala de espera.
  begin
    perform public.update_attendance(v_appt, 'in_service');
    return 'chamado';
  exception when others then
    return 'nao_permitido';
  end;
end;
$$;

revoke all on function public.start_clinical_attendance(uuid) from public;
grant execute on function public.start_clinical_attendance(uuid) to authenticated;

comment on function public.start_clinical_attendance(uuid) is
  'O primeiro ato clínico chama o paciente que está em espera (0270). Devolve chamado / sem_espera / nao_permitido — nunca levanta erro, para não derrubar o registro clínico.';

-- -----------------------------------------------------------------------------
-- E O FIM DA AVALIAÇÃO CONCLUI O ATENDIMENTO
-- -----------------------------------------------------------------------------
-- "Enviar ao Centro de Planejamento" e "Concluir a reavaliação" são os atos que
-- encerram a consulta. Quem acabou de atender não precisa lembrar de voltar ao
-- painel para dizer que acabou — foi exatamente esse passo que o relato mostra
-- sendo esquecido.
create or replace function public.finish_clinical_attendance(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt uuid;
begin
  select a.id into v_appt
  from public.appointments a
  where a.client_id = p_client_id
    and a.attendance = 'in_service'
    and a.starts_at >= public.today_br()
    and a.starts_at < public.today_br() + 1
  order by a.starts_at
  limit 1;

  if v_appt is null then return 'sem_atendimento'; end if;

  begin
    perform public.update_attendance(v_appt, 'done');
    return 'concluido';
  exception when others then
    -- Quem chamou é quem conclui (NOT_CALLER). Se foi outra pessoa que chamou,
    -- o atendimento fica para ela encerrar no painel — e a fase do cliente já
    -- andou de qualquer forma.
    return 'nao_permitido';
  end;
end;
$$;

revoke all on function public.finish_clinical_attendance(uuid) from public;
grant execute on function public.finish_clinical_attendance(uuid) to authenticated;

comment on function public.finish_clinical_attendance(uuid) is
  'O fim da avaliação (enviar ao Planejamento / concluir a reavaliação) encerra o atendimento do dia (0270). Devolve concluido / sem_atendimento / nao_permitido.';
