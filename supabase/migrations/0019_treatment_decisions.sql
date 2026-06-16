-- =============================================================================
-- Risarte Odontologia — Migration 0019 (Lote Base da Jornada, passo 5)
-- Mandatory decisions at the end of treatment:
--   "Necessita reavaliação?" → SIM: Fase 6 / NÃO: pergunta "Necessita novo
--   planejamento?" → SIM: Fase 3 / NÃO: Fase 7. NÃO SEI → escala ao Coordenador.
-- The Gerente is notified while a decision is pending.
-- =============================================================================

create type public.decision_kind as enum
  ('needs_reevaluation', 'needs_new_planning');
create type public.decision_answer as enum ('yes', 'no', 'unsure');

create table public.journey_decisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  kind public.decision_kind not null,
  assignee_user_id uuid references public.profiles (id), -- null = any coordinator
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  answer public.decision_answer
);

create index journey_decisions_open_idx
  on public.journey_decisions (client_id) where resolved_at is null;

alter table public.journey_decisions enable row level security;

create policy "journey_decisions_select"
  on public.journey_decisions for select
  to authenticated
  using (
    public.is_admin_master()
    or exists (select 1 from public.clients c where c.id = journey_decisions.client_id)
  );
-- Writes happen only via security-definer functions.

-- -----------------------------------------------------------------------------
-- When treatment is finished, open the "needs reevaluation?" decision and warn
-- the professional (or coordinators) and the manager.
-- -----------------------------------------------------------------------------
create function public.handle_treatment_finished()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee uuid;
  v_name text;
begin
  if new.journey_status is distinct from old.journey_status
     and new.journey_status = 'treatment_finished' then

    if exists (
      select 1 from public.journey_decisions
      where client_id = new.id and kind = 'needs_reevaluation' and resolved_at is null
    ) then
      return new;
    end if;

    select provider_user_id into v_assignee
    from public.appointments
    where client_id = new.id and type in ('treatment_start', 'treatment_session')
    order by starts_at desc limit 1;

    insert into public.journey_decisions (client_id, clinic_id, kind, assignee_user_id)
    values (new.id, new.clinic_id, 'needs_reevaluation', v_assignee);

    select full_name into v_name from public.clients where id = new.id;

    if v_assignee is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_assignee, new.clinic_id,
              'Decisão obrigatória: necessita reavaliação?',
              v_name || ' — tratamento finalizado. Responda na ficha do cliente.',
              '/clientes/' || new.id);
    else
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, new.clinic_id,
             'Decisão obrigatória: necessita reavaliação?',
             v_name || ' — tratamento finalizado. Responda na ficha do cliente.',
             '/clientes/' || new.id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = new.clinic_id and ucr.role = 'clinical_coordinator';
    end if;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, new.clinic_id,
           'Cliente aguardando decisão (reavaliação)',
           v_name || ' — tratamento finalizado, aguardando definição.',
           '/clientes/' || new.id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = new.clinic_id and ucr.role = 'unit_manager';
  end if;
  return new;
end;
$$;

create trigger clients_treatment_finished
  after update on public.clients
  for each row execute function public.handle_treatment_finished();

-- -----------------------------------------------------------------------------
-- answer_decision: applies the decision outcome (moves the client / chains the
-- next decision) and notifies the people responsible for the next step.
-- -----------------------------------------------------------------------------
create function public.answer_decision(
  p_decision_id uuid,
  p_answer public.decision_answer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_clinic uuid;
  v_kind public.decision_kind;
  v_assignee uuid;
  v_resolved timestamptz;
  v_user uuid := (select auth.uid());
  v_name text;
  v_new public.journey_phase;
begin
  select client_id, clinic_id, kind, assignee_user_id, resolved_at
    into v_client, v_clinic, v_kind, v_assignee, v_resolved
  from public.journey_decisions where id = p_decision_id;
  if v_client is null then raise exception 'DECISION_NOT_FOUND'; end if;
  if v_resolved is not null then raise exception 'ALREADY_RESOLVED'; end if;

  -- Who may answer: the assignee, a coordinator of the clinic, or admin.
  if not (
    public.is_admin_master()
    or v_assignee = v_user
    or public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select full_name into v_name from public.clients where id = v_client;

  -- "Não sei" on the reevaluation question escalates to the coordinator.
  if v_kind = 'needs_reevaluation' and p_answer = 'unsure' then
    update public.journey_decisions
    set assignee_user_id = null
    where id = p_decision_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
           'Decisão urgente: necessita reavaliação?',
           v_name || ' — o profissional não soube definir. Decida na ficha.',
           '/clientes/' || v_client
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;
    return;
  end if;

  update public.journey_decisions
  set resolved_at = now(), resolved_by = v_user, answer = p_answer
  where id = p_decision_id;

  v_new := null;

  if v_kind = 'needs_reevaluation' then
    if p_answer = 'yes' then
      v_new := 'reevaluation';
    else
      -- NÃO → chain the "needs new planning?" decision for the coordinator.
      insert into public.journey_decisions (client_id, clinic_id, kind, assignee_user_id)
      values (v_client, v_clinic, 'needs_new_planning', null);
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic,
             'Decisão obrigatória: necessita novo planejamento?',
             v_name || ' — responda na ficha do cliente.',
             '/clientes/' || v_client
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator'
        and ucr.user_id is distinct from v_user;
    end if;
  elsif v_kind = 'needs_new_planning' then
    if p_answer = 'yes' then
      v_new := 'planning_center';
    else
      v_new := 'follow_up';
    end if;
  end if;

  if v_new is not null then
    update public.journey_phase_history set exited_at = now()
    where client_id = v_client and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_client, v_clinic, v_new, v_user);
    update public.clients set journey_phase = v_new, phase_entered_at = now()
    where id = v_client;

    -- Tell reception what to schedule next.
    if v_new = 'reevaluation' then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic, 'Agendar reavaliação: ' || v_name,
             v_name, '/agenda?cliente=' || v_client
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
    elsif v_new = 'planning_center' then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, v_clinic, 'Novo caso no Centro de Planejamento',
             v_name, '/clientes/' || v_client
      from public.user_clinic_roles ucr where ucr.role = 'planner_dentist';
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic, 'Agendar apresentação comercial: ' || v_name,
             v_name, '/agenda?cliente=' || v_client
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
    elsif v_new = 'follow_up' then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic, 'Agendar retorno (controle de retorno): ' || v_name,
             v_name, '/agenda?cliente=' || v_client
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
    end if;

    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_user, v_clinic, 'update', 'client_journey', v_client::text,
            jsonb_build_object('to', v_new, 'via', 'decision', 'kind', v_kind, 'answer', p_answer));
  end if;
end;
$$;
