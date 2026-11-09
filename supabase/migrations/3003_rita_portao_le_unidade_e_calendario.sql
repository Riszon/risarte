-- =============================================================================
-- 3003 — Rita, Fase 0A.4 (parte rita): o portão lê o mapa e o horário por dia;
--        o calendário da unidade para a Rita
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.4 (decisão 9).
-- Depende da 0368 (core): `clinic_public_info`, `clinic_weekday_hours`,
-- `holidays`.
--
-- O QUE MUDA
--   * `rita._pending_items` perde `maps` e `horario_por_dia`, e `rita._gaps`
--     passa a conferir os dois de verdade: o link do mapa preenchido e ao
--     menos um dia aberto no horário por dia (da unidade ou herdado da rede).
--   * `rita.weekday_hours(unidade)`: os 7 dias que valem para a unidade
--     (a linha dela, senão a da rede), dizendo de onde veio.
--   * `rita.unit_day(unidade, data)`: a unidade abre naquele dia? Horário e
--     almoço, ou o motivo de estar fechada. **Feriado sem decisão do Gerente
--     = FECHADO para a Rita** (decisão 9). A agenda da equipe continua como
--     sempre ("sem decisão = aberto"); o fechamento por período do
--     Planejamento anual e os dias avulsos entram na Fase 1, com os horários
--     livres.
--   * A pausa automática passa a vigiar `clinic_public_info` e
--     `clinic_weekday_hours`. Mudar o horário da REDE confere todas as
--     unidades ligadas.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os 7 dias que valem para a unidade
-- -----------------------------------------------------------------------------
create or replace function rita.weekday_hours(p_clinic uuid)
returns table (
  weekday smallint, closed boolean, open_time time, close_time time,
  lunch_start time, lunch_end time, origem text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d::smallint,
         coalesce(u.closed, r.closed, true),
         case when u.id is not null then u.open_time else r.open_time end,
         case when u.id is not null then u.close_time else r.close_time end,
         case when u.id is not null then u.lunch_start else r.lunch_start end,
         case when u.id is not null then u.lunch_end else r.lunch_end end,
         case when u.id is not null then 'unidade'
              when r.id is not null then 'rede'
              else 'nenhum' end
  from generate_series(0, 6) as d
  left join public.clinic_weekday_hours u on u.clinic_id = p_clinic and u.weekday = d
  left join public.clinic_weekday_hours r on r.clinic_id is null and r.weekday = d
  order by d;
$$;

revoke execute on function rita.weekday_hours(uuid) from public, anon, authenticated;
grant execute on function rita.weekday_hours(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2) A unidade abre neste dia? (o calendário da Rita)
-- -----------------------------------------------------------------------------
create or replace function rita.unit_day(p_clinic uuid, p_date date)
returns table (
  is_open boolean, open_time time, close_time time,
  lunch_start time, lunch_end time, holiday_name text, reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  h record;
  w record;
  v_decisao boolean;
begin
  select cl.id, upper(btrim(coalesce(cl.state, ''))) as uf,
         lower(btrim(coalesce(cl.city, ''))) as cidade
    into c
  from public.clinics cl where cl.id = p_clinic;
  if c.id is null then
    is_open := false; reason := 'unidade_nao_encontrada'; return next; return;
  end if;

  select * into w from rita.weekday_hours(p_clinic) x
  where x.weekday = extract(dow from p_date)::smallint;

  -- Feriado que vale para a unidade (nacional, do estado ou da cidade dela).
  select hd.name into h
  from public.holidays hd
  where hd.holiday_date = p_date
    and (hd.scope = 'national'
         or (hd.scope = 'state' and hd.state = c.uf)
         or (hd.scope = 'city' and hd.state = c.uf and lower(btrim(hd.city)) = c.cidade))
  order by case hd.scope when 'city' then 1 when 'state' then 2 else 3 end
  limit 1;

  holiday_name := h.name;

  if h.name is not null then
    select d.will_attend into v_decisao
    from public.clinic_holiday_decisions d
    where d.clinic_id = p_clinic and d.holiday_date = p_date;
    if v_decisao is null then
      -- Decisão 9: sem decisão do Gerente, a Rita trata como fechado.
      is_open := false; reason := 'feriado_sem_decisao'; return next; return;
    elsif not v_decisao then
      is_open := false; reason := 'feriado_fechado'; return next; return;
    end if;
  end if;

  if w.weekday is null or w.closed or w.open_time is null or w.close_time is null then
    is_open := false; reason := 'dia_fechado'; return next; return;
  end if;

  is_open := true;
  open_time := w.open_time;
  close_time := w.close_time;
  lunch_start := w.lunch_start;
  lunch_end := w.lunch_end;
  reason := case when h.name is not null then 'feriado_com_atendimento' else 'aberto' end;
  return next;
end;
$$;

revoke execute on function rita.unit_day(uuid, date) from public, anon, authenticated;
grant execute on function rita.unit_day(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- 3) O portão: maps e horário por dia saem dos pendentes
-- -----------------------------------------------------------------------------
create or replace function rita._pending_items()
returns table (ordem integer, item text, rotulo text, detalhe text)
language sql
immutable
security definer
set search_path = ''
as $$
  values
    (80, 'avaliacao', 'Duração e valor (ou gratuidade) da avaliação', 'Cadastro chega na entrega 0A.5'),
    (90, 'avaliacao_inclui', 'O que a avaliação inclui', 'Cadastro chega na entrega 0A.5'),
    (100, 'transferencias', 'Quem recebe as transferências em horário comercial', 'Cadastro chega na entrega 0A.6');
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
  v_coord integer;
  v_maps text;
  v_dias_abertos integer;
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

  for ordem, item, rotulo, detalhe in select * from rita._pending_items() loop
    ok := false;
    return next;
  end loop;
end;
$$;

revoke execute on function rita._gaps(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) Pausa automática: as tabelas novas
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

    -- 0368: o horário por dia da REDE vale para toda unidade sem horário
    -- próprio — confere todas as que estão ligadas.
    if tg_table_name = 'clinic_weekday_hours' and v_old is null and v_new is null then
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

drop trigger if exists rita_recheck on public.clinic_public_info;
create trigger rita_recheck
  after update or delete on public.clinic_public_info
  for each row execute function rita._recheck_trg();

drop trigger if exists rita_recheck on public.clinic_weekday_hours;
create trigger rita_recheck
  after update or delete on public.clinic_weekday_hours
  for each row execute function rita._recheck_trg();

notify pgrst, 'reload schema';
