-- =============================================================================
-- 0421 — FIM DO TRATAMENTO, ETAPA 3: O CONTROLE DE QUALIDADE
--
-- Plano e decisões do dono (16/11/2026): docs/jornada/FIM-DO-TRATAMENTO-PLANO.md
-- (D1, D7, D8, D18, D22, D23, D24, C1 e a seção 4).
--
-- O QUE MUDA:
--   1) Os CINCO NÍVEIS na avaliação presencial do Coordenador, por
--      procedimento: Excelente, Bom, Aceitável (aprovados), Revisar, Refazer
--      (`plan_quality_reviews.level`). As avaliações antigas são convertidas
--      (D8): aprovado → bom, revisão → revisar, reprovado → refazer. A coluna
--      `status` continua (aprovado / revisao / reprovado) e é derivada do
--      nível — quem já lia o status continua certo.
--   2) `set_plan_item_quality` ganha `p_level` e:
--        * a trava "100% aprovado" passa a contar os itens da opção VENDIDA
--          (sem os excluídos na negociação), não a opção principal;
--        * com tudo aprovado, o fechamento do plano que esperava a
--          reavaliação é encerrado ("reavaliado");
--        * Excelente avisa quem executou (D24).
--   3) Fechamento sem itens de plano (ortodontia, venda direta): o
--      Coordenador registra UM nível para a reavaliação
--      (`register_closure_quality`).
--   4) O contato com o cliente (D18) registra a SATISFAÇÃO (0 a 10) e se tem
--      QUEIXA; queixa obriga "chamar para revisar". Os cinco níveis ficam só
--      para a avaliação presencial.
--   5) Sair da Reavaliação (D23, D22): `conclude_reevaluation` — só com a
--      avaliação concluída e nada para revisar ou refazer; grava a data do
--      retorno (sugerida: 6 meses) e avisa a Recepção.
--   6) Reavaliação concluída na Fase 5 não encerra mais o fechamento sozinha:
--      quem encerra é a avaliação (sai o bloco (c) da 0418).
--
-- Nada apaga dado. A conversão do item 1 só preenche a coluna nova.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os cinco níveis
-- -----------------------------------------------------------------------------
alter table public.plan_quality_reviews
  add column if not exists level text;

do $$
begin
  alter table public.plan_quality_reviews
    add constraint plan_quality_reviews_level_chk
    check (level is null or level in ('excelente', 'bom', 'aceitavel', 'revisar', 'refazer'));
exception when duplicate_object then null;
end $$;

-- D8: as avaliações antigas viram o nível correspondente (só o que está vazio).
update public.plan_quality_reviews
   set level = case status
                 when 'aprovado' then 'bom'
                 when 'revisao' then 'revisar'
                 when 'reprovado' then 'refazer'
               end
 where level is null;

alter table public.treatment_closures
  add column if not exists quality_level text,
  add column if not exists quality_note text;

do $$
begin
  alter table public.treatment_closures
    add constraint treatment_closures_quality_level_chk
    check (quality_level is null or quality_level in ('excelente', 'bom', 'aceitavel', 'revisar', 'refazer'));
exception when duplicate_object then null;
end $$;

-- A satisfação do cliente no contato (D18).
alter table public.treatment_closure_contacts
  add column if not exists satisfaction smallint,
  add column if not exists has_complaint boolean;

do $$
begin
  alter table public.treatment_closure_contacts
    add constraint treatment_closure_contacts_satisfaction_chk
    check (satisfaction is null or satisfaction between 0 and 10);
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2) A avaliação por procedimento, com o nível
-- -----------------------------------------------------------------------------
-- A definição em vigor (0145, conferida no banco de treino) com: o nível, a
-- trava pela opção vendida, o fechamento encerrado e o aviso do Excelente.
drop function if exists public.set_plan_item_quality(uuid, text, text, uuid, text, uuid, text);

create or replace function public.set_plan_item_quality(
  p_item_id uuid,
  p_status text,
  p_note text default null,
  p_executor uuid default null,
  p_resolution text default null,
  p_assigned uuid default null,
  p_replan_reason text default null,
  p_level text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_clinic uuid;
  v_client uuid;
  v_name text;
  v_proc text;
  v_locked boolean;
  v_option uuid;
  v_neg uuid;
  v_total int;
  v_approved int;
  v_sess_total int;
  v_sess_open int;
  v_level text;
  v_status text;
  v_user uuid := (select auth.uid());
begin
  -- 0421: o nível manda; sem nível (chamada antiga), o status de sempre.
  if p_level is not null then
    if p_level not in ('excelente', 'bom', 'aceitavel', 'revisar', 'refazer') then
      raise exception 'INVALID_LEVEL';
    end if;
    v_level := p_level;
    v_status := case p_level
      when 'revisar' then 'revisao'
      when 'refazer' then 'reprovado'
      else 'aprovado' end;
  else
    if p_status not in ('aprovado', 'revisao', 'reprovado') then
      raise exception 'INVALID_STATUS';
    end if;
    v_status := p_status;
    v_level := case p_status
      when 'aprovado' then 'bom'
      when 'revisao' then 'revisar'
      else 'refazer' end;
  end if;

  select o.plan_id, i.clinic_id, i.description
    into v_plan, v_clinic, v_proc
  from public.treatment_plan_option_items i
  join public.treatment_plan_options o on o.id = i.option_id
  where i.id = p_item_id;
  if v_plan is null then raise exception 'ITEM_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select quality_locked into v_locked from public.treatment_plans where id = v_plan;
  if v_locked then raise exception 'LOCKED'; end if;

  -- Só finalizado: precisa ter sessões e todas realizadas (done).
  select count(*), count(*) filter (where status <> 'done')
    into v_sess_total, v_sess_open
  from public.treatment_sessions where item_id = p_item_id;
  if v_sess_total = 0 or v_sess_open > 0 then
    raise exception 'NOT_FINALIZED';
  end if;

  -- D7: observação obrigatória em Revisar e Refazer.
  if v_status in ('revisao', 'reprovado') and coalesce(btrim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED';
  end if;
  if v_status = 'reprovado' then
    if p_resolution is null or p_resolution not in ('redo_same','redo_other','replan') then
      raise exception 'RESOLUTION_REQUIRED';
    end if;
    if p_resolution = 'redo_other' and p_assigned is null then
      raise exception 'ASSIGNED_REQUIRED';
    end if;
    if p_resolution = 'replan'
       and (p_replan_reason is null or p_replan_reason not in ('falha','inviabilidade')) then
      raise exception 'REPLAN_REASON_REQUIRED';
    end if;
  end if;

  select client_id into v_client from public.treatment_plans where id = v_plan;
  select full_name into v_name from public.clients where id = v_client;

  insert into public.plan_quality_reviews
    (plan_id, item_id, clinic_id, status, level, note, executor_dentist_id,
     resolution, assigned_dentist_id, replan_reason, replan_carried,
     reviewed_by, reviewed_at)
  values (v_plan, p_item_id, v_clinic, v_status, v_level, nullif(btrim(p_note), ''),
     p_executor,
     case when v_status = 'revisao' then 'revise'
          when v_status = 'reprovado' then p_resolution
          else null end,
     case when v_status = 'reprovado' and p_resolution = 'redo_other' then p_assigned else null end,
     case when v_status = 'reprovado' and p_resolution = 'replan' then p_replan_reason else null end,
     false,
     v_user, now())
  on conflict (item_id) do update
    set status = excluded.status, level = excluded.level, note = excluded.note,
        executor_dentist_id = excluded.executor_dentist_id,
        resolution = excluded.resolution,
        assigned_dentist_id = excluded.assigned_dentist_id,
        replan_reason = excluded.replan_reason,
        replan_carried = false,
        reviewed_by = excluded.reviewed_by, reviewed_at = now();

  if v_status = 'revisao' or (v_status = 'reprovado' and p_resolution = 'redo_same') then
    if p_executor is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (p_executor, v_clinic,
        case when v_status = 'revisao' then 'Procedimento para revisar'
             else 'Procedimento reprovado — refazer' end,
        coalesce(v_name,'Cliente') || ' — ' || coalesce(v_proc,'procedimento') ||
          '. Motivo: ' || coalesce(btrim(p_note),''),
        '/prontuarios/' || v_client);
    end if;
  elsif v_status = 'reprovado' and p_resolution = 'redo_other' then
    if p_executor is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (p_executor, v_clinic, 'Procedimento reprovado no controle de qualidade',
        coalesce(v_name,'Cliente') || ' — ' || coalesce(v_proc,'procedimento') ||
          ' foi reprovado; outro profissional irá refazer.',
        '/prontuarios/' || v_client);
    end if;
    if p_assigned is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (p_assigned, v_clinic, 'Novo procedimento para refazer',
        coalesce(v_name,'Cliente') || ' — refazer ' || coalesce(v_proc,'procedimento') ||
          '. Veja o plano e o motivo no prontuário.',
        '/prontuarios/' || v_client);
    end if;
  elsif v_level = 'excelente' and p_executor is not null and p_executor is distinct from v_user then
    -- D24: o Excelente também chega a quem executou.
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (p_executor, v_clinic, 'Procedimento avaliado como Excelente',
      coalesce(v_name,'Cliente') || ' — ' || coalesce(v_proc,'procedimento') ||
        ' recebeu Excelente no controle de qualidade do Coordenador.',
      '/prontuarios/' || v_client);
  end if;

  -- Reabre o procedimento conforme a resolução (o procedimento volta a "aberto").
  if v_status = 'revisao' then
    if not exists (
      select 1 from public.treatment_sessions ts
      where ts.item_id = p_item_id and ts.status <> 'done'
        and ts.redo_kind = 'revisao'
    ) then
      insert into public.treatment_sessions
        (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
         session_index, session_total, name, redo_kind)
      select v_client, v_clinic, v_plan, p_item_id, i.procedure_id,
        coalesce(v_proc, 'Procedimento'),
        coalesce((select max(session_index) from public.treatment_sessions
                  where item_id = p_item_id), 0) + 1,
        1, 'Revisão do procedimento', 'revisao'
      from public.treatment_plan_option_items i where i.id = p_item_id;
    end if;
  elsif v_status = 'reprovado' and p_resolution in ('redo_same','redo_other') then
    update public.treatment_sessions
      set status = 'pending', done_at = null, executed_by = null,
          appointment_id = null, redo_kind = 'refacao'
    where item_id = p_item_id;
  end if;

  -- 0421: a trava conta os itens da opção VENDIDA (sem os excluídos na
  -- negociação); sem venda, a opção principal, como antes.
  select n.id, n.option_id into v_neg, v_option
    from public.plan_negotiations n
    join public.commercial_sales s on s.negotiation_id = n.id
   where n.plan_id = v_plan and n.status = 'aceita'
     and s.closed_at is not null and s.cancelled_at is null
   order by s.closed_at desc
   limit 1;
  if v_option is null then
    select id into v_option from public.treatment_plan_options
      where plan_id = v_plan order by is_primary desc, sort_order limit 1;
  end if;

  select count(*) into v_total
    from public.treatment_plan_option_items i
   where i.option_id = v_option
     and not exists (
       select 1 from public.plan_negotiation_items ni
        where ni.negotiation_id = v_neg and ni.item_id = i.id and ni.included = false);
  select count(*) into v_approved
    from public.plan_quality_reviews r
    join public.treatment_plan_option_items i on i.id = r.item_id
   where i.option_id = v_option and r.status = 'aprovado'
     and not exists (
       select 1 from public.plan_negotiation_items ni
        where ni.negotiation_id = v_neg and ni.item_id = i.id and ni.included = false);

  if v_total > 0 and v_approved = v_total then
    update public.treatment_plans
      set quality_locked = true, quality_locked_at = now()
    where id = v_plan;
    -- O fechamento do plano que esperava a reavaliação termina aqui.
    update public.treatment_closures
       set status = 'encerrado', outcome = 'reavaliado',
           closed_by = v_user, closed_at = now(), updated_at = now()
     where plan_id = v_plan and status = 'reavaliacao';
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'plan_quality_review', p_item_id::text,
    jsonb_build_object('status', v_status, 'level', v_level, 'resolution', p_resolution,
                       'replan_reason', p_replan_reason));
end;
$$;
revoke execute on function public.set_plan_item_quality(uuid, text, text, uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_plan_item_quality(uuid, text, text, uuid, text, uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Reavaliação sem itens de plano (ortodontia, venda direta): um nível
-- -----------------------------------------------------------------------------
create or replace function public.register_closure_quality(
  p_id uuid,
  p_level text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_user uuid := (select auth.uid());
  v_name text;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_f from public.treatment_closures where id = p_id for update;
  if v_f.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master()
          or public.has_role_in_clinic(v_f.clinic_id, array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_f.status <> 'reavaliacao' then raise exception 'NOT_IN_REEVALUATION'; end if;
  -- Plano tem itens: a avaliação é por procedimento, no cockpit.
  if v_f.scope = 'plano' then raise exception 'USE_ITEM_EVALUATION'; end if;
  if p_level is null or p_level not in ('excelente', 'bom', 'aceitavel', 'revisar', 'refazer') then
    raise exception 'INVALID_LEVEL';
  end if;
  if p_level in ('revisar', 'refazer') and coalesce(btrim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED';
  end if;

  if p_level in ('excelente', 'bom', 'aceitavel') then
    update public.treatment_closures set
      quality_level = p_level, quality_note = nullif(btrim(p_note), ''),
      status = 'encerrado', outcome = 'reavaliado',
      closed_by = v_user, closed_at = now(), updated_at = now()
    where id = p_id;
  else
    -- Revisar/Refazer: a tarefa continua aberta até a nova avaliação.
    update public.treatment_closures set
      quality_level = p_level, quality_note = nullif(btrim(p_note), ''), updated_at = now()
    where id = p_id;
    select full_name into v_name from public.clients where id = v_f.client_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, array['receptionist']::public.user_role[], null,
      'Agendar revisão: ' || coalesce(v_name, 'Cliente'),
      coalesce(v_name, 'Cliente') || ' — o Coordenador pediu '
        || case p_level when 'revisar' then 'revisão' else 'refação' end
        || ' na reavaliação. Motivo: ' || btrim(p_note),
      '/agenda?cliente=' || v_f.client_id || '&tipo=' || case p_level when 'revisar' then 'revision' else 'redo' end,
      v_user);
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_f.clinic_id, 'update', 'treatment_closure', p_id::text,
          jsonb_build_object('quality_level', p_level));
end;
$$;
revoke execute on function public.register_closure_quality(uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_closure_quality(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O contato com satisfação e queixa (D18)
-- -----------------------------------------------------------------------------
drop function if exists public.register_closure_contact(uuid, text, boolean, text, text, date);

create or replace function public.register_closure_contact(
  p_id uuid,
  p_channel text,
  p_reached boolean,
  p_summary text,
  p_outcome text default null,
  p_return_date date default null,
  p_satisfaction smallint default null,
  p_complaint boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_user uuid := (select auth.uid());
  v_end boolean;
  v_fails integer;
  v_name text;
  v_phase public.journey_phase;
  v_return date;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_f from public.treatment_closures where id = p_id for update;
  if v_f.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master()
          or public.has_role_in_clinic(v_f.clinic_id, array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_f.status <> 'contato' then raise exception 'NOT_IN_CONTACT'; end if;
  if p_channel not in ('ligacao', 'mensagem', 'presencial') then raise exception 'INVALID_CHANNEL'; end if;

  if p_reached then
    if length(btrim(coalesce(p_summary, ''))) < 5 then raise exception 'SUMMARY_REQUIRED'; end if;
    -- D18: falou com o cliente → satisfação e queixa são obrigatórias.
    if p_satisfaction is null or p_satisfaction not between 0 and 10 or p_complaint is null then
      raise exception 'SATISFACTION_REQUIRED';
    end if;
    if p_outcome is null or p_outcome not in ('revisar', 'aguardar_retorno', 'novo_planejamento') then
      raise exception 'OUTCOME_REQUIRED';
    end if;
    -- Queixa obriga chamar para revisar.
    if p_complaint and p_outcome <> 'revisar' then
      raise exception 'COMPLAINT_REQUIRES_REVIEW';
    end if;
  else
    if p_outcome is not null and p_outcome <> 'sem_contato' then raise exception 'INVALID_OUTCOME'; end if;
  end if;
  if p_return_date is not null and p_return_date <= public.today_br() then
    raise exception 'RETURN_DATE_PAST';
  end if;

  insert into public.treatment_closure_contacts
    (closure_id, clinic_id, client_id, channel, reached, summary,
     satisfaction, has_complaint, recorded_by)
  values (p_id, v_f.clinic_id, v_f.client_id, p_channel, p_reached,
          nullif(btrim(p_summary), ''),
          case when p_reached then p_satisfaction end,
          case when p_reached then p_complaint end,
          v_user);

  -- D6: "sem contato" só depois de 3 tentativas sem falar com o cliente.
  if p_outcome = 'sem_contato' then
    select count(*) into v_fails from public.treatment_closure_contacts
     where closure_id = p_id and not reached;
    if v_fails < 3 then raise exception 'NEEDS_THREE_ATTEMPTS'; end if;
  end if;

  if p_outcome is null then
    return;  -- tentativa registrada; a tarefa continua aberta.
  end if;

  select full_name, journey_phase into v_name, v_phase from public.clients where id = v_f.client_id;
  v_end := not public._tratamento_em_aberto(v_f.client_id);

  if p_outcome = 'revisar' then
    update public.treatment_closures
       set outcome_note = nullif(btrim(p_summary), ''), updated_at = now()
     where id = p_id;
    perform public._fechamento_reavaliar(p_id, v_user);
  else
    v_return := coalesce(p_return_date, (public.today_br() + interval '6 months')::date);
    update public.treatment_closures set
      status = 'encerrado',
      outcome = p_outcome,
      outcome_note = nullif(btrim(p_summary), ''),
      return_date = case when p_outcome in ('aguardar_retorno', 'sem_contato') then v_return end,
      treatment_end = v_end,
      closed_by = v_user, closed_at = now(), updated_at = now()
    where id = p_id;

    if v_end and v_phase = 'treatment_start' then
      if p_outcome = 'novo_planejamento' then
        perform public._jornada_mover_por_evento(v_f.client_id, 'planning_center', 'fim_do_tratamento', v_user);
        insert into public.notifications (user_id, clinic_id, title, body, link)
        select distinct ucr.user_id, v_f.clinic_id, 'Novo caso no Centro de Planejamento',
               coalesce(v_name, 'Cliente') || ' — o Coordenador indicou novo planejamento no fim do tratamento.',
               '/prontuarios/' || v_f.client_id
          from public.user_clinic_roles ucr where ucr.role = 'planner_dentist';
      else
        perform public._jornada_mover_por_evento(v_f.client_id, 'follow_up', 'fim_do_tratamento', v_user, v_return);
        perform public._fechamento_avisar(
          v_f.clinic_id, array['receptionist']::public.user_role[], null,
          'Agendar retorno (acompanhamento): ' || coalesce(v_name, 'Cliente'),
          coalesce(v_name, 'Cliente') || ' terminou o tratamento. Retorno previsto para '
            || to_char(v_return, 'DD/MM/YYYY') || '.',
          '/agenda?cliente=' || v_f.client_id || '&tipo=return_visit',
          v_user);
      end if;
    end if;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_f.clinic_id, 'update', 'treatment_closure', p_id::text,
          jsonb_build_object('contact', p_channel, 'reached', p_reached, 'outcome', p_outcome,
                             'satisfaction', p_satisfaction, 'complaint', p_complaint));
end;
$$;
revoke execute on function public.register_closure_contact(uuid, text, boolean, text, text, date, smallint, boolean) from public, anon, authenticated;
grant execute on function public.register_closure_contact(uuid, text, boolean, text, text, date, smallint, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Sair da Reavaliação (D23, D22)
-- -----------------------------------------------------------------------------
create or replace function public.conclude_reevaluation(
  p_client_id uuid,
  p_return_date date default null
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_phase public.journey_phase;
  v_name text;
  v_user uuid := (select auth.uid());
  v_return date;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select clinic_id, journey_phase, full_name into v_clinic, v_phase, v_name
    from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not (public.is_admin_master()
          or public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_phase <> 'reevaluation' then raise exception 'WRONG_PHASE'; end if;

  -- D23: só com a avaliação concluída e nada para revisar ou refazer.
  if exists (select 1 from public.treatment_closures f
              where f.client_id = p_client_id and f.status = 'reavaliacao') then
    raise exception 'QUALITY_PENDING';
  end if;
  if exists (
    select 1 from public.plan_quality_reviews r
    join public.treatment_plans tp on tp.id = r.plan_id
    where tp.client_id = p_client_id
      and not tp.quality_locked
      and (r.status = 'revisao'
           or (r.status = 'reprovado' and r.resolution in ('redo_same', 'redo_other')))
  ) then
    raise exception 'QUALITY_PENDING';
  end if;

  if p_return_date is not null and p_return_date <= public.today_br() then
    raise exception 'RETURN_DATE_PAST';
  end if;
  v_return := coalesce(p_return_date, (public.today_br() + interval '6 months')::date);

  perform public._jornada_mover_por_evento(p_client_id, 'follow_up', 'concluir_reavaliacao', v_user, v_return);

  perform public._fechamento_avisar(
    v_clinic, array['receptionist']::public.user_role[], null,
    'Agendar retorno (acompanhamento): ' || coalesce(v_name, 'Cliente'),
    coalesce(v_name, 'Cliente') || ' concluiu a reavaliação. Retorno previsto para '
      || to_char(v_return, 'DD/MM/YYYY') || '.',
    '/agenda?cliente=' || p_client_id || '&tipo=return_visit',
    v_user);
  return v_return;
end;
$$;
revoke execute on function public.conclude_reevaluation(uuid, date) from public, anon, authenticated;
grant execute on function public.conclude_reevaluation(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) A agenda: a reavaliação concluída na Fase 5 não encerra mais sozinha
-- -----------------------------------------------------------------------------
-- A definição em vigor (0418) sem o bloco (c).
create or replace function public.treatment_closure_on_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_phase public.journey_phase;
  v_name text;
begin
  begin
    select journey_phase, full_name into v_phase, v_name
      from public.clients where id = new.client_id;

    -- (a) D13: urgência/emergência CONCLUÍDA de quem ainda é Fase 1 e não
    --     tem tratamento → a Recepção agenda a avaliação completa.
    if new.type in ('urgency', 'emergency')
       and new.status = 'completed'
       and (tg_op = 'INSERT' or old.status is distinct from 'completed')
       and v_phase = 'acquisition'
       and not public._tratamento_em_aberto(new.client_id) then
      insert into public.treatment_closures
        (clinic_id, client_id, scope, appointment_id, status)
      values (new.clinic_id, new.client_id, 'urgencia', new.id, 'agendar_avaliacao')
      on conflict do nothing;
      if found then
        perform public._fechamento_avisar(
          new.clinic_id, array['receptionist']::public.user_role[], null,
          'Agendar avaliação completa: ' || coalesce(v_name, 'Cliente'),
          coalesce(v_name, 'Cliente') || ' foi atendido(a) na urgência. Agende a avaliação completa com o Coordenador Clínico.',
          '/agenda?cliente=' || new.client_id || '&tipo=evaluation',
          v_user);
      end if;
    end if;

    -- (b) Avaliação agendada resolve a tarefa da urgência.
    if new.type = 'evaluation'
       and new.status in ('scheduled', 'confirmed', 'completed') then
      update public.treatment_closures
         set status = 'encerrado', outcome = 'avaliacao_agendada',
             closed_at = now(), closed_by = v_user, updated_at = now()
       where client_id = new.client_id and status = 'agendar_avaliacao';
    end if;

    -- 0421: o bloco (c) da 0418 saiu — a reavaliação do fim do plano termina
    -- com a AVALIAÇÃO do Coordenador (cinco níveis), não com o agendamento.
  exception when others then
    raise warning 'treatment_closure_on_appointment (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_appointment() from public, anon, authenticated;
