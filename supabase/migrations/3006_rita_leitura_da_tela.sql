-- =============================================================================
-- 3006 — Rita, Fase 0A.7a: a leitura da tela "O que a Rita sabe"
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.7 (DA7). A 0A.7 foi dividida
-- pelo dono (10/11/2026): 0A.7a = VER (e ligar/desligar, que já existe);
-- 0A.7b = editar pela tela.
--
-- O QUE CRIA (só leitura; nenhuma tabela nova; o único dado que entra é a
-- permissão `modulo.rita` para Gerente e Rede, na seção 4)
--   * `rita.screen_units()` — a lista de unidades com o estado da Rita
--     (desligada / pronta para ligar / ligada / pausada) e quantas lacunas.
--   * `rita.screen_unit(p_clinic)` — tudo o que a Rita vai dizer sobre a
--     unidade, montado pelas MESMAS funções que a Rita usa (DA7: a tela nunca
--     mostra o que a Rita não lê): portão (`_gaps`), horário (`weekday_hours`),
--     próximos dias fechados (`unit_day`), catálogo (`catalog`), valor da
--     avaliação (`evaluation_fee`), rota (`_route`) e o registro
--     (`rita.actions`, as 30 mais recentes).
--
-- QUEM LÊ: pessoa logada; Admin Master qualquer unidade; os demais, só as
-- unidades de `user_full_access_clinic_ids()` (a mesma guarda de
-- `rita.activation_gaps`, 3001). O menu e a página ainda pedem `modulo.rita`
-- (matriz, no app). Nada aqui tem dado de paciente: o registro não guarda
-- telefone nem texto de mensagem (3005).
--
-- A tela lê pelo schema `rita` exposto na API (decisão do dono, 10/11/2026:
-- opção A). Enquanto um projeto não expuser, a tela diz isso em vez de errar.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Quem pode ler a unidade (interna)
-- -----------------------------------------------------------------------------
create or replace function rita._can_read_unit(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and p_clinic is not null
     and (public.is_admin_master()
          or p_clinic in (select public.user_full_access_clinic_ids()));
$$;

revoke execute on function rita._can_read_unit(uuid) from public, anon, authenticated;
grant execute on function rita._can_read_unit(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2) A lista de unidades
-- -----------------------------------------------------------------------------
-- A lista ganhou `paused_auto` ainda no treino: o retorno muda, então derruba.
drop function if exists rita.screen_units();
create or replace function rita.screen_units()
returns table (
  clinic_id uuid, clinic_name text, enabled boolean, paused_at timestamptz,
  paused_auto boolean, paused_reason text, mode text, gaps integer,
  network_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rede rita.settings;
begin
  if auth.uid() is null then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_rede from rita.settings s where s.clinic_id is null;

  return query
  select c.id,
         c.name,
         coalesce(s.enabled, false),
         s.paused_at,
         -- Pausada pela régua (sem pessoa) × desligada por alguém.
         coalesce(not s.enabled and s.paused_at is not null and s.paused_by is null, false),
         s.paused_reason,
         coalesce(s.mode, 'sombra'),
         (select count(*)::integer from rita._gaps(c.id) g where not g.ok),
         coalesce(v_rede.enabled, false)
  from public.clinics c
  left join rita.settings s on s.clinic_id = c.id
  where c.is_active
    and c.type = 'franchise_unit'
    and rita._can_read_unit(c.id)
  order by c.name;
end;
$$;

revoke execute on function rita.screen_units() from public, anon, authenticated;
grant execute on function rita.screen_units() to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Tudo o que a Rita sabe sobre uma unidade
-- -----------------------------------------------------------------------------
create or replace function rita.screen_unit(p_clinic uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_out jsonb;
begin
  if not rita._can_read_unit(p_clinic) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic) then
    raise exception 'NOT_FOUND';
  end if;

  select jsonb_build_object(
    'clinic', (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'city', c.city,
        'state', c.state, 'phone', c.phone)
      from public.clinics c where c.id = p_clinic),
    'public_info', (
      select jsonb_build_object(
        'public_name', i.public_name, 'landmark', i.landmark,
        'maps_url', i.maps_url, 'parking', i.parking,
        'accessibility', i.accessibility, 'whatsapp_e164', i.whatsapp_e164,
        'min_child_age', i.min_child_age, 'updated_at', i.updated_at)
      from public.clinic_public_info i where i.clinic_id = p_clinic),
    'network', (
      select jsonb_build_object('enabled', s.enabled, 'mode', s.mode)
      from rita.settings s where s.clinic_id is null),
    'settings', (
      select jsonb_build_object(
        'enabled', s.enabled, 'mode', s.mode,
        'activated_at', s.activated_at,
        'activated_by', (select p.full_name from public.profiles p where p.id = s.activated_by),
        'paused_at', s.paused_at, 'paused_reason', s.paused_reason,
        'paused_by', (select p.full_name from public.profiles p where p.id = s.paused_by),
        'updated_at', s.updated_at)
      from rita.settings s where s.clinic_id = p_clinic),
    'effective_mode', rita.effective_mode(p_clinic),
    'gaps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ordem', g.ordem, 'item', g.item, 'rotulo', g.rotulo,
        'ok', g.ok, 'detalhe', g.detalhe) order by g.ordem)
      from rita._gaps(p_clinic) g), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', h.weekday, 'closed', h.closed,
        'open_time', h.open_time, 'close_time', h.close_time,
        'lunch_start', h.lunch_start, 'lunch_end', h.lunch_end,
        'origem', h.origem) order by h.weekday)
      from rita.weekday_hours(p_clinic) h), '[]'::jsonb),
    'closed_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d::date, 'holiday_name', u.holiday_name, 'reason', u.reason)
        order by d)
      from generate_series(v_hoje, v_hoje + 45, interval '1 day') d
      cross join lateral rita.unit_day(p_clinic, d::date) u
      where not u.is_open and u.holiday_name is not null), '[]'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(jsonb_build_object(
        'procedure_id', k.procedure_id, 'name', k.name,
        'patient_name', k.patient_name, 'rita_role', k.rita_role,
        'price_cents', k.price_cents, 'minutes', k.minutes))
      from rita.catalog(p_clinic) k), '[]'::jsonb),
    'fee', (
      select to_jsonb(f) from rita.evaluation_fee(p_clinic) f limit 1),
    'route', (
      select jsonb_build_object(
        'scope', r.scope,
        'business_hours_roles', to_jsonb(r.business_hours_roles),
        'sla_alert_roles', to_jsonb(r.sla_alert_roles),
        'sla_alert_after_minutes', r.sla_alert_after_minutes,
        'sla_escalate_to_admin_after_minutes', r.sla_escalate_to_admin_after_minutes,
        'fallback_name', (select p.full_name from public.profiles p where p.id = r.fallback_profile_id))
      from rita._route(p_clinic) r limit 1),
    'actions', coalesce((
      select jsonb_agg(x.j order by x.created_at desc)
      from (
        select a.created_at,
               jsonb_build_object(
                 'id', a.id, 'kind', a.kind, 'summary', a.summary,
                 'scope', case when a.clinic_id is null then 'rede' else 'unidade' end,
                 'actor_kind', a.actor_kind,
                 'actor_name', (select p.full_name from public.profiles p where p.id = a.actor_id),
                 'created_at', a.created_at) as j
        from rita.actions a
        where a.clinic_id = p_clinic or a.clinic_id is null
        order by a.created_at desc
        limit 30
      ) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function rita.screen_unit(uuid) from public, anon, authenticated;
grant execute on function rita.screen_unit(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A permissão do módulo (DA7): Gerente e Franqueadora/Rede. O Admin Master
-- passa sempre (não está na matriz). Mesmo padrão de `permissions.ts`.
-- -----------------------------------------------------------------------------
insert into public.permission_matrix (capability, role) values
  ('modulo.rita', 'unit_manager'),
  ('modulo.rita', 'franchisor_staff')
on conflict do nothing;
