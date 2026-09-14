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
| 8 | **Implantação** | Cadastro dos colaboradores, boas-vindas, 1ºs agendamentos |

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
  por colaborador, ou o colaborador), quantos colaboradores, dependentes nesta
  fase, um CNPJ ou conjunto, e **por colaborador ou valor fixo por empresa** —
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
   ela quer provar. Sem colaborador, o valor por cabeça também é nulo (dividir
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

#### C3 — fechamento e implantação (a fazer)

- **Fechamento** com a conferência do consultor responsável: está tudo certo?
  há consideração a fazer? houve combinado específico que não podemos esquecer?
  Confirmado o ganho → **vai sozinho para Implantação**.
- **Implantação:** upload da lista de colaboradores (nome completo, CPF,
  telefone, e-mail) criando **pré-cadastro** — os dados são completados no
  agendamento da primeira consulta. Encaixa na tela de **Boas-vindas** (1006).
  Alguma empresa pede apresentação para todos os colaboradores: é aqui.

### Bloco D — painel e alertas (a fazer)

- Dashboard: conversão fase a fase, tempo médio em cada fase, quem está parado,
  desempenho por consultor e **por canal de captação**.
- Alertas visuais no cartão e aviso no sino, por **inatividade** e por **tempo
  demais na fase**.
