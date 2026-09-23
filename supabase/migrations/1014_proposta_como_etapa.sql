-- =============================================================================
-- 1014 — A PROPOSTA VIRA ETAPA PRÓPRIA (relato OC-00083, 23/09/2026)
--
-- O dono, depois de ver a entrega anterior: "deve ter uma aba específica para
-- se tratar da proposta (configuração, personalização, detalhamento, carência,
-- prazo da proposta e etc). Agora a proposta está misturada com o levantamento
-- e ainda fica confuso."
--
-- Ele está certo, e a razão é de organização, não de tela: LEVANTAR e OFERECER
-- são dois atos diferentes. No levantamento se registra o que a empresa tem e
-- o que ela disse; na proposta se DECIDE o que oferecer. Estavam no mesmo
-- formulário, com um botão de salvar só.
--
-- Esta migração dá à proposta o que faltava para ela existir sozinha:
--
--   1) prazo de validade por proposta, com padrão da rede configurável;
--   2) a CARÊNCIA negociada, que hoje só nasce no cadastro da empresa — e por
--      isso era redigitada depois, podendo sair diferente do que foi vendido;
--   3) blocos de texto da proposta, com modelo da rede que a empresa herda.
--
-- Tudo idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O que a negociação decide e o levantamento não guardava
-- -----------------------------------------------------------------------------

-- ⚠️ TODAS ANULÁVEIS, e isso não é descuido. Nulo aqui significa "não foi
-- combinado nada diferente", e é o que faz o padrão da rede valer — a mesma
-- lição da 0230, em que colunas NOT NULL com default mataram uma cascata sem
-- ninguém perceber. Preenchido significa "esta empresa negociou assim".
alter table empresarial.lead_qualification
  add column if not exists proposal_valid_days int,
  add column if not exists company_grace_days int,
  add column if not exists employee_grace_days int;

comment on column empresarial.lead_qualification.proposal_valid_days is
  'Por quantos dias esta proposta vale. NULO = usa o padrão da rede '
  '(proposal_templates com lead_id nulo).';
comment on column empresarial.lead_qualification.company_grace_days is
  'Carência da EMPRESA, em dias, a partir do início do contrato. NULO = o que '
  'o cadastro da empresa definir. Viaja para companies.grace_period_days no '
  'fechamento — era redigitado, e podia sair diferente do que foi vendido.';
comment on column empresarial.lead_qualification.employee_grace_days is
  'Carência padrão do COLABORADOR, em dias, a partir da entrada dele. Mesma '
  'regra da coluna acima.';

-- Carência negativa é data no passado disfarçada de regra; prazo negativo é
-- proposta que nasce vencida. Nenhum dos dois é erro de digitação que a tela
-- deva deixar passar até alguém reparar no documento impresso.
do $$
begin
  alter table empresarial.lead_qualification
    add constraint lead_qualification_prazos_nao_negativos
    check (
      (proposal_valid_days is null or proposal_valid_days between 1 and 365)
      and (company_grace_days is null or company_grace_days between 0 and 3650)
      and (employee_grace_days is null or employee_grace_days between 0 and 3650)
    );
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2) O texto da proposta — modelo da rede, ajustável por empresa
-- -----------------------------------------------------------------------------
--
-- Mesma forma de `presentation_templates` (1010), de propósito: é a mesma
-- pergunta ("qual texto vai neste documento?") e inventar um segundo formato
-- faria as duas telas divergirem no dia em que alguém mexesse numa só.
--
-- `valid_days` mora na LINHA DA REDE. A linha da empresa existe para o texto;
-- o prazo dela fica em `lead_qualification` porque é dado da negociação, junto
-- com carência e valores — e é lá que o documento vai buscar.

create table if not exists empresarial.proposal_templates (
  id uuid primary key default gen_random_uuid(),
  -- NULL = padrão da REDE.
  lead_id uuid references empresarial.commercial_leads (id) on delete cascade,
  -- [{ "titulo": "...", "corpo": "..." }]
  sections jsonb not null default '[]'::jsonb,
  -- Só a linha da rede usa: o prazo padrão de validade das propostas.
  valid_days int not null default 15 check (valid_days between 1 and 365),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (lead_id)
);

drop trigger if exists proposal_templates_set_updated_at
  on empresarial.proposal_templates;
create trigger proposal_templates_set_updated_at
  before update on empresarial.proposal_templates
  for each row execute function public.set_updated_at();

-- O modelo da rede. `on conflict do nothing` para não sobrescrever o que o
-- gestor já tiver ajustado, ao rodar de novo.
--
-- ⚠️ O TEXTO NÃO REPETE OS NÚMEROS. Valores, quem paga e carência são
-- calculados e impressos pelo documento; escrevê-los aqui criaria uma segunda
-- verdade que envelhece sozinha — o texto diria R$ 30,00 e o quadro ao lado,
-- R$ 35,00, e ninguém saberia qual vale.
insert into empresarial.proposal_templates (lead_id, sections, valid_days)
values (
  null,
  '[
    {"titulo":"O que está incluído",
     "corpo":"Avaliação clínica completa e plano de tratamento para cada colaborador e dependente, procedimentos preventivos cobertos pelo programa e desconto em todo o tratamento realizado na rede Risarte Odontologia."},
    {"titulo":"Como o colaborador é atendido",
     "corpo":"O atendimento acontece nas unidades Risarte, com a nossa equipe. Não é reembolso: a pessoa agenda, é atendida e o programa já está aplicado no orçamento dela."},
    {"titulo":"Como começa",
     "corpo":"A empresa envia a lista de colaboradores, nós fazemos o pré-cadastro e entramos em contato com cada pessoa para agendar a primeira consulta. A empresa não precisa administrar nada."},
    {"titulo":"Acompanhamento",
     "corpo":"A empresa recebe relatórios de uso do programa e da economia gerada para a equipe, além do relatório do atendimento social do qual participa."}
  ]'::jsonb,
  15
)
on conflict (lead_id) do nothing;

alter table empresarial.proposal_templates enable row level security;

-- O padrão da REDE (lead_id nulo) é visível para quem enxerga o programa; a
-- personalizada segue o acesso ao lead. Mesma regra da apresentação.
drop policy if exists proposal_templates_select
  on empresarial.proposal_templates;
create policy proposal_templates_select
  on empresarial.proposal_templates
  for select to authenticated
  using (
    lead_id is null
    or empresarial.can_access_lead(lead_id)
  );

drop policy if exists proposal_templates_write
  on empresarial.proposal_templates;
create policy proposal_templates_write
  on empresarial.proposal_templates
  for all to authenticated
  using (
    case
      -- Mexer no PADRÃO DA REDE muda a proposta de todo mundo: é ato de gestor
      -- do programa, não de qualquer consultor.
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
  on empresarial.proposal_templates to authenticated;
grant all on empresarial.proposal_templates to service_role;
