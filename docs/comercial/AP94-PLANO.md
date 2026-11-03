# AP94 — O resumo da apresentação escrito pela IA (PLANO)

*Plano apresentado ao dono em 03/11/2026. **D1–D4 decididas no mesmo dia**
(§8): os caminhos A e B na mesma entrega; rascunho em 5 partes (com o que o
cliente recusou); a IA só liga depois do DPA e do termo; a transcrição fica
guardada. **Abertas: D5 (qual IA escreve o resumo) e D6 (qual serviço
transcreve)** — comparativos nas §9 e §10, a pedido do dono.*
*Origem: OC-00158 (03/11/2026), consideração do Admin Master: "considerar a
gravação para gerar o resumo". Decisão do dono no mesmo dia: etapa separada,
com plano próprio. Registrado como AP94 no `docs/BACKLOG.md`.*

---

## 1. A ideia em uma frase

**A IA escreve o rascunho; o Consultor lê, corrige e salva.** O resumo da
apresentação vai no contrato que o cliente assina (`{{apresentacao_resumo}}`,
0348) — texto que uma pessoa assina não sai de uma máquina sem alguém ler. A
IA tira o trabalho de digitar; não tira a responsabilidade de conferir.

Analogia: a IA é a **secretária que ouviu a reunião e redige a ata**; quem
assina a ata é o Consultor.

---

## 2. O que existe hoje (e o que falta)

| Hoje | Como está |
|---|---|
| A apresentação é online, pelo **Google Meet**; o Consultor cola o **link da chamada** e o **link da gravação** (Meet/Drive) na aba Apresentação do cockpit (`presentation-workspace.tsx`, tabela `commercial_presentations`: `meet_link`, `recording_url`, `summary`). | O sistema **não tem acesso** ao que está nesse link: é um endereço no Google Drive do Consultor. Nada é baixado, transcrito ou lido. |
| O **resumo** é digitado à mão e, desde a 0348, é **obrigatório para o aceite** e vai no contrato. | É o que a IA vai rascunhar. |
| O sistema tem um **gravador próprio** (`src/lib/gravacao.ts`, barra de cima): liga sozinho na avaliação e na reavaliação, salva o áudio no bucket privado `clinical-media`, com teto de 2 h. | Ele grava **só o microfone de quem está no computador**. Numa apresentação pelo Meet, a voz do cliente sai pela caixa de som e **não entra** na gravação — ficaria metade da conversa. Serve para apresentação **presencial**, não para a online. |
| **Nenhuma IA ligada** ao sistema. Não há chave, conta nem contrato com fornecedor de IA. | Depende do dono contratar e cadastrar na Vercel. |
| O consentimento LGPD (`client_consents`) é exigido para gravar; a **única dispensa** é o áudio da avaliação/reavaliação (`dispensaConsentimento`). A apresentação comercial **não** está na dispensa. | Gravar a apresentação pelo sistema exige o consentimento registrado — regra já existente, não muda. |

**O que a documentação dos fornecedores diz** (lido em 03/11/2026, preços de
tabela, conferir antes de contratar):

- **O Claude (Anthropic) não recebe áudio.** Ele lê texto. Para resumir uma
  gravação são **dois passos**: (1) alguém transforma o áudio em texto — a
  **transcrição**; (2) a IA lê o texto e escreve o resumo.
- **O Google Meet já transcreve sozinho** nos planos do Workspace a partir do
  **Business Standard** (o Business Starter e as contas gratuitas não têm). A
  transcrição vira um Google Docs no Drive de quem marcou a reunião. Em
  português. Se a Risarte tem esse plano, **o passo 1 já está pago**.
- Serviços de transcrição por API (preço por **hora de áudio**, dólar):
  OpenAI `gpt-4o-transcribe` ≈ US$ 0,36/h (`gpt-4o-mini-transcribe` ≈
  US$ 0,18/h; arquivo de até 25 MB por chamada — 1 h de áudio do nosso gravador
  tem ≈ 15 MB); Deepgram Nova-3 multilíngue ≈ US$ 0,31/h; AssemblyAI ≈
  US$ 0,15–0,21/h; Google Speech-to-Text ≈ US$ 0,96/h. Todos entendem
  português do Brasil.
- **O resumo pela IA**: 1 h de conversa ≈ 9 mil palavras ≈ 20–25 mil "tokens".
  Com o Claude Opus 5.5 (US$ 4 por milhão de tokens lidos, US$ 20 por milhão
  escritos): **≈ US$ 0,10 por apresentação**.

---

## 3. Por onde entra o texto — três caminhos

| Caminho | Como funciona | Custo por apresentação de 1 h | Quando serve |
|---|---|---|---|
| **A. Transcrição do Meet** (recomendado para começar) | O Consultor abre o Docs da transcrição que o Meet gerou, copia o texto e **cola** na aba Apresentação (ou envia o `.txt`). Clica em **"Gerar rascunho do resumo"**. A IA escreve; ele revisa e salva. | Só a IA: **≈ US$ 0,10** (≈ R$ 0,55 a R$ 5,50/US$) | Apresentação **online** (o caso de hoje). Exige Workspace Business Standard ou superior. Sem contratar serviço de transcrição. |
| **B. Gravador do sistema + serviço de transcrição** | Ao **iniciar a apresentação** pelo funil (atendimento de apresentação comercial), a barra de cima grava — como já faz na avaliação. Ao concluir, o áudio vai ao bucket; o sistema manda ao serviço de transcrição, recebe o texto, e a IA rascunha. | Transcrição US$ 0,18–0,36 + IA US$ 0,10 ≈ **US$ 0,30–0,50** (≈ R$ 2–3) | Apresentação **presencial** (na unidade). Na online grava só o Consultor — **não serve**. Exige consentimento registrado antes (regra de hoje). |
| **C. Baixar o vídeo do Meet e enviar ao sistema** | O Consultor baixa o `.mp4` do Drive e sobe no sistema; o sistema extrai o áudio e transcreve. | Igual ao B, mais o custo de guardar 300–700 MB por apresentação | **Não recomendado**: arquivo pesado, dois cliques a mais que o caminho A, e o Meet já entrega o texto de graça. |

**Recomendação original:** A agora, B depois. **Decisão do dono (D1,
03/11/2026): A e B na mesma entrega** — a online entra pela transcrição do
Meet, a presencial pelo gravador do sistema; os dois caminhos desembocam no
mesmo campo de transcrição e no mesmo botão da IA. C fica de fora.

O que a decisão muda: a entrega passa a ter **dois fornecedores** (a IA do
resumo e o serviço de transcrição) e, portanto, **dois contratos de
tratamento de dados**; e o gravador passa a ligar também no atendimento de
apresentação comercial — com consentimento registrado, como manda a regra.

---

## 4. Como a tela fica (aba Apresentação do cockpit)

Abaixo do link da gravação, um bloco novo **"Transcrição e rascunho"**:

1. **Transcrição** — campo grande para colar o texto (ou botão *Enviar
   arquivo .txt*). Salva na ficha, com a origem (*Meet*, *gravação do
   sistema*) e a data.
2. Botão **"Gerar rascunho do resumo com IA"** — só aparece com transcrição
   salva e **só para quem pode negociar** (Consultor da unidade, Admin). Leva
   de 10 a 30 segundos; a tela mostra "A IA está lendo a transcrição…".
3. O **rascunho** aparece numa caixa âmbar, com o aviso: *"Rascunho escrito
   pela IA a partir da transcrição. Leia, corrija e salve — este texto vai no
   contrato."* Botão **"Usar este texto"** copia para o campo Resumo; o
   **Salvar é o de sempre**. O rascunho **nunca** entra no campo sozinho.
4. Sem chave de IA cadastrada: o botão fica desabilitado com *"IA não
   configurada — peça ao Admin"* (o mesmo padrão do e-mail sem
   `RESEND_API_KEY`).
5. Quem só vê a apresentação (não negocia) vê a transcrição e o rascunho, sem
   os botões.

**O que o rascunho contém** (estrutura fixa, pedida à IA no mesmo texto
sempre — decisão D2):

- O que foi apresentado ao cliente (procedimentos, opções, prazos).
- O que o cliente perguntou ou pediu para mudar.
- Condições faladas (valores, forma de pagamento, descontos mencionados).
- **O que o cliente disse que NÃO quer** (decisão D2 — serve à compra
  parcial; ⚠️ é a parte em que a IA mais erra o "não", e o aviso da tela
  pede atenção especial a ela).
- Próximos passos combinados.
- **Nunca inventar**: o que não está na transcrição não entra; se faltar,
  escreve "não mencionado".

Tamanho: até ~1.800 caracteres — cabe na Cláusula 1ª do contrato sem virar
uma página inteira.

---

## 5. LGPD — o que sai da Risarte e para onde

- **O que sai:** o **texto** da transcrição (nome do cliente, o plano de
  tratamento falado, condições de pagamento). É **dado de saúde** (LGPD
  art. 11): o mesmo que já mora no prontuário, agora enviado a um operador
  fora do Brasil (Anthropic, EUA).
- **O que não sai (caminho A):** nenhum áudio. O Google já tinha a gravação e
  a transcrição (o Workspace da Risarte é o controlador disso).
- **O que a Anthropic diz** (conferir no contrato na hora de assinar): a API
  não usa o conteúdo para treinar modelos; há **DPA** (acordo de tratamento
  de dados) disponível; a retenção padrão é de até 30 dias para abuso, com
  **retenção zero** sob pedido. ⚠️ O Claude Fable 5.1 **exige** retenção de
  30 dias — por isso o plano usa o **Opus 5.5**, que aceita retenção zero.
- **O que o sistema faz:** não grava a transcrição em log, não a põe em URL,
  não a manda em aviso; a auditoria registra **que** o rascunho foi gerado
  (quem, quando, qual cliente, qual modelo), **nunca o texto**. A transcrição
  e o rascunho obedecem à mesma regra de leitura de `commercial_presentations`.
- **O que depende do dono (D3):** assinar o DPA com a Anthropic, pedir
  retenção zero, e ajustar o **termo de consentimento** do cliente para dizer
  que a conversa é transcrita e resumida com apoio de IA por operador
  contratado. O jurídico dele dá a palavra final; o sistema não liga o botão
  antes.

---

## 6. Custo total estimado

| | Por apresentação (1 h) | 100 apresentações/mês |
|---|---|---|
| Caminho A (só a IA, Opus 5.5) | ≈ US$ 0,10 | ≈ US$ 10 |
| Caminho B (transcrição + IA) | ≈ US$ 0,30–0,50 | ≈ US$ 30–50 |
| Google Workspace Business Standard | já pago pela rede (conferir) | — |

Em reais, a R$ 5,50 por dólar: **R$ 0,55** (A) ou **R$ 2–3** (B) por
apresentação. Não há mensalidade: a API cobra pelo uso. O painel da Anthropic
permite **teto de gasto mensal** — o dono define (sugestão: US$ 50).

---

## 7. As fases

*Decisão D1: os dois caminhos saem juntos. Mantidos aqui como dois blocos
porque o código é o mesmo em etapas — IA1 é a base, IA2 se encaixa nela — e
porque a IA2 depende de um segundo contrato (D6) que pode atrasar sem travar
a IA1. Se os dois contratos estiverem prontos, saem na mesma versão.*

### IA1 — o rascunho a partir da transcrição colada (uma sessão, migração 0349)

- **Banco (0349):** colunas em `commercial_presentations`: `transcript text`,
  `transcript_source` (`meet` | `gravacao` | `arquivo`), `transcript_at`,
  `ai_draft text`, `ai_draft_at`, `ai_model text`, `summary_source`
  (`manual` | `ia_revisado`). Sem tabela nova (uma apresentação por cliente,
  `unique (client_id)`). Gatilho da auditoria já cobre a tabela.
- **Servidor:** `src/lib/ia/resumo-da-apresentacao.ts` — regra pura que monta
  o pedido à IA (estrutura da §4) e **limpa** a resposta (sem markdown, teto
  de caracteres); `src/lib/ia/modelo.ts` — **uma porta só para a IA do
  resumo** (entra o pedido, sai o texto), com um arquivo por fornecedor atrás
  dela (`anthropic.ts`, e `gemini.ts` se o D5 escolher o Google): trocar de IA
  é trocar uma variável, não reescrever a tela. Com a Anthropic:
  `@anthropic-ai/sdk`, modelo `claude-opus-5-5`, texto fixo do pedido com
  *prompt caching*, `max_tokens` 2.000, sem streaming — resposta curta;
  action `gerarRascunhoDoResumo(clientId)` em `comercial/[clientId]/actions.ts`
  com a guarda de quem negocia, `logAudit` (ids e modelo, nunca o texto),
  `revalidatePath`. `maxDuration` da action: 60 s.
- **Variável na Vercel:** `ANTHROPIC_API_KEY` (Secret), nos dois projetos
  (treino pode usar a mesma chave; o gasto do treino conta — ou só na
  produção, e o treino mostra "IA não configurada"). Documentar em
  `docs/PRODUCAO-ONLINE.md`.
- **Tela:** o bloco da §4 em `presentation-workspace.tsx`.
- **Réguas (teste):** (1) o rascunho **nunca** grava `summary` — só a action
  de salvar de sempre; (2) o pedido à IA leva a instrução "não inventar" e a
  estrutura fixa; (3) a resposta é cortada no teto; (4) sem chave, a action
  responde `configured: false` e não chama nada; (5) `logAudit` da geração
  não contém o texto (régua lê o arquivo). O cliente da Anthropic é
  **simulado** no teste — nenhum teste gasta crédito.
- **Manual §6.5** (Tarefa 2 do Consultor: "cole a transcrição, gere o
  rascunho, leia e corrija"), changelog, EV, ESTADO, BACKLOG.
- **Não visto na tela sem a chave:** a geração real. Com a chave do dono no
  treino, uma apresentação de teste (cliente fictício, transcrição inventada).

### IA2 — a gravação pelo sistema e a transcrição automática (junto com a IA1, decisão D1)

- A barra grava ao **iniciar a apresentação** pelo funil (tipo de atendimento
  `commercial_presentation`), **só com consentimento registrado** (a dispensa
  continua estreita — régua de `gravacao.test.ts`).
- Ao concluir, uma rotina lê o áudio do bucket (chave de serviço, URL
  assinada curta) e chama o serviço de transcrição escolhido (D4) por um
  módulo **isolado e trocável** (`src/lib/ia/transcricao.ts`, uma função por
  fornecedor, mesma saída). Áudio acima do limite do fornecedor é partido.
  Rota com `maxDuration = 300`. O texto cai em `transcript` com origem
  `gravacao`; dali, o mesmo botão da IA1.
- Segunda variável na Vercel (a chave do serviço de transcrição) e segundo
  DPA.
- Fica de fora por decisão: baixar a gravação do Meet pelo Drive (exigiria
  login Google de cada Consultor no sistema — obra grande para um ganho que
  o caminho A já dá).

---

## 8. Decisões do dono

| # | Pergunta | Recomendação | **Decisão (03/11/2026)** |
|---|---|---|---|
| **D1** | Por onde entra o texto na primeira fase? | Caminho A (transcrição do Meet colada); B depois. | **Os dois na mesma entrega** (A para a online, B para a presencial). O dono pediu aprofundar custo × benefício das IAs antes de escolher a do resumo → D5. |
| **D2** | O que o rascunho contém? | Estrutura fixa em 4 partes, sem inventar. | **Estrutura fixa + o que o cliente recusou** (5 partes, §4). |
| **D3** | Quando a IA pode ser ligada? | Só depois do DPA (retenção zero) e do termo de consentimento ajustado. | **Como recomendado.** Até lá a tela diz "IA não configurada". |
| **D4** | Guardar a transcrição inteira no sistema? | Sim, na apresentação, com a regra de leitura dela. | **Como recomendado.** |
| **D5** | **Qual IA escreve o resumo?** | §9: Claude Opus 5.5 pela API da Anthropic; alternativa Gemini 3 Pro no Vertex AI de São Paulo se o jurídico exigir dado no Brasil. | **Aberta.** |
| **D6** | **Qual serviço transcreve o áudio (caminho B)?** | §10: Deepgram Nova-3; alternativa Google Speech-to-Text se exigir dado no Brasil. | **Aberta.** |

Depois de D5 e D6, a entrega segue o fluxo de sempre: migração 0349
conferida e ensaiada no treino, réguas, tela no treino com conta de teste,
manual e Word, changelog e versão, commit; as chaves são cadastradas pelo
dono na Vercel quando o D3 estiver cumprido para cada fornecedor.

---

## 9. Comparativo — qual IA escreve o resumo (D5)

*Preços de tabela em dólar, lidos em 03/11/2026 em páginas de terceiros e na
documentação da Anthropic; **conferir na página oficial de cada um antes de
contratar**. Conta feita para uma apresentação de 1 h: ≈ 25 mil tokens lidos
(a transcrição) e ≈ 1 mil escritos (o rascunho).*

| IA | Preço (por milhão de tokens lidos / escritos) | **Por apresentação** | 100/mês | Onde o dado é processado | Retenção / contrato | Observações |
|---|---|---|---|---|---|---|
| **Claude Opus 5.5** (Anthropic) | US$ 4 / US$ 20 | **≈ US$ 0,12** | ≈ US$ 12 | EUA | DPA incluído nos termos comerciais; **retenção zero sob pedido** ao representante; não treina com o conteúdo da API | Modelo mais capaz da linha Opus; o padrão deste plano. Uma chave só, SDK pronto. |
| Claude Sonnet 5.5 (Anthropic) | US$ 2 / US$ 10 | ≈ US$ 0,06 | ≈ US$ 6 | EUA | Idem | Mesma conta e mesmo contrato do Opus; trocar é mudar o nome do modelo. Suficiente para resumir; perde um pouco de cuidado no "não" do cliente. |
| Claude Haiku 5.5 (Anthropic) | US$ 0,10 / US$ 0,50 | ≈ US$ 0,003 | ≈ US$ 0,30 | EUA | Idem | O mais barato; para um texto que vai no contrato, o ganho de US$ 11/mês não paga o risco de um resumo pior. |
| GPT-5.5 (OpenAI) | US$ 5 / US$ 30 | ≈ US$ 0,16 | ≈ US$ 16 | EUA (residência de dados só na Europa e na Ásia; **Brasil não listado**) | Retenção zero **só com aprovação** da OpenAI, critérios não publicados | O mais caro da tabela; nenhum ganho para este uso. |
| GPT-5 mini (OpenAI) | US$ 0,25 / US$ 2 (listagem incerta — pode ter saído da tabela oficial) | ≈ US$ 0,01 | ≈ US$ 1 | EUA | Idem | Barato, mas a disponibilidade do modelo não está clara em 2026. |
| **Gemini 3 Pro** (Google, Vertex AI) | US$ 2 / US$ 12 | **≈ US$ 0,06** | ≈ US$ 6 | **Pode rodar em São Paulo** (`southamerica-east1`): o Google garante o dado **guardado** na região; o processamento na região vale só com o endereço regional (não o "global") — **confirmar para o Gemini 3 Pro** | Termos do Google Cloud (a Risarte já é cliente Google pelo Workspace) | O único que pode manter o dado **no Brasil**. Exige conta no Google Cloud, cobrança separada do Workspace. |
| Gemini 3 Flash (Google) | US$ 0,50 / US$ 3 | ≈ US$ 0,02 | ≈ US$ 2 | Idem | Idem | Mais barato que o Pro; qualidade abaixo para texto que vai no contrato. |

**Leitura da tabela.** Para este uso — resumir 1 h de conversa em cinco
partes, sem inventar — todos os modelos de primeira linha (Opus 5.5, GPT-5.5,
Gemini 3 Pro) dão conta; a diferença de custo entre eles é de **centavos por
apresentação** e de **dezenas de dólares por mês** na rede inteira. O que de
fato separa as opções é **onde o dado de saúde é processado** e **que
contrato cobre isso**:

- **Anthropic (Claude):** processamento nos EUA, com DPA e retenção zero —
  o mesmo arranjo que a maioria das empresas brasileiras aceita para
  operador fora do país (LGPD art. 33, cláusulas contratuais). É o caminho
  mais simples: uma chave, um SDK, um contrato.
- **Google (Gemini no Vertex AI):** a única opção com região em **São Paulo**.
  Se o jurídico do dono exigir que o dado de saúde **não saia do Brasil**, é
  esta. Custa uma conta no Google Cloud e a conferência de que o Gemini 3 Pro
  está na região de São Paulo com processamento regional (a documentação
  lista o 2.5 Pro/Flash lá; o 3 Pro aparece numa versão da página e não em
  outra).
- **OpenAI:** não tem residência no Brasil, a retenção zero depende de
  aprovação, e é a mais cara. Fica de fora.

**Recomendação (D5):** **Claude Opus 5.5** pela API da Anthropic, com DPA e
retenção zero, como padrão; **Gemini 3 Pro no Vertex AI de São Paulo** se o
jurídico exigir dado no Brasil. Nos dois casos o módulo nasce com a porta
única (`src/lib/ia/modelo.ts`): a troca depois custa um arquivo e uma
variável, não a tela.

---

## 10. Comparativo — qual serviço transcreve o áudio (D6, caminho B)

*Preço por **hora de áudio**, dólar, mesma ressalva da §9. O arquivo do nosso
gravador (webm/opus) tem ≈ 15 MB por hora.*

| Serviço | Preço / h | Por apresentação (1 h) | Português | Retenção do áudio | Região | Observações |
|---|---|---|---|---|---|---|
| **Deepgram Nova-3** | ≈ US$ 0,31 (multilíngue) | ≈ US$ 0,31 | Sim (pt-BR) | Diz **não guardar** áudio nem transcrição por padrão (fonte de terceiro — **confirmar no contrato**) | EUA | Preço e simplicidade; separar quem fala custa +US$ 0,12/h. |
| OpenAI `gpt-4o-transcribe` | ≈ US$ 0,36 (`mini`: ≈ US$ 0,18) | ≈ US$ 0,36 | Sim | Padrão 30 dias; retenção zero só com aprovação | EUA | Arquivo de **até 25 MB por chamada**: 2 h de gravação precisam ser partidas. |
| AssemblyAI | ≈ US$ 0,15–0,21 | ≈ US$ 0,20 | Sim | Áudio apagado em 2 dias; transcrição apagada **se pedirmos** depois de ler (não há retenção zero formal) | EUA | O mais barato; a retenção exige um passo a mais do nosso lado (o sistema pede para apagar). |
| Google Speech-to-Text (Chirp 3) | ≈ US$ 0,96 (lote de 24 h: ≈ US$ 0,24) | ≈ US$ 0,96 | Sim | Termos do Google Cloud | **Possível em São Paulo — não confirmado** para o Chirp 3 | O caminho se o jurídico exigir dado no Brasil (e combina com o Gemini na mesma conta Google Cloud). |

**Recomendação (D6):** **Deepgram Nova-3** (barato, pt-BR, sem guardar áudio
— confirmando isso no contrato); **Google Speech-to-Text** se a regra for
"dado no Brasil" (aí Gemini + Speech-to-Text ficam na mesma conta Google
Cloud, um contrato só). A porta `src/lib/ia/transcricao.ts` nasce trocável do
mesmo jeito.

**Custo total do caminho B por apresentação de 1 h:** transcrição US$ 0,20–0,36
+ resumo US$ 0,06–0,12 ≈ **US$ 0,30–0,50** (≈ R$ 2–3). Na rede, 100
apresentações por mês ≈ US$ 30–50.
