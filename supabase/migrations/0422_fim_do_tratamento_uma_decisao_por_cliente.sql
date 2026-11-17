-- =============================================================================
-- 0422 — FIM DO TRATAMENTO: UMA DECISÃO POR CLIENTE (relato OC-00185)
--
-- O RELATO (Admin Master, treino, 17/11/2026): uma única conclusão abriu TRÊS
-- perguntas "necessita de reavaliação?" — o plano e duas vendas diretas que nem
-- estavam fechadas. As três respostas diferentes (Sim, Não, Não sei) deixaram o
-- cliente na Fase 6 com mais duas tarefas abertas. E a janela obrigatória não
-- abriu, porque a conclusão foi pelo Desenvolvimento Clínico da ficha.
--
-- Decisões do dono (17/11/2026): E1, E2, F1–F5 no plano
-- docs/jornada/FIM-DO-TRATAMENTO-PLANO.md (seção "Correção OC-00185").
--
-- O QUE MUDA:
--   1) UMA DECISÃO POR CLIENTE. Cada plano continua com o SEU fechamento (o
--      controle de qualidade da 0421 encerra fechamento por plano), mas só um
--      deles é a decisão — o LÍDER. O que termina enquanto há um líder aberto
--      entra como SEGUIDOR (`grouped_into`) e acompanha a resposta dele
--      (gatilho `treatment_closure_sync_group`). Quem é seguidor não responde
--      nem recebe contato (`GROUPED`). Quando o líder é encerrado pela
--      avaliação e ainda há seguidor aberto, o mais antigo vira o líder.
--   2) VENDA DIRETA SÓ DEPOIS DE FECHADA. As sessões feitas antes do
--      fechamento esperam; o fechamento (status `concluida`) abre a decisão
--      (gatilho `treatment_closure_on_direct_sale`).
--   3) CONSIDERAÇÕES DE QUEM EXECUTOU (F2/F3): `dentist_notes`, obrigatórias
--      no Sim e no Não sei respondidos na pergunta (10 letras).
--   4) O CLIENTE JÁ TEM HORÁRIO COM O COORDENADOR (F1/F4/F5): no "Sim", o
--      próximo horário futuro com quem é Coordenador Clínico na unidade é
--      ligado à decisão (`linked_appointment_id`) e a Recepção não agenda de
--      novo. Acima de 30 dias, quem responde escolhe: manter ou pedir uma
--      reavaliação mais próxima (`wait_choice`); o Coordenador também pode
--      pedir depois (`request_sooner_reevaluation`).
--   5) As decisões repetidas que já existem (só no treino) são agrupadas pela
--      mais prudente (E2): Sim > Não sei > Não > sem resposta.
--
-- Parte das versões em vigor: `treatment_closure_on_session` (0420),
-- `_abrir_fechamento`, `_fechamento_reavaliar`, `answer_treatment_closure`
-- (0418). Não recria as funções da 0421 (contato, qualidade, saída da Fase 6).
-- Nada apaga dado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas novas
-- -----------------------------------------------------------------------------
alter table public.treatment_closures
  add column if not exists grouped_into uuid references public.treatment_closures (id),
  add column if not exists dentist_notes text,
  add column if not exists linked_appointment_id uuid references public.appointments (id) on delete set null,
  add column if not exists wait_choice text,
  add column if not exists sooner_requested_at timestamptz,
  add column if not exists sooner_requested_by uuid references public.profiles (id);

do $$
begin
  alter table public.treatment_closures
    add constraint treatment_closures_wait_choice_chk
    check (wait_choice is null or wait_choice in ('manter', 'antecipar'));
exception when duplicate_object then null;
end $$;

create index if not exists treatment_closures_grouped_into
  on public.treatment_closures (grouped_into) where grouped_into is not null;

comment on column public.treatment_closures.grouped_into is
  '0422: o fechamento que é a DECISÃO do cliente (o líder). Seguidor acompanha a resposta dele e não responde sozinho.';

-- -----------------------------------------------------------------------------
-- 2) As repetidas que já existem (E2): fica a mais prudente
-- -----------------------------------------------------------------------------
with abertos as (
  select f.id, f.client_id,
         row_number() over (
           partition by f.client_id
           order by case f.status when 'reavaliacao' then 0 when 'coordenador' then 1
                                  when 'contato' then 2 else 3 end,
                    f.created_at, f.id) as n
    from public.treatment_closures f
   where f.grouped_into is null
     and f.status in ('pergunta', 'coordenador', 'reavaliacao', 'contato')
), lideres as (
  select a.client_id, a.id as lider from abertos a where a.n = 1
)
update public.treatment_closures s set
  grouped_into = l.lider,
  status = lf.status,
  answer = lf.answer,
  answered_by = lf.answered_by,
  answered_at = lf.answered_at,
  treatment_end = lf.treatment_end,
  updated_at = now()
from abertos a
join lideres l on l.client_id = a.client_id
join public.treatment_closures lf on lf.id = l.lider
where s.id = a.id and a.n > 1;

-- A trava: uma decisão aberta por cliente.
create unique index if not exists treatment_closures_one_decision
  on public.treatment_closures (client_id)
  where grouped_into is null and status in ('pergunta', 'coordenador', 'reavaliacao', 'contato');

-- -----------------------------------------------------------------------------
-- 3) Os seguidores acompanham o líder
-- -----------------------------------------------------------------------------
create or replace function public.treatment_closure_sync_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo uuid;
begin
  if new.status = 'encerrado' and new.outcome in ('reavaliado', 'reaberto') then
    -- O líder foi avaliado (ou o plano dele foi reaberto); um seguidor aberto vira o
    -- líder (a decisão continua, para os outros planos).
    select f.id into v_novo from public.treatment_closures f
     where f.grouped_into = new.id and f.status <> 'encerrado'
     order by f.created_at, f.id limit 1;
    if v_novo is not null then
      update public.treatment_closures set grouped_into = null, updated_at = now() where id = v_novo;
      update public.treatment_closures set grouped_into = v_novo, updated_at = now()
       where grouped_into = new.id and id <> v_novo and status <> 'encerrado';
    end if;
    return null;
  end if;

  update public.treatment_closures f set
    status = new.status,
    answer = new.answer,
    answered_by = new.answered_by,
    answered_at = new.answered_at,
    treatment_end = new.treatment_end,
    changed_by_coordinator = new.changed_by_coordinator,
    dentist_notes = new.dentist_notes,
    linked_appointment_id = new.linked_appointment_id,
    wait_choice = new.wait_choice,
    sooner_requested_at = new.sooner_requested_at,
    sooner_requested_by = new.sooner_requested_by,
    outcome = new.outcome,
    outcome_note = new.outcome_note,
    return_date = new.return_date,
    closed_by = new.closed_by,
    closed_at = new.closed_at,
    updated_at = now()
  where f.grouped_into = new.id and f.status <> 'encerrado';
  return null;
end;
$$;
revoke execute on function public.treatment_closure_sync_group() from public, anon, authenticated;

drop trigger if exists treatment_closure_sync_group on public.treatment_closures;
create trigger treatment_closure_sync_group
  after update on public.treatment_closures
  for each row
  when (new.grouped_into is null and old.grouped_into is null)
  execute function public.treatment_closure_sync_group();

-- Seguidor não recebe contato: o contato é o da decisão (o líder).
create or replace function public.treatment_closure_contacts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.treatment_closures f
              where f.id = new.closure_id and f.grouped_into is not null) then
    raise exception 'GROUPED';
  end if;
  return new;
end;
$$;
revoke execute on function public.treatment_closure_contacts_guard() from public, anon, authenticated;

drop trigger if exists treatment_closure_contacts_guard on public.treatment_closure_contacts;
create trigger treatment_closure_contacts_guard
  before insert on public.treatment_closure_contacts
  for each row execute function public.treatment_closure_contacts_guard();

-- -----------------------------------------------------------------------------
-- 4) O próximo horário do cliente com um Coordenador (F1)
-- -----------------------------------------------------------------------------
create or replace function public._horario_com_coordenador(p_client_id uuid, p_clinic_id uuid)
returns table (appointment_id uuid, starts_at timestamptz, provider_user_id uuid, dias integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.starts_at, a.provider_user_id,
         ((a.starts_at at time zone 'America/Sao_Paulo')::date - public.today_br())::integer
    from public.appointments a
   where a.client_id = p_client_id
     and a.starts_at > now()
     and a.status in ('scheduled', 'confirmed')
     and exists (
       select 1 from public.user_clinic_roles_all r
        where r.user_id = a.provider_user_id
          and r.clinic_id = p_clinic_id
          and r.role = 'clinical_coordinator'
     )
   order by a.starts_at
   limit 1;
$$;
revoke execute on function public._horario_com_coordenador(uuid, uuid) from public, anon, authenticated;

-- A porta da tela: a janela mostra o horário e os dias antes de responder.
create or replace function public.closure_coordinator_slot(p_client_id uuid)
returns table (appointment_id uuid, starts_at timestamptz, dias integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then return; end if;
  if not (public.is_admin_master() or v_clinic in (select public.user_clinic_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
    select h.appointment_id, h.starts_at, h.dias
      from public._horario_com_coordenador(p_client_id, v_clinic) h;
end;
$$;
revoke execute on function public.closure_coordinator_slot(uuid) from public, anon, authenticated;
grant execute on function public.closure_coordinator_slot(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) "Sim": reavaliação — agora olhando o horário com o Coordenador (F1/F4/F5)
-- -----------------------------------------------------------------------------
drop function if exists public._fechamento_reavaliar(uuid, uuid);

create or replace function public._fechamento_reavaliar(
  p_id uuid,
  p_user uuid,
  p_far_choice text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_end boolean;
  v_name text;
  v_phase public.journey_phase;
  v_slot record;
  v_quando text;
  v_what text;
begin
  select * into v_f from public.treatment_closures where id = p_id;
  select full_name, journey_phase into v_name, v_phase from public.clients where id = v_f.client_id;
  v_end := not public._tratamento_em_aberto(v_f.client_id);

  update public.treatment_closures
     set status = 'reavaliacao', treatment_end = v_end, updated_at = now()
   where id = p_id;

  if v_end and v_phase = 'treatment_start' then
    perform public._jornada_mover_por_evento(v_f.client_id, 'reevaluation', 'fim_do_tratamento', p_user);
  end if;

  v_what := case v_f.scope when 'ortodontia' then 'a ortodontia'
                           when 'venda_direta' then 'a venda direta' else 'um plano' end;
  select * into v_slot from public._horario_com_coordenador(v_f.client_id, v_f.clinic_id);

  if v_slot.appointment_id is null then
    -- Sem horário com o Coordenador: a Recepção agenda.
    perform public._fechamento_avisar(
      v_f.clinic_id, array['receptionist']::public.user_role[], null,
      'Agendar reavaliação: ' || coalesce(v_name, 'Cliente'),
      coalesce(v_name, 'Cliente') || ' terminou ' || v_what
        || '. Agende a consulta de reavaliação com o Coordenador Clínico.',
      '/agenda?cliente=' || v_f.client_id || '&tipo=reevaluation',
      p_user);
    return;
  end if;

  v_quando := to_char(v_slot.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');

  if v_slot.dias <= 30 or p_far_choice = 'manter' then
    -- Perto (ou "manter"): a reavaliação é nesse horário; ninguém agenda de novo.
    update public.treatment_closures set
      linked_appointment_id = v_slot.appointment_id,
      wait_choice = case when v_slot.dias > 30 then 'manter' end,
      updated_at = now()
    where id = p_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, null, v_slot.provider_user_id,
      'Reavaliação do fim do tratamento: ' || coalesce(v_name, 'Cliente'),
      'A consulta de ' || v_quando || ' com ' || coalesce(v_name, 'o cliente')
        || ' também é a reavaliação do fim do tratamento. Veja as considerações na ficha.',
      '/prontuarios/' || v_f.client_id,
      p_user);
  elsif p_far_choice = 'antecipar' then
    update public.treatment_closures set
      linked_appointment_id = v_slot.appointment_id,
      wait_choice = 'antecipar',
      sooner_requested_at = now(), sooner_requested_by = p_user,
      updated_at = now()
    where id = p_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, array['receptionist']::public.user_role[], null,
      'Agendar reavaliação (prioridade): ' || coalesce(v_name, 'Cliente'),
      coalesce(v_name, 'Cliente') || ' terminou ' || v_what || '. Já tem horário com o Coordenador em '
        || v_quando || ' (faltam ' || v_slot.dias || ' dias), mas foi pedida uma reavaliação mais próxima.',
      '/agenda?cliente=' || v_f.client_id || '&tipo=reevaluation',
      p_user);
  else
    -- Longe e ninguém escolheu (Sim automático, "chamar para revisar"): o
    -- horário fica ligado e o Coordenador decide se antecipa (F5).
    update public.treatment_closures set
      linked_appointment_id = v_slot.appointment_id, updated_at = now()
    where id = p_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, array['clinical_coordinator']::public.user_role[], null,
      'Reavaliação distante: ' || coalesce(v_name, 'Cliente'),
      coalesce(v_name, 'Cliente') || ' terminou ' || v_what || '. O próximo horário com o Coordenador é '
        || v_quando || ' (faltam ' || v_slot.dias || ' dias). Na ficha dá para pedir uma reavaliação mais próxima.',
      '/prontuarios/' || v_f.client_id,
      p_user);
  end if;
end;
$$;
revoke execute on function public._fechamento_reavaliar(uuid, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) Abrir o fechamento: entra na decisão aberta, se houver (E1)
-- -----------------------------------------------------------------------------
create or replace function public._abrir_fechamento(
  p_scope text,
  p_client_id uuid,
  p_clinic_id uuid,
  p_plan_id uuid,
  p_direct_sale_id uuid,
  p_ortho_case_id uuid,
  p_asked uuid,
  p_auto_yes boolean,
  p_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_end boolean;
  v_name text;
  v_what text;
  v_lider public.treatment_closures;
  v_phase public.journey_phase;
begin
  v_end := not public._tratamento_em_aberto(p_client_id);

  select * into v_lider from public.treatment_closures
   where client_id = p_client_id and grouped_into is null
     and status in ('pergunta', 'coordenador', 'reavaliacao', 'contato')
   for update;

  if v_lider.id is not null then
    -- Já há uma decisão aberta: este fim entra nela (E1).
    insert into public.treatment_closures
      (clinic_id, client_id, scope, plan_id, direct_sale_id, ortho_case_id,
       treatment_end, asked_user_id, auto_yes, status, answer, answered_by, answered_at,
       dentist_notes, linked_appointment_id, wait_choice, grouped_into)
    values
      (p_clinic_id, p_client_id, p_scope, p_plan_id, p_direct_sale_id, p_ortho_case_id,
       v_end, p_asked, p_auto_yes, v_lider.status, v_lider.answer, v_lider.answered_by, v_lider.answered_at,
       v_lider.dentist_notes, v_lider.linked_appointment_id, v_lider.wait_choice, v_lider.id)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then return null; end if;

    update public.treatment_closures set treatment_end = v_end, updated_at = now()
     where id = v_lider.id;
    if v_end then
      update public.clients set journey_status = 'treatment_finished'
       where id = p_client_id and journey_phase = 'treatment_start';
      -- Já estava na reavaliação e agora não sobra nada: vai para a Fase 6.
      select journey_phase into v_phase from public.clients where id = p_client_id;
      if v_lider.status = 'reavaliacao' and v_phase = 'treatment_start' then
        perform public._jornada_mover_por_evento(p_client_id, 'reevaluation', 'fim_do_tratamento', p_user);
      end if;
    end if;
    -- D17: um procedimento de reavaliação obrigatória decide a pergunta aberta.
    if p_auto_yes and v_lider.status = 'pergunta' then
      update public.treatment_closures set answer = 'sim', answered_at = now(), auto_yes = true, updated_at = now()
       where id = v_lider.id;
      perform public._fechamento_reavaliar(v_lider.id, p_user);
    end if;
    return v_id;
  end if;

  insert into public.treatment_closures
    (clinic_id, client_id, scope, plan_id, direct_sale_id, ortho_case_id,
     treatment_end, asked_user_id, auto_yes, status, answer, answered_at)
  values
    (p_clinic_id, p_client_id, p_scope, p_plan_id, p_direct_sale_id, p_ortho_case_id,
     v_end, p_asked, p_auto_yes, 'pergunta',
     case when p_auto_yes then 'sim' end,
     case when p_auto_yes then now() end)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  if v_end then
    update public.clients set journey_status = 'treatment_finished'
     where id = p_client_id and journey_phase = 'treatment_start';
  end if;

  select full_name into v_name from public.clients where id = p_client_id;
  v_what := case p_scope
    when 'ortodontia' then 'a ortodontia (contenção entregue)'
    when 'venda_direta' then 'a venda direta'
    else 'um plano de tratamento' end;

  if p_auto_yes then
    perform public._fechamento_reavaliar(v_id, p_user);
  else
    perform public._fechamento_avisar(
      p_clinic_id,
      case when p_asked is null then array['clinical_coordinator']::public.user_role[] end,
      p_asked,
      'Decisão obrigatória: necessita de reavaliação?',
      coalesce(v_name, 'Cliente') || ' terminou ' || v_what
        || '. Responda na ficha do cliente: necessita de consulta de reavaliação com o Coordenador Clínico?',
      '/prontuarios/' || p_client_id,
      null);
  end if;

  return v_id;
end;
$$;
revoke execute on function public._abrir_fechamento(text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) O fim de um plano ou de uma venda direta (uma regra, dois gatilhos)
-- -----------------------------------------------------------------------------
create or replace function public._fechamento_do_plano(
  p_plan_id uuid,
  p_direct_sale_id uuid,
  p_client_id uuid,
  p_clinic_id uuid,
  p_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last public.treatment_sessions;
  v_provider uuid;
  v_asked uuid;
  v_owner boolean;
  v_auto boolean;
begin
  if p_plan_id is not null then
    -- Ainda sobra sessão deste plano (fora a Ortodontia, 0420)? Não terminou.
    if exists (select 1 from public.treatment_sessions s
                where s.plan_id = p_plan_id and s.status in ('pending', 'scheduled')
                  and not public._sessao_ortodontica(s.procedure_id)) then
      return null;
    end if;
    -- Só plano VENDIDO e não cancelado.
    if not exists (
      select 1 from public.plan_negotiations n
      join public.commercial_sales s on s.negotiation_id = n.id
      where n.plan_id = p_plan_id and s.closed_at is not null and s.cancelled_at is null
    ) then
      return null;
    end if;
    if exists (select 1 from public.treatment_closures f
                where f.plan_id = p_plan_id and f.outcome is distinct from 'reaberto') then
      return null;
    end if;
  else
    if exists (select 1 from public.treatment_sessions s
                where s.direct_sale_id = p_direct_sale_id and s.status in ('pending', 'scheduled')
                  and not public._sessao_ortodontica(s.procedure_id)) then
      return null;
    end if;
    -- 0422: venda direta só depois de FECHADA (termo assinado e pagamento confirmado).
    if not exists (select 1 from public.direct_sales d
                    where d.id = p_direct_sale_id and d.status = 'concluida') then
      return null;
    end if;
    if exists (select 1 from public.treatment_closures f
                where f.direct_sale_id = p_direct_sale_id and f.outcome is distinct from 'reaberto') then
      return null;
    end if;
  end if;

  -- Precisa ter ao menos uma sessão feita (fora a Ortodontia).
  select * into v_last from public.treatment_sessions s
   where s.status = 'done'
     and not public._sessao_ortodontica(s.procedure_id)
     and ((p_plan_id is not null and s.plan_id = p_plan_id)
          or (p_plan_id is null and s.direct_sale_id = p_direct_sale_id))
   order by s.done_at desc nulls last
   limit 1;
  if v_last.id is null then return null; end if;

  if p_plan_id is not null then
    update public.treatment_plans
       set lifecycle = 'concluido', lifecycle_at = now(), updated_at = now()
     where id = p_plan_id
       and coalesce(lifecycle::text, '') not in ('concluido', 'cancelado', 'reprovado');
  end if;

  -- Quem responde: quem executou a última sessão; o titular concluindo por
  -- outro profissional → o profissional do agendamento.
  select a.provider_user_id into v_provider
    from public.appointments a where a.id = v_last.appointment_id;
  select coalesce(p.is_owner, false) into v_owner
    from public.profiles p where p.id = v_last.executed_by;
  v_asked := case
    when v_last.executed_by is null then v_provider
    when coalesce(v_owner, false) and v_provider is not null
         and v_provider <> v_last.executed_by then v_provider
    else v_last.executed_by end;

  -- D17: procedimento com reavaliação obrigatória.
  select exists (
    select 1 from public.treatment_sessions s
    join public.procedures p on p.id = s.procedure_id
    where p.requires_reevaluation
      and ((p_plan_id is not null and s.plan_id = p_plan_id)
           or (p_plan_id is null and s.direct_sale_id = p_direct_sale_id))
  ) into v_auto;

  return public._abrir_fechamento(
    case when p_plan_id is not null then 'plano' else 'venda_direta' end,
    p_client_id, p_clinic_id, p_plan_id,
    case when p_plan_id is null then p_direct_sale_id end, null,
    v_asked, coalesce(v_auto, false), p_user);
end;
$$;
revoke execute on function public._fechamento_do_plano(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- O gatilho das sessões (a definição da 0420, com o fim do plano na regra acima).
create or replace function public.treatment_closure_on_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  begin
    -- (a) Reabertura: o cliente volta a "Em Tratamento"; a pergunta ainda sem
    --     resposta daquele plano é retirada (a sessão de Ortodontia não retira).
    if new.status in ('pending', 'scheduled')
       and (tg_op = 'INSERT' or old.status in ('done', 'cancelled')) then
      update public.clients set journey_status = 'in_treatment'
       where id = new.client_id
         and journey_phase = 'treatment_start'
         and journey_status = 'treatment_finished';
      update public.treatment_closures
         set status = 'encerrado', outcome = 'reaberto', closed_at = now(),
             closed_by = v_user, updated_at = now()
       where status in ('pergunta', 'coordenador')
         and grouped_into is null
         and not public._sessao_ortodontica(new.procedure_id)
         and ((new.plan_id is not null and plan_id = new.plan_id)
              or (new.direct_sale_id is not null and direct_sale_id = new.direct_sale_id));
      return null;
    end if;

    if tg_op <> 'UPDATE' or new.status <> 'done' or old.status = 'done' then
      return null;
    end if;

    -- (b) 1ª sessão feita: o plano passa a "Em tratamento".
    if new.plan_id is not null then
      update public.treatment_plans
         set lifecycle = 'em_tratamento', lifecycle_at = now(), updated_at = now()
       where id = new.plan_id
         and (lifecycle is null or lifecycle in ('aguardando_apresentacao', 'apresentado', 'aceito'));
    end if;

    -- Revisão e refação não refazem a pergunta; a sessão de Ortodontia (a
    -- instalação) nunca termina o plano (0420).
    if new.redo_kind is not null then return null; end if;
    if public._sessao_ortodontica(new.procedure_id) then return null; end if;

    if new.plan_id is not null or new.direct_sale_id is not null then
      perform public._fechamento_do_plano(
        new.plan_id, case when new.plan_id is null then new.direct_sale_id end,
        new.client_id, new.clinic_id, v_user);
    end if;
  exception when others then
    -- Nunca derruba a baixa da sessão.
    raise warning 'treatment_closure_on_session (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_session() from public, anon, authenticated;

-- A venda direta fechou depois das sessões: a decisão nasce agora.
create or replace function public.treatment_closure_on_direct_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.status = 'concluida' and old.status is distinct from 'concluida'
       and new.client_id is not null then
      perform public._fechamento_do_plano(null, new.id, new.client_id, new.clinic_id, (select auth.uid()));
    end if;
  exception when others then
    -- Nunca derruba o fechamento da venda.
    raise warning 'treatment_closure_on_direct_sale (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_direct_sale() from public, anon, authenticated;

drop trigger if exists treatment_closure_on_direct_sale on public.direct_sales;
create trigger treatment_closure_on_direct_sale
  after update of status on public.direct_sales
  for each row execute function public.treatment_closure_on_direct_sale();

-- -----------------------------------------------------------------------------
-- 8) A resposta: considerações (F2) e horário com o Coordenador (F4)
-- -----------------------------------------------------------------------------
drop function if exists public.answer_treatment_closure(uuid, text);

create or replace function public.answer_treatment_closure(
  p_id uuid,
  p_answer text,
  p_notes text default null,
  p_far_choice text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_user uuid := (select auth.uid());
  v_coord boolean;
  v_phase public.journey_phase;
  v_name text;
  v_slot record;
  v_notas text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  if p_answer not in ('sim', 'nao', 'nao_sei') then raise exception 'INVALID_ANSWER'; end if;
  if p_far_choice is not null and p_far_choice not in ('manter', 'antecipar') then
    raise exception 'INVALID_CHOICE';
  end if;

  select * into v_f from public.treatment_closures where id = p_id for update;
  if v_f.id is null then raise exception 'NOT_FOUND'; end if;
  if v_f.status in ('encerrado', 'agendar_avaliacao') then raise exception 'ALREADY_CLOSED'; end if;
  -- 0422: o seguidor acompanha a decisão do cliente; responde-se no líder.
  if v_f.grouped_into is not null then raise exception 'GROUPED'; end if;

  v_coord := public.is_admin_master()
    or public.has_role_in_clinic(v_f.clinic_id, array['clinical_coordinator']::public.user_role[]);

  select journey_phase, full_name into v_phase, v_name
    from public.clients where id = v_f.client_id;

  if v_f.status = 'pergunta' then
    if not (v_coord or v_f.asked_user_id = v_user) then raise exception 'NOT_ALLOWED'; end if;
    if p_answer = 'nao_sei' and v_coord and v_f.asked_user_id is distinct from v_user then
      raise exception 'COORDINATOR_DECIDES';
    end if;
    -- F2: no Sim e no Não sei, o Coordenador recebe as considerações.
    if p_answer in ('sim', 'nao_sei') and length(coalesce(v_notas, '')) < 10 then
      raise exception 'NOTES_REQUIRED';
    end if;
  elsif v_f.status = 'coordenador' then
    if not v_coord then raise exception 'NOT_ALLOWED'; end if;
    if p_answer = 'nao_sei' then raise exception 'COORDINATOR_DECIDES'; end if;
  else
    -- D21: o Coordenador muda a resposta enquanto nada aconteceu.
    if not v_coord then raise exception 'NOT_ALLOWED'; end if;
    if p_answer = 'nao_sei' or p_answer = v_f.answer then raise exception 'NOTHING_TO_CHANGE'; end if;
    if v_f.status = 'contato' and exists (
      select 1 from public.treatment_closure_contacts c where c.closure_id = p_id
    ) then
      raise exception 'ALREADY_ACTED';
    end if;
    if v_f.status = 'reavaliacao' and v_phase <> 'treatment_start' then
      raise exception 'ALREADY_ACTED';
    end if;
  end if;

  -- F4: Sim com o horário do Coordenador a mais de 30 dias → escolher.
  if p_answer = 'sim' then
    select * into v_slot from public._horario_com_coordenador(v_f.client_id, v_f.clinic_id);
    if v_slot.appointment_id is not null and v_slot.dias > 30 and p_far_choice is null then
      raise exception 'FAR_APPOINTMENT_CHOICE';
    end if;
  end if;

  update public.treatment_closures set
    answer = p_answer,
    answered_by = v_user,
    answered_at = now(),
    dentist_notes = case when v_f.status = 'pergunta' then coalesce(v_notas, dentist_notes) else dentist_notes end,
    changed_by_coordinator = changed_by_coordinator
      or (v_f.status in ('reavaliacao', 'contato', 'coordenador')
          or (v_coord and v_f.asked_user_id is distinct from v_user and v_f.asked_user_id is not null)),
    updated_at = now()
  where id = p_id;

  if p_answer = 'sim' then
    perform public._fechamento_reavaliar(p_id, v_user, p_far_choice);
  elsif p_answer = 'nao' then
    update public.treatment_closures
       set status = 'contato', treatment_end = not public._tratamento_em_aberto(v_f.client_id),
           linked_appointment_id = null, wait_choice = null,
           updated_at = now()
     where id = p_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, array['clinical_coordinator']::public.user_role[], null,
      'Contatar o cliente: ' || coalesce(v_name, 'Cliente'),
      coalesce(v_name, 'Cliente') || ' terminou o tratamento sem precisar de reavaliação. Ligue ou mande mensagem, pergunte se foi tudo bem e registre na ficha.'
        || case when v_notas is not null and v_f.status = 'pergunta' then ' Há considerações do dentista na ficha.' else '' end,
      '/prontuarios/' || v_f.client_id,
      v_user);
  else
    update public.treatment_closures set status = 'coordenador', updated_at = now() where id = p_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, array['clinical_coordinator']::public.user_role[], null,
      'Decisão urgente: necessita de reavaliação?',
      coalesce(v_name, 'Cliente') || ' — quem executou não soube definir e deixou considerações. Decida na ficha do cliente.',
      '/prontuarios/' || v_f.client_id,
      v_user);
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_f.clinic_id, 'update', 'treatment_closure', p_id::text,
          jsonb_build_object('answer', p_answer, 'from_status', v_f.status,
                             'far_choice', p_far_choice, 'notes', v_notas is not null));
end;
$$;
revoke execute on function public.answer_treatment_closure(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.answer_treatment_closure(uuid, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) O Coordenador pede a reavaliação mais próxima (F5)
-- -----------------------------------------------------------------------------
create or replace function public.request_sooner_reevaluation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_user uuid := (select auth.uid());
  v_name text;
  v_inicio timestamptz;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_f from public.treatment_closures where id = p_id for update;
  if v_f.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master()
          or public.has_role_in_clinic(v_f.clinic_id, array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_f.grouped_into is not null then raise exception 'GROUPED'; end if;
  if v_f.status <> 'reavaliacao' or v_f.linked_appointment_id is null then raise exception 'NOTHING_TO_CHANGE'; end if;
  if v_f.wait_choice = 'antecipar' then raise exception 'ALREADY_ACTED'; end if;
  select a.starts_at into v_inicio from public.appointments a where a.id = v_f.linked_appointment_id;
  if v_inicio is null or v_inicio <= now() then raise exception 'ALREADY_ACTED'; end if;

  update public.treatment_closures set
    wait_choice = 'antecipar', sooner_requested_at = now(), sooner_requested_by = v_user, updated_at = now()
  where id = p_id;

  select full_name into v_name from public.clients where id = v_f.client_id;
  perform public._fechamento_avisar(
    v_f.clinic_id, array['receptionist']::public.user_role[], null,
    'Agendar reavaliação (prioridade): ' || coalesce(v_name, 'Cliente'),
    coalesce(v_name, 'Cliente') || ' tem horário com o Coordenador em '
      || to_char(v_inicio at time zone 'America/Sao_Paulo', 'DD/MM')
      || ', mas o Coordenador pediu uma reavaliação mais próxima.',
    '/agenda?cliente=' || v_f.client_id || '&tipo=reevaluation',
    v_user);

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_f.clinic_id, 'update', 'treatment_closure', p_id::text,
          jsonb_build_object('sooner', true));
end;
$$;
revoke execute on function public.request_sooner_reevaluation(uuid) from public, anon, authenticated;
grant execute on function public.request_sooner_reevaluation(uuid) to authenticated;
