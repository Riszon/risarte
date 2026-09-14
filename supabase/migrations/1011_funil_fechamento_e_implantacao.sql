-- =============================================================================
-- 1011 — Risarte Empresarial: a conferência do fechamento e a implantação
-- -----------------------------------------------------------------------------
-- Bloco C3 do funil (ver docs/risarte-empresarial/FUNIL-COMERCIAL.md).
--
-- 1) A CONFERÊNCIA DO CONSULTOR (`lead_closing_reviews`). Ordem do dono: antes
--    de a empresa entrar em implantação, o consultor responsável confirma que
--    está tudo certo, registra as considerações e — o que mais importa — os
--    COMBINADOS ESPECÍFICOS feitos com a empresa.
--
--    ⚠️ O COMBINADO VIAJA PARA A EMPRESA, POR GATILHO. "Ficou combinado que os
--    dependentes entram só no segundo mês" é exatamente o tipo de acerto que se
--    perde: quem fez a venda não é quem vai atender, e o consultor sai de
--    férias. Copiar isso dentro do aplicativo dependeria de alguém lembrar; no
--    banco, não depende.
--
-- 2) A IMPLANTAÇÃO (`lead_implementation_steps`). Os cinco passos que o dono
--    descreveu: cadastrar os colaboradores, enviar as orientações, dar as boas
--    vindas, a apresentação para todos (que nem toda empresa pede) e o primeiro
--    agendamento pelo SDR.
--
--    Linha ESPARSA: só existe registro do que foi feito (ou do que não se
--    aplica). Semear cinco linhas por empresa encheria a tabela de "não feito",
--    que é a ausência de registro — e ausência não precisa de linha.
--
--    A lista de passos vive no CHECK e é espelhada no TypeScript, com teste que
--    lê esta migração: duas listas da mesma coisa divergem no dia em que
--    alguém mexe só numa.
--
-- ⚠️ O QUE ESTA MIGRAÇÃO **NÃO** CRIA: o upload da lista de colaboradores. Ele
--    JÁ EXISTE na tela da empresa (importação de Excel com planilha-modelo e
--    aba de dependentes) e cria o pré-cadastro que a fase pede. O que faltava
--    era o caminho do funil até ele, e o registro de que foi feito. Construir
--    um segundo importador criaria duas portas para a mesma coisa — e é assim
--    que as duas passam a divergir.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O combinado mora na empresa, para sempre
-- -----------------------------------------------------------------------------
alter table empresarial.companies
  add column if not exists special_agreements text;

comment on column empresarial.companies.special_agreements is
  'Combinados específicos feitos na venda que não podem ser esquecidos. '
  'Copiado da conferência do fechamento (empresarial.lead_closing_reviews) '
  'por gatilho — quem vendeu não é quem atende.';

-- -----------------------------------------------------------------------------
-- 2) A conferência do consultor
-- -----------------------------------------------------------------------------
create table if not exists empresarial.lead_closing_reviews (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique
    references empresarial.commercial_leads (id) on delete cascade,
  -- A confirmação é de UMA pessoa, com nome e hora: é ela que responde depois
  -- por "mas ninguém me falou desse combinado".
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  everything_ok boolean not null default true,
  considerations text,
  special_agreements text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists lead_closing_reviews_set_updated_at
  on empresarial.lead_closing_reviews;
create trigger lead_closing_reviews_set_updated_at
  before update on empresarial.lead_closing_reviews
  for each row execute function public.set_updated_at();

alter table empresarial.lead_closing_reviews enable row level security;

drop policy if exists lead_closing_reviews_select
  on empresarial.lead_closing_reviews;
create policy lead_closing_reviews_select
  on empresarial.lead_closing_reviews
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

drop policy if exists lead_closing_reviews_write
  on empresarial.lead_closing_reviews;
create policy lead_closing_reviews_write
  on empresarial.lead_closing_reviews
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete
  on empresarial.lead_closing_reviews to authenticated;
grant all on empresarial.lead_closing_reviews to service_role;

-- Confirmado o ganho → Implantação, e o combinado viaja junto ------------------
create or replace function empresarial.advance_lead_on_closing_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  fase text;
  empresa uuid;
begin
  select l.stage, l.company_id into fase, empresa
  from empresarial.commercial_leads l
  where l.id = new.lead_id;

  if fase is null then
    return new;
  end if;

  -- O COMBINADO VIAJA. Antes de mover, porque é ele que não pode se perder:
  -- se o avanço falhasse depois, o acerto já estaria guardado na empresa.
  if empresa is not null
     and new.special_agreements is not null
     and btrim(new.special_agreements) <> ''
  then
    update empresarial.companies
       set special_agreements = new.special_agreements
     where id = empresa;
  end if;

  -- Só avança quem está em Fechamento (ganho). Conferência de lead perdido ou
  -- de quem já está implantando não mexe na fase.
  if fase = 'CLOSED_WON' and new.everything_ok then
    update empresarial.commercial_leads
       set stage = 'IMPLEMENTATION'
     where id = new.lead_id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists lead_closing_reviews_advance
  on empresarial.lead_closing_reviews;
create trigger lead_closing_reviews_advance
  after insert or update on empresarial.lead_closing_reviews
  for each row execute function empresarial.advance_lead_on_closing_review();

-- -----------------------------------------------------------------------------
-- 3) Os passos da implantação
-- -----------------------------------------------------------------------------
create table if not exists empresarial.lead_implementation_steps (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null
    references empresarial.commercial_leads (id) on delete cascade,
  step varchar(30) not null
    check (step in (
      'IMPORT_EMPLOYEES',     -- cadastrar todos os colaboradores
      'GUIDELINES_SENT',      -- enviar as orientações
      'WELCOME',              -- dar as boas-vindas à empresa e à equipe
      'GROUP_PRESENTATION',   -- apresentação para todos (nem toda empresa pede)
      'FIRST_SCHEDULING'      -- SDR agenda a primeira consulta de cada um
    )),
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,
  -- "Não se aplica" é resposta legítima: a apresentação coletiva é pedida por
  -- algumas empresas, não por todas. Sem isto, a implantação nunca ficaria
  -- completa e o passo viraria ruído permanente.
  not_applicable boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, step)
);

create index if not exists lead_implementation_steps_lead_idx
  on empresarial.lead_implementation_steps (lead_id);

drop trigger if exists lead_implementation_steps_set_updated_at
  on empresarial.lead_implementation_steps;
create trigger lead_implementation_steps_set_updated_at
  before update on empresarial.lead_implementation_steps
  for each row execute function public.set_updated_at();

alter table empresarial.lead_implementation_steps enable row level security;

drop policy if exists lead_implementation_steps_select
  on empresarial.lead_implementation_steps;
create policy lead_implementation_steps_select
  on empresarial.lead_implementation_steps
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

drop policy if exists lead_implementation_steps_write
  on empresarial.lead_implementation_steps;
create policy lead_implementation_steps_write
  on empresarial.lead_implementation_steps
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete
  on empresarial.lead_implementation_steps to authenticated;
grant all on empresarial.lead_implementation_steps to service_role;
