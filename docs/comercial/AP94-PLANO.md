# AP94 — Resumo por IA das gravações + Google Meet/Gemini no riSZon (PLANO)

*Plano apresentado ao dono em 03/11/2026 (versão 1: só o resumo da
apresentação comercial). **Versão 2, no mesmo dia, depois do pedido do dono
ampliar o escopo:** dois momentos de gravação (avaliação clínica e
apresentação comercial), envio de áudio/transcrição/resumo à mão, e a
integração com o Google Meet e o Gemini (criar reunião, convidar, apresentar
dentro do Meet, resumo automático, atualização do sistema, follow-up).*
*✅ **Todas as decisões tomadas em 03/11/2026** (D1–D9, §8): IA = **Gemini 3.1
Pro no Vertex AI, região São Paulo** (sem serviço de transcrição à parte);
rascunho clínico em 5 partes; a reunião do Meet nasce numa **conta central da
Risarte**; apresentar dentro do Meet fica para depois (compartilhar a tela).
Próximo passo: IA1.*

---

## 1. A ideia em uma frase

**A IA escreve o rascunho; uma pessoa lê, corrige e salva.** Vale para os
dois momentos: o resumo clínico que o Coordenador manda ao Centro de
Planejamento e o resumo comercial que o Consultor põe no contrato
(`{{apresentacao_resumo}}`, 0348). Texto que decide um plano de tratamento ou
que o cliente assina não sai de uma máquina sem alguém ler.

Analogia: a IA é a **secretária que ouviu a reunião e redige a ata**; quem
assina a ata é o Coordenador ou o Consultor.

---

## 2. Os dois momentos (pedido do dono, 03/11/2026)

| | **Momento 1 — Avaliação / reavaliação** | **Momento 2 — Apresentação comercial** |
|---|---|---|
| Quem | Coordenador Clínico | Consultor Comercial |
| Onde | Presencial, na unidade | Online, pelo Google Meet |
| Quem grava hoje | **O riSZon** (barra de cima; liga sozinho ao iniciar o atendimento; salva no bucket `clinical-media`; teto 2 h; dispensa de consentimento só nestas duas fases — `dispensaConsentimento`) | **O Meet** (o Consultor cola o link da gravação; o sistema não tem acesso ao arquivo) |
| Para onde vai o resumo | Centro de Planejamento (o Planner lê). Hoje: as **considerações** (`clinical_notes`) escritas à mão; a coluna `clinical_evaluations.summary` **existe e nada grava nela** | Campo Resumo da apresentação (`commercial_presentations.summary`) → contrato |
| O que o dono pediu | Ao enviar ao Planejamento, o Coordenador manda **o que já tem**; o resumo da IA é gerado **depois**, e **aparece em todo lugar** quando ficar pronto; enquanto gera, a tela diz "gerando"; se falhar, diz **por quê** | A gravação **termina ao encerrar a chamada**; o resumo rascunhado pela IA vai ao campo para o Consultor revisar |
| Entrada manual (pedido do dono) | **Enviar um arquivo de áudio**, ou colar **a transcrição**, ou escrever **o resumo** direto | Idem |

**Fato que simplifica o Momento 1:** o riSZon já grava o áudio e já tem o
botão "Enviar ao Centro de Planejamento" que **para a gravação e espera o
áudio subir** antes de enviar (OC-00086, `pararGravacaoDoCliente`). O resumo
automático entra **logo depois desse ponto**: áudio salvo → fila → IA →
resumo.

**Fato que muda o Momento 2:** o gravador do riSZon grava **só o microfone do
computador do Consultor** — numa chamada do Meet a voz do cliente não entra.
Para a online, quem grava é o **Meet**, e é dele que o texto tem de vir
(§4). O gravador do riSZon continua servindo se a apresentação for presencial.

---

## 3. O que a documentação diz (lido em 03/11/2026)

**IA (texto → resumo; e, no Gemini, áudio → resumo direto):**

- **O Claude (Anthropic) não recebe áudio**: lê texto. Para resumir uma
  gravação são dois passos (transcrever, depois resumir).
- **O Gemini (Google) recebe áudio direto** (32 tokens por segundo de áudio:
  1 h ≈ 115 mil tokens) e devolve transcrição e resumo numa chamada só —
  **um fornecedor só** para o Momento 1.
- Preços (página oficial do Gemini, lida hoje): `gemini-3.1-pro-preview`
  US$ 2 por milhão de tokens lidos / US$ 12 escritos (sem preço separado de
  áudio); `gemini-3-flash-preview` US$ 0,50 texto e **US$ 1,00 áudio** /
  US$ 3 escritos; `gemini-3.8-flash` US$ 0,75 / US$ 3,75 (sobe para 1,50 /
  7,50 em 2027). **No nível pago o conteúdo não é usado para treinar**; no
  nível gratuito é. Claude Opus 5.5: US$ 4 / US$ 20; Sonnet 5.5: US$ 2 /
  US$ 10.

**Google Meet pela API (o que o dono pediu dá para fazer):**

| Pedido do dono | Como a API faz | Observação |
|---|---|---|
| Criar a reunião pelo riSZon e configurar os detalhes | **Calendar API** `events.insert` com `conferenceData.createRequest` (tipo `hangoutsMeet`) cria o evento com link do Meet; título, horário, descrição, convidados | Exige `conferenceDataVersion=1`; a criação do Meet pode voltar "pendente" e precisa ser reconferida. |
| Mandar o link ao cliente | O Calendar **envia o convite por e-mail** sozinho (`sendUpdates`) para os convidados; e o riSZon mostra o link para mandar por WhatsApp (`linkDoWhatsApp`, já existe) | O e-mail do cliente está em `clients.email`. |
| Gravação termina ao encerrar a chamada | **Meet REST API** `spaces` com `config.artifactConfig`: `recordingConfig.autoRecordingGeneration = ON`, `transcriptionConfig.autoTranscriptionGeneration = ON`, `smartNotesConfig.autoSmartNotesGeneration = ON` — grava, transcreve e faz as notas do Gemini **sozinho** quando o Consultor entra; para quando a chamada acaba | É exatamente o pedido. Os arquivos vão para o **Drive do organizador**. |
| Resumo automático | **Workspace Events API**: assinatura nos eventos `google.workspace.meet.transcript.v2.fileGenerated` e `recording.v2.fileGenerated` (entregues por **Pub/Sub**); o riSZon recebe, lê a transcrição por `conferenceRecords.transcripts.entries` (texto, quem falou, hora) e manda à IA | Entradas da transcrição ficam disponíveis **30 dias**. O riSZon tem de buscar e guardar nesse prazo (D4: guarda). |
| Apresentar o plano dentro do Meet | **Meet Add-ons SDK**: um complemento com painel lateral + palco principal, rodando a tela de apresentação do riSZon (`/apresentacao/[clientId]`) dentro do Meet | Precisa de publicação no Google Workspace Marketplace (privada, só para o domínio da Risarte) e de um projeto no Google Cloud. **Alternativa sem obra:** compartilhar a tela da apresentação, que já existe. |
| Atualização do sistema | O mesmo evento que traz a transcrição marca a apresentação como **realizada** (`commercial_set_stage` → "Apresentado"), grava o link da gravação e dispara o resumo | Hoje o Consultor marca à mão. |
| Follow-up | O resumo alimenta a **cadência de follow-up** que já existe (`commercial_start_followup`, tentativas, escalada à Gerente): a IA sugere a mensagem da próxima tentativa a partir do que o cliente disse e do que recusou; o envio continua pela pessoa (WhatsApp) | Mensagem automática ao cliente **não** — decisão do dono em outras frentes: aviso só a quem opera. |

**Pré-requisitos do lado do Google (do dono):**

1. **Google Workspace Business Standard ou superior** na conta que organiza as
   reuniões (gravação e transcrição do Meet; as **notas do Gemini** podem
   exigir o complemento Gemini conforme o plano — conferir no painel do
   Workspace).
2. **Projeto no Google Cloud** com as APIs Calendar, Meet, Workspace Events,
   Pub/Sub (e Vertex AI, se o Gemini for a IA) ligadas; **conta de serviço com
   delegação em todo o domínio** (DWD) para agir em nome dos Consultores —
   sem isso o Calendar não aceita convidados nem cria o Meet. Cobrança do
   Google Cloud separada do Workspace.
3. **Contrato de tratamento de dados** com quem receber o texto (D3).

---

## 4. Por onde entra o texto — por momento

| Caminho | Momento 1 (clínico) | Momento 2 (comercial) | Custo / h |
|---|---|---|---|
| **Automático** | Áudio do gravador do riSZon → IA | Transcrição do Meet (evento → API) → IA | Clínico: Gemini Flash ≈ US$ 0,12 (áudio) ou transcrição + IA ≈ US$ 0,30–0,50; comercial: só a IA ≈ US$ 0,06–0,12 |
| **Arquivo de áudio enviado** (pedido do dono) | Sobe para `clinical-media` (até 2 h; mp3, m4a, webm, ogg) → mesma fila | Idem | Igual ao clínico automático |
| **Transcrição colada** | Campo de texto (ou `.txt`) → IA | Idem (a transcrição do Meet também pode ser colada, enquanto a API não estiver ligada) | Só a IA |
| **Resumo escrito direto** | O de sempre (considerações) | O de sempre (campo Resumo) | 0 |

Baixar o vídeo do Meet e enviar ao sistema fica de fora (pesado; a API e a
transcrição colada cobrem o caso).

---

## 5. Como a tela fica

**Bloco "Transcrição e resumo por IA"** — o mesmo componente nos dois lugares
(cockpit da Avaliação, passo final; aba Apresentação do cockpit do Consultor):

1. **Situação** da geração, sempre visível quando há pedido: *Na fila* ·
   *Gerando o resumo… (iniciado há 2 min)* · *Pronto — revise* · **Falhou:
   motivo** (áudio sem fala reconhecível, arquivo grande demais, IA
   indisponível, chave não configurada, fornecedor recusou o conteúdo), com o
   botão *Tentar de novo*. Nada é apagado numa falha.
2. **Entradas manuais:** *Enviar áudio* · *Colar transcrição* · (o campo de
   resumo/considerações de sempre).
3. **Rascunho** numa caixa âmbar: *"Rascunho escrito pela IA. Leia, corrija e
   salve."* Botão **Usar este texto** copia para o campo; **Salvar é o de
   sempre**. O rascunho **nunca** entra no campo sozinho.
4. Sem chave da IA: botões desabilitados com *"IA não configurada — peça ao
   Admin"* (padrão do e-mail sem `RESEND_API_KEY`).

**Momento 1 — "aparece em todo lugar quando ficar pronto":** o Planner vê o
cartão *Resumo da avaliação (IA)* no Centro de Planejamento e na ficha, com a
mesma situação (gerando / pronto / falhou), **atualizando sozinho**
(Realtime, padrão `AtualizaAoVivo`). Enquanto não há resumo, o Planner
trabalha com as considerações e o áudio, como hoje. O rascunho clínico é
**revisado pelo Coordenador** (ele é quem ouviu); até ele salvar, o Planner vê
o rascunho marcado como *não revisado*. O resumo revisado grava em
`clinical_evaluations.summary` (a coluna vazia de hoje) e aparece no
prontuário completo.

**Momento 2 — estrutura do rascunho (D2):** o que foi apresentado · perguntas
e pedidos do cliente · condições faladas · **o que o cliente recusou** ·
próximos passos; até ~1.800 caracteres; **"não mencionado"** quando a
transcrição não tem. **Momento 1 — estrutura (proposta, D7):** queixa
principal e expectativa do paciente · histórico relevante dito na consulta ·
achados comentados em voz alta · o que o paciente quer / não quer · dúvidas
abertas para o Planner; até ~2.500 caracteres.

**Meet pelo riSZon (fase IA3):** no cockpit do Consultor, **"Marcar
apresentação no Meet"** abre uma janelinha com data/hora, duração, título,
descrição e o e-mail do cliente (preenchido de `clients.email`; se não tiver,
pede e salva na ficha); cria o evento, mostra o link, oferece *Enviar por
WhatsApp* e grava `meet_link`. Quando a chamada termina, a transcrição chega
sozinha, a apresentação é marcada como realizada e o resumo é rascunhado.

---

## 6. LGPD — o que sai da Risarte e para onde

- **O que sai:** texto da conversa (nome, queixa, plano de tratamento,
  condições de pagamento) e, no Momento 1, **o áudio** (se a IA for o Gemini)
  — dado de saúde (LGPD art. 11).
- **Hoje já sai:** no Momento 2, a gravação e a transcrição já estão no
  Google (Workspace da Risarte é o controlador). Pelo Gemini no **Vertex AI em
  São Paulo**, o dado fica no Google e **pode ficar no Brasil** (o Google
  garante o dado *guardado* na região; o processamento na região vale com o
  endereço regional, não o "global" — confirmar para o modelo escolhido).
- **Pela Anthropic:** EUA, com DPA nos termos comerciais e **retenção zero sob
  pedido**; não treina com a API. (O Claude Fable 5.1 exige retenção de 30
  dias — por isso Opus 5.5 ou Sonnet 5.5.)
- **O que o sistema faz:** não grava texto em log, URL ou aviso; auditoria
  registra **que** gerou (quem, quando, cliente, modelo, custo), nunca o
  texto; transcrição e rascunho seguem a regra de leitura do lugar onde moram
  (prontuário clínico / apresentação comercial).
- **Consentimento:** o Momento 1 já tem a dispensa do áudio (decisão de
  21/09/2026 com o jurídico) — mas a dispensa é **gravar**; **mandar a um
  operador de IA** é tratamento novo e entra no termo. O Momento 2 pelo
  gravador do riSZon exige consentimento registrado (regra de hoje).
- **D3 (decidida):** nada liga na produção antes do DPA assinado e do termo
  ajustado — o jurídico dá o OK.

---

## 7. As fases

| Fase | O que entrega | Depende de |
|---|---|---|
| **IA1 — a fila e o rascunho** (migração 0349) | Tabela `ai_summary_jobs` (cliente, momento, origem: áudio/transcrição, situação: fila/gerando/pronto/falhou, motivo da falha, modelo, tokens, custo, quem pediu); colunas em `commercial_presentations` (`transcript`, `transcript_source`, `ai_draft`, `ai_draft_at`, `ai_model`, `summary_source`) e em `clinical_evaluations` (`transcript`, `ai_draft`, `ai_draft_at`, `ai_model`, `summary_reviewed_by/at`); porta única da IA (`src/lib/ia/modelo.ts`: um arquivo por fornecedor); rota de trabalho `/api/ia/resumos` (cron de 1 min + disparo ao enfileirar; `maxDuration` 300; lê o áudio do bucket pela chave de serviço com URL assinada curta; parte arquivos acima do limite); o bloco da §5 nos dois cockpits, com **enviar áudio**, **colar transcrição**, situação ao vivo e falha explicada; o Momento 1 enfileira sozinho ao enviar ao Planejamento (depois do áudio salvo); cartão do Planner em tempo real; `summary` da rodada passa a ser gravado | **D5** (IA), **D6** (transcrição, se a IA não ler áudio), chave(s) na Vercel |
| **IA2 — réguas e manual** | Testes: o rascunho nunca grava o campo final; "não inventar" e estrutura no pedido; falha vira motivo legível e nunca apaga nada; sem chave → `configured: false`; auditoria sem texto; o Momento 1 enfileira **depois** de `pararGravacaoDoCliente` (régua em `fim-da-avaliacao.test.ts`). Manual §6.5 e §4 (avaliação), changelog, EV, ESTADO | IA1 |
| **IA3 — o Meet pelo riSZon** | Janelinha "Marcar apresentação no Meet" (Calendar API **na agenda da conta central** — D8 — com o Consultor e o cliente como convidados e o Consultor como **co-anfitrião** do espaço, para a gravação automática ligar quando ele entrar), link + WhatsApp + e-mail do cliente, espaço com gravação/transcrição/notas automáticas, **uma** assinatura de eventos da conta central (Pub/Sub → rota `/api/webhooks/google-meet`), leitura da transcrição em até 30 dias, apresentação marcada como realizada, resumo enfileirado. ⚠️ Provar no treino, antes de valer: a gravação automática liga com o organizador **ausente** e só o co-anfitrião presente — se não ligar, o Consultor liga à mão e o fluxo segue igual | Workspace Business Standard+ **na conta central**, projeto Google Cloud (DWD só para a conta central), **D8 ✅** |
| **IA4 — follow-up assistido** | No cartão de follow-up, *"Sugerir mensagem"* a partir do resumo (o que o cliente pediu/recusou) e da cadência; a pessoa edita e manda pelo WhatsApp; nada automático ao cliente | IA1 |
| **IA5 — apresentar dentro do Meet** | Complemento do Meet (Add-ons SDK) com a tela de apresentação do riSZon no palco principal; publicação privada no Marketplace | IA3, **D9** |

Cada fase é uma sessão (a IA1 provavelmente duas). A ordem IA1 → IA3 é a que
dá resultado mais cedo: o resumo já funciona com a transcrição colada
enquanto o Google Cloud é montado.

**O que o dono prepara, em paralelo à IA1 (checklist):**

1. Projeto no **Google Cloud** (cobrança ativa) com Vertex AI ligado; conta de
   serviço; chave guardada **só na Vercel** (`GOOGLE_VERTEX_*`, Secret), nos
   dois projetos. Região **southamerica-east1**. Alerta de gasto (US$ 100/mês).
2. Para a IA3: a **conta central** (ex.: `comercial@risarte…`) no Workspace
   **Business Standard ou superior**; APIs Calendar, Meet e Workspace Events
   ligadas no mesmo projeto; DWD para a conta de serviço agir pela conta
   central; um tópico Pub/Sub.
3. **Jurídico (D3):** termos do Google Cloud revisados e o termo de
   consentimento do paciente dizendo que a consulta é transcrita e resumida
   com apoio de IA por operador contratado — também para a avaliação clínica
   (a dispensa de 21/09 cobre gravar, não mandar à IA).

---

## 8. Decisões do dono

| # | Pergunta | Recomendação | **Decisão** |
|---|---|---|---|
| **D1** | Por onde entra o texto na primeira fase? | A (transcrição do Meet) agora, B (gravador) depois | **Os dois na mesma entrega** (03/11). Ampliado no mesmo dia: os dois momentos, envio manual de áudio/transcrição/resumo, Meet + Gemini. |
| **D2** | Conteúdo do rascunho comercial | 4 partes | **5 partes, com o que o cliente recusou** (03/11). |
| **D3** | Quando a IA liga na produção | Depois do DPA e do termo | **Como recomendado** (03/11). |
| **D4** | Guardar a transcrição | Sim | **Como recomendado** (03/11). |
| **D5** | **Qual IA escreve o resumo?** | §9. Com o Meet e o Gemini no pedido, **Gemini no Vertex AI (São Paulo)** vira a escolha natural: um fornecedor, lê áudio, dado no Brasil, mesma conta Google Cloud das APIs do Meet. Alternativa: Claude Opus 5.5 (Anthropic) se o jurídico preferir o arranjo com DPA/retenção zero e o dono quiser a IA mais forte em texto. | **Gemini 3.1 Pro no Vertex AI, São Paulo** (03/11). A porta `src/lib/ia/modelo.ts` nasce trocável mesmo assim. |
| **D6** | **Quem transcreve o áudio do Momento 1?** | §10. Se D5 = Gemini, **ninguém mais** (ele lê o áudio). Se D5 = Claude, Deepgram Nova-3 (ou Google Speech-to-Text para dado no Brasil). | **Ninguém mais** — decorre da D5: o Gemini lê o áudio. A §10 fica como referência se um dia a IA mudar. |
| **D7** | Estrutura do rascunho **clínico** | A da §5 (queixa · histórico · achados ditos · quer/não quer · dúvidas para o Planner), revisada pelo Coordenador antes de valer | **Como recomendado** (03/11): 5 partes, até ~2.500 caracteres. |
| **D8** | Em nome de quem o riSZon cria a reunião no Google? | **Em nome do Consultor** (DWD: a reunião nasce na agenda dele; a gravação vai para o Drive dele; ele é o organizador). Alternativa: uma conta "comercial@" da Risarte organiza tudo (Drive central, mas o Consultor entra como convidado e precisa de permissão para gravar). | **Conta central da Risarte** (03/11, contra a recomendação). Consequências anotadas na §7, fase IA3: a conta central é a organizadora e dona das gravações; o Consultor entra como **co-anfitrião** (membro do espaço pela API) para a gravação automática ligar quando ele entrar; uma assinatura de eventos só (a da conta central) cobre todas as apresentações; a conta precisa do plano que grava e transcreve. |
| **D9** | Apresentar o plano **dentro** do Meet | **Depois** (IA5): primeiro compartilhar a tela da apresentação que já existe; o complemento exige publicação no Marketplace e manutenção. | **Como recomendado** (03/11): compartilhar a tela; IA5 fica para depois. |

---

## 9. Comparativo — qual IA escreve o resumo (D5)

*Conta para 1 h de conversa: ≈ 25 mil tokens de texto lidos (transcrição) e
≈ 1 mil escritos; para áudio direto, ≈ 115 mil tokens lidos.*

| IA | Lê áudio? | Preço (milhão lidos / escritos) | **Por apresentação (texto)** | **Por avaliação (áudio direto)** | Onde processa | Contrato / retenção |
|---|---|---|---|---|---|---|
| **Gemini 3.1 Pro** (Google, Vertex AI) | **Sim** | US$ 2 / 12 | ≈ US$ 0,06 | ≈ US$ 0,24 | **Pode ser São Paulo** (confirmar o modelo na região) | Termos Google Cloud; nível pago não treina |
| **Gemini 3 Flash / 3.8 Flash** (Google) | **Sim** | US$ 0,50–0,75 / 3–3,75; áudio US$ 1 | ≈ US$ 0,02 | ≈ US$ 0,12 | Idem | Idem |
| **Claude Opus 5.5** (Anthropic) | Não | US$ 4 / 20 | ≈ US$ 0,12 | — (precisa de transcrição: + US$ 0,20–0,36) | EUA | DPA; retenção zero sob pedido |
| Claude Sonnet 5.5 | Não | US$ 2 / 10 | ≈ US$ 0,06 | — (idem) | EUA | Idem |
| GPT-5.5 (OpenAI) | Não (modelo de texto) | US$ 5 / 30 | ≈ US$ 0,16 | — | EUA; sem região Brasil | Retenção zero só com aprovação |

**Leitura.** Todos os de primeira linha resumem bem 1 h de conversa em
português; a diferença é de centavos por caso (100 casos/mês: US$ 6–25). O
que separa: **(a)** o Gemini lê o áudio e dispensa um segundo fornecedor no
Momento 1; **(b)** o Gemini pode rodar em **São Paulo**; **(c)** o pedido do
dono já põe o Google (Meet, Calendar, Events) no projeto — a IA na mesma
conta é um contrato, uma cobrança e um painel de gastos. A Anthropic ganha em
qualidade de texto no topo (Opus 5.5) e em simplicidade de contrato (DPA +
retenção zero prontos); perde por exigir transcrição à parte. **Recomendação:
Gemini 3.1 Pro no Vertex AI, região São Paulo**, com a porta trocável para o
Claude se a qualidade do rascunho decepcionar no treino (a troca é um arquivo
e uma variável).

---

## 10. Comparativo — transcrição à parte (D6, só se D5 ≠ Gemini)

| Serviço | Preço / h | Português | Retenção do áudio | Região | Obs. |
|---|---|---|---|---|---|
| Deepgram Nova-3 | ≈ US$ 0,31 | Sim | Diz não guardar por padrão (confirmar no contrato) | EUA | Barato; +US$ 0,12/h para separar quem fala |
| OpenAI gpt-4o-transcribe | ≈ US$ 0,36 (mini 0,18) | Sim | 30 dias; retenção zero com aprovação | EUA | Arquivo ≤ 25 MB por chamada (2 h precisam ser partidas) |
| AssemblyAI | ≈ US$ 0,15–0,21 | Sim | Apaga áudio em 2 dias; transcrição apagada a pedido | EUA | Mais barato; um passo a mais do nosso lado |
| Google Speech-to-Text (Chirp 3) | ≈ US$ 0,96 (lote 0,24) | Sim | Termos Google Cloud | Possível São Paulo (não confirmado) | Faz sentido só junto do Google |

---

## 11. Custo total estimado (Gemini 3.1 Pro, São Paulo)

| | Por caso | 100/mês |
|---|---|---|
| Avaliação clínica (1 h de áudio → resumo) | ≈ US$ 0,24 | ≈ US$ 24 |
| Apresentação comercial (transcrição do Meet → resumo) | ≈ US$ 0,06 | ≈ US$ 6 |
| Sugestão de follow-up | ≈ US$ 0,01 | ≈ US$ 1 |
| Google Workspace Business Standard | já da rede (conferir) | — |
| Google Cloud (APIs do Meet/Calendar/Events, Pub/Sub) | centavos | < US$ 5 |

Em reais, a R$ 5,50/US$: ≈ R$ 1,30 por avaliação e R$ 0,35 por apresentação.
Sem mensalidade; o painel do Google Cloud permite **alerta e teto de gasto**
(sugestão: US$ 100/mês).

---

## 12. O que fica registrado como limite

- A transcrição do Meet pela API vale **30 dias**: o riSZon tem de buscar
  nesse prazo (a assinatura de eventos garante isso no dia; a rota de cron
  recolhe o que escapou).
- O gravador do riSZon **não grava a chamada do Meet** (só o microfone local).
- As notas do Gemini do próprio Meet (*smart notes*) podem exigir o
  complemento Gemini no Workspace; o riSZon **não depende delas** — gera o
  próprio resumo a partir da transcrição, com a estrutura do contrato.
- Apresentar **dentro** do Meet (IA5) exige complemento publicado no
  Marketplace; até lá, compartilhar a tela.
- Preços lidos em 03/11/2026 em páginas oficiais (Gemini, Meet, Anthropic) e
  de terceiros (Deepgram, AssemblyAI, OpenAI por minuto): **conferir antes de
  contratar**.
