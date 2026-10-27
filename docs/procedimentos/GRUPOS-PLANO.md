# Grupos de procedimentos — plano

**Pedido do dono (27/10/2026):** *"Em procedimentos, deve ter a possibilidade de
criar grupo de procedimentos para que no planejamento seja mais fácil e prático
definir um planejamento, por exemplo de um grupo de procedimentos, implante +
prótese sobre implante, tratamento de canal + restauração e etc."*

## 1. O que existe hoje (conferido no código)

- Não existe grupo, pacote nem combinação de procedimentos — nem no catálogo,
  nem no plano. (O "kit" do Estoque é outra coisa: material que um
  procedimento consome.)
- No plano, o Planner lança **um procedimento por vez** (`addBudgetItem`):
  escolhe no catálogo, o preço vem do catálogo (OC-00067, fixo), as sessões e
  o tempo vêm do protocolo, e o dente vem do odontograma (OD3: um item por
  dente; face só para quem é de face; região para quem é de região).
- Montar "implante + prótese sobre implante" no 36 hoje = dois lançamentos,
  escolhendo o 36 duas vezes. Num plano com 6 implantes, são 12 lançamentos.
- A regra do dente **já** considera o que a mesma opção planeja: a prótese
  sobre implante só entra num dente com implante, e aceita o implante que
  acabou de ser planejado ali (`plan_item_location_check`, 0311). Por isso a
  **ordem dentro do grupo importa** — o implante entra antes da prótese.

## 2. A proposta

**O grupo é um ATALHO para lançar, não um procedimento novo.** Ao usar o grupo
no plano, cada procedimento dele vira um item normal do plano, exatamente como
se tivesse sido lançado à mão: preço do catálogo, sessões do protocolo, dente
pela regra do odontograma, aprovação do Coordenador, sessões, repasse e baixa
de estoque — **nada disso muda**, porque nada disso fica sabendo que existe
grupo.

Por que não um "procedimento combinado" com preço próprio: o preço, o repasse
ao dentista, o kit de material e o dente moram no procedimento. Um combinado
com preço próprio seria um segundo catálogo, que divergiria do primeiro no
primeiro reajuste.

### 2.1 Cadastro (em Procedimentos)

- Nova seção **Grupos de procedimentos** na tela `/procedimentos`.
- Um grupo tem: **nome** ("Implante + prótese sobre implante"), descrição
  opcional, e a **lista de procedimentos em ordem**, cada um com quantidade
  (padrão 1).
- Mostra o **total de referência** (soma dos preços do catálogo hoje) — só
  para conferir; quem cobra é cada item.
- Editar, inativar. Grupo nunca usado pode ser excluído; usado, só inativado
  (mesma regra do catálogo).
- Procedimento inativo dentro de um grupo: o grupo avisa e o lançamento pula
  esse procedimento, dizendo qual.

### 2.2 Uso no plano

- Ao lado do botão **+ Procedimento**, um botão **+ Grupo**.
- Escolhe o grupo → o sistema mostra os procedimentos que vão entrar, com o
  preço de cada um e o total.
- **O dente se escolhe UMA vez** e vale para todos os procedimentos de dente
  do grupo. Vários dentes = o grupo inteiro em cada dente (6 dentes × implante
  + prótese = 12 itens, num clique).
- Procedimento de **face** (restauração) pede as faces ali mesmo; de
  **região/arcada** pede a região; o que **não se marca no dente** entra sem
  lugar. Conflito de situação (ex.: dente ausente) pede o motivo, como hoje.
- **Ou entram todos, ou nenhum** (uma gravação só): metade do grupo lançada
  seria pior que nada.

### 2.3 O que NÃO muda

Preço (do catálogo, congela no envio), aprovação por opção, orçamento impresso,
apresentação, negociação, sessões, repasse, estoque, odontograma.

## 3. Banco (migração 0324)

- `procedure_groups` (nome, descrição, ativo, quem criou/alterou) e
  `procedure_group_items` (grupo, procedimento, ordem, quantidade). Da REDE,
  como o catálogo. RLS: lê quem lê o catálogo; grava quem a decisão GP1
  disser. Auditoria (`audit_attach_all`).
- Se GP2 = etiqueta: coluna anulável `procedure_group_id` no item do plano.
- A gravação dos itens continua passando pelas mesmas travas de hoje
  (catálogo, preço, dente) — o grupo não abre porta nova.

## 4. Decisões do dono

| | Pergunta | Decisão |
|---|---|---|
| GP1 | Quem cria e edita os grupos | **Admin Master e Planner**; os grupos valem para a rede inteira (27/10/2026) |
| GP2 | Depois de lançado, o plano lembra do grupo? | **Itens soltos + etiqueta** "do grupo …" no plano (27/10/2026) |
| GP3 | O orçamento e a apresentação ao paciente mostram o grupo? | **Não** — item a item, como hoje (27/10/2026) |

As três como recomendado.

## 5. Entregue (0.350.0 / migração 0324, 27/10/2026)

- **0324:** `procedure_groups` + `procedure_group_items` (ler: todo logado;
  gravar só por `save_procedure_group`, `set_procedure_group_active`,
  `delete_procedure_group` — Admin Master ou Planner); coluna
  `procedure_group_id` no item do plano, com o gatilho `plan_item_group_check`
  (a etiqueta cai, sem recusar, se o procedimento não está no grupo — a cópia
  para nova versão não quebra). Excluir grupo usado: `GROUP_IN_USE`.
  Procedimento num grupo não se exclui do catálogo (a ligação segura; a tela
  explica).
- **Regra pura:** `src/lib/procedimentos/grupos.ts` (`montarLancamento`:
  dente a dente, na ordem do grupo; o que entrou conta para o próximo do mesmo
  dente — a mesma régua de `odontograma/plano.ts`).
- **Telas:** `/procedimentos/grupos` (link **Grupos** em Procedimentos) e o
  botão **Grupo** no plano (`lancar-grupo.tsx`), com a ação
  `addProcedureGroup` — uma gravação só; o preço quem põe é o banco.
- **Etiqueta** no item (ficha e cockpit); a cópia de plano leva a etiqueta.
- ⚠️ **Provado no ensaio:** exodontia + implante no mesmo dente, NUMA
  gravação e nessa ordem, entram sem motivo (o gatilho de linha enxerga a
  linha anterior do mesmo comando). Ao contrário, o implante pede motivo.
- **Não visto na tela:** procedimento de face e de região dentro de um grupo
  e o aviso de situação no grupo — presos por teste (EV-224).
