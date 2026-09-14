-- =============================================================================
-- 1007 — Risarte Empresarial: as 8 fases do funil + o RELÓGIO de cada fase
-- -----------------------------------------------------------------------------
-- Três coisas, nesta ordem de importância:
--
-- 1) FASE NOVA `IMPLEMENTATION` (Implantação). O funil terminava no fechamento;
--    o cadastro dos colaboradores, as boas-vindas e os primeiros agendamentos
--    ficavam fora dele. Fechamento (ganho/perda) continua com os dois valores
--    que já existem — na tela viram UMA coluna com o resultado no cartão, e
--    nenhum registro precisa ser reescrito.
--
-- 2) O RELÓGIO (`commercial_lead_stage_history`). O sistema sabia em que fase a
--    empresa está, não desde quando. "Quanto tempo a empresa está em cada fase"
--    era pergunta sem resposta possível. Agora toda troca de fase é gravada
--    POR GATILHO — não depende de a tela lembrar de registrar, que é como esse
--    tipo de histórico envelhece.
--
--    ⚠️ O PASSADO NÃO EXISTE E NÃO SERÁ INVENTADO. Os leads que já estão no
--    banco ganham UMA linha aberta, marcada `is_initial`, começando no momento
--    desta migração. A tela diz "sem histórico anterior" em vez de mostrar um
--    tempo que ninguém mediu.
--
-- 3) ORIGEM DA CAPTAÇÃO (`capture_channel` + quem indicou). Lista fechada de
--    propósito: "indicação", "Indicação" e "indicacao" viram três canais
--    diferentes no relatório, e aí o painel deixa de responder de onde vêm os
--    clientes.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A fase nova
-- -----------------------------------------------------------------------------
alter table empresarial.commercial_leads
  drop constraint if exists commercial_leads_stage_check;

alter table empresarial.commercial_leads
  add constraint commercial_leads_stage_check
  check (stage in ('CAPTURE','CONTACT','MEETING_SCHEDULED','PRESENTED',
                   'PROPOSAL_SENT','FOLLOW_UP','CLOSED_WON','CLOSED_LOST',
                   'IMPLEMENTATION'));

-- -----------------------------------------------------------------------------
-- 2) De onde veio a empresa, e quem abre a porta
-- -----------------------------------------------------------------------------
alter table empresarial.commercial_leads
  add column if not exists capture_channel varchar(30),
  add column if not exists referral_name varchar(255),
  add column if not exists referral_contact varchar(255);

alter table empresarial.commercial_leads
  drop constraint if exists commercial_leads_capture_channel_check;

alter table empresarial.commercial_leads
  add constraint commercial_leads_capture_channel_check
  check (capture_channel is null or capture_channel in (
    'INDICACAO','PROSPECCAO','EVENTO','REDES_SOCIAIS',
    'SITE','PARCERIA','CLIENTE','OUTRO'
  ));

create index if not exists commercial_leads_channel_idx
  on empresarial.commercial_leads (capture_channel);

-- -----------------------------------------------------------------------------
-- 3) O relógio do funil
-- -----------------------------------------------------------------------------
create table if not exists empresarial.commercial_lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null
    references empresarial.commercial_leads (id) on delete cascade,
  stage varchar(30) not null,
  entered_at timestamptz not null default now(),
  left_at timestamptz,
  moved_by uuid references public.profiles (id) on delete set null,
  -- true = linha aberta pela migração (o lead já existia), não por um movimento
  -- real. É o que permite a tela dizer "sem histórico anterior" com honestidade.
  is_initial boolean not null default false
);

create index if not exists lead_stage_history_lead_idx
  on empresarial.commercial_lead_stage_history (lead_id, entered_at);

-- Uma fase aberta por lead. Sem isto, um gatilho que falhasse pela metade
-- deixaria duas linhas abertas e o tempo passaria a ser contado em dobro.
create unique index if not exists lead_stage_history_one_open_idx
  on empresarial.commercial_lead_stage_history (lead_id)
  where left_at is null;

-- Gatilho: fecha a fase anterior e abre a nova ------------------------------
-- `TG_OP` em vez de `old.stage`: ler OLD num INSERT levanta erro (lição da
-- 0218, quando a venda direta nascia pronta e o gatilho só ouvia UPDATE).
create or replace function empresarial.track_lead_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if TG_OP = 'INSERT' then
    insert into empresarial.commercial_lead_stage_history
      (lead_id, stage, moved_by)
    values (new.id, new.stage, (select auth.uid()));
    return new;
  end if;

  if new.stage is distinct from old.stage then
    update empresarial.commercial_lead_stage_history
       set left_at = now()
     where lead_id = new.id
       and left_at is null;

    insert into empresarial.commercial_lead_stage_history
      (lead_id, stage, moved_by)
    values (new.id, new.stage, (select auth.uid()));
  end if;

  return new;
end;
$fn$;

drop trigger if exists commercial_leads_track_stage on empresarial.commercial_leads;
create trigger commercial_leads_track_stage
  after insert or update of stage on empresarial.commercial_leads
  for each row execute function empresarial.track_lead_stage();

-- Os leads que já existem entram com o relógio zerado HOJE -------------------
insert into empresarial.commercial_lead_stage_history
  (lead_id, stage, entered_at, is_initial)
select l.id, l.stage, now(), true
from empresarial.commercial_leads l
where not exists (
  select 1
  from empresarial.commercial_lead_stage_history h
  where h.lead_id = l.id
);

-- RLS: quem enxerga o lead enxerga o histórico dele ---------------------------
alter table empresarial.commercial_lead_stage_history enable row level security;

drop policy if exists lead_stage_history_select
  on empresarial.commercial_lead_stage_history;
create policy lead_stage_history_select
  on empresarial.commercial_lead_stage_history
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

-- Escrita é só do gatilho (que roda como dono do banco). Ninguém reescreve o
-- relógio pela API: histórico que a tela pode editar não serve de prova.
grant select on empresarial.commercial_lead_stage_history to authenticated;
grant all on empresarial.commercial_lead_stage_history to service_role;
