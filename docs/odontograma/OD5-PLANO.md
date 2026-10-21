# Odontograma — Fase OD5: a execução (plano, sem código)

*20/10/2026 · base: o pedido do dono (OD0, fase OD5: "modo execution, sessão
herda o dente, efeito do procedimento atualiza a situação, sugestão do
dentista"), a decisão D8b (o Coordenador passa a registrar evolução), D6, e a
leitura do sistema na versão 0.338.0.*

> **Em uma frase:** quando o dentista dá baixa na sessão, o odontograma do
> cliente passa a mostrar o que foi **feito** (azul, com o símbolo do
> procedimento) no lugar do que estava **a fazer** (vermelho); o dentista vê
> o dente de cada sessão e pode sugerir um achado novo durante o
> atendimento; e o Coordenador passa a registrar evolução.

---

## 1. O que existe hoje e a OD5 aproveita

| Já existe | Como funciona hoje | O que a OD5 faz |
|---|---|---|
| **Sessões** (`treatment_sessions`) | Nascem da opção vendida, uma linha por sessão de cada item. Cada sessão aponta para o **item** do plano — e o item, desde a OD3, tem o dente (um item por dente) | **Nada novo no banco:** a sessão já "herda" o dente pelo item. As telas passam a mostrar: *"Selante — 16 (O) · sessão 1 de 1"* |
| **Baixa da sessão** (`conclude_attendance_partial`) | O dentista conclui o atendimento: marca as sessões feitas (e o motivo das não feitas), exige a evolução escrita; o repasse nasce sozinho | Continua igual. O que muda é o **efeito** no desenho |
| **Evolução** (`clinical_progress_notes`, aba Desenvolvimento Clínico e painel do Atendimento) | **Só o Dentista** escreve (banco e tela). O Admin Master também passa | **D8b:** o Coordenador também. **D6:** o Admin que não é o titular deixa de escrever (só vê) |
| **Achados** (`tooth_findings`) | Já nasceram com o campo da **sessão** (`treatment_session_id`), sem uso. Quem sugere: Coordenador (na avaliação) e o titular. Quem define: Planner e titular | O **dentista sugere durante o atendimento**, preso à sessão; o Planner define, como hoje |
| **Efeito do procedimento** (`procedure_dental_rules.effect_condition`) | 94 dos 275 procedimentos classificados têm efeito (restauração → R, exodontia → A, canal → RZ-ENDO, coroa, implante…). Hoje só serve para conferir o plano | Passa a **valer no desenho** quando o procedimento é concluído |
| **O desenho** | Vermelho = o plano inteiro, mesmo o que já foi feito; azul = diagnóstico definido | Vermelho só o que **falta**; o que foi feito vira o efeito (azul, com símbolo) |

**A produção tem 0 sessões, 0 evoluções, 0 repasses e 0 achados** — nada para
adaptar.

---

## 2. Como vai funcionar

### 2.1. O dente na sessão (sem mudança de regra)

Onde a sessão aparece — painel de **sessões do tratamento** na ficha,
**Atendimento** do dia, bloco de **concluir atendimento**, agenda — o nome
ganha o lugar: *"Implante — Dente 46 · sessão 2 de 3"*. Sessão de venda
direta ou de plano antigo, sem dente, continua como está.

### 2.2. O efeito no odontograma (decisões H1 e H2)

A situação do dente **continua sendo um cálculo, nunca regravada**: o
diagnóstico definido **+ o efeito de cada procedimento concluído** até a data.
Daí o desenho de qualquer dia do passado (a base da OD6).

- **Quando o efeito entra:** ver **H1**.
- **O achado que o procedimento trata:** ver **H2** (a cárie do 16 continua
  vermelha depois da restauração?).
- Sessão **reaberta** (refação/revisão) não apaga nada: o efeito segue a
  situação das sessões — se a sessão voltar a pendente, o efeito sai do
  desenho sozinho, porque é calculado.
- **Exodontia** concluída deixa o dente **ausente** (cinza com X); a 0311 já
  recusa planejar restauração em dente ausente — a conferência do plano
  passa a considerar também o que foi **feito**, não só o diagnosticado.

### 2.3. O modo execução (no Atendimento e na aba Desenvolvimento)

Ao lado da lista de sessões do dia, o odontograma do cliente com:
**feito** (azul, efeito), **hoje** (os dentes das sessões deste atendimento,
realçados), **falta** (vermelho), **achado a tratar** (vermelho). Só leitura —
a baixa continua pelas caixinhas que já existem.

### 2.4. A sugestão do dentista (decisão H3)

No atendimento, o dentista toca no dente e sugere um achado (ex.: fratura no
24 que apareceu agora), preso à sessão. A sugestão entra na fila do Planner
("N a definir"), com o mesmo fluxo da OD2: aceitar, ajustar ou rejeitar. Nada
muda no plano sozinho: se precisar tratar, o Planner faz uma **nova versão**.

### 2.5. Quem registra evolução (D8b, D6 — decisões já tomadas; detalhe em H4)

- **D8b:** o Coordenador Clínico passa a registrar evolução. Falta o
  **alcance** (H4).
- **D6:** o Admin Master que **não** é o titular deixa de escrever evolução e
  de concluir atendimento (vê tudo); o titular faz tudo. Hoje o banco ainda
  deixa qualquer Admin — a OD5 aplica a decisão no banco e na tela.

---

## 3. O que muda no banco (migração 0314, no treino primeiro)

- `_tooth_current_conditions` (a régua do plano) passa a somar o **efeito
  dos procedimentos concluídos** (e o que eles tratam, se H2 = sim).
- `suggest_tooth_findings` aceita a **sessão** como origem (além da rodada
  de avaliação); `_can_suggest_findings` passa a incluir o **dentista daquele
  atendimento** (H3).
- Evolução: a regra de gravar de `clinical_progress_notes` e a guarda de
  `conclude_attendance_partial` ganham o **Coordenador** (H4) e trocam
  "qualquer Admin" por **o titular** (D6).
- Nenhuma tabela nova; a sessão continua sem coluna de dente (vem do item).

## 4. Telas

| Tela | O que muda |
|---|---|
| Ficha → aba **Odontograma** e miniatura | feito = efeito (azul); vermelho só o que falta |
| Ficha → **Desenvolvimento Clínico** / sessões do tratamento | dente em cada sessão; odontograma de execução; Coordenador escreve (H4) |
| **Atendimento** do dia (painel do dentista) | dente em cada sessão; odontograma de execução; "Sugerir achado" (H3) |
| Fila do **Planejamento** | as sugestões do dentista entram no "N a definir" |

**Fica para depois:** a linha do tempo, os adendos da evolução e a exportação
do prontuário (OD6); o dente no relatório de repasse (o repasse já chega ao
dente pela sessão — só não mostra). ⚠️ **AP61** (repasse cheio a cada sessão
de um procedimento de várias sessões) **não entra aqui**: é regra de dinheiro
e espera a sua decisão própria.

---

## 5. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **H1** | Quando o procedimento passa a contar como **feito** no odontograma? | **Na última sessão concluída** daquele dente (um implante de 3 sessões só vira implante na 3ª) |
| **H2** | O procedimento concluído **resolve o achado** do mesmo lugar? (restauração no 16-O tira a cárie do 16-O do vermelho) | **Sim, automático, na mesma face (ou no dente, se o procedimento é do dente inteiro)**: o achado sai do vermelho e fica no histórico como "tratado em DD/MM"; nada se apaga |
| **H3** | O dentista **sugere achado** durante o atendimento? | **Sim, sugere preso à sessão; o Planner define** (mesmo fluxo da OD2) |
| **H4** | Alcance da evolução do **Coordenador** (D8b) | **O mesmo do dentista:** escreve a evolução e dá baixa nas sessões **nos atendimentos em que ele é o profissional** |

### Decisões do dono (20/10/2026) — as quatro como recomendado

| # | Decisão |
|---|---|
| H1 | O efeito entra **na última sessão concluída** daquele dente |
| H2 | O procedimento concluído **resolve o achado** do mesmo lugar (face, ou dente inteiro), **automático**; o achado fica no histórico como "tratado em DD/MM" — nada se apaga |
| H3 | O dentista **sugere** achado durante o atendimento, preso à sessão; **o Planner define** |
| H4 | O Coordenador **igual ao dentista**: evolução e baixa das sessões nos atendimentos em que ele é o profissional |

⏳ Aguardando o OK do dono para começar o código.

---

## 6. Como vai ser provado

Ensaio da 0314 no treino (transação desfeita, 2×): sessão concluída → efeito
na régua do plano; achado tratado (H2); dentista sugere preso à sessão (H3);
Coordenador escreve e conclui no atendimento dele, não no dos outros (H4);
Admin não titular recusado, titular passa (D6). Testes da parte pura (o
cálculo da situação com efeitos, a lista "feito / falta") + prova de quebra.
Tela no treino com contas de teste. ⚠️ **Concluir atendimento** pela tela
avisa a Recepção e move a jornada — no treino, só em cliente de ensaio e
unidade sem gente real, ou só no ensaio do banco.
