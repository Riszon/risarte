-- =============================================================================
-- 3001 — Rita, Fase 0A.2: o interruptor, o modo e o portão de ativação
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.2 (DA4, DA5, DA6).
-- Depende da 3000 (schema `rita`, `rita.agent_id()`).
--
-- O QUE CRIA
--   * `rita.settings` em cascata: a linha da REDE (`clinic_id` nulo) e uma por
--     unidade. `enabled` (padrão desligado) e `mode` (`off` / `sombra` /
--     `ativo`; padrão `sombra` = a Rita prepara, uma pessoa envia). Também os
--     campos de rede que a Rita vai precisar (mensagem fora do horário,
--     política de privacidade, encarregado de dados) — vazios por enquanto.
--   * `rita.enabled(unidade)`: rede ligada E unidade ligada E nenhuma em `off`.
--     `rita.effective_mode(unidade)`: `off`, `sombra` ou `ativo` (o mais
--     cauteloso entre a rede e a unidade).
--   * `rita.activation_gaps(unidade)`: a lista do PORTÃO, item a item. Cinco
--     itens são conferidos de verdade desde já; cinco dependem das entregas
--     0A.4–0A.6 e aparecem como pendentes (`rita._pending_items`) — enquanto
--     existirem, NENHUMA unidade liga. Cada entrega seguinte troca o pendente
--     pela conferência real.
--   * `rita.set_enabled(unidade, ligar, motivo)` — chamada pela TELA, por uma
--     pessoa logada: ligar = só Admin Master, com a rede ligada e o portão
--     completo; desligar = Admin Master ou Gerente da unidade, a qualquer hora.
--     Unidade nula = a rede (só Admin Master).
--   * `rita.set_mode(unidade, modo)` — só Admin Master.
--   * PAUSA AUTOMÁTICA: se um dado essencial some (endereço, agenda, unidade
--     desativada, coordenador removido) numa unidade ligada, a Rita desliga
--     sozinha ali, com o motivo. Gatilhos blindados: falha vai para
--     `rita.falhas` e nunca derruba a gravação de quem mexeu.
--
-- O AVISO ao Gerente e ao Admin na pausa fica para a 0A.6 (`rita._notify`);
-- até lá o motivo fica gravado em `paused_reason`.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) rita.settings
-- -----------------------------------------------------------------------------
create table if not exists rita.settings (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = a rede inteira. Uma linha por unidade.
  clinic_id uuid references public.clinics (id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'sombra' check (mode in ('off', 'sombra', 'ativo')),
  activated_by uuid references public.profiles (id),
  activated_at timestamptz,
  paused_at timestamptz,
  paused_by uuid references public.profiles (id),
  paused_reason text,
  -- Só na linha da rede (decisões 28 e 30; vazios até o dono decidir).
  after_hours_urgent_message text,
  privacy_policy_url text,
  dpo_name text,
  dpo_email text,
  dpo_phone text,
  updated_at timestamptz not null default now(),
  constraint rita_settings_clinic_key unique nulls not distinct (clinic_id)
);

alter table rita.settings enable row level security;
-- Nenhuma política: ninguém lê nem grava direto. Só pelas funções.
revoke all on rita.settings from public, anon, authenticated;
grant all on rita.settings to service_role;

-- A linha da rede nasce desligada.
insert into rita.settings (clinic_id, enabled, mode)
values (null, false, 'sombra')
on conflict on constraint rita_settings_clinic_key do nothing;

-- -----------------------------------------------------------------------------
-- 2) rita.falhas — o registro do que deu errado nos gatilhos (técnico)
-- -----------------------------------------------------------------------------
create table if not exists rita.falhas (
  id bigint generated always as identity primary key,
  ocorreu_em timestamptz not null default now(),
  origem text not null,
  clinic_id uuid,
  erro text not null
);

alter table rita.falhas enable row level security;
revoke all on rita.falhas from public, anon, authenticated;
grant all on rita.falhas to service_role;

insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('rita', 'falhas', 'Registro técnico de falhas dos gatilhos da Rita')
on conflict do nothing;

-- O schema passa a ter funções chamadas pela tela (pessoa logada). Usar o
-- schema não dá acesso a nada: tabelas sem permissão e funções com guarda.
grant usage on schema rita to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Ligada? Em que modo?
-- -----------------------------------------------------------------------------
create or replace function rita.enabled(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.enabled and r.mode <> 'off' and u.enabled and u.mode <> 'off'
    from rita.settings r
    join rita.settings u on u.clinic_id = p_clinic
    where r.clinic_id is null
  ), false);
$$;

revoke execute on function rita.enabled(uuid) from public, anon, authenticated;
grant execute on function rita.enabled(uuid) to service_role;

create or replace function rita.effective_mode(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not rita.enabled(p_clinic) then 'off'
    when exists (
      select 1 from rita.settings s
      where (s.clinic_id is null or s.clinic_id = p_clinic) and s.mode = 'sombra'
    ) then 'sombra'
    else 'ativo'
  end;
$$;

revoke execute on function rita.effective_mode(uuid) from public, anon, authenticated;
grant execute on function rita.effective_mode(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4) O portão
-- -----------------------------------------------------------------------------
-- Os itens que dependem das próximas entregas. Cada entrega recria esta
-- função sem o item que passou a ser conferido de verdade.
create or replace function rita._pending_items()
returns table (ordem integer, item text, rotulo text, detalhe text)
language sql
immutable
security definer
set search_path = ''
as $$
  values
    (60, 'maps', 'Link do endereço no mapa', 'Cadastro chega na entrega 0A.4'),
    (70, 'horario_por_dia', 'Horário de funcionamento por dia', 'Cadastro chega na entrega 0A.4'),
    (80, 'avaliacao', 'Duração e valor (ou gratuidade) da avaliação', 'Cadastro chega na entrega 0A.5'),
    (90, 'avaliacao_inclui', 'O que a avaliação inclui', 'Cadastro chega na entrega 0A.5'),
    (100, 'transferencias', 'Quem recebe as transferências em horário comercial', 'Cadastro chega na entrega 0A.6');
$$;

revoke execute on function rita._pending_items() from public, anon, authenticated;

-- A conta, sem guarda (usada pelas funções e pelos gatilhos).
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

  for ordem, item, rotulo, detalhe in select * from rita._pending_items() loop
    ok := false;
    return next;
  end loop;
end;
$$;

revoke execute on function rita._gaps(uuid) from public, anon, authenticated;

-- A porta, para a tela e para a chave de serviço.
create or replace function rita.activation_gaps(p_clinic uuid)
returns table (ordem integer, item text, rotulo text, ok boolean, detalhe text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not public.is_admin_master()
     and not (p_clinic in (select public.user_full_access_clinic_ids())) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query select * from rita._gaps(p_clinic) order by 1;
end;
$$;

revoke execute on function rita.activation_gaps(uuid) from public, anon, authenticated;
grant execute on function rita.activation_gaps(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5) Ligar e desligar (pela tela, por uma pessoa)
-- -----------------------------------------------------------------------------
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
      paused_reason = case when p_enabled then null
        else coalesce(nullif(btrim(p_reason), ''), 'Desligada pela tela') end,
      updated_at = now()
    where clinic_id is null;
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
  else
    -- DESLIGAR (pânico): Admin Master ou o Gerente DESTA unidade, sempre.
    if not (public.is_admin_master()
            or public.has_role_in_clinic(p_clinic, array['unit_manager']::public.user_role[])) then
      raise exception 'NOT_ALLOWED';
    end if;
    insert into rita.settings (clinic_id, enabled, paused_by, paused_at, paused_reason)
    values (p_clinic, false, v_uid, now(),
            coalesce(nullif(btrim(p_reason), ''), 'Desligada pela tela'))
    on conflict on constraint rita_settings_clinic_key do update set
      enabled = false,
      paused_by = excluded.paused_by,
      paused_at = excluded.paused_at,
      paused_reason = excluded.paused_reason,
      updated_at = now();
  end if;
end;
$$;

revoke execute on function rita.set_enabled(uuid, boolean, text) from public, anon, authenticated;
grant execute on function rita.set_enabled(uuid, boolean, text) to authenticated;

create or replace function rita.set_mode(p_clinic uuid, p_mode text)
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
  if p_mode is null or p_mode not in ('off', 'sombra', 'ativo') then
    raise exception 'INVALID_INPUT';
  end if;
  if p_clinic is not null and not exists (select 1 from public.clinics where id = p_clinic) then
    raise exception 'CLINIC_NOT_FOUND';
  end if;
  insert into rita.settings (clinic_id, mode)
  values (p_clinic, p_mode)
  on conflict on constraint rita_settings_clinic_key do update set
    mode = excluded.mode,
    updated_at = now();
end;
$$;

revoke execute on function rita.set_mode(uuid, text) from public, anon, authenticated;
grant execute on function rita.set_mode(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) Pausa automática
-- -----------------------------------------------------------------------------
-- Se a unidade está ligada e o portão deixou de estar completo, desliga com o
-- motivo. Devolve true se pausou. Também serve à 0B (o processo pode pausar).
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
  return true;
end;
$$;

revoke execute on function rita._pause_if_gaps(uuid, text) from public, anon, authenticated;
grant execute on function rita._pause_if_gaps(uuid, text) to service_role;

-- O gatilho: um só, preso nas tabelas que o portão lê.
create or replace function rita._recheck_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  begin
    if tg_table_name = 'clinics' then
      v_old := case when tg_op <> 'INSERT' then old.id end;
      v_new := case when tg_op <> 'DELETE' then new.id end;
    else
      v_old := case when tg_op <> 'INSERT' then (to_jsonb(old) ->> 'clinic_id')::uuid end;
      v_new := case when tg_op <> 'DELETE' then (to_jsonb(new) ->> 'clinic_id')::uuid end;
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

drop trigger if exists rita_recheck on public.clinics;
create trigger rita_recheck
  after update or delete on public.clinics
  for each row execute function rita._recheck_trg();

drop trigger if exists rita_recheck on public.clinic_agenda_settings;
create trigger rita_recheck
  after update or delete on public.clinic_agenda_settings
  for each row execute function rita._recheck_trg();

drop trigger if exists rita_recheck on public.user_clinic_roles_all;
create trigger rita_recheck
  after update or delete on public.user_clinic_roles_all
  for each row execute function rita._recheck_trg();

-- Coordenador desativado: confere as unidades em que ele coordena.
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
      where u.user_id = new.id and u.role = 'clinical_coordinator'
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

drop trigger if exists rita_recheck_profile on public.profiles;
create trigger rita_recheck_profile
  after update of is_active on public.profiles
  for each row when (old.is_active and not new.is_active)
  execute function rita._recheck_profile_trg();

select public.audit_attach_all();

notify pgrst, 'reload schema';
