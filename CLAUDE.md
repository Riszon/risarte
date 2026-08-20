# CLAUDE.md

Guia para o Claude Code (claude.ai/code) ao trabalhar neste repositório.
Regras de **produto e negócio** ficam aqui; regras de **código** ficam em
`docs/ARQUITETURA-TECNICA.md`. Detalhe da jornada em `docs/JORNADA.md`; fila de
pendências em `docs/BACKLOG.md` (ler antes de iniciar qualquer etapa nova).

@AGENTS.md
@docs/ARQUITETURA-TECNICA.md

## 0. ⚠️ Trabalho em PARALELO — dois projetos, um repositório (LER PRIMEIRO)

Este repositório é usado por **dois fluxos de trabalho em paralelo**, cada um com
sua própria sessão/agente. Eles compartilham o mesmo repo, o mesmo banco Supabase
e o mesmo deploy (Vercel), então **disciplina é obrigatória** para não misturar.

- **MVP core (riSZon)** — Jornada, clínico, agenda, prontuário, dentista (H4.x).
  Documentos de estado: `ESTADO_DO_PROJETO.md` + `docs/ROADMAP.md`.
- **Risarte Empresarial (B2B)** — schema `empresarial`, rotas `/empresarial`,
  `src/lib/empresarial`. Documentos de estado: `docs/risarte-empresarial/`.
  (Vai integrar ao riSZon; por isso mesmo repo e mesmo banco.)

**Regras que TODO agente segue (decisão do dono, 10/07/2026):**

1. **Faixas de migração (nunca colidir):** core usa **0106+** (faixa 0–999);
   Empresarial usa **1000+**. Antes de criar migração, use a faixa do SEU projeto
   e o próximo número livre dentro dela. (Core já foi até 0105; Empresarial 0096–0104.)
2. **Documentos de estado separados:** cada projeto atualiza só os SEUS documentos
   (acima). Nunca mexer no documento de estado do outro projeto.
3. **Versão separada** (`src/lib/version.ts`): o core edita `APP_VERSION`/
   `LATEST_MIGRATION`; o Empresarial edita `EMPRESARIAL_VERSION`/
   `EMPRESARIAL_MIGRATION`. Cada um mexe só nas SUAS duas linhas.
4. **Sempre terminar com a árvore limpa:** commite os SEUS arquivos antes de
   encerrar (foi a falta disso que misturou os dois projetos). Ao INICIAR, se achar
   trabalho sem commit do OUTRO projeto, faça um commit próprio e rotulado
   (`chore(empresarial): …` ou `chore(core): …`) ANTES de começar o seu — nunca
   misture os dois num mesmo commit. Rotule os commits por projeto no assunto.
5. **Arquivos de código compartilhados** (agenda, prontuários, `treatment_sessions`,
   `app-sidebar.tsx`, `roles.ts`, `layout.tsx`): o core é o dono deles; mudanças do
   Empresarial aí devem ser **mínimas e aditivas**. Prefira criar arquivos novos
   dentro do seu módulo em vez de editar os compartilhados.
6. **Publicação:** hoje tudo vive no `main` (deploy único) — publicar um projeto
   publica os dois. Para separar o que vai ao ar, migrar o Empresarial para um
   branch próprio (`feature/empresarial`); combinar com o dono antes.

## 1. Visão geral

Sistema de gestão da rede de franquias **Risarte Odontologia** (hoje 1
franqueadora + 2 unidades — Cambé e Londrina; meta: **200 unidades em 5 anos**).
A espinha dorsal é a **Jornada do Cliente**: uma máquina de 7 fases que conduz a
pessoa do primeiro contato até o acompanhamento pós-tratamento. Com o tempo
entram módulos de financeiro, RH, compras/estoque, marketing e prontuário —
por isso **toda decisão de estrutura deve favorecer somar módulos sem retrabalho**
(novas rotas em `src/app/(app)/<modulo>/`, novas tabelas com `clinic_id` + RLS,
configs por unidade no padrão cascata, menu lateral orientado a permissões,
listas sempre com filtro por clínica pensando em 200 unidades).

## 2. Stack e ambiente

Stack fixa (decidida — não trocar): **Next.js 16** (App Router) + TypeScript +
Tailwind v4 + **shadcn/ui (Base UI)** + **Supabase** (Postgres/Auth/Storage,
região **sa-east-1 / São Paulo** por LGPD) + deploy **Vercel**. Banco único
multi-tenant. Projeto Supabase `hvhbijctanrrkxhemlza`.

```powershell
npm run dev     # servidor dev em http://localhost:3000 (Turbopack, hot reload)
npm run build   # portão de verificação: compila + checa tipos. Rodar antes de cada commit.
npm run test    # testes unitários (Vitest) das regras de negócio em src/lib. Rodar antes de cada commit.
npm run lint    # eslint (baseline: 3 problemas pré-existentes; não adicionar nenhum novo)
```

**Portão de cada entrega = `npm run build` + `npm test`.** Os testes unitários
(`src/lib/__tests__/`) travam as regras puras (matriz da jornada, máscaras,
preços em centavos, cascata de SLA, categorias de notificação, estágio do
plano); ao mudar uma dessas regras de propósito, atualizar o teste junto. Há CI
no GitHub Actions (`.github/workflows/ci.yml`): a cada push no `main` roda
testes + build na nuvem (aba Actions mostra ✅/❌). E2E (Playwright + banco de
teste) fica para a preparação de lançamento.
**Particularidades da máquina (Windows 10, repo só existe aqui):**

- Node não está no PATH dos shells. Prefixar comandos PowerShell com:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
- `api.github.com` é inacessível nesta rede: `gh` NÃO funciona. Push por git via
  SSH (`git@github.com:Riszon/risarte.git`); operações de repositório (criar
  repo, PR) o dono faz na web.
- Migrações não são aplicadas por CLI: escrever arquivo numerado em
  `supabase/migrations/`, copiar em **UTF-8** e o dono cola/roda no SQL Editor
  do Supabase. Detalhes e regras de idempotência em `docs/ARQUITETURA-TECNICA.md`.

## 3. Arquitetura — a Jornada do Cliente (7 fases)

Cada cliente está sempre em **uma fase + um sub-status**, com tempo registrado em
cada uma (`journey_phase_history`). O **Centro de Planejamento (Fase 3) é o
núcleo** do sistema: é onde o caso vira diagnóstico, plano e orçamento.

1. **Aquisição** — entrada de novos cadastros (SDR/recepção).
2. **Conversão Clínica** — consulta, coleta de dados (fotos, exames, áudio,
   transcrição); ao fim, agenda a apresentação comercial.
3. **Centro de Planejamento (núcleo, SLA 24h)** — diagnóstico → plano (+
   alternativos) → pilar da Metodologia → aprovação do Coordenador → orçamento →
   sinaliza ao comercial.
4. **Conversão Comercial** — apresentação online gravada; aceito → assinatura +
   pagamento; não aceito → follow-up. **Regra de ouro: só é venda com documentos
   assinados E pagamento confirmado.**
5. **Início de Tratamento** — fechamento notifica a recepção para agendar.
6. **Reavaliação** — controle de qualidade; se preciso, volta à Fase 3.
7. **Acompanhamento** — prevenção, retornos, inativos, resgate.

Toda transição **notifica automaticamente a função do próximo passo**. SLA
estourado = **badge vermelho** em listas, kanban e agenda. Todo plano é
classificado em **1 dos 6 pilares**: Diagnóstico, Planejamento, Saúde, Função,
Estética, Prevenção. Agenda e prontuário exibem sempre fase + pilar. Quem move
o cliente de fase depende da função (matriz de movimentação em `docs/JORNADA.md`,
imposta na função `move_client_phase`).

## 4. Decisões já tomadas (com a justificativa)

- **Assinatura digital = ZapSign.** Integração nacional, simples e com custo
  previsível; entra na Fase 2 (módulo comercial).
- **WhatsApp começa manual.** Mensagens pré-prontas que o usuário envia à mão
  antes de automatizar — valida o conteúdo e evita o custo/risco da Business API
  cedo. Automação fica para a Fase 3.
- **Sem migração de dados.** No início há **entrada dupla** (sistema novo +
  planilha atual) por um período — mais barato e seguro que migrar histórico
  legado de qualidade incerta.
- **Escala inicial pequena: ~15 usuários e ~60 avaliações/mês.** Dimensiona as
  decisões de performance (não otimizar prematuramente), mas a estrutura já é
  pensada para 200 unidades.
- **Portal do cliente adiado** para depois do MVP — foco primeiro no fluxo
  interno da equipe, que é onde está o valor imediato.
- **SLAs configuráveis pelo Admin Master** (padrão da rede + sobrescrita por
  unidade), não fixos no código — cada operação tem ritmo diferente.
- **NPS após o fechamento** (não durante) — mede satisfação no momento certo,
  sem atrapalhar a negociação.
- **Métricas de produtividade do Planejador no dashboard** — o Centro de
  Planejamento é o gargalo do negócio; medir é pré-requisito para escalar.
- **Abordagem online-first** — exige internet por enquanto; offline/sync é fase
  dedicada depois do núcleo (avaliar PWA + PowerSync/ElectricSQL). Manter o
  modelo "sync-friendly" desde já.
- **Pagamentos = ASAAS** (Fase 2), pelos mesmos motivos do ZapSign.
- **Rodada de refinamento visual** dedicada (tela por tela, guiada pelo dono) ao
  final do MVP funcional — por isso manter o visual em camadas trocáveis (cores
  em `globals.css`, aparência em `src/components/ui/`, lógica fora de ambos).

## 5. Controle de acesso por papéis (matriz PODE / NÃO PODE)

Papéis ficam em `user_clinic_roles` (um por clínica). Admin Master = flag global.
Enums sincronizados em `src/lib/roles.ts` (enum do banco ↔ const TS ↔ rótulo
pt-BR). Aplicar a matriz **na RLS** (barreira real) e na UI (esconder o proibido).

| Função | PODE | NÃO PODE |
|---|---|---|
| **Recepcionista** | Cadastrar clientes; agendar/acompanhar; check-in/out; solicitar anamnese e assinaturas; receber notificação de fechamento p/ agendar início | Avaliação clínica; planejamento; alterar plano; apresentação; fechamento |
| **SDR (Encantador)** | Cadastrar clientes (já pertencem à **unidade** escolhida, código FRA — Opção A); agendar (inclusive em outra unidade); editar cliente; ver os clientes que ela cadastrou | Mover fases (botões removidos); atos clínicos, de planejamento e comerciais |
| **Coordenador Clínico** | Avaliação/reavaliação; gravar consulta; fotos/exames; enviar ao Centro de Planejamento; **aprovar/reprovar plano**; auxiliar o Planner | Diagnóstico/planejamento; alterar plano; apresentação; fechamento |
| **Dentista Planner** | Diagnóstico; plano + alternativos; classificar pilar; pedir aprovação; gerar orçamento; sinalizar ao comercial; vê consolidados da rede | Avaliação clínica; agendamentos; contato direto; apresentação; fechamento |
| **Dentista (executor)** | Vê agenda e SEUS pacientes; executa o plano aprovado; tipos Início/Sessão/Retorno | Mover fases; planejar; negociar; ver clientes de outros |
| **Consultor Comercial** | Apresentação (com gravação); follow-up; renegociar; desconto; definir pagamento; vê só os SEUS clientes | Planejamento; alterar plano; avaliação; agendamentos |
| **Assistente Comercial** | Enviar documentos (ZapSign) e link de pagamento (ASAAS); acompanhar status; encaminhar fechado à recepção | Planejamento; avaliação; apresentação; negociação |
| **Gerente de Unidade** | Visão completa (leitura) + dashboard da sua unidade; SLAs e indicadores | Atos clínicos/comerciais; alterar planos |
| **Franqueadora / Rede** | Leitura + dashboard consolidado de TODAS as unidades | Atos clínicos/comerciais |
| **Franqueado** | Leitura + dashboard da(s) unidade(s) que possui | Atos clínicos/comerciais |
| **Admin Master** | Tudo; cadastrar usuários, clínicas e configurações | — |

Funções da Franqueadora (SDR, Planner, Consultor, Assistente) têm **escopo de
unidades** (Todas / específicas / Nenhuma) que limita o que enxergam. TSB e ASB
(funções de unidade) estão previstas. Detalhe fino em `docs/JORNADA.md`.

## 6. Restrições — LGPD (requisito de arquitetura desde o MVP)

- Dados odontológicos = **dados sensíveis de saúde**: consentimento registrado
  (TCLE + termo LGPD com data/hora) **antes** de tratar; menor privilégio via RLS.
- **Gravação de consulta/apresentação só inicia após o consentimento estar
  registrado** no sistema.
- Exclusão de cliente = **anonimização** (status `anonymized`), nunca apagamento
  físico (guarda legal do prontuário). Não existe DELETE policy em `clients` de
  propósito.
- Todo acesso a ficha/prontuário gera `audit_logs` (via `logAudit()` — só ids e
  metadados, **nunca** dado pessoal em `details`).
- Nunca expor dado de paciente em logs, URLs ou mensagens de erro. Mídia em
  Supabase Storage com **URLs assinadas**, nunca públicas.

## 7. Estado atual

**Fase do plano: MVP.** Concluído e validado pelo dono:

- **Etapa 1 — Fundação:** Next.js 16 + tema Risarte, login Supabase (sem
  auto-cadastro), proteção em `src/proxy.ts`, RLS base. (0001)
- **Etapa 2 — Cadastros:** clínica ativa; área admin (clínicas, usuários,
  senha, ativar/desativar); módulo de clientes auditado; SLAs; máscaras. (0002–0003)
- **Etapa 3 — Base da Jornada:** kanban por fase com SLA; agenda com profissional
  responsável; notificações; cliente único na rede + transferência; TSB/ASB;
  pilar automático + treatment_pillar; `journey_status` (sub-status); check-in +
  painel de atendimento; decisões da Fase 5; ativo/inativo configurável. (0004–0020)
- **LOTE D — ajustes do teste geral:** bug da SDR ao agendar (`unit_scheduling_staff`);
  "quem chamou conclui"; status em tratamento; tela de Atendimento (consultor,
  filtros, linha do tempo); cadastro com CPF primeiro. (0021–0024)
- **Etapa 4 — Coordenador Clínico (4.1 + 4.2):** consentimento (LGPD); upload de
  fotos/exames/vídeo/áudio (bucket privado `clinical-media`, links assinados);
  gravação de áudio; considerações editáveis; galeria; "Enviar ao Centro de
  Planejamento". **4.3 (aprovar/reprovar plano)** fica para a Etapa 5. (0025, 0027, 0028)
- **LOTE E — correções pré-Etapa 5:** modelo SDR (cliente pertence à unidade,
  código FRA — Opção A); regras de Jornada (sem botões da SDR, dentista sem
  Jornada, inativos + filtro); unidade visível na lista/ficha; conflitos de
  agendamento; editar cliente + transferir A→B; atendimento do Consultor;
  **compartilhamento de cliente entre unidades (E7)**. (0026, 0029–0034)

- **Etapa 5.1 — Centro de Planejamento (validada):** fila priorizada em
  `/planejamento` (apresentação comercial mais próxima; empate = quem entrou
  antes na Fase 3); estrutura do plano na ficha (diagnóstico + opções
  principal/alternativas); envio para aprovação que define o sub-status
  "Aguardando Aprovação" e notifica o Coordenador. (migração 0035)

- **Etapa 5.2 — Orçamento (entregue):** tela admin **Tabela de Preços**
  (`/admin/precos`, catálogo no padrão cascata: preço padrão da rede + ajuste por
  unidade); **orçamento por opção** na ficha (itens do catálogo ou linhas livres,
  total por opção; valores em centavos). (migração 0036)
- **Etapa 5.3 / 4.3 — Aprovação do plano (entregue):** o Coordenador **aprova**
  ou **devolve** (com orientações → sub-status "Revisão com Coordenador") o plano
  submetido; aprovado → o Planner **envia ao Comercial** (Fase 3 → 4, com trava de
  "plano aprovado"). RPC `review_treatment_plan`. (migração 0037)

Com isso a **Etapa 5 (Centro de Planejamento) e a 4.3 estão completas** — o núcleo
clínico do MVP (Jornada + Coordenador + Planejamento) está fechado.

**Em andamento — LOTE F** (feedback pós-teste da Etapa 5, em `docs/BACKLOG.md`,
7 sub-etapas F1–F7). **F1 + F2 entregues:** F1 = filtros aplicam sozinhos
(componente `FilterForm`, sem botão "Filtrar"), ficha abre em **modo leitura**
com botão "Editar" (`ClientDataSection`), e o cadastro reconhece o cliente já
existente e **autopreenche** os dados; F2 = compartilhamento notifica as **duas**
unidades ao iniciar/encerrar e a ficha mostra **Histórico de compartilhamento**
(migração 0038). **F3.1 entregue:** módulo **Procedimentos** (`/procedimentos`,
substitui a antiga "Tabela de Preços") com novos campos (código interno
automático, TUSS, especialidade, preço padrão/mín/máx, comissionamento %+R$,
pilar), busca + filtros (especialidade/ativo/pilar), editar todos os campos,
**excluir = desativar** (procedimento já usado nunca é apagado), histórico de
alterações, e acesso de **Admin Master + Dentista Planner** (migração 0039).
**F3.2 entregue (sem migração):** **importar planilha Excel** (`.xlsx`, com botão
"Baixar modelo" e biblioteca SheetJS via CDN) e **reajuste de preço em massa**
(percentual aplicado a Todos / por Especialidade / por Pilar / Selecionados).
**F3 (Procedimentos) completo.** **F4 entregue (migração 0040):** aprovação **por
opção** — o Coordenador aprova/reprova cada opção (com considerações que valem
ao aprovar ou reprovar); o plano vira "aprovado" só quando todas as opções têm
decisão e ≥1 é aprovada (se todas reprovadas, devolve ao Planner). O plano
principal aparece primeiro e em destaque, e o Coordenador vê só o **total** de
cada opção (não o preço item a item) e não edita o orçamento. **F5 entregue (sem
migração):** a fila do Centro de Planejamento (`/planejamento`) agora separa os
casos por **situação** (aguardando planejamento / aguardando aprovação / em
revisão / aprovados / enviados ao Comercial) com **contadores clicáveis** e
filtro de **período** (Hoje / Esta semana / Este mês / período específico).
**F6 entregue (sem migração):** central de notificações categorizada
(`/notificacoes`) — categorias **Plano de Tratamento / Compartilhamento / Início
de Tratamento / Transferência / Outras** (classificadas pelo título em
`src/lib/notifications.ts`), com chips/contadores clicáveis, filtro e selo de
categoria por aviso. **F7 entregue (sem migração) — LOTE F COMPLETO:** cockpit do
Planner (`/planejamento/[clientId]`) — tela dedicada em 2 colunas: à esquerda as
**evidências do cliente** (galeria de mídia que abre em pop-up/lightbox +
considerações + consentimento), à direita o **editor do plano**, sem trocar de
tela; a fila abre o cliente direto no cockpit.

**LOTE B COMPLETO (B1–B6):** **B1** — agenda com visões **Dia / Semana / Mês**
(`src/lib/agenda-view.ts`, `WeekGrid` por `dayCount`, `MonthView`, `AgendaToolbar`).
**B2/B3** — config de agenda por unidade (horário, dias e **cadeiras**) em
`/admin/agenda` no padrão cascata (migração 0043, `clinic_agenda_settings`); ao
agendar, valida fora-do-horário / dia fechado / cadeiras lotadas (exceto
Urgência/Emergência). **B4/B5/B6** — tela **Relatórios** (`/relatorios`, papéis de
gestão/rede): quadros-resumo de agendamentos (situação/tipo/profissional/unidade),
rede por fase **sem nomes** de pacientes, e produtividade do Planner (planos
criados/enviados/aprovados/devolvidos + tempo médio criação→aprovação). Adiados
do B1 (polimento): semana começando no domingo + esconder fim de semana sem
agendamento.

A barra lateral mostra a **versão do sistema** e a **última migração**
(`src/lib/version.ts`: `APP_VERSION` + `LATEST_MIGRATION`) acima do botão Sair —
bumpar os dois a cada entrega publicada.

**Correções pós-teste (migrações 0041–0042):** 0041 corrigiu o erro "não foi
possível registrar a avaliação" (cast de enum no `review_plan_option`), exige
procedimentos lançados em cada opção para enviar, busca de Procedimentos com
sugestões (datalist) e botão "Tornar principal". 0042: encerrar compartilhamento
pela unidade B → a ficha mostra "Compartilhamento encerrado" + detalhes (e B
perde o acesso) em vez de 404 (`client_shares.ended_by` + tratamento na ficha);
após a aprovação o Planner **não edita** o plano (leitura) — há **"Reabrir para
edição"** (`reopenTreatmentPlan` → rascunho, exige nova aprovação antes do
Comercial); **reprovar opção exige considerações** (obrigatórias).

**Migrações 0001–0043 escritas.** O dono aplica cada uma no SQL Editor do
Supabase; **0001–0042 aplicadas; 0043 pendente** (config da agenda da B2/B3 —
`clinic_agenda_settings`).

## 8. Próximos passos (ordem de prioridade)

> Etapa 5, LOTE F (F1–F7) e LOTE B (B1–B6) **concluídos**. Resumo de estado
> também em `ESTADO_DO_PROJETO.md` (raiz), atualizado a cada etapa.

1. **Aplicar a migração 0043** e fazer o **teste final do LOTE B** (config da
   agenda + Relatórios).
2. **Rodada de refinamento visual** — tela por tela, guiada pelo dono (cores,
   espaçamento, textos), agora que o fluxo está completo.
3. **Fase 2 (após MVP validado):** módulo comercial — apresentação gravada,
   assinatura digital (ZapSign) + pagamento (ASAAS) com a regra de ouro, NPS
   pós-fechamento, WhatsApp manual, transcrição/resumo por IA, dashboards com metas.

Adiados (em `docs/BACKLOG.md`, não esquecer): semana começando no domingo +
esconder fim de semana sem agendamento; foto por webcam; gênero + rótulos;
offline/sync (PWA + PowerSync/ElectricSQL).

**Módulo Risarte Empresarial (B2B) — em construção.** Programa que conecta
empresas parceiras à rede: o colaborador vira **cliente do riSZon** (mesmo banco),
com selo "Risarte Empresarial", desconto no orçamento, mensalidade da empresa e
split Risarte/RisLife. Schema próprio **`empresarial`** (1º schema separado do
projeto — exige "Exposed schemas" no painel). Contexto e DDL em
`docs/risarte-empresarial/` (briefing + `ADENDO-01-motor-de-beneficios.md`).
Decisões: dinheiro em centavos; papel novo `rislife_consultant` (Franqueadora);
benefícios personalizáveis por empresa (cobertura/desconto/frequência/limite/
carência/pagamento) com acompanhamento de uso e painéis de economia.
**Fases 0–8 construídas (migrações 0096–0103), aguardando teste do dono** —
roteiro em `docs/risarte-empresarial/ROTEIRO-TESTE.md`. ASAAS/ZapSign/Gamma ficam
"prontos para plugar" (chave + deploy das Edge Functions em `supabase/functions/`).

Não avançar de etapa sem o OK do proprietário.

## 8b. Módulo Financeiro (em construção — FIN0 entregue)

Especificação funcional aprovada em `docs/financeiro/DOCUMENTO-BASE-FINANCEIRO.md`
e o briefing de execução em `docs/financeiro/PROMPT-riSZon-Modulo-Financeiro.md`.
**Ler os dois antes de qualquer fase nova.**

**Regra estrutural:** a aba financeira do cliente é uma **visão** sobre uma base
contábil — nunca a base. Tudo nasce em `financial_entries` (o razão); contas a
receber e a pagar são projeções sobre ele. Sem isso, DRE, DFC, ponto de
equilíbrio e consolidação da rede não fecham.

**Invariantes de toda fase do Financeiro:**

- **Competência × caixa:** todo lançamento tem `accrual_date` (fato gerador →
  DRE) e `cash_date` (movimentação → DFC).
- **Nada se apaga.** Lançamento liquidado/conciliado não é editado nem
  excluído: gera-se **contra-lançamento** com motivo (trigger no banco).
- **Rastreabilidade:** `source_type` + `source_id` em tudo; qualquer número de
  relatório precisa chegar ao documento de origem.
- **Dinheiro em BIGINT de centavos** nas tabelas do módulo (o núcleo antigo usa
  INTEGER; conversão fica para janela dedicada).
- **Arredondamento** meio para cima; a última parcela absorve o resíduo.
- **Cálculo isolado e testado** em `src/lib/finance/` — nenhuma regra de
  dinheiro dentro de componente de tela.
- **Taxas congeladas:** a parcela guarda multa/juros vigentes quando foi gerada;
  mudar a configuração não reescreve o passado.
- **LGPD:** relatório gerencial usa identificador anonimizado do paciente.

**Decisões de negócio travadas (dono, 31/07/2026):**

- **Multa 2% + juros 1% ao mês, pro rata die**, cascata rede→unidade. O teto de
  2% é limite do **CDC art. 52, §1º** (contrato de consumo parcelado) e está
  travado no banco.
- **Atraso conta no dia seguinte** ao vencimento (carência configurável).
- **Multa e juros incidem sobre o valor CHEIO da parcela** (mais o benefício
  perdido), nunca sobre o saldo — *revisa a decisão de 31/07 em 04/08/2026*:
  receber metade não pode cortar a multa pela metade, senão a baixa parcial vira
  desconto disfarçado. Ordem de abatimento de um recebimento: **principal →
  benefício perdido → multa → juros**.
- **Pontualidade é condição do benefício.** Cliente de programa (PPR+ /
  Empresarial) só tem o desconto porque paga em dia: atrasou, aquela parcela
  volta ao preço sem benefício e a multa/juros incidem sobre o valor maior.
  **O critério é o RISCO, não o rótulo do meio de pagamento** (correção de
  04/08/2026, migração 0192 — a regra nasceu olhando "boleto e recorrência" e
  deixava passar PIX parcelado com vencimentos futuros, que é o mesmo risco).
  Toda cobrança é promessa de pagamento e corre risco, **exceto no cartão**
  (`cartao`, `cartao_parcelado`), onde a adquirente já garantiu o dinheiro.
  Procedimento que ficou **100% gratuito nunca é cobrado** — sai da base. O
  valor em risco é rateado entre as parcelas e congelado
  (`benefit_discount_cents`) no fechamento da venda.
- **Não existe desconto na baixa.** Receber menos que o total devido é baixa
  **parcial**; perdoar diferença é ato de **renegociação** — Gerente da unidade,
  Financeiro da Franqueadora (com autorização do Gerente) ou Admin Master.
- **Renegociação (FIN2):** a dívida nova nasce com **tudo** o que é devido hoje
  (o que falta + benefício perdido + multa + juros). O perdão é **desconto**,
  tem o **mesmo teto da regra comercial da unidade** e vira lançamento em
  **1.9.02**. Acima do teto, ou qualquer desconto de quem não é Gerente/Admin,
  fica **aguardando autorização** e as cobranças não mudam antes disso. As
  cobranças novas **não geram lançamento de competência** — a receita do
  serviço já foi reconhecida pelas originais; só multa/juros (4.1.01),
  benefício incorporado (1.1.01) e desconto (1.9.02) entram no razão.
- **Renegociação substitui** as parcelas antigas (viram `renegotiated`, com a
  marca de que estiveram em atraso — senão renegociar zeraria a inadimplência
  e o indicador 9.28 perderia sentido).
- **Centro de custo por ÁREA** (Clínico, Comercial, Administrativo, Marketing,
  Infraestrutura), nunca por especialidade clínica. Unidade só cria centro como
  **filho de um centro da rede**, para o consolidado ficar comparável.
- **Dois consolidados distintos:** *Resultado do Grupo* (franqueadora +
  unidades **próprias**, com eliminação intercompany do royalty) × *Faturamento
  da Rede* (todas as unidades, só benchmarking). **Faturamento de franqueada
  nunca entra no resultado da franqueadora** — se algum card somar, é bug de
  negócio.
- **Repasse de dentista:** valor **fixo por procedimento**, tabela com vigência,
  chaveada por **nível do plano de carreira**; bônus percentual apurado no
  fechamento do mês. Reajuste de tabela nunca recalcula repasse já apurado.
- **Gerente de unidade nunca vê financeiro de outra unidade**; no ranking da
  rede as demais aparecem anonimizadas.

**Papel novo:** `finance_franchisor` (Financeiro da Franqueadora), com escopo de
unidades. Auditor/Controladoria somente-leitura está previsto, não implementado.

**Alçada das contas a pagar (FIN3, decisão do dono 04/08/2026):** cada conta do
plano de contas tem um **modo** — `automatica` (despesa contratada: nunca pede
autorização e **não olha o teto**), `sem_autorizacao` (livre, mas respeita o
teto) ou `com_autorizacao` (sempre exige). Cascata rede→unidade e geral→conta,
sendo que **a conta pesa mais que o escopo**: regra da rede sobre uma conta não
é derrubada pelo teto geral da unidade. **Quem lançou não autoriza a própria
conta** (o Financeiro da Franqueadora e o Admin Master são a exceção).
**Recepção não entra em contas a pagar** — pagar fornecedor não é ato de balcão.
Multa e juros que NÓS pagamos são **informados** (quem define é o fornecedor) e
vão para **4.2.01**, separados da despesa.

**Adquirente (FIN4b):** a taxa do cartão é **despesa da UNIDADE** (conta
2.4.01), nunca da franqueadora — senão a unidade não tem incentivo para
negociar a taxa nem para puxar o cliente para o PIX. A tabela de taxa/prazo tem
**vigência**: renegociar a taxa não reescreve o que já foi recebido. O cliente
paga o **bruto** (é isso que quita a dívida dele); a clínica recebe o
**líquido**, em **D+n**, e é essa data que vai para a projeção de caixa.

**Abrangência da adquirente (FIN4b.2, dono 06/08/2026):** o cadastro tem escopo
**unidade / rede / unidades específicas**. Rede e unidades específicas são ato
da **Franqueadora** (`clinic_id` nulo) — a unidade não reescreve a taxa que a
rede negociou. Na hora de escolher sozinho, **o cadastro próprio da unidade
ganha do padrão da rede** (quem tem contrato próprio é quem paga aquela taxa).
A **franquia gratuita mensal conta por unidade**, não somando a rede: a fatura
da adquirente chega por conta/CNPJ.

**Momento da cobrança da taxa (FIN4b.2):** cada faixa diz se a taxa é cobrada
**no pagamento** (sai do que entra na baixa — não pagou, não custou) ou **na
emissão** (o custo nasce ao gerar o documento, pago ou não; é como o banco
cobra o boleto). Só boleto e PIX aceitam "emissão" — no cartão não há documento
a emitir. **Trava de dupla cobrança, exigida pelo dono pensando no ASAAS:**
`register_boleto_issue()` recusa quando a faixa diz "pagamento"
(`FEE_NOT_ON_ISSUE`) ou quando a baixa já cobrou; `apply_acquirer_fee()` **não
cobra** quando a faixa diz "emissão" — nem se a emissão não tiver sido
registrada (deixar de lançar um custo é erro menor que lançar duas vezes o
mesmo custo); e a origem `boleto_issue` aponta para a **parcela** no índice
único do razão, então o webhook futuro do ASAAS cai na mesma porta e não
duplica. Adiado: **segunda via de boleto** (hoje é uma cobrança por parcela).

**FUSO: data de negócio é data civil brasileira (0201).** `new Date()
.toISOString().slice(0,10)` devolve a data em **UTC** e, das 21h à meia-noite,
já é o dia seguinte — parcela do dia virava atrasada e a baixa nascia com data
de amanhã. No app, a única fonte de "hoje" é **`todayInBrazil()`**
(`src/lib/dates.ts`); no banco, o fuso é `America/Sao_Paulo` e existe
**`public.today_br()`** para funções novas. Nunca usar `toISOString()` para
obter "hoje".

**A REGRA DE OURO É IMPOSTA PELO BANCO (0203).** Não se recebe por uma venda que
não foi fechada: gatilho em `payment_receipts` levanta `SALE_NOT_CLOSED`.
Estorno e cobrança de renegociação passam (desfazer não se bloqueia; dívida
renegociada já era devida). A regra estava só na documentação e na tela, e o
teste do dono achou R$ 869,00 recebidos numa negociação nunca aceita
(06/08/2026). **Quando uma regra de negócio importa, ela mora no banco.**

**Cockpit do Consultor = fila de trabalho.** O quadro vai até *Fechamentos*;
"Aguardando iniciar", "Tratamento iniciado", cancelados e perdidos vivem no
**Histórico** (decisão do dono, 06/08/2026) — o consultor precisa enxergar o que
ainda depende dele, não o que já encerrou.

**Plano de tratamento NÃO tem acréscimo** (dono, 06/08/2026). O preço vem do
orçamento aprovado pelo Coordenador; somar valor por cima enfraquece a aprovação
clínica. Venda direta mantém acréscimo, restrito ao Gerente.

**Cancelar plano de tratamento (0206, dono 07/08/2026).** Três passos, e **nada
é desfeito antes do último**: *apurar* (congela o acerto) → *assinar* (o
paciente assina o termo) → *efetivar* (sessões, cobranças e fase mudam).
Descartar no meio não deixa rastro no tratamento.

- **Destino do paciente:** quem **não fechou** continua na **Fase 4**. Quem
  fechou vai para **Fase 6 (reavaliação)** ou **Fase 7 (acompanhamento, com
  data de retorno obrigatória)** — escolha do Gerente no ato. Voltar à Fase 4
  quem já estava em tratamento seria fingir que o clínico não aconteceu.
- **O realizado é cobrado COM o desconto** do contrato (retirar desconto já
  concedido é cláusula que o CDC olha com rigor).
- **Multa de rescisão** é percentual configurável (cascata rede→unidade),
  **padrão 0%**, e incide sobre o **não executado** — compensa a agenda
  perdida, não pune o que já foi entregue.
- **Cliente devendo** → nasce cobrança nova (15 dias). **Clínica devendo** →
  nasce conta a pagar em **1.9.03**; a forma de devolver é decidida no
  Financeiro (estorno em cartão depende da adquirente e nem sempre existe).
- **Sessão concluída nunca é desfeita** — é histórico clínico.
- **O sistema não lê o contrato assinado** (não há texto armazenado): ele aplica
  as regras acima e **cita** o contrato de origem. Divergência é conciliada por
  gente, no campo de observações do termo.
- Pendência: o **benefício do programa não volta** no cancelamento do Comercial
  (na venda direta volta) — `ppr_benefit_usages` não guarda vínculo com a
  negociação.

**A taxa da adquirente entra NA BAIXA (FIN4c, 0204).** A **modalidade vem do
meio da BAIXA, não do meio da venda**: parcela de boleto paga por PIX no balcão
custou o PIX. Sem taxa cadastrada, a baixa **não falha** — segue sem taxa (é
problema de cadastro, não de atendimento). O **estorno reverte a taxa** junto,
com a direção invertida; a taxa de **emissão de boleto não volta** (o banco
cobrou por emitir, e isso independe da baixa).

**⚠️ O CÓDIGO DO DOCUMENTO NUNCA SOME** (regra do dono, 07/08/2026, depois de
ele sumir em três telas diferentes). Todo código gerado — **`PT-`** plano de
tratamento, **`VD-`** venda direta, **`RN-`** renegociação, **`CN-`**
cancelamento — **acompanha o registro para sempre e em todo lugar**: listagens,
cabeçalhos, eventos de histórico, notificações, termos e documentos impressos.

O código é o que **rastreia o documento**: amarra plano, cobranças, razão
contábil, termo assinado e histórico. Quando some de uma tela, o caso vira um
buraco — ninguém liga o que aconteceu no clínico ao que aconteceu no financeiro.

**Armadilha que já causou o problema três vezes:** consulta que filtra por
status "ativo" (`aceita`, `em_aberto`, `stage` do funil) **exclui o encerrado e
leva o código junto**. Cancelado, perdido ou concluído é exatamente quando
alguém vai procurar o código — sempre incluir os estados encerrados. Evento de
histórico sem código é evento incompleto.

**Os dois fluxos de venda andam juntos.** Comparativo completo em
`docs/COMPARATIVO-VENDAS.md`. Regra: o que muda na venda direta tem de ser
verificado no fechamento pelo Comercial e vice-versa — os dois terminam nas
mesmas `payment_installments`.

**A cobrança guarda o meio de pagamento (0200).** `payment_installments
.payment_method` era sempre nulo — o meio só existia na venda. Agora a cobrança
**herda o meio da venda** quando não traz um próprio (`save_payment_schedule`),
nos dois fluxos: venda direta e negociação do Comercial. Regra do dono: **o que
for testado na venda direta tem de funcionar igual no fluxo do Comercial.**
O meio aparece no resumo das duas telas — ele é o que muda taxa, prazo de
liquidação e risco do benefício.

**Faixa de taxa (FIN4b.2):** dá para **editar** (para consertar digitação) e
**encerrar a vigência** (o caminho certo quando a taxa mudou). Faixa que já
precificou recebimentos **não é apagada** — gatilho `RATE_IN_USE` no banco.

**Repasse ao dentista (FIN5, 0209).** Valor **FIXO por procedimento**, tabela com vigência chaveada por **nível do plano de carreira** (individual é exceção). Apuração nasce na **conclusão da sessão**, com competência na data do procedimento e valor **congelado** — reajuste nunca recalcula o apurado. **Bônus percentual sobre o total do período**, nunca por procedimento. Fechamento mensal gera **duas contas a pagar por dentista**: fixo em **2.1.01** e bônus em **2.1.02** (o plano de contas separa produção de premiação). O sistema **não paga** — quem paga é o Financeiro.

**Repasse por NÍVEL, visível onde se decide (0212).** A pergunta que faltava era "quanto ganha *um* sênior" — só existia "quanto ganha o Dr. Fulano". Agora há `payout_rate_by_level` e `payout_matrix` (os **mesmos quatro degraus** da apuração; conta diferente da que grava = tela que mente). Aparece em três lugares: **comparativo procedimento × nível** em Repasses (célula editável), **repasse por nível** no cadastro do procedimento, e **margem por nível** no precificador. Valor em itálico = veio do **cadastro do procedimento**, não do nível — os dois mostram o mesmo R$, e é essa diferença que revela a tabela incompleta. O catálogo grava no escopo da **rede**; a unidade sobrescreve em Repasses (**unidade vence rede**, desempate que a 0210 não tinha).

**Taxa média do pagamento — sugerida pelo razão (0212).** É quanto o meio de pagamento come do preço, e entra como custo **proporcional** (sobe com o preço) porque na hora de precificar não se sabe como o cliente vai pagar; o preço é um só, então usa-se a média da mistura. `suggested_avg_acquirer_fee` calcula **taxas de adquirente ÷ recebido nos últimos 90 dias** (inclui a taxa de emissão de boleto; estornados saem dos dois lados). **Devolve nada** quando não há taxa lançada — um "0%" seria lido como "não pago taxa".

**Reajuste em massa e comissão em massa moram na Precificação (0212).** Saíram do catálogo por decisão do dono: mexer em preço sem ver custo e margem na mesma tela é o erro que o precificador existe para impedir.

**Alerta de margem.** Como o repasse é fixo, **desconto não reduz repasse**: sai inteiro da margem. A negociação mostra a margem ao vivo e **avisa** abaixo de `min_margin_percent` (cascata rede→unidade) — **não bloqueia**, porque o teto de desconto já é a trava. **Material e laboratório ainda não entram** (são do Estoque); a tela declara isso.

## 8c. Estoque (em construção — E1+E2 entregues, migração 0213)

**O documento base já diz como este módulo morre:** *"falta de baixa no uso"*
(§7). Todo estoque de clínica quebra no mesmo ponto — alguém teria de digitar
"usei 2 anestésicos" no meio do atendimento, ninguém digita, e em três meses o
saldo não vale nada. Por isso **a baixa é automática, pelo KIT do procedimento**
(E3); o registro manual existe só para a exceção.

- **O saldo é PROJEÇÃO, não base.** Tudo nasce em `stock_movements`;
  `stock_balances` é derivado e reconstruível. Ninguém escreve saldo direto — a
  única porta é `post_stock_movement()`, que calcula, congela e projeta sob
  trava. Estoque com saldo digitado é estoque que ninguém audita.
- **Custo médio ponderado.** Entrada recalcula o médio; **saída sai pelo médio
  vigente e o valor fica CONGELADO no movimento** — comprar mais caro amanhã não
  reescreve o custo do que foi usado ontem (mesma regra do repasse). Saldo
  zerado ou negativo não pondera: o custo da entrada vira o custo.
- **Saída NÃO é recusada por falta de saldo** — registra negativo e alerta.
  Travar aqui seria parar atendimento por causa de cadastro, o erro que a baixa
  da adquirente já ensinou a não repetir. Saldo negativo *é* a informação:
  faltou dar entrada em alguma nota.
- **Ajuste e perda exigem motivo.** A diferença do inventário é o dado (perda,
  furto, kit errado); sem motivo ninguém audita depois.
- **Item é da REDE; saldo, mínimo, máximo, local e fornecedor habitual são da
  UNIDADE** (cada uma compra pelo seu preço e guarda onde quer). **Kit** segue a
  mesma cascata: padrão da rede, ajuste por unidade.
- **O KIT TEM NOME PRÓPRIO E SERVE A VÁRIOS PROCEDIMENTOS (0215).** Na 0213 ele
  era filho de um procedimento — "Kit restauração" viraria três cópias (1, 2 e 3
  faces) e uma delas ficaria desatualizada sem ninguém perceber. Agora: kit é
  entidade (criar, renomear, inativar), **um kit → vários procedimentos**, e
  **um procedimento pode ter vários kits** (básico + específico; sem isso o
  básico seria copiado em todo kit). Itens e vínculos são gravados juntos
  (`save_stock_kit`) — separados, um procedimento ficaria ligado ao kit com o
  conteúdo anterior. Vínculo da unidade **vence** o da rede (não mistura: herdar
  de volta o que a unidade trocou seria pior que não ter cascata).
- **Editar item: o FATOR muda livre, a UNIDADE DE CONSUMO não** (0215). O fator
  novo vale só para as próximas entradas — o saldo já está contado em unidades
  de consumo. Trocar a unidade com saldo/movimento é **bloqueado no banco**
  (`UNIT_LOCKED`): 240 sugadores não viram 240 gramas, e o erro levaria junto o
  custo de todo procedimento que usa o item.
- **Excluir = inativar** quando o item tem movimento ou está num kit (mesma
  regra do catálogo de procedimentos). Apagar de verdade, só o que nunca foi
  usado.
- **UNIDADE DE COMPRA ≠ UNIDADE DE CONSUMO (0214).** O dono achou no teste: *"eu
  pago R$ 25,00 na caixa de sugadores, mas vem 100 unidades"*. A 0213 tratava as
  duas como iguais e cada sugador entrava no procedimento por R$ 25,00 — erro de
  100× e **silencioso**. A correção é um conceito só: **unidade de CONTROLE**
  (o que se consome) + **fator de conversão** da embalagem. Resolve também o
  fracionamento (tubo de resina → grama) e o **rendimento** (frasco de adesivo →
  20 aplicações; ninguém mede ml de adesivo na clínica). **O saldo vive sempre
  na unidade de controle**; a entrada é lançada como está na nota e o BANCO
  converte — a mesma conta vale para a nota digitada hoje e para a integração de
  compras amanhã.
- **Unidades são listas fechadas**, nunca texto livre: "un", "und", "UN" e
  "unid" viram quatro itens no consolidado da rede.
- **Custo unitário carrega 4 casas; valor total é centavo inteiro.** R$ 180,00 ÷
  7 g = 2571,4286 centavos/g — arredondar a cada movimento subestimaria o custo
  sempre para o mesmo lado. Regra: **taxa tem decimais, valor é centavo**.
- **LOTE E VALIDADE SÃO DA COMPRA, NÃO DO ITEM.** A caixa de março tem lote e
  validade diferentes da de agosto; gravar no item faria a compra nova apagar a
  informação da anterior — errado e silencioso. Ficam no **movimento de entrada**
  (com fornecedor e nota), e `stock_expiring()` aponta o que vence primeiro.
  **Limite declarado:** o consumo **ainda não escolhe lote** (sem baixa FIFO nem
  recusa de vencido) — controle por lote muda a baixa, e fica para depois da E3.
- **CUSTO DE MATERIAL É CALCULADO, NUNCA GUARDADO (0216).** A 0213 fazia o kit
  *escrever* o resultado em `procedure_costs.materials_cents` para não mexer nos
  três consumidores. **Foi erro de desenho, e o teste do dono achou:** ele somou
  os kits (R$ 17,92) e a Precificação mostrava R$ 11,69. Valor guardado é foto —
  fica certo no instante em que é tirada e envelhece sozinho; todo caminho que
  muda o custo passa a ter de lembrar de tirar outra, e um não lembrou. Pior: o
  recálculo só cobria a **clínica ativa**, então salvar um kit da REDE deixava as
  outras unidades com o número velho (uma tinha R$ 220,00 contra R$ 0,00 real).
  Agora `material_cost_for()` resolve na leitura: **tem kit, o kit manda; não
  tem, vale o valor informado à mão**. Não existe cache para envelhecer.
  **Regra geral: não cachear número derivado de dinheiro** — o custo de
  recalcular é sempre menor que o de formar preço com valor velho.
- **Compra vira ESTOQUE, não despesa** (decisão do dono, 11/08/2026): material
  comprado em janeiro e usado em março não pode afundar janeiro. Daí o grupo
  **6 (Ativos) / 6.1.01 Estoque de materiais** e a natureza `asset`, a única que
  **não entra na DRE**. O custo vira **2.2** no consumo (E4).
- **Quem opera:** entrada, mínimo e inventário = **Gerente + Admin/Financeiro**;
  consumo avulso = **dentista, coordenador, planner, TSB, ASB**; **recepção fora**
  (mesma lógica de contas a pagar). O catálogo de itens é da Franqueadora.
- O módulo mora em **`/estoque`**, fora do Financeiro de propósito: dentista e
  TSB precisam da tela e não podem ver financeiro.

**BAIXA AUTOMÁTICA NA CONCLUSÃO DA SESSÃO (E3, 0217).** Mesmo gancho do repasse:
a sessão passa a `done`. Nenhuma tela nova para o dentista.

- **Concluir de novo não consome de novo** — índice único por (sessão, item).
- **Reabrir NÃO devolve o material**: ele foi usado de verdade; devolver ao
  saldo seria inventar gaze que não está mais na gaveta.
- **Nunca bloqueia**: sem saldo → negativo + alerta; sem kit → não consome.
- **O que não tem kit fica visível** (`sessions_without_kit`, 30 dias) — silêncio
  aqui vira rotina, e rotina vira saldo que ninguém confia.
- **O consumo é o PREVISTO, não o medido.** Usou duas anestesias? Registro
  avulso corrige. A tela declara isso.
- **O mesmo item em dois kits vira uma linha só** (soma antes de baixar).
- **Sem baixa retroativa**: ninguém sabe o que foi usado nas sessões antigas, e
  inventar consumo velho estragaria o custo médio de hoje.
- A conta do movimento saiu para `apply_stock_movement()` (sem guarda de papel);
  `post_stock_movement()` virou a porta com a guarda. **Uma conta só** — duplicar
  a matemática nos dois caminhos é como eles passam a divergir.

**VENDA DIRETA TAMBÉM BAIXA (0218).** Na venda direta a sessão é **criada
pronta** (`insert ... status='done'`), não criada e depois concluída — e os dois
gatilhos escutavam só `after update`. **O mesmo buraco estava no repasse do
FIN5:** procedimento vendido na venda direta nunca gerou repasse (68 sessões no
banco de teste, zero repasses, zero baixas). Agora ambos são `after insert or
update`, com `TG_OP` no lugar de `old.status` (ler OLD em INSERT levanta erro).
Sem apuração retroativa, por decisão do dono. **Regra:** gatilho de conclusão
tem de ouvir a CRIAÇÃO — há fluxo que nasce concluído.

**FRASCO ABERTO (0218/0219).** "2,78 ml de adesivo" é ficção: existe *1 frasco
pela metade*. Item marcado com `track_open_package` separa **fechados** de **em
uso**, e o consumo sai do aberto.

**ABRIR EMBALAGEM É ATO DE GENTE, NUNCA DO SISTEMA (0219 — correção do dono).**
A 0218 abria a seguinte sozinha quando a conta zerava, e a premissa estava
errada: o consumo do kit é **estimativa** (0,2 g de resina, 1 aplicação de
adesivo) e estimativa não sabe se o frasco acabou. Abrir sozinho faria o sistema
afirmar um fato físico que ele não conhece, e o saldo de fechados cairia por
conta própria. Agora `in_use_quantity` **pode ficar negativo** — é a estimativa
dizendo *"pela conta este frasco já deveria ter acabado"*, não um erro — e o
sistema **avisa** (`packages_running_out`) em vez de decidir.

**A troca de embalagem é o MOMENTO DA VERDADE.** `open_stock_package()` é
manual, e é onde a estimativa se acerta com a realidade: a sobra (ou a falta) da
anterior vira **ajuste com motivo**, em vez de ser arrastada para a próxima —
senão o erro de uma embalagem contamina todas as seguintes. O movimento
`abertura` é reclassificação: não move valor. A conta do custo não muda.

**ENVIAR PARA USO É PARA QUALQUER EMBALAGEM (0220).** Não é só resina e adesivo:
**caixa de sugador e pacote de algodão também saem inteiros** — ninguém retira 40
sugadores da caixa, retira a caixa. Botão em cada item (`units_per_purchase > 1`).
Regra única do consumo: **sai do que está EM USO; sem nada em uso, sai do
fechado** — com uma exceção deliberada para o item fracionado
(`track_open_package`), onde sai do "em uso" mesmo sem nada aberto, ficando
negativo: é o único jeito de dizer "usaram resina sem ninguém ter aberto tubo".
Para sugador isso seria ruído; para resina é a informação. **O que resta aparece
em PERCENTUAL** — "~35% do frasco" é honesto; "7 aplicações" sugere uma precisão
que a estimativa não tem. Enviar reforço **não** encerra a embalagem anterior; o
acerto só acontece quando ela é dada por encerrada.

**GORRO/MÁSCARA/PROPÉ — duas coisas diferentes (0218).**
- **Do paciente** (gorro, propé, babador) → **kit de atendimento**
  (`stock_kits.kind = 'atendimento'`), baixado **uma vez por atendimento**
  quando `appointments.attendance` vira `done`. Quem faz três procedimentos na
  mesma consulta não usa três gorros. Não se liga a procedimento.
- **Do profissional** (máscara e gorro dele) → item de **uso geral**
  (`general_use`), fora dos kits de procedimento, baixado por lançamento avulso
  quando a caixa vai para a sala. **O custo dele já está na HORA DE CADEIRA** do
  precificador: é estrutura. Rateá-lo por procedimento contaria duas vezes e
  inflaria o preço sugerido.

**A COMPRA ENTRA NA CONTABILIDADE (E4, 0221).** As duas metades da decisão:
**comprar não é gastar** (a nota vira conta a pagar em **6.1.01**, ativo, fora do
resultado) e **gastar é usar** (o consumo vira custo em **2.2.01**, na
competência do procedimento). Cada movimento também baixa o ativo, então o saldo
de 6.1.01 **é** o valor do estoque — e `stock_ledger_check()` compara com a
prateleira.

- **Perda não é custo de procedimento** (dono, 12/08/2026): consumo em
  **2.2.01**, quebra/vencimento/inventário em **2.2.02**. Juntos, o custo dos
  procedimentos subiria por material que caiu no chão, e o desperdício ficaria
  invisível dentro do custo do serviço. A conta 2.2 virou grupo.
- **Um lançamento por movimento**, não consolidado mensal: rastreabilidade é
  invariante do módulo. Consolidar depois é fácil; recuperar rastro não é.
- `register_stock_purchase()` cria nota, entradas e contas a pagar **numa
  transação** — se a conta a pagar falhasse depois das entradas, o estoque
  subiria sem a obrigação e a conferência nunca mais fecharia. As parcelas
  precisam fechar com o total da nota.
- **Limites declarados:** nota com serviço junto → só as linhas de estoque aqui,
  frete/serviço seguem em Contas a Pagar; **devolução ao fornecedor** fica de
  fora; **entrada manual não contabiliza** (não há documento nem obrigação) e a
  conferência mostra a diferença em vez de escondê-la; nada retroativo.

**INVENTÁRIO, REPOSIÇÃO E EXCESSO (E5, 0222).**

- **A DIFERENÇA É A INFORMAÇÃO**, não um erro a apagar: ela mede perda, furto,
  kit mal cadastrado e consumo fora do previsto. Por isso a contagem vira
  **movimento de ajuste com motivo**, nunca correção silenciosa do saldo.
- **A CONTAGEM CONGELA O ESPERADO** (`expected_quantity` na linha). Entre contar
  e aplicar pode haver atendimento; se o ajuste fosse "deixe o saldo igual ao
  contado", ele **apagaria esse consumo legítimo**. O ajuste é
  `contado − esperado no momento da contagem`.
- **Contar e corrigir são atos diferentes:** a folha fica `aberta` e só vira
  ajuste quando aplicada. Uma contagem aberta por unidade (`COUNT_ALREADY_OPEN`).
- **Sobra e falta aparecem separadas** — compensar as duas esconderia que faltou
  um item caro e sobrou um barato.
- **Acima do máximo é alerta** (`overstocked_items`): falta todo mundo olha,
  sobra ninguém olha — e é dinheiro parado, ou perda programada em material com
  validade.
- **Reposição em EMBALAGENS**, arredondada para **cima** (meia caixa não existe;
  faltar custa mais que sobrar um pouco). Sem máximo, o alvo é o **dobro do
  mínimo** — repor até o mínimo deixaria o item em alerta no dia seguinte.

**Ordem:** E1+E2 ✅ (cadastro, saldo, movimentos, kit) → **E3** ✅ baixa
automática → **E4** ✅ compra + razão → **E5** ✅ inventário, reposição e excesso.
**MÓDULO ESTOQUE COMPLETO** — mais a **leitura do XML da NF-e** (0223).

**MÓDULO COMPRAS — plano aprovado e CONGELADO** em `docs/COMPRAS.md` (12/08/2026).
Retomar **depois de fechar o Financeiro** (FIN6 → FIN7 → FIN8). A regra que
organiza o módulo: **a negociação é da rede, o dinheiro é da unidade** — a
franqueadora consolida e negocia por todas, mas cada unidade aprova, é faturada,
paga e recebe a sua parte. Etapas C1 (necessidade + previsão pelo histórico) →
C2 (consolidado e cotação) → C3 (aprovação e pedido) → C4 (dashboard, com
*economia da negociação* e *compras por fora* como indicadores). **Três decisões
seguem em aberto** — ler o documento antes de começar.

**O PROBLEMA DA NOTA NÃO É LER, É SABER QUE ITEM É AQUELE.** O fornecedor
escreve `RESINA COMP Z350XT A2 4G 3M`; no cadastro está `Resina composta A2`.
Nenhuma regra de texto faz um virar o outro, e a mesma resina tem descrição
diferente em cada distribuidor. **Casar por nome é a maneira certa de gravar
material errado dando baixa em procedimento errado.**

**Casa-se por CÓDIGO, em três degraus:**
1. **GTIN** (`stock_items.gtin`) — identifica o produto **no mundo**, então um
   fornecedor novo já é reconhecido de primeira. Validado com dígito verificador:
   a NF-e aceita "SEM GTIN" e alguns emissores põem lixo no campo, e um GTIN
   inválido virando chave amarraria dois produtos ao mesmo item, em silêncio.
2. **CNPJ + `cProd`** (`supplier_item_links`) — aquele item naquele fornecedor.
3. **Descrição** — só **sugere**, nunca casa. E é a **confirmação de alguém** que
   cria o vínculo: por isso o sistema acerta mais a cada nota, em vez de errar
   mais.

**O de-para é DA REDE** (chaveado por CNPJ, não por `supplier_id`): o que Cambé
amarra uma vez, Londrina recebe pronto.

**A mesma nota não entra duas vezes** — `nfe_key` (44 dígitos) única por unidade;
importar de novo dobraria estoque **e** conta a pagar. **O XML fica no Storage**
(bucket privado `nfe`): é documento fiscal. **O XML é lido no NAVEGADOR**
(`DOMParser` nativo, sem dependência nova) e nada é gravado antes da conferência.

**Fora do escopo:** download automático da SEFAZ (exige certificado A1),
**PDF/DANFE** (exigiria OCR — errar número aqui contamina custo médio e preço de
todo procedimento) e notas de serviço.

**PADRÃO DE NOME DO NOSSO ITEM:** o que tem campo próprio **não** entra no nome
(marca, embalagem, fator, GTIN). `Resina composta A2`, não
`Resina 3M Z350 A2 seringa 4g` — senão o mesmo item vira dois no consolidado da
rede e ninguém descobre até o relatório sair errado.
**Transferência entre unidades** fica para o fim da E5 (os tipos já existem no
banco, sem tela). **Controle por lote** (baixa pelo que vence primeiro, recusa de
vencido) fica para depois da E3, por decisão do dono.

## 8d. FIN6 — DRE e Fluxo de Caixa (em construção)

**Decisões do dono (12/08/2026), na tela de perguntas:**

- **Depreciação = cadastro de bens**, não lançamento manual (ele escolheu contra
  a minha recomendação de prazo; a escolha é melhor a longo prazo — a DRE passa
  a consumir número calculado em vez de digitado).
- **Competência da DRE = liquidado + em aberto.** Previsto, estornado e
  cancelado ficam fora. A venda de março aparece em março mesmo que o cliente
  pague em junho — é a definição de competência.
- **Fechamento de período fica para o FIN7.** Trava é assunto de processo, e
  travar antes de conferir os primeiros meses só atrapalharia.
- **Centro de custo = filtro na mesma tela da DRE**, não relatório separado.

**BENS E DEPRECIAÇÃO (FIN6.0, 0224).** **Comprar um bem não é gastar** — mesma
regra do estoque. Cadeira de R$ 30 mil não afunda o mês da compra: nasce em
**6.2.01 (ativo)** e vira R$ 250/mês por dez anos em **5.2.01**, que é o que
custa usá-la.

- **Depreciação linear, e a ÚLTIMA PARCELA ABSORVE O RESÍDUO** — mesma regra das
  parcelas de venda. Sem ela, R$ 10.000 em 36 meses deixaria centavos órfãos e o
  bem nunca zeraria.
- **Começa no mês SEGUINTE à entrada em uso**, e `in_service_date` ≠ data da
  compra: equipamento comprado em dezembro e instalado em fevereiro deprecia a
  partir de março.
- **Depreciar de novo não duplica** (único por bem+mês) e **nunca deprecia além
  do custo**.
- **Vida útil com padrão por categoria, EDITÁVEL** — padrão que ninguém pode
  mudar vira número errado com cara de oficial. Valor residual **zero**.
- **Baixa** (`dispose_asset`) para a depreciação e joga o valor restante em
  **5.2.02**; sem ela o sistema depreciaria para sempre uma cadeira que foi para
  o lixo. **Limite declarado:** venda de bem registra a baixa contábil; o
  dinheiro recebido é lançado à parte.
- Código **`AT-`** — o código do documento nunca some.

**A DRE (FIN6.1, 0225).** Por **competência**: liquidado + em aberto, filtrado
por período e por centro de custo. Estrutura do documento base — receita bruta →
deduções → **receita líquida** → custos diretos → **lucro bruto** → despesas
operacionais → **EBITDA** → depreciação → resultado financeiro → **lucro
líquido**.

- **O SINAL VEM DA DIREÇÃO** (entrada soma, saída subtrai), então cada subtotal é
  soma acumulada. Sem isso seria preciso manter uma tabela "esta conta subtrai,
  aquela soma" em sincronia com o plano de contas — e ela ficaria desatualizada
  no dia em que alguém criasse uma conta.
- **Estorno some dos DOIS lados** (`status in (settled, open) and reversal_of is
  null`). Filtrar só por status deixaria o contra-lançamento sozinho, e a receita
  estornada entraria **com o sinal invertido**, virando despesa.
- **Fora da DRE:** 6 (ativos), **5.1** (comprar bem não é gastar — entra pela
  depreciação; contar os dois seria contar duas vezes), **5.3** (empréstimo é
  troca de dívida por caixa) e **5.4** (distribuição sai DEPOIS do lucro).
- **Análise vertical sobre a receita LÍQUIDA**, não a bruta: sobre a bruta toda
  unidade pareceria mais eficiente, e o erro seria maior onde o imposto é maior.
- **Comparação com período de MESMO tamanho** — comparar janeiro (31 dias) com
  fevereiro (28) mostraria queda que é só calendário.
- **Toda linha abre os lançamentos** até o documento (a invariante do FIN0
  finalmente na tela).
- **Verde = melhorou o resultado, sempre.** Como o sinal já vem da direção, não
  existe "linha boa quando sobe": custo caindo de −1.200 para −1.000 dá delta
  positivo igual a receita subindo.

**A DRE SOMAVA O DOBRO (0226 — correção da 0225).** Conferência no razão contra
os dados reais, antes de o dono terminar o teste. Duas causas independentes:

- **LIQUIDAÇÃO NÃO É FATO GERADOR.** O razão grava **duas linhas por venda**, de
  propósito desde o FIN0: competência (`installment_accrual`, sem `cash_date`) e
  caixa (`receipt_cash`, com `cash_date`). A 0225 somava as duas — parcela paga
  virava receita de novo, conta paga virava despesa de novo (R$ 4.416 + R$ 5.096
  das MESMAS parcelas). **Regra geral: relatório de competência lê uma linha,
  relatório de caixa lê a outra — nunca as duas.** `receipt_cash` e
  `payable_cash` são as duas únicas origens de pura liquidação; tudo o mais
  (multa, juros, taxa de adquirente, boleto, extrato conciliado) **nasce já
  pago e é o único registro do fato** — excluí-las apagaria a despesa.
- **VENDA CANCELADA CONTINUAVA COMO RECEITA** (43 parcelas, R$ 10.941). Contas a
  pagar já cancelavam o lançamento desde a 0194; o recebimento nunca fez.
  **Regra: toda mudança de status do documento tem de chegar ao razão** — o
  documento é a verdade, e relatório que lê razão desatualizado mente com cara
  de número oficial. Gatilho nos dois sentidos (descancelar devolve a receita) e
  guarda `paid_amount_cents = 0`: parcela cancelada que já recebeu mantém a
  receita, senão o dinheiro ficaria no caixa sem origem no resultado.
- **Renegociação não muda:** a parcela vira `renegociada` (≠ `cancelada`) e
  mantém o lançamento — a receita foi reconhecida na venda (regra da 0189).

**O FLUXO DE CAIXA (FIN6.2, 0227).** A outra pergunta, a que quebra clínica
lucrativa: **vai faltar dinheiro, e quando?** As duas metades vêm de lugares
diferentes, de propósito:

- **Realizado = o RAZÃO, pela `cash_date`** — exatamente o que a DRE passou a
  ignorar na 0226. Os dois relatórios leem o mesmo razão por metades opostas, e
  por isso nunca divergem da origem.
- **Previsto = os DOCUMENTOS** (parcelas e contas), pelo que **ainda falta**
  (valor − já pago). O razão guarda o valor CHEIO da parcela; projetar por ele
  faria a parcela de R$ 500 já recebida pela metade entrar como R$ 500.
- **Data do previsto = `expected_settlement_date`**, senão o vencimento: cartão
  liquida em D+30, e usar o vencimento mostraria o dinheiro um mês antes de ele
  existir.
- **VENCIDO NÃO ENTRA NA PROJEÇÃO** (decisão do dono): já falhou uma data;
  contá-lo de novo é como projeção de caixa mente para o lado otimista — e o
  erro otimista é o que quebra caixa. Aparece à parte, para ser cobrado.
- **Conta esperando autorização ENTRA na saída prevista**, ao contrário da DRE.
  Regras diferentes porque as perguntas são diferentes: para o resultado ainda
  não é despesa reconhecida; para o caixa é conta que quase certamente será paga.
- **O aviso sai da série DIÁRIA**, sempre — agrupado por mês, um buraco no dia 8
  coberto por um recebimento no dia 25 desapareceria, e é justamente ele que faz
  o cheque voltar.
- **Atividade:** operacional / investimento (5.1) / financiamento (5.3, 5.4).
  Separa "a operação gera caixa" de "fechou no azul porque vendeu uma cadeira".
- **Saldo de partida** = saldo inicial das contas bancárias (campo que a
  Conciliação já pede) + o caixa anterior. Sem conta cadastrada começa em zero
  **e a tela diz isso** — saldo incompleto declarado é honesto; inventado vira
  decisão errada.
- A conta (régua de dias vazios, saldo acumulado, agrupamento) mora em
  `src/lib/finance/cash-flow.ts`, com teste. O SQL devolve só os dias COM
  movimento.
- **Limites declarados na tela:** projeção bruta (a taxa da adquirente entra
  quando o dinheiro entra); sem calendário de feriados; conta recorrente só
  entra depois de gerada.

**`security definer` SEM GUARDA ENTREGA O DADO A QUEM CHAMAR (0227).** Função
`security definer` roda como dona do banco e **passa por cima do RLS** — a DRE,
o drill-down e a lista de bens nasceram sem checagem, então qualquer usuário
logado poderia ler o relatório de outra unidade pela API, mesmo sem enxergar a
tela. Agora existe **`can_see_clinic_finance(clinic_id)`**, uma função só, usada
por todos: guarda copiada solta vira duas versões da mesma régua.

**PONTO DE EQUILÍBRIO E A PONTE LUCRO × CAIXA (FIN6.3, 0228).**

- **Fixo × variável já existia** (`chart_of_accounts.cost_behavior`, semeado no
  FIN0 e **editável no Plano de contas**). Nenhuma coluna nova: a classificação
  é do dono, não do código — margem calculada sobre rótulo que ninguém pode
  corrigir vira número errado com cara de oficial.
- **DOIS pontos de equilíbrio, não um.** O contábil inclui a depreciação; o de
  **caixa** não. Respondem perguntas diferentes ("estou destruindo valor?" ×
  "vai faltar dinheiro este mês?"), e mostrar só um esconde a outra.
- **Receita financeira abate o custo fixo**, não entra na receita: somá-la à
  base inflaria o faturamento e faria o ponto parecer mais perto do que está.
- **Margem de contribuição ≤ 0 não tem ponto de equilíbrio** — a tela diz que o
  problema é preço ou custo direto, não volume. A conta daria um número
  negativo ou gigante, e um número absurdo com cara de resposta é pior que
  nenhum.
- **O dia da virada** ("passou do ponto por volta do dia 21") é declarado como
  régua, não previsão: o movimento não é igual todo dia.
- **A PONTE FECHA POR CONSTRUÇÃO.** Cada lançamento cai em um de três baldes —
  só competência, só caixa, ou os dois — e daí sai `caixa = lucro − (só
  competência) + (só caixa)`, porque a parte comum é a mesma soma dos dois
  lados. Existe `residualCents`: **se sobrar um centavo, a tela mostra qual
  lançamento escapou**, em vez de fechar com uma linha "outros" que esconde
  erro. Nada cai em balde genérico — conta sem categoria aparece pelo código.

**Ordem:** 6.0 bens ✅ → 6.1 DRE ✅ → 6.2 fluxo de caixa ✅ → 6.3 ponto de
equilíbrio ✅. **FIN6 fechado.**

## 8e. FIN7 — orçado × realizado, alertas e fechamento (em construção)

**Decisões do dono (17/08/2026), na tela de perguntas:**

- **A UNIDADE faz o seu orçamento; a franqueadora enxerga, não impõe.** Sem
  cascata rede→unidade: número que o gerente assumiu ele defende, número que
  caiu de cima ele explica.
- **Receita E despesa.** Sem meta de faturamento não dá para dizer se o mês foi
  ruim porque gastou demais ou porque vendeu de menos.
- **Realizado = COMPETÊNCIA**, o mesmo recorte da DRE. Comparar com o que já foi
  pago faria toda conta em aberto parecer economia, e o mês fecharia parecendo
  melhor do que foi.

**ORÇAMENTO (FIN7.1/7.2, 0229).** `budget_lines` por clínica/ano/mês/conta.

- **A META É GUARDADA COM O SINAL DO REALIZADO** (receita positiva, despesa
  negativa). Assim `realizado − orçado` positivo significa **sempre** "melhor
  que o previsto" — receita acima da meta e despesa abaixo dela dão o mesmo
  sinal. É a mesma lição da DRE: uma regra só, sem tabela de "nesta conta subir
  é bom, naquela é ruim". A tela mostra e recebe magnitude; o sinal é aplicado
  em **um lugar só** (`budget_sign` no banco, espelhado em `budgetSign` no TS).
- **Meta zero apaga a linha** — meta zerada e meta inexistente são a mesma
  coisa; guardar as duas mostraria "0,00" onde ninguém orçou.
- **Mês E acumulado do ano até ele.** Despesa não é uniforme: quem paga o seguro
  anual em março estoura março e fecha o ano no lugar. Comparar o acumulado
  contra a meta do ano INTEIRO diria que março está 75% abaixo, sempre.
- **Farol com folga configurável** (5% padrão, "estourou" acima do dobro):
  orçamento acertado no centavo não existe, e farol que acende com 1% ninguém
  olha.
- **Copiar o ano anterior + sugerir pela média de 3 meses**, nenhum dos dois
  sobrescrevendo meta já preenchida. Orçamento em branco não é preenchido: 12
  meses × 30 contas é trabalho que ninguém faz duas vezes. A sugestão é
  **rascunho declarado** — a média achata o sazonal.
- **Limite declarado:** orçamento sem centro de custo. Orçar por centro exigiria
  ratear realizado que hoje nasce sem centro, e rateio inventado é pior que
  ausência de rateio.

**ALERTAS (FIN7.3, 0230).** Quatro regras, uma vez por dia às 9h, por pg_cron:
orçamento de DESPESA passando de 90% da meta, caixa projetado ficando negativo,
faturamento atrás do ponto de equilíbrio perto do fim do mês, atraso acumulado
acima do limite.

- **ALERTA QUE REPETE TODO DIA É ALERTA QUE NINGUÉM LÊ.** `finance_alerts` guarda
  (unidade, regra, referência) e o aviso sai **uma vez**; só rearma quando a
  condição some e volta (`cleared_at`). Sem isso o gerente ganharia quatro
  notificações por dia até o fim do mês e ignoraria todas.
- **RODA SEM USUÁRIO — e isso obrigou uma separação.** No cron `auth.uid()` é
  nulo e toda guarda recusaria tudo. As contas foram para funções **`_raw`** (sem
  guarda) e as públicas viraram casca com a guarda — mesmo desenho de
  `apply_stock_movement` × `post_stock_movement`. **As `_raw` levam `revoke ...
  from public`:** no Postgres função nova nasce executável por TODO MUNDO, e uma
  conta sem guarda exposta assim entregaria o número de qualquer unidade.
- **O alerta de orçamento só vale para DESPESA** — 90% da meta de receita no meio
  do mês é notícia boa.
- **Quem recebe: só a unidade** (gerente e franqueado). Franqueadora fora: com
  200 unidades seriam centenas de avisos/dia, e rede é assunto de painel (FIN8).
- **`brl()` formata dinheiro sem depender do idioma do servidor** — `to_char`
  com `G`/`D` usa a configuração regional e o mesmo alerta sairia "1,234.56" ou
  "1.234,56" conforme o servidor.
- **A unidade ajusta os próprios limites** (`save_alert_settings`, porta estreita
  para as colunas de alerta); multa e juros continuam sendo regra da rede.

**A CASCATA DA `finance_settings` NUNCA FOI CASCATA (corrigido na 0230).** Ela
sempre disse resolver "campo a campo", mas as quatro colunas antigas eram NOT
NULL com padrão: toda linha de unidade já nascia com 2,00/1,00/0/half_up e o
`coalesce` nunca chegava na rede. Ficou escondido enquanto só a Franqueadora
criava linha de unidade; ao deixar a UNIDADE criar linha para ajustar alerta,
ela congelaria multa e juros nos padrões — mudança futura da rede jamais
chegaria nela, sem nada na tela denunciando. Colunas passaram a anuláveis e a
tela resolve contra a rede antes de exibir. **Regra: configuração em cascata só
funciona com coluna ANULÁVEL na linha que sobrescreve.**

**Ordem:** 7.1/7.2 orçamento ✅ → 7.3 alertas ✅ → **7.4 fechamento de
competência**. A trava do 7.4 **não pode valer para pagamento e recebimento**:
pagar hoje uma conta de janeiro não muda o resultado de janeiro (desde a 0226
essas linhas nem entram na DRE), e travá-las quebraria o trabalho da recepção no
dia seguinte ao fechamento.

**Roadmap:** FIN0 fundação ✅ → FIN1 contas a receber ✅ → FIN2
renegociação ✅ → FIN3 contas a pagar ✅ → FIN4 conciliação ✅ → FIN4 conciliação OFX + adquirente →
FIN5 repasse/split → **Estoque** → **Rentabilidade por serviço** → FIN6 DRE+DFC
→ FIN7 orçado×realizado e alertas → FIN8 franqueadora/royalties/consolidação.
**Uma fase por vez, com plano aprovado antes do código.**

## 9. Convenções de trabalho com o proprietário (Jeferson)

- Ele **não é programador**: explicar decisões em linguagem simples (analogias
  ajudam), em **português do Brasil**.
- Antes de codar cada etapa: apresentar um **plano resumido e aguardar o OK**.
  Consultá-lo antes de escolhas difíceis de reverter.
- Ao final de cada etapa: dizer **exatamente como testar** (roteiro numerado).
- **Código com nomes em inglês; interface 100% em pt-BR.** Rotas em português
  (`/clientes`, `/admin/usuarios`).
- Ele não edita arquivos: para segredos, usar o fluxo da área de transferência
  (ele copia no painel, avisa, e o assistente lê via `Get-Clipboard`, valida e
  grava sem exibir). **Uma tarefa de clipboard por vez.**
