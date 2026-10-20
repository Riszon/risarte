# Odontograma — Fase OD3: o plano por dente (plano, sem código)

*20/10/2026 · base: o pedido do dono (seções 6.3, 7.3 e 8), as decisões
D1–D12 e E1–E4, e a leitura do sistema na versão 0.335.0.*

> **Em uma frase:** cada item do plano passa a dizer **em que dente, faces ou
> região** ele acontece; o desenho mostra em **vermelho** o que está a
> realizar; o sistema confere se o procedimento **cabe** naquele dente; e um
> plano aprovado que precisa mudar vira **nova versão**, em vez de ser
> editado.

---

## 1. O que existe hoje e a OD3 aproveita

| Já existe | Como funciona hoje | O que a OD3 faz |
|---|---|---|
| **Itens do plano** (`treatment_plan_option_items`) | procedimento do catálogo, quantidade, preço (o banco põe o do catálogo e trava, 0306), sessões, etapa, profissional, GUT. **Nenhum dente** | Ganham **dente, faces e região** |
| **Regra de cada procedimento** (0308) | onde se marca (dente / face / região / arcada / nenhum), nº de faces, dentição, grupos de dentes, situações que impedem e que exigem, efeito | Passa a ser **conferida** ao lançar o item |
| **Diagnóstico** (OD2) | marcas definidas por dente | É o que o item confere ("este dente está ausente?") |
| **Opções** (principal + alternativas) e aprovação por opção | como sempre | Nada muda |
| **"Criar cópia para revisar"** | cria um plano novo em rascunho; o antigo continua **aprovado** — podem existir dois aprovados | Vira **nova versão** (D4): a anterior fica **substituída** |
| **Sessões, negociação, repasse** | tudo nasce **por item** | Continua por item — com um item por dente, a negociação já aceita "este dente sim, aquele não" (OD4) |

A **produção tem 0 planos, 0 itens e 0 negociações** — nada para adaptar. No
treino há 7 planos e 24 itens sem dente: continuam valendo, marcados "sem
dente (anterior ao odontograma)".

**Os 370 procedimentos, pelo jeito de marcar:** dente 100 · arcada 86 ·
região 81 · sem marcação 73 · face 30.

---

## 2. Como vai funcionar (para o Planner)

1. No cockpit, ao lado do plano, o **odontograma da opção** que está sendo
   montada: o diagnóstico definido (azul / cinza) e o que já está no plano
   (**vermelho**). Trocar de opção troca o vermelho.
2. **Toca no(s) dente(s)** — ou numa região, ou numa arcada — e procura o
   procedimento. A lista mostra **primeiro os que cabem** naquela seleção
   (ex.: escolheu faces → restaurações; escolheu um dente ausente →
   implante).
3. Escolhe faces se o procedimento pedir ("2 faces" exige 2).
4. **Um item por dente**: restauração em 16, 26 e 36 vira **três itens**,
   cada um com o seu dente (e quantidade 1). É o que deixa, depois, o cliente
   aceitar um dente e não outro, e o dentista dar baixa no dente certo.
   Procedimento de região/arcada vira **um item** com a região.
   Procedimento "sem marcação" continua como hoje (quantidade livre).
5. A lista do plano e o desenho andam juntos: tocar num item acende o dente,
   e vice-versa.
6. **Totais da opção** (procedimentos, sessões e valor) visíveis para quem
   pode ver preço (D7).

### O que o sistema confere (decisão F1)

| Conferência | Exemplo |
|---|---|
| A face existe no dente; o nº de faces bate com o procedimento | "Restauração 2 faces" com 3 faces |
| Dentição e grupo de dentes | Procedimento de molar decíduo num permanente |
| Situação que **impede** | Restauração no 36 que está **ausente** |
| Situação que **exige** | Coroa sobre implante sem implante — vale o que já existe **ou** o que está planejado na mesma opção (implante no 36 + coroa sobre implante no 36 = ok) |

---

## 3. Versões do plano (D4, decidido na OD0)

- Plano **aprovado não se edita** — e passa a ser trancado **no banco** (hoje
  é só a tela; ver AP62).
- **"Criar nova versão"** (no lugar de "Criar cópia para revisar"): copia o
  plano com os dentes, recebe número ("Plano v2") e liga à versão anterior.
- A anterior fica **substituída** (decisão F2), continua consultável e mostra
  "substituída pela v2".
- A **apresentação** passa a usar a versão vigente aprovada (não a mais nova
  de qualquer situação — AP60).

## 4. Preço (decisão F3) e quem vê (D7)

- Hoje o preço entra no item **no dia em que o item é lançado** e trava.
  Com a vigência (0309), um reajuste no meio do planejamento deixaria itens
  do mesmo plano com preços de dias diferentes.
- **D7 (já decidido):** Coordenador vê **só totais**; Gerente **vê preços**.
  Hoje está ao contrário em dois lugares (AP59): o Gerente só vê totais no
  plano e o Coordenador vê preço por item na Apresentação. A OD3 acerta os
  dois.

## 5. A trava do diagnóstico (E2, decidido na OD2)

**Enviar para aprovação passa a exigir** diagnóstico **definido**: nenhuma
sugestão pendente e pelo menos uma rodada finalizada. O aviso da OD2 vira
trava, no banco (`submit_treatment_plan`).

---

## 6. O que muda no banco (migração 0311, no treino primeiro)

- Item: `tooth_code`, `face_codes`, `region_code` (+ conferência no banco,
  junto da trava de preço da 0306).
- Plano: `version_no`, `previous_plan_id`, `superseded_at/by_plan_id`
  (colunas, não um valor novo na lista de situações — o Postgres não deixa
  usar valor novo de lista na mesma migração).
- Trava: item, etapa, sessões e opções de plano que não está em rascunho ou
  devolvido **não mudam** (AP62).
- `submit_treatment_plan`: a trava E2.
- Nada apaga dado.

## 7. Telas

| Tela | O que muda |
|---|---|
| Cockpit do Planner | odontograma da opção (modo **planejamento**), item por dente, totais |
| Ficha → aba Odontograma | o vermelho do plano vigente; filtro ganha "Só o plano" |
| Plano (ficha e cockpits) | cada item mostra o dente/faces/região; "Criar nova versão"; selo "substituída" |
| Apresentação | versão vigente; Coordenador sem preço por item (a miniatura entra na OD4) |

**Fica para depois:** a negociação dente a dente na tela do Consultor e a
miniatura no documento (OD4); a baixa por dente e o efeito no odontograma
(OD5).

---

## 7b. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **F1** | Procedimento que não cabe no dente: o sistema… | **Recusa o que é de forma** (face que não existe, nº de faces, dentição, grupo) e **avisa o que é de situação** (impede / exige), deixando seguir com motivo — o diagnóstico pode estar incompleto, e 106 regras são de confiança baixa |
| **F2** | Nova versão: a anterior fica "substituída"… | **Quando a nova é APROVADA** — até lá a anterior continua valendo (o Comercial pode estar com ela) |
| **F3** | O preço do item congela… | **No envio para aprovação**, pelo preço daquele dia (todos os itens do plano com o mesmo dia; o Coordenador aprova o número que vai valer) |
| **F4** | Quantidade em procedimento de dente/face | **Um item por dente, quantidade 1** (o recomendado acima). Alternativa: um item com vários dentes |

### Decisões do dono (20/10/2026) — as quatro como recomendado

| # | Decisão |
|---|---|
| F1 | **Forma recusa** (face, nº de faces, dentição, grupo); **situação avisa** (impede / exige) e deixa seguir com **motivo** |
| F2 | A versão anterior fica **substituída quando a nova é aprovada** |
| F3 | O preço do item **congela no envio para aprovação**, pelo preço daquele dia |
| F4 | **Um item por dente**, quantidade 1 |

✅ OK do dono para o código em 20/10/2026.

### OD3 entregue (20/10/2026) — versão 0.336.0, migração 0311

✅ **0311 aplicada na produção em 20/10/2026** (conferência do dono e de fora
deram o esperado).

- Como no plano acima, com estes detalhes decididos no código (sem mudar
  regra): a conferência de forma vale **quando o lugar é informado**; quem
  cobra o lugar é o **envio** (`ITEM_LOCATION_REQUIRED`) — assim os itens
  antigos e as cópias não quebram. Na trava do plano aprovado, **indicar o
  profissional e a prioridade (GUT) seguem livres**. Na nova versão, o item
  que não combina mais com o diagnóstico de hoje não é copiado e a tela avisa.
- **Achado no código e corrigido junto:** pela API dava para voltar um plano
  aprovado a "rascunho" (o antigo Reabrir, já sem botão) — agora a situação do
  plano só muda pelas funções (`treatment_plan_lock`).
- ✅ **D6 no plano — aplicada na 0312 (0.337.0)** depois de o dono
  confirmar: montar e enviar plano = Planner ou titular; o Admin vê. Na mesma
  entrega, o achado a tratar ficou vermelho (decisão do dono).
- **Não visto na tela:** envio, aprovação e nova versão pela tela; o
  Gerente/Coordenador vendo preço (ensaio + testes).
- **Resíduo no treino:** "Teste do portão 2 (pode ignorar)" foi posto no
  Centro de Planejamento direto no banco (para não avisar os Planners do
  treino) e tem um plano em rascunho, "Opção A (ensaio OD3)", com selante
  no 16 e no 26, implante no 46 (com motivo) e ajuste oclusal no arco
  superior.

---

## 8. Como vai ser provado

Ensaio da 0311 no treino (transação desfeita, arquivo 2×): item por dente,
face errada recusada, situação que impede/exige (aviso + motivo), trava do
plano aprovado, nova versão e a substituição, a trava E2 no envio, o preço
no envio. Testes da parte pura + prova de quebra. Tela no treino.
⚠️ **A tela do Planner precisa da conta de teste do Planner com a porta do
sistema aberta no treino** — sem isso, a OD3 sai sem ser vista na tela de
quem mais a usa.
