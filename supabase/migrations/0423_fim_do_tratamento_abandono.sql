-- =============================================================================
-- 0423 — FIM DO TRATAMENTO, ETAPA 4: O ABANDONO E A LISTA DE ESQUECIDOS
-- Plano: docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seções 6 e 7 (D16, D19).
--
-- O furo: o cliente para de vir com sessões pendentes e nunca pede para
-- cancelar. As sessões seguram a Fase 5 para sempre e ninguém tem tarefa.
--
-- O caminho (D16):
--   1. sessão pendente sem horário e nenhuma atividade há X dias (Prazos,
--      `abandon_no_schedule_days`, padrão 30) → tarefa da Recepção: REAGENDAR;
--   2. 3 tentativas sem reagendar (ou a Recepção encaminha) → tarefa do
--      Coordenador: CONTATO;
--   3. o cliente não volta → o Coordenador faz o REGISTRO DE ABANDONO com os
--      riscos clínicos informados (texto, meio, data) — proteção jurídica;
--   4. o Gerente decide: Fase 7 com retorno (as sessões ficam abertas para a
--      volta) ou o cancelamento formal (a tarefa só some quando o termo abre);
--   5. o cliente agenda em qualquer momento → a tarefa some sozinha.
-- O registro não apaga nada e não muda a venda.
--
-- A lista "Clientes sem próximo passo" (7.4): Fase 5 ou 6, sem horário
-- futuro, sem tarefa aberta, sem ortodontia em tratamento e sem complemento
-- com movimento nos últimos X dias (`stalled_treatment_days`, padrão 30).
--
-- Não mexe nas funções da ortodontia nem nas do fechamento (0421/0422).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os prazos (Prazos → Inatividade), padrão da rede
-- -----------------------------------------------------------------------------
insert into public.inactivity_settings (clinic_id, setting_key, value_days) values
  (null, 'abandon_no_schedule_days', 30),
  (null, 'stalled_treatment_days', 30)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2) As tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.treatment_abandonments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  status text not null default 'reagendar'
    check (status in ('reagendar', 'contato', 'gerente', 'cancelamento', 'encerrado')),
  origin text not null default 'automatico' check (origin in ('automatico', 'manual')),
  last_activity_at timestamptz,
  -- O registro de abandono (Coordenador).
  risks_informed text,
  risks_channel text check (risks_channel in ('ligacao', 'mensagem', 'presencial', 'carta')),
  risks_informed_on date,
  registered_by uuid references public.profiles (id),
  registered_at timestamptz,
  -- A decisão do Gerente.
  decision text check (decision in ('fase7', 'cancelamento')),
  decision_note text,
  return_date date,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  -- Como terminou.
  outcome text check (outcome in ('reagendado', 'fase7', 'cancelamento_aberto', 'sem_pendencia')),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.treatment_abandonments is
  '0423 (D16): o abandono de tratamento — reagendar → contato → registro com os riscos → decisão do Gerente. Uma aberta por cliente.';

create unique index if not exists treatment_abandonments_one_open
  on public.treatment_abandonments (client_id) where status <> 'encerrado';
create index if not exists treatment_abandonments_clinic_open
  on public.treatment_abandonments (clinic_id) where status <> 'encerrado';

drop trigger if exists treatment_abandonments_set_updated_at on public.treatment_abandonments;
create trigger treatment_abandonments_set_updated_at
  before update on public.treatment_abandonments
  for each row execute function public.set_updated_at();

create table if not exists public.treatment_abandonment_attempts (
  id uuid primary key default gen_random_uuid(),
  abandonment_id uuid not null references public.treatment_abandonments (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  stage text not null check (stage in ('reagendar', 'contato')),
  channel text not null check (channel in ('ligacao', 'mensagem', 'presencial')),
  reached boolean not null,
  summary text,
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists treatment_abandonment_attempts_abandonment
  on public.treatment_abandonment_attempts (abandonment_id);

alter table public.treatment_abandonments enable row level security;
alter table public.treatment_abandonment_attempts enable row level security;

-- Lê quem enxerga o cliente (a mesma regra do fechamento, 0418). Grava só
-- pelas portas abaixo.
drop policy if exists "treatment_abandonments_select" on public.treatment_abandonments;
create policy "treatment_abandonments_select" on public.treatment_abandonments
  for select to authenticated
  using (
    public.is_admin_master()
    or exists (select 1 from public.clients c where c.id = treatment_abandonments.client_id)
  );
drop policy if exists "treatment_abandonment_attempts_select" on public.treatment_abandonment_attempts;
create policy "treatment_abandonment_attempts_select" on public.treatment_abandonment_attempts
  for select to authenticated
  using (
    public.is_admin_master()
    or exists (select 1 from public.clients c where c.id = treatment_abandonment_attempts.client_id)
  );

revoke insert, update, delete on public.treatment_abandonments from anon, authenticated;
revoke insert, update, delete on public.treatment_abandonment_attempts from anon, authenticated;
grant select on public.treatment_abandonments to authenticated;
grant select on public.treatment_abandonment_attempts to authenticated;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- 3) As regras internas
-- -----------------------------------------------------------------------------

-- O cliente tem horário futuro ativo (agendado ou confirmado)?
create or replace function public._tem_horario_futuro(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where a.client_id = p_client_id
      and a.status in ('scheduled', 'confirmed')
      and a.starts_at >= now()
  );
$$;
revoke execute on function public._tem_horario_futuro(uuid) from public, anon, authenticated;

-- A última atividade do cliente: a sessão feita, o horário que aconteceu ou a
-- entrada na fase — o que for mais recente.
create or replace function public._ultima_atividade(p_client_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select max(ts.done_at) from public.treatment_sessions ts
      where ts.client_id = p_client_id and ts.status = 'done'),
    (select max(a.starts_at) from public.appointments a
      where a.client_id = p_client_id and a.starts_at < now()
        and a.status not in ('cancelled', 'no_show')),
    (select c.phase_entered_at from public.clients c where c.id = p_client_id)
  );
$$;
revoke execute on function public._ultima_atividade(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) A varredura diária: abre a tarefa de reagendar
-- -----------------------------------------------------------------------------
create or replace function public.treatment_abandonment_scan(p_clinic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  -- (a) Fecha o que perdeu o motivo: sem sessão pendente (o tratamento acabou
  --     ou foi cancelado). Só nas etapas que ainda dependem disso.
  update public.treatment_abandonments t
     set status = 'encerrado', outcome = 'sem_pendencia', closed_at = now()
   where t.status in ('reagendar', 'contato')
     and (p_clinic_id is null or t.clinic_id = p_clinic_id)
     and not exists (select 1 from public.treatment_sessions ts
                      where ts.client_id = t.client_id and ts.status in ('pending', 'scheduled'));

  -- (b) Abre para quem parou: Fase 5, sessão pendente, nenhum horário futuro e
  --     nenhuma atividade no prazo.
  for r in
    select c.id, c.clinic_id, c.full_name, public._ultima_atividade(c.id) as ultima
    from public.clients c
    where c.journey_phase = 'treatment_start'
      and (p_clinic_id is null or c.clinic_id = p_clinic_id)
      and exists (select 1 from public.treatment_sessions ts
                  where ts.client_id = c.id and ts.status = 'pending')
      and not public._tem_horario_futuro(c.id)
      and not exists (select 1 from public.treatment_abandonments t
                      where t.client_id = c.id and t.status <> 'encerrado')
  loop
    if r.ultima is null
       or r.ultima > now() - make_interval(days => coalesce(
            public.inactivity_threshold(r.clinic_id, 'abandon_no_schedule_days'), 30)) then
      continue;
    end if;
    insert into public.treatment_abandonments (clinic_id, client_id, last_activity_at)
    values (r.clinic_id, r.id, r.ultima);
    perform public._fechamento_avisar(
      r.clinic_id, array['receptionist']::public.user_role[], null,
      'Reagendar o tratamento: ' || coalesce(r.full_name, 'Cliente'),
      coalesce(r.full_name, 'Cliente') || ' tem sessões pendentes e nada agendado desde '
        || to_char(r.ultima at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.',
      '/prontuarios/' || r.id, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.treatment_abandonment_scan(uuid) from public, anon, authenticated;

do $$
begin
  perform cron.schedule(
    'risarte-abandono-daily', '20 3 * * *',
    'select public.treatment_abandonment_scan()'
  );
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) O cliente agendou: a tarefa some (D16.5)
-- -----------------------------------------------------------------------------
create or replace function public.treatment_abandonment_on_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ab record;
begin
  if new.status not in ('scheduled', 'confirmed') or new.starts_at < now() then
    return new;
  end if;
  select id, status, clinic_id into v_ab
    from public.treatment_abandonments
   where client_id = new.client_id and status in ('reagendar', 'contato', 'gerente');
  if v_ab.id is null then return new; end if;

  update public.treatment_abandonments
     set status = 'encerrado', outcome = 'reagendado',
         closed_at = now(), closed_by = (select auth.uid())
   where id = v_ab.id;

  if v_ab.status <> 'reagendar' then
    perform public._fechamento_avisar(
      v_ab.clinic_id,
      array['clinical_coordinator', 'unit_manager']::public.user_role[], null,
      'O cliente voltou a agendar',
      'A tarefa de abandono foi encerrada: o cliente tem horário marcado.',
      '/prontuarios/' || new.client_id, (select auth.uid()));
  end if;
  return new;
end;
$$;
revoke execute on function public.treatment_abandonment_on_appointment() from public, anon, authenticated;

drop trigger if exists treatment_abandonment_on_appointment on public.appointments;
create trigger treatment_abandonment_on_appointment
  after insert or update of status, starts_at on public.appointments
  for each row execute function public.treatment_abandonment_on_appointment();

-- -----------------------------------------------------------------------------
-- 6) O termo de cancelamento abriu: a decisão "cancelamento" se cumpre
-- -----------------------------------------------------------------------------
create or replace function public.treatment_abandonment_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.treatment_abandonments
     set status = 'encerrado', outcome = 'cancelamento_aberto',
         closed_at = now(), closed_by = (select auth.uid())
   where client_id = new.client_id and status = 'cancelamento';
  return new;
end;
$$;
revoke execute on function public.treatment_abandonment_on_cancellation() from public, anon, authenticated;

drop trigger if exists treatment_abandonment_on_cancellation on public.plan_cancellations;
create trigger treatment_abandonment_on_cancellation
  after insert on public.plan_cancellations
  for each row execute function public.treatment_abandonment_on_cancellation();

-- -----------------------------------------------------------------------------
-- 7) As portas
-- -----------------------------------------------------------------------------

-- 7a) Uma tentativa: a Recepção reagenda; o Coordenador contata.
create or replace function public.register_abandonment_attempt(
  p_id uuid,
  p_channel text,
  p_reached boolean,
  p_summary text default null,
  p_escalate boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ab public.treatment_abandonments%rowtype;
  v_name text;
  v_tentativas integer;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_ab from public.treatment_abandonments where id = p_id for update;
  if v_ab.id is null then raise exception 'NOT_FOUND'; end if;
  if v_ab.status not in ('reagendar', 'contato') then raise exception 'WRONG_STAGE'; end if;

  if v_ab.status = 'reagendar' then
    if not (public.is_admin_master() or public.has_role_in_clinic(v_ab.clinic_id,
            array['receptionist', 'clinical_coordinator', 'unit_manager']::public.user_role[])) then
      raise exception 'NOT_ALLOWED';
    end if;
  elsif not (public.is_admin_master() or public.has_role_in_clinic(v_ab.clinic_id,
             array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_channel is null or p_channel not in ('ligacao', 'mensagem', 'presencial') then
    raise exception 'INVALID_CHANNEL';
  end if;
  if p_reached is null then raise exception 'INVALID_CHANNEL'; end if;
  if p_reached and length(trim(coalesce(p_summary, ''))) < 5 then
    raise exception 'SUMMARY_REQUIRED';
  end if;
  if p_escalate and (v_ab.status <> 'reagendar' or not p_reached) then
    raise exception 'ESCALATE_NEEDS_TALK';
  end if;

  insert into public.treatment_abandonment_attempts
    (abandonment_id, clinic_id, client_id, stage, channel, reached, summary, recorded_by)
  values (v_ab.id, v_ab.clinic_id, v_ab.client_id, v_ab.status, p_channel, p_reached,
          nullif(trim(coalesce(p_summary, '')), ''), v_user);

  if v_ab.status = 'reagendar' then
    select count(*) into v_tentativas from public.treatment_abandonment_attempts
     where abandonment_id = v_ab.id and stage = 'reagendar';
    -- D16: 3 tentativas sem reagendar, ou a Recepção falou e o cliente não quer
    -- marcar → vai ao Coordenador.
    if v_tentativas >= 3 or p_escalate then
      update public.treatment_abandonments set status = 'contato' where id = v_ab.id;
      select full_name into v_name from public.clients where id = v_ab.client_id;
      perform public._fechamento_avisar(
        v_ab.clinic_id, array['clinical_coordinator']::public.user_role[], null,
        'Possível abandono: contatar ' || coalesce(v_name, 'o cliente'),
        coalesce(v_name, 'O cliente') || ' tem sessões pendentes e não reagendou depois de '
          || v_tentativas || ' tentativa(s) da Recepção.',
        '/prontuarios/' || v_ab.client_id, null);
      return 'contato';
    end if;
  end if;
  return v_ab.status;
end;
$$;
revoke execute on function public.register_abandonment_attempt(uuid, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.register_abandonment_attempt(uuid, text, boolean, text, boolean) to authenticated;

-- 7b) O registro de abandono, com os riscos informados (Coordenador).
create or replace function public.register_treatment_abandonment(
  p_id uuid,
  p_risks text,
  p_channel text,
  p_informed_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ab public.treatment_abandonments%rowtype;
  v_name text;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_ab from public.treatment_abandonments where id = p_id for update;
  if v_ab.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_ab.clinic_id,
          array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_ab.status <> 'contato' then raise exception 'WRONG_STAGE'; end if;
  if length(trim(coalesce(p_risks, ''))) < 20 then raise exception 'RISKS_REQUIRED'; end if;
  if p_channel is null or p_channel not in ('ligacao', 'mensagem', 'presencial', 'carta') then
    raise exception 'INVALID_CHANNEL';
  end if;
  if p_informed_on is null or p_informed_on > public.today_br() then
    raise exception 'INVALID_DATE';
  end if;

  update public.treatment_abandonments
     set status = 'gerente', risks_informed = trim(p_risks), risks_channel = p_channel,
         risks_informed_on = p_informed_on, registered_by = v_user, registered_at = now()
   where id = v_ab.id;

  select full_name into v_name from public.clients where id = v_ab.client_id;
  perform public._fechamento_avisar(
    v_ab.clinic_id, array['unit_manager']::public.user_role[], null,
    'Abandono registrado: decidir — ' || coalesce(v_name, 'Cliente'),
    'O Coordenador registrou o abandono de tratamento. Decida: Fase 7 com retorno ou cancelamento formal.',
    '/prontuarios/' || v_ab.client_id, v_user);
end;
$$;
revoke execute on function public.register_treatment_abandonment(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.register_treatment_abandonment(uuid, text, text, date) to authenticated;

-- 7c) A decisão do Gerente.
create or replace function public.decide_treatment_abandonment(
  p_id uuid,
  p_decision text,
  p_return_date date default null,
  p_note text default null
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ab public.treatment_abandonments%rowtype;
  v_name text;
  v_return date;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_ab from public.treatment_abandonments where id = p_id for update;
  if v_ab.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_ab.clinic_id,
          array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_ab.status <> 'gerente' then raise exception 'WRONG_STAGE'; end if;
  if p_decision is null or p_decision not in ('fase7', 'cancelamento') then
    raise exception 'INVALID_DECISION';
  end if;

  select full_name into v_name from public.clients where id = v_ab.client_id;

  if p_decision = 'fase7' then
    if p_return_date is not null and p_return_date <= public.today_br() then
      raise exception 'RETURN_DATE_PAST';
    end if;
    v_return := coalesce(p_return_date, (public.today_br() + interval '6 months')::date);
    update public.treatment_abandonments
       set status = 'encerrado', decision = 'fase7', decision_note = nullif(trim(coalesce(p_note, '')), ''),
           return_date = v_return, decided_by = v_user, decided_at = now(),
           outcome = 'fase7', closed_by = v_user, closed_at = now()
     where id = v_ab.id;
    -- As sessões pendentes ficam abertas para a volta (D16.4).
    perform public._jornada_mover_por_evento(v_ab.client_id, 'follow_up', 'abandono', v_user, v_return);
    perform public._fechamento_avisar(
      v_ab.clinic_id, array['receptionist', 'clinical_coordinator']::public.user_role[], null,
      'Abandono: ' || coalesce(v_name, 'Cliente') || ' foi para o Acompanhamento',
      'Retorno previsto para ' || to_char(v_return, 'DD/MM/YYYY')
        || '. As sessões pendentes continuam abertas para a volta.',
      '/prontuarios/' || v_ab.client_id, v_user);
    return v_return;
  end if;

  -- Cancelamento: a tarefa continua com o Gerente até o termo abrir.
  update public.treatment_abandonments
     set status = 'cancelamento', decision = 'cancelamento',
         decision_note = nullif(trim(coalesce(p_note, '')), ''),
         decided_by = v_user, decided_at = now()
   where id = v_ab.id;
  return null;
end;
$$;
revoke execute on function public.decide_treatment_abandonment(uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.decide_treatment_abandonment(uuid, text, date, text) to authenticated;

-- 7d) Começar pela lista: o Coordenador ou o Gerente abre o contato.
create or replace function public.start_treatment_abandonment(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_clinic uuid;
  v_phase public.journey_phase;
  v_id uuid;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select clinic_id, journey_phase into v_clinic, v_phase from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_clinic,
          array['clinical_coordinator', 'unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_phase not in ('treatment_start', 'reevaluation') then raise exception 'WRONG_PHASE'; end if;
  if exists (select 1 from public.treatment_abandonments
              where client_id = p_client_id and status <> 'encerrado') then
    raise exception 'ALREADY_OPEN';
  end if;

  insert into public.treatment_abandonments
    (clinic_id, client_id, status, origin, last_activity_at, created_by)
  values (v_clinic, p_client_id, 'contato', 'manual', public._ultima_atividade(p_client_id), v_user)
  returning id into v_id;

  perform public._fechamento_avisar(
    v_clinic, array['clinical_coordinator']::public.user_role[], null,
    'Contatar o cliente (sem próximo passo)',
    'Aberto pela lista "Clientes sem próximo passo".',
    '/prontuarios/' || p_client_id, v_user);
  return v_id;
end;
$$;
revoke execute on function public.start_treatment_abandonment(uuid) from public, anon, authenticated;
grant execute on function public.start_treatment_abandonment(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) A lista "Clientes sem próximo passo" (7.4)
-- -----------------------------------------------------------------------------
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
declare
  v_parado integer;
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(p_clinic_id,
          array['clinical_coordinator', 'unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  v_parado := coalesce(public.inactivity_threshold(p_clinic_id, 'stalled_treatment_days'), 30);

  return query
  select c.id, c.full_name, c.journey_phase,
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
                       and coalesce(tp.updated_at, tp.created_at) > now() - make_interval(days => v_parado))
  order by public._ultima_atividade(c.id) nulls first;
end;
$$;
revoke execute on function public.clients_without_next_step(uuid) from public, anon, authenticated;
grant execute on function public.clients_without_next_step(uuid) to authenticated;
