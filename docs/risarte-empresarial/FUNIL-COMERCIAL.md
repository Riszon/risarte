# Funil comercial do Risarte Empresarial

Especificação dada pelo dono em **14/09/2026** e o estado da construção. Ler
antes de mexer em `/empresarial/funil`.

O funil tem **8 fases**. A numeração não é enfeite: é sequência, e o consultor
precisa poder dizer "está na 4" sem abrir a tela.

| # | Fase | O que significa |
|---|---|---|
| 1 | **Captação** | Lista de potenciais clientes que podemos abordar |
| 2 | **Contato** | Tentando falar com a empresa; ainda sem reunião marcada |
| 3 | **Reunião agendada** | Conseguiu marcar a apresentação |
| 4 | **Apresentado** | Já apresentou; agora levanta dados para a proposta |
| 5 | **Proposta enviada** | Proposta e contrato foram para a empresa |
| 6 | **Follow-up** | Negociação e fechamento |
| 7 | **Fechamento** | Encerrado: **ganho** ou **perda** (motivo obrigatório) |
| 8 | **Implantação** | Cadastro dos titulares, boas-vindas, 1ºs agendamentos |

## Decisões do dono (14/09/2026)

1. **Fechamento é UMA coluna**, com ganho/perda marcado no cartão, mais um
   filtro de **Todos / Ganhos / Perdas**. Não são duas colunas.
2. **Agenda própria do programa + botão "adicionar à minha agenda"** (arquivo
   `.ics`, entra no Google/Outlook/celular). A sincronização de mão dupla com o
   Google Agenda fica para depois — exige credencial da conta Google da empresa.
3. **Apresentação padrão dentro do sistema**, editável por empresa, baixada em
   PDF pela impressão. Sem Gamma, sem serviço externo.

## Limites declarados (não são esquecimento)

- **O sistema não envia e-mail.** Nunca enviou. Quem manda e-mail é o ZapSign
  (contrato para assinar). "Enviar a proposta" = o sistema monta o pacote,
  **registra o que foi enviado** e entrega a mensagem pronta para o consultor
  disparar (WhatsApp por `wa.me`, e-mail pelo programa dele). É a decisão de
  projeto de sempre: WhatsApp começa manual.
- **PDF aqui é impressão** (Ctrl+P → Salvar como PDF), como nas outras telas.
- **O relógio do funil começou em 14/09/2026.** Antes da migração 1007 ninguém
  gravava quando a empresa entrou em cada fase. Os leads anteriores entraram com
  uma linha marcada `is_initial`, e a tela diz **"sem histórico anterior"** em
  vez de mostrar um tempo que ninguém mediu.

## Blocos de construção

### Bloco A — o funil de verdade ✅ (migração 1007, v0.45.0)

- As 8 fases; **Implantação** criada; Fechamento virou uma coluna com o
  resultado no cartão e o filtro Todos/Ganhos/Perdas.
- **O relógio** (`empresarial.commercial_lead_stage_history`): toda troca de
  fase grava **por gatilho** quem moveu, para onde e quando. Não depende de a
  tela lembrar — é assim que esse tipo de histórico envelhece.
  - Índice único garante **uma fase aberta por lead**: sem ele, um gatilho que
    falhasse pela metade faria o tempo ser contado em dobro.
  - Salvar o lead sem trocar de fase **não reinicia** o relógio.
  - O histórico é **só leitura** pela API: quem edita a prova não tem prova.
- **Fase de entrada no cadastro** (padrão Captação). Fechamento e Implantação
  ficam fora da lista — fechar cria a empresa e tem caminho próprio.
- **Canal da captação** (lista fechada) + **quem indicou** e o contato dele.
- **Motivo da perda virou obrigatório** (ordem do dono).
- Correções achadas no caminho: o campo de próxima ação empurrava o compromisso
  **+3h a cada edição** (`toISOString` mostrando UTC — ver `brazilInputValue`);
  a linha do tempo escrevia "Movido para PROPOSAL_SENT" em inglês; e lead ganho
  sem empresa virava **cartão morto**, sem nenhum botão.

### Bloco B — os registros de cada fase ✅ (migração 1008, v0.46.0)

- **Tentativas de contato** (`lead_contact_attempts`), no cartão da empresa:
  canal (ligação, WhatsApp, e-mail, presencial) e resultado, os dois em **lista
  fechada**. É isto que permite contar depois quantas ligações foram precisas
  até marcar a reunião — número que anotação livre nunca daria. A linha do
  tempo continua existindo, para o que é texto.
- **Agenda do programa** (`/empresarial/agenda`), com as 6 situações do
  comercial. Três listas, e **a do meio é a que importa**: reunião cuja hora já
  passou e ninguém disse o que houve — é ela que trava o funil em silêncio.
- **O cartão anda sozinho, e quem manda é o BANCO** (gatilho, não tela):
  marcar a reunião leva para *Reunião agendada*; dar por **realizada** leva
  para *Apresentado*. **Nunca para trás** — registrar hoje uma reunião antiga
  de quem já está em Follow-up não desfaz o avanço.
- **Remarcar cria uma reunião NOVA apontando para a anterior.** Duas linhas, não
  uma com a data trocada: é a corrente que revela a empresa que já adiou três
  vezes, e sobrescrever apagaria justamente esse sinal. O cartão mostra
  "remarcada 3×".
- **Cancelar, remarcar e faltar exigem motivo escrito.**
- **"Adicionar à minha agenda"** baixa o arquivo `.ics` (rota
  `/empresarial/agenda/[id]/ics`), que Google Agenda, Outlook e o celular
  abrem. **Tudo em UTC** — é o que faz o compromisso cair na hora certa.

### Bloco C — do Apresentado à Implantação

Grande demais para uma entrega só; sai em **três partes**, cada uma testável.

#### C1 — levantamento e proposta ✅ (migração 1009, v0.47.0)

Tela nova: **`/empresarial/funil/[leadId]`**, aberta pelo nome da empresa no
cartão. Três blocos e um simulador que recalcula enquanto o consultor digita.

- **O que a empresa tem hoje:** convênio e quanto paga, outros benefícios,
  ações e projetos sociais (o diferencial frente a um convênio comum).
- **Leitura do consultor:** nível de interesse e chance de fechar (0–100),
  declarados como percepção, não medição.
- **Como a proposta será montada:** quem paga (integral, parcial em % ou em R$
  por titular, ou o titular), quantos titulares, dependentes nesta
  fase, um CNPJ ou conjunto, e **por titular ou valor fixo por empresa** —
  a regra alternativa para sindicato e associação.
- **Dados de proposta e contrato**, que **viajam para o cadastro da empresa no
  fechamento** (`camposDaEmpresa`, pura e testada). Sem isso o consultor
  digitaria tudo duas vezes, e é na segunda que os dados divergem.

**Três decisões que valem lembrar:**

1. **Caixa de TRÊS estados** (sim / não / não perguntei). "Não investiguei" e
   "não tem convênio" são coisas diferentes; tratá-las como iguais faria o
   painel contar como respondida toda ficha em branco.
2. **Sem saber o que a empresa paga hoje, a economia é NULA, nunca R$ 0,00** —
   e **economia negativa aparece**: esconder faria a proposta só provar o que
   ela quer provar. Sem titular, o valor por cabeça também é nulo (dividir
   por zero não tem resposta).
3. **A tela LISTA o que falta** para a proposta e para o contrato, em vez de só
   bloquear: o consultor precisa saber o que perguntar na próxima conversa.

**Ficha em branco não impede o fechamento** — o levantamento é ajuda, não
pedágio.

#### C2 — apresentação, envio e follow-up ✅ (migração 1010, v0.48.0)

- **Apresentação padrão, personalizável** (`presentation_templates`), na
  **cascata** do projeto: a linha sem lead é o padrão da REDE, a linha com lead
  sobrescreve. Mexer no padrão melhora a apresentação de todos que ainda não
  personalizaram; quem personalizou fica com a sua. Conteúdo em blocos (JSONB),
  não colunas fixas — a apresentação de um sindicato tem blocos diferentes da
  de uma metalúrgica. Sai em PDF pela impressão, e os botões somem no papel.
  **Mexer no padrão da rede é ato de gestor do programa**, não de qualquer
  consultor (a RLS separa os dois casos).
- **Registro do envio** (`lead_dispatches`) — o que foi, por onde e quando,
  mais a **mensagem pronta** e o link do WhatsApp já montado. A tela **declara
  que o sistema não envia**: quem envia é a pessoa.
  **Só o envio que inclui a PROPOSTA move o cartão** para Follow-up; mandar só
  a apresentação é conversa, não negociação.
- **Os dois selos** (`contract_signed_at`, `implantation_paid_at`). Os dois
  verdes → Fechamento (ganho), por gatilho. **Um selo sozinho não fecha nada**:
  contrato sem pagamento é promessa, pagamento sem contrato é dinheiro sem
  amarração. A empresa **não** é criada aí — exige CNPJ válido e é ato do
  consultor, pelo botão no cartão.

**⚠️ O defeito que apareceu aqui, e a lição:** o gatilho do relógio (1007)
nasceu como `after update OF stage`, e **`UPDATE OF <coluna>` dispara pelas
colunas que o COMANDO nomeia, não pelo que um gatilho BEFORE mudou depois**.
Quando os selos passaram a fechar o lead, a fase virava `CLOSED_WON` e o
relógio **não via**: o histórico ficava aberto em Follow-up para sempre, e o
tempo do fechamento seria contado como tempo de negociação — errado e
silencioso. Achado ao **perguntar ao banco** se a passagem tinha sido gravada;
no arquivo, os dois gatilhos pareciam conversar. A 1010 tira o `OF stage` (a
guarda `is distinct from` dentro da função é quem evita linha repetida, e ela
nunca dependeu da cláusula), e há teste que reprova a volta.

#### C3 — fechamento e implantação ✅ (migração 1011, v0.49.0)

- **A conferência do consultor** (`lead_closing_reviews`), que só aparece a
  partir do Fechamento: está tudo certo? há consideração? houve **combinado
  específico**? Confirmado com tudo certo → **vai sozinho para Implantação**.
  Confirmar com pendência **não** move, e exige escrever o que não está certo —
  registro que só diz "tem problema" não serve para ninguém resolver nada.
- **⚠️ O COMBINADO VIAJA PARA A EMPRESA, POR GATILHO**, e aparece em destaque no
  cadastro dela ("Combinado na venda — não esquecer"). *"Os dependentes entram
  só no segundo mês"* é exatamente o acerto que se perde: quem vende não é quem
  atende, e o consultor sai de férias. A cópia acontece **antes** de mover a
  fase, e **mesmo quando há pendência** — é o que não pode se perder. Limpar o
  campo depois **não apaga** o que já foi gravado na empresa.
- **Sem empresa criada não dá para confirmar**: implantação é cadastrar os
  titulares nela.
- **Os cinco passos da implantação** (`lead_implementation_steps`): cadastrar
  os titulares, enviar as orientações, dar as boas-vindas, a apresentação
  para todos e o primeiro agendamento pelo SDR. Linha **esparsa** — "não feito"
  é a ausência de registro. Só a **apresentação coletiva** pode ser marcada
  como *não se aplica*, e ela **sai dos dois lados da conta**: se ficasse no
  denominador, quem não pediu nunca chegaria a 100%, e barra que nunca fecha é
  barra que ninguém olha.

**O upload da lista de titulares NÃO foi construído aqui — ele já existia.**
A tela da empresa importa Excel com planilha-modelo e aba de dependentes, e cria
o pré-cadastro (nome, CPF, telefone, e-mail) que a fase pede. O que faltava era
**o caminho do funil até ele** e o registro de que foi feito. Um segundo
importador criaria duas portas para a mesma coisa — e é assim que as duas passam
a divergir.

**Régua errada, de novo:** a conferência da tela procurou "0 de 5 passos" e
acusou a tela. O React **parte o texto** com `<!-- -->` entre expressões, então
a frase inteira não existe no HTML cru — é a mesma armadilha do `qual:versao`.
Quem estava errado era o instrumento. Régua que procura texto renderizado tem de
tirar essas marcas antes de comparar.

### Bloco D — painel e alertas ✅ (migração 1012, v0.50.0)

**O painel** (`/empresarial/funil/painel`), com quatro perguntas e uma
disciplina em todas: **régua vazia grita**.

- **Conversão fase a fase** conta quem **já passou** por cada fase (lendo o
  relógio), não quem está nela agora. Fase sem ninguém antes devolve **nulo**,
  não 0% — "0%" seria afirmar sobre uma etapa que ninguém percorreu. E as
  empresas que já existiam quando o relógio ligou **ficam de fora da conta**,
  com o número delas escrito na tela: contá-las como "não passaram" faria a
  conversão parecer pior do que é.
- **Tempo médio por fase** conta só as passagens que **terminaram**. Incluir a
  aberta puxaria a média para baixo e faria a fase parecer mais rápida
  justamente onde há empresa empacada — o oposto do que o painel existe para
  mostrar. Sem passagem concluída, a resposta é "sem passagem concluída".
- **Quem está parado**, pior primeiro.
- **Por consultor e por canal.** Sem nenhum fechamento, a taxa de ganho é
  **nula**: "0%" diria que o consultor perdeu tudo quando ele ainda não fechou
  nada. *"Sem consultor"* é um recorte de verdade — é a fila que ninguém assumiu.

**Os alertas** (`funnel_alerts`), apurados às 9h por `pg_cron` e com botão de
apurar na hora.

- **O limite é POR FASE** (`funnel_stage_limits`), ajustável pelo gestor do
  programa no próprio painel. Três dias tentando contato é normal; três dias com
  a proposta na mesa sem retorno já não é. Um limite único gritaria na fase
  errada — e alerta que grita no lugar errado é o primeiro que a equipe aprende
  a ignorar. **Fase sem limite cadastrado não vira alerta**: é ausência de
  configuração, não empresa saudável.
- **Inatividade** olha o último movimento de QUALQUER tipo — anotação, tentativa
  de contato, envio, reunião. Olhar só a linha do tempo cobraria justamente quem
  está trabalhando.
- **Alerta que repete todo dia é alerta que ninguém lê**: o aviso sai **uma
  vez** e só rearma quando a condição some e volta (mesma disciplina do FIN7.3).
  Provado: apurar três vezes seguidas manda um aviso só.
- **Roda sem usuário** — a conta fica na função `_raw` (revogada do público) e a
  porta pública leva a guarda de gestor do programa.
- **Lead sem consultor gera alerta mas não avisa ninguém** — não há a quem
  avisar; ele aparece no painel, que é onde o gestor cobra a atribuição.

**Uma armadilha evitada a tempo:** a apuração ia usar uma tabela temporária, e
dentro de função com `search_path = ''` ela não resolve — o erro só apareceria
na primeira execução do cron, de madrugada, sem ninguém olhando. Virou uma
**visão** (`funnel_lead_state`), não exposta a `authenticated` porque
atravessaria a RLS dos leads.


### Bloco E — a ficha da empresa em ABAS ✅ (sem migração, v0.52.0)

Relato **OC-00083** (Admin Master, 23/09/2026): *"está tudo muito confuso,
sensação de estar incompleto, bagunçado e desorganizado... deve seguir um
fluxo lógico de acordo [com onde] a empresa se encontra no funil"*.

**O defeito existia, e não era regra mal entendida.** A ficha empilhava os
QUATRO blocos numa rolagem só — levantamento, apresentação, envio, fechamento —
**sem olhar a fase da empresa**. O `stage` era lido do banco, atravessava a
página inteira e só era usado dentro do último bloco. Uma empresa em *Captação*
via exatamente a mesma tela de uma em *Implantação*.

**O que mudou**

- **Quatro abas**: Levantamento · Apresentação · Envio e selos · Fechamento.
- **A ficha abre na etapa da empresa** (`etapaInicial`, puro e com teste), e a
  aba correspondente leva o selo **"agora"** mesmo quando se está olhando
  outra — senão se perde a referência de onde o trabalho parou.
- **Cada aba diz de si mesma** em uma linha: *falta 2 campos*, *modelo da
  rede*, *proposta enviada*, *implantação 3/7*. É daí que saía a "sensação de
  incompleto": nada dizia o que faltava.
- **O chapéu passou a mostrar a fase de verdade**, das nove. Estava escrito
  `"fase 4"` na mão — e, pior, **não aparecia**: `CabecalhoDeModulo` mostrava
  o chapéu OU o link de voltar, nunca os dois. Corrigido no núcleo, em commit
  próprio; consertou 13 telas de uma vez.

**Decisões que valem registrar**

- **Nenhuma aba é trancada.** A tentação era travar o envio com a proposta
  incompleta; seria um jeito novo de a pessoa ficar presa, e a mesma aba guarda
  os selos de contrato assinado e implantação paga, que precisam ser marcados
  mesmo em caso fora do roteiro. O sistema **diz** onde está o buraco; quem
  decide a ordem é quem atende.
- **Todas as abas ficam montadas**, e a inativa é escondida. São quatro
  formulários com quatro botões de salvar: desmontar ao trocar de aba apagaria
  o que a pessoa acabou de digitar, e ela só descobriria ao voltar.
- **O "o que falta" reusa a régua que já existe** (`faltaParaProposta` /
  `faltaParaContrato`, da 1009). Uma segunda contagem aqui garantiria que um
  dia as duas discordassem, e a aba diria "pronto" numa tela que recusa salvar.
- **Sem levantamento nenhum, a aba diz "falta o levantamento"** — a linha vazia
  vem com os preços padrão da rede preenchidos, e contar só os campos faria
  ela parecer completa.
- **Empresa perdida abre no Fechamento**, onde está o desfecho: no levantamento
  ela pareceria ter campo a preencher.

**Conferido nas telas de verdade**, no treino, com as **7 empresas** do funil
(Captação, Apresentado ×2, Proposta enviada, Fechamento ganho, Implantação ×2):
o chapéu trouxe a fase certa em todas, e todas abriram na aba esperada.

⚠️ **A régua da conferência mentiu antes de o código estar errado:** a primeira
versão dela procurava o botão da aba numa janela de 700 caracteres, e o botão
tem ~1.100 — resultado, *"nenhuma aba encontrada"* nas 7 fichas, com o código
certo. Régua que não acha nada tem de gritar, nunca responder "não".

**Próximo:** a proposta como documento (Bloco F) e o contrato gerado aqui,
indo ao ZapSign só para assinar (Bloco G) — nesta ordem, combinado com o dono.

### Bloco F — a proposta como DOCUMENTO ✅ (sem migração, v0.53.0)

Segunda metade do **OC-00083**: *"toda a apresentação, proposta, contratos
devem ser elaborados dentro do próprio sistema"*. A apresentação já era; a
proposta **não existia como documento** — o sistema calculava os números na
tela e o consultor montava a proposta por fora, cada um do seu jeito, com os
valores redigitados à mão. **Redigitar valor é como a proposta passa a
divergir do que o sistema cobra depois**, e ninguém descobre até a primeira
fatura.

Agora há `/empresarial/funil/<lead>/proposta`: página pronta para imprimir ou
salvar em PDF, no mesmo molde da apresentação, aberta pelo botão **Ver a
proposta** ao lado da simulação.

**Decisões que valem registrar**

- **O documento não guarda nada.** É desenhado a partir do levantamento salvo,
  toda vez. Congelar uma cópia exigiria decidir quando ela envelhece, e
  proposta velha impressa com cara de atual é pior que nenhuma. **Quem congela
  valor é o contrato** (Bloco G).
- **O botão fica ao lado dos números, não em aba própria.** A simulação
  acompanha o que está sendo DIGITADO; o documento usa o que foi SALVO. Dois
  lugares mostrando os mesmos números discordariam a cada tecla, e ninguém
  saberia em qual acreditar. A tela declara isso ("abre com os dados salvos").
- **Nada de nota interna entra no documento**: interesse, chance de fechar e as
  observações do consultor ficam na ficha. É o que se pensa da empresa, não o
  que foi combinado com ela — e o documento vai para a mão dela.
- **Sem dados, a página RECUSA e diz o que falta**, em vez de imprimir
  "R$ 0,00" com cara de proposta. Alguém mandaria isso para a empresa.
- **A comparação com o convênio atual aparece mesmo quando é ruim.** Custando
  mais, o documento diz que custa mais e qual é o argumento (cobertura e
  atendimento). Esconder faria a proposta provar só o que ela quer provar — e o
  consultor seria desmentido pela primeira planilha que a empresa abrisse.
- **Subsídio em reais não vira percentual.** Valor por titular não é fatia
  fixa da mensalidade; escrever "%" ali seria afirmar o que a conta não
  sustenta.
- **Validade: 15 dias**, numa constante só (`VALIDADE_PADRAO_DIAS`), porque é
  número de negócio — quando virar configuração da rede no Bloco G, que já leva
  migração, é ela que some, não quinze pedaços de texto.

**Conferido nas telas de verdade**, no treino, nas 7 empresas: **3 propostas
geradas** (com os quatro números, a validade e sem nenhuma nota interna) e **4
recusadas dizendo o que falta**.

⚠️ **E a conferência da proposta achou um defeito do Bloco E.** A Amazon não
tem levantamento nenhum, e a aba dizia **"falta 1 campo"** — porque eu mandava
um campo de mentira (`["o levantamento"]`) na lista do que falta, e a contagem
o contava. **Contagem responde "quantos"; ela não sabe dizer "nenhum".** Agora
`temLevantamento` é pergunta separada e a aba diz **"não começou"**. Quatro das
sete empresas mostravam o rótulo errado.

### Bloco G — a PROPOSTA como etapa própria ✅ (migração 1014, v0.54.0)

Segundo retorno do dono no **OC-00083**: *"deve ter uma aba específica para se
tratar da proposta (configuração, personalização, detalhamento, carência,
prazo da proposta e etc)... agora a proposta está misturada com o levantamento
e ainda fica confuso"*.

Ele está certo, e a razão não é de tela: **levantar e oferecer são dois atos
diferentes**. No levantamento se registra o que a empresa tem e o que ela
disse; na proposta se DECIDE o que oferecer. Estavam no mesmo formulário, com
um botão de salvar só — quem ia ajustar um valor relia a entrevista inteira
pelo caminho.

**A ficha passou a ter cinco abas:** Levantamento · **Proposta** ·
Apresentação · Envio e selos · Fechamento.

**O que a aba Proposta tem**

- Como a proposta será montada (quem paga, subsídio, titulares,
  dependentes, base e valores) e a simulação ao vivo.
- **Prazo e carência** (colunas novas da 1014): validade da proposta em dias,
  carência da empresa e carência padrão do titular.
- Os **dados para gerar a proposta e o contrato** — razão social, quem assina,
  CPF, e-mail. Vieram do levantamento de propósito: são o que o documento
  precisa para existir, não o que se descobre numa entrevista.
- **Detalhamento**: blocos de texto com modelo da rede, ajustáveis por empresa
  (mesma cascata da apresentação).
- **O levantamento em pop-up**, só leitura. Configurar a oferta sem o que a
  empresa disse é configurar no escuro, e mandar trocar de aba para consultar
  seria o mesmo problema de antes com outra roupa.

**Decisões que valem registrar**

- **Duas abas, duas gravações, uma linha no banco.** Cada uma escreve APENAS as
  suas colunas de `lead_qualification` (update parcial). Um upsert com o objeto
  inteiro apagaria, a cada salvar, o que a outra aba tinha preenchido — e o
  defeito seria silencioso até alguém voltar na outra aba.
- **A CARÊNCIA NEGOCIADA VIAJA para o cadastro da empresa** (`camposDaEmpresa`,
  puro e com teste). Antes ela só nascia no cadastro, com o padrão 0: o que
  tinha sido combinado na proposta era redigitado depois e podia sair diferente
  do que foi VENDIDO. **Nulo = não foi negociado** e vale o padrão de sempre;
  zero é uma decisão e não se confunde com ausência.
- **O prazo é campo da proposta com padrão da rede** (`proposal_templates` da
  linha nula, editável em Configurações → Proposta comercial). Provado no
  treino: rede 15 → documento 15 dias; rede 20 → 20; prazo próprio 7 → **7**,
  ganhando da rede.
- **O texto não repete número.** Valores, quem paga e carência são impressos
  pelo documento a partir do que foi negociado; escrevê-los no texto criaria
  uma segunda verdade que envelhece sozinha. A tela diz isso nos dois lugares.
- **O levantamento deixou de ser medido pelos campos da proposta.** Eles mudaram
  de aba; contá-los ali faria a aba da entrevista cobrar valores que não moram
  mais nela. Agora ela mede o que é dela: existe? trouxe o valor do convênio
  atual, que é o único dado do levantamento que muda o documento?
- **A JANELA ENTRE O DEPLOY E A MIGRAÇÃO É TRATADA** (§0b): sem a 1014, a aba
  abre com o padrão, avisa em faixa amarela e esconde o editor de texto, em vez
  de derrubar a ficha inteira. Código viaja sozinho; migração, não.

**Conferido nas telas do treino**, nas 7 empresas: cinco abas em todas, cada
uma abrindo na etapa certa, 4 propostas geradas e 3 recusadas com o motivo.

⚠️ **E a régua gritou de novo — desta vez certo.** A conferência do prazo
respondeu *"NÃO ACHEI"* nas quatro medições: ao tirar as etiquetas do HTML, o
texto vira `válida até 08/10/2026 ( 15 dias)`, com um espaço que o padrão de
busca não previa. Ela levantou erro em vez de dizer "não mudou" — que teria
escondido justamente o que se queria provar.

### Bloco H1 — TITULAR no lugar de COLABORADOR ✅ (sem migração, v0.55.0)

Pedido do dono (OC-00083, 23/09/2026): *"substituir a nomenclatura Colaborador
por Titular em todo o empresarial. Pois tem empresas que estão possibilitando
um benefício para um parceiro PJ e não um colaborador; em uma Associação pode
estar oferecendo o benefício para um associado."*

**166 trocas em 39 arquivos de código**, mais 18 nos testes e 54 nos documentos
deste diretório. *Titular* serve aos três casos e faz par natural com
*dependente*, que é a outra metade do cadastro.

**O que NÃO mudou, de propósito:**

- **A tabela continua `employees`** e as colunas continuam em inglês — é a
  convenção do repositório (identificador em inglês, tela em pt-BR). Renomear
  tabela exigiria migração e quebraria tudo que já aponta para ela, em troca de
  zero para quem opera.
- **A chave da aba (`?aba=colaboradores`)**, que viaja na barra de endereço:
  trocá-la quebraria link salvo sem ninguém ganhar nada. O rótulo mudou; a
  chave não.
- **Palavra colada em outra** (`porColaboradorCents`) não é texto de tela e
  ficou como está — a troca usou fronteira de palavra justamente para isso.

**A régua foram os testes.** Três deles reprovaram na hora: eles afirmam o
texto que a pessoa lê (*"quantos colaboradores entram"*, o motivo da carência)
e por isso pegaram a mudança onde ela importa. Foram atualizados junto.

**O que ainda diz "colaborador" e é legítimo:** o restante do sistema (SDR,
Risartanos, agenda), onde a palavra descreve a equipe da própria Risarte. A
troca ficou contida ao Empresarial, que é onde o sentido mudou.

⚠️ **A PALAVRA TAMBÉM MORAVA NO BANCO — e só a conferência na tela achou.**
O texto da apresentação (semeado pela 1010) e o da proposta (semeado pela
1014) não estão no código: estão numa tabela. Trocar o arquivo .sql antigo não
mudaria banco nenhum — migração já aplicada não roda de novo, e editá-la é
proibido. Daí a **migração 1015**, que reescreve **só o modelo da REDE e só se
o texto ainda for o original**: quem personalizou escreveu aquilo com as
palavras dele, e reescrever por cima seria o sistema editando texto de gente.
Quinta aparição de *código viaja sozinho, dado não* (§0b).

**E a régua errou de novo, na contraprova.** Ela abria `/risartanos` e
`/agenda` esperando encontrar "colaborador" lá — mas essas telas não desenham
a palavra (ela só aparece em comentário e em parâmetro de endereço), então a
conferência se acusou de estar lendo páginas vazias. A contraprova certa é
procurar a palavra NOVA nas mesmas páginas: **16 telas sem "colaborador", 12
delas dizendo "titular"** — e provada quebrando a busca de propósito.

### Bloco H2 — os BENEFÍCIOS na proposta, e os GRUPOS ✅ (migração 1016, v0.56.0)

Pedido do dono: *"Na proposta deve ter como configurar a vantagem e os
benefícios... Cada benefício deve ter como assinalar se vale para os Titulares
e para os Dependentes (como padrão vir marcado para os dois). Deve ter a
possibilidade de criar grupos de benefícios dos procedimentos, para não
precisar ficar configurando um benefício por vez em cada elaboração."*

**O que existe agora**

- Na aba **Proposta**, a seção **Vantagens e benefícios**: procedimento a
  procedimento, com tipo (desconto %, desconto R$, sem custo, não coberto),
  quantas vezes, a cada quantos meses, carência, e **duas caixas — vale para o
  titular, vale para o dependente**, as duas marcadas por padrão.
- **Grupos da rede** (`benefit_groups`): aplicar um numa proposta, e — para o
  gestor do programa — **guardar a combinação atual como grupo novo**.
  Manutenção em Configurações → Grupos de benefícios.
- O documento da proposta ganhou **"O que está coberto"**, com cada linha
  dizendo para quem vale, a regra de uso e a carência.

**Decisões que valem registrar**

- **`procedure_benefits` ganhou as duas colunas junto**, e não só a proposta.
  Sem elas na tabela que o motor consulta, a marca feita aqui seria enfeite: o
  fechamento a perderia e o desconto apareceria no orçamento do dependente do
  mesmo jeito. **E o motor passou a respeitá-las** — benefício que não alcança
  a pessoa some da lista dela, em vez de aparecer "bloqueado" (bloqueado é o
  que ainda vai valer; isto nunca vai).
- **`lead_benefits` é tabela própria.** Enquanto o negócio não fecha não há
  empresa para pendurar, e escrever em `procedure_benefits` com empresa nula
  sobrescreveria o **padrão da rede inteiro**.
- **NOT NULL com padrão `true` nas duas colunas** — e isto não contraria a
  lição da 0230 (coluna anulável em cascata): não é configuração que herda da
  rede, é uma afirmação sobre o benefício. "Não sei para quem vale" não é
  resposta útil no meio de um orçamento, e todo benefício que já existia valia
  para os dois.
- **Benefício que não vale para ninguém é recusado pelo banco.** Quem quer
  tirar a cobertura usa *Não coberto*, que é decisão declarada.
- **Aplicar um grupo SUBSTITUI o que havia do mesmo procedimento** e mantém o
  resto, dizendo na tela quantos trocou. Preservar o que já existia devolveria
  uma mistura que não é nem o grupo nem o que havia antes.
- **Salvar substitui o conjunto inteiro**: o que sumiu da tela sumiu do banco.
  Um upsert sem limpeza deixaria para sempre o benefício que alguém tirou — e
  ele reapareceria no documento.
- **O grupo semeado nasce do que a rede já pratica**, não de uma lista
  inventada; **e se não houver padrão da rede, nenhum grupo é criado.** Grupo
  vazio com nome bonito é pior que grupo nenhum.
- **Limite declarado:** os benefícios de um grupo não se editam em
  Configurações. Para mudar, aplique numa proposta, ajuste e guarde como grupo
  novo — assim a mesma conta não vive em dois lugares. A tela diz isso.

**Conferido nas telas do treino**, criando e apagando dado de teste: as duas
caixas, o *"Só o titular"* saindo impresso, a regra de uso, a carência, o
grupo aparecendo ao ser criado e sumindo ao ser apagado (com os itens junto).

⚠️ **E a régua errou TRÊS vezes, sempre a régua e nunca a tela:** ela cobrou o
seletor de grupos num banco que não tem grupo (e a tela esconde de propósito);
procurou o nome do grupo no texto quando ele mora **dentro de um campo de
edição**; e, antes disso, cobrou a palavra "colaborador" em telas que não a
desenham. **Conferir a régua antes de acusar a tela é o primeiro passo.**

### Bloco H3 — as CONDIÇÕES COMERCIAIS da proposta ✅ (migração 1017, v0.57.0)

Pedidos do dono, todos na mesma tela: mínimo e máximo de adesões (dizendo se
contam titulares, dependentes ou ambos), valor mínimo da proposta, **faixas de
preço por quantidade**, implantação **fixa ou por adesão**, e os preços de
dependente (individual, pacote familiar e extra) configuráveis na proposta.

**Decisões do dono, e o que elas significam no código**

- **A faixa do TOTAL vale para todos**: 120 adesões pagam 120 × o preço da
  faixa de 120. É simples de explicar ao cliente e de conferir na fatura; o
  efeito assumido é que passar de 99 para 100 barateia todo mundo de uma vez.
  A alternativa progressiva tornaria o "valor por titular" uma média, nunca um
  preço de tabela.
- **Abaixo do mínimo AVISA; acima do máximo BLOQUEIA.** A assimetria não é
  descuido: abaixo do mínimo a empresa pode estar entrando aos poucos, e
  barrar adesão é barrar receita; acima do máximo o limite costuma ser
  capacidade de atendimento, e furá-lo é prometer o que não se entrega.
- **Dependentes em individual · pacote · extra**, que é o que as colunas do
  sistema já guardavam desde a 0097 — o que faltava era poder decidir na
  negociação, antes de a empresa existir.

**Decisões técnicas que valem registrar**

- **TUDO ANULÁVEL, e aqui é a regra** (lição da 0230 pelo avesso): nulo é
  "esta negociação não combinou nada disso", e é o que faz o comportamento de
  hoje continuar valendo. **Proposta antiga não muda de preço por causa de
  coluna nova** — preso por teste (`SEM condição nenhuma, a conta é exatamente
  a de antes`).
- **Na cobrança FIXA por empresa, a faixa é escolhida pelo número de
  titulares.** Cobrar "por empresa" não faz a quantidade sumir: é ela que diz
  qual faixa vale. O que muda é o que o preço significa.
- **O PACOTE FAMILIAR SEMPRE SE DECLARA ESTIMATIVA.** Ele é por titular, e na
  hora da proposta ninguém sabe a distribuição — a conta supõe divisão por
  igual e **diz isso na tela e no documento**. Fingir precisão faria a primeira
  fatura, calculada família a família, não bater sem ninguém saber por quê.
  Sem saber quantos titulares terão dependentes, a conta cai no valor
  individual e declara que caiu.
- **Faixa mais cara para quantidade maior é AVISO, não erro.** Quase sempre é
  digitação trocada, mas existe negociação em que o volume custa mais
  (atendimento dedicado). O sistema diz o que vê; quem decide é quem vende.
- **Duas faixas na mesma quantidade são recusadas** — dariam dois preços para
  a mesma conta, e a resposta dependeria da ordem da consulta.
- **A tabela de faixas vai para o PAPEL**: é argumento de venda e é o
  compromisso que a empresa vai cobrar depois. Mostrar só o preço de hoje
  esconderia as duas coisas.
- **A simulação usa as condições SALVAS**, não as que estão sendo digitadas na
  seção de baixo (ela tem salvar próprio). Misturar faria a conta mudar com
  meia condição preenchida.

**Conferido nas telas do treino** com um cenário completo — 90 titulares, três
faixas, 30 dependentes em 10 titulares, implantação fixa e limites de 50 a 200:
mensalidade **R$ 3.740,00** (faixa de R$ 34,90 + dez pacotes de R$ 59,90),
implantação **R$ 3.500,00** sem multiplicar, tabela de faixas impressa com a
faixa atual marcada, limites no documento, e o bloqueio aparecendo com 250
titulares. Tudo devolvido ao estado anterior no fim.

⚠️ **E a régua errou pela quarta vez — agora na aritmética.** Ela afirmava
R$ 3.741,00 quando a soma é R$ 3.740,00, e acusou o sistema. O número do
sistema estava certo.

### Bloco H4 — o FECHAMENTO leva a proposta ✅ (migração 1018, v0.58.0)

Último pedido do OC-00083: *"o que for gerado na proposta da empresa e
aprovada e realizado o fechamento deve se tornar as informações da ficha da
empresa. e todos os benefícios deve ir para os Beneficiários que fazem parte
da empresa e estão cadastrados no programa."*

Até aqui a proposta morria no funil: negociava-se preço, faixa, carência e
benefício, e no fechamento nascia uma empresa com os **padrões da rede**. O
vendido precisava ser redigitado — e é na segunda digitação que o vendido e o
cobrado divergem.

**O que o fechamento passou a levar**

| Da proposta | Para o cadastro |
|---|---|
| preço do titular e dos dependentes | `adhesion_pricing` da empresa |
| tamanho do pacote familiar | `adhesion_pricing.dependent_family_size` (era `3` escrito no código desde a 0097) |
| faixas de preço por quantidade | `company_price_tiers` |
| benefícios, **com o "para quem vale"** | `procedure_benefits` da empresa |
| carência da empresa e do titular | `companies` (já vinha desde a 1014) |
| mínimo e máximo de adesões | `companies`, e o máximo **passa a recusar** cadastro |
| a negociação de origem | `companies.origin_lead_id` |

**Decisões que valem registrar**

- **A FAIXA VIVE NA EMPRESA, e a mensalidade a aplica todo mês** com a
  quantidade daquele momento. Congelar no fechamento faria a empresa crescer
  para 150 titulares e continuar pagando o preço de 50 — e "cresça e pague
  menos" foi o que ela comprou.
- **⚠️ A ARMADILHA DA COBRANÇA:** o cálculo mensal roda **um titular por vez**,
  para repartir o valor por CNPJ. Passar as faixas ali faria cada chamada ver
  "1 titular ativo" e cobrar sempre a faixa de 1 — **o preço mais caro, em
  toda empresa que negociou volume**. Existe `precoDoTitularComFaixa`, que
  calcula uma vez com o total; a cobrança usa esse valor nas partes.
- **As cinco telas que calculam a mensalidade** (painel, ficha, contrato,
  cobrança e a tela da empresa) leem as faixas pelo **mesmo** carregador. Cada
  uma do seu jeito é como elas passam a mostrar números diferentes para o
  mesmo mês. No painel da rede elas são carregadas de uma vez — uma consulta
  por linha seria uma ida ao banco por empresa, numa tela pensada para 200.
- **Nada derruba o fechamento.** Quando a cópia roda, a empresa já existe e o
  negócio já foi fechado: desfazer seria pior. O que não copiar volta numa
  lista, aparece na tela de quem fechou **e** na linha do tempo do lead.
- **A regra mora em `copiarPropostaParaEmpresa`, não dentro da action** —
  dentro dela só seria exercitada por um clique, e ninguém conferiria sem
  fechar um negócio de verdade.
- **O máximo recusa; o mínimo não.** Cadastrar titular acima do máximo é
  barrado com o número na mensagem; abaixo do mínimo nada trava, porque a
  empresa pode estar entrando aos poucos.
- **`select("*")` no levantamento do fechamento**: a lista nomeada de colunas
  já tinha ficado para trás duas vezes quando a proposta ganhou campos, e
  campo esquecido ali vira preço que o cliente combinou e o sistema não cobra.

⚠️ **E A RÉGUA NÃO DISPAROU — a sexta vez, e a pior delas.** O teste da cópia
usava um banco de mentira que **ignorava a lista de colunas do `select`**.
Tirei `for_holder, for_dependent` da consulta de propósito, para ver o teste
reprovar, e ele **passou**: o defeito que ele existe para pegar atravessava
inteiro. O banco de mentira passou a recortar pelas colunas pedidas, e só
então a régua reprovou. **Teste que ninguém viu falhar não é teste.**

**Nota de teste:** `server-only` é trava de empacotamento, e levantava erro ao
ser importado no Vitest — o que deixaria **toda regra de servidor sem teste**.
Ele virou um módulo vazio só nos testes (`vitest.config.ts`); no build do Next
a trava continua valendo.

### Bloco I1 — dois consertos ✅ (sem migração, v0.59.0)

**1. DEFEITO: o que a rede configura não chegava na proposta.**

Relato do dono (24/09/2026): *"os benefícios por procedimentos que são criados
em configurações não aparecem no momento da elaboração das propostas."*

O defeito existia e era silencioso: a aba Proposta lia **só** `lead_benefits`,
então o trabalho feito em Configurações → Benefícios não alcançava negociação
nenhuma — toda proposta começava do zero, e ninguém entendia para que servia a
tela de configuração.

Agora vale a mesma cascata da apresentação e do texto:

- proposta **sem benefício nenhum** abre com o **padrão da rede** já
  preenchido, e a tela **diz que ainda não está salvo** (senão alguém fecharia
  a proposta achando que já estava);
- depois do primeiro salvar, quem manda é a proposta — **inclusive quando ela
  ficou vazia de propósito**;
- o padrão da rede também aparece na lista de **grupos para aplicar**, para ser
  retomado a qualquer momento.

**2. A PROPOSTA DEIXOU DE CALCULAR O VALOR DOS DEPENDENTES** — e isto corrige
uma decisão minha.

Pedido dele: *"na proposta não deve calcular o valor com os dependentes, pois
no momento da contratação não é possível saber quantos dependentes terão. Deve
apresentar apenas o valor por dependente individual, familiar e extra."*

Na H3 eu tinha resolvido com uma estimativa que **se declarava estimativa** —
supondo distribuição por igual entre os titulares. Ele cortou pela raiz, e
está certo: número estimado num documento de venda vira expectativa, e a
primeira fatura, calculada **família a família**, não bateria.

- a mensalidade da proposta é **só dos titulares**;
- o documento mostra a **tabela**: individual, pacote familiar (com o tamanho
  do pacote) e extra;
- e diz, com todas as letras, que o total dos dependentes **sai na
  implantação**, quando os cadastros existem — que é quando a cobrança deles
  começa.

⚠️ **`custoDosDependentes` foi REMOVIDA, não deixada sem uso.** Regra que o
dono rejeitou, guardada no código, é regra que volta a ser chamada por engano.
O porquê ficou no lugar dela, em `condicoes-da-proposta.ts`.

**Três testes reprovaram na hora da mudança** — eles afirmavam que o dependente
entrava na conta. Foram reescritos para afirmar a regra nova, que é o motivo
de eles existirem.

**Conferido nas telas do treino:** o benefício da rede aparecendo na proposta
com o aviso de "ainda não salvo", e o documento com a mensalidade só dos
titulares (90 × R$ 39,90) mais a tabela de dependentes.

### Bloco I2 — grupos em Configurações e a MARGEM por procedimento ✅ (sem migração, v0.60.0)

Dois pedidos do dono (24/09/2026).

**1. "nas configurações deve ter como criar grupos de benefícios."**

Antes só dava para criar **a partir de uma proposta** — o que obrigava a abrir
uma negociação para montar algo que é da rede. Agora o grupo nasce em
Configurações → Grupos de benefícios, **vazio ou copiando o padrão da rede**, e
os benefícios dele se editam ali mesmo.

Começar do padrão vem marcado: é o que a Risarte já pratica, e tirar é mais
rápido que montar do zero. Salvar os itens **substitui o conjunto inteiro** —
mesma regra da proposta, porque um upsert sem limpeza deixaria para sempre o
item que alguém tirou, e ele voltaria a ser aplicado sem ninguém entender.

**2. "deve ter como visualizar a margem de lucro de cada procedimento (com
base na precificação) ... baseado na média da rede."**

A tela de benefícios ganhou a coluna **Margem (rede)**, e ela responde a
pergunta que importa na hora de decidir: **quanto este benefício custa de
margem**.

A conta não é nova — é a do FIN5 (`computeMargin`), com o benefício aplicado
ao preço antes. As quatro fontes já existiam no precificador e são pedidas com
escopo **nulo**, que é como o resto do sistema diz "padrão da rede":
`cost_settings_for`, `material_costs_for_clinic`, `payout_matrix` e o preço
padrão do procedimento.

**Decisões que valem registrar**

- **⚠️ CUSTO ZERO FARIA A MARGEM PARECER 100%** — o número mais perigoso que
  esta tela poderia mostrar, porque convida a dar desconto que a clínica não
  tem. Cada procedimento carrega `temRepasse` e `temMaterial`, e quando falta
  algum a tela diz **"a margem acima é um teto otimista"** em vez de exibir o
  número como verdade.
- **O DESCONTO SAI INTEIRO DA MARGEM**, e é por isso que a coluna existe: o
  repasse ao dentista é FIXO e não cai junto com o preço. 40% de desconto num
  procedimento de R$ 200 tira R$ 80 do preço e **R$ 77,60 da margem**.
- **Procedimento sem custo não é "margem zero"**: ele custa o repasse e o
  material, que continuam sendo pagos. A margem fica **negativa**, e a tela diz
  "este benefício deixa o procedimento no prejuízo".
- **No gratuito não se cobra taxa de cartão** — não houve cobrança, não houve
  taxa. A taxa incide sobre o que ENTRA, não sobre o preço de tabela.
- **O repasse varia por nível do plano de carreira**, e esta tela não pergunta
  o nível: usa-se a **maior** das linhas. Entre errar para mais e para menos no
  custo, errar para mais é o lado seguro — mostra a margem mais apertada.
- **Procedimento sem preço cadastrado fica de fora**, com "sem preço
  cadastrado" escrito: margem sobre zero seria sempre negativa e não
  significaria nada.
- O percentual é **sobre o que a pessoa paga**, não sobre a tabela — sobre a
  tabela, todo desconto pareceria menos grave do que é.

**Conferido na tela do treino**, com um procedimento que tem preço de verdade.

⚠️ **E a régua errou mais uma vez:** ela cobrava o texto do formulário de
criar grupo, que só existe **depois do clique**. Conferência por HTTP não
alcança o que está atrás de uma interação — cobrar isso é acusar a tela de não
mostrar o que ela mostra. Aquela asserção passou a conferir o caminho no
código, dizendo que é isso que ela está conferindo.

### Bloco I3 — as UNIDADES da parceria ✅ (migração 1019, v0.61.0)

Pedido do dono (24/09/2026): *"quando vai criar uma proposta deve ter como
indicar qual é a unidade principal para esta parceria e quais são as outras
unidades que os beneficiários estarão vinculados e poderão utilizar. Inclusive
durante a definição dos benefícios quais são as unidades que poderão realizar
os procedimentos de custo zero por exemplo."*

Escolha dele entre as três formas: **unidade principal + vinculadas, com
exceção por benefício**.

**O que existe agora**

- Na aba **Proposta**, a seção **Unidades da parceria**: a unidade principal e
  as outras que podem atender. A principal entra na lista **marcada e sem
  poder ser desmarcada** — a unidade que responde pela empresa não atender
  seria a primeira surpresa desagradável.
- Em **cada benefício**, caixas para restringir as unidades. Só aparecem
  quando a parceria tem mais de uma — com uma só, a pergunta não existe.
- O **documento** ganhou *"Onde o programa é atendido"*, e cada benefício
  restrito sai com o **"Só em ..."** ao lado.
- **O motor de orçamento respeita a unidade**: benefício que não vale naquela
  unidade some da lista da pessoa.
- O **fechamento leva tudo** — unidade principal, unidades vinculadas e a
  restrição de cada benefício.

**Decisões que valem registrar**

- **⚠️ NULO E VAZIO SIGNIFICAM "TODAS".** A outra leitura — "restringi a
  nenhuma" — faria todo benefício já existente parar de valer no dia em que a
  coluna nasceu. Quem quer tirar a cobertura usa *Não coberto*; lista vazia é
  ausência de restrição, e a tela diz isso para a lista vazia não parecer erro.
- **Sem parceria declarada, o programa não limita unidade nenhuma** — é como
  funcionava antes desta regra, e é o que mantém toda empresa já cadastrada
  exatamente como está.
- **Sem saber onde a pessoa está sendo atendida, a resposta é SIM.** Recusar
  por falta de informação tiraria benefício de quem tem direito.
- **A unidade vem da SESSÃO**, porque é a tela do orçamento que pergunta e ela
  sempre roda dentro de uma unidade ativa. Fora de sessão (rotina, script) a
  regra devolve "vale".
- **Tabela para as unidades da parceria; `uuid[]` para a exceção por
  benefício**, e a diferença é deliberada: os benefícios da proposta são
  apagados e reescritos a cada salvar, e uma tabela filha exigiria recriar os
  vínculos a cada gravação — bastaria um esquecimento para a restrição sumir
  em silêncio, que é o pior defeito possível numa regra de "onde vale".
- **O GRUPO de benefícios NÃO guarda unidade**, de propósito: ele é da rede e
  as unidades são de cada parceria. Um grupo que restringisse unidade só
  serviria para a empresa em que foi criado — e estragaria as outras em
  silêncio.
- **"Em todas as unidades" não é escrito linha a linha** no documento:
  repetir viraria ruído e esconderia justamente a linha restrita.
- **Id de unidade que saiu da parceria some do texto**, em vez de virar "e
  mais 1" sem dizer qual.

**Conferido nas telas do treino** com uma parceria de duas unidades e um
benefício restrito a uma: 10 asserções, 0 falha — inclusive a que garante que
o benefício SEM restrição não vira ruído no documento.

### Bloco I4 — a QUANTIDADE CONTRATADA e o termo de inclusão ✅ (migração 1020, v0.62.0)

Pedido do dono (24/09/2026): *"a empresa tem 100 colaboradores, e quando foi
fazer o cadastro enviou 120 nomes — o sistema não pode permitir cadastrar os
120. Deve ter algum botão para acrescentar mais colaboradores, para isso deve
gerar uma proposta para incluir os novos."*

As três escolhas dele, na tela de perguntas:

1. A trava é pela **quantidade fechada no contrato** (não pelo máximo da
   proposta, que continua valendo como teto separado).
2. O botão gera **um documento mais simples que a proposta inicial (mais
   curto), mas lembrando a empresa que o titular está sendo cadastrado no
   programa e é referente ao acordo que já existe entre a Risarte e a empresa**.
3. Para acordos de **valor fixo**, a proposta define a quantidade máxima de
   adesões e **já deixa combinado o que vale se passar do teto** — um novo
   valor fixo ou um preço por adesão de titulares e dependentes.

**O que existe agora**

- Na aba **Proposta**, em Condições comerciais, o bloco **"Se passar do
  contratado"**: o modo (*por adesão* ou *novo valor fixo do pacote*) e os
  valores. É aqui que o excedente é combinado — antes de acontecer, que é o
  ponto do pedido 3.
- O **fechamento leva a quantidade contratada** (titulares e dependentes) e a
  regra do excedente para a ficha da empresa.
- Na ficha, aba **Titulares**, o cartão **Quantidade contratada**: o que o
  contrato fechou, o que os termos aceitos acrescentaram, quantos estão
  cadastrados e quantas vagas restam. Sem vagas, ele diz que os cadastros
  estão bloqueados e mostra o caminho.
- **O cadastro é recusado no limite**, com a frase inteira: *"Esta empresa já
  tem 2 titular(es) ativos, e o contrato fechou 2. Para incluir mais, gere um
  termo de inclusão…"*.
- **"Incluir mais titulares"** gera o **termo de inclusão** (código `TI-`),
  que calcula a diferença mensal pela regra combinada e, **depois de aceito**,
  libera exatamente aquela quantidade.
- O termo tem **página própria para imprimir/PDF**, curta.

**Decisões que valem registrar**

- **⚠️ SEM QUANTIDADE CONTRATADA NÃO HÁ TRAVA, e o cartão nem aparece.** Toda
  empresa cadastrada antes desta regra tem o campo nulo; tratá-lo como zero
  travaria a operação inteira por causa de um campo novo. É a mesma leitura do
  "nulo significa todas" do I3.
- **É o ACEITE que libera, não o rascunho.** Termo em rascunho não abre vaga:
  ele ainda não foi reconhecido pela empresa, e é esse reconhecimento que
  justifica a cobrança da diferença.
- **Cancelar um termo devolve as vagas** — mas o termo continua no histórico.
- **O termo NÃO repete a proposta.** Benefícios, carência, unidades e
  condições continuam sendo os do contrato; reescrevê-los criaria um segundo
  documento dizendo as mesmas coisas, e no dia em que os dois discordassem
  ninguém saberia qual vale. É isso que o dono pediu ao dizer *"mais curto"*.
- **Termo sem valor não é aceito** e nasce avisando. Ele existe para cobrar a
  diferença; aceitar um de R$ 0,00 liberaria cadastro de graça, que é o
  contrário do que ele serve para fazer. O aviso volta **junto com o sucesso**
  — o termo existe (é verdade) e nasceu sem valor (também é).
- **No valor fixo, cobra-se a DIFERENÇA, não o pacote inteiro.** O acordo novo
  substitui o anterior; somar os dois cobraria duas vezes o mesmo programa.
- **Implantação fixa não se cobra de novo** — ela foi paga uma vez. Só a
  implantação por adesão acompanha gente nova.
- **Os valores ficam congelados no termo.** Mudar a regra da empresa depois não
  pode reescrever o que ela aceitou — mesma lei do repasse (0209), da alçada
  (0194) e do percentual do split (0232).
- **Quem soma o limite é o BANCO** (`empresarial.limite_de_titulares`), não a
  tela: a mesma resposta precisa valer para este cadastro, para a importação de
  planilha e para qualquer caminho futuro.

**Conferido nas telas do treino**, com a empresa criada e apagada no fim: 18
asserções na ficha e no documento, e mais 7 chamando a **mesma server action
que o botão chama** — os dois contratados entram, o terceiro é recusado e **não
é gravado**, e com o termo aceito o mesmo cadastro passa. A régua foi provada
quebrando a trava de propósito: com ela quebrada, o terceiro titular foi
gravado e a conferência acusou 4 falhas.

### Bloco J — a aba Proposta em PASSOS ✅ (sem migração, v0.64.0)

Relato do dono (24/09/2026): *"no funil do empresarial, a configuração da
proposta ainda está muito confusa e uma lista longa. Faça um refinamento
estético e que siga um fluxo que otimize o trabalho."*

**O defeito existia, e dava para medir.** A aba tinha **nove blocos numa
coluna só**, mais de quarenta campos e **cinco botões de salvar**. Pior que o
tamanho era a ORDEM:

1. como a proposta será montada (preços)
2. prazo e carência
3. **a SIMULAÇÃO** — no meio do formulário
4. dados do contrato
5. unidades
6. **CONDIÇÕES COMERCIAIS** — as faixas de preço, *depois* da simulação
7. benefícios
8. texto

Quem mexia numa faixa (bloco 6) tinha de rolar para cima até o bloco 3 para
ver o efeito no valor. **A resposta ficava longe da pergunta** — e é isso que
faz uma tela parecer confusa mesmo com cada bloco certo por dentro.

**O que existe agora**

- Uma **trilha de seis passos** à esquerda, na ordem do trabalho: *Quem paga e
  quanto · Condições comerciais · Benefícios e unidades · Prazo e carência ·
  Texto da proposta · Dados do contrato*.
- Cada passo traz o **seu resumo** embaixo do nome ("R$ 39,90 por titular · 90
  titulares", "2 faixas · máx. 200", "5 benefícios · 2 unidades").
- A **simulação fica fixa ao lado** do trabalho em tela larga.
- O salvar do formulário principal **aparece só nos passos dele** e diz, ao
  lado, que salva os três juntos.

**Decisões que valem registrar**

- **⚠️ OS PAINÉIS SÃO ESCONDIDOS, NUNCA DESMONTADOS.** O formulário principal
  atravessa TRÊS passos (preços, prazos, dados do contrato) com um `<form>`
  só, e campo desmontado não é enviado no salvar: desmontar apagaria em
  silêncio o que está nos outros dois passos. Mesma escolha das abas da ficha
  e da ficha do paciente. **É a única coisa nesta entrega que poderia perder
  dado**, e por isso é o que a régua mede primeiro.
- **É uma trilha, não um assistente.** Sem "próximo" obrigatório e sem passo
  trancado: quem volta numa proposta em follow-up quer mexer numa faixa e
  sair. Mesma razão de as abas da ficha não serem trancadas.
- **Os dados do contrato foram para o FIM.** Razão social e CPF de quem assina
  não mudam nada na negociação, e estavam no meio da precificação.
- **Zero não é falta.** Sem faixa ("preço único") e sem benefício o passo fica
  cinza, não amarelo — pintar de amarelo o que está certo é a forma mais
  rápida de ensinar a equipe a ignorar avisos. O amarelo ficou para o que
  falta de verdade.
- **Máximo de adesões SEM regra de excedente virou aviso** (liga o Bloco I4):
  é o caso que faz o termo de inclusão nascer sem valor. Avisar na hora de
  montar a proposta é barato; descobrir na hora de cobrar, não.
- **Um botão de salvar por dono.** Os passos 2, 3 e 5 têm o salvar deles
  dentro do passo, e o "Salvar proposta" some ali — um botão de salvar que não
  salva o que está na tela é pior que nenhum.
- **O resumo de cada passo é conta pura e testada**
  (`src/lib/empresarial/passos-da-proposta.ts`, 17 testes): a tela não decide
  o que dizer, ela só desenha.

**Conferido nas telas do treino** com um lead semeado e apagado no fim: 22
asserções, 0 falha. A régua foi provada desmontando os painéis escondidos de
propósito — e ela acusou na hora que os passos 4 e 6 sumiram do formulário.
Ela também já tinha me pegado antes: a primeira versão semeava as faixas numa
coluna que não existe, ignorava o erro da inserção e **acusava a tela** de não
contar faixa nenhuma.

#### J.1 — o amontoado, e por que ele aconteceu (v0.65.0)

O dono testou na tela e mandou a foto: *"ficou amontoado"*. Estava certo, e as
causas eram três — **todas minhas, nenhuma de gosto**:

1. **A ficha é `max-w-4xl` (896px), e eu pedi TRÊS colunas.** Trilha (216) +
   simulação (320) deixavam ~360px para o trabalho. A ficha passou a ser larga
   **a partir de `xl`** (`xl:max-w-7xl`); as outras quatro abas ganharam
   `max-w-4xl` por dentro, porque são formulário de coluna única e linha de
   1200px é ruim de ler.
2. **`sm:grid-cols-4` na simulação.** O `sm:` mede a **JANELA**, não a coluna:
   numa tela larga os quatro números eram espremidos nos 320px da barra
   lateral e **"MENSALIDADE" escrevia por cima de "POR TITULAR"** — dá para ver
   na foto. Virou `grid-cols-2` fixo, e o `Numero` ganhou `min-w-0` +
   `break-words` para quebrar em vez de estourar a célula.
3. **`bg-gold text-primary` no número do passo ativo.** O próprio
   `globals.css` avisa que `--gold-foreground` é a cor de texto para fundo
   sólido: com `text-primary` o número ficava escuro sobre escuro e sumia do
   círculo.

**O conserto de raiz da classe inteira: a coluna do trabalho virou
`@container`.** Daqui para dentro, `@md:` e `@xl:` medem **a coluna**, e os
editores de condições, benefícios e unidades passaram a responder ao espaço
que realmente têm. Enquanto dependiam de ponto de corte de janela, eles
continuariam abrindo quatro colunas dentro de uma faixa de 650px sempre que a
tela fosse grande — que é exatamente o defeito da foto, em outro lugar.

**Regra que fica:** *dentro de coluna estreita, ponto de corte de janela
mente.* Layout de duas ou três colunas pede `@container`, não `sm:`/`lg:`.

A régua também errou de novo, e do mesmo jeito de sempre: ela varria a
**página inteira** procurando `sm:grid-cols-4`, acusava a simulação, e o que
ela tinha achado era de outro componente. Passou a olhar só o cartão da
simulação — e o `sm:grid-cols-4` verdadeiro, dos outros dois editores, virou
conserto em vez de acusação errada.

#### I4.1 — o teto de DEPENDENTES, que ficou faltando (migração 1021, v0.66.0)

**A I4 foi entregue pela metade, e ninguém relatou — eu achei ao levantar as
pendências do módulo.** A decisão do dono dizia *"a quantidade máxima de
adesões para aquele acordo (sendo por titulares **ou dependentes ou ambos**)"*.
A 1020 criou `contracted_dependents`, o fechamento passou a gravá-lo e o termo
de inclusão já contava dependentes — **mas nada conferia esse teto na hora de
cadastrar**. O acordo dizia "até 50 dependentes" e o sistema aceitava 500, em
silêncio.

**O defeito mais caro é o que não reclama.** A trava dos titulares dava a
impressão de que o assunto estava resolvido; a metade que faltava só
apareceria no dia em que alguém conferisse a fatura contra o contrato.

**O que existe agora**

- `empresarial.limite_de_dependentes(uuid)` — espelho exato de
  `limite_de_titulares`: contratado + o que os termos **aceitos**
  acrescentaram, **nulo** quando não há teto.
- `empresarial.dependentes_ativos(uuid)` — a contagem, no banco.
- `addDependent` recusa no limite, com frase própria de dependentes.
- O cartão da ficha ganhou a **segunda linha**, e aparece mesmo quando o
  acordo limita **só** dependentes.
- O **máximo da proposta** passou a valer para dependentes quando o alvo é
  *dependentes* ou *ambos* — antes só olhava titulares.

**Decisões que valem registrar**

- **⚠️ DEPENDENTE DE TITULAR INATIVO NÃO OCUPA VAGA.** Se ocupasse, a empresa
  que trocou de funcionário ficaria travada por gente que não está mais no
  programa. A regra mora no banco, numa função só: escrita em cada tela que
  precisar dela, um lugar contaria diferente.
- **O teto é DA EMPRESA, não de cada titular.** O acordo combina "até 50
  dependentes"; como eles se distribuem entre as famílias é assunto dela.
- **Duas frases de recusa escritas por extenso**, em vez de uma função com
  parâmetro "quem". Montar frase por concatenação produz português torto na
  primeira flexão que não encaixa — e é texto que alguém lê no meio do
  atendimento.
- **`limite_de_dependentes` é cópia da conta dos titulares, de propósito.**
  Duas contas diferentes para a mesma pergunta é como elas passam a divergir.

**Conferido nas telas do treino**: 18 asserções chamando a **mesma server
action que o botão chama**, com a empresa criada e apagada no fim. A régua foi
provada desligando a guarda — e acusou o dependente recusado sendo **gravado**.
As duas conferências da 1020 (titulares e termo) foram rodadas de novo: nada
regrediu.

### Bloco K — a cobrança de implantação (relatos OC-00055 e OC-00057) ✅ (sem migração, v0.68.0)

Dois relatos do André, de 21/09/2026, que são o mesmo assunto:

- *"Fiz o cadastro de uma nova empresa e o sistema não permitiu gerar a
  cobrança de implantação sem ter colaboradores cadastrados... Já tivemos
  fatos que a empresa aderiu ao programa e só enviou os dados dos
  colaboradores no mês posterior."* (OC-00055)
- *"A empresa foi cadastrada informando que terá 7 colaboradores, mas até o
  momento só temos dados de 2. A cobrança foi gerada apenas com o valor
  referente a 2."* (OC-00057)

**A regra antiga existia por um motivo defensável** — não cobrar por gente que
não existe — **mas resolvia a pergunta errada.** A implantação é a adesão ao
programa: ela é devida pelo que foi *combinado*, não pelo que já foi
*digitado*. E o caminho que sobrava (gerar pelos 2 e corrigir o valor à mão)
depende de alguém lembrar — e o dia em que ninguém lembra, a empresa é cobrada
a menos e ninguém percebe.

**O que existe agora** (decisão do dono, 24/09/2026)

- A implantação passa a ser calculada pela **quantidade contratada**, que veio
  da proposta no fechamento (I4), sempre que houver menos cadastrados do que o
  contratado — inclusive quando não há nenhum.
- A tela **diz que a conta veio dali**, com os dois números. Sem a frase, quem
  vê o valor procura os titulares na lista e não os encontra.
- **Sem titulares e sem quantidade contratada**, a tela **pede o valor** em vez
  de recusar. É o caso da empresa cadastrada direto, sem passar pelo funil.
- A **mensalidade continua exigindo titulares**: são perguntas diferentes.
  Cobrar mensalidade de ninguém não é cobrar a adesão de um acordo — é cobrar
  serviço de quem não está no programa.

**Decisões que valem registrar**

- **⚠️ SÓ TITULARES entram na conta**, nunca dependentes — a mesma lei da
  proposta (I1): ninguém sabe quantos entram nem como se distribuem entre as
  famílias antes dos cadastros.
- **A faixa é escolhida pela quantidade CONTRATADA.** Usar a faixa de "1"
  porque ainda não há ninguém cadastrado cobraria o preço mais caro justamente
  de quem fechou volume.
- **O valor à mão só é aceito quando a prévia declarou que não há como
  calcular.** Aceitá-lo em qualquer caso abriria a porta para alguém digitar
  um número por cima da conta sem ninguém ver.
- **O vencimento já era editável** (botão *Editar* da cobrança, desde
  31/07/2026), e continua — era isso que o OC-00059 pedia. O padrão vem do
  **dia de vencimento** do cadastro da empresa.

**Conferido nas telas do treino**: 14 asserções chamando as mesmas server
actions que os botões chamam. A régua foi provada apagando a quantidade
contratada do cálculo — e ela acusou a cobrança voltando a sair por R$ 79,80
(os 2 cadastrados) em vez de R$ 279,30 (os 7 contratados).
