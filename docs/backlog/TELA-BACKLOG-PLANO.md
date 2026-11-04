# Tela do Backlog — plano (04/11/2026)

Pedido do dono: uma tela no riSZon, **só para ele**, com a lista viva do
backlog — cada item detalhado, os abertos e os já resolvidos —, classificada
por **categoria** e **prioridade**, onde ele seleciona um ou vários itens e
monta o pedido para uma sessão resolver. E, nos relatos da boia, além de
"Preparar briefing" (como hoje), poder **enviar o relato para o backlog**.

## Decisões do dono (04/11/2026)

- **B-D1 — a lista mora no BANCO**, não mais no `docs/BACKLOG.md`. A tela lê e
  grava na hora; a boia manda o relato direto; prioridade e categoria mudam
  pela tela. As sessões do Claude passam a abrir e fechar itens por um comando
  (`npm run backlog …`). O `BACKLOG.md` fica como **histórico** (congelado,
  com um aviso no topo apontando para a tela).
- **B-D2 — prioridade em 4 níveis:** **Urgente** (impede o trabalho, risco de
  segurança ou LGPD), **Alta**, **Média**, **Baixa**. A prioridade inicial dos
  itens abertos é proposta pela sessão e o dono ajusta na tela.
- **B-D3 — categorias (04/11/2026):** a lista proposta serve, e ela **cresce e
  muda com o uso** — categoria é cadastro (`backlog_categories`), não lista
  fixa no código: o dono cria, renomeia e desativa na tela, e a sessão pode
  propor uma nova quando um achado não couber em nenhuma.
- **B-D4 — relato enviado ao backlog fica "Em análise"** até o item ser
  resolvido; aí ele aparece para o dono responder.
- **B-D5 — contadores:** a tela mostra quantos estão **abertos** e quantos
  **resolvidos** (e, nos abertos, quantos por prioridade).

## Como fica

### 1. Banco (migração única do núcleo, número na hora — hoje seria 0366)

`public.backlog_items` — um item:

| campo | o quê |
|---|---|
| `code` | `AP1`…`AP111` mantidos; os novos seguem a numeração (`AP112`…) |
| `title`, `detail` | título e o detalhe (o texto da seção do BACKLOG.md, em Markdown) |
| `category_id` | a categoria (tabela `backlog_categories`, editável) |
| `module` | o mesmo catálogo de módulos dos relatos (`MODULOS` de `system-reports.ts`) |
| `priority` | `urgente` · `alta` · `media` · `baixa` |
| `status` | `aberto` · `aguardando_dono` · `em_andamento` · `resolvido` · `descartado` |
| `resolved_version`, `resolved_at`, `resolution` | como foi resolvido (versão, data, uma linha) |
| `origin` | `backlog_md` (importado) · `relato` · `sessao` · `dono` |
| `report_id` | o relato que originou o item, quando veio da boia |

`public.backlog_categories` — nome, ordem, ativa. Começa com as oito abaixo.

`public.backlog_item_events` — a linha do tempo do item (criado, prioridade
mudou, categoria mudou, entrou em andamento, resolvido, nota do dono).

**Acesso:** só o **Admin Master** lê e grava (RLS com `is_admin_master()`);
sem login, nada. As sessões gravam com a chave de serviço, pelo comando.

**Categorias iniciais** (aprovadas pelo dono; editáveis):
Defeito · Segurança e LGPD · Decisão do dono · Melhoria · Desempenho ·
Limpeza técnica · Tarefa do dono (fora do sistema) · Adiado.

### 2. Importação do que já existe

Um comando lê o `BACKLOG.md` e grava, sem duplicar (por `code`):

- as **111 seções AP** (abertas e resolvidas), com o texto inteiro da seção
  como detalhe, a data, a versão e a migração de quando foi resolvido;
- os itens abertos do índice que não são AP (adiados antigos, tarefas do
  dono, grupos de procedimentos, OC-00133), cada um com código novo.

Os lotes antigos (A a F, Etapas, Jornada…) são **registro de entrega**, não
pendência: ficam só no arquivo. Roda primeiro no treino, depois na produção.

### 3. A tela — Admin → **Backlog** (`/admin/backlog`)

- **Abas:** Abertos · Resolvidos · Todos, cada uma com o número de itens.
  No topo: total aberto, total resolvido e os abertos por prioridade.
- **Filtros:** categoria, prioridade, módulo, situação, busca por código ou
  texto. A lista vem agrupada por prioridade (Urgente primeiro).
- **Cada item:** código, título, selos de categoria/prioridade/módulo, há
  quantos dias está aberto; ao abrir, o detalhe completo, o relato de origem
  (link) e a linha do tempo. O dono muda prioridade, categoria e situação e
  escreve uma nota.
- **Categorias:** janela para criar, renomear, ordenar e desativar (categoria
  com itens não se apaga, só desativa).
- **Seleção de um ou vários itens** → barra do lote (o mesmo desenho da tela
  de Problemas):
  - **Preparar pedido para resolver** — monta o texto (códigos, títulos,
    detalhes, a regra de trabalho do projeto) numa caixa **editável** para
    copiar e colar numa sessão; os itens passam para **Em andamento**;
  - mudar prioridade ou categoria de todos de uma vez.
- Fica no menu Admin só para o Admin Master.

### 4. Relato → backlog (tela de Problemas, aberta pela boia)

- No relato e na barra do lote de relatos, ao lado de **Preparar briefing**:
  **Enviar para o backlog**. Abre a mesma caixa revisável (o relato é texto
  livre e pode ter nome de paciente — LGPD: o dono revisa antes de gravar; o
  nome de quem relatou não entra), com título, categoria, prioridade e
  módulo já sugeridos pela gravidade e pela tela do relato.
- O item nasce com `origin = relato` e o vínculo ao relato; o relato mostra
  "No backlog: AP1xx". Vários relatos do mesmo defeito podem ir para um item só.
- Quando o item é resolvido, o relato ligado aparece para o dono responder
  (ele decide; não responde sozinho).

### 5. As sessões do Claude

- `npm run backlog -- listar` · `novo` · `resolver AP56 --versao 0.397.0
  --nota "…"` · `andamento AP56`. Grava na produção (`.env.local`) e mostra o
  que gravou; `--treino` para o treino.
- O CLAUDE.md troca a regra "marcar no BACKLOG.md" por "registrar pelo
  comando". O índice do arquivo deixa de ser mantido.

## Fases

| fase | o quê | prova |
|---|---|---|
| **BK1** ✅ 0.399.0 (0366) | migração (tabelas, RLS, linha do tempo), importação, comando das sessões | ensaio no treino em transação desfeita; importação conferida item a item contra o arquivo (111 AP + os não-AP) |
| **BK2** ✅ 0.400.0 | a tela: lista, filtros, detalhe, edição, abas | tela vista no treino como Admin Master; outro perfil não vê o menu nem abre o endereço |
| **BK3** ✅ 0.401.0 | seleção e "Preparar pedido para resolver" | régua do texto montado (sem dado pessoal, todos os itens selecionados) |
| **BK4** ✅ 0.402.0 (0367) | "Enviar para o backlog" nos relatos | relato do treino vira item, vínculo dos dois lados |

Cada fase com versão própria, changelog, manual e evidência, como sempre.

## Confirmado com o dono (04/11/2026)

Categorias e relato "Em análise" — ver B-D3 e B-D4.
