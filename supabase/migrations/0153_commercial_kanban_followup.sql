-- =============================================================================
-- Risarte Odontologia — Migration 0153 (Módulo Comercial — COM3)
-- Kanban do Comercial + Follow-up com cadência configurável. Ver docs/COMERCIAL.md.
--
-- 1) commercial_followup_settings — cadência do follow-up em cascata (rede →
--    unidade, mesmo padrão dos SLAs): nº de tentativas, intervalo (dias) e
--    prazo máximo (dias) para encerrar o follow-up.
-- 2) commercial_cards — o "cartão" de cada cliente no funil comercial: a etapa
--    (a apresentar, acontecendo agora, apresentado, follow-up, follow-up na
--    clínica, cancelado, perdido) + o estado do follow-up. As colunas de
--    fechamento e da Fase 5 são derivadas no app (negociação/jornada), não aqui.
-- 3) commercial_followup_attempts — registro detalhado de cada tentativa.
-- 4) RPCs: commercial_set_stage (mover o cartão), commercial_start_followup
--    (abrir o follow-up), commercial_log_followup_attempt (registrar tentativa;
--    ao esgotar as tentativas/prazo → escala à Gerente = "follow-up na clínica").
-- Idempotente.
-- =============================================================================

-- 1) Cadência do follow-up (cascata) -------------------------------------------
create table if not exists public.commercial_followup_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  interval_days integer not null default 2 check (interval_days >= 1),
  max_days integer not null default 15 check (max_days >= 1),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
do $$
begin
  alter table public.commercial_followup_settings
    add constraint commercial_followup_settings_clinic_key unique nulls not distinct (clinic_id);
exception when duplicate_object then null;
end $$;

-- Padrão da rede (só cria se ainda não existir).
insert into public.commercial_followup_settings (clinic_id, max_attempts, interval_days, max_days)
values (null, 3, 2, 15)
on conflict (clinic_id) do nothing;

alter table public.commercial_followup_settings enable row level security;

drop policy if exists "commercial_followup_settings_select" on public.commercial_followup_settings;
create policy "commercial_followup_settings_select" on public.commercial_followup_settings
  for select to authenticated using (true);

drop policy if exists "commercial_followup_settings_write" on public.commercial_followup_settings;
create policy "commercial_followup_settings_write" on public.commercial_followup_settings
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- 2) Cartão do funil comercial -------------------------------------------------
create table if not exists public.commercial_cards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  stage text not null default 'a_apresentar'
    check (stage in ('a_apresentar','acontecendo_agora','apresentado',
                     'follow_up','follow_up_clinica','cancelado','perdido')),
  outcome_reason text,
  followup_started_at timestamptz,
  followup_attempts integer not null default 0,
  next_attempt_at timestamptz,
  followup_deadline timestamptz,
  escalated_at timestamptz,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);
create index if not exists commercial_cards_clinic_idx
  on public.commercial_cards (clinic_id, stage);

create table if not exists public.commercial_followup_attempts (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.commercial_cards (id) on delete cascade,
  client_id uuid not null references public.clients (id),
  clinic_id uuid not null references public.clinics (id),
  attempt_no integer not null,
  channel text not null default 'outro'
    check (channel in ('whatsapp','ligacao','email','presencial','outro')),
  outcome text not null default 'outro'
    check (outcome in ('sem_resposta','reagendou','vai_pensar','recusou','sem_interesse','outro')),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists commercial_followup_attempts_card_idx
  on public.commercial_followup_attempts (card_id, created_at);

alter table public.commercial_cards enable row level security;
alter table public.commercial_followup_attempts enable row level security;

-- Leitura: mesma regra da negociação (gestão/rede/planner/equipe da unidade +
-- comercial com escopo). Escrita direta: Admin (o resto passa pelas RPCs).
drop policy if exists "commercial_cards_select" on public.commercial_cards;
create policy "commercial_cards_select" on public.commercial_cards
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','clinical_coordinator','receptionist']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

drop policy if exists "commercial_cards_write" on public.commercial_cards;
create policy "commercial_cards_write" on public.commercial_cards
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

drop policy if exists "commercial_followup_attempts_select" on public.commercial_followup_attempts;
create policy "commercial_followup_attempts_select" on public.commercial_followup_attempts
  for select to authenticated
  using (exists (select 1 from public.commercial_cards c where c.id = card_id));

drop policy if exists "commercial_followup_attempts_write" on public.commercial_followup_attempts;
create policy "commercial_followup_attempts_write" on public.commercial_followup_attempts
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- 3) Guard comum: quem pode mexer no funil de um cliente -----------------------
--    (Admin, Gerente da unidade, ou Consultor da unidade/Franqueadora c/ escopo)
create or replace function public.commercial_can_manage(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(p_clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()));
$$;

-- Garante o cartão do cliente e devolve o id (cria como "a apresentar").
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
  return v_card;
end;
$$;

-- Move o cartão para uma etapa manual do funil.
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
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.commercial_can_manage(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
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
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'commercial_card', p_client_id::text,
    jsonb_build_object('stage', p_stage));
end;
$$;

-- Abre o follow-up: calcula prazo/próxima tentativa pela cadência configurada.
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
  if not public.commercial_can_manage(v_clinic) then raise exception 'NOT_ALLOWED'; end if;

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
    followup_started_at = now(),
    followup_attempts = 0,
    next_attempt_at = now() + make_interval(days => v_interval),
    followup_deadline = now() + make_interval(days => v_max_days),
    escalated_at = null,
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'commercial_followup_start', p_client_id::text, null);
end;
$$;

-- Registra uma tentativa de follow-up; esgotou tentativas/prazo → escala à
-- Gerente ("follow-up na clínica"). Retorna { escalated, attempts }.
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
  if not public.commercial_can_manage(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(p_channel,'') = '' then p_channel := 'outro'; end if;
  if coalesce(p_outcome,'') = '' then p_outcome := 'outro'; end if;

  perform public.commercial_ensure_card(p_client_id);
  select * into v_card from public.commercial_cards where client_id = p_client_id;

  -- Se ainda não estava em follow-up, abre agora (cadência da unidade).
  if v_card.stage not in ('follow_up','follow_up_clinica') then
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

  -- Esgotou o nº de tentativas OU passou do prazo máximo → escala à Gerente.
  v_escalate := (v_attempt >= v_max_att)
    or (v_card.followup_deadline is not null and now() > v_card.followup_deadline);

  update public.commercial_cards set
    followup_attempts = v_attempt,
    next_attempt_at = case when v_escalate then null else now() + make_interval(days => v_interval) end,
    stage = case when v_escalate then 'follow_up_clinica' else 'follow_up' end,
    escalated_at = case when v_escalate and escalated_at is null then now() else escalated_at end,
    updated_by = v_user,
    updated_at = now()
  where id = v_card.id;

  if v_escalate and v_card.stage <> 'follow_up_clinica' then
    select full_name into v_client_name from public.clients where id = p_client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'FOLLOW-UP ESGOTADO: assumir o cliente na clínica',
      coalesce(v_client_name, 'Cliente')
        || ' — o Consultor esgotou as tentativas de follow-up. Assuma o contato ('
        || 'follow-up na clínica) e conduza novas tentativas.',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'commercial_followup_attempt', p_client_id::text,
    jsonb_build_object('attempt', v_attempt, 'escalated', v_escalate));

  return jsonb_build_object('escalated', v_escalate, 'attempts', v_attempt);
end;
$$;

revoke all on function public.commercial_can_manage(uuid) from public;
revoke all on function public.commercial_ensure_card(uuid) from public;
revoke all on function public.commercial_set_stage(uuid, text, text) from public;
revoke all on function public.commercial_start_followup(uuid) from public;
revoke all on function public.commercial_log_followup_attempt(uuid, text, text, text) from public;
grant execute on function public.commercial_set_stage(uuid, text, text) to authenticated;
grant execute on function public.commercial_start_followup(uuid) to authenticated;
grant execute on function public.commercial_log_followup_attempt(uuid, text, text, text) to authenticated;
