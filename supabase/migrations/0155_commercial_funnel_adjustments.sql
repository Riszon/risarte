-- =============================================================================
-- Risarte Odontologia — Migration 0155 (Módulo Comercial — ajustes do funil)
--
-- Feedback do dono:
-- 1) "Follow-up na clínica" DEIXA de ser coluna: vira um INDICADOR na coluna
--    "Follow-up" (followup_by_clinic). O consultor LIBERA o follow-up para a
--    unidade (reforço nos contatos) — mas o FECHAMENTO continua sendo do
--    Consultor. Escalonamento por tentativas esgotadas também liga o indicador.
-- 2) Cronômetro em "Acontecendo agora": presenting_since marca a entrada.
-- 3) HISTÓRICO do cliente no funil: commercial_card_events (linha do tempo).
-- 4) Permissões: Gerente/Franqueado da unidade só VISUALIZAM o funil da própria
--    unidade; ganham a ação de registrar tentativa SÓ quando o cliente foi
--    liberado para o follow-up da clínica. Fechamento é do Comercial (o Gerente
--    sai de commercial_can_close).
-- Idempotente.
-- =============================================================================

-- 1) Novas colunas no cartão ---------------------------------------------------
alter table public.commercial_cards
  add column if not exists followup_by_clinic boolean not null default false;
alter table public.commercial_cards
  add column if not exists presenting_since timestamptz;

-- Migra os cartões que estavam em "follow_up_clinica" para follow_up + indicador.
update public.commercial_cards
set stage = 'follow_up', followup_by_clinic = true
where stage = 'follow_up_clinica';

-- 2) Histórico do funil --------------------------------------------------------
create table if not exists public.commercial_card_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.commercial_cards (id) on delete cascade,
  client_id uuid not null references public.clients (id),
  clinic_id uuid not null references public.clinics (id),
  event_type text not null,
  description text,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists commercial_card_events_card_idx
  on public.commercial_card_events (card_id, created_at);

alter table public.commercial_card_events enable row level security;

drop policy if exists "commercial_card_events_select" on public.commercial_card_events;
create policy "commercial_card_events_select" on public.commercial_card_events
  for select to authenticated
  using (exists (select 1 from public.commercial_cards c where c.id = card_id));

drop policy if exists "commercial_card_events_write" on public.commercial_card_events;
create policy "commercial_card_events_write" on public.commercial_card_events
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

create or replace function public.commercial_log_card_event(
  p_card_id uuid,
  p_client_id uuid,
  p_clinic_id uuid,
  p_type text,
  p_desc text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.commercial_card_events
    (card_id, client_id, clinic_id, event_type, description, actor_id)
  values (p_card_id, p_client_id, p_clinic_id, p_type, p_desc, (select auth.uid()));
end;
$$;

-- 3) Guards de permissão -------------------------------------------------------
-- Time comercial: Admin, Consultor ou Assistente com escopo (NÃO o Gerente).
create or replace function public.commercial_is_team(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(p_clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(p_clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()));
$$;

-- Unidade (reforço de follow-up): Gerente ou Franqueado da própria clínica.
create or replace function public.commercial_is_unit(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.has_role_in_clinic(p_clinic_id,
    array['unit_manager','franchisee']::public.user_role[]);
$$;

-- commercial_can_manage passa a ser SÓ o time comercial (o Gerente sai).
create or replace function public.commercial_can_manage(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.commercial_is_team(p_clinic_id);
$$;

-- Fechamento é do Comercial (Gerente sai do commercial_can_close).
create or replace function public.commercial_can_close(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.commercial_is_team(p_clinic_id);
$$;

-- 4) commercial_set_stage — cronômetro + histórico + reset do indicador. -------
create or replace function public.commercial_set_stage(
  p_client_id uuid,
  p_stage text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_card uuid;
  v_user uuid := (select auth.uid());
  v_desc text;
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
    -- Cronômetro da apresentação: começa ao entrar; zera ao sair.
    presenting_since = case when p_stage = 'acontecendo_agora' then now() else null end,
    -- Sair do follow-up desliga o indicador de condução pela clínica.
    followup_by_clinic = case when p_stage = 'follow_up' then followup_by_clinic else false end,
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

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

-- 5) commercial_start_followup — histórico. ------------------------------------
create or replace function public.commercial_start_followup(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_card uuid;
  v_max_att integer;
  v_interval integer;
  v_max_days integer;
  v_user uuid := (select auth.uid());
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.commercial_is_team(v_clinic) then raise exception 'NOT_ALLOWED'; end if;

  select coalesce(u.max_attempts, n.max_attempts, 3),
         coalesce(u.interval_days, n.interval_days, 2),
         coalesce(u.max_days, n.max_days, 15)
    into v_max_att, v_interval, v_max_days
  from (select 1) one
  left join public.commercial_followup_settings u on u.clinic_id = v_clinic
  left join public.commercial_followup_settings n on n.clinic_id is null;

  v_card := public.commercial_ensure_card(p_client_id);
  update public.commercial_cards set
    stage = 'follow_up',
    presenting_since = null,
    followup_started_at = now(),
    followup_attempts = 0,
    next_attempt_at = now() + make_interval(days => v_interval),
    followup_deadline = now() + make_interval(days => v_max_days),
    escalated_at = null,
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

  perform public.commercial_log_card_event(v_card, p_client_id, v_clinic, 'follow_up_iniciado',
    'Follow-up iniciado pelo Consultor');

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'commercial_followup_start', p_client_id::text, null);
end;
$$;

-- 6) Liberar/retornar o follow-up para a clínica (decisão do Comercial). --------
create or replace function public.commercial_transfer_followup(
  p_client_id uuid,
  p_to_clinic boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_card public.commercial_cards;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.commercial_is_team(v_clinic) then raise exception 'NOT_ALLOWED'; end if;

  perform public.commercial_ensure_card(p_client_id);
  select * into v_card from public.commercial_cards where client_id = p_client_id;

  -- Liberar exige o cliente em follow-up (abre se preciso).
  if p_to_clinic and v_card.stage <> 'follow_up' then
    perform public.commercial_start_followup(p_client_id);
    select * into v_card from public.commercial_cards where client_id = p_client_id;
  end if;

  update public.commercial_cards set
    followup_by_clinic = p_to_clinic,
    escalated_at = case when p_to_clinic and escalated_at is null then now() else escalated_at end,
    updated_by = v_user,
    updated_at = now()
  where id = v_card.id;

  perform public.commercial_log_card_event(v_card.id, p_client_id, v_clinic,
    case when p_to_clinic then 'transferido_clinica' else 'retornado_consultor' end,
    case when p_to_clinic then 'Follow-up liberado para a clínica (reforço)'
         else 'Follow-up retornou ao Consultor' end);

  if p_to_clinic then
    select full_name into v_client_name from public.clients where id = p_client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'Follow-up liberado para a clínica',
      coalesce(v_client_name, 'Cliente')
        || ' — ajude o Comercial nos contatos e tentativas. O fechamento continua com o Consultor.',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role in ('unit_manager','franchisee')
      and ucr.user_id is distinct from v_user;
  end if;
end;
$$;

-- 7) commercial_log_followup_attempt — unidade pode ajudar; indicador clínica. --
create or replace function public.commercial_log_followup_attempt(
  p_client_id uuid,
  p_channel text,
  p_outcome text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_card public.commercial_cards;
  v_max_att integer;
  v_interval integer;
  v_max_days integer;
  v_attempt integer;
  v_escalate boolean := false;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if coalesce(p_channel,'') = '' then p_channel := 'outro'; end if;
  if coalesce(p_outcome,'') = '' then p_outcome := 'outro'; end if;

  perform public.commercial_ensure_card(p_client_id);
  select * into v_card from public.commercial_cards where client_id = p_client_id;

  -- Time comercial sempre pode; a UNIDADE só quando o cliente já foi liberado
  -- para o follow-up da clínica (reforço nos contatos).
  if not (
    public.commercial_is_team(v_clinic)
    or (v_card.followup_by_clinic and public.commercial_is_unit(v_clinic))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_card.stage <> 'follow_up' then
    perform public.commercial_start_followup(p_client_id);
    select * into v_card from public.commercial_cards where client_id = p_client_id;
  end if;

  select coalesce(u.max_attempts, n.max_attempts, 3),
         coalesce(u.interval_days, n.interval_days, 2),
         coalesce(u.max_days, n.max_days, 15)
    into v_max_att, v_interval, v_max_days
  from (select 1) one
  left join public.commercial_followup_settings u on u.clinic_id = v_clinic
  left join public.commercial_followup_settings n on n.clinic_id is null;

  v_attempt := v_card.followup_attempts + 1;

  insert into public.commercial_followup_attempts
    (card_id, client_id, clinic_id, attempt_no, channel, outcome, notes, created_by)
  values (v_card.id, p_client_id, v_clinic, v_attempt, p_channel, p_outcome, nullif(btrim(p_notes),''), v_user);

  perform public.commercial_log_card_event(v_card.id, p_client_id, v_clinic, 'follow_up_tentativa',
    'Tentativa ' || v_attempt || ' (' || p_channel || ' · ' || p_outcome || ')'
      || coalesce(' — ' || nullif(btrim(p_notes),''), ''));

  -- Esgotou tentativas OU prazo → LIBERA para a clínica (indicador), sem trocar
  -- de coluna. O time comercial continua no comando do fechamento.
  v_escalate := (not v_card.followup_by_clinic)
    and ((v_attempt >= v_max_att)
      or (v_card.followup_deadline is not null and now() > v_card.followup_deadline));

  update public.commercial_cards set
    followup_attempts = v_attempt,
    next_attempt_at = now() + make_interval(days => v_interval),
    followup_by_clinic = case when v_escalate then true else followup_by_clinic end,
    escalated_at = case when v_escalate then now() else escalated_at end,
    updated_by = v_user,
    updated_at = now()
  where id = v_card.id;

  if v_escalate then
    perform public.commercial_log_card_event(v_card.id, p_client_id, v_clinic, 'transferido_clinica',
      'Tentativas esgotadas — follow-up liberado para a clínica (reforço)');
    select full_name into v_client_name from public.clients where id = p_client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'Follow-up liberado para a clínica',
      coalesce(v_client_name, 'Cliente')
        || ' — o Consultor esgotou as tentativas. Ajude nos contatos (o fechamento continua com o Consultor).',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role in ('unit_manager','franchisee')
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'commercial_followup_attempt', p_client_id::text,
    jsonb_build_object('attempt', v_attempt, 'escalated', v_escalate));

  return jsonb_build_object('escalated', v_escalate, 'attempts', v_attempt);
end;
$$;

-- 8) commercial_ensure_card — registra a entrada no funil (histórico). ---------
create or replace function public.commercial_ensure_card(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card uuid;
  v_clinic uuid;
begin
  select id into v_card from public.commercial_cards where client_id = p_client_id;
  if v_card is not null then return v_card; end if;
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  insert into public.commercial_cards (client_id, clinic_id, stage, updated_by)
  values (p_client_id, v_clinic, 'a_apresentar', (select auth.uid()))
  returning id into v_card;
  perform public.commercial_log_card_event(v_card, p_client_id, v_clinic, 'entrou_funil',
    'Entrou no funil comercial');
  return v_card;
end;
$$;

-- 9) commercial_close_step — histórico de fechamento no funil. -----------------
create or replace function public.commercial_close_step(
  p_negotiation_id uuid,
  p_step text,
  p_value boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_sale public.commercial_sales;
  v_sale_id uuid;
  v_card uuid;
  v_user uuid := (select auth.uid());
  v_signed boolean;
  v_paid boolean;
  v_closed boolean := false;
  v_client_name text;
  v_reais text;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_neg.status <> 'aceita' then raise exception 'NOT_ACCEPTED'; end if;
  if p_step not in ('contract','payment') then raise exception 'INVALID_STEP'; end if;

  select * into v_sale from public.commercial_sales where negotiation_id = p_negotiation_id;
  if v_sale.id is null then
    insert into public.commercial_sales
      (negotiation_id, client_id, clinic_id, plan_id, final_cents)
    values (p_negotiation_id, v_neg.client_id, v_neg.clinic_id, v_neg.plan_id, v_neg.final_cents)
    returning * into v_sale;
  end if;
  v_sale_id := v_sale.id;

  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if p_step = 'contract' then
    update public.commercial_sales set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id
    returning contract_signed, payment_confirmed into v_signed, v_paid;
  else
    update public.commercial_sales set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id
    returning contract_signed, payment_confirmed into v_signed, v_paid;
  end if;

  v_card := public.commercial_ensure_card(v_neg.client_id);
  perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
    'fechamento_passo',
    case when p_step = 'contract' then 'Contrato ' else 'Pagamento ' end
      || case when p_value then 'confirmado' else 'desmarcado' end);

  if v_signed and v_paid then
    update public.commercial_sales set closed_at = now(), updated_at = now()
    where id = v_sale_id;
    v_closed := true;

    update public.journey_phase_history set exited_at = now()
    where client_id = v_neg.client_id and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_neg.client_id, v_neg.clinic_id, 'treatment_start', v_user);
    update public.clients set journey_phase = 'treatment_start', phase_entered_at = now()
    where id = v_neg.client_id;

    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    v_reais := 'R$ ' || (v_neg.final_cents / 100)::text || ',' ||
               lpad((v_neg.final_cents % 100)::text, 2, '0');

    perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
      'venda_concluida', 'VENDA CONCLUÍDA — ' || v_reais || ' (contrato assinado + pagamento)');

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'FECHAMENTO! Iniciar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano. Fale com o cliente, dê as boas-vindas e agende o início do tratamento.',
      '/agenda?cliente=' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'receptionist'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Novo fechamento — acompanhar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano e vai iniciar o tratamento. Acompanhe a execução com excelência.',
      '/prontuarios/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Venda fechada — ' || v_reais,
      coalesce(v_client_name, 'Cliente') || ' — venda de ' || v_reais
        || ' concluída (contrato assinado e pagamento confirmado).',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'commercial_sale', p_negotiation_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed));

  return jsonb_build_object('signed', v_signed, 'paid', v_paid, 'closed', v_closed);
end;
$$;

-- Grants (idempotentes) --------------------------------------------------------
revoke all on function public.commercial_log_card_event(uuid, uuid, uuid, text, text) from public;
revoke all on function public.commercial_is_team(uuid) from public;
revoke all on function public.commercial_is_unit(uuid) from public;
revoke all on function public.commercial_transfer_followup(uuid, boolean) from public;
grant execute on function public.commercial_transfer_followup(uuid, boolean) to authenticated;
grant execute on function public.commercial_set_stage(uuid, text, text) to authenticated;
grant execute on function public.commercial_start_followup(uuid) to authenticated;
grant execute on function public.commercial_log_followup_attempt(uuid, text, text, text) to authenticated;
grant execute on function public.commercial_close_step(uuid, text, boolean) to authenticated;
