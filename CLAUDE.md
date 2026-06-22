# CLAUDE.md

Guia para o Claude Code (claude.ai/code) ao trabalhar neste repositório.
Regras de **produto e negócio** ficam aqui; regras de **código** ficam em
`docs/ARQUITETURA-TECNICA.md`. Detalhe da jornada em `docs/JORNADA.md`; fila de
pendências em `docs/BACKLOG.md` (ler antes de iniciar qualquer etapa nova).

@AGENTS.md
@docs/ARQUITETURA-TECNICA.md

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
npm run build   # o portão de verificação: compila + checa tipos. Rodar antes de cada commit.
npm run lint    # eslint
```

Não há testes automatizados; `npm run build` (TypeScript strict) é a única
checagem. **Particularidades da máquina (Windows 10, repo só existe aqui):**

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
cada opção (não o preço item a item) e não edita o orçamento. Próximas: F5 (fila
por situação), F6 (central de notificações), F7 (cockpit do Planner).

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

**Migrações 0001–0042 escritas.** O dono aplica cada uma no SQL Editor do
Supabase; **0001–0040 aplicadas; 0041 e 0042 pendentes** (correções do plano e
do compartilhamento).

## 8. Próximos passos (ordem de prioridade)

1. **Aplicar as migrações 0036, 0037 e 0038 (em ordem)** e testar 5.2, 5.3 e a F2.
2. **Continuar o LOTE F** (ordem F3 → F7): F3 Procedimentos (renomear, campos
   TUSS/especialidade/preço mín-máx/comissionamento/pilar, busca/filtros,
   importação .xlsx, reajuste em massa, histórico, soft-delete, acesso do Planner);
   F4 aprovação por opção; F5 fila por situação + período; F6 central de
   notificações; F7 cockpit do Planner.
3. **LOTE B — agenda avançada/consolidados** (+ contadores leves do Planner).
4. **Rodada de refinamento visual** (tela por tela, guiada pelo dono).
5. **Fase 2 (após MVP validado):** módulo comercial (ZapSign, ASAAS, NPS,
   WhatsApp manual), transcrição/resumo por IA, dashboards com metas.

Adiados (em `docs/BACKLOG.md`, não esquecer): foto por webcam; cadeiras/horários
por unidade; gênero + rótulos; offline/sync (PWA + PowerSync/ElectricSQL).

Não avançar de etapa sem o OK do proprietário.

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
