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

### Bloco C — do Apresentado à Implantação (a fazer)

- **Levantamento do consultor:** convênio odontológico atual e quanto paga hoje;
  outros benefícios; participação em ações/projetos sociais (é diferencial do
  programa); nível de interesse; chance de sucesso na percepção do consultor.
- **Dados comerciais da proposta e do contrato:** quem paga (empresa integral,
  parcial ou colaborador); quantos colaboradores entram; dependentes nesta fase;
  um CNPJ ou conjunto; cobrança por colaborador (padrão) **ou valor fixo por
  empresa** (regra alternativa, necessária para sindicato e associação).
- **Apresentação padrão** editável, com download em PDF.
- **Envio do pacote** — escolher o que vai (proposta, contrato, apresentação,
  boleto de implantação, documentos adicionais). Registrar o envio **move o
  cartão sozinho para Follow-up**.
- **Follow-up** com os dois selos: **contrato assinado** e **boleto de
  implantação pago**. Os dois verdes → o cartão avança.
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
