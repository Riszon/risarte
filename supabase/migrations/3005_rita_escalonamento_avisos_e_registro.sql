-- =============================================================================
-- 3005 — Rita, Fase 0A.6: escalonamento, avisos e o registro da Rita
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.6 (decisão 28).
-- Depende da 3001 (rita.settings, _gaps, _pause_if_gaps, _recheck_trg) e da
-- 3004 (o portão como está).
--
-- O QUE CRIA
--   * `rita.escalation_routes` em cascata (rede = `clinic_id` nulo; a linha da
--     unidade, se existir, vale inteira): quem recebe a transferência em
--     horário comercial (padrão: Recepção), quem recebe o alerta de prazo
--     estourado (padrão: Gerente) e depois de quantos minutos, quando sobe ao
--     Admin Master, e uma pessoa de reserva. Decisão 28: FORA do horário não
--     há rota — o pedido fica para a abertura (a mensagem de urgência é a da
--     rede, em rita.settings). Gravar = `rita.save_escalation_route` (Admin
--     em qualquer escopo; Gerente só na própria unidade).
--   * O PORTÃO perde o último pendente: "Quem recebe as transferências em
--     horário comercial" passa a ser conferido de verdade (alguém ativo com um
--     dos papéis da rota na unidade, ou a pessoa de reserva ativa).
--     `rita._pending_items` fica vazio.
--   * `rita._notify` (interna): o aviso "Rita: …" no sino, uma linha por
--     pessoa (papéis na unidade, ativos, só pessoas; opcionalmente os Admins
--     Master), link `/rita…`, e a trava contra repetir (`rita.notices`, pela
--     chave). O app classifica pelo link (categoria "Rita").
--   * AVISOS: a pausa automática avisa o Gerente da unidade e os Admins; ligar
--     e desligar pela tela avisam quem precisa saber (nunca quem clicou).
--   * `rita.actions`: o registro do que aconteceu com a Rita, SÓ CRESCE
--     (gatilho recusa alterar e apagar). Preenchido por gatilhos nas tabelas
--     da Rita — assim todo caminho de gravação registra, inclusive os que
--     vierem. Sem telefone, sem texto de mensagem: só o fato, o id e quem.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) As rotas de escalonamento
-- -----------------------------------------------------------------------------
create table if not exists rita.escalation_routes (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = a rede inteira. A linha da unidade, se existir, vale inteira.
  clinic_id uuid references public.clinics (id) on delete cascade,
  business_hours_roles public.user_role[] not null default '{receptionist}',
  sla_alert_roles public.user_role[] not null default '{unit_manager}',
  sla_alert_after_minutes integer not null default 15,
  -- Nulo = o alerta não sobe ao Admin Master.
  sla_escalate_to_admin_after_minutes integer,
  fallback_profile_id uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint escalation_routes_clinic_key unique nulls not distinct (clinic_id),
  constraint escalation_routes_roles check (cardinality(business_hours_roles) > 0),
  constraint escalation_routes_sla_roles check (cardinality(sla_alert_roles) > 0),
  constraint escalation_routes_sla_minutes check (sla_alert_after_minutes between 1 and 1440),
  constraint escalation_routes_admin_minutes check (
    sla_escalate_to_admin_after_minutes is null
    or sla_escalate_to_admin_after_minutes between sla_alert_after_minutes and 10080)
);

alter table rita.escalation_routes enable row level security;
-- Nenhuma política: só pelas funções (a tela da 0A.7 lê por função).
revoke all on rita.escalation_routes from public, anon, authenticated;
grant all on rita.escalation_routes to service_role;

-- A rede nasce com o padrão da decisão 28: Recepção em horário comercial,
-- alerta ao Gerente em 15 minutos, ao Admin depois de 60.
insert into rita.escalation_routes (clinic_id, sla_escalate_to_admin_after_minutes)
values (null, 60)
on conflict on constraint escalation_routes_clinic_key do nothing;

-- A rota que vale para a unidade: a dela, senão a da rede.
create or replace function rita._route(p_clinic uuid)
returns table (
  scope text,
  business_hours_roles public.user_role[],
  sla_alert_roles public.user_role[],
  sla_alert_after_minutes integer,
  sla_escalate_to_admin_after_minutes integer,
  fallback_profile_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.clinic_id is null then 'rede' else 'unidade' end,
         r.business_hours_roles, r.sla_alert_roles, r.sla_alert_after_minutes,
         r.sla_escalate_to_admin_after_minutes, r.fallback_profile_id
  from rita.escalation_routes r
  where r.clinic_id = p_clinic or r.clinic_id is null
  order by r.clinic_id nulls last
  limit 1;
$$;

revoke execute on function rita._route(uuid) from public, anon, authenticated;
grant execute on function rita._route(uuid) to service_role;

-- Gravar a rota. Unidade nula = a rede (só Admin Master). Na unidade: Admin
-- Master ou o Gerente dela. A pessoa de reserva tem de ser pessoa ativa e, na
-- unidade, ter função lá (ou ser Admin Master).
create or replace function rita.save_escalation_route(
  p_clinic uuid,
  p_business_hours_roles public.user_role[],
  p_sla_alert_roles public.user_role[],
  p_sla_alert_after_minutes integer,
  p_sla_escalate_to_admin_after_minutes integer,
  p_fallback_profile_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_clinic is null then
    if not public.is_admin_master() then
      raise exception 'NOT_ALLOWED';
    end if;
  else
    if not exists (select 1 from public.clinics where id = p_clinic) then
      raise exception 'CLINIC_NOT_FOUND';
    end if;
    if not (public.is_admin_master()
            or public.has_role_in_clinic(p_clinic, array['unit_manager']::public.user_role[])) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;
  if coalesce(cardinality(p_business_hours_roles), 0) = 0
     or coalesce(cardinality(p_sla_alert_roles), 0) = 0
     or p_sla_alert_after_minutes is null then
    raise exception 'INVALID_INPUT';
  end if;
  if p_fallback_profile_id is not null then
    if not exists (select 1 from public.profiles p
                   where p.id = p_fallback_profile_id and p.is_active and p.kind = 'person') then
      raise exception 'FALLBACK_NOT_ACTIVE';
    end if;
    if p_clinic is not null
       and not exists (select 1 from public.user_clinic_roles_all u
                       where u.user_id = p_fallback_profile_id and u.clinic_id = p_clinic)
       and not exists (select 1 from public.profiles p
                       where p.id = p_fallback_profile_id and p.is_admin_master) then
      raise exception 'FALLBACK_NOT_IN_CLINIC';
    end if;
  end if;

  insert into rita.escalation_routes (
    clinic_id, business_hours_roles, sla_alert_roles, sla_alert_after_minutes,
    sla_escalate_to_admin_after_minutes, fallback_profile_id, updated_by, updated_at)
  values (
    p_clinic, p_business_hours_roles, p_sla_alert_roles, p_sla_alert_after_minutes,
    p_sla_escalate_to_admin_after_minutes, p_fallback_profile_id, v_uid, now())
  on conflict on constraint escalation_routes_clinic_key do update set
    business_hours_roles = excluded.business_hours_roles,
    sla_alert_roles = excluded.sla_alert_roles,
    sla_alert_after_minutes = excluded.sla_alert_after_minutes,
    sla_escalate_to_admin_after_minutes = excluded.sla_escalate_to_admin_after_minutes,
    fallback_profile_id = excluded.fallback_profile_id,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;

revoke execute on function rita.save_escalation_route(uuid, public.user_role[], public.user_role[], integer, integer, uuid) from public, anon, authenticated;
grant execute on function rita.save_escalation_route(uuid, public.user_role[], public.user_role[], integer, integer, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) O registro do que aconteceu (só cresce)
-- -----------------------------------------------------------------------------
create table if not exists rita.actions (
  id bigint generated always as identity primary key,
  clinic_id uuid,
  kind text not null,
  subject_kind text,
  subject_id text,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  -- Quem: a pessoa logada, senão a Rita (rita.actor), senão o sistema.
  actor_kind text not null check (actor_kind in ('pessoa', 'assistente', 'sistema')),
  actor_id uuid,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists actions_clinic_created on rita.actions (clinic_id, created_at desc);

alter table rita.actions enable row level security;
revoke all on rita.actions from public, anon, authenticated;
grant select, insert on rita.actions to service_role;

insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('rita', 'actions', 'Registro técnico do que a Rita fez (só cresce; ele mesmo é a trilha)')
on conflict do nothing;

create or replace function rita._actions_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'RITA_ACTIONS_APPEND_ONLY';
end;
$$;

revoke execute on function rita._actions_append_only() from public, anon, authenticated;

drop trigger if exists append_only on rita.actions;
create trigger append_only before update or delete on rita.actions
  for each row execute function rita._actions_append_only();
drop trigger if exists append_only_truncate on rita.actions;
create trigger append_only_truncate before truncate on rita.actions
  for each statement execute function rita._actions_append_only();

create or replace function rita._log(
  p_clinic uuid,
  p_kind text,
  p_subject_kind text,
  p_subject_id text,
  p_summary text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rita uuid := nullif(current_setting('rita.actor', true), '')::uuid;
begin
  insert into rita.actions (clinic_id, kind, subject_kind, subject_id, summary, payload, actor_kind, actor_id)
  values (
    p_clinic, p_kind, p_subject_kind, p_subject_id, left(p_summary, 500), coalesce(p_payload, '{}'::jsonb),
    case when v_uid is not null then 'pessoa' when v_rita is not null then 'assistente' else 'sistema' end,
    coalesce(v_uid, v_rita));
end;
$$;

revoke execute on function rita._log(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function rita._log(uuid, text, text, text, text, jsonb) to service_role;

-- Um gatilho para todas as tabelas da Rita. Blindado: o registro nunca
-- derruba a gravação (falha vai para rita.falhas).
create or replace function rita._log_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_clinic uuid;
begin
  begin
    v_clinic := coalesce(n ->> 'clinic_id', o ->> 'clinic_id')::uuid;

    if tg_table_name = 'settings' then
      -- Linha nova só conta como "ligada/desligada" se nasceu de um ato
      -- (ligar ou desligar); a que nasce do "modo" é registrada abaixo.
      if (tg_op = 'INSERT' and ((n ->> 'enabled')::boolean or n ->> 'paused_reason' is not null))
         or (tg_op = 'UPDATE' and (n ->> 'enabled') is distinct from (o ->> 'enabled')) then
        perform rita._log(v_clinic,
          case when (n ->> 'enabled')::boolean then 'ligada'
               when n ->> 'paused_by' is null and n ->> 'paused_reason' like 'Pausada sozinha%' then 'pausada'
               else 'desligada' end,
          'settings', n ->> 'id',
          case when (n ->> 'enabled')::boolean then 'Rita ligada'
               else coalesce(n ->> 'paused_reason', 'Rita desligada') end,
          jsonb_build_object('rede', v_clinic is null));
      end if;
      if (tg_op = 'UPDATE' and (n ->> 'mode') is distinct from (o ->> 'mode'))
         or (tg_op = 'INSERT' and not (n ->> 'enabled')::boolean and n ->> 'paused_reason' is null) then
        perform rita._log(v_clinic, 'modo', 'settings', n ->> 'id',
          'Modo: ' || coalesce(o ->> 'mode', 'padrão') || ' → ' || (n ->> 'mode'),
          jsonb_build_object('de', o ->> 'mode', 'para', n ->> 'mode'));
      end if;

    elsif tg_table_name = 'escalation_routes' then
      perform rita._log(v_clinic, 'rota', 'escalation_routes', n ->> 'id',
        'Rota de transferência ' || case when tg_op = 'INSERT' then 'criada' else 'alterada' end,
        jsonb_build_object(
          'horario_comercial', n -> 'business_hours_roles',
          'alerta', n -> 'sla_alert_roles',
          'alerta_minutos', n -> 'sla_alert_after_minutes',
          'admin_minutos', n -> 'sla_escalate_to_admin_after_minutes',
          'reserva', n ->> 'fallback_profile_id'));

    elsif tg_table_name = 'consent_texts' then
      perform rita._log(null, 'texto_consentimento', 'consent_texts', n ->> 'version',
        'Texto de consentimento aprovado (versão ' || (n ->> 'version') || ')',
        jsonb_build_object('finalidade', n ->> 'purpose'));

    elsif tg_table_name = 'contact_consents' then
      -- Sem o telefone: só o fato e o id.
      if tg_op = 'INSERT' then
        perform rita._log(v_clinic, 'consentimento', 'contact_consents', n ->> 'id',
          'Consentimento registrado (' || (n ->> 'purpose') || ', ' || (n ->> 'granted_via') || ')',
          jsonb_build_object('finalidade', n ->> 'purpose', 'via', n ->> 'granted_via',
                             'versao', n ->> 'text_version'));
      elsif (n ->> 'revoked_at') is not null and (o ->> 'revoked_at') is null then
        perform rita._log(v_clinic, 'consentimento_revogado', 'contact_consents', n ->> 'id',
          'Consentimento revogado (' || coalesce(n ->> 'revoked_via', 'sem via') || ')',
          jsonb_build_object('finalidade', n ->> 'purpose', 'via', n ->> 'revoked_via'));
      end if;

    elsif tg_table_name = 'opt_outs' then
      perform rita._log(null, 'descadastro', 'opt_outs', n ->> 'id',
        'Descadastro registrado (' || (n ->> 'via') || ')',
        jsonb_build_object('via', n ->> 'via'));

    elsif tg_table_name = 'evaluation_fee_campaigns' then
      if tg_op = 'INSERT' or (n ->> 'status') is distinct from (o ->> 'status') then
        perform rita._log(null, 'campanha', 'evaluation_fee_campaigns', n ->> 'id',
          'Campanha de isenção "' || (n ->> 'title') || '": '
            || case n ->> 'status' when 'draft' then 'proposta'
                                   when 'active' then 'ativada' else 'encerrada' end,
          jsonb_build_object('situacao', n ->> 'status', 'unidades', n -> 'clinic_ids',
                             'de', n ->> 'starts_on', 'ate', n ->> 'ends_on'));
      end if;
    end if;
  exception when others then
    begin
      insert into rita.falhas (origem, clinic_id, erro)
      values ('registro: ' || tg_table_name, v_clinic, left(sqlerrm, 1000));
    exception when others then
      raise warning 'rita._log_trg falhou em %: %', tg_table_name, sqlerrm;
    end;
  end;
  return null;
end;
$$;

revoke execute on function rita._log_trg() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['settings', 'escalation_routes', 'consent_texts', 'contact_consents',
                           'opt_outs', 'evaluation_fee_campaigns'] loop
    execute format('drop trigger if exists rita_log on rita.%I', t);
    execute format('create trigger rita_log after insert or update on rita.%I '
                   'for each row execute function rita._log_trg()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3) Os avisos "Rita: …" no sino
-- -----------------------------------------------------------------------------
create table if not exists rita.notices (
  id bigint generated always as identity primary key,
  clinic_id uuid,
  kind text not null,
  -- A trava contra repetir: a mesma chave não avisa duas vezes.
  dedupe_key text unique,
  recipients integer not null default 0,
  created_at timestamptz not null default now()
);

alter table rita.notices enable row level security;
revoke all on rita.notices from public, anon, authenticated;
grant all on rita.notices to service_role;

insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('rita', 'notices', 'Registro técnico dos avisos da Rita (trava contra repetir)')
on conflict do nothing;

-- Quem recebe: as pessoas ativas com um dos papéis NA UNIDADE (a Rita e outros
-- perfis técnicos nunca), mais os Admins Master se pedido, menos quem fez.
-- Devolve quantos avisos criou (0 = ninguém, ou já avisado por esta chave).
create or replace function rita._notify(
  p_clinic uuid,
  p_kind text,
  p_roles public.user_role[],
  p_title text,
  p_body text,
  p_link text,
  p_dedupe_key text default null,
  p_admins boolean default false,
  p_skip uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_notice bigint;
  v_n integer := 0;
begin
  if p_kind is null or btrim(p_kind) = '' or p_title is null or btrim(p_title) = '' then
    raise exception 'INVALID_INPUT';
  end if;
  -- O link diz ao app que o aviso é da Rita (categoria pelo link).
  if p_link is null or p_link !~ '^/rita(/|$)' then
    raise exception 'RITA_NOTICE_LINK';
  end if;
  v_title := case when p_title like 'Rita: %' then p_title else 'Rita: ' || p_title end;

  insert into rita.notices (clinic_id, kind, dedupe_key)
  values (p_clinic, p_kind, nullif(btrim(coalesce(p_dedupe_key, '')), ''))
  on conflict (dedupe_key) do nothing
  returning id into v_notice;
  if v_notice is null then
    return 0;
  end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct u, p_clinic, left(v_title, 200), left(p_body, 1000), p_link
  from (
    select r.user_id as u
    from public.user_clinic_roles_all r
    join public.profiles p on p.id = r.user_id and p.is_active and p.kind = 'person'
    where p_clinic is not null and r.clinic_id = p_clinic
      and r.role = any (coalesce(p_roles, '{}'))
    union
    select p.id
    from public.profiles p
    where p_admins and p.is_admin_master and p.is_active and p.kind = 'person'
  ) t
  where u is not null and u is distinct from p_skip;
  get diagnostics v_n = row_count;

  update rita.notices set recipients = v_n where id = v_notice;
  return v_n;
end;
$$;

revoke execute on function rita._notify(uuid, text, public.user_role[], text, text, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function rita._notify(uuid, text, public.user_role[], text, text, text, text, boolean, uuid) to service_role;

-- O nome da unidade para o texto do aviso.
create or replace function rita._clinic_name(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.name from public.clinics c where c.id = p_clinic), 'a rede');
$$;

revoke execute on function rita._clinic_name(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) O portão: as transferências passam a ser conferidas (sem pendentes)
-- -----------------------------------------------------------------------------
create or replace function rita._pending_items()
returns table (ordem integer, item text, rotulo text, detalhe text)
language sql
immutable
security definer
set search_path = ''
as $$
  -- Nenhum pendente desde a 0A.6: todo item do portão é conferido de verdade.
  select 0, ''::text, ''::text, ''::text where false;
$$;

revoke execute on function rita._pending_items() from public, anon, authenticated;

create or replace function rita._gaps(p_clinic uuid)
returns table (ordem integer, item text, rotulo text, ok boolean, detalhe text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  a record;
  f record;
  rt record;
  v_coord integer;
  v_maps text;
  v_dias_abertos integer;
  v_inclui boolean;
  v_recebe integer;
  v_reserva boolean;
begin
  select cl.id, cl.type, cl.is_active, cl.address, cl.address_number,
         cl.neighborhood, cl.city, cl.state, cl.zip_code
    into c
  from public.clinics cl where cl.id = p_clinic;

  select s.open_time, s.close_time, s.weekdays
    into a
  from public.clinic_agenda_settings s where s.clinic_id = p_clinic
  limit 1;

  select count(*) into v_coord
  from public.user_clinic_roles_all r
  join public.profiles p on p.id = r.user_id
  where r.clinic_id = p_clinic
    and r.role = 'clinical_coordinator'
    and p.is_active
    and p.kind = 'person';

  select nullif(btrim(coalesce(i.maps_url, '')), '') into v_maps
  from public.clinic_public_info i where i.clinic_id = p_clinic;

  select count(*) into v_dias_abertos
  from rita.weekday_hours(p_clinic) w
  where not w.closed and w.open_time is not null and w.close_time is not null;

  select * into f from rita.evaluation_fee(p_clinic);

  -- "O que a avaliação inclui": o texto aprovado da unidade, senão o da rede.
  select coalesce(
    (select t.status = 'approved' from public.patient_texts t
      where t.text_key = 'evaluation_includes' and t.clinic_id = p_clinic),
    (select t.status = 'approved' from public.patient_texts t
      where t.text_key = 'evaluation_includes' and t.clinic_id is null),
    false) into v_inclui;

  -- Transferências em horário comercial: alguém ativo com um dos papéis da
  -- rota NESTA unidade, ou a pessoa de reserva ativa.
  select * into rt from rita._route(p_clinic);
  select count(*) into v_recebe
  from public.user_clinic_roles_all r
  join public.profiles p on p.id = r.user_id
  where r.clinic_id = p_clinic
    and r.role = any (coalesce(rt.business_hours_roles, '{}'))
    and p.is_active
    and p.kind = 'person';
  v_reserva := rt.fallback_profile_id is not null and exists (
    select 1 from public.profiles p
    where p.id = rt.fallback_profile_id and p.is_active and p.kind = 'person');

  ordem := 10; item := 'identidade'; rotulo := 'A Rita existe neste banco';
  ok := rita.agent_id() is not null;
  detalhe := case when ok then null else 'Rodar scripts/rita-criar-identidade.mjs' end;
  return next;

  ordem := 20; item := 'unidade_ativa'; rotulo := 'Unidade ativa (não a Franqueadora)';
  ok := c.id is not null and c.is_active and coalesce(c.type::text, '') <> 'franchisor';
  detalhe := case
    when c.id is null then 'Unidade não encontrada'
    when not c.is_active then 'A unidade está desativada'
    when c.type::text = 'franchisor' then 'A Franqueadora não atende pacientes'
  end;
  return next;

  ordem := 30; item := 'endereco'; rotulo := 'Endereço completo da unidade';
  ok := c.id is not null
    and nullif(btrim(coalesce(c.address, '')), '') is not null
    and nullif(btrim(coalesce(c.address_number, '')), '') is not null
    and nullif(btrim(coalesce(c.neighborhood, '')), '') is not null
    and nullif(btrim(coalesce(c.city, '')), '') is not null
    and nullif(btrim(coalesce(c.state, '')), '') is not null
    and nullif(btrim(coalesce(c.zip_code, '')), '') is not null;
  detalhe := case when ok then null
    else 'Falta rua, número, bairro, cidade, estado ou CEP no cadastro da unidade' end;
  return next;

  ordem := 40; item := 'agenda'; rotulo := 'Agenda da unidade configurada';
  ok := a.open_time is not null and a.close_time is not null
    and a.open_time < a.close_time
    and coalesce(cardinality(a.weekdays), 0) > 0;
  detalhe := case when ok then null
    else 'Configurar abertura, fechamento e dias de atendimento da agenda' end;
  return next;

  ordem := 50; item := 'coordenador'; rotulo := 'Coordenador clínico ativo (faz a avaliação)';
  ok := v_coord > 0;
  detalhe := case when ok then null else 'Nenhum Coordenador clínico ativo nesta unidade' end;
  return next;

  ordem := 60; item := 'maps'; rotulo := 'Link do endereço no mapa';
  ok := v_maps is not null;
  detalhe := case when ok then null
    else 'Preencher o link do mapa nos Dados públicos da unidade' end;
  return next;

  ordem := 70; item := 'horario_por_dia'; rotulo := 'Horário de funcionamento por dia';
  ok := v_dias_abertos > 0;
  detalhe := case when ok then null
    else 'Nenhum dia aberto no Horário por dia (da unidade ou da rede)' end;
  return next;

  ordem := 80; item := 'avaliacao'; rotulo := 'Duração e valor (ou gratuidade) da avaliação';
  ok := coalesce(f.offered, false)
    and coalesce(f.minutes, 0) > 0
    and (coalesce(f.price_cents, 0) > 0 or f.campaign_id is not null);
  detalhe := case
    when ok then null
    when f.procedure_id is null then 'Nenhum procedimento marcado como avaliação de quem é novo'
    when not coalesce(f.offered, false) then 'A avaliação não está no rol da Rita ou a unidade marcou que não faz'
    when coalesce(f.minutes, 0) <= 0 then 'Duração da avaliação não configurada'
    else 'A avaliação está com valor zero e sem campanha de isenção ativa'
  end;
  return next;

  ordem := 90; item := 'avaliacao_inclui'; rotulo := 'O que a avaliação inclui';
  ok := v_inclui;
  detalhe := case when ok then null
    else 'Escrever e aprovar o texto "O que a avaliação inclui" (rede ou unidade)' end;
  return next;

  ordem := 100; item := 'transferencias'; rotulo := 'Quem recebe as transferências em horário comercial';
  ok := v_recebe > 0 or v_reserva;
  detalhe := case when ok then null
    else 'Ninguém ativo nesta unidade com a função que recebe as transferências (rota '
         || coalesce(rt.scope, 'rede') || '), e sem pessoa de reserva ativa' end;
  return next;

  -- Pendentes (vazio desde a 0A.6; o laço fica para uma entrega futura).
  for ordem, item, rotulo, detalhe in select * from rita._pending_items() loop
    ok := false;
    return next;
  end loop;
end;
$$;

revoke execute on function rita._gaps(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) A pausa automática agora avisa
-- -----------------------------------------------------------------------------
create or replace function rita._pause_if_gaps(p_clinic uuid, p_origem text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_faltam text;
begin
  if p_clinic is null then
    return false;
  end if;
  if not exists (select 1 from rita.settings where clinic_id = p_clinic and enabled) then
    return false;
  end if;
  select string_agg(g.rotulo, '; ' order by g.ordem) into v_faltam
  from rita._gaps(p_clinic) g where not g.ok;
  if v_faltam is null then
    return false;
  end if;
  update rita.settings set
    enabled = false,
    paused_by = null,
    paused_at = now(),
    paused_reason = left('Pausada sozinha (' || p_origem || '). Falta: ' || v_faltam, 500),
    updated_at = now()
  where clinic_id = p_clinic;

  -- O aviso nunca desfaz a pausa: falhou, registra e segue.
  begin
    perform rita._notify(
      p_clinic, 'pausa', array['unit_manager']::public.user_role[],
      'Rita: pausada em ' || rita._clinic_name(p_clinic),
      left('A assistente virtual parou de atender sozinha nesta unidade. Falta: ' || v_faltam
           || '. Para voltar, complete o que falta e peça ao Admin para ligar de novo.', 1000),
      '/rita/' || p_clinic,
      'pausa:' || p_clinic || ':' || extract(epoch from clock_timestamp())::text,
      true, null);
  exception when others then
    begin
      insert into rita.falhas (origem, clinic_id, erro)
      values ('aviso da pausa', p_clinic, left(sqlerrm, 1000));
    exception when others then
      raise warning 'rita._pause_if_gaps: aviso falhou: %', sqlerrm;
    end;
  end;
  return true;
end;
$$;

revoke execute on function rita._pause_if_gaps(uuid, text) from public, anon, authenticated;
grant execute on function rita._pause_if_gaps(uuid, text) to service_role;

-- Ligar e desligar pela tela: a mesma regra da 3001, mais o aviso a quem
-- precisa saber (nunca a quem clicou).
create or replace function rita.set_enabled(p_clinic uuid, p_enabled boolean, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_faltam text;
  v_motivo text := coalesce(nullif(btrim(p_reason), ''), 'Desligada pela tela');
begin
  -- Ligar e desligar é ato de PESSOA (a pausa automática tem caminho próprio).
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_enabled is null then
    raise exception 'INVALID_INPUT';
  end if;

  -- A REDE: só o Admin Master, nos dois sentidos.
  if p_clinic is null then
    if not public.is_admin_master() then
      raise exception 'NOT_ALLOWED';
    end if;
    if p_enabled and rita.agent_id() is null then
      raise exception 'RITA_AGENT_MISSING';
    end if;
    update rita.settings set
      enabled = p_enabled,
      activated_by = case when p_enabled then v_uid else activated_by end,
      activated_at = case when p_enabled then now() else activated_at end,
      paused_by = case when p_enabled then null else v_uid end,
      paused_at = case when p_enabled then null else now() end,
      paused_reason = case when p_enabled then null else v_motivo end,
      updated_at = now()
    where clinic_id is null;
    perform rita._notify(
      null, case when p_enabled then 'ligada' else 'desligada' end, '{}'::public.user_role[],
      case when p_enabled then 'Rita: ligada na rede' else 'Rita: desligada na rede' end,
      case when p_enabled then 'A assistente virtual foi ligada para a rede. Cada unidade ainda precisa ser ligada.'
           else 'A assistente virtual foi desligada para a rede inteira. Motivo: ' || v_motivo end,
      '/rita', null, true, v_uid);
    return;
  end if;

  if not exists (select 1 from public.clinics where id = p_clinic) then
    raise exception 'CLINIC_NOT_FOUND';
  end if;

  if p_enabled then
    -- LIGAR a unidade: só o Admin Master, com a rede ligada e o portão completo.
    if not public.is_admin_master() then
      raise exception 'NOT_ALLOWED';
    end if;
    if not exists (
      select 1 from rita.settings where clinic_id is null and enabled and mode <> 'off'
    ) then
      raise exception 'NETWORK_OFF';
    end if;
    select string_agg(g.item, ',' order by g.ordem) into v_faltam
    from rita._gaps(p_clinic) g where not g.ok;
    if v_faltam is not null then
      raise exception 'ACTIVATION_GAPS:%', v_faltam;
    end if;

    insert into rita.settings (clinic_id, enabled, activated_by, activated_at)
    values (p_clinic, true, v_uid, now())
    on conflict on constraint rita_settings_clinic_key do update set
      enabled = true,
      activated_by = excluded.activated_by,
      activated_at = excluded.activated_at,
      paused_by = null,
      paused_at = null,
      paused_reason = null,
      updated_at = now();
    perform rita._notify(
      p_clinic, 'ligada', array['unit_manager']::public.user_role[],
      'Rita: ligada em ' || rita._clinic_name(p_clinic),
      'A assistente virtual passou a atender nesta unidade. O Gerente pode desligá-la a qualquer momento.',
      '/rita/' || p_clinic, null, false, v_uid);
  else
    -- DESLIGAR (pânico): Admin Master ou o Gerente DESTA unidade, sempre.
    if not (public.is_admin_master()
            or public.has_role_in_clinic(p_clinic, array['unit_manager']::public.user_role[])) then
      raise exception 'NOT_ALLOWED';
    end if;
    insert into rita.settings (clinic_id, enabled, paused_by, paused_at, paused_reason)
    values (p_clinic, false, v_uid, now(), v_motivo)
    on conflict on constraint rita_settings_clinic_key do update set
      enabled = false,
      paused_by = excluded.paused_by,
      paused_at = excluded.paused_at,
      paused_reason = excluded.paused_reason,
      updated_at = now();
    perform rita._notify(
      p_clinic, 'desligada', array['unit_manager']::public.user_role[],
      'Rita: desligada em ' || rita._clinic_name(p_clinic),
      'A assistente virtual foi desligada nesta unidade. Motivo: ' || v_motivo,
      '/rita/' || p_clinic, null, true, v_uid);
  end if;
end;
$$;

revoke execute on function rita.set_enabled(uuid, boolean, text) from public, anon, authenticated;
grant execute on function rita.set_enabled(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) Pausa automática: a rota e as pessoas que a cumprem
-- -----------------------------------------------------------------------------
create or replace function rita._recheck_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
  r record;
begin
  begin
    if tg_table_name = 'clinics' then
      v_old := case when tg_op <> 'INSERT' then old.id end;
      v_new := case when tg_op <> 'DELETE' then new.id end;
    else
      v_old := case when tg_op <> 'INSERT' then (to_jsonb(old) ->> 'clinic_id')::uuid end;
      v_new := case when tg_op <> 'DELETE' then (to_jsonb(new) ->> 'clinic_id')::uuid end;
    end if;

    -- Linha que vale para a REDE (horário padrão, texto da rede, rota da rede)
    -- ou para todas (o procedimento do catálogo): confere todas as ligadas.
    if v_old is null and v_new is null
       and tg_table_name in ('clinic_weekday_hours', 'patient_texts', 'procedures', 'escalation_routes') then
      for r in select s.clinic_id from rita.settings s where s.clinic_id is not null and s.enabled loop
        perform rita._pause_if_gaps(r.clinic_id, tg_table_name);
      end loop;
      return null;
    end if;

    perform rita._pause_if_gaps(v_old, tg_table_name);
    if v_new is distinct from v_old then
      perform rita._pause_if_gaps(v_new, tg_table_name);
    end if;
  exception when others then
    -- ⚠️ Nunca derruba a gravação de quem mexeu: registra e segue.
    begin
      insert into rita.falhas (origem, clinic_id, erro)
      values ('pausa automática: ' || tg_table_name, coalesce(v_new, v_old), left(sqlerrm, 1000));
    exception when others then
      raise warning 'rita._recheck_trg falhou em %: %', tg_table_name, sqlerrm;
    end;
  end;
  return null;
end;
$$;

revoke execute on function rita._recheck_trg() from public, anon, authenticated;

drop trigger if exists rita_recheck on rita.escalation_routes;
create trigger rita_recheck
  after update or delete on rita.escalation_routes
  for each row execute function rita._recheck_trg();

-- Pessoa desativada: confere toda unidade onde ela tem função (o Coordenador
-- da avaliação, a Recepção das transferências) e onde é a reserva da rota.
create or replace function rita._recheck_profile_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  begin
    for r in
      select distinct u.clinic_id
      from public.user_clinic_roles_all u
      where u.user_id = new.id
      union
      select e.clinic_id from rita.escalation_routes e
      where e.fallback_profile_id = new.id and e.clinic_id is not null
      union
      select s.clinic_id from rita.settings s
      where s.clinic_id is not null and s.enabled
        and exists (select 1 from rita.escalation_routes e
                    where e.clinic_id is null and e.fallback_profile_id = new.id)
    loop
      perform rita._pause_if_gaps(r.clinic_id, 'profiles');
    end loop;
  exception when others then
    begin
      insert into rita.falhas (origem, erro)
      values ('pausa automática: profiles', left(sqlerrm, 1000));
    exception when others then
      raise warning 'rita._recheck_profile_trg falhou: %', sqlerrm;
    end;
  end;
  return null;
end;
$$;

revoke execute on function rita._recheck_profile_trg() from public, anon, authenticated;

select public.audit_attach_all();

notify pgrst, 'reload schema';
