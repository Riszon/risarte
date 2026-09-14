-- =============================================================================
-- 1008 — Risarte Empresarial: tentativas de contato + agenda própria do programa
-- -----------------------------------------------------------------------------
-- Bloco B do funil comercial (ver docs/risarte-empresarial/FUNIL-COMERCIAL.md).
--
-- 1) TENTATIVAS DE CONTATO (`lead_contact_attempts`). A fase 2 é "tentando
--    falar com a empresa" — e o que importa ali é o que já foi tentado: por
--    onde, quando, e no que deu. Canal e resultado são LISTAS FECHADAS de
--    propósito: em texto livre ninguém consegue contar quantas ligações foram
--    precisas até marcar a reunião, que é o número que diz se a abordagem
--    funciona.
--
--    Por que tabela nova e não a linha do tempo que já existe: a linha do tempo
--    (`commercial_lead_activities`) é anotação livre, para a pessoa ler. Esta
--    é registro estruturado, para a máquina contar. São perguntas diferentes.
--
-- 2) AGENDA DO PROGRAMA (`lead_meetings`). Com os status do comercial, e o
--    encadeamento do remarcado (a reunião nova aponta para a que ela substitui
--    — é isso que revela a empresa que já adiou três vezes).
--
-- 3) O CARTÃO ANDA SOZINHO, E QUEM MANDA É O BANCO. Marcar a reunião leva o
--    lead para "Reunião agendada"; dar a reunião por REALIZADA leva para
--    "Apresentado" — ordem do dono. Fica em gatilho, não na tela: regra de
--    negócio que importa mora no banco, senão ela vale só no caminho que
--    alguém lembrou de cobrir.
--
--    ⚠️ O CARTÃO NUNCA ANDA PARA TRÁS. Marcar como realizada uma reunião
--    antiga de uma empresa que já está em Follow-up NÃO a devolve para
--    Apresentado — seria o sistema desfazendo trabalho feito.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Tentativas de contato
-- -----------------------------------------------------------------------------
create table if not exists empresarial.lead_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null
    references empresarial.commercial_leads (id) on delete cascade,
  channel varchar(20) not null
    check (channel in ('CALL','WHATSAPP','EMAIL','IN_PERSON')),
  outcome varchar(30) not null
    check (outcome in ('NO_ANSWER','ANSWERED','WRONG_CONTACT',
                       'CALLBACK_REQUESTED','NOT_INTERESTED','MEETING_SCHEDULED')),
  note text,
  attempted_at timestamptz not null default now(),
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_contact_attempts_lead_idx
  on empresarial.lead_contact_attempts (lead_id, attempted_at desc);

alter table empresarial.lead_contact_attempts enable row level security;

drop policy if exists lead_contact_attempts_select
  on empresarial.lead_contact_attempts;
create policy lead_contact_attempts_select
  on empresarial.lead_contact_attempts
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

drop policy if exists lead_contact_attempts_write
  on empresarial.lead_contact_attempts;
create policy lead_contact_attempts_write
  on empresarial.lead_contact_attempts
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete
  on empresarial.lead_contact_attempts to authenticated;
grant all on empresarial.lead_contact_attempts to service_role;

-- -----------------------------------------------------------------------------
-- 2) Agenda do programa
-- -----------------------------------------------------------------------------
create table if not exists empresarial.lead_meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null
    references empresarial.commercial_leads (id) on delete cascade,
  title varchar(255),
  mode varchar(20) not null default 'ONLINE'
    check (mode in ('ONLINE','IN_PERSON','PHONE')),
  -- Endereço quando presencial, link da chamada quando online.
  location varchar(500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status varchar(20) not null default 'SCHEDULED'
    check (status in ('SCHEDULED','CONFIRMED','DONE','RESCHEDULED',
                      'CANCELLED','NO_SHOW')),
  -- Motivo do cancelamento, da remarcação, do não comparecimento.
  status_note text,
  -- A reunião que esta substitui. Uma empresa que adiou três vezes vira uma
  -- corrente de três elos — e é essa corrente que o consultor precisa ver.
  rescheduled_from uuid
    references empresarial.lead_meetings (id) on delete set null,
  owner_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_meetings_period_check check (ends_at > starts_at)
);

create index if not exists lead_meetings_lead_idx
  on empresarial.lead_meetings (lead_id, starts_at desc);
create index if not exists lead_meetings_calendar_idx
  on empresarial.lead_meetings (starts_at);

drop trigger if exists lead_meetings_set_updated_at on empresarial.lead_meetings;
create trigger lead_meetings_set_updated_at
  before update on empresarial.lead_meetings
  for each row execute function public.set_updated_at();

alter table empresarial.lead_meetings enable row level security;

drop policy if exists lead_meetings_select on empresarial.lead_meetings;
create policy lead_meetings_select on empresarial.lead_meetings
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

drop policy if exists lead_meetings_write on empresarial.lead_meetings;
create policy lead_meetings_write on empresarial.lead_meetings
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete on empresarial.lead_meetings to authenticated;
grant all on empresarial.lead_meetings to service_role;

-- -----------------------------------------------------------------------------
-- 3) O cartão anda sozinho — e nunca para trás
-- -----------------------------------------------------------------------------
-- `TG_OP` em vez de ler OLD: há reunião que nasce já REALIZADA (alguém
-- registrando depois do fato), e um gatilho que só ouvisse UPDATE a deixaria
-- passar. É a lição da 0218, onde a venda direta nascia pronta.
create or replace function empresarial.advance_lead_on_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  fase text;
begin
  select l.stage into fase
  from empresarial.commercial_leads l
  where l.id = new.lead_id;

  if fase is null then
    return new;
  end if;

  if new.status = 'DONE' then
    -- Reunião realizada → Apresentado. Só avança quem ainda não passou dali:
    -- registrar hoje uma reunião antiga não pode puxar de volta uma empresa
    -- que já está negociando a proposta.
    if fase in ('CAPTURE', 'CONTACT', 'MEETING_SCHEDULED') then
      update empresarial.commercial_leads
         set stage = 'PRESENTED'
       where id = new.lead_id;
    end if;
  elsif new.status in ('SCHEDULED', 'CONFIRMED') then
    -- Conseguiu marcar → Reunião agendada.
    if fase in ('CAPTURE', 'CONTACT') then
      update empresarial.commercial_leads
         set stage = 'MEETING_SCHEDULED'
       where id = new.lead_id;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists lead_meetings_advance on empresarial.lead_meetings;
create trigger lead_meetings_advance
  after insert or update of status on empresarial.lead_meetings
  for each row execute function empresarial.advance_lead_on_meeting();
