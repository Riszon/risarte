-- =============================================================================
-- 1010 — Risarte Empresarial: apresentação, envio do pacote e os selos do
--        follow-up
-- -----------------------------------------------------------------------------
-- Bloco C2 do funil (ver docs/risarte-empresarial/FUNIL-COMERCIAL.md).
--
-- 1) APRESENTAÇÃO PADRÃO, PERSONALIZÁVEL (`presentation_templates`). Segue a
--    CASCATA do projeto: a linha com `lead_id` nulo é o padrão da REDE; a linha
--    com lead_id sobrescreve para aquela empresa. Mexer no padrão da rede
--    melhora a apresentação de todo mundo que ainda não personalizou; quem
--    personalizou fica com a sua.
--
--    O conteúdo é uma lista de blocos (`[{titulo, corpo}]`) em JSONB, e não
--    colunas fixas: a apresentação de um sindicato tem blocos diferentes da de
--    uma metalúrgica, e uma tabela com "bloco1..bloco8" envelheceria no dia em
--    que alguém precisasse do nono.
--
-- 2) O QUE FOI ENVIADO (`lead_dispatches`). A fase 5 é "mandar para a empresa";
--    o que fica dela é o REGISTRO do envio — o sistema não manda e-mail (nunca
--    mandou; quem manda é o ZapSign, e o WhatsApp é manual por decisão de
--    projeto). Guardar o que foi enviado, quando e por qual canal é o que
--    permite cobrar depois sem perguntar "será que mandaram?".
--
--    ⚠️ SÓ O ENVIO QUE INCLUI A PROPOSTA MOVE O CARTÃO para Follow-up. Mandar
--    só a apresentação é conversa, não negociação — e pular a fase por causa
--    disso faria o funil dizer que há uma proposta na mesa quando não há.
--
-- 3) OS DOIS SELOS DO FOLLOW-UP (`contract_signed_at`, `implantation_paid_at`).
--    Com os dois preenchidos o cartão vai sozinho para Fechamento (ganho) — é
--    a definição do dono: "só é ganho com contrato assinado E pagamento feito",
--    a mesma regra de ouro que o núcleo já impõe no banco.
--
--    A empresa NÃO é criada aqui: isso exige CNPJ válido e é ato do consultor.
--    O cartão em Fechamento oferece o botão.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A apresentação
-- -----------------------------------------------------------------------------
create table if not exists empresarial.presentation_templates (
  id uuid primary key default gen_random_uuid(),
  -- NULL = padrão da REDE. Mesma cascata de sla_settings e finance_settings.
  lead_id uuid references empresarial.commercial_leads (id) on delete cascade,
  title varchar(255) not null default 'Risarte Empresarial',
  subtitle varchar(255),
  -- [{ "titulo": "...", "corpo": "..." }]
  sections jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (lead_id)
);

drop trigger if exists presentation_templates_set_updated_at
  on empresarial.presentation_templates;
create trigger presentation_templates_set_updated_at
  before update on empresarial.presentation_templates
  for each row execute function public.set_updated_at();

-- O padrão da rede, com o conteúdo do programa. `on conflict do nothing` para
-- não sobrescrever o que o gestor já tiver ajustado ao rodar de novo.
insert into empresarial.presentation_templates (lead_id, title, subtitle, sections)
values (
  null,
  'Risarte Empresarial',
  'Saúde bucal como benefício para a sua equipe',
  '[
    {"titulo":"O que é o Risarte Empresarial",
     "corpo":"Um programa de saúde bucal para os colaboradores da sua empresa e seus dependentes, atendido na rede Risarte Odontologia. Não é um plano de reembolso: o atendimento acontece nas nossas unidades, com a nossa equipe."},
    {"titulo":"O que o colaborador ganha",
     "corpo":"Avaliação completa sem custo, procedimentos preventivos cobertos e desconto em todo o tratamento. O dependente entra nas mesmas condições."},
    {"titulo":"O que a empresa ganha",
     "corpo":"Um benefício de custo previsível, que a equipe usa de verdade. Dor de dente é uma das maiores causas de falta não planejada — e é a mais fácil de prevenir."},
    {"titulo":"Responsabilidade social",
     "corpo":"Parte do programa se converte em atendimento social. A empresa participa disso junto com a Risarte, e recebe o relatório do que foi gerado."},
    {"titulo":"Como funciona na prática",
     "corpo":"A empresa envia a lista de colaboradores, nós fazemos o pré-cadastro e a nossa equipe entra em contato com cada pessoa para agendar a primeira consulta. A empresa não precisa administrar nada."},
    {"titulo":"Investimento",
     "corpo":"Mensalidade por colaborador, com a empresa podendo pagar integral, parcial ou deixar por conta do colaborador. Há também a opção de valor fixo por empresa, usada por sindicatos e associações."}
  ]'::jsonb
)
on conflict (lead_id) do nothing;

alter table empresarial.presentation_templates enable row level security;

-- O padrão da REDE (lead_id nulo) é visível para quem enxerga o programa; a
-- personalizada segue o acesso ao lead.
drop policy if exists presentation_templates_select
  on empresarial.presentation_templates;
create policy presentation_templates_select
  on empresarial.presentation_templates
  for select to authenticated
  using (
    lead_id is null
    or empresarial.can_access_lead(lead_id)
  );

drop policy if exists presentation_templates_write
  on empresarial.presentation_templates;
create policy presentation_templates_write
  on empresarial.presentation_templates
  for all to authenticated
  using (
    case
      -- Mexer no PADRÃO DA REDE muda a apresentação de todo mundo: é ato de
      -- gestor do programa, não de qualquer consultor.
      when lead_id is null then empresarial.is_program_manager()
      else empresarial.can_access_lead(lead_id)
    end
  )
  with check (
    case
      when lead_id is null then empresarial.is_program_manager()
      else empresarial.can_access_lead(lead_id)
    end
  );

grant select, insert, update, delete
  on empresarial.presentation_templates to authenticated;
grant all on empresarial.presentation_templates to service_role;

-- -----------------------------------------------------------------------------
-- 2) O registro do envio
-- -----------------------------------------------------------------------------
create table if not exists empresarial.lead_dispatches (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null
    references empresarial.commercial_leads (id) on delete cascade,
  channel varchar(20) not null
    check (channel in ('WHATSAPP','EMAIL','IN_PERSON','OTHER')),
  -- PROPOSAL, CONTRACT, PRESENTATION, BOLETO, EXTRA — o que foi junto.
  items text[] not null default '{}',
  note text,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lead_dispatches_items_check check (cardinality(items) > 0)
);

create index if not exists lead_dispatches_lead_idx
  on empresarial.lead_dispatches (lead_id, sent_at desc);

alter table empresarial.lead_dispatches enable row level security;

drop policy if exists lead_dispatches_select on empresarial.lead_dispatches;
create policy lead_dispatches_select on empresarial.lead_dispatches
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));

drop policy if exists lead_dispatches_write on empresarial.lead_dispatches;
create policy lead_dispatches_write on empresarial.lead_dispatches
  for all to authenticated
  using (empresarial.can_access_lead(lead_id))
  with check (empresarial.can_access_lead(lead_id));

grant select, insert, update, delete on empresarial.lead_dispatches to authenticated;
grant all on empresarial.lead_dispatches to service_role;

-- Enviar a PROPOSTA move o cartão para Follow-up ------------------------------
create or replace function empresarial.advance_lead_on_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  fase text;
begin
  -- Mandar só a apresentação é conversa, não negociação.
  if not ('PROPOSAL' = any (new.items)) then
    return new;
  end if;

  select l.stage into fase
  from empresarial.commercial_leads l
  where l.id = new.lead_id;

  -- Nunca para trás: quem já está fechado não volta a negociar porque alguém
  -- registrou um envio antigo.
  if fase in ('CAPTURE','CONTACT','MEETING_SCHEDULED','PRESENTED','PROPOSAL_SENT') then
    update empresarial.commercial_leads
       set stage = 'FOLLOW_UP'
     where id = new.lead_id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists lead_dispatches_advance on empresarial.lead_dispatches;
create trigger lead_dispatches_advance
  after insert on empresarial.lead_dispatches
  for each row execute function empresarial.advance_lead_on_dispatch();

-- -----------------------------------------------------------------------------
-- 3) Os dois selos do follow-up
-- -----------------------------------------------------------------------------
alter table empresarial.commercial_leads
  add column if not exists contract_signed_at timestamptz,
  add column if not exists implantation_paid_at timestamptz;

comment on column empresarial.commercial_leads.contract_signed_at is
  'Quando o contrato foi assinado. Junto com implantation_paid_at, leva o '
  'cartão para Fechamento (ganho) — a regra de ouro do projeto: só é venda '
  'com documento assinado E pagamento confirmado.';

create or replace function empresarial.close_lead_when_sealed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Os DOIS selos. Um só não fecha nada: contrato assinado sem pagamento é
  -- promessa, e pagamento sem contrato é dinheiro sem amarração.
  if new.contract_signed_at is not null
     and new.implantation_paid_at is not null
     and new.stage in ('PROPOSAL_SENT','FOLLOW_UP')
  then
    new.stage := 'CLOSED_WON';
  end if;
  return new;
end;
$fn$;

-- BEFORE, e não AFTER: mudar `new.stage` aqui evita um segundo UPDATE (que
-- faria o relógio gravar duas linhas para a mesma passagem).
drop trigger if exists commercial_leads_close_when_sealed
  on empresarial.commercial_leads;
create trigger commercial_leads_close_when_sealed
  before update of contract_signed_at, implantation_paid_at
  on empresarial.commercial_leads
  for each row execute function empresarial.close_lead_when_sealed();

-- -----------------------------------------------------------------------------
-- 4) ⚠️ O RELÓGIO PRECISAVA OUVIR MAIS DO QUE ELE OUVIA
-- -----------------------------------------------------------------------------
-- O gatilho do relógio (1007) nasceu como `after update OF stage`. E
-- `UPDATE OF <coluna>` dispara pelas colunas que o COMANDO nomeia — não pelo
-- que um gatilho BEFORE mudou depois.
--
-- Resultado: `update ... set contract_signed_at = now()` mudava a fase para
-- CLOSED_WON pelo gatilho acima, e o relógio NÃO via. O lead ficava fechado
-- com o histórico ainda aberto em Follow-up — o tempo do fechamento seria
-- contado para sempre como tempo de negociação, e o painel mediria errado sem
-- nada na tela denunciando.
--
-- Achado ao PERGUNTAR AO BANCO se o relógio tinha registrado a passagem, não
-- ao ler o código: no arquivo, os dois gatilhos pareciam conversar.
--
-- A correção é tirar o `OF stage`. A guarda `is distinct from` que já existe
-- dentro da função é quem evita linha repetida — ela não dependia da cláusula.
drop trigger if exists commercial_leads_track_stage on empresarial.commercial_leads;
create trigger commercial_leads_track_stage
  after insert or update on empresarial.commercial_leads
  for each row execute function empresarial.track_lead_stage();
