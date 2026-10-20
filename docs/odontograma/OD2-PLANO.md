# Odontograma — Fase OD2: o diagnóstico (plano, sem código)

*20/10/2026 · base: o pedido do dono (seção 8, "Fluxo de diagnóstico"), as
decisões D1–D12 da OD0 e a leitura do sistema na versão 0.334.0.*

> **Em uma frase:** o Coordenador marca no desenho o que encontrou em cada
> dente (como **sugestão**), o Planner **define** (aceita, ajusta ou
> rejeita) e **finaliza** — e o que foi finalizado não muda mais, só recebe
> adendo com motivo. É a base sobre a qual a OD3 vai montar o plano dente a
> dente.

---

## 1. O que existe hoje e a OD2 aproveita

| Já existe | Como funciona hoje | O que a OD2 faz com ele |
|---|---|---|
| **Rodadas da avaliação** (`clinical_evaluations`, 0135) | "Avaliação 1", "Reavaliação 2"…; uma aberta por cliente e unidade; a rodada só fecha quando o Coordenador abre a próxima | O diagnóstico por dente **fica preso à rodada**. A rodada ganha o ciclo **rascunho → finalizado** do diagnóstico |
| **Considerações e mídias** da rodada | Continuam **editáveis e apagáveis** mesmo com a rodada fechada — nada no banco impede | Ver **decisão E1** |
| **Cockpit do Coordenador** (`/avaliacao/[cliente]`) | Guia por passos: anamnese + considerações, checklist + mídias, enviar ao Centro de Planejamento | Ganha o **odontograma em modo diagnóstico (sugerir)** |
| **Cockpit do Planner** (`/planejamento/[cliente]`) | Botões de janela (Evidências, Anamnese, Considerações…) + o editor do plano; o texto do **Diagnóstico** é um campo do plano | Ganha o **odontograma em modo diagnóstico (definir)**. O texto do diagnóstico **continua** (é a narrativa); o desenho é o registro por dente |
| **Fila do Planner** (`/planejamento`) | Situações: aguardando planejamento, aguardando aprovação, em revisão, aprovados, enviados ao Comercial | Ganha o aviso de **sugestões a definir** — ver **decisão E4** |
| **Aba Odontograma** na ficha (0.334.0) | Só o desenho, sem marcas | Passa a mostrar a **situação atual**, com o filtro *Todos / Só definidos / Só sugestões* |
| **Trilha de alterações** (0288) | O banco grava antes/depois/autor de toda tabela | As tabelas novas entram nela — **não** se cria um log paralelo |

A produção hoje tem **0 rodadas, 0 considerações, 0 planos e 0 sessões** —
não há dado antigo para adaptar. O treino tem 7 rodadas abertas.

---

## 2. Como vai funcionar (para quem usa)

### 2.1. Coordenador, na avaliação ou reavaliação

1. No cockpit, o odontograma aparece no passo das considerações.
2. Toca num dente (ou em vários, ou numa região: "sextante 1", "arcada
   superior") → painel com as faces e as **situações que cabem ali** (cárie
   só em face, implante só na raiz, ausente no dente inteiro…).
3. Escolhe a situação → a marca aparece **tracejada** (sugestão), com o
   símbolo. Pode **desfazer** a própria sugestão enquanto o Planner não
   decidiu.
4. Na reavaliação, o desenho já abre com o que estava definido antes; ele
   sugere o que **mudou** — inclusive **retirar** uma marca ("o 36 não está
   mais ausente: foi feito implante fora").
5. A dentição (permanente / decídua / mista) passa a ser **guardada** no
   odontograma do paciente; Coordenador e Planner trocam.

### 2.2. Planner, no cockpit

1. Vê as sugestões pendentes em lista ao lado do desenho, cada uma com quem
   sugeriu e quando.
2. Para cada uma: **Aceitar**, **Ajustar** (aceita com outra face ou outra
   situação — a sugestão original fica guardada e ligada) ou **Rejeitar**
   (motivo recomendado). Dá para aceitar várias de uma vez.
3. Pode marcar **direto** — o que ele marca já nasce **definido**.
4. **Finalizar o diagnóstico** da rodada: só com **zero sugestões
   pendentes** naquela rodada. A partir daí, aquele diagnóstico não muda.
5. Errou depois de finalizar? **Adendo**: uma marca nova (ou a retirada de
   uma marca), com **motivo obrigatório**, ligada à rodada. O original fica.

### 2.3. Quem pode o quê (decisões D5, D6, D8 da OD0)

| Ação | Quem |
|---|---|
| Sugerir (avaliação/reavaliação) | **Coordenador** da unidade do cliente |
| Sugerir durante o tratamento | **Dentista** — fica para a **OD5** (a tabela já nasce com o campo da sessão) |
| Definir, ajustar, rejeitar, finalizar, adendo | **Planner** |
| Tudo isso | o **Admin Principal** (titular) |
| Ver | quem já vê a aba (Admin, Planner, Coordenador, Dentista, Gerente, Consultor); **não** Assistente, Recepção, SDR |

⚠️ **Mudança que a decisão D6 traz:** o Admin Master que **não** é o titular
**vê**, mas **não** sugere nem define (é ato clínico, com nome de quem fez).
Hoje o sistema não carrega "é o titular" na sessão — passa a carregar.

---

## 3. O que muda no banco (migração 0310, no treino primeiro)

- **`odontograms`** — um por paciente: a dentição atual, quem mudou e quando.
- **`tooth_findings`** — as marcas. **Só acrescenta, nunca apaga nem edita
  o conteúdo**: dente, faces, situação, rodada (ou sessão, na OD5), tipo
  (*marcar* ou *retirar*), situação da marca (sugerida → definida /
  rejeitada / ajustada / desfeita), quem sugeriu, quem decidiu, quando,
  motivo, e a ligação com a sugestão original (no *ajustar*) e com a marca
  que foi retirada.
- **A rodada ganha** `diagnosis_finalized_at/by`, `content_hash` (a
  "impressão digital" SHA-256 do que foi finalizado) e os campos de
  assinatura previstos (`signature_status/provider/reference`, `signed_at`)
  — vazios até a assinatura digital existir.
- **Regras no BANCO, não só na tela:**
  - a marca precisa caber: a face existe naquele dente (`dental_tooth_faces`);
    a situação é de *achado* (não só de *efeito*) e é do tipo certo (face ×
    raiz × dente inteiro);
  - só o Coordenador (da unidade) **sugere**; só o Planner (ou o titular)
    **decide** e **finaliza**; decidir uma sugestão é uma vez só;
  - **rodada finalizada recusa** marca nova que não seja adendo com motivo;
  - finalizar com sugestão pendente é **recusado**;
  - **ninguém apaga** marca — nem o dono do banco (gatilho).
- **Situação atual = cálculo** (`odontogram_state(cliente, data)`): as marcas
  definidas que não foram retiradas até aquela data. Na OD5 ela passa a
  somar o efeito dos procedimentos concluídos. É o que permite, na OD6, ver
  o odontograma "em qualquer dia do passado".
- As tabelas novas entram na **Auditoria** (`audit_attach_all`).

---

## 4. Telas

| Tela | O que muda |
|---|---|
| `/avaliacao/[cliente]` (Coordenador) | Odontograma em modo **sugerir** no passo das considerações; lista "Minhas sugestões nesta rodada" |
| `/planejamento/[cliente]` (Planner) | Odontograma em modo **definir**, com a lista de pendentes, os botões de decisão, **Finalizar diagnóstico** e **Adendo** |
| `/planejamento` (fila) | Sinal de **sugestões a definir** (decisão E4) |
| Ficha → aba **Odontograma** | Situação atual + filtro *Todos / Só definidos / Só sugestões* + a lista das rodadas com o selo "finalizado em … por …" |
| Miniatura do cabeçalho | Mostra as marcas; selo quando há sugestão pendente |

**Tablet primeiro:** alvos de toque de 44 px, seleção de vários dentes por
toque, região em um toque, desfazer enquanto pendente, painel lateral com a
lista sincronizada (tocar na lista acende o dente e vice-versa).

**Fica para depois:** sugestão do dentista no atendimento (OD5); linha do
tempo e exportação do prontuário (OD6); achado em tecido mole (língua,
palato) — as situações de hoje são todas de dente; até lá, vai nas
considerações.

---

## 5. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **E1** | Finalizar o diagnóstico **tranca também** as considerações e as mídias daquela rodada? (Hoje elas continuam editáveis para sempre.) | **Sim, tranca a rodada inteira** — é o que o prontuário digital pede; correção por adendo |
| **E2** | O plano passa a **exigir diagnóstico finalizado** já na OD2? | **Ainda não: só avisar** na OD2 ("diagnóstico a definir"); trancar na OD3, quando os itens do plano ganharem dente — senão a OD2 trava planos que hoje andam |
| **E3** | Quem sugeriu recebe aviso quando… | **Um aviso por rodada, quando o Planner finaliza**, com o resumo (aceitas / ajustadas / rejeitadas). Um por decisão encheria o sino |
| **E4** | Na fila do Planner, as sugestões pendentes aparecem como… | **Selo + filtro "Com sugestões a definir"**, por cima das situações de hoje (um caso pode estar "aguardando aprovação" **e** ter sugestão nova) |

### Decisões do dono (20/10/2026) — as quatro como recomendado

| # | Decisão |
|---|---|
| E1 | Finalizar o diagnóstico **tranca a rodada inteira**: marcas, considerações e mídias; correção só por adendo com motivo |
| E2 | O plano **só avisa** "diagnóstico a definir" na OD2; a trava entra na **OD3** |
| E3 | Quem sugeriu recebe **um aviso por rodada, quando o Planner finaliza**, com o resumo |
| E4 | Na fila do Planner: **selo + filtro** "Com sugestões a definir", por cima das situações de hoje |

✅ OK do dono para o código em 20/10/2026.

### OD2 entregue (20/10/2026) — versão 0.335.0, migração 0310

✅ **0310 aplicada na produção em 20/10/2026** (conferência do dono e de fora
deram o esperado).

- **Banco (0310):** `odontograms`, `tooth_findings`, a rodada com
  `diagnosis_finalized_at/by`, `content_hash` e os campos de assinatura;
  funções `suggest_tooth_findings`, `withdraw_tooth_finding`,
  `decide_tooth_findings`, `define_tooth_findings`,
  `finalize_tooth_diagnosis`, `set_client_dentition`; réguas
  `can_view_odontogram`, `_can_suggest_findings`, `_can_define_findings`;
  gatilhos de validação, imutabilidade e da trava E1 (rodada, considerações,
  mídias). `ensure_open_evaluation` passou a abrir rodada nova
  ("Registros após o diagnóstico") depois de uma finalizada.
- **Telas:** passo 3 do cockpit do Coordenador (sugerir); quadro acima do
  plano no cockpit do Planner (definir + aviso E2); selo e filtro na fila
  (E4); a aba da ficha com as marcas, o filtro, as rodadas e o histórico.
- **Decisões de desenho tomadas no código (sem mudar regra):** finalizar
  também **fecha** a rodada; o Planner marca direto na rodada **mais recente**
  do cliente (sem rodada nenhuma, recusa — quem abre a avaliação é o
  Coordenador); retirada não se ajusta (aceita ou rejeita); a ficha é só
  leitura.
- ⏳ **Pergunta ao dono:** cárie DEFINIDA aparece em **azul** ("existente"),
  pela convenção D12 (azul = existente; vermelho = a realizar, que chega com
  o plano na OD3). Muitos odontogramas pintam cárie de vermelho. Confirmar.
- **Não visto na tela:** o Planner decidindo (porta da conta de teste do
  Planner fechada no treino); o selo da fila (cliente de teste na fase 2).
- **Resíduo no treino:** o cliente fictício "Teste do portão 2 (pode
  ignorar)" foi para a fase 2 (Conversão Clínica) pelo Admin de teste; tem a
  "Avaliação 1" com o diagnóstico finalizado (cárie M+O no 16 por ajuste,
  ausente no 36) e o Coordenador de teste recebeu o aviso.

---

## 6. Como vai ser provado

- Ensaio da 0310 no treino numa transação desfeita (o arquivo inteiro, duas
  vezes), com: Coordenador sugere; Dentista e Admin não titular são
  recusados; Planner ajusta e rejeita; finalizar com pendente é recusado;
  marca em rodada finalizada sem adendo é recusada; apagar é recusado;
  cárie na raiz e face que o dente não tem são recusadas; a situação atual
  numa data passada.
- Testes da parte pura (a régua de "cabe neste dente", o resumo do aviso) e
  prova de quebra.
- Tela no treino com as contas de teste: Coordenador, Planner, Dentista e
  Recepção.
- Manual (seções do Coordenador e do Planner + a aba), novidades, versão.

**Achado de passagem (no BACKLOG, AP58):** o aviso "Caso devolvido pelo
Centro de Planejamento" ao Coordenador provavelmente nunca é gravado (a
tela grava direto numa tabela que não aceita isso, e não confere o erro; no
treino há 0 desses avisos). Não entra na OD2 sem o seu OK.
