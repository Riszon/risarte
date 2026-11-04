# AP63 / AP64 — Como se muda um plano já vendido (plano para o dono aprovar)

**03/11/2026.** Decisões do dono no BACKLOG:

- **AP63:** depois de cancelar, o cliente compra de novo por uma **nova versão
  do plano**, com **negociação nova**. O histórico registra que houve uma venda
  cancelada.
- **AP64:** um plano vendido **pode** ganhar versão nova. A venda anterior
  **continua valendo**. A versão nova é **proposta de complemento**, consolidada
  como nova versão do plano.

Este documento diz o que o sistema faz hoje, o que falta e o que precisa da
palavra do dono antes do código (V1 a V5).

---

## 1. O que o sistema já faz (lido no código e nas migrações)

| Peça | Como está | Onde |
|---|---|---|
| Versão nova | O Planner cria a cópia de um plano ("Criar nova versão"). Só com o cliente na **Fase 3**. | `createTreatmentPlan` (`planning-actions.ts`) |
| Substituição | Quando a versão nova é **aprovada**, a anterior fica "substituída". | gatilho `treatment_plan_supersede_previous` (0311) |
| Negociação aberta da anterior | Vira "substituída". Negociação **aceita** e **cancelada** não são tocadas. | `treatment_plan_supersede_negotiation` (0313) |
| Qual plano a negociação mostra | O aprovado mais novo que vale; o substituído só se foi vendido. | `planoDaNegociacao` (`aceite.ts`) |
| Cancelar com termo | Plano fica aprovado, negociação "cancelada", venda com data de cancelamento, sessões futuras canceladas, cliente vai à **Fase 6** (reavaliação) ou **7**. | `apply_plan_cancellation` (0207) |
| Cancelar rápido (sem recebimento) | Desfaz tudo e devolve o cliente à **Fase 4**. | `cancel_negotiation` (0205), botão no painel de fechamento |
| Voltar ao funil | Entrar de novo na Fase 4 reabre o cartão "cancelado". | 0250 |
| Sessões | Geradas de **um** plano em execução: o aprovado mais novo, ou o da venda aceita. | `topup_treatment_sessions` (0337) |

## 2. AP63 — comprar de novo depois de cancelar

**O caminho já existe**, pelo cancelamento com termo: Fase 6 → o Coordenador
envia ao Centro de Planejamento → o Planner cria a nova versão → aprovada, a
anterior fica substituída (a negociação cancelada continua cancelada) → Envia
ao Comercial → o cartão reabre → negociação nova sobre a versão nova.

**Dois furos encontrados:**

1. **🔴 O cancelamento rápido leva a um beco.** Ele devolve o cliente à Fase 4.
   Dali, o único caminho é "Devolver ao planejamento", e essa função
   (`return_commercial_to_planning`, 0266) **reabre o plano aprovado mais novo
   como rascunho** — o plano que foi vendido e cancelado. O Planner editaria o
   plano da venda cancelada em vez de fazer uma versão nova, e o registro do
   que foi vendido se perde.
   **Conserto:** a devolução não reabre plano que tem negociação aceita ou
   cancelada; o cliente vai à Fase 3 e o Planner cria a versão nova (a tela
   diz isso).
2. **O histórico não aparece na compra nova.** O cancelamento fica registrado
   no cartão do Comercial e na linha do tempo do plano antigo, mas quem abre a
   versão nova e a negociação nova não vê nada.
   **Conserto:** um aviso fixo no painel da negociação e no plano novo:
   *"Venda anterior cancelada — VND-0000 em dd/mm/aaaa: motivo"*, e um evento
   na linha do tempo da versão nova.

## 3. AP64 — o plano complementar (revisto com o dono, 03/11/2026)

Hoje isso **não tem caminho**: plano novo exige a Fase 3, e o cliente em
tratamento está na Fase 5. Forçar a Fase 3 tiraria as sessões da agenda,
sumiria com o painel da venda anterior e geraria de novo as sessões já
vendidas.

**O caso que o dono descreveu:** o cliente está na Fase 5, fez enxerto ósseo e
espera uns 6 meses (tempo biológico) para o implante ou a prótese. Nesse
intervalo, o paciente ou o Coordenador decide adiantar outra etapa que não
tinha sido contratada. Reavalia, faz um plano novo, o paciente contrata e
trata enquanto espera.

**O fluxo, sem mudar a fase do cliente (ele fica na Fase 5):**

1. **Coordenador Clínico** abre o complemento na ficha: registra as
   informações clínicas (o que viu, o que indica e por quê). É a reavaliação
   do complemento.
2. **Planner** monta o **plano complementar**: um plano **novo e separado**,
   ligado ao plano vendido, só com o que se acrescenta. O plano vendido não é
   copiado, não muda e não é substituído.
3. **Coordenador** aprova o plano complementar, como qualquer plano.
4. **Consultor Comercial** faz a **nova apresentação** e a negociação só do
   complemento. Fecha a venda dele.
5. A venda do complemento gera **só as sessões dele**. As sessões, cobranças,
   repasses e o painel de fechamento da venda original seguem iguais.

**A sinalização (pedido do dono):** quando o cliente tem plano complementar,
aparece **no cartão do cliente na Jornada** e **no prontuário**, mostrando o
plano aprovado e os planos complementares, cada um com a situação
(em planejamento, aguardando aprovação, aprovado, em negociação, vendido).

**Consequências do desenho separado:**

- Não existe item "já contratado" nem trava de item vendido: o plano original
  fica intocado. As antigas perguntas V3 e V4 deixam de existir.
- Pode haver **mais de um** complemento ao longo de um tratamento longo.
- "Nova versão" continua sendo outra coisa: rever o plano **antes** de vender,
  ou depois de cancelar (AP63).

## 4. O que precisa da decisão do dono

| # | Pergunta | Situação |
|---|---|---|
| **V1** | Onde o cliente fica durante o complemento? | ✅ **Fase 5** (dono, 03/11/2026). |
| **V2** | Como o Consultor encontra o complemento, se o cliente não está na Fase 4? | ✅ **Cartão "Complemento" no quadro do Comercial**, com aviso ao Consultor quando o Coordenador aprova (dono, 03/11/2026). |
| **V5** | O cancelamento rápido (Fase 4) continua existindo? | ✅ **Sim**, com o conserto do furo 1 (dono, 03/11/2026). |
| **V6** | Complemento é plano **separado** ligado ao vendido, não uma versão que o copia? | ✅ **Plano separado**, ligado ao vendido (dono, 03/11/2026). |
| **V7** | Quem abre o complemento? | ✅ **O Coordenador Clínico** abre, com as informações clínicas; o Planner monta depois (dono, 03/11/2026). |

## 5. Ordem de entrega proposta

1. **AP63** (pequena): a devolução não reabre plano vendido/cancelado; o aviso
   da venda cancelada; o evento na linha do tempo. Uma migração.
2. **Complemento 1:** o Coordenador abre o complemento na Fase 5; o Planner
   monta o plano complementar; o Coordenador aprova. O sinal no cartão da
   Jornada e no prontuário.
3. **Complemento 2:** a nova apresentação e a negociação do complemento; o
   cartão "Complemento" no Comercial (V2).
4. **Complemento 3:** a venda do complemento gera só as sessões dele; o
   painel mostra as duas vendas.

Cada passo com ensaio no treino em transação desfeita, régua de teste, manual
e versão, como os anteriores.

---

## 6. Passo 2 do complemento — a apresentação e a negociação (levantamento de 03/11/2026)

**O que o código faz hoje e atrapalha o complemento:**

| Peça | Hoje | Problema para o complemento |
|---|---|---|
| Cockpit do Consultor e página da apresentação | Negociação só com o cliente na **Fase 4** | O complemento acontece na Fase 5 |
| Apresentação (Meet, gravação, **resumo**) | **Uma por cliente** (`commercial_presentations`, único por cliente) | A apresentação do complemento apagaria a da venda original |
| Aceite (`accept_negotiation`) | Exige Fase 4 e o resumo da apresentação do cliente | Recusaria; e leria o resumo errado |
| Contrato de prestação | Usa o resumo da apresentação do cliente | O complemento sairia com o resumo da venda original |
| Fechamento (`_commercial_close_step_raw`) | Move o cliente para a Fase 5 e reescreve o histórico de fases | O cliente já está na Fase 5: não pode mexer na fase |
| Quadro do Comercial | Colunas pela fase e pelo cartão (um cartão por cliente) | Não há lugar para o complemento |

**O desenho proposto (sem mudar a fase do cliente):**

1. Aprovado o complemento, ele fica **"Aguardando apresentação"** e os
   Consultores recebem o aviso **"Plano complementar para apresentar"**.
2. O quadro do Comercial ganha a coluna **"Complementos"**, com o cartão de
   cada complemento aprovado e ainda não vendido. O cartão abre o cockpit **no
   modo complemento** (o cockpit do cliente fica como está).
3. No modo complemento, o Consultor faz a apresentação **própria do
   complemento** (Meet, gravação, resumo), negocia **só os itens do
   complemento**, registra o aceite e fecha a venda (contrato + pagamento),
   tudo com o cliente na Fase 5.
4. O fechamento do complemento **não mexe na fase** e avisa a Recepção para
   agendar.

**Decisões para o dono:**

| # | Pergunta | Recomendação |
|---|---|---|
| **C1** | O complemento tem a **sua própria apresentação** (Meet, gravação, resumo), separada da apresentação da venda original? | **Sim.** Cada venda com o seu resumo, porque ele vai no contrato. |
| **C2** | Qual **contrato** o complemento assina? | **O mesmo modelo de contrato de prestação**, preenchido com os itens e o resumo do complemento. Um "termo aditivo" próprio fica para quando o jurídico pedir. |
| **C3** | A cobrança do complemento? | **Cobrança própria**, como qualquer venda: forma de pagamento e parcelas do complemento, separadas das da venda original. |
| **C4** | Onde o cartão "Complemento" fica no quadro? | **Uma coluna própria, "Complementos", no começo do quadro.** O cartão sai de lá quando a venda do complemento fecha. |
