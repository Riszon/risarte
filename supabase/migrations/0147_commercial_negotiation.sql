-- =============================================================================
-- Risarte Odontologia — Migration 0147 (Módulo Comercial — COM1)
-- Negociação + regras comerciais. Ver docs/COMERCIAL.md.
--
-- 1) commercial_rules — regra comercial em cascata (rede → unidade): desconto
--    máximo, parcelas máximas, meios de pagamento permitidos. Só Admin edita.
-- 2) plan_negotiations + plan_negotiation_items — a negociação do Consultor
--    sobre um plano aprovado: aprovação parcial (itens incluídos/excluídos,
--    motivo obrigatório), desconto/acréscimo, pagamento/parcelas, decisor.
-- 3) RPCs: evaluate_negotiation_rules (valida contra a regra; fora → status
--    "aguardando autorização" + avisa o Gerente), review_negotiation (Gerente
--    autoriza/nega), accept_negotiation (cliente aceitou), e
--    return_commercial_to_planning (devolução 4→3 com considerações).
-- 4) move_client_phase recriada: nova transição Conversão Comercial → Centro
--    de Planejamento pelo Consultor (com escopo); e a transição 4→5 passa a
--    aceitar o consultor da FRANQUEADORA com escopo (providers_with_access).
-- Idempotente.
-- =============================================================================

-- 1) Regras comerciais (cascata) -----------------------------------------------
create table if not exists public.commercial_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id),
  max_discount_percent numeric(5,2)
    check (max_discount_percent is null or max_discount_percent >= 0),
  max_installments integer
    check (max_installments is null or max_installments >= 1),
  allowed_methods text[],
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
do $$
begin
  alter table public.commercial_rules
    add constraint commercial_rules_clinic_key unique nulls not distinct (clinic_id);
exception when duplicate_object then null;
end $$;

alter table public.commercial_rules enable row level security;

drop policy if exists "commercial_rules_select" on public.commercial_rules;
create policy "commercial_rules_select" on public.commercial_rules
  for select to authenticated using (true);

drop policy if exists "commercial_rules_write" on public.commercial_rules;
create policy "commercial_rules_write" on public.commercial_rules
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- 2) Negociação ----------------------------------------------------------------
create table if not exists public.plan_negotiations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.treatment_plans (id) on delete cascade,
  option_id uuid not null references public.treatment_plan_options (id),
  client_id uuid not null references public.clients (id),
  clinic_id uuid not null references public.clinics (id),
  consultant_id uuid references public.profiles (id),
  status text not null default 'em_negociacao'
    check (status in ('em_negociacao','aguardando_autorizacao','aceita','devolvida','perdida')),
  subtotal_cents integer not null default 0,
  -- Ajuste com sinal: negativo = desconto; positivo = acréscimo.
  adjustment_cents integer not null default 0,
  final_cents integer not null default 0,
  payment_method text
    check (payment_method is null or payment_method in
      ('pix','boleto','cartao','cartao_parcelado','credito_recorrente','deposito_avista')),
  installments integer not null default 1 check (installments >= 1),
  is_partial boolean not null default false,
  partial_reason text,
  client_is_decider boolean,
  decider_notes text,
  rule_violations text,
  rule_authorized boolean not null default false,
  authorized_by uuid references public.profiles (id),
  authorized_at timestamptz,
  authorization_note text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id)
);
create index if not exists plan_negotiations_client_idx
  on public.plan_negotiations (client_id);
create index if not exists plan_negotiations_clinic_idx
  on public.plan_negotiations (clinic_id, status);

create table if not exists public.plan_negotiation_items (
  negotiation_id uuid not null references public.plan_negotiations (id) on delete cascade,
  item_id uuid not null references public.treatment_plan_option_items (id) on delete cascade,
  included boolean not null default true,
  primary key (negotiation_id, item_id)
);

alter table public.plan_negotiations enable row level security;
alter table public.plan_negotiation_items enable row level security;

-- Leitura: gestão/rede, planner (alerta na Fase 3), equipe da unidade e o
-- comercial (unidade OU Franqueadora com escopo — providers_with_access).
drop policy if exists "plan_negotiations_select" on public.plan_negotiations;
create policy "plan_negotiations_select" on public.plan_negotiations
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','clinical_coordinator','receptionist']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

-- Escrita: Admin, Gerente da unidade e Consultor com escopo.
drop policy if exists "plan_negotiations_write" on public.plan_negotiations;
create policy "plan_negotiations_write" on public.plan_negotiations
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  );

drop policy if exists "plan_negotiation_items_select" on public.plan_negotiation_items;
create policy "plan_negotiation_items_select" on public.plan_negotiation_items
  for select to authenticated
  using (exists (select 1 from public.plan_negotiations n where n.id = negotiation_id));

drop policy if exists "plan_negotiation_items_write" on public.plan_negotiation_items;
create policy "plan_negotiation_items_write" on public.plan_negotiation_items
  for all to authenticated
  using (
    exists (
      select 1 from public.plan_negotiations n
      where n.id = negotiation_id
        and (
          public.is_admin_master()
          or public.has_role_in_clinic(n.clinic_id, array['unit_manager']::public.user_role[])
          or exists (select 1 from public.providers_with_access(n.clinic_id, 'commercial_consultant') p
                     where p.user_id = (select auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from public.plan_negotiations n
      where n.id = negotiation_id
        and (
          public.is_admin_master()
          or public.has_role_in_clinic(n.clinic_id, array['unit_manager']::public.user_role[])
          or exists (select 1 from public.providers_with_access(n.clinic_id, 'commercial_consultant') p
                     where p.user_id = (select auth.uid()))
        )
    )
  );

-- 3) RPCs da negociação --------------------------------------------------------

-- Recalcula totais e valida contra a regra comercial efetiva (unidade > rede).
-- p_from_consultant=true (salvamento do consultor) zera a autorização anterior —
-- condições mudaram, precisa autorizar de novo se continuar fora da regra.
create or replace function public.evaluate_negotiation_rules(
  p_negotiation_id uuid,
  p_from_consultant boolean default true
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_subtotal integer;
  v_excluded integer;
  v_max_disc numeric;
  v_max_inst integer;
  v_methods text[];
  v_discount_pct numeric;
  v_violations text[] := '{}';
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_neg.clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select coalesce(sum(case when ni.included then i.quantity * i.unit_price_cents else 0 end), 0),
         count(*) filter (where not ni.included)
    into v_subtotal, v_excluded
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items i on i.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id;

  -- Regra efetiva: campo a campo, ajuste da unidade > padrão da rede.
  select coalesce(u.max_discount_percent, n.max_discount_percent),
         coalesce(u.max_installments, n.max_installments),
         coalesce(u.allowed_methods, n.allowed_methods)
    into v_max_disc, v_max_inst, v_methods
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_neg.clinic_id
  left join public.commercial_rules n on n.clinic_id is null;

  v_discount_pct := case
    when v_subtotal > 0 and v_neg.adjustment_cents < 0
      then (-v_neg.adjustment_cents)::numeric * 100 / v_subtotal
    else 0
  end;

  if v_max_disc is not null and v_discount_pct > v_max_disc then
    v_violations := v_violations || format(
      'Desconto de %s%% acima do máximo permitido (%s%%)',
      round(v_discount_pct, 1), v_max_disc);
  end if;
  if v_max_inst is not null and v_neg.installments > v_max_inst then
    v_violations := v_violations || format(
      'Parcelamento em %sx acima do máximo permitido (%sx)',
      v_neg.installments, v_max_inst);
  end if;
  if v_neg.payment_method is not null and v_methods is not null
     and not (v_neg.payment_method = any (v_methods)) then
    v_violations := v_violations || format(
      'Meio de pagamento "%s" não permitido pela regra comercial',
      v_neg.payment_method);
  end if;

  update public.plan_negotiations set
    subtotal_cents = v_subtotal,
    final_cents = v_subtotal + adjustment_cents,
    is_partial = (v_excluded > 0),
    rule_authorized = case when p_from_consultant then false else rule_authorized end,
    rule_violations = case when array_length(v_violations, 1) > 0
                           then array_to_string(v_violations, '; ') else null end,
    status = case
      -- Fora da regra e sem autorização → trava aguardando o Gerente.
      when array_length(v_violations, 1) > 0
           and not (rule_authorized and not p_from_consultant)
        then 'aguardando_autorizacao'
      -- Dentro da regra (ou autorizada): condições mudaram → volta a negociar.
      when status in ('aguardando_autorizacao', 'aceita') then 'em_negociacao'
      else status
    end,
    consultant_id = coalesce(consultant_id, v_user),
    updated_at = now()
  where id = p_negotiation_id;

  -- Avisa o Gerente quando ficou aguardando autorização.
  if array_length(v_violations, 1) > 0 then
    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'AUTORIZAÇÃO NECESSÁRIA: negociação fora da regra comercial',
      coalesce(v_client_name, 'Cliente') || ' — ' || array_to_string(v_violations, '; ')
        || '. Revise e autorize (ou negue) na tela de apresentação.',
      '/apresentacao/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'plan_negotiation', p_negotiation_id::text,
    jsonb_build_object('violations', v_violations));

  return v_violations;
end;
$$;

revoke all on function public.evaluate_negotiation_rules(uuid, boolean) from public;
grant execute on function public.evaluate_negotiation_rules(uuid, boolean) to authenticated;

-- Gerente da unidade autoriza (ou nega) a negociação fora da regra.
create or replace function public.review_negotiation(
  p_negotiation_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_neg.clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_neg.status <> 'aguardando_autorizacao' then
    raise exception 'NOT_PENDING';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED';
  end if;

  update public.plan_negotiations set
    rule_authorized = p_approve,
    authorized_by = v_user,
    authorized_at = now(),
    authorization_note = nullif(btrim(p_note), ''),
    status = 'em_negociacao',
    updated_at = now()
  where id = p_negotiation_id;

  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  if v_neg.consultant_id is not null and v_neg.consultant_id <> v_user then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (v_neg.consultant_id, v_neg.clinic_id,
      case when p_approve then 'Negociação autorizada pela unidade'
           else 'Negociação NÃO autorizada pela unidade' end,
      coalesce(v_client_name, 'Cliente')
        || case when p_approve
             then ' — as condições fora da regra foram autorizadas. Pode prosseguir.'
             else ' — ajuste as condições. Motivo: ' || coalesce(btrim(p_note), '—') end,
      '/apresentacao/' || v_neg.client_id);
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'plan_negotiation_review', p_negotiation_id::text,
    jsonb_build_object('approved', p_approve));
end;
$$;

revoke all on function public.review_negotiation(uuid, boolean, text) from public;
grant execute on function public.review_negotiation(uuid, boolean, text) to authenticated;

-- Consultor marca que o CLIENTE ACEITOU as condições (pronta p/ fechamento).
create or replace function public.accept_negotiation(p_negotiation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_neg.status = 'aguardando_autorizacao' then raise exception 'AWAITING_AUTHORIZATION'; end if;
  if v_neg.rule_violations is not null and not v_neg.rule_authorized then
    raise exception 'NEEDS_AUTHORIZATION';
  end if;
  if v_neg.is_partial and coalesce(btrim(v_neg.partial_reason), '') = '' then
    raise exception 'PARTIAL_REASON_REQUIRED';
  end if;
  if v_neg.payment_method is null then raise exception 'PAYMENT_REQUIRED'; end if;

  update public.plan_negotiations set
    status = 'aceita',
    consultant_id = coalesce(consultant_id, v_user),
    updated_at = now()
  where id = p_negotiation_id;

  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_neg.clinic_id,
    'Negociação aceita — preparar fechamento',
    coalesce(v_client_name, 'Cliente')
      || ' aceitou as condições. Prepare o contrato e o pagamento (fechamento).',
    '/apresentacao/' || v_neg.client_id
  from public.providers_with_access(v_neg.clinic_id, 'commercial_assistant') pwa
  where pwa.user_id <> v_user;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'plan_negotiation_accept', p_negotiation_id::text, null);
end;
$$;

revoke all on function public.accept_negotiation(uuid) from public;
grant execute on function public.accept_negotiation(uuid) to authenticated;

-- Devolução 4→3 pelo Consultor, com considerações OBRIGATÓRIAS ao Planner.
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

  -- Marca a negociação atual (se houver) como devolvida.
  update public.plan_negotiations set status = 'devolvida', updated_at = now()
  where client_id = p_client_id and status in ('em_negociacao', 'aguardando_autorizacao');

  -- Considerações do Consultor chegam ao Planner como informação complementar.
  insert into public.planning_supplements (client_id, clinic_id, body, created_by)
  values (p_client_id, v_clinic,
    'DEVOLVIDO PELO COMERCIAL — considerações do Consultor:' || E'\n'
      || btrim(p_considerations),
    v_user);

  -- Move 4→3 (matriz atualizada abaixo aceita o Consultor com escopo) e o
  -- move_client_phase já avisa os Planners ("Novo caso no Centro de Planejamento").
  perform public.move_client_phase(p_client_id, 'planning_center');
end;
$$;

revoke all on function public.return_commercial_to_planning(uuid, text) from public;
grant execute on function public.return_commercial_to_planning(uuid, text) to authenticated;

-- 4) move_client_phase — recriada (base = 0075) com:
--    (a) NOVA transição: commercial_conversion → planning_center pelo Consultor
--        Comercial com escopo (devolução ao planejamento);
--    (b) transição commercial_conversion → treatment_start passa a usar
--        providers_with_access (o consultor da Franqueadora com escopo na
--        unidade também pode — antes só papel na própria clínica).
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
    select distinct ucr.user_id, v_clinic, 'Novo caso no Centro de Planejamento', v_body, '/clientes/' || p_client_id
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
