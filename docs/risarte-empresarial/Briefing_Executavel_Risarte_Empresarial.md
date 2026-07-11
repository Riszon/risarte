# Briefing Executável — Módulo Risarte Empresarial (integrado ao riSZon)

**Versão corrigida · 08 de julho de 2026**
Documento para desenvolvimento via Claude Code. Prosa em português; identificadores de código (tabelas, colunas, enums) em inglês, seguindo o padrão do projeto.

---

## 0. Como usar este documento

**Para o Jeferson (dono do projeto):**
- Este é o documento que você cola no Claude Code como contexto inicial do módulo.
- Desenvolva **uma fase de cada vez** (Seção 9). Ao terminar cada fase, você consegue testar algo real antes de seguir.
- Ao final de cada sessão, peça ao Claude Code para atualizar o `ESTADO_DO_PROJETO.md` e faça o commit no GitHub (backup fora da máquina).
- Quando a conversa do Claude Code ficar longa, use `/compact` para não perder o fio.

**Para o Claude Code (instrução técnica):**
- O módulo Empresarial é **parte do sistema riSZon existente**, no **mesmo repositório** e no **mesmo projeto Supabase**. Não criar infraestrutura separada (nada de AWS, RabbitMQ ou Redis).
- Stack fixa: **Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · Supabase · Vercel**.
- As tabelas do módulo ficam no schema `empresarial` (mesmo padrão do schema `treinamento` usado pela Academy).
- FKs para o riSZon já fechadas: `public.clients(id)` e `public.procedures(id)` (ambas `uuid`). Não recriar como placeholder.

---

## 1. Contexto e decisões confirmadas

O Risarte Empresarial é uma camada **comercial e de gestão B2B** que conecta empresas parceiras à rede Risarte. O colaborador cadastrado no programa **torna-se um cliente do riSZon**, agenda avaliação e faz tratamento em uma unidade franqueada com benefícios do programa. O módulo **não** faz atendimento clínico — isso continua sendo o riSZon.

**Decisões confirmadas (críticas):**

| ID | Decisão |
|----|---------|
| D1 | Módulo construído **dentro do riSZon** (mesmo repo e mesmo Supabase), schema `empresarial`. Sem AWS/filas. |
| D2 | Sem sincronização assíncrona interna: colaborador e cliente vivem no mesmo banco. Webhooks só para serviços externos (ASAAS, ZapSign). |
| D3 | **Split de pagamento** (padrão, configurável por empresa): 1º pagamento (adesão + implantação) = **100% RisLife**; mensalidades seguintes = **50% Risarte / 50% RisLife**. |
| D4 | Tabela de preços/benefícios: **um padrão global** + **override por empresa**. Regionalização por unidade fica para o roadmap. |
| D5 | Saída de colaborador: **bloqueio imediato** para novos orçamentos/agendamentos; **tratamentos já aprovados mantêm o benefício** até concluir. |
| D6 | Retenção de dados: **5 anos** (fiscal/legal), depois anonimização automática (LGPD). |
| D7 | Funil comercial e agenda do consultor: **construídos nativos** dentro do módulo (sem Trello/Notion externos). |

---

## 2. Arquitetura (corrigida)

```
┌───────────────────────────┐        ┌───────────────────────────┐
│  Módulo Risarte Empresarial│◄──────►│  riSZon — Jornada Cliente │
│  (comercial e gestão B2B) │  mesmo │  (clínico e prontuário)   │
└───────────────────────────┘  banco └───────────────────────────┘
              │                              │
              └──────────────┬───────────────┘
                             ▼
              ┌───────────────────────────────┐
              │  Supabase — um único banco     │
              │  schemas: empresarial · public │
              │  (riSZon) · treinamento (Academy)│
              └───────────────────────────────┘
```

- **Frontend:** rotas do módulo dentro do app riSZon (ex.: grupo de rotas `/empresarial`).
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions). As Edge Functions recebem os webhooks do ASAAS e do ZapSign.
- **Segurança:** Row Level Security (RLS) por papel e por unidade (ver Seção 6).

---

## 3. Integração com o riSZon (colaborador = cliente)

1. **Pré-cadastro** no módulo Empresarial: nome completo, CPF e telefone do colaborador; dependentes com CPF, telefone e grau de parentesco.
2. Quando a empresa fica **Ativa**, a SDR completa o cadastro. Nesse momento:
   - Se o CPF **já existe** como cliente no riSZon → puxar o cadastro e vincular ao programa (`employees.client_id`), **copiando também `clients.clinic_id` para `employees.clinic_id`** (essencial para a RLS por unidade — Seção 6).
   - Se **não existe** → criar o cliente no riSZon (já com sua `clinic_id`) e vincular do mesmo modo.
3. Na lista de clientes/prontuários do riSZon, o cliente aparece com **selo "Risarte Empresarial"** e o vínculo titular ↔ dependentes.
4. O cliente entra na **Jornada do Cliente normal** do riSZon.
5. No **orçamento** do plano de tratamento, exibir dois valores: **valor cheio** × **valor com benefício do programa** (mostrando a economia).
6. Na **saída** do programa: remover o selo, manter `membership_history` (empresa e período) e **preservar as negociações já aprovadas**.

---

## 4. Modelo de dados (DDL)

> Identificadores em inglês. FKs para o riSZon já mapeadas: `public.clients(id)` e `public.procedures(id)`.

```sql
CREATE SCHEMA IF NOT EXISTS empresarial;

-- Empresas parceiras
CREATE TABLE empresarial.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj VARCHAR(14) UNIQUE NOT NULL,
  legal_name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),
  state_registration VARCHAR(20),
  address JSONB,
  employee_count INT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | SUSPENDED | TERMINATED  (UI: Ativa/Suspensa/Encerrada)
  payment_model VARCHAR(20) NOT NULL,             -- COMPANY_PAYS | COMPANY_PARTIAL | EMPLOYEE_PAYS
  company_subsidy_type VARCHAR(10),               -- PERCENT | AMOUNT  (quando COMPANY_PARTIAL)
  company_subsidy_value DECIMAL(12,2),
  due_day INT DEFAULT 5,
  assigned_consultant_id UUID,                    -- Consultor Comercial (RisLife)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Colaboradores (titulares)
CREATE TABLE empresarial.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES empresarial.companies(id),
  client_id UUID REFERENCES public.clients(id),
  clinic_id UUID,                                 -- espelha public.clients.clinic_id; preencher ao vincular o cliente (necessário para RLS por unidade)
  cpf VARCHAR(11) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | INACTIVE
  registration_stage VARCHAR(20) DEFAULT 'PRE_REGISTERED', -- PRE_REGISTERED | COMPLETED
  dependent_plan VARCHAR(20) DEFAULT 'NONE',      -- NONE | INDIVIDUAL | FAMILY | FAMILY_EXTRA
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  left_reason VARCHAR(50),                        -- RESIGNED | DISMISSED | COMPANY_TERMINATED | VOLUNTARY
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dependentes
CREATE TABLE empresarial.dependents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES empresarial.employees(id),
  client_id UUID REFERENCES public.clients(id),
  clinic_id UUID,                                 -- espelha public.clients.clinic_id (RLS por unidade)
  cpf VARCHAR(11) UNIQUE NOT NULL,
  full_name VARCHAR(255),
  phone VARCHAR(20),
  relationship VARCHAR(30) NOT NULL,              -- SPOUSE | CHILD | PARENT | OTHER
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Preços de adesão (company_id NULL = padrão global)
CREATE TABLE empresarial.adhesion_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES empresarial.companies(id),
  holder_fee DECIMAL(12,2) NOT NULL DEFAULT 39.90,
  dependent_individual_fee DECIMAL(12,2) NOT NULL DEFAULT 39.90,
  dependent_family_fee DECIMAL(12,2) NOT NULL DEFAULT 59.90,
  dependent_family_extra_fee DECIMAL(12,2) NOT NULL DEFAULT 19.90,
  max_installments INT NOT NULL DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Regras de split (company_id NULL = padrão global)
CREATE TABLE empresarial.split_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES empresarial.companies(id),
  first_payment_risarte_pct DECIMAL(5,2) NOT NULL DEFAULT 0,    -- adesão + implantação
  first_payment_rislife_pct DECIMAL(5,2) NOT NULL DEFAULT 100,
  recurring_risarte_pct DECIMAL(5,2) NOT NULL DEFAULT 50,       -- mensalidades
  recurring_rislife_pct DECIMAL(5,2) NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Faturamento de adesão
CREATE TABLE empresarial.adhesion_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES empresarial.companies(id),
  billing_type VARCHAR(20) NOT NULL,              -- IMPLANTATION | MONTHLY
  reference_month DATE,
  asaas_billing_id VARCHAR(100),
  total_amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING | PAID | OVERDUE
  due_date DATE,
  paid_at TIMESTAMPTZ,
  split_risarte DECIMAL(12,2),
  split_rislife DECIMAL(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Benefícios clínicos por procedimento (company_id NULL = padrão global)
CREATE TABLE empresarial.procedure_benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES empresarial.companies(id),
  procedure_id UUID NOT NULL REFERENCES public.procedures(id), -- catálogo de rede; preço/protocolo por unidade tratado no próprio riSZon
  benefit_type VARCHAR(20) NOT NULL,              -- DISCOUNT_PERCENT | DISCOUNT_AMOUNT | FREE
  benefit_value DECIMAL(12,2),
  max_installments INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Histórico de vínculo com o programa (mantido após a saída)
CREATE TABLE empresarial.membership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id),
  clinic_id UUID,                                 -- espelha public.clients.clinic_id (RLS por unidade)
  company_id UUID REFERENCES empresarial.companies(id),
  member_role VARCHAR(20) NOT NULL,               -- HOLDER | DEPENDENT
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Riso+ Social
CREATE TABLE empresarial.social_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES empresarial.companies(id),
  trigger_type VARCHAR(30) NOT NULL,              -- EMPLOYEE_COUNT | TIME_IN_PROGRAM | ATTENDANCE | TREATMENT_SPEND
  is_pool BOOLEAN DEFAULT FALSE,                  -- TRUE = ação coletiva (empresa paga parcial)
  status VARCHAR(20) DEFAULT 'AVAILABLE',         -- AVAILABLE | ASSIGNED | USED
  beneficiary_client_id UUID REFERENCES public.clients(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Funil comercial (leads de empresas)
CREATE TABLE empresarial.commercial_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(14),
  contact_name VARCHAR(255),
  contact_phone VARCHAR(20),
  stage VARCHAR(30) NOT NULL DEFAULT 'CAPTURE',   -- CAPTURE | CONTACT | MEETING_SCHEDULED | PRESENTED | PROPOSAL_SENT | FOLLOW_UP | CLOSED_WON | CLOSED_LOST
  consultant_id UUID,
  lost_reason VARCHAR(255),
  company_id UUID REFERENCES empresarial.companies(id),  -- preenchido quando CLOSED_WON
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Regras de negócio

### 5.1 Cálculo da mensalidade da empresa
Para cada colaborador ativo, soma-se a adesão do titular + o custo do plano de dependentes escolhido:

| Item | Valor padrão | Regra |
|------|-------------|-------|
| Titular | R$ 39,90 | por colaborador ativo |
| Dependente Individual | R$ 39,90 | quando há **apenas 1** dependente |
| Dependente Familiar | R$ 59,90 | de 1 a 3 dependentes (valor fixo) |
| Dependente Familiar Extra | R$ 19,90 | cada dependente **além** dos 3 (só libera com a Familiar cheia) |

`total = Σ (holder_fee + custo_do_plano_de_dependentes)` para todos os colaboradores ativos. Valores vêm de `adhesion_pricing` (override por empresa, senão padrão global).

### 5.2 Split de pagamento (D3)
- **Primeiro pagamento** (`billing_type = IMPLANTATION`): aplica `first_payment_*` (padrão 0% Risarte / 100% RisLife).
- **Mensalidades** (`billing_type = MONTHLY`): aplica `recurring_*` (padrão 50% / 50%).
- Valores calculados no momento da **liquidação** (confirmação de pagamento pelo ASAAS) e gravados em `split_risarte` / `split_rislife`.
- Regra de origem: `split_rules` da empresa; se ausente, o registro global (`company_id NULL`).

### 5.3 Status da empresa e efeito nos colaboradores

| UI | Código | Quando | Efeito |
|----|--------|--------|--------|
| Ativa | `ACTIVE` | tudo em dia | benefícios liberados |
| Suspensa | `SUSPENDED` | pendência cadastral **ou** atraso de pagamento > 5 dias corridos (configurável) | benefícios suspensos; alerta à unidade; colaborador notificado |
| Encerrada | `TERMINATED` | contrato encerrado | perde o selo; vira cliente normal; mantém `membership_history` |

### 5.4 Bloqueio por inadimplência
Se `adhesion_billing.status = OVERDUE` por mais de 5 dias corridos → empresa passa a `SUSPENDED` e o riSZon bloqueia **novos** orçamentos/agendamentos para todos os CPFs vinculados. Tratamentos já aprovados seguem (D5).

### 5.5 Saída de colaborador / titular
- Colaborador sai (pedido, demissão, desligamento ou fim da parceria): status `INACTIVE`, bloqueio imediato para novos tratamentos, benefícios aprovados mantidos.
- **Titular sai → todos os seus dependentes saem.** Notificar cada dependente e a unidade onde estão cadastrados.
- Após a saída, na ficha do cliente liberar editar/excluir dependentes.

### 5.6 Riso+ Social

| Modelo de pagamento da empresa | Participa? | Como |
|--------------------------------|-----------|------|
| `COMPANY_PAYS` (integral) | Sim | indica **1 beneficiário próprio** para tratamento completo |
| `COMPANY_PARTIAL` (parcial) | Sim | entra no **pool coletivo** (`is_pool = TRUE`) com outras empresas |
| `EMPLOYEE_PAYS` (só colaboradores) | Não | — |

Gatilhos configuráveis (`trigger_type`): quantidade de colaboradores ativos, tempo no programa, % de comparecimento a avaliações/reavaliações, montante gasto em tratamento no período. Somente empresas `ACTIVE` participam.

---

## 6. Papéis e permissões (RBAC + RLS)

Aproveitar o RBAC já existente no riSZon. Adicionar/mapear:

| Papel | Acesso no módulo Empresarial |
|-------|------------------------------|
| Admin Master | tudo; consolidado e por unidade |
| Franqueadora | gestão do programa, dashboards, metas |
| Gerente de Unidade | dados e relatórios **da própria unidade** |
| SDR | completar cadastro de colaboradores e agendar avaliação |
| **Consultor Comercial Empresarial (RisLife)** | **novo papel**: funil, propostas, contratos, agenda e empresas que gerencia. **Sem acesso a dados clínicos/tratamentos** dos pacientes (LGPD) |

Aplicar **RLS** no schema `empresarial`: unidade enxerga só o que é seu; consultor RisLife enxerga só o comercial; Admin Master enxerga tudo.

**Nota multi-tenant:** `public.clients` e `public.procedures` são multi-tenant por `clinic_id` (procedimentos: catálogo de rede, com preço/protocolo por unidade tratado no próprio riSZon). Por isso `employees`, `dependents` e `membership_history` carregam uma cópia de `clinic_id` (preenchida no momento em que o colaborador/dependente é vinculado ao cliente) — é essa coluna que a política de RLS usa para restringir o "Gerente de Unidade" aos próprios dados, sem precisar de join constante com `public.clients` a cada consulta.

---

## 7. Integrações externas

| Serviço | Uso | Como |
|---------|-----|------|
| **ASAAS** | cobrança recorrente da adesão + split | API para criar cliente/assinatura; **Edge Function** recebe webhook de pagamento e grava split |
| **ZapSign** | assinatura digital dos contratos | emissão, envio e retorno de assinatura via webhook |
| **Gamma** | proposta comercial em apresentação (PPT) | gerar a partir dos dados da empresa; PDF para envio, PPT para apresentação |

Parcelamento no boleto: até **24×** (padrão), configurável por caso.

---

## 8. LGPD e retenção
- Dados sensíveis de saúde permanecem no riSZon com as regras já definidas.
- Retenção de dados do programa: **5 anos**; depois, anonimização automática.
- Consentimento e finalidade registrados; consultor RisLife nunca acessa dados clínicos.

---

## 9. Plano de implementação por fases

Cada fase termina com algo testável. Sugestão: rodar uma **empresa-piloto real** já a partir da Fase 4, usando contrato manual, e automatizar o resto depois.

### Fase 0 — Preparação
- Criar schema `empresarial` e rodar o DDL (Seção 4) — FKs para `public.clients` e `public.procedures` já fechadas.
- Atualizar `CLAUDE.md` e `ESTADO_DO_PROJETO.md` com o contexto do módulo.
- **Testável:** banco criado, migrações aplicadas, projeto reconhece o módulo.

### Fase 1 — Cadastros
- CRUD de empresas, colaboradores e dependentes.
- Vínculo titular ↔ dependentes; puxar cliente existente pelo CPF.
- Selo "Risarte Empresarial" no prontuário/lista do riSZon.
- **Testável:** cadastrar empresa-piloto e ver o colaborador virar cliente com selo.

### Fase 2 — Benefícios e preços
- Telas de `adhesion_pricing`, `split_rules` e `procedure_benefits` (padrão global + override por empresa).
- Função de cálculo da mensalidade (Seção 5.1).
- **Testável:** configurar uma empresa e ver a mensalidade correta.

### Fase 3 — Orçamento com benefício
- No orçamento do riSZon, exibir valor cheio × valor com programa.
- **Testável:** gerar orçamento e o cliente enxergar a economia.

### Fase 4 — Financeiro (ASAAS)
- Cobrança recorrente + tipos IMPLANTATION/MONTHLY.
- Edge Function de webhook: liquidação → calcula e grava split (Seção 5.2).
- Regra de bloqueio por inadimplência (Seção 5.4).
- **Testável:** emitir boleto (sandbox), pagar e ver o split; simular atraso e ver a suspensão.

### Fase 5 — Contratos e propostas
- ZapSign (emissão, envio, retorno).
- Geração de proposta comercial (PDF + PPT via Gamma).
- **Testável:** enviar contrato para assinar e gerar uma proposta.

### Fase 6 — Comercial
- Funil (kanban) nativo com as etapas de `commercial_leads`; leads perdidos agrupados.
- Agenda do consultor; papel RisLife com RLS.
- **Testável:** consultor mover um lead do topo ao fechamento; ao fechar, gerar a empresa.

### Fase 7 — Dashboards e relatórios
- Painéis por empresa, unidade e consolidado; filtros por período/empresa/unidade.
- Relatórios (empresa, unidade, cliente); metas; NPS.
- **Testável:** ver os números do programa e gerar relatório para a empresa.

### Fase 8 — Riso+ Social e LGPD
- `social_tokens` com gatilhos configuráveis; regra integral/parcial/nenhum.
- Retenção de 5 anos + anonimização.
- **Testável:** gerar um token social e rodar a rotina de retenção.

---

## 10. Checklist pré-implementação
- [x] Nomes reais das tabelas confirmados: `public.clients` (id uuid) e `public.procedures` (id uuid), ambas multi-tenant por `clinic_id`.
- [ ] Chaves de API sandbox: ASAAS e ZapSign.
- [ ] Templates de contrato aprovados.
- [ ] `CLAUDE.md` e `ESTADO_DO_PROJETO.md` atualizados com o contexto do módulo.
- [ ] Repositório com backup no GitHub.

---

## 11. Glossário rápido
- **Schema:** um "cômodo" dentro do mesmo banco de dados, para organizar tabelas.
- **RLS (Row Level Security):** trava que faz cada usuário enxergar apenas as linhas que pode ver.
- **Edge Function:** pequeno programa no Supabase que recebe avisos de fora (ex.: "pagou o boleto").
- **Split:** divisão automática de um pagamento entre Risarte e RisLife.
- **Webhook:** aviso automático que um sistema externo envia ao seu sistema quando algo acontece.
