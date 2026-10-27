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
| GP3 | O orçamento e a apresentação ao paciente mostram o grupo? | **Não** — item a item, como hoje (27/10/2026). ⚠️ Revista em parte pela GP6 |
| GP4 | Onde vale o preço do grupo (desconto/acréscimo)? | **No plano** — o item lançado pelo grupo já entra com o preço do pacote (27/10/2026, §6) |
| GP5 | O grupo guarda o percentual ou o total? | **O percentual** — digita-se um ou outro; vale para qualquer nº de dentes e acompanha o catálogo (27/10/2026) |
| GP6 | O paciente vê o ajuste? | **Sim, "de … por …"** — os itens seguem um a um, mais a linha do pacote (27/10/2026) |
| GP7 | O que o preço mínimo do grupo faz? | **Trava a negociação** — abaixo dele, autorização do Gerente (27/10/2026, §7; contra a recomendação, que era só avisar) |
| GP8 | Como o mínimo é guardado? | **Em % do preço de tabela** — digita-se % ou total (27/10/2026) |

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

## 6. O preço do grupo (0.353.0 / migração 0325, 27/10/2026)

**O pedido do dono:** *"em grupo de procedimentos deve ter como propor desconto
ou acréscimo no preço dos procedimentos daquele grupo. Um lugar para configurar
o preço total do grupo com os procedimentos."*

**O que mudou de regra, de propósito** (o dono foi avisado das três antes de
decidir): (1) o grupo deixou de ser "sem preço" — passou a ter um AJUSTE sobre
o catálogo, nunca um preço próprio (o "segundo catálogo" continua evitado);
(2) o preço do item do plano deixou de ser sempre o do catálogo — é o do
catálogo ajustado pelo pacote, e quem põe continua sendo o banco; (3) o
acréscimo no plano, antes vedado (06/08), passa a existir SÓ por esta via,
definido pelo Admin Master no catálogo, nunca no plano nem na negociação.

**Quem define:** só o **Admin Master** (`set_procedure_group_price`), como o
preço do catálogo (OC-00068). O Planner monta o grupo (GP1) e vê o preço.

**Como funciona:**
- `procedure_groups.price_adjust_percent` (−99,99 a +100). Item lançado pelo
  grupo: `unit_price_cents = catálogo × (100 + %) / 100`, meio para cima, e
  `list_price_cents` = o catálogo (o "de"). Sem ajuste, `list_price_cents` nulo.
- A conta mora no banco (`group_adjusted_price` + `plan_item_group_percent`),
  na trava do item (0306) e no envio do plano (F3, 0312) — o envio refaz o
  preço com o % do DIA. Espelho em TS: `precoNoPacote` (grupos.ts).
- A tela não muda preço, "de" nem etiqueta do item (`ITEM_PRICE_LOCKED`).
- Linha do pacote: `pacotesDaOpcao` + `<LinhasDoPacote>` no plano (não na
  visão do Coordenador — F4), no orçamento impresso, na apresentação e no
  texto do Gamma (não para quem vê só os totais).

**Limites declarados:**
- Procedimento lançado à mão, mesmo que esteja num grupo, fica no catálogo.
- O desconto é por ITEM: se o Planner tirar um item do pacote do plano, os
  outros mantêm o desconto; na compra parcial do Comercial, idem.
- O repasse ao dentista é fixo: o desconto do pacote sai da margem (o alerta
  de margem da negociação já mostra).
- O plano enviado antes da 0325 não muda; itens do grupo lançados antes dela
  pegam o ajuste no envio.

## 7. Mínimo, repasse e o botão rápido (0.354.0 / migração 0326, 27/10/2026)

**O pedido do dono:** preço mínimo no grupo; ver quanto a unidade paga de
repasse em % do que é cobrado no pacote, "como aparece nas configurações dos
procedimentos"; botão rápido no procedimento para vincular a um grupo; ver em
quais grupos o procedimento está.

**Achado antes de decidir:** o preço MÍNIMO do PROCEDIMENTO não trava nada
hoje — é gravado e aparece na faixa de preço, mas nenhuma tela o confere. Por
isso o dono decidiu, para o grupo, o que o mínimo FAZ (GP7).

**O mínimo (0326):**
- `procedure_groups.min_price_percent` (nulo = sem mínimo; 0,01 a 200, e
  nunca acima de 100 + ajuste — `MIN_ABOVE_PRICE`). Porta nova
  `set_procedure_group_pricing(id, ajuste, mínimo)`, só Admin Master; a
  `set_procedure_group_price` da 0325 continua e respeita o mínimo.
- **Trava:** `evaluate_negotiation_rules` (0182, recriada) chama
  `_negotiation_package_floor` — um motivo por pacote abaixo do mínimo, que
  põe a negociação em `aguardando_autorizacao` e avisa o Gerente (o caminho
  do teto). Cobrado pelo pacote = preço dos itens dele − a parte do desconto
  manual que cabe a eles (proporcional à base descontável, a do teto). O
  benefício do programa NÃO conta. Piso = tabela × % arredondado para cima.
- **Espelho em TS:** `pacotesAbaixoDoMinimo` (mesmo texto do motivo), no
  painel de negociação antes de salvar. ⚠️ **Ao recriar
  `evaluate_negotiation_rules`, levar a chamada junto.**
- O mínimo vale pelo valor ATUAL do grupo em cada avaliação (não congela no
  envio do plano, ao contrário do preço).

**O repasse no pacote (sem migração):** `payout_matrix` da unidade ativa
(a mesma fonte do cartão do procedimento), por nível, em % do preço NO
pacote (padrão da rede ajustado). Tabela em `repasse-do-pacote.tsx`.

**O botão rápido (sem migração):** `vincularAoGrupo` lê o grupo e regrava
pela MESMA porta do editor (`save_procedure_group`) — mesmas regras e a
permissão do GP1 (Admin Master e Planner). Entra no FIM, quantidade 1;
desmarcar que deixaria o grupo com 1 é recusado com explicação. Grupos no
cartão: `GruposDoProcedimento`.
