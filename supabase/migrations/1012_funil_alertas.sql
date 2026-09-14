-- =============================================================================
-- 1012 — Risarte Empresarial: os alertas do funil
-- -----------------------------------------------------------------------------
-- Bloco D (ver docs/risarte-empresarial/FUNIL-COMERCIAL.md).
--
-- Duas perguntas que o funil precisa responder sozinho, sem ninguém olhar:
-- **esta empresa está parada há tempo demais nesta fase?** e **há quantos dias
-- ninguém faz nada com ela?**
--
-- 1) O LIMITE É POR FASE, e não um número só (`funnel_stage_limits`). Três dias
--    tentando contato é normal; três dias com a proposta na mesa sem retorno já
--    não é. Um limite único faria o alerta gritar na fase errada — e alerta que
--    grita no lugar errado é o primeiro que a equipe aprende a ignorar.
--
-- 2) ALERTA QUE REPETE TODO DIA É ALERTA QUE NINGUÉM LÊ. Mesma disciplina do
--    FIN7.3: `funnel_alerts` guarda (lead, regra, referência) e o aviso sai UMA
--    vez; só rearma quando a condição some e volta.
--
-- 3) RODA SEM USUÁRIO. No cron `auth.uid()` é nulo e toda guarda recusaria
--    tudo. A conta fica na função `_raw` (sem guarda, revogada do público) e a
--    porta pública leva a guarda — mesmo desenho de `apply_stock_movement` ×
--    `post_stock_movement`.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os limites
-- -----------------------------------------------------------------------------
create table if not exists empresarial.funnel_settings (
  -- Uma linha só: a configuração é do PROGRAMA, não por unidade.
  singleton boolean primary key default true check (singleton),
  inactivity_days int not null default 7 check (inactivity_days > 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into empresarial.funnel_settings (singleton) values (true)
on conflict (singleton) do nothing;

create table if not exists empresarial.funnel_stage_limits (
  -- Fechamento (ganho/perda) não entra: encerrado não fica "parado".
  stage varchar(30) primary key
    check (stage in ('CAPTURE','CONTACT','MEETING_SCHEDULED','PRESENTED',
                     'PROPOSAL_SENT','FOLLOW_UP','IMPLEMENTATION')),
  max_days int not null check (max_days > 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Padrões de partida, por fase. São chute inicial declarado como tal: a tela
-- deixa o gestor ajustar, e o número certo só aparece depois de o funil rodar.
insert into empresarial.funnel_stage_limits (stage, max_days) values
  ('CAPTURE', 14),
  ('CONTACT', 7),
  ('MEETING_SCHEDULED', 10),
  ('PRESENTED', 7),
  ('PROPOSAL_SENT', 5),
  ('FOLLOW_UP', 15),
  ('IMPLEMENTATION', 30)
on conflict (stage) do nothing;

alter table empresarial.funnel_settings enable row level security;
alter table empresarial.funnel_stage_limits enable row level security;

-- Todo mundo que enxerga o funil LÊ os limites (o cartão precisa deles para
-- ficar vermelho). Só o gestor do programa MUDA.
drop policy if exists funnel_settings_select on empresarial.funnel_settings;
create policy funnel_settings_select on empresarial.funnel_settings
  for select to authenticated using (true);
drop policy if exists funnel_settings_write on empresarial.funnel_settings;
create policy funnel_settings_write on empresarial.funnel_settings
  for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

drop policy if exists funnel_stage_limits_select on empresarial.funnel_stage_limits;
create policy funnel_stage_limits_select on empresarial.funnel_stage_limits
  for select to authenticated using (true);
drop policy if exists funnel_stage_limits_write on empresarial.funnel_stage_limits;
create policy funnel_stage_limits_write on empresarial.funnel_stage_limits
  for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

grant select, insert, update, delete
  on empresarial.funnel_settings, empresarial.funnel_stage_limits to authenticated;
grant all
  on empresarial.funnel_settings, empresarial.funnel_stage_limits to service_role;

-- -----------------------------------------------------------------------------
-- 2) Os alertas
-- -----------------------------------------------------------------------------
create table if not exists empresarial.funnel_alerts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null
    references empresarial.commercial_leads (id) on delete cascade,
  rule text not null check (rule in ('tempo_na_fase', 'inatividade')),
  -- Identifica ESTA ocorrência. Na regra de tempo é a fase; na inatividade é a
  -- data do último movimento. É o que faz "parada no follow-up" ser um alerta
  -- só, e não um por dia.
  reference text not null,
  detail text,
  days int,
  first_seen_at timestamptz not null default now(),
  notified_at timestamptz,
  -- Preenchido quando a condição some. Rearma o aviso se ela voltar.
  cleared_at timestamptz,
  constraint funnel_alerts_unique unique (lead_id, rule, reference)
);

create index if not exists funnel_alerts_open_idx
  on empresarial.funnel_alerts (rule, cleared_at);

alter table empresarial.funnel_alerts enable row level security;

drop policy if exists funnel_alerts_select on empresarial.funnel_alerts;
create policy funnel_alerts_select on empresarial.funnel_alerts
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

grant select on empresarial.funnel_alerts to authenticated;
grant all on empresarial.funnel_alerts to service_role;

-- -----------------------------------------------------------------------------
-- 3) A apuração
-- -----------------------------------------------------------------------------
-- O estado de cada empresa aberta: em que fase está, desde quando, e quando foi
-- o ÚLTIMO MOVIMENTO de alguém.
--
-- "Movimento" é qualquer registro que uma pessoa criou — anotação, tentativa de
-- contato, envio, reunião. Olhar só a linha do tempo deixaria de fora a reunião
-- marcada e a proposta enviada, e o alerta cobraria justamente quem está
-- trabalhando.
--
-- ⚠️ VISÃO, e não tabela temporária: dentro de função com `search_path = ''` uma
-- tabela temporária sem qualificação não resolve, e o erro só apareceria na
-- primeira execução do cron — de madrugada, sem ninguém olhando.
--
-- Não é exposta a `authenticated`: ela atravessaria a RLS dos leads. Quem lê
-- funil na tela lê pelas tabelas, com a RLS aplicada.
create or replace view empresarial.funnel_lead_state as
select
  l.id as lead_id,
  l.stage,
  l.consultant_id,
  h.entered_at,
  greatest(
    h.entered_at,
    coalesce((select max(a.created_at) from empresarial.commercial_lead_activities a where a.lead_id = l.id), h.entered_at),
    coalesce((select max(t.attempted_at) from empresarial.lead_contact_attempts t where t.lead_id = l.id), h.entered_at),
    coalesce((select max(d.sent_at) from empresarial.lead_dispatches d where d.lead_id = l.id), h.entered_at),
    coalesce((select max(m.updated_at) from empresarial.lead_meetings m where m.lead_id = l.id), h.entered_at)
  ) as last_move
from empresarial.commercial_leads l
join empresarial.commercial_lead_stage_history h
  on h.lead_id = l.id and h.left_at is null
-- Encerrado não fica parado: fechado (ganho ou perda) sai da conta.
where l.stage not in ('CLOSED_WON', 'CLOSED_LOST');

revoke all on empresarial.funnel_lead_state from public, authenticated;
grant select on empresarial.funnel_lead_state to service_role;

-- Sem guarda, porque roda no cron (onde não há usuário). Revogada do público —
-- no Postgres função nova nasce executável por TODO MUNDO.
create or replace function empresarial.check_funnel_alerts_raw()
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  inatividade int;
  novos int := 0;
begin
  select s.inactivity_days into inatividade
  from empresarial.funnel_settings s
  where s.singleton;
  if inatividade is null then
    inatividade := 7;
  end if;

  -- ---- regra 1: tempo demais na fase --------------------------------------
  insert into empresarial.funnel_alerts (lead_id, rule, reference, detail, days)
  select
    e.lead_id,
    'tempo_na_fase',
    e.stage,
    'Parada nesta fase há ' || (public.today_br() - e.entered_at::date) || ' dias (limite ' || lim.max_days || ').',
    (public.today_br() - e.entered_at::date)
  from empresarial.funnel_lead_state e
  join empresarial.funnel_stage_limits lim on lim.stage = e.stage
  where (public.today_br() - e.entered_at::date) > lim.max_days
  on conflict (lead_id, rule, reference) do update
    set detail = excluded.detail,
        days = excluded.days,
        -- Rearma: a condição voltou.
        cleared_at = null
    where empresarial.funnel_alerts.cleared_at is not null;

  -- ---- regra 2: inatividade -----------------------------------------------
  insert into empresarial.funnel_alerts (lead_id, rule, reference, detail, days)
  select
    e.lead_id,
    'inatividade',
    e.last_move::date::text,
    'Sem nenhum registro há ' || (public.today_br() - e.last_move::date) || ' dias.',
    (public.today_br() - e.last_move::date)
  from empresarial.funnel_lead_state e
  where (public.today_br() - e.last_move::date) > inatividade
  on conflict (lead_id, rule, reference) do update
    set detail = excluded.detail,
        days = excluded.days
    where false;   -- a referência já identifica a ocorrência; não reabre nada

  -- ---- baixa o que não vale mais ------------------------------------------
  -- Empresa que saiu da fase, que voltou a ter movimento, ou que fechou.
  update empresarial.funnel_alerts a
     set cleared_at = now()
   where a.cleared_at is null
     and not exists (
       select 1 from empresarial.funnel_lead_state e
       where e.lead_id = a.lead_id
         and (
           (a.rule = 'tempo_na_fase'
            and a.reference = e.stage
            and (public.today_br() - e.entered_at::date) >
                (select lim.max_days from empresarial.funnel_stage_limits lim where lim.stage = e.stage))
           or
           (a.rule = 'inatividade'
            and a.reference = e.last_move::date::text
            and (public.today_br() - e.last_move::date) > inatividade)
         )
     );

  -- ---- avisa quem é responsável, uma vez por alerta ------------------------
  -- Lead sem consultor não gera aviso (não há a quem avisar), mas o alerta
  -- existe e aparece no painel — que é onde o gestor cobra a atribuição.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select
    l.consultant_id,
    null,
    case a.rule
      when 'tempo_na_fase' then 'Funil parado: ' || l.company_name
      else 'Sem contato: ' || l.company_name
    end,
    a.detail,
    '/empresarial/funil/' || l.id
  from empresarial.funnel_alerts a
  join empresarial.commercial_leads l on l.id = a.lead_id
  where a.cleared_at is null
    and a.notified_at is null
    and l.consultant_id is not null;

  update empresarial.funnel_alerts a
     set notified_at = now()
   where a.cleared_at is null
     and a.notified_at is null
     and exists (
       select 1 from empresarial.commercial_leads l
       where l.id = a.lead_id and l.consultant_id is not null
     );

  select count(*) into novos
  from empresarial.funnel_alerts
  where cleared_at is null;

  return novos;
end;
$fn$;

revoke all on function empresarial.check_funnel_alerts_raw() from public;

-- A porta pública, com guarda: o botão "apurar agora" do painel.
create or replace function empresarial.check_funnel_alerts()
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not empresarial.is_program_manager() then
    raise exception 'NOT_ALLOWED';
  end if;
  return empresarial.check_funnel_alerts_raw();
end;
$fn$;

grant execute on function empresarial.check_funnel_alerts() to authenticated;

-- Uma vez por dia, às 9h de Brasília (12h UTC) — a mesma hora dos alertas do
-- Financeiro, para a equipe ter um horário só de "o sistema falou".
do $$
begin
  perform cron.schedule(
    'risarte-funnel-alerts', '0 12 * * *',
    'select empresarial.check_funnel_alerts_raw()'
  );
exception when others then null;
end;
$$;
