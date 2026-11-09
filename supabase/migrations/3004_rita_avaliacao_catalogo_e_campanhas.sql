-- =============================================================================
-- 3004 — Rita, Fase 0A.5 (parte rita): o catálogo da Rita, o valor da
--        avaliação e as campanhas de isenção
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.5 (decisões 5, 7, 38–40).
-- Depende da 0369 (core).
--
-- O QUE CRIA
--   * `rita.evaluation_fee_campaigns` — campanhas de isenção da avaliação, da
--     rede (`clinic_ids` nulo) ou de unidades, com validade e o texto que a
--     Rita pode dizer. O Gerente PROPÕE para a unidade dele; só o Admin Master
--     APROVA (decisão 5: a Rita nunca isenta por conta própria; ela só oferece
--     a campanha ativa).
--   * `rita.catalog(unidade)` — o rol da Rita naquela unidade: o que está no
--     rol (`rita_can_offer`), ativo e oferecido pela unidade, com o nome para
--     o paciente e o preço que vale ali. A Rita nunca informa preço de
--     tratamento: só o da avaliação/consulta (decisão 39).
--   * `rita.evaluation_fee(unidade)` — o valor e a duração da avaliação de
--     quem é novo, a campanha ativa (se houver) e de onde pode vir gratuidade:
--     indicado do Indica +Risos (sempre), empresas e planos PPR+ que dão o
--     benefício. SABER SE A PESSOA TEM DIREITO é da Fase 1.
--   * O portão confere a avaliação de verdade (no rol, oferecida na unidade,
--     com duração e com valor — ou campanha ativa) e "o que a avaliação inclui"
--     (texto aprovado); sobra só "transferências" (0A.6).
--   * A pausa automática vigia `procedures`, `clinic_procedure_prices`,
--     `clinic_procedure_availability` e `patient_texts`.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Campanhas de isenção
-- -----------------------------------------------------------------------------
create table if not exists rita.evaluation_fee_campaigns (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = a rede inteira.
  clinic_ids uuid[],
  title text not null check (length(btrim(title)) between 3 and 120),
  approved_text text not null check (length(btrim(approved_text)) between 10 and 600),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'ended')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint evaluation_fee_campaigns_dates check (starts_on <= ends_on),
  constraint evaluation_fee_campaigns_approved check (status <> 'active' or approved_at is not null),
  constraint evaluation_fee_campaigns_clinics check (clinic_ids is null or cardinality(clinic_ids) > 0)
);

alter table rita.evaluation_fee_campaigns enable row level security;
revoke all on rita.evaluation_fee_campaigns from public, anon, authenticated;
grant all on rita.evaluation_fee_campaigns to service_role;

-- Propor: Admin (rede ou unidades) ou o Gerente das unidades indicadas.
create or replace function rita.propose_fee_campaign(
  p_clinic_ids uuid[], p_title text, p_text text, p_starts date, p_ends date
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if not public.is_admin_master() then
    if p_clinic_ids is null or exists (
      select 1 from unnest(p_clinic_ids) c
      where not public.has_role_in_clinic(c, array['unit_manager']::public.user_role[])
    ) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;
  insert into rita.evaluation_fee_campaigns
    (clinic_ids, title, approved_text, starts_on, ends_on, created_by)
  values (p_clinic_ids, btrim(p_title), btrim(p_text), p_starts, p_ends, v_uid)
  returning id into v_id;
  return v_id;
exception
  when check_violation or not_null_violation then
    raise exception 'INVALID_INPUT';
end;
$$;

revoke execute on function rita.propose_fee_campaign(uuid[], text, text, date, date) from public, anon, authenticated;
grant execute on function rita.propose_fee_campaign(uuid[], text, text, date, date) to authenticated;

-- Aprovar (ativar) ou encerrar: só o Admin Master.
create or replace function rita.set_fee_campaign_status(p_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_status not in ('active', 'ended') then
    raise exception 'INVALID_INPUT';
  end if;
  update rita.evaluation_fee_campaigns set
    status = p_status,
    approved_by = case when p_status = 'active' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'active' then now() else approved_at end
  where id = p_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

revoke execute on function rita.set_fee_campaign_status(uuid, text) from public, anon, authenticated;
grant execute on function rita.set_fee_campaign_status(uuid, text) to authenticated;

-- A campanha que vale HOJE (fuso de Brasília) para a unidade.
create or replace function rita._active_campaign(p_clinic uuid)
returns rita.evaluation_fee_campaigns
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from rita.evaluation_fee_campaigns c
  where c.status = 'active'
    and (now() at time zone 'America/Sao_Paulo')::date between c.starts_on and c.ends_on
    and (c.clinic_ids is null or p_clinic = any (c.clinic_ids))
  -- A da unidade vence a da rede; entre iguais, a que acaba depois.
  order by (c.clinic_ids is null), c.ends_on desc
  limit 1;
$$;

revoke execute on function rita._active_campaign(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) O catálogo da Rita na unidade
-- -----------------------------------------------------------------------------
create or replace function rita._evaluation_minutes(p_clinic uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.evaluation_minutes from public.clinic_agenda_settings s where s.clinic_id = p_clinic),
    (select s.evaluation_minutes from public.clinic_agenda_settings s where s.clinic_id is null),
    60);
$$;

revoke execute on function rita._evaluation_minutes(uuid) from public, anon, authenticated;

create or replace function rita.catalog(p_clinic uuid)
returns table (
  procedure_id uuid, name text, patient_name text, rita_role text,
  price_cents integer, minutes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         p.name,
         coalesce(nullif(btrim(p.patient_name), ''), p.name),
         p.rita_role,
         -- Preço só da avaliação/consulta; urgência e o resto, nunca.
         case when p.rita_role in ('evaluation_new', 'evaluation_returning')
              then coalesce(cp.price_cents, p.default_price_cents) end,
         case when p.rita_role in ('evaluation_new', 'evaluation_returning')
              then rita._evaluation_minutes(p_clinic) end
  from public.procedures p
  left join public.clinic_procedure_prices cp
    on cp.clinic_id = p_clinic and cp.procedure_id = p.id
  where p.rita_can_offer
    and p.is_active
    and not exists (
      select 1 from public.clinic_procedure_availability a
      where a.clinic_id = p_clinic and a.procedure_id = p.id and not a.offered
    )
  order by case p.rita_role when 'evaluation_new' then 1 when 'evaluation_returning' then 2 else 3 end, p.name;
$$;

revoke execute on function rita.catalog(uuid) from public, anon, authenticated;
grant execute on function rita.catalog(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3) O valor da avaliação
-- -----------------------------------------------------------------------------
create or replace function rita.evaluation_fee(p_clinic uuid)
returns table (
  procedure_id uuid, offered boolean, price_cents integer, minutes integer,
  campaign_id uuid, campaign_title text, campaign_text text, campaign_ends_on date,
  free_for_indica boolean, companies_with_benefit integer, ppr_plans_with_benefit integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p record;
  k rita.evaluation_fee_campaigns;
begin
  select pr.id, pr.default_price_cents, pr.is_active, pr.rita_can_offer
    into p
  from public.procedures pr where pr.rita_role = 'evaluation_new';

  procedure_id := p.id;
  offered := p.id is not null and p.is_active and p.rita_can_offer
    and not exists (
      select 1 from public.clinic_procedure_availability a
      where a.clinic_id = p_clinic and a.procedure_id = p.id and not a.offered
    );
  select coalesce(cp.price_cents, p.default_price_cents) into price_cents
  from (select 1) um
  left join public.clinic_procedure_prices cp
    on cp.clinic_id = p_clinic and cp.procedure_id = p.id;
  minutes := rita._evaluation_minutes(p_clinic);

  k := rita._active_campaign(p_clinic);
  campaign_id := k.id;
  campaign_title := k.title;
  campaign_text := k.approved_text;
  campaign_ends_on := k.ends_on;

  -- Decisão 5: o indicado do Indica +Risos tem a avaliação de boas-vindas.
  free_for_indica := true;
  select count(distinct b.company_id) into companies_with_benefit
  from empresarial.procedure_benefits b
  where b.procedure_id = p.id and b.benefit_type = 'FREE';
  select count(distinct b.plan_id) into ppr_plans_with_benefit
  from public.ppr_plan_benefits b
  where b.procedure_id = p.id and b.benefit_type = 'free';
  return next;
end;
$$;

revoke execute on function rita.evaluation_fee(uuid) from public, anon, authenticated;
grant execute on function rita.evaluation_fee(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4) O portão: a avaliação e "o que inclui" passam a ser conferidos
-- -----------------------------------------------------------------------------
create or replace function rita._pending_items()
returns table (ordem integer, item text, rotulo text, detalhe text)
language sql
immutable
security definer
set search_path = ''
as $$
  values
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
  f record;
  v_coord integer;
  v_maps text;
  v_dias_abertos integer;
  v_inclui boolean;
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

  for ordem, item, rotulo, detalhe in select * from rita._pending_items() loop
    ok := false;
    return next;
  end loop;
end;
$$;

revoke execute on function rita._gaps(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) Pausa automática: as tabelas desta entrega
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

    -- Linha que vale para a REDE (horário padrão, texto da rede) ou para
    -- todas (o procedimento do catálogo): confere todas as unidades ligadas.
    if v_old is null and v_new is null
       and tg_table_name in ('clinic_weekday_hours', 'patient_texts', 'procedures') then
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

-- No catálogo, só interessa quando muda o que o portão lê (não a cada edição).
drop trigger if exists rita_recheck on public.procedures;
create trigger rita_recheck
  after update of rita_role, rita_can_offer, is_active, default_price_cents or delete on public.procedures
  for each row execute function rita._recheck_trg();

drop trigger if exists rita_recheck on public.clinic_procedure_prices;
create trigger rita_recheck
  after update or delete on public.clinic_procedure_prices
  for each row execute function rita._recheck_trg();

drop trigger if exists rita_recheck on public.clinic_procedure_availability;
create trigger rita_recheck
  after insert or update or delete on public.clinic_procedure_availability
  for each row execute function rita._recheck_trg();

drop trigger if exists rita_recheck on public.patient_texts;
create trigger rita_recheck
  after update or delete on public.patient_texts
  for each row execute function rita._recheck_trg();

select public.audit_attach_all();

notify pgrst, 'reload schema';
