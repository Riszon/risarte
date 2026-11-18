-- =============================================================================
-- 0427 — FIM DO TRATAMENTO, ETAPA 6: PRAZOS E INDICADORES
-- Plano: docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seções 5.8, 7.2 e 8 (C4, D26).
--
--   1. Os DIAS ÚTEIS DA UNIDADE (C4): fim de semana, feriado nacional, estadual
--      e municipal da cidade da unidade, menos os feriados em que a unidade
--      decidiu atender (`clinic_holiday_decisions`, 0047).
--   2. A TAREFA PARADA VOLTA A AVISAR (7.2): a decisão do fim, a reavaliação,
--      o contato e o abandono parados há N dias úteis da unidade (Prazos,
--      `stalled_task_business_days`, padrão 3) avisam de novo quem responde e
--      o Gerente. Rotina diária.
--   3. OS INDICADORES (8, D26): o resumo do dentista no Meu dia
--      (`my_end_of_treatment_summary`) e quatro indicadores no catálogo das
--      Metas (taxa de refação, clientes satisfeitos, decisão em até 3 dias
--      úteis e clientes sem próximo passo).
--
-- ⚠️ `_goal_indicator_meta` e `_goal_measure_raw` são recriadas A PARTIR DA
-- 0365 (conferido: o texto em vigor no treino é igual ao da 0365), com os
-- ramos novos no fim. Ao recriar de novo, partir desta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os dias úteis da unidade (C4)
-- -----------------------------------------------------------------------------
create or replace function public._dia_util_da_unidade(p_clinic_id uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(isodow from p_day) < 6
     and not exists (
       select 1
         from public.holidays h
         join public.clinics c on c.id = p_clinic_id
        where h.holiday_date = p_day
          and (h.scope = 'national'
               or (h.scope = 'state' and h.state = upper(btrim(c.state)))
               or (h.scope = 'city' and h.state = upper(btrim(c.state))
                   and lower(btrim(h.city)) = lower(btrim(c.city))))
          and not exists (
            select 1 from public.clinic_holiday_decisions d
             where d.clinic_id = p_clinic_id and d.holiday_date = p_day and d.will_attend)
     );
$$;
revoke execute on function public._dia_util_da_unidade(uuid, date) from public, anon, authenticated;

-- Dias úteis da unidade DEPOIS de p_from até p_to (p_from não conta; p_to conta).
create or replace function public.clinic_business_days_between(p_clinic_id uuid, p_from date, p_to date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select count(*)::integer
      from generate_series(p_from + 1, p_to, interval '1 day') as g (d)
     where public._dia_util_da_unidade(p_clinic_id, g.d::date)
  ), 0);
$$;
revoke execute on function public.clinic_business_days_between(uuid, date, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A tarefa parada volta a avisar (7.2)
-- -----------------------------------------------------------------------------
insert into public.inactivity_settings (clinic_id, setting_key, value_days) values
  (null, 'stalled_task_business_days', 3)
on conflict do nothing;

alter table public.treatment_closures add column if not exists reminded_at timestamptz;
alter table public.treatment_abandonments add column if not exists reminded_at timestamptz;

create or replace function public.end_of_treatment_reminders(p_clinic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_prazo integer;
  v_roles public.user_role[];
  v_user uuid;
  v_title text;
  v_hoje date := public.today_br();
begin
  -- (a) As tarefas do fechamento (uma decisão por cliente: só o líder).
  for r in
    select f.id, f.clinic_id, f.client_id, f.status, f.asked_user_id, c.full_name,
           greatest(f.updated_at, coalesce(f.reminded_at, f.updated_at)) as ref
      from public.treatment_closures f
      join public.clients c on c.id = f.client_id
     where f.grouped_into is null
       and f.status in ('pergunta', 'coordenador', 'reavaliacao', 'contato', 'agendar_avaliacao')
       and (p_clinic_id is null or f.clinic_id = p_clinic_id)
  loop
    -- A reavaliação com horário marcado não está parada.
    if r.status in ('reavaliacao', 'agendar_avaliacao') and public._tem_horario_futuro(r.client_id) then
      continue;
    end if;
    v_prazo := coalesce(public.inactivity_threshold(r.clinic_id, 'stalled_task_business_days'), 3);
    if public.clinic_business_days_between(r.clinic_id, (r.ref at time zone 'America/Sao_Paulo')::date, v_hoje) < v_prazo then
      continue;
    end if;
    v_user := case when r.status = 'pergunta' then r.asked_user_id end;
    v_roles := case r.status
      when 'pergunta' then case when r.asked_user_id is null then array['clinical_coordinator', 'unit_manager'] else array['unit_manager'] end
      when 'reavaliacao' then array['receptionist', 'clinical_coordinator', 'unit_manager']
      when 'agendar_avaliacao' then array['receptionist', 'unit_manager']
      else array['clinical_coordinator', 'unit_manager'] end::public.user_role[];
    v_title := case r.status
      when 'pergunta' then 'Parado: decisão do fim do tratamento'
      when 'coordenador' then 'Parado: decisão do Coordenador'
      when 'reavaliacao' then 'Parado: reavaliação sem horário'
      when 'contato' then 'Parado: contato com o cliente'
      else 'Parado: agendar a avaliação completa' end;
    perform public._fechamento_avisar(
      r.clinic_id, v_roles, v_user,
      v_title || ' — ' || coalesce(r.full_name, 'Cliente'),
      'Esta tarefa está parada há ' || v_prazo || ' dia(s) útil(eis) ou mais. O cliente não pode ser esquecido.',
      '/prontuarios/' || r.client_id, null);
    update public.treatment_closures set reminded_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;

  -- (b) O abandono.
  for r in
    select t.id, t.clinic_id, t.client_id, t.status, c.full_name,
           greatest(t.updated_at, coalesce(t.reminded_at, t.updated_at)) as ref
      from public.treatment_abandonments t
      join public.clients c on c.id = t.client_id
     where t.status <> 'encerrado'
       and (p_clinic_id is null or t.clinic_id = p_clinic_id)
  loop
    v_prazo := coalesce(public.inactivity_threshold(r.clinic_id, 'stalled_task_business_days'), 3);
    if public.clinic_business_days_between(r.clinic_id, (r.ref at time zone 'America/Sao_Paulo')::date, v_hoje) < v_prazo then
      continue;
    end if;
    v_roles := case r.status
      when 'reagendar' then array['receptionist', 'unit_manager']
      when 'contato' then array['clinical_coordinator', 'unit_manager']
      else array['unit_manager'] end::public.user_role[];
    perform public._fechamento_avisar(
      r.clinic_id, v_roles, null,
      'Parado: abandono de tratamento — ' || coalesce(r.full_name, 'Cliente'),
      'A tarefa de abandono está parada há ' || v_prazo || ' dia(s) útil(eis) ou mais.',
      '/prontuarios/' || r.client_id, null);
    update public.treatment_abandonments set reminded_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.end_of_treatment_reminders(uuid) from public, anon, authenticated;

do $$
begin
  perform cron.schedule(
    'risarte-fim-lembretes-daily', '40 11 * * 1-5',
    'select public.end_of_treatment_reminders()'
  );
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) A lista "Clientes sem próximo passo", interna e reaproveitada (7.4)
-- -----------------------------------------------------------------------------
create or replace function public._sem_proximo_passo(p_clinic_id uuid)
returns table (
  client_id uuid,
  clinic_id uuid,
  full_name text,
  journey_phase public.journey_phase,
  reason text,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parado integer;
begin
  v_parado := coalesce(public.inactivity_threshold(p_clinic_id, 'stalled_treatment_days'), 30);
  return query
  select c.id, c.clinic_id, c.full_name, c.journey_phase,
    case
      when exists (select 1 from public.treatment_sessions ts
                    where ts.client_id = c.id and ts.status = 'pending')
        then 'sessoes_sem_horario'
      when exists (select 1 from public.ortho_cases o
                    where o.client_id = c.id and o.status = 'suspenso')
        then 'ortodontia_suspensa'
      when exists (select 1 from public.ortho_cases o
                    where o.client_id = c.id and o.status = 'aguardando_inicio')
        then 'ortodontia_sem_inicio'
      when exists (select 1 from public.treatment_plans tp
                    where tp.client_id = c.id and tp.complement_of_plan_id is not null
                      and tp.superseded_at is null
                      and coalesce(tp.lifecycle::text, '') not in
                          ('reprovado', 'cancelado', 'concluido', 'aceito', 'em_tratamento', 'suspenso'))
        then 'complemento_parado'
      when c.journey_phase = 'reevaluation' then 'reavaliacao_sem_horario'
      else 'sem_tratamento_pendente'
    end,
    public._ultima_atividade(c.id)
  from public.clients c
  where c.clinic_id = p_clinic_id
    and c.journey_phase in ('treatment_start', 'reevaluation')
    and not public._tem_horario_futuro(c.id)
    -- nenhuma tarefa aberta
    and not exists (select 1 from public.treatment_closures f
                     where f.client_id = c.id and f.status <> 'encerrado')
    and not exists (select 1 from public.treatment_abandonments t
                     where t.client_id = c.id and t.status <> 'encerrado')
    -- a ortodontia em tratamento protege; a suspensa não (D19)
    and not exists (select 1 from public.ortho_cases o
                     where o.client_id = c.id and o.status = 'em_tratamento')
    -- o complemento com movimento recente protege; o parado não (D19)
    and not exists (select 1 from public.treatment_plans tp
                     where tp.client_id = c.id and tp.complement_of_plan_id is not null
                       and tp.superseded_at is null
                       and coalesce(tp.lifecycle::text, '') not in
                           ('reprovado', 'cancelado', 'concluido', 'aceito', 'em_tratamento', 'suspenso')
                       and coalesce(tp.updated_at, tp.created_at) > now() - make_interval(days => v_parado));
end;
$$;
revoke execute on function public._sem_proximo_passo(uuid) from public, anon, authenticated;

create or replace function public.clients_without_next_step(p_clinic_id uuid)
returns table (
  client_id uuid,
  full_name text,
  journey_phase public.journey_phase,
  reason text,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(p_clinic_id,
          array['clinical_coordinator', 'unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
    select x.client_id, x.full_name, x.journey_phase, x.reason, x.last_activity_at
      from public._sem_proximo_passo(p_clinic_id) x
     order by x.last_activity_at nulls first;
end;
$$;
revoke execute on function public.clients_without_next_step(uuid) from public, anon, authenticated;
grant execute on function public.clients_without_next_step(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O Meu dia do dentista (D26): as notas técnicas e a satisfação dele
-- -----------------------------------------------------------------------------
create or replace function public.my_end_of_treatment_summary(
  p_clinic_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  excelente integer,
  bom integer,
  aceitavel integer,
  revisar integer,
  refazer integer,
  respostas integer,
  satisfeitos integer,
  queixas integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(p_clinic_id,
          array['dentist', 'clinical_coordinator', 'planner_dentist']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
    select
      (select count(*)::integer from public.plan_quality_reviews r
        where r.executor_dentist_id = v_user and r.clinic_id = p_clinic_id and r.level = 'excelente'
          and r.reviewed_at >= p_from and r.reviewed_at < p_to),
      (select count(*)::integer from public.plan_quality_reviews r
        where r.executor_dentist_id = v_user and r.clinic_id = p_clinic_id and r.level = 'bom'
          and r.reviewed_at >= p_from and r.reviewed_at < p_to),
      (select count(*)::integer from public.plan_quality_reviews r
        where r.executor_dentist_id = v_user and r.clinic_id = p_clinic_id and r.level = 'aceitavel'
          and r.reviewed_at >= p_from and r.reviewed_at < p_to),
      (select count(*)::integer from public.plan_quality_reviews r
        where r.executor_dentist_id = v_user and r.clinic_id = p_clinic_id and r.level = 'revisar'
          and r.reviewed_at >= p_from and r.reviewed_at < p_to),
      (select count(*)::integer from public.plan_quality_reviews r
        where r.executor_dentist_id = v_user and r.clinic_id = p_clinic_id and r.level = 'refazer'
          and r.reviewed_at >= p_from and r.reviewed_at < p_to),
      (select count(*)::integer from public.treatment_closure_contacts k
         join public.treatment_closures f on f.id = k.closure_id
        where f.asked_user_id = v_user and k.clinic_id = p_clinic_id and k.satisfaction is not null
          and k.contacted_at >= p_from and k.contacted_at < p_to),
      (select count(*)::integer from public.treatment_closure_contacts k
         join public.treatment_closures f on f.id = k.closure_id
        where f.asked_user_id = v_user and k.clinic_id = p_clinic_id and k.satisfaction >= 9
          and k.contacted_at >= p_from and k.contacted_at < p_to),
      (select count(*)::integer from public.treatment_closure_contacts k
         join public.treatment_closures f on f.id = k.closure_id
        where f.asked_user_id = v_user and k.clinic_id = p_clinic_id and k.has_complaint
          and k.contacted_at >= p_from and k.contacted_at < p_to);
end;
$$;
revoke execute on function public.my_end_of_treatment_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.my_end_of_treatment_summary(uuid, timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) As Metas (D26): o catálogo (espelho de src/lib/metas/indicadores.ts)
-- -----------------------------------------------------------------------------
create or replace function public._goal_indicator_meta(p_indicator text)
returns table (kind text, per_person boolean, money boolean, can_decrease boolean, in_app boolean)
language sql
immutable
set search_path = ''
as $$
  select m.kind, m.per_person, m.money, m.can_decrease, m.in_app
    from (values
      -- INDICADORES:INICIO
      ('sales_value',            'sum',   true,  true,  false, false),
      ('sales_count',            'sum',   true,  false, false, false),
      ('sales_ticket',           'rate',  true,  true,  false, false),
      ('conversion_rate',        'rate',  true,  false, false, false),
      ('discount_avg',           'rate',  true,  false, false, false),
      ('sales_cancelled',        'sum',   false, false, true,  false),
      ('revenue_received',       'sum',   false, true,  false, false),
      ('revenue_billed',         'sum',   false, true,  false, false),
      ('overdue_rate',           'point', false, true,  false, false),
      ('overdue_value',          'point', false, true,  false, false),
      ('overdue_recovery',       'sum',   false, true,  false, false),
      ('net_margin',             'rate',  false, true,  false, false),
      ('contribution_margin',    'rate',  false, true,  false, false),
      ('breakeven_reached',      'rate',  false, true,  false, false),
      ('on_time_payment',        'rate',  false, true,  false, false),
      ('appointments_created',   'sum',   true,  false, false, false),
      ('appointments_done',      'sum',   true,  false, false, false),
      ('evaluations_done',       'sum',   true,  false, false, false),
      ('attendance_rate',        'rate',  true,  false, false, false),
      ('no_show_rate',           'rate',  true,  false, false, false),
      ('check_ins',              'sum',   true,  false, false, false),
      ('returns_scheduled',      'sum',   true,  false, false, false),
      ('chair_occupancy',        'rate',  false, false, false, true),
      ('chair_idle_hours',       'sum',   false, false, true,  true),
      ('procedures_done',        'sum',   true,  false, false, false),
      ('provider_production',    'sum',   true,  true,  false, false),
      ('plan_options_approved',  'sum',   true,  false, false, false),
      ('treatments_completed',   'sum',   false, false, false, false),
      ('new_clients',            'sum',   true,  false, false, false),
      ('new_clients_evaluated',  'sum',   true,  false, false, false),
      ('journey_conversion',     'rate',  false, false, false, false),
      ('reactivated_clients',    'sum',   false, false, false, false),
      ('ppr_adhesions',          'sum',   true,  false, false, false),
      ('ppr_cancellations',      'sum',   false, false, true,  false),
      ('ppr_lives',              'point', false, false, false, false),
      ('indica_referrals',       'sum',   true,  false, false, false),
      ('indica_conversions',     'sum',   true,  false, false, false),
      ('indica_ambassadors',     'sum',   true,  false, false, false),
      ('empresarial_companies',  'sum',   true,  false, false, false),
      ('empresarial_lives',      'sum',   false, false, false, false),
      ('certifications',         'sum',   true,  false, false, false),
      ('reports_sent',           'sum',   true,  false, false, false),
      -- 0365 (Ortodontia e PPR+, ORTO3)
      ('ortho_new_cases',        'sum',   true,  false, false, false),
      ('ortho_active_patients',  'point', false, false, false, false),
      ('ortho_finished_on_time', 'sum',   false, false, false, false),
      ('ortho_revenue',          'sum',   false, true,  false, false),
      ('ortho_revenue_share',    'rate',  false, true,  false, false),
      ('ortho_overdue',          'rate',  false, true,  false, false),
      ('ppr_revenue',            'sum',   false, true,  false, false),
      ('ppr_revenue_share',      'rate',  false, true,  false, false),
      ('ppr_overdue',            'rate',  false, true,  false, false),
      ('gross_revenue',          'sum',   false, true,  false, false),
      ('revenue_private',        'sum',   false, true,  false, false),
      ('revenue_empresarial',    'sum',   false, true,  false, false),
      ('revenue_empresarial_all','sum',   false, true,  false, false),
      -- 0427 (fim do tratamento, Etapa 6)
      ('redo_rate',              'rate',  true,  false, false, false),
      ('client_satisfaction',    'rate',  true,  false, false, false),
      ('closure_decided_on_time','rate',  true,  false, false, false),
      ('clients_without_next_step','point', false, false, false, false)
      -- INDICADORES:FIM
    ) as m (indicator, kind, per_person, money, can_decrease, in_app)
   where m.indicator = p_indicator;
$$;

-- -----------------------------------------------------------------------------
-- 6) A medição: a da 0365 + os 4 indicadores do fim do tratamento
-- -----------------------------------------------------------------------------
create or replace function public._goal_measure_raw(
  p_indicator text,
  p_filters jsonb,
  p_clinic_ids uuid[],
  p_from date,
  p_to date
)
returns table (clinic_id uuid, user_id uuid, day date, num numeric, den numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_from timestamptz := (p_from::timestamp at time zone 'America/Sao_Paulo');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_today date := public.today_br();
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_types text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'appointment_types', '[]'::jsonb)) as t (x));
  v_specialties text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'specialties', '[]'::jsonb)) as t (x));
  v_origins text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'client_origins', '[]'::jsonb)) as t (x));
  v_plans text[] := array(select x from jsonb_array_elements_text(coalesce(v_f -> 'ppr_plans', '[]'::jsonb)) as t (x));
  v_sale_origin text := nullif(v_f ->> 'sale_origin', '');
  v_esp boolean;
begin
  if p_from is null or p_to is null or p_to < p_from or coalesce(cardinality(p_clinic_ids), 0) = 0 then
    return;
  end if;
  v_esp := cardinality(v_specialties) > 0;

  if p_indicator in ('sales_value', 'sales_count', 'sales_ticket') then
    -- Venda fechada = contrato + pagamento (closed_at), sem cancelamento.
    -- Quem vendeu: o consultor da negociação; venda direta: quem a criou.
    -- N4: com recorte de especialidade, em R$ conta a PARTE proporcional dos
    -- procedimentos dela (o desconto se reparte na mesma proporção); em
    -- quantidade, conta a venda que tem ao menos um procedimento dela.
    return query
      with plano as (
        select cs.clinic_id, pn.consultant_id as user_id, cs.closed_at as at, cs.final_cents::numeric as cents,
               cs.negotiation_id
          from public.commercial_sales cs
          join public.plan_negotiations pn on pn.id = cs.negotiation_id
         where cs.closed_at >= v_from and cs.closed_at < v_to
           and cs.cancelled_at is null
           and cs.clinic_id = any (p_clinic_ids)
           and (v_sale_origin is null or v_sale_origin = 'plan')
      ),
      plano_parte as (
        select pl.negotiation_id,
               sum(it.unit_price_cents::numeric * it.quantity) as total,
               coalesce(sum(it.unit_price_cents::numeric * it.quantity)
                          filter (where pr.specialty = any (v_specialties)), 0) as parte
          from plano pl
          join public.plan_negotiation_items ni on ni.negotiation_id = pl.negotiation_id and ni.included
          join public.treatment_plan_option_items it on it.id = ni.item_id
          left join public.procedures pr on pr.id = it.procedure_id
         where v_esp
         group by pl.negotiation_id
      ),
      direta as (
        select ds.id, ds.clinic_id, ds.created_by as user_id, ds.closed_at as at, ds.final_cents::numeric as cents
          from public.direct_sales ds
         where ds.closed_at >= v_from and ds.closed_at < v_to
           and ds.status <> 'cancelada' and not ds.cancelled and ds.cancelled_at is null
           and ds.clinic_id = any (p_clinic_ids)
           and (v_sale_origin is null or v_sale_origin = 'direct')
      ),
      direta_parte as (
        select d.id,
               sum(di.final_cents::numeric) as total,
               coalesce(sum(di.final_cents::numeric) filter (where pr.specialty = any (v_specialties)), 0) as parte
          from direta d
          join public.direct_sale_items di on di.sale_id = d.id
          left join public.procedures pr on pr.id = di.procedure_id
         where v_esp
         group by d.id
      ),
      s as (
        select pl.clinic_id, pl.user_id, pl.at,
               case when not v_esp then pl.cents
                    when coalesce(pp.total, 0) = 0 then 0
                    else pl.cents * pp.parte / pp.total end as cents,
               (not v_esp or coalesce(pp.parte, 0) > 0) as conta
          from plano pl
          left join plano_parte pp on pp.negotiation_id = pl.negotiation_id
        union all
        select d.clinic_id, d.user_id, d.at,
               case when not v_esp then d.cents
                    when coalesce(dp.total, 0) = 0 then 0
                    else d.cents * dp.parte / dp.total end,
               (not v_esp or coalesce(dp.parte, 0) > 0)
          from direta d
          left join direta_parte dp on dp.id = d.id
      )
      select s.clinic_id, s.user_id, (s.at at time zone v_tz)::date,
             case when p_indicator = 'sales_count' then count(*)::numeric else round(sum(s.cents)) end,
             case when p_indicator = 'sales_ticket' then count(*)::numeric else null::numeric end
        from s
       where s.conta
       group by 1, 2, 3;

  elsif p_indicator = 'conversion_rate' then
    -- A mesma conta do painel do Comercial: das negociações ABERTAS no
    -- período, quantas % foram aceitas. Versão substituída não conta.
    return query
      select pn.clinic_id, pn.consultant_id, (pn.created_at at time zone v_tz)::date,
             100 * (count(*) filter (where pn.status = 'aceita'))::numeric,
             count(*)::numeric
        from public.plan_negotiations pn
       where pn.created_at >= v_from and pn.created_at < v_to
         and pn.clinic_id = any (p_clinic_ids)
         and pn.status <> 'substituida'
       group by 1, 2, 3;

  elsif p_indicator = 'revenue_received' then
    -- Recebimentos válidos (sem estorno). N5: só coletiva.
    return query
      select r.clinic_id, null::uuid, r.received_at, sum(r.amount_cents)::numeric, null::numeric
        from public.payment_receipts r
       where r.received_at between p_from and p_to
         and not r.reversed and r.reversal_of is null
         and r.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'revenue_billed' then
    -- A própria DRE (competência): receita bruta − deduções. N3: por período.
    return query
      select c.id, null::uuid, p_to,
             coalesce((select sum(d.amount_cents) from public._dre_lines_raw(c.id, p_from, p_to) d
                        where d.block in ('receita_bruta', 'deducoes')), 0)::numeric,
             null::numeric
        from unnest(p_clinic_ids) as c (id);

  elsif p_indicator = 'overdue_recovery' then
    -- Recebido DEPOIS do vencimento, em parcela que ficou vencida.
    return query
      select r.clinic_id, null::uuid, r.received_at, sum(r.amount_cents)::numeric, null::numeric
        from public.payment_receipts r
        join public.payment_installments i on i.id = r.installment_id
       where r.received_at between p_from and p_to
         and not r.reversed and r.reversal_of is null
         and i.was_overdue
         and r.received_at > coalesce(i.expected_settlement_date, i.due_date)
         and r.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator in ('overdue_rate', 'overdue_value') then
    -- FOTOGRAFIA: a mesma conta da tela do Financeiro (a porta da 1b).
    return query
      select c.id, null::uuid, v_today,
             case when p_indicator = 'overdue_rate' then 100 * o.overdue_cents::numeric
                  else o.overdue_cents::numeric end,
             case when p_indicator = 'overdue_rate' then o.open_cents::numeric else null::numeric end
        from unnest(p_clinic_ids) as c (id)
        cross join lateral public._clinic_overdue_rate_raw(c.id) o;

  elsif p_indicator in ('appointments_created', 'returns_scheduled') then
    if p_indicator = 'returns_scheduled' and cardinality(v_types) = 0 then
      v_types := array['return_visit', 'reevaluation'];
    end if;
    return query
      select a.clinic_id, a.created_by, (a.created_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.appointments a
       where a.created_at >= v_from and a.created_at < v_to
         and a.clinic_id = any (p_clinic_ids)
         and a.status::text <> 'cancelled'
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator in ('appointments_done', 'evaluations_done') then
    if p_indicator = 'evaluations_done' then
      v_types := array['evaluation'];
    end if;
    return query
      select a.clinic_id, a.provider_user_id, (coalesce(a.done_at, a.ends_at) at time zone v_tz)::date,
             count(*)::numeric, null::numeric
        from public.appointments a
       where coalesce(a.done_at, a.ends_at) >= v_from and coalesce(a.done_at, a.ends_at) < v_to
         and a.clinic_id = any (p_clinic_ids)
         and (a.attendance::text = 'done' or a.status::text = 'completed')
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator in ('attendance_rate', 'no_show_rate') then
    return query
      with b as (
        select a.clinic_id, a.created_by as user_id, (a.starts_at at time zone v_tz)::date as d,
               (a.checked_in_at is not null
                or a.attendance::text in ('done', 'gave_up', 'in_service')
                or a.status::text = 'completed') as came,
               a.status::text = 'no_show' as missed
          from public.appointments a
         where a.starts_at >= v_from and a.starts_at < v_to and a.starts_at < now()
           and a.clinic_id = any (p_clinic_ids)
           and a.status::text <> 'cancelled'
           and (cardinality(v_types) = 0 or a.type::text = any (v_types))
      )
      select b.clinic_id, b.user_id, b.d,
             100 * (count(*) filter (where b.came = (p_indicator = 'attendance_rate')))::numeric,
             count(*)::numeric
        from b
       where b.came or b.missed
       group by 1, 2, 3;

  elsif p_indicator = 'check_ins' then
    return query
      select a.clinic_id, a.checked_in_by, (a.checked_in_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.appointments a
       where a.checked_in_at >= v_from and a.checked_in_at < v_to
         and a.clinic_id = any (p_clinic_ids)
         and (cardinality(v_types) = 0 or a.type::text = any (v_types))
       group by 1, 2, 3;

  elsif p_indicator = 'procedures_done' then
    return query
      select ts.clinic_id, coalesce(ts.executed_by, ts.planner_provider_id),
             (ts.done_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.treatment_sessions ts
        left join public.procedures p on p.id = ts.procedure_id
       where ts.status = 'done'
         and ts.done_at >= v_from and ts.done_at < v_to
         and ts.clinic_id = any (p_clinic_ids)
         and (cardinality(v_specialties) = 0 or p.specialty = any (v_specialties))
       group by 1, 2, 3;

  elsif p_indicator = 'provider_production' then
    -- O repasse congelado de cada sessão concluída (o mesmo do Repasse).
    return query
      select pp.clinic_id, pp.provider_id, pp.accrual_date, sum(pp.amount_cents)::numeric, null::numeric
        from public.provider_payouts pp
        left join public.procedures p on p.id = pp.procedure_id
       where pp.accrual_date between p_from and p_to
         and pp.clinic_id = any (p_clinic_ids)
         and (cardinality(v_specialties) = 0 or p.specialty = any (v_specialties))
       group by 1, 2, 3;

  elsif p_indicator = 'plan_options_approved' then
    -- Opção aprovada pelo Coordenador; o número é do Planner que montou o plano.
    return query
      select tp.clinic_id, tp.created_by, (o.reviewed_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.treatment_plan_options o
        join public.treatment_plans tp on tp.id = o.plan_id
       where o.review_status::text = 'approved'
         and o.reviewed_at >= v_from and o.reviewed_at < v_to
         and tp.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator in ('new_clients', 'new_clients_evaluated') then
    return query
      select coalesce(c.origin_clinic_id, c.clinic_id), c.created_by, (c.created_at at time zone v_tz)::date,
             count(*)::numeric, null::numeric
        from public.clients c
       where c.created_at >= v_from and c.created_at < v_to
         and coalesce(c.origin_clinic_id, c.clinic_id) = any (p_clinic_ids)
         and (cardinality(v_origins) = 0 or coalesce(c.origin_program, 'unidade') = any (v_origins))
         and (p_indicator = 'new_clients'
              or exists (select 1 from public.appointments a
                          where a.client_id = c.id and a.type::text = 'evaluation'
                            and (a.attendance::text = 'done' or a.status::text = 'completed')))
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_adhesions' then
    return query
      select m.clinic_id, m.sold_by, (m.activated_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.ppr_memberships m
       where m.activated_at >= v_from and m.activated_at < v_to
         and m.transferred_from_id is null
         and m.clinic_id = any (p_clinic_ids)
         and (cardinality(v_plans) = 0 or m.plan_id::text = any (v_plans))
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_cancellations' then
    -- Cancelamento de verdade: a adesão que virou outra (transferência) não conta.
    return query
      select m.clinic_id, null::uuid, (m.cancelled_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.ppr_memberships m
       where m.cancelled_at >= v_from and m.cancelled_at < v_to
         and m.clinic_id = any (p_clinic_ids)
         and not exists (select 1 from public.ppr_memberships n where n.transferred_from_id = m.id)
         and (cardinality(v_plans) = 0 or m.plan_id::text = any (v_plans))
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_lives' then
    -- FOTOGRAFIA: beneficiários (titulares + dependentes) de adesões ativas hoje.
    return query
      select m.clinic_id, null::uuid, v_today, count(*)::numeric, null::numeric
        from public.ppr_beneficiaries b
        join public.ppr_memberships m on m.id = b.membership_id
       where m.status = 'ativo' and b.left_at is null
         and m.clinic_id = any (p_clinic_ids)
         and (cardinality(v_plans) = 0 or m.plan_id::text = any (v_plans))
       group by 1, 2, 3;

  elsif p_indicator = 'indica_referrals' then
    return query
      select i.unidade_id, i.risartano_origem_id, (i.registrada_em at time zone v_tz)::date, count(*)::numeric, null::numeric
        from indica.indicacoes i
       where i.registrada_em >= v_from and i.registrada_em < v_to
         and i.unidade_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'indica_conversions' then
    -- A mesma régua da apuração do Indica: convertida, pela data do fechamento.
    return query
      select i.unidade_id, i.risartano_conversao_id, (i.fechou_em at time zone v_tz)::date, count(*)::numeric, null::numeric
        from indica.indicacoes i
       where i.status::text = 'convertida'
         and i.fechou_em >= v_from and i.fechou_em < v_to
         and i.unidade_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'indica_ambassadors' then
    return query
      select e.unidade_cadastro_id, e.criado_por, (e.criado_em at time zone v_tz)::date, count(*)::numeric, null::numeric
        from indica.embaixadores e
       where e.criado_em >= v_from and e.criado_em < v_to
         and e.unidade_cadastro_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'empresarial_companies' then
    -- N6: adesão = a PRIMEIRA entrada do lead em "Fechado (ganho)" no funil
    -- (a linha semeada pela migração, `is_initial`, não conta). Unidade = a
    -- principal da empresa. Número do consultor RisLife do lead.
    return query
      with ganho as (
        select h.lead_id, min(h.entered_at) as at
          from empresarial.commercial_lead_stage_history h
         where h.stage::text = 'CLOSED_WON' and not coalesce(h.is_initial, false)
         group by h.lead_id
      )
      select co.main_clinic_id, l.consultant_id, (g.at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from ganho g
        join empresarial.commercial_leads l on l.id = g.lead_id
        join empresarial.companies co on co.id = l.company_id
       where g.at >= v_from and g.at < v_to
         and co.main_clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'empresarial_lives' then
    return query
      select mh.clinic_id, null::uuid, (mh.started_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from empresarial.membership_history mh
       where mh.started_at >= v_from and mh.started_at < v_to
         and mh.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  -- ======================================================================
  -- ETAPA M3 (0320)
  -- ======================================================================
  elsif p_indicator = 'discount_avg' then
    -- O5: desconto ÷ valor de tabela das vendas de plano FECHADAS no período
    -- (a mesma conta da autorização de desconto: −ajuste ÷ subtotal).
    return query
      select cs.clinic_id, pn.consultant_id, (cs.closed_at at time zone v_tz)::date,
             100 * sum(greatest(-pn.adjustment_cents, 0))::numeric,
             sum(pn.final_cents - pn.adjustment_cents)::numeric
        from public.commercial_sales cs
        join public.plan_negotiations pn on pn.id = cs.negotiation_id
       where cs.closed_at >= v_from and cs.closed_at < v_to
         and cs.cancelled_at is null
         and cs.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'sales_cancelled' then
    -- LIMITE: vendas de plano e diretas canceladas no período.
    return query
      with c as (
        select cs.clinic_id, cs.cancelled_at as at
          from public.commercial_sales cs
         where cs.cancelled_at >= v_from and cs.cancelled_at < v_to
           and cs.clinic_id = any (p_clinic_ids)
        union all
        select ds.clinic_id, ds.cancelled_at
          from public.direct_sales ds
         where ds.cancelled_at >= v_from and ds.cancelled_at < v_to
           and ds.clinic_id = any (p_clinic_ids)
      )
      select c.clinic_id, null::uuid, (c.at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from c
       group by 1, 2, 3;

  elsif p_indicator = 'net_margin' then
    -- A mesma conta da tela DRE (`buildDre`/`netMarginPercent`): lucro líquido
    -- (todos os blocos menos "fora") ÷ receita líquida. O4: ponderado.
    return query
      select c.id, null::uuid, p_to,
             100 * coalesce(sum(d.amount_cents) filter (where d.block <> 'fora'), 0)::numeric,
             coalesce(sum(d.amount_cents) filter (where d.block in ('receita_bruta', 'deducoes')), 0)::numeric
        from unnest(p_clinic_ids) as c (id)
        left join lateral public._dre_lines_raw(c.id, p_from, p_to) d on true
       group by 1, 2, 3
      having coalesce(sum(d.amount_cents) filter (where d.block in ('receita_bruta', 'deducoes')), 0) <> 0;

  elsif p_indicator in ('contribution_margin', 'breakeven_reached') then
    -- A mesma conta da tela Ponto de equilíbrio (`buildBreakeven`):
    --   receita líquida = receita + deduções; margem = líquida + variáveis;
    --   custo fixo = −(fixos + depreciação + receita financeira) [caixa: sem
    --   depreciação]; ponto = custo fixo ÷ (margem ÷ líquida).
    -- O1: "% do ponto atingido" = receita líquida ÷ ponto.
    return query
      with p as (
        select c.id as clinic_id,
               coalesce(sum(b.amount_cents) filter (where b.role in ('receita', 'deducao')), 0)::numeric as rl,
               coalesce(sum(b.amount_cents) filter (where b.role in ('receita', 'deducao', 'variavel')), 0)::numeric as mc,
               (-coalesce(sum(b.amount_cents) filter (where b.role in ('fixo', 'receita_financeira')), 0)
                - case when coalesce(v_f ->> 'breakeven_view', '') = 'cash' then 0
                       else coalesce(sum(b.amount_cents) filter (where b.role = 'depreciacao'), 0) end)::numeric as cf
          from unnest(p_clinic_ids) as c (id)
          left join lateral public.breakeven_lines_raw(c.id, p_from, p_to, null) b on true
         group by c.id
      )
      select p.clinic_id, null::uuid, p_to,
             case when p_indicator = 'contribution_margin' then 100 * p.mc else 100 * p.rl end,
             case when p_indicator = 'contribution_margin' then p.rl
                  else round(p.cf / (p.mc / p.rl)) end
        from p
       where p.rl > 0
         and (p_indicator = 'contribution_margin' or (p.mc > 0 and p.cf > 0));

  elsif p_indicator = 'on_time_payment' then
    -- Das parcelas que VENCERAM no período (data efetiva, com o prazo da
    -- adquirente) e até ontem: quantas % foram pagas até o vencimento.
    return query
      select i.clinic_id, null::uuid, coalesce(i.expected_settlement_date, i.due_date),
             100 * (count(*) filter (where i.status = 'paga' and i.paid_at is not null
                                       and (i.paid_at at time zone v_tz)::date
                                           <= coalesce(i.expected_settlement_date, i.due_date)))::numeric,
             count(*)::numeric
        from public.payment_installments i
       where coalesce(i.expected_settlement_date, i.due_date) between p_from and least(p_to, v_today - 1)
         and i.status not in ('cancelada', 'renegociada')
         and i.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'treatments_completed' then
    -- Clientes que entraram na Fase 6 (reavaliação) no período.
    return query
      select h.clinic_id, null::uuid, (h.entered_at at time zone v_tz)::date,
             count(distinct h.client_id)::numeric, null::numeric
        from public.journey_phase_history h
       where h.phase::text = 'reevaluation'
         and h.entered_at >= v_from and h.entered_at < v_to
         and h.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'journey_conversion' then
    -- Dos clientes AVALIADOS no período (avaliação concluída), quantos % já
    -- fecharam venda de plano (em qualquer data, sem cancelamento).
    return query
      with av as (
        select a.client_id, a.clinic_id,
               min((coalesce(a.done_at, a.ends_at) at time zone v_tz)::date) as d
          from public.appointments a
         where a.type::text = 'evaluation'
           and (a.attendance::text = 'done' or a.status::text = 'completed')
           and coalesce(a.done_at, a.ends_at) >= v_from and coalesce(a.done_at, a.ends_at) < v_to
           and a.clinic_id = any (p_clinic_ids)
         group by a.client_id, a.clinic_id
      )
      select av.clinic_id, null::uuid, av.d,
             100 * (count(*) filter (where exists (
               select 1 from public.commercial_sales cs
                where cs.client_id = av.client_id and cs.closed_at is not null and cs.cancelled_at is null)))::numeric,
             count(*)::numeric
        from av
       group by 1, 2, 3;

  elsif p_indicator = 'reactivated_clients' then
    -- O3: atendido no período cujo atendimento concluído ANTERIOR foi há mais
    -- de N dias — N = "dias sem atendimento" (inactivity_settings, cascata).
    return query
      with feitos as (
        select a.client_id, a.clinic_id, coalesce(a.done_at, a.ends_at) as at
          from public.appointments a
         where (a.attendance::text = 'done' or a.status::text = 'completed')
      ),
      no_periodo as (
        select f.client_id, f.clinic_id, min(f.at) as at
          from feitos f
         where f.at >= v_from and f.at < v_to and f.clinic_id = any (p_clinic_ids)
         group by f.client_id, f.clinic_id
      )
      select np.clinic_id, null::uuid, (np.at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from no_periodo np
        cross join lateral (
          select max(f.at) as anterior from feitos f where f.client_id = np.client_id and f.at < np.at
        ) ant
        cross join lateral (
          select coalesce(
                   (select s.value_days from public.inactivity_settings s
                     where s.setting_key = 'no_attendance_days' and s.clinic_id = np.clinic_id),
                   (select s.value_days from public.inactivity_settings s
                     where s.setting_key = 'no_attendance_days' and s.clinic_id is null),
                   365) as dias
        ) n
       where ant.anterior is not null
         and ant.anterior < np.at - make_interval(days => n.dias)
       group by 1, 2, 3;

  elsif p_indicator = 'certifications' then
    -- O7: certificados emitidos no período (portão de certificação).
    return query
      select tc.clinic_id, tc.user_id, (tc.certified_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.training_certifications tc
       where tc.certified_at >= v_from and tc.certified_at < v_to
         and tc.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'reports_sent' then
    -- O7: relatos de problema e sugestões registrados.
    return query
      select r.clinic_id, r.reporter_id, (r.created_at at time zone v_tz)::date, count(*)::numeric, null::numeric
        from public.system_reports r
       where r.created_at >= v_from and r.created_at < v_to
         and r.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator in ('chair_occupancy', 'chair_idle_hours') then
    -- O2: MEDIDOS NO CÓDIGO, pela mesma conta do Planejamento Anual
    -- (`src/lib/horas-da-agenda.ts` — 7 fontes e a conta de intervalos).
    -- O banco não tem essa conta; o servidor mede e grava o resultado final
    -- por `goal_record_app_final`. Aqui não sai linha nenhuma, de propósito.
    return;

  -- ===========================================================================
  -- 0365 — ORTODONTIA E PPR+ (ORTO3) e a RECEITA BRUTA em quatro linhas
  -- ===========================================================================
  elsif p_indicator = 'ortho_new_cases' then
    -- N1: o caso conta para o Coordenador que fez a ÚLTIMA indicação de
    -- ortodontia do cliente antes de o caso começar. A data é a régua do Painel
    -- da Ortodontia: o início; sem início, a abertura.
    return query
      select c.clinic_id,
             (select ce.ortho_indicated_by
                from public.clinical_evaluations ce
               where ce.client_id = c.client_id and ce.ortho_indicated
                 and ce.ortho_indicated_by is not null
                 and ce.ortho_indicated_at < coalesce((c.start_date + 1)::timestamp at time zone v_tz, c.created_at)
               order by ce.ortho_indicated_at desc limit 1),
             coalesce(c.start_date, (c.created_at at time zone v_tz)::date),
             count(*)::numeric, null::numeric
        from public.ortho_cases c
       where coalesce(c.start_date, (c.created_at at time zone v_tz)::date) between p_from and p_to
         and c.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'ortho_active_patients' then
    -- FOTOGRAFIA: casos em tratamento hoje (o "Em tratamento" do Painel).
    return query
      select c.clinic_id, null::uuid, v_today, count(*)::numeric, null::numeric
        from public.ortho_cases c
       where c.status = 'em_tratamento' and c.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'ortho_finished_on_time' then
    -- Finalizado = contenções entregues ou alta (O1), no período; no prazo =
    -- até a previsão (que já carrega as faltas) + a tolerância da unidade —
    -- a mesma régua de `caseTimeliness` no Painel.
    return query
      select c.clinic_id, null::uuid, c.finished_at::date, count(*)::numeric, null::numeric
        from public.ortho_cases c
       where c.status in ('finalizado', 'contencao') and c.finished_at is not null
         and c.finished_at::date between p_from and p_to
         and c.planned_end_date is not null
         and c.finished_at::date <= c.planned_end_date + public._goal_ortho_tolerance(c.clinic_id)
         and c.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'ortho_revenue' then
    -- P2: a parte de Ortodontia dos recebimentos de procedimentos + as
    -- mensalidades e contenções de ortodontia pagas.
    return query
      select x.clinic_id, null::uuid, x.day, round(sum(x.cents)), null::numeric
        from (
          select r.clinic_id, r.day, r.ortho_cents as cents
            from public._goal_receipts_split(p_clinic_ids, p_from, p_to) r
          union all
          select o.clinic_id, o.day, o.cents from public._goal_ortho_paid(p_clinic_ids, p_from, p_to) o
        ) x
       group by 1, 2, 3;

  elsif p_indicator in ('ortho_revenue_share', 'ppr_revenue_share') then
    -- P3: a parte ÷ a receita bruta (as quatro linhas). Taxa do período.
    return query
      select x.clinic_id, null::uuid, x.day,
             100 * sum(x.parte), sum(x.bruta)
        from (
          select r.clinic_id, r.day,
                 case when p_indicator = 'ortho_revenue_share' then r.ortho_cents else 0 end as parte,
                 r.total_cents as bruta
            from public._goal_receipts_split(p_clinic_ids, p_from, p_to) r
          union all
          select o.clinic_id, o.day,
                 case when p_indicator = 'ortho_revenue_share' then o.cents else 0 end, o.cents
            from public._goal_ortho_paid(p_clinic_ids, p_from, p_to) o
          union all
          select q.clinic_id, q.day,
                 case when p_indicator = 'ppr_revenue_share' then q.cents else 0 end, q.cents
            from public._goal_ppr_paid(p_clinic_ids, p_from, p_to) q
        ) x
       group by 1, 2, 3
      having sum(x.bruta) > 0;

  elsif p_indicator = 'ortho_overdue' then
    -- P4: das cobranças de ortodontia que VENCERAM no período (até ontem), o
    -- % do valor que não foi pago — mensalidades/contenções + a parte de
    -- Ortodontia das parcelas de procedimentos (proporcional, P2).
    return query
      select x.clinic_id, null::uuid, x.day, 100 * sum(x.falta), sum(x.devido)
        from (
          select oc.clinic_id, oc.due_date as day,
                 (oc.amount_cents - coalesce(oc.discount_cents, 0))::numeric as devido,
                 case when oc.status = 'paga' then 0
                      else (oc.amount_cents - coalesce(oc.discount_cents, 0))::numeric end as falta
            from public.ortho_charges oc
           where oc.status <> 'cancelada'
             and oc.due_date between p_from and least(p_to, v_today - 1)
             and oc.clinic_id = any (p_clinic_ids)
          union all
          select i.clinic_id, coalesce(i.expected_settlement_date, i.due_date),
                 i.amount_cents * s.share,
                 greatest(i.amount_cents - coalesce(i.paid_amount_cents, 0), 0) * s.share
            from public.payment_installments i
            cross join lateral (select public._goal_ortho_share(i.negotiation_id, i.direct_sale_id) as share) s
           where i.status in ('em_aberto', 'parcial', 'paga')
             and coalesce(i.expected_settlement_date, i.due_date) between p_from and least(p_to, v_today - 1)
             and i.clinic_id = any (p_clinic_ids)
             and s.share > 0
        ) x
       group by 1, 2, 3
      having sum(x.devido) > 0;

  elsif p_indicator = 'ppr_revenue' then
    return query
      select q.clinic_id, null::uuid, q.day, sum(q.cents), null::numeric
        from public._goal_ppr_paid(p_clinic_ids, p_from, p_to) q
       group by 1, 2, 3;

  elsif p_indicator = 'ppr_overdue' then
    -- P4: das mensalidades do PPR+ que venceram no período (até ontem), o %
    -- do valor que não foi pago.
    return query
      select pc.clinic_id, null::uuid, pc.due_date,
             100 * sum(case when pc.status = 'paga' then 0 else pc.amount_cents end)::numeric,
             sum(pc.amount_cents)::numeric
        from public.ppr_charges pc
       where pc.status <> 'cancelada' and pc.amount_cents > 0
         and pc.due_date between p_from and least(p_to, v_today - 1)
         and pc.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator in ('gross_revenue', 'revenue_private', 'revenue_empresarial', 'revenue_empresarial_all') then
    -- P3: a RECEITA BRUTA = procedimentos (particular) + procedimentos
    -- (Empresarial) + Ortodontia (procedimentos + mensalidades) + PPR+
    -- (mensalidades). As linhas não se repetem. N2: "Empresarial" é o vínculo
    -- NA DATA do recebimento (empresarial.membership_history), nunca o de hoje.
    -- `revenue_empresarial_all` é a linha à parte: tudo o que os clientes do
    -- Empresarial pagaram (procedimentos, ortodontia e PPR+).
    return query
      select x.clinic_id, null::uuid, x.day, round(sum(x.cents)), null::numeric
        from (
          select r.clinic_id, r.day,
                 case p_indicator
                   when 'gross_revenue' then r.total_cents
                   when 'revenue_private' then case when r.empresarial then 0 else r.total_cents - r.ortho_cents end
                   when 'revenue_empresarial' then case when r.empresarial then r.total_cents - r.ortho_cents else 0 end
                   else case when r.empresarial then r.total_cents else 0 end
                 end as cents
            from public._goal_receipts_split(p_clinic_ids, p_from, p_to) r
          union all
          select o.clinic_id, o.day,
                 case when p_indicator = 'gross_revenue'
                        or (p_indicator = 'revenue_empresarial_all' and public._goal_empresarial_on(o.client_id, o.day))
                      then o.cents else 0 end
            from public._goal_ortho_paid(p_clinic_ids, p_from, p_to) o
           where p_indicator in ('gross_revenue', 'revenue_empresarial_all')
          union all
          select q.clinic_id, q.day,
                 case when p_indicator = 'gross_revenue'
                        or (p_indicator = 'revenue_empresarial_all' and public._goal_empresarial_on(q.client_id, q.day))
                      then q.cents else 0 end
            from public._goal_ppr_paid(p_clinic_ids, p_from, p_to) q
           where p_indicator in ('gross_revenue', 'revenue_empresarial_all')
        ) x
       group by 1, 2, 3;

  -- 0427 (fim do tratamento, Etapa 6: os indicadores) ---------------------
  elsif p_indicator = 'redo_rate' then
    -- Dos procedimentos avaliados pelo Coordenador no período, quantos % ficaram
    -- em Revisar ou Refazer. Conta para quem executou.
    return query
      select r.clinic_id, r.executor_dentist_id, (r.reviewed_at at time zone v_tz)::date,
             100 * (count(*) filter (where r.level in ('revisar', 'refazer')))::numeric, count(*)::numeric
        from public.plan_quality_reviews r
       where r.level is not null
         and r.reviewed_at >= v_from and r.reviewed_at < v_to
         and r.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'client_satisfaction' then
    -- Dos clientes que deram nota no contato do fim do tratamento, quantos %
    -- deram 9 ou 10. Conta para quem executou (quem foi perguntado).
    return query
      select k.clinic_id, f.asked_user_id, (k.contacted_at at time zone v_tz)::date,
             100 * (count(*) filter (where k.satisfaction >= 9))::numeric, count(*)::numeric
        from public.treatment_closure_contacts k
        join public.treatment_closures f on f.id = k.closure_id
       where k.satisfaction is not null
         and k.contacted_at >= v_from and k.contacted_at < v_to
         and k.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'closure_decided_on_time' then
    -- Das decisões do fim respondidas no período, quantos % em até 3 dias
    -- úteis da unidade. O "Sim" automático do catálogo não conta.
    return query
      select f.clinic_id, f.answered_by, (f.answered_at at time zone v_tz)::date,
             100 * (count(*) filter (where public.clinic_business_days_between(
                f.clinic_id, (f.created_at at time zone v_tz)::date, (f.answered_at at time zone v_tz)::date) <= 3))::numeric,
             count(*)::numeric
        from public.treatment_closures f
       where f.answered_at is not null and not f.auto_yes
         and f.grouped_into is null and f.scope <> 'cancelamento'
         and f.answered_at >= v_from and f.answered_at < v_to
         and f.clinic_id = any (p_clinic_ids)
       group by 1, 2, 3;

  elsif p_indicator = 'clients_without_next_step' then
    -- FOTOGRAFIA: clientes sem próximo passo hoje (a lista da Jornada, 7.4).
    return query
      select x.clinic_id, null::uuid, v_today, count(*)::numeric, null::numeric
        from unnest(p_clinic_ids) as u (cid)
        cross join lateral public._sem_proximo_passo(u.cid) x
       group by 1, 2, 3;

  else
    raise exception 'GOAL_UNKNOWN_INDICATOR';
  end if;
end;
$$;

revoke execute on function public._goal_indicator_meta(text) from public, anon, authenticated;
revoke execute on function public._goal_measure_raw(text, jsonb, uuid[], date, date) from public, anon, authenticated;
