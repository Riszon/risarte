-- =============================================================================
-- 0266 — NA JORNADA, SÓ O ADMIN FORÇA. O RESTO É CONSEQUÊNCIA DO TRABALHO.
-- =============================================================================
--
-- Decisão do dono (21/09/2026): *"o único que pode forçar o cliente a mover de
-- fase é o admin"* e *"mover o cliente na jornada deve ser automático"*.
--
-- O QUE JÁ ERA AUTOMÁTICO CONTINUA IGUAL (nada disto passa por esta função):
--   * cadastro do cliente ................. nasce na Aquisição
--   * check-in da recepção ................ 1→2 (avaliação), 1→5 (urgência),
--                                           4→5 (início), 7→6, 7→5
--   * venda fechada (assinado + pago) ..... 4→5
--   * negociação perdida .................. 4→7
--   * fim do tratamento (decisões) ........ 5→6, 5→3, 5→7
--   * refação/revisão de qualidade ........ volta para 5
--   * comercial devolve ao planejamento ... 4→3
--   * acompanhamento envia ao planejamento  7→3
--
-- O QUE MUDA AQUI: só a MATRIZ de quem move à mão. O corpo da função (histórico
-- de fases, avisos por fase, auditoria) é o mesmo da 0148 — foi copiado
-- inteiro de propósito: reescrever uma função de 200 linhas para mudar 20 é
-- como se perde regra sem ninguém notar.
--
-- FICAM na matriz apenas os ATOS, onde mover é a consequência de um trabalho:
--   * 2→3 e 6→3  Coordenador — "Enviar ao Centro de Planejamento"
--   * 6→7        Coordenador — "Concluir a reavaliação" (sem novo plano)
--   * 3→4        Planner — "Enviar ao Comercial" (exige pilar e plano aprovado)
--   * 3→2 e 3→6  Planner — "Devolver ao Coordenador", com motivo
--
-- SAEM (o sistema já faz; à mão seria atalho para pular o trabalho):
--   1→2 recepção · 4→5 consultor · 5→6 e 5→7 recepção · 5→3 coordenador ·
--   7→6 SDR
--
-- ⚠️ O ADMIN MASTER CONTINUA PODENDO TUDO — é a válvula para quando a vida real
-- não couber no fluxo, e é de propósito que seja só dele: fase movida à mão
-- apaga o tempo real em cada fase, que é justamente o que o SLA mede.
-- =============================================================================

create or replace function public.move_client_phase(
  p_client_id uuid,
  p_new_phase public.journey_phase
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_old public.journey_phase;
  v_client_name text;
  v_pillar public.methodology_pillar;
  v_user uuid := (select auth.uid());
  v_allowed boolean;
  v_ato boolean;
  v_title text;
  v_body text;
  v_clinic_name text;
  v_sender_name text;
  v_sender_role text;
  v_phase_label text;
  v_pillar_label text;
  v_schedule_hint text;
  v_presentation_at timestamptz;
begin
  select clinic_id, journey_phase, full_name, methodology_pillar
    into v_clinic, v_old, v_client_name, v_pillar
  from public.clients where id = p_client_id;

  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if v_old = p_new_phase then return; end if;

  -- =========================================================================
  -- 0266: SÓ O ADMIN FORÇA. As demais funções só fazem os ATOS do fluxo.
  -- =========================================================================
  -- Saíram daqui as passagens que o sistema JÁ FAZ sozinho — mantê-las à mão
  -- era oferecer um atalho para pular o trabalho que as dispara:
  --   1→2 (check-in da avaliação), 4→5 (venda fechada), 5→6 e 5→7 (decisões do
  --   fim do tratamento), 5→3 ("precisa de novo plano?"), 7→6 (check-in da
  --   reavaliação).
  -- Ficaram os atos, onde mover é a CONSEQUÊNCIA do trabalho recém-feito.
  -- `v_ato` responde "isto foi um ato do fluxo?" e continua valendo mesmo
  -- quando quem clicou é o Admin — é o que deixa a auditoria dizer se a
  -- passagem foi trabalho ou foi mão (`forcado`, no fim desta função).
  v_ato := case
      -- Coordenador Clínico: "Enviar ao Centro de Planejamento", da avaliação
      -- (Fase 2) ou da reavaliação (Fase 6) — é a mesma tela e o mesmo ato.
      when v_old in ('clinical_conversion', 'reevaluation')
           and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      -- Coordenador: "Concluir a reavaliação" quando não precisa de novo plano.
      when v_old = 'reevaluation' and p_new_phase = 'follow_up'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      -- Planner: "Enviar ao Comercial" (a trava de pilar e plano aprovado está
      -- na tela) e "Devolver ao Coordenador", com motivo.
      when v_old = 'planning_center'
           and p_new_phase in ('commercial_conversion', 'clinical_conversion', 'reevaluation')
        then public.is_planner()
      -- Consultor Comercial: "Devolver ao Planejamento". O ato mora em
      -- return_commercial_to_planning (reabre o plano, encerra a negociação e
      -- avisa o Planner); ela marca a transação antes de chamar esta função.
      -- Chamar o move_client_phase direto continua recusado: moveria a fase e
      -- deixaria o plano aprovado e a negociação de pé.
      when v_old = 'commercial_conversion' and p_new_phase = 'planning_center'
        then current_setting('risarte.ato', true) = 'devolucao_comercial'
      else false
    end;
  v_allowed := v_ato or public.is_admin_master();

  if not v_allowed then raise exception 'NOT_ALLOWED'; end if;

  update public.journey_phase_history set exited_at = now()
  where client_id = p_client_id and exited_at is null;
  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (p_client_id, v_clinic, p_new_phase, v_user);
  update public.clients set journey_phase = p_new_phase, phase_entered_at = now()
  where id = p_client_id;

  select name into v_clinic_name from public.clinics where id = v_clinic;
  select full_name into v_sender_name from public.profiles where id = v_user;

  select case ucr.role
      when 'receptionist' then 'Recepcionista'
      when 'sdr' then 'Encantador(a) (SDR)'
      when 'clinical_coordinator' then 'Coordenador Clínico'
      when 'planner_dentist' then 'Dentista Planner'
      when 'dentist' then 'Dentista'
      when 'commercial_consultant' then 'Consultor Comercial'
      when 'commercial_assistant' then 'Assistente Comercial'
      when 'unit_manager' then 'Gerente de Unidade'
      when 'franchisor_staff' then 'Franqueadora'
      when 'franchisee' then 'Franqueado'
    end into v_sender_role
  from public.user_clinic_roles ucr
  where ucr.user_id = v_user and (ucr.clinic_id = v_clinic or ucr.role = 'planner_dentist')
  order by case when ucr.clinic_id = v_clinic then 0 else 1 end limit 1;

  if v_sender_role is null and public.is_admin_master() then
    v_sender_role := 'Admin Master';
  end if;

  v_phase_label := case v_old
    when 'acquisition' then 'Aquisição'
    when 'clinical_conversion' then 'Conversão Clínica'
    when 'planning_center' then 'Centro de Planejamento'
    when 'commercial_conversion' then 'Conversão Comercial'
    when 'treatment_start' then 'Início de Tratamento'
    when 'reevaluation' then 'Reavaliação'
    when 'follow_up' then 'Acompanhamento'
  end;

  v_pillar_label := coalesce(case v_pillar
    when 'diagnosis' then 'Diagnóstico' when 'planning' then 'Planejamento'
    when 'health' then 'Saúde' when 'function' then 'Função'
    when 'aesthetics' then 'Estética' when 'prevention' then 'Prevenção'
  end, 'a definir');

  v_body := v_client_name
    || ' — Clínica: ' || coalesce(v_clinic_name, '—')
    || ' — Pilar: ' || v_pillar_label
    || ' — Veio de: ' || coalesce(v_phase_label, '—')
    || ' — Por: ' || coalesce(nullif(v_sender_name, ''), '—')
    || coalesce(' (' || v_sender_role || ')', '');

  if p_new_phase = 'planning_center' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Novo caso no Centro de Planejamento', v_body, '/planejamento/' || p_client_id
    from public.user_clinic_roles ucr where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'commercial_conversion' then
    select a.starts_at into v_presentation_at
    from public.appointments a
    where a.client_id = p_client_id
      and a.type = 'commercial_presentation'
      and a.status in ('scheduled', 'confirmed')
      and a.starts_at >= now()
    order by a.starts_at asc
    limit 1;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct pwa.user_id, v_clinic, 'Caso pronto para apresentação comercial',
      v_body || case
        when v_presentation_at is not null
          then ' — Apresentação: '
               || to_char(v_presentation_at at time zone 'America/Sao_Paulo',
                          'DD/MM "às" HH24"h"MI')
        else ' — ATENÇÃO: sem apresentação agendada.'
      end,
      '/clientes/' || p_client_id
    from (
      select user_id from public.providers_with_access(v_clinic, 'commercial_consultant')
      union
      select user_id from public.providers_with_access(v_clinic, 'commercial_assistant')
    ) pwa
    where pwa.user_id <> v_user;

    if v_presentation_at is null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic,
        'URGENTE: agendar apresentação comercial',
        v_client_name
          || ' está pronto(a) para a Conversão Comercial, mas NÃO tem apresentação'
          || ' comercial agendada. Agende o quanto antes para o caso não travar.',
        '/agenda?cliente=' || p_client_id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;

      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic,
        'Caso comercial sem apresentação agendada',
        v_client_name
          || ' entrou na Conversão Comercial sem apresentação agendada.'
          || ' Acompanhe para garantir o agendamento com a recepção.',
        '/clientes/' || p_client_id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic
        and ucr.role in ('unit_manager', 'clinical_coordinator') and ucr.user_id <> v_user;
    end if;
  elsif p_new_phase = 'treatment_start' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Fechamento! Agendar início de tratamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'reevaluation' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em reavaliação', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator' and ucr.user_id <> v_user;
  elsif p_new_phase = 'follow_up' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em acompanhamento', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  elsif p_new_phase = 'clinical_conversion' then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, 'Cliente em conversão clínica', v_body, '/clientes/' || p_client_id
    from public.user_clinic_roles ucr where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator' and ucr.user_id <> v_user;
  end if;

  v_schedule_hint := case p_new_phase
    when 'clinical_conversion' then 'Agendar avaliação'
    when 'reevaluation' then 'Agendar reavaliação'
    else null
  end;

  if v_schedule_hint is not null then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_clinic, v_schedule_hint || ': ' || v_client_name, v_body,
           '/agenda?cliente=' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'receptionist' and ucr.user_id <> v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'client_journey', p_client_id::text,
          jsonb_build_object('from', v_old, 'to', p_new_phase,
                             'forcado', not v_ato));
end;
$$;


revoke all on function public.move_client_phase(uuid, public.journey_phase) from public;
grant execute on function public.move_client_phase(uuid, public.journey_phase) to authenticated;

comment on function public.move_client_phase(uuid, public.journey_phase) is
  'Move o cliente de fase. Só o Admin Master força qualquer passagem; as demais funções só fazem os ATOS do fluxo (Coordenador: enviar ao Planejamento e concluir a reavaliação; Planner: enviar ao Comercial e devolver ao Coordenador). O resto da jornada anda sozinho, por evento (0266).';


-- =============================================================================
-- E O ATO DO CONSULTOR: "Devolver ao Planejamento" (Fase 4 → Fase 3)
-- =============================================================================
-- Esta passagem não é feita à mão: quem a faz é a função abaixo, que reabre o
-- plano, encerra a negociação e avisa o Planner. Ela saiu da matriz junto com
-- as outras, e SEM ISTO o Consultor perderia o botão (provado no treino:
-- NOT_ALLOWED). Em vez de devolver 4→3 à matriz — o que deixaria o Consultor
-- mover a fase pela API sem reabrir plano nenhum, criando um caso pela metade —
-- a função marca a transação e o move_client_phase reconhece a marca.
create or replace function public.return_commercial_to_planning(p_client_id uuid, p_considerations text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_phase public.journey_phase;
  v_plan uuid;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, journey_phase into v_clinic, v_phase
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if v_phase <> 'commercial_conversion' then raise exception 'WRONG_PHASE'; end if;

  if not (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_considerations), '') = '' then
    raise exception 'CONSIDERATIONS_REQUIRED';
  end if;

  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;

  update public.plan_negotiations set status = 'devolvida', updated_at = now()
  where client_id = p_client_id and status in ('em_negociacao', 'aguardando_autorizacao');

  if v_plan is not null then
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    values (v_plan, v_clinic, 'devolvido_comercial',
      'Devolvido pelo Comercial — considerações do Consultor: ' || btrim(p_considerations),
      v_user);

    update public.treatment_plans set
      status = 'draft',
      lifecycle = null,
      commercial_return_note = btrim(p_considerations),
      commercial_returned_at = now(),
      commercial_returned_by = v_user,
      updated_at = now()
    where id = v_plan;
  end if;

  -- 0266: o ATO é autorizado, não o movimento cru. A marca vale só dentro
  -- desta transação e diz ao move_client_phase que a passagem 4→3 está vindo
  -- por aqui — com plano reaberto, considerações obrigatórias e aviso ao
  -- Planner. Quem chamasse o move_client_phase direto continua recusado:
  -- moveria a fase e deixaria o plano aprovado e a negociação de pé.
  perform set_config('risarte.ato', 'devolucao_comercial', true);
  perform public.move_client_phase(p_client_id, 'planning_center');

  select full_name into v_client_name from public.clients where id = p_client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_clinic,
    'Plano DEVOLVIDO pelo Comercial — reabrir e ajustar',
    coalesce(v_client_name, 'Cliente')
      || ' — o plano foi reaberto (situação REPLANEJAMENTO) com as considerações '
      || 'do Consultor em destaque. Ajuste e envie novamente para aprovação.',
    '/planejamento/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
end;
$$;
