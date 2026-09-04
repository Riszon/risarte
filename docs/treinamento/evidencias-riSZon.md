# Evidências — análise do riSZon

Relatório de rastreabilidade do
[`manual-treinamento-riSZon.md`](manual-treinamento-riSZon.md). Cada afirmação
do manual nasce de um destes itens.

**Método.** Duas frentes: (a) **extração automática** do código — rotas,
itens de menu, condições de acesso, mensagens de tela e ações de servidor,
gravadas em
[`inventario-funcionalidades-riSZon.json`](inventario-funcionalidades-riSZon.json);
(b) **leitura dirigida** dos arquivos de permissão, do layout e da documentação
do repositório.

**Escopo analisado.** `src/app/`, `src/lib/`, `src/components/`,
`supabase/migrations/`, `e2e/`, `CLAUDE.md`, `AGENTS.md`,
`docs/ARQUITETURA-TECNICA.md`, `.env.example`, `package.json`.

**Não analisado (e por quê).** A aplicação **em execução** — logo, nenhuma
posição visual foi confirmada. O conteúdo das 245 migrações foi consultado
pelos resumos do `CLAUDE.md` e por buscas dirigidas, não linha a linha.

**Níveis de confiança usados:** ✅ confirmado · ⚠️ parcialmente confirmado ·
❔ não identificado.

---

## Índice de evidências

### [EV-001] As 7 fases da jornada ✅

- **Arquivo:** `CLAUDE.md`, seção 3 "Arquitetura — a Jornada do Cliente".
- **Também em:** `supabase/migrations/` (tabela `journey_phase_history`,
  função `move_client_phase`).
- **Conclusão:** as sete fases, quem age em cada uma e a regra de que quem move
  depende da função. A matriz de movimentação está em `docs/JORNADA.md`.

### [EV-002] Inventário de rotas ✅

- **Extração:** todos os `src/app/(app)/**/page.tsx`.
- **Resultado:** **82 rotas**.
- **Conclusão:** é a lista completa de telas do sistema. Para cada uma, o
  inventário JSON registra também as guardas encontradas no arquivo
  (`requireAdminMaster`, `hasRoleInClinic`, `notFound`, `redirect`, `canView*`).
- **Limite:** a presença de uma guarda no arquivo **não** prova qual papel
  passa por ela — só que existe verificação.

### [EV-003] Itens de menu ✅

- **Arquivo:** `src/components/app-sidebar.tsx`.
- **Resultado:** **28 itens**, com `href` e `label` exatos.
- **Conclusão:** são os rótulos que o usuário vê. O bloco de Administração está
  dentro de `{isAdminMaster && (…)}`.

### [EV-004] Os 15 papéis + Admin Master ✅

- **Arquivo:** `src/lib/roles.ts`, linhas 3–39.
- **Conclusão:** `USER_ROLES` lista 15 papéis; `ROLE_LABELS` dá o nome em
  português de cada um. O Admin Master **não** está nessa lista — é
  `profiles.is_admin_master`, uma marca global (comentário na linha 51).

### [EV-005] Papel pertence a um ambiente ✅

- **Arquivo:** `src/lib/roles.ts`, linhas 52–96.
- **Conclusão:** `FRANCHISOR_ROLES` (8) e `UNIT_ROLES` (7) são disjuntos;
  `isRoleAllowedForClinicType` impede atribuição cruzada. O comentário declara
  que a regra é imposta **no banco (trigger) e na interface**.
- **Confirmação independente:** ao semear o banco de teste com uma clínica de
  tipo errado, o banco recusou com `ROLE_NOT_ALLOWED_FOR_CLINIC_TYPE`.

### [EV-006] Condições de visibilidade do menu ✅

- **Arquivo:** `src/app/(app)/layout.tsx`, linhas 46–109.
- **Conclusão, com os papéis exatos:**
  - `canViewReports`: Admin, ou — **na clínica ativa** — `franchisor_staff`,
    `planner_dentist`, `commercial_consultant` (se franqueadora) ou
    `unit_manager`, `franchisee` (se unidade).
  - `canViewPlans`: Admin, ou `franchisor_staff`, `planner_dentist`,
    `commercial_consultant` (franqueadora) ou `unit_manager`,
    `clinical_coordinator`, `franchisee` (unidade).
  - `canViewStaff`: Admin, `unit_manager`, `franchisor_staff`, `franchisee`
    (em qualquer clínica).
  - `canViewComercial`: Admin, `commercial_consultant`, `commercial_assistant`,
    `unit_manager`, `franchisee` (em qualquer clínica).
- **Detalhe relevante:** Relatórios e Planos olham a **clínica ativa**; os
  outros olham **todas as clínicas** da pessoa. Isso muda o resultado de quem
  atende em mais de uma unidade.

### [EV-007] Três níveis de permissão no Financeiro ✅

- **Arquivo:** `src/lib/finance/access.ts`.
- **Conclusão:**
  - `canViewFinance` (abrir): Admin, `finance_franchisor`, `unit_manager`,
    `franchisee`.
  - `canPostFinance` (lançar): Admin, `finance_franchisor`, `unit_manager` —
    **não** `franchisee`. Comentário: *"franqueado é somente leitura"*.
  - `canConfigureFinanceNetwork` (configurar a rede): Admin,
    `finance_franchisor` — **não** o gerente.
- **Importância:** é o exemplo mais claro de que **ver ≠ poder fazer**.

### [EV-008] Estoque separa gestão de atendimento ✅

- **Arquivo:** `src/lib/stock-access.ts`.
- **Conclusão:** `CLINICAL_ROLES` = dentista, coordenador, planner, TSB, ASB.
  - `canManageStock` (entrada, inventário): Admin, `finance_franchisor`,
    `unit_manager`.
  - `canConsumeStock` (consumo avulso): os acima **+ CLINICAL_ROLES**.
  - `canManageStockCatalog` (cadastrar item): Admin, `finance_franchisor`.
- **Comentário no código:** *"Recepção fica de fora — receber mercadoria e
  contar prateleira não é ato de balcão"*.

### [EV-009] Compras separa quem compra de quem paga ✅

- **Arquivo:** `src/lib/purchases-access.ts`.
- **Conclusão:** `isPurchaser` = Admin ou `purchaser`;
  `canManagePurchaseRequests` = Admin ou `unit_manager` **da clínica ativa**;
  `canViewPurchases` soma esses mais `franchisee` e `finance_franchisor`.
- **Comentário no código:** *"quem compra não é quem paga, e separar as duas
  funções é controle interno básico"*.

### [EV-010] Única exceção de menu por papel ✅

- **Arquivo:** `src/components/app-sidebar.tsx`, variável `dentistOnly`.
- **Conclusão:** quem tem **somente** o papel `dentist` na clínica ativa perde
  o item "Jornada" e ganha "Meu Dia" e "Minha Agenda". Nenhum outro papel altera
  a lista básica de navegação.
- **Consequência documentada no manual:** os cinco primeiros itens do menu
  aparecem para **todas** as funções.

### [EV-011] Integrações previstas, não conectadas ✅

- **Extração:** busca por `process.env.*` em `src/` e `scripts/`.
- **Resultado:** `ZAPSIGN_API_TOKEN`, `ZAPSIGN_BASE_URL`, `ASAAS_API_KEY`,
  `ASAAS_BASE_URL`, `GAMMA_API_KEY` existem como variáveis.
- **Conclusão:** as variáveis existem; `.env.example` documenta apenas as três
  do Supabase mais `NEXT_PUBLIC_AMBIENTE`. O `CLAUDE.md` confirma que ficam
  "prontas para plugar".

### [EV-012] Mensagens de tela ✅

- **Extração:** `toast.success|error|warning|info("…")` em todo o `src/`.
- **Resultado:** **179 mensagens** — 141 sucesso, 30 erro, 6 aviso, 2 info.
- **Limite:** só captura mensagens escritas como literal. Mensagens montadas em
  variável ou vindas do servidor **não** entram nessa contagem.

### [EV-013] Erros do banco traduzidos ✅

- **Arquivo:** `src/lib/finance/errors.ts`.
- **Resultado:** **8 códigos** com tradução em português.
- **Conclusão:** o arquivo devolve `null` para código desconhecido — o sistema
  então mostra o código cru, de propósito, para não inventar mensagem errada.

### [EV-014] Ações de servidor ✅

- **Extração:** `export async function` em todo arquivo `actions.ts`.
- **Resultado:** **384 ações**.
- **Limite:** o nome e o arquivo estão confirmados; **o que cada uma faz não foi
  verificado individualmente**.

### [EV-015] Não existe auto-cadastro ✅

- **Arquivos:** `src/app/login/` (só `page.tsx`, `login-form.tsx`,
  `actions.ts`); `src/app/(app)/admin/usuarios/actions.ts` → `createUser` com
  `email_confirm: true`.
- **Conclusão:** o administrador cria o usuário **já com a senha definida**.
  Não há tela de cadastro nem de "esqueci minha senha".
- **Confirmação independente:** teste contra o banco de produção respondeu
  `Signups not allowed for this instance`.

### [EV-016] A regra de ouro é imposta pelo banco ✅

- **Arquivo:** `CLAUDE.md` §8b; migração 0203.
- **Conclusão:** gatilho em `payment_receipts` levanta `SALE_NOT_CLOSED`. A
  regra não depende da tela.

### [EV-017] Duas camadas de autorização ✅

- **Arquivo:** `docs/ARQUITETURA-TECNICA.md`, seção "Autenticação e RBAC
  multi-tenant".
- **Citação:** *"Autorização é validada duas vezes, e só a camada do banco é
  confiável"*; as guardas do app *"servem para UX (esconder botões, erros
  amigáveis) — nunca como única barreira"*.
- **Conclusão:** é a base da explicação "o menu esconde, o banco barra".

### [EV-018] LGPD — regras impostas ✅

- **Arquivos:** `CLAUDE.md` §6; `AGENTS.md`; `src/lib/audit.ts`.
- **Conclusão:** consentimento antes da coleta; exclusão = anonimização (não há
  política de DELETE em `clients`); auditoria em todo acesso a ficha; mídia por
  URL assinada.

### [EV-019] Fluxo completo coberto por teste ✅

- **Arquivos:** `e2e/01-jornada.spec.ts` … `e2e/12-fechamento-competencia.spec.ts`.
- **Conclusão:** o caminho descrito no Fluxo 2 do manual é exercitado por teste
  automatizado ponta a ponta, papel por papel. Última execução conhecida: 15
  testes verdes, 1 pulado.
- **Valor para o treinamento:** o passo a passo do manual não é suposição — é o
  mesmo caminho que o teste percorre.

### [EV-020] Matriz de permissões calculada ✅

- **Método:** as condições de [EV-006] a [EV-009] foram **reimplementadas e
  executadas** para cada um dos 16 papéis, simulando uma pessoa com aquele único
  papel na clínica compatível.
- **Resultado:** `matriz-permissoes-riSZon.csv`, 16 linhas × 27 colunas.
- **Limite declarado:** a matriz descreve **visibilidade de menu** e **guardas de
  aplicação**. Ela **não** reflete as políticas de RLS do banco, que são a
  barreira real e podem ser mais restritivas.

---

## Tabela consolidada

| Ref. | Assunto | Arquivo principal | Confiança |
|---|---|---|---|
| EV-001 | 7 fases da jornada | `CLAUDE.md` §3 | ✅ |
| EV-002 | 84 rotas | `src/app/(app)/**/page.tsx` | ✅ |
| EV-003 | 30 itens de menu | `src/components/app-sidebar.tsx` | ✅ |
| EV-004 | 15 papéis + Admin | `src/lib/roles.ts` | ✅ |
| EV-005 | Papel × ambiente | `src/lib/roles.ts` | ✅ |
| EV-006 | Condições de menu | `src/app/(app)/layout.tsx` | ✅ |
| EV-007 | Financeiro em 3 níveis | `src/lib/finance/access.ts` | ✅ |
| EV-008 | Estoque: gestão × atendimento | `src/lib/stock-access.ts` | ✅ |
| EV-009 | Compras: comprar × pagar | `src/lib/purchases-access.ts` | ✅ |
| EV-010 | Exceção do dentista | `src/components/app-sidebar.tsx` | ✅ |
| EV-011 | Integrações não conectadas | `.env.example` + código | ✅ |
| EV-012 | 179 mensagens | `src/**/*.tsx` | ✅ |
| EV-013 | 8 erros traduzidos | `src/lib/finance/errors.ts` | ✅ |
| EV-014 | 384 ações de servidor | `src/**/actions.ts` | ⚠️ nomes sim, efeito não |
| EV-015 | Sem auto-cadastro | `src/app/login/` + Supabase | ✅ |
| EV-016 | Regra de ouro no banco | migração 0203 | ✅ |
| EV-017 | Duas camadas | `docs/ARQUITETURA-TECNICA.md` | ✅ |
| EV-018 | LGPD | `CLAUDE.md` §6 | ✅ |
| EV-019 | Jornada testada ponta a ponta | `e2e/*.spec.ts` | ✅ |
| EV-020 | Matriz calculada | script sobre EV-006..009 | ✅ com limite |
| EV-021 | Manual e Sistema no menu, para todos os papéis | migração 0247 + `src/lib/permissions.ts` | ✅ |
| EV-022 | Relato de problema: campos e situações | `supabase/migrations/0247_diario_do_sistema.sql` | ✅ |
| EV-023 | Tela de erro com código e botão de relato | `src/app/(app)/error.tsx` | ✅ |
| EV-024 | Novidades filtradas por papel | `src/lib/changelog.ts` + `changelog.test.ts` | ✅ |
| EV-025 | Alertas reunidos sem porta nova | `src/app/(app)/sistema/page.tsx` (lê `finance_alerts` e as RPCs de estoque) | ✅ |
