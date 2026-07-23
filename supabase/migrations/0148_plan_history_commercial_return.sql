-- =============================================================================
-- Risarte Odontologia — Migration 0148 (Módulo Comercial — ajuste da devolução
-- + HISTÓRICO por plano de tratamento)
--
-- 1) treatment_plan_events — cada plano tem seu próprio histórico detalhado:
--    criado → enviado ao Coordenador → aprovado/devolvido → enviado ao Comercial
--    → apresentado → aceito → em tratamento → concluído → devolvido pelo
--    Comercial → reaberto... Gravado automaticamente por TRIGGER nas mudanças de
--    status/ciclo de vida + eventos explícitos das RPCs. Backfill leve dos
--    planos existentes.
-- 2) Devolução 4→3 completa: o plano aprovado é REABERTO automaticamente
--    (status volta a rascunho) e as considerações do Consultor ficam gravadas
--    NO PLANO (commercial_return_note) — em destaque no cockpit do Planner.
--    O Planner recebe notificação que abre direto o cockpit dele.
-- 3) move_client_phase: aviso ao Planner passa a abrir o cockpit
--    (/planejamento/<cliente>) em vez da ficha.
-- Idempotente.
-- =============================================================================

-- 1) Histórico do plano ---------------------------------------------------------
create table if not exists public.treatment_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.treatment_plans (id) on delete cascade,
  clinic_id uuid references public.clinics (id),
  event_type text not null,
  description text,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists treatment_plan_events_plan_idx
  on public.treatment_plan_events (plan_id, created_at);

alter table public.treatment_plan_events enable row level security;

-- Leitura: quem enxerga o plano enxerga o histórico dele.
drop policy if exists "treatment_plan_events_select" on public.treatment_plan_events;
create policy "treatment_plan_events_select" on public.treatment_plan_events
  for select to authenticated
  using (exists (select 1 from public.treatment_plans tp where tp.id = plan_id));
-- (sem policy de INSERT — só triggers/RPCs SECURITY DEFINER gravam)

-- Colunas da devolução pelo Comercial (destaque no plano).
alter table public.treatment_plans
  add column if not exists commercial_return_note text;
alter table public.treatment_plans
  add column if not exists commercial_returned_at timestamptz;
alter table public.treatment_plans
  add column if not exists commercial_returned_by uuid references public.profiles (id);

-- Trigger: grava os eventos do fluxo automaticamente.
create or replace function public.log_treatment_plan_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    values (new.id, new.clinic_id, 'criado', 'Plano criado pelo Planner', v_actor);
    return new;
  end if;

  -- Mudança de status interno (rascunho → aprovação do Coordenador...).
  if old.status is distinct from new.status then
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    select new.id, new.clinic_id, e.t, e.d, v_actor
    from (select
      case
        when new.status = 'submitted' then 'enviado_aprovacao'
        when new.status = 'approved' then 'aprovado_coordenador'
        when new.status = 'returned' then 'devolvido_coordenador'
        when new.status = 'draft' and old.status in ('approved','submitted','returned') then 'reaberto'
      end as t,
      case
        when new.status = 'submitted' then 'Enviado para aprovação do Coordenador Clínico'
        when new.status = 'approved' then 'Aprovado pelo Coordenador Clínico'
        when new.status = 'returned' then 'Devolvido pelo Coordenador para revisão'
        when new.status = 'draft' and old.status in ('approved','submitted','returned') then 'Reaberto para edição'
      end as d
    ) e
    where e.t is not null;
  end if;

  -- Mudança do ciclo de vida (Comercial em diante).
  if old.lifecycle is distinct from new.lifecycle and new.lifecycle is not null then
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    values (new.id, new.clinic_id, 'lifecycle_' || new.lifecycle::text,
      case new.lifecycle::text
        when 'aguardando_apresentacao' then 'Enviado ao Comercial — aguardando apresentação'
        when 'apresentado' then 'Apresentado ao cliente'
        when 'aceito' then 'Aceito pelo cliente'
        when 'reprovado' then 'Reprovado pelo cliente'
        when 'em_tratamento' then 'Tratamento iniciado'
        when 'concluido' then 'Tratamento concluído'
        when 'cancelado' then 'Cancelado'
        when 'suspenso' then 'Suspenso'
        else new.lifecycle::text
      end,
      v_actor);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_treatment_plan_event_ins on public.treatment_plans;
create trigger trg_log_treatment_plan_event_ins
  after insert on public.treatment_plans
  for each row execute function public.log_treatment_plan_event();

drop trigger if exists trg_log_treatment_plan_event_upd on public.treatment_plans;
create trigger trg_log_treatment_plan_event_upd
  after update of status, lifecycle on public.treatment_plans
  for each row execute function public.log_treatment_plan_event();

-- Backfill leve dos planos existentes (idempotente: só onde não há evento).
insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id, created_at)
select tp.id, tp.clinic_id, 'criado', 'Plano criado pelo Planner', tp.created_by, tp.created_at
from public.treatment_plans tp
where not exists (select 1 from public.treatment_plan_events e
                  where e.plan_id = tp.id and e.event_type = 'criado');

insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, created_at)
select tp.id, tp.clinic_id, 'enviado_aprovacao',
       'Enviado para aprovação do Coordenador Clínico', tp.submitted_at
from public.treatment_plans tp
where tp.submitted_at is not null
  and not exists (select 1 from public.treatment_plan_events e
                  where e.plan_id = tp.id and e.event_type = 'enviado_aprovacao');

insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, created_at)
select tp.id, tp.clinic_id,
       case when tp.status = 'returned' then 'devolvido_coordenador' else 'aprovado_coordenador' end,
       case when tp.status = 'returned' then 'Devolvido pelo Coordenador para revisão'
            else 'Aprovado pelo Coordenador Clínico' end,
       tp.reviewed_at
from public.treatment_plans tp
where tp.reviewed_at is not null and tp.status in ('approved', 'returned')
  and not exists (select 1 from public.treatment_plan_events e
                  where e.plan_id = tp.id
                    and e.event_type in ('aprovado_coordenador', 'devolvido_coordenador'));

insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, created_at)
select tp.id, tp.clinic_id, 'lifecycle_' || tp.lifecycle::text,
       case tp.lifecycle::text
         when 'aguardando_apresentacao' then 'Enviado ao Comercial — aguardando apresentação'
         when 'apresentado' then 'Apresentado ao cliente'
         when 'aceito' then 'Aceito pelo cliente'
         when 'reprovado' then 'Reprovado pelo cliente'
         when 'em_tratamento' then 'Tratamento iniciado'
         when 'concluido' then 'Tratamento concluído'
         when 'cancelado' then 'Cancelado'
         when 'suspenso' then 'Suspenso'
         else tp.lifecycle::text
       end,
       coalesce(tp.lifecycle_at, tp.updated_at, tp.created_at)
from public.treatment_plans tp
where tp.lifecycle is not null
  and not exists (select 1 from public.treatment_plan_events e
                  where e.plan_id = tp.id and e.event_type like 'lifecycle_%');

-- 2) Devolução 4→3 completa -----------------------------------------------------
create or replace function public.return_commercial_to_planning(
  p_client_id uuid,
  p_considerations text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  -- O plano da apresentação (aprovado mais recente).
  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;

  -- Marca a negociação atual (se houver) como devolvida.
  update public.plan_negotiations set status = 'devolvida', updated_at = now()
  where client_id = p_client_id and status in ('em_negociacao', 'aguardando_autorizacao');

  if v_plan is not null then
    -- Evento explícito no HISTÓRICO do plano, com as considerações completas.
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    values (v_plan, v_clinic, 'devolvido_comercial',
      'Devolvido pelo Comercial — considerações do Consultor: ' || btrim(p_considerations),
      v_user);

    -- REABRE o plano para o Planner reconfigurar (mesmo plano, não um novo) e
    -- grava as considerações EM DESTAQUE no plano.
    update public.treatment_plans set
      status = 'draft',
      lifecycle = null,
      commercial_return_note = btrim(p_considerations),
      commercial_returned_at = now(),
      commercial_returned_by = v_user,
      updated_at = now()
    where id = v_plan;
  end if;

  -- Considerações também como informação complementar (histórico do cockpit).
  insert into public.planning_supplements (client_id, clinic_id, body, created_by)
  values (p_client_id, v_clinic,
    'DEVOLVIDO PELO COMERCIAL — considerações do Consultor:' || E'\n'
      || btrim(p_considerations),
    v_user);

  -- Move 4→3 (avisos padrão) + notificação FORTE abrindo direto o cockpit.
  perform public.move_client_phase(p_client_id, 'planning_center');

  select full_name into v_client_name from public.clients where id = p_client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_clinic,
    'Plano DEVOLVIDO pelo Comercial — reabrir e ajustar',
    coalesce(v_client_name, 'Cliente')
      || ' — o plano foi reaberto com as considerações do Consultor em destaque. '
      || 'Ajuste e envie novamente para aprovação.',
    '/planejamento/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
end;
$$;

revoke all on function public.return_commercial_to_planning(uuid, text) from public;
grant execute on function public.return_commercial_to_planning(uuid, text) to authenticated;

-- 3) move_client_phase: o aviso "Novo caso no Centro de Planejamento" passa a
--    abrir o COCKPIT do Planner. Recriação completa (idêntica à 0147, exceto o
--    link do bloco planning_center: /clientes/ → /planejamento/).
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

  v_allowed := public.is_admin_master();
  if not v_allowed then
    v_allowed := case
      when v_old = 'acquisition' and p_new_phase = 'clinical_conversion'
        then public.has_role_in_clinic(v_clinic, array['receptionist','sdr']::public.user_role[])
      when v_old = 'clinical_conversion' and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'planning_center' and p_new_phase = 'commercial_conversion'
        then exists (select 1 from public.user_clinic_roles ucr where ucr.user_id = v_user and ucr.role = 'planner_dentist')
      when v_old = 'planning_center' and p_new_phase in ('clinical_conversion', 'reevaluation')
        then exists (select 1 from public.user_clinic_roles ucr where ucr.user_id = v_user and ucr.role = 'planner_dentist')
      when v_old = 'commercial_conversion' and p_new_phase = 'treatment_start'
        then exists (select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p where p.user_id = v_user)
      when v_old = 'commercial_conversion' and p_new_phase = 'planning_center'
        then exists (select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p where p.user_id = v_user)
      when v_old = 'treatment_start' and p_new_phase in ('reevaluation', 'follow_up')
        then public.has_role_in_clinic(v_clinic, array['receptionist']::public.user_role[])
      when v_old = 'treatment_start' and p_new_phase = 'planning_center'
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'reevaluation' and p_new_phase in ('follow_up', 'planning_center')
        then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
      when v_old = 'follow_up' and p_new_phase = 'reevaluation'
        then public.has_role_in_clinic(v_clinic, array['sdr']::public.user_role[])
      else false
    end;
  end if;

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
          jsonb_build_object('from', v_old, 'to', p_new_phase));
end;
$$;
