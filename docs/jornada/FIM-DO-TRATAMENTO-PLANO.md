# Fim do tratamento: finalização, mudança de fase e controle de qualidade

*Plano da sessão "Jornada do Cliente Risarte". Versão 2, 16/11/2026: incorpora a
revisão externa trazida pelo dono (pontos 1 a 8), conferida no código, só
lendo. **Nada foi programado.***

*✅ = aprovado pelo dono nesta conversa; ⏳ = aguarda decisão, com a
recomendação. A tabela completa está na seção 13.*

*Relatório da ortodontia enviado à sessão "módulo de ortodontia" (AP175 no
backlog). Esta sessão não mexe nas funções da ortodontia.*

---

## 1. O problema e os princípios

**O problema de hoje (confirmado no código):** quando o cliente termina os
procedimentos, nada acontece.

- A pergunta "necessita de reavaliação?" existe desde a 0019
  (`handle_treatment_finished`), mas só abre quando o sub-status vira
  "Tratamento Finalizado", e nenhuma regra marca esse sub-status sozinha: só o
  botão "Definir status" da ficha (`set_journey_status`, 0017). "Em Tratamento"
  é automático (0110); "Finalizado" nunca foi.
- O cliente fica parado na Fase 5. Depois de 90 dias sem agendamento, o banco o
  marca como **"inativo"** (`recompute_client_activity`, 0249,
  `phase5_6_no_appt_days`), mas **ninguém recebe tarefa**: é só uma etiqueta.

**Princípios (dono, 16/11/2026):**

- ✅ **O cliente não pode ser esquecido nunca.**
- ✅ **O principal responsável pelo sucesso do tratamento é o Coordenador
  Clínico.**
- ✅ **A fase é consequência do trabalho**, nunca um campo que alguém arrasta
  (21/09/2026).

**Contexto (dono, 16/11/2026):** o riSZon foi implantado hoje em unidades que já
funcionavam, com histórico. **Os esquecidos já existem**; a rede de segurança
precisa vir antes do resto (seção 12).

---

## 2. O fluxo, passo a passo

**Passo 1 — a última sessão de um plano é concluída.** O sistema percebe
sozinho. Vale para o plano original, cada plano complementar, a venda direta e a
ortodontia (que termina na entrega da contenção, C2).

**Passo 2 — a pergunta a quem executou.** Janela na tela de Atendimento que não
fecha sem resposta: *"Este cliente necessita de consulta de reavaliação com o
Coordenador Clínico?"* (Sim / Não / Não sei).
- Se o plano tem procedimento marcado como **"reavaliação presencial
  obrigatória"** no catálogo, a pergunta **não aparece** e vale "Sim" (D17).
- A resposta do dentista é uma **recomendação**: o Coordenador pode mudá-la
  enquanto o próximo passo não aconteceu (D21).
- Quem concluiu no sistema é, quase sempre, quem executou (ver 5.6). Se foi o
  titular concluindo pelo profissional, a pergunta vai **como tarefa** ao
  profissional do agendamento, não como janela na tela do titular.

**Passo 3a — Sim: consulta de reavaliação.**
- A Recepção é avisada para agendar a reavaliação com o Coordenador.
- Na consulta, o Coordenador avalia cada procedimento do plano em cinco níveis,
  com observação (seção 4).
- Com tratamento sobrando, a consulta acontece **dentro da Fase 5** (C1). Sem
  nada sobrando, o cliente vai para a **Fase 6**.

**Passo 3b — Não: contato com o cliente.** ✅ (o conteúdo da nota foi revisto:
D18)
- Abre a tarefa obrigatória do Coordenador: **"Contatar o cliente e colher o
  feedback"**.
- Ele registra: o meio (ligação ou mensagem) e a data; o que o cliente disse; a
  **satisfação do cliente (0 a 10)**; **"tem queixa?" (sim/não)**; e a decisão.
- Queixa = sim **obriga** "chamar para revisar" (D18).
- **Chamar para revisar** → a Recepção agenda a reavaliação (Passo 3a).
- **Aguardar o retorno** → sem tratamento sobrando, **Fase 7**, com a data de
  retorno sugerida (D22); com tratamento sobrando, fica na 5.
- **Precisa de novo planejamento** (D4) → **Fase 3**; com tratamento em
  andamento, pelo caminho do plano complementar, sem mudar de fase.
- No futuro, quem responde é o próprio cliente, pelo WhatsApp (seção 11).

**Passo 3c — Não sei.** A decisão passa ao Coordenador, que escolhe 3a ou 3b.

**Passo 4 — Revisar ou Refazer.** O procedimento reabre e o cliente volta a "Em
Tratamento". Concluída a revisão ou a refação, o procedimento volta ao
Coordenador para nova avaliação, **sem repetir a pergunta ao dentista**. Sem
custo para o cliente e sem venda nova (D15).

**Passo 5 — fim do tratamento.** Quando não sobra nada (3.1), o cliente vira
"Tratamento Finalizado" e sai da Fase 5, para a 6 ou a 7, conforme o Passo 3.

**Passo 6 — saída da Fase 6** (D23). O Coordenador conclui a reavaliação:
- tudo em Excelente, Bom ou Aceitável → **Fase 7**, com a data de retorno
  sugerida (D22);
- algum Revisar ou Refazer em aberto → o cliente **fica na Fase 6** até a
  reavaliação seguinte; "Concluir a reavaliação" fica bloqueado.

---

## 3. As regras

### 3.1. "Sobra tratamento?" — uma regra só para o sistema todo

O cliente só sai da Fase 5 quando não sobra nada disto:

1. sessão pendente ou agendada de **qualquer** venda: plano original,
   complemento ou venda direta; cancelada não conta (D2);
2. complemento sendo montado, aprovado ou negociado (D3);
3. caso ortodôntico aguardando início, em tratamento ou **suspenso**; a
   contenção não segura (C2).

**Uma função só no banco.** Substitui `_outra_venda_em_tratamento` (0360), que
hoje olha só (1) e só para vendas de plano. Cancelar e finalizar passam a usar a
mesma pergunta.

**O que segura não pode segurar sem prazo** (D16, D19): as sessões pendentes
sem agendamento caem no fluxo de abandono (seção 6); o complemento e a
ortodontia suspensa parados entram na lista de esquecidos (seção 7).

### 3.2. Fim de um plano × fim do tratamento

| | Fim de um plano | Fim do tratamento |
|---|---|---|
| Quando | Acabam as sessões daquele plano | Não sobra nada (3.1) |
| Pergunta ao dentista | Sim (ou "Sim" automático, D17) | Sim |
| Controle de qualidade | Sim, daquele plano | Sim |
| Situação do plano | "Concluído", sozinho | "Concluído" |
| Fase | Continua na 5 | Vai para a 6 ou a 7 |

### 3.3. Quem é perguntado

Quem executou a última sessão daquele plano (`treatment_sessions.executed_by`).
Sem executor, o Coordenador. Hoje a regra pega o profissional do agendamento
mais recente da agenda, que pode ser um horário futuro.

---

## 4. O controle de qualidade

### 4.1. Os cinco níveis — só na avaliação presencial do Coordenador ✅

| Nível | Efeito |
|---|---|
| **Excelente** | Aprovado; o dentista é avisado (D24) |
| **Bom** | Aprovado |
| **Aceitável** | Aprovado |
| **Revisar** | Sessão de revisão com quem executou, que é avisado |
| **Refazer** | Reabre: o mesmo dentista refaz, outro refaz, ou vai para o próximo plano |

- Nomes do meio: D1. Observação obrigatória em Revisar e Refazer (D7).
- Avaliações antigas convertidas: Aprovado→Bom, Revisão→Revisar,
  Reprovado→Refazer (D8).
- O plano fecha quando todos estão em Excelente, Bom ou Aceitável
  (`quality_locked`, como o "100% aprovado" de hoje).

### 4.2. Nota técnica × satisfação do cliente (D18, revê D5)

- **Nota técnica** (cinco níveis): só o Coordenador, presencialmente, **por
  procedimento**. É o indicador de qualidade por dentista.
- **Satisfação do cliente**: no contato (3b), **0 a 10** + **tem queixa?** Não
  entra na nota técnica.
- **O riSZon não coleta NPS hoje.** O "Meu dia" tem o quadro "NPS do seu
  atendimento" com "—" e "ainda não disponível" (`meu-dia/page.tsx`). Nenhuma
  tabela guarda satisfação. A satisfação do contato passa a alimentar esse
  quadro.

### 4.3. Atendimentos sem conferência presencial ✅

O dentista responde **Não** e a qualidade vem do feedback do cliente (3b).
Urgência e limpeza do PPR+: ver 5.4 e 5.5.

---

## 5. O que a investigação encontrou (16/11/2026, leitura de código)

### 5.1. Onde a avaliação de qualidade aparece hoje

- Só na tela de avaliação do Coordenador, **só na Fase 6**
  (`flowKind === "reavaliacao"`), e só para plano com a situação "Concluído"
  (`avaliacao/[clientId]/page.tsx`, Bloco D).
- **"Concluído" é manual** ("Concluir tratamento", `set_plan_lifecycle`, 0134),
  e exige "Em tratamento", **também manual**. Só a venda de complemento marca
  "Aceito" sozinha (0358).
- Lista **só a opção principal do plano original**.
- **"Concluir a reavaliação" não confere a avaliação**
  (`jornada/actions.ts`, `concluirReavaliacao`): leva o cliente à Fase 7 mesmo
  com Revisar ou Refazer em aberto, e sem data de retorno.

**No plano:** "Em tratamento" e "Concluído" automáticos; avaliação **por plano**,
na Fase 5 ou 6; a saída da Fase 6 confere a avaliação (D23).

### 5.2. A fase durante a revisão e a refação

- **Revisar ou reprovar não muda a fase** (`set_plan_item_quality`, 0145;
  `request_quality_scheduling`, 0146). A 0141 levava à Fase 5; a 0142 desfez.
- O comentário de `quality-checklist.tsx` ("refação move o cliente para a Fase
  5") está desatualizado; corrigir junto.

### 5.3. O cancelamento de hoje

**Quem e como:** o Gerente (ou o Admin) abre o termo na ficha
(`open_plan_cancellation`), o cliente assina, o Gerente efetiva
(`apply_plan_cancellation`, versão em vigor da 4020). Um cancelamento por venda
(0360).

| Situação | Para onde vai |
|---|---|
| Venda **não fechada** | O cancelamento rápido (`cancel_negotiation`, 0205) devolve à **Fase 4** |
| Venda **fechada**, sem outra venda em tratamento | **O Gerente escolhe** no termo: **Fase 6** ou **Fase 7** (com data de retorno obrigatória). Recepção, Coordenador e Gerente são avisados |
| Venda fechada, com outra venda em tratamento | Só aquela venda é cancelada; fica na **Fase 5** |

O que foi feito fica como histórico; sessões futuras, parcelas em aberto e (4020)
a ortodontia daquela venda são canceladas. **O cliente não vai obrigatoriamente
para a reavaliação.**

**Furos (lidos no código, não medidos no banco):**

1. **Cliente esquecido na Fase 5:** o destino é gravado ao **abrir** o termo; se
   sobrava outra venda, fica vazio; se ela termina antes da **efetivação**, o
   cliente fica na Fase 5 sem tratamento e sem aviso.
2. **"Sobra outra venda?" incompleta:** não vê venda direta, ortodontia nem
   complemento em negociação.
3. **Nenhuma conferência de qualidade** do que foi executado.
4. **O plano não vira "Cancelado"** (`lifecycle = 'cancelado'` existe desde a
   0134, sem uso).
5. **Destino Fase 7 sem o Coordenador.**
6. **Riscos clínicos não registrados:** o termo tem "observações" livres, mas
   nenhum registro do Coordenador sobre os riscos informados ao cliente quando
   um procedimento foi interrompido no meio.

**Proposta (D10–D12, D25):** o cancelamento efetivado passa pelo caminho do fim
de um plano, com o Coordenador como dono: destino na efetivação pela regra 3.1;
avaliação do que foi feito (Fase 6) ou contato (Fase 7); plano "Cancelado"; e,
com procedimento executado e incompleto, o termo só sai depois do registro do
Coordenador sobre os riscos clínicos informados.

### 5.4. Urgência e emergência (D13 revista)

- Confirmado (`check_in_appointment`, 0032): o check-in de Urgência ou
  Emergência com o cliente na **Fase 1** leva direto à **Fase 5**.
- O atendimento não tem plano nem sessão: nada o tira da Fase 5 depois. É um
  cliente esquecido de nascença.
- **A revisão externa procede:** quem chega pela urgência não tem o que
  "reavaliar"; o próximo passo natural é a **avaliação completa**.

**Proposta (D13):** a urgência de quem não tem tratamento **deixa de levar à
Fase 5**: o cliente fica na Fase 1 e, ao concluir o atendimento, a Recepção
recebe a tarefa "agendar a avaliação completa"; o check-in da avaliação leva à
Fase 2, como hoje. Indicador "urgência → avaliação". ⚠️ Isso muda a regra 1→5
de `docs/JORNADA.md` §4.1, definida pelo dono.

### 5.5. A limpeza do programa de prevenção (PPR+)

Uso do benefício em `ppr_benefit_usages`, com a data em que libera de novo; não
é sessão de plano e não mexe na fase. **Proposta (D14):** fora do fim do
tratamento; coberta pelo feedback do WhatsApp.

### 5.6. Quem fica como executor da sessão

`conclude_attendance_partial` (versão em vigor da 0314) grava
`executed_by = quem concluiu`, e só podem concluir: **quem chamou o paciente**
(dentista ou Coordenador), o **profissional do agendamento** quando ninguém
chamou, ou o **titular**. Ou seja, quem conclui é quase sempre quem executou; a
exceção é o titular. **Proposta:** quando o titular conclui, a pergunta vai como
tarefa ao profissional do agendamento.

### 5.7. Refação e dinheiro (D15) — o repasse já está definido

- **Custo para o cliente:** a refação **reabre as mesmas sessões** do item
  (`set_plan_item_quality`, 0145): não cria venda, parcela nem cobrança. Custo
  zero, confirmado.
- **Repasse (`_payout_accrue_block`, versão em vigor da 0400; decisões F1–F6 em
  `docs/Financeiro/REPASSE-PLANO.md`):**
  - sessão de **revisão** não gera repasse;
  - refação **não paga duas vezes**: se o procedimento já tem repasse, não paga
    de novo;
  - **falha confirmada do dentista e refação por outro** (F2): o repasse de quem
    falhou é anulado e **quem refez recebe**; há desconto por falha.
- **O repasse em dobro do AP175** é outro caso (instalação ortodôntica contada
  como sessão e como manutenção), da sessão "módulo de ortodontia".

**Proposta (D15):** registrar no plano o que já vale; ligar o "Refazer com outro
dentista" do Coordenador ao fluxo de falha da 0400 **sem** mudar a regra de
repasse; nada de módulo financeiro novo.

### 5.8. Dias úteis e feriados por unidade (C4)

- O banco já tem os dados: a tabela `holidays` (nacional, **estadual e
  municipal**, 0368) e a decisão de cada unidade para cada feriado
  (`clinic_holiday_decisions`, 0047).
- Mas as contas de dias úteis de hoje **só pulam o fim de semana e o feriado
  nacional** (`add_business_days`, 0198; `_payout_add_business_days`, 0391).
- **Proposta (C4):** uma função "dias úteis da unidade" (fim de semana, feriado
  nacional, estadual e municipal da cidade da unidade, e o dia em que a unidade
  decidiu fechar), usada nos prazos deste plano.

---

## 6. Abandono de tratamento (D16)

**O furo:** o cliente para de vir com sessões pendentes e nunca pede para
cancelar. As sessões seguram a Fase 5 para sempre (3.1). Hoje o único sinal é a
etiqueta "inativo" depois de 90 dias, sem tarefa para ninguém.

**Proposta:**

1. Sessão pendente sem agendamento há **X dias** (configurável em Prazos,
   sugestão 30) → tarefa da **Recepção**: "reagendar", com as tentativas
   registradas.
2. Depois de **N tentativas** (sugestão 3) sem sucesso → tarefa do
   **Coordenador**: contatar o cliente, com o registro do que foi dito.
3. O cliente não volta → **registro formal de abandono de tratamento** no
   prontuário, pelo Coordenador, com os **riscos clínicos informados ao
   cliente** (data, meio, texto). É a proteção jurídica da clínica.
4. Depois do registro, o **Gerente** decide: abre o **cancelamento formal**
   (termo, acerto financeiro, seção 5.3) ou leva o cliente à **Fase 7** com
   retorno, mantendo as sessões em aberto para a volta.
5. O cliente reaparece em qualquer momento → o reagendamento desfaz o alerta.

O registro de abandono não apaga nada e não muda a venda: é um fato clínico e
jurídico. O acerto financeiro só acontece pelo cancelamento formal.

---

## 7. Para o cliente nunca ser esquecido

1. **Toda tarefa tem dono e não some até ser resolvida:** a pergunta ao
   dentista, a avaliação do Coordenador, o contato com o cliente, o
   reagendamento e o abandono. Aparecem no "Precisa de atenção" da ficha e no
   sino do responsável.
2. **Tarefa parada volta a avisar:** depois de **3 dias úteis da unidade**
   (5.8), de novo ao responsável e ao Gerente; configurável em Prazos (C4).
3. **Cliente que não atende:** cada tentativa registrada; depois de 3, o
   Coordenador pode encerrar como "sem contato" e o cliente vai para a Fase 7,
   sem nota (D6).
4. **Lista "Clientes sem próximo passo"** (Coordenador e Gerente). Entra quem
   está na Fase 5 **ou** na Fase 6 e:
   - não tem sessão nem reavaliação agendada; **e**
   - não tem tarefa aberta; **e**
   - não tem ortodontia **em tratamento** (a ortodontia **suspensa não
     protege**: entra na lista, D19); **e**
   - não tem complemento **com movimento nos últimos X dias** (o complemento
     parado entra na lista, D19).

   Cada linha mostra o motivo e a data da última sessão, e permite a
   as ações **por cliente** (Fase 7 com retorno, contato, abandono). A
   triagem em lote (D20) saiu: o riSZon começa do zero (seção 12).
5. **O botão manual "Tratamento Finalizado"** fica só para o Admin Master (D9).

---

## 8. Indicadores

**O que o plano passa a permitir medir** (os dados nascem nas tabelas novas):

| Indicador | Origem |
|---|---|
| Tempo entre a última sessão e a decisão (pergunta, contato ou reavaliação) | fim do plano × resposta/tarefa |
| Sim / Não / Não sei por dentista | respostas da pergunta |
| Distribuição dos cinco níveis e taxa de refação por dentista | avaliação do Coordenador |
| Clientes sem próximo passo, por unidade | a lista (7.4) |
| Satisfação do contato (0 a 10) e queixas, por unidade e por dentista | contato (3b) |
| Abandonos registrados, por unidade | registro de abandono (6) |
| Urgência → avaliação | tarefa da urgência (5.4) |

**Onde mostrar (D26):**
- no **Meu dia** do dentista: a satisfação dos clientes dele (o quadro "NPS do
  seu atendimento", hoje vazio) e a distribuição das notas técnicas dele;
- na lista "Clientes sem próximo passo": o total por unidade;
- no **catálogo de Metas** (indicador é código, meta é dado;
  `docs/metas/METAS-PLANO.md`): taxa de refação, satisfação, tempo até a
  decisão e clientes sem próximo passo, para virarem metas;
- **aviso ao dentista** também no **Excelente** (D24), não só no Revisar.

---

## 9. O que muda no sistema

**Banco (core, próximo número livre, conferir antes de gravar):**
- regra única "sobra tratamento?" (3.1), no lugar de
  `_outra_venda_em_tratamento`;
- fim de cada plano e do tratamento, com "Em tratamento" e "Concluído"
  automáticos;
- a pergunta dirigida a quem executou, o "Sim" automático do catálogo (marcação
  nova no procedimento, só o Admin edita) e a troca pelo Coordenador;
- a tabela do contato (tentativas, meio, resposta, satisfação 0–10, queixa,
  decisão) e a do abandono (tentativas, riscos informados), auditadas;
- os cinco níveis, com a conversão das antigas, e o aviso do Excelente;
- a saída da Fase 6 conferindo a avaliação e a data de retorno sugerida;
- o cancelamento: destino na efetivação, plano "Cancelado", Coordenador chamado,
  registro dos riscos;
- a urgência sem tratamento ficando na Fase 1 com a tarefa da avaliação;
- os dias úteis da unidade, os avisos por prazo e a leitura da lista.

**Telas:** janela da pergunta no Atendimento; tarefas no "Precisa de atenção";
avaliação em cinco níveis por plano; tarefa de contato; registro de abandono;
"Concluir a reavaliação" com a conferência e a data de retorno; cancelamento
sem destino na abertura e com o registro de riscos; a lista "Clientes sem
próximo passo" com triagem em lote; a marcação no catálogo de procedimentos; os
prazos novos em Prazos; o quadro de satisfação no Meu dia.

**Documentos:** `docs/JORNADA.md` §4 e §5 (princípios, fluxo, urgência,
cancelamento, abandono); o comentário desatualizado de `quality-checklist.tsx`;
manual da equipe, novidades e versão.

**Não mexe:** nas funções da ortodontia (`ortho_appointment_sync`,
`_ortho_open_from_sale`, `_ortho_complete_maintenance`,
`ortho_deliver_retainers`); só lê a situação do caso.

---

## 10. Data de retorno na Fase 7 (D22)

- Hoje a data de retorno (`clients.follow_up_return_at`) só é preenchida no
  cancelamento, digitada à mão. "Concluir a reavaliação" leva à Fase 7 sem data.
- **Proposta:** a data é **sugerida** por tipo de tratamento (padrão de 6
  meses, configurável em Prazos por unidade), e quem decide pode mudar.
- **Depois da ortodontia (C2):** a contenção precisa de acompanhamento próprio.
  O retorno da Fase 7 depois da ortodontia segue o **controle de contenção que o
  módulo de ortodontia já agenda** (reavaliação/controle do caso), em vez do
  padrão de 6 meses. A combinar com a sessão "módulo de ortodontia" (só leitura
  daqui).

---

## 11. Fora deste plano, já combinado

- **WhatsApp** ✅: depois deste plano. O contato (3b) nasce pronto para receber a
  resposta do cliente (satisfação 0–10 e queixa). O dono decide W1–W4
  (`docs/whatsapp/WHATSAPP-PASSO-A-PASSO.md`) e começa a verificação na Meta.
  Consentimento: o mesmo da Rita (`rita.contact_consents`, 3002).
- **Ortodontia** ✅: AP175 com a sessão "módulo de ortodontia". Pontos de
  contato: a entrega das contenções e o retorno depois da contenção.

---

## 12. Ordem de entrega (versão 3: o riSZon começa do zero)

**Decisão do dono (16/11/2026): o histórico de clientes das unidades NÃO será
importado; o riSZon começa do zero.** A produção tem 3 clientes e nenhum
esquecido (12.1). Por isso a rede de segurança deixa de ser urgente e a
prioridade vira **impedir que o primeiro esquecido nasça**: o motor vem antes.

| Etapa | O que entra | O dono precisa |
|---|---|---|
| **1. Levantamento** ✅ | Feito em 16/11/2026 (12.1). | — |
| **2. O motor** | Regra única "sobra tratamento?", fim do plano e do tratamento, situação automática do plano, a pergunta (com o "Sim" do catálogo e a troca pelo Coordenador), a janela no Atendimento, a urgência ficando na Fase 1. | Rodar a migração; marcar os procedimentos no catálogo |
| **3. O controle de qualidade** | Cinco níveis por plano, o contato com satisfação e queixa, a reabertura, a saída da Fase 6, o retorno sugerido. | Rodar a migração |
| **4. Abandono e a lista** | Reagendar → contato → registro de abandono → decisão do Gerente; a lista "Clientes sem próximo passo" com as ações por cliente. | Rodar a migração; definir X e N |
| **5. O cancelamento** | Destino na efetivação, plano "Cancelado", Coordenador chamado, riscos registrados. | Rodar a migração |
| **6. Prazos e indicadores** | Dias úteis da unidade, avisos por prazo, Meu dia, Metas. | Rodar a migração |

**A triagem em lote (D20) sai do plano:** sem histórico importado, não há
parados vindos das unidades. A lista da Etapa 4 mantém as ações **por cliente**
(Fase 7 com retorno, contato, abandono). Se um dia houver importação, a
triagem em lote volta, e a importação terá de trazer as sessões pendentes e a
data da última sessão de cada cliente.

Cada etapa: ensaio no treino em transação desfeita, testes provados quebrando,
manual e novidades; a migração vai para a produção pelo dono antes do push.

### 12.1. Resultado da Etapa 1 (levantamento, 16/11/2026, só leitura)

Script só de leitura, pela chave de serviço, contando por unidade; nenhum dado
pessoal impresso. "Sem próximo passo" é aproximado: Fase 5, sem agendamento
futuro, sem pergunta aberta e sem ortodontia aberta.

**Produção:** **3 clientes**, 0 sessões de tratamento, 2 agendamentos, 1 plano
(aguardando apresentação). **Não há histórico das unidades no banco:** os
clientes antigos não foram importados. Nenhum esquecido hoje. ⚠️ A premissa "os
esquecidos já existem" vale para as unidades, não para o riSZon; a triagem em
lote (D20) só faz sentido **se** o histórico for importado.

**Treino** (dados de teste da equipe, 123 clientes):

| | Cambé | Londrina |
|---|---|---|
| Fase 5 | 2 | 31 |
| Fase 5 sem nenhuma sessão | 1 | — |
| Fase 5 com tudo concluído e **sem pergunta** | — | 7 |
| Fase 5 com sessão pendente sem agendamento | 1 (31–90 dias) | 19 (≤ 30 dias) |
| Fase 5 com ortodontia aberta | — | 2 |
| **Fase 5 sem próximo passo** (aprox.) | **2** | **28** |
| Fase 6 (todos sem agendamento futuro) | — | 2 |

Na rede do treino: **0** perguntas do fim abertas na história (`journey_decisions`
vazia), **0** clientes com "Tratamento Finalizado", **0** avaliações de
qualidade gravadas, **0** planos complementares, 1 plano "Em tratamento" e
nenhum "Concluído" (os botões manuais quase não foram usados), 3 cancelamentos
efetivados (os 2 sem destino são de venda não fechada; nenhum cliente preso na
Fase 5 por isso).

**O que isso confirma:** o defeito é real e total: em nenhum dos dois bancos a
pergunta do fim do tratamento chegou a abrir uma vez.

---

## 13. Decisões

| # | Pergunta | Recomendação | Situação |
|---|---|---|---|
| D1 | Nomes dos níveis do meio | Bom, Aceitável, Revisar | ✅ 16/11/2026 |
| D2 | O que conta como procedimento | Todas as sessões de todas as vendas, menos as canceladas | ✅ 16/11/2026 |
| D3 | Complemento em andamento segura a Fase 5? | Sim, com prazo (D19) | ✅ 16/11/2026 |
| D4 | "Novo planejamento" como 3ª saída do contato | Sim | ✅ 16/11/2026 |
| D5 | Nota do contato | **Substituída pela D18** | — |
| D6 | Cliente que não atende | "Sem contato" depois de 3 tentativas, Fase 7 sem nota | ✅ 16/11/2026 |
| D7 | Observação obrigatória | Só em Revisar e Refazer | ✅ 16/11/2026 |
| D8 | Avaliações antigas | Converter | ✅ 16/11/2026 |
| D9 | Botão manual "Tratamento Finalizado" | Só o Admin Master | ✅ 16/11/2026 |
| D10 | Destino do cancelamento | Decidido na efetivação, pela regra única | ✅ 16/11/2026 |
| D11 | Cancelamento chama o Coordenador | Sim: avaliação (Fase 6) ou contato (Fase 7) | ✅ 16/11/2026 |
| D12 | Quem escolhe entre Fase 6 e 7 no cancelamento | Continua o Gerente, com o Coordenador avisado | ✅ 16/11/2026 |
| D13 | Urgência sem tratamento | **Revista:** fica na Fase 1 e vira tarefa "agendar avaliação completa" (muda a regra 1→5) | ✅ 16/11/2026 |
| D14 | Limpeza do PPR+ | Fora do fim; coberta pelo WhatsApp | ✅ 16/11/2026 |
| D15 | Refação: custo e repasse | Custo zero (já é); repasse como a 0400 (já é); ligar o "Refazer com outro" ao fluxo de falha, sem regra nova | ✅ 16/11/2026 |
| D16 | Abandono de tratamento | Reagendar (30 dias) → 3 tentativas → contato do Coordenador → registro com riscos → Gerente: cancelamento ou Fase 7 | ✅ 16/11/2026 |
| D17 | Reavaliação obrigatória no catálogo | Marcação no procedimento (só o Admin edita); com ela, "Sim" automático | ✅ 16/11/2026 |
| D18 | Nota do contato | Satisfação 0–10 + queixa sim/não; queixa obriga revisar; cinco níveis só no presencial | ✅ 16/11/2026 (reconsideração do Passo 3b) |
| D19 | Complemento ou ortodontia parados | Seguram a fase, mas entram na lista depois de X dias sem movimento (sugestão 30); ortodontia suspensa não protege da lista | ✅ 16/11/2026 |
| D20 | Parados vindos das unidades | Triagem em lote na lista, corte de 12 meses pela última sessão | Sem efeito: o riSZon começa do zero, sem importar o histórico (dono, 16/11/2026) |
| D21 | O Coordenador muda a resposta do dentista | Sim, até o próximo passo acontecer | ✅ 16/11/2026 |
| D22 | Data de retorno na Fase 7 | Sugerida: 6 meses por padrão, por tipo de tratamento, configurável; depois da ortodontia, o controle de contenção | ✅ 16/11/2026 |
| D23 | Saída da Fase 6 | Só com tudo aprovado; Revisar/Refazer em aberto mantém na 6 | ✅ 16/11/2026 |
| D24 | Avisar o dentista do Excelente | Sim | ✅ 16/11/2026 |
| D25 | Riscos clínicos no cancelamento | Registro do Coordenador obrigatório quando há procedimento executado e incompleto | ✅ 16/11/2026 |
| D26 | Onde mostrar os indicadores | Meu dia do dentista, a lista por unidade e o catálogo de Metas | ✅ 16/11/2026 |
| C1 | Avaliação com tratamento em andamento | Consulta dentro da Fase 5 | ✅ 16/11/2026 |
| C2 | Ortodontia termina na entrega da contenção | Sim | ✅ 16/11/2026 |
| C3 | Fim da ortodontia abre a pergunta e o controle | Sim | ✅ 16/11/2026 |
| C4 | Prazo da tarefa parada | 3 dias úteis **da unidade** (com os feriados locais), chega ao Gerente | ✅ 16/11/2026 |
