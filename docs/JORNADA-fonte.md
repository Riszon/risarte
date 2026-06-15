# Jornada do Cliente Risarte — documento-fonte do proprietário

> Texto entregue pelo proprietário em 2026-06-13 (arquivo
> "A JORNADA DO CLIENTE RISARTE (espinha dorsal do sistema).docx").
> Preservado aqui como fonte. O documento consolidado e reconciliado com as
> decisões fica em `JORNADA.md` (a ser escrito após as definições).

---

## FASE 1 — Aquisição
Dois caminhos para iniciar a jornada:
- **Pela Franqueadora:** o **SDR** faz o agendamento, confirma e acompanha até o
  comparecimento (check-in) do cliente na unidade.
- **Pela Unidade:** a **Recepcionista** faz o agendamento, confirma e acompanha
  até o check-in na unidade.

Responsável: SDR (Franqueadora) / Recepcionista (Unidade). Participantes: SDR e
Recepcionista. Pilar: **a definir** (automático).

**Gatilho:** quando o cliente faz **check-in** na unidade → automático FASE 1 →
FASE 2. Se o agendamento foi Urgência/Emergência → FASE 1 → FASE 5.

## FASE 2 — Conversão Clínica
Recepção (check-in pela recepcionista) → consulta inicial (pilar **Diagnóstico**,
pelo Coordenador Clínico) → coleta de dados (Coordenador: fotos faciais/
intraorais, radiografias, escaneamento, exames, gravação de áudio da consulta,
transcrição e resumo) → envio ao Centro de Planejamento (Coordenador). Ao
finalizar a avaliação, a Recepcionista agenda a apresentação comercial (FASE 4,
SLA 48h).

Onde: Unidade. Responsável: Coordenador Clínico. Participam: Coordenador e
Recepcionista. Pilar: **Diagnóstico** (automático).

**Gatilho:** Coordenador finaliza a consulta e envia ao Centro de Planejamento →
automático FASE 2 → FASE 3.
**Status:** após a consulta inicial e até o envio → "Aguardando o Envio para
Planejamento".

## FASE 3 — Centro de Planejamento (NÚCLEO)
Dentista Planner recebe os dados da FASE 2 ou FASE 6 → confirma diagnóstico →
Plano de Tratamento + alternativos → classifica o pilar da Metodologia → solicita
aprovação do Coordenador Clínico que avaliou → após aprovado, gera Orçamento →
sinaliza ao Consultor Comercial. SLA 24h. Pode pedir nova avaliação ao
Coordenador, devolvendo o cliente à FASE 2 ou FASE 6.

Onde: Franqueadora. Responsável: Dentista Planner. Participam: Planner,
Coordenador e Consultor Comercial. Pilar: **Planejamento** (automático).

**Gatilho:** Planner finaliza → envia ao Coordenador aprovar → aprovado → gera
orçamento → Planner envia ao Consultor → automático FASE 3 → FASE 4.
Devolução: Planner solicita nova avaliação/reavaliação → automático FASE 3 →
FASE 2 ou FASE 3 → FASE 6, **com campo de orientações** explicando a necessidade.
**Status:** "Em Planejamento"; ao enviar para aprovação "Aguardando Aprovação do
Planejamento"; ao devolver "Revisão com Coordenador Clínico".

## FASE 4 — Conversão Comercial
No dia agendado, WhatsApp com informações e link da reunião (Meet/WhatsApp/Zoom)
→ apresentação online pelo Consultor (gravação de áudio, transcrição, resumo) →
se aceito: fechamento com o Assistente Comercial, que envia via ZapSign os
documentos (contrato, TCLE, LGPD, confissão de dívida em caso de boletos,
orçamento, plano de tratamento) + link de pagamento ASAAS → se não aceito:
Follow-up Comercial com histórico e tempo. Pode pedir ajuda da Gerente,
Recepcionista e/ou Coordenador. **Regra de ouro: só é venda com documentos
assinados E pagamento confirmado** (ou boletos emitidos/enviados no boleto sem
entrada).

Onde: Franqueadora. Responsável: Consultor Comercial. Participam: Planner,
Recepcionista, Coordenador, Assistente Comercial e Consultor. Pilar: **Saúde,
Função, Estética ou Prevenção** (definido pelo Dentista Planner).

**Gatilho:** documentos assinados e pagamentos definidos → cliente liberado para
agendar a FASE 5; quando comparece e faz check-in na 1ª sessão → FASE 4 → FASE 5.

## FASE 5 — Início de Tratamento
Ao fechar, a Recepcionista é notificada automaticamente para agendar o início; o
Plano aprovado fica disponível aos dentistas executores.
**Status:** "Aguardando Iniciar Tratamento" (do fechamento até confirmar início);
"Em Tratamento" (compareceu à 1ª sessão); "Tratamento Finalizado" (todos os
procedimentos executados); "Tratamento Cancelado" (cancelou todo o plano);
"Tratamento Cancelado Parcialmente" (cancelou parte).

**Ao finalizar todos os procedimentos** → decisão obrigatória (não pode fechar
sem responder): o profissional que fez o último procedimento recebe o aviso "O
cliente necessita passar por consulta de reavaliação com o Coordenador Clínico?"
- **SIM** → Recepcionista agenda reavaliação com Coordenador → FASE 6.
- **NÃO** → Coordenador recebe alerta para definir se necessita de Novo
  Planejamento (FASE 6 sem consulta de reavaliação) que será feito pela FASE 3.
  - Se **NÃO** → Recepcionista agenda em controle de retorno (lista de
    pré-agendamentos, confirmar quando próximo do retorno) → FASE 7.
  - Se **SIM** → Coordenador envia dados ao Centro de Planejamento (FASE 3);
    Recepcionista agenda o cliente com o Consultor (FASE 4).
- **NÃO SEI** → Coordenador recebe notificação para tomar a decisão (mesmo
  desdobramento SIM/NÃO acima). O aviso fica em destaque e não some até decidir.

Aparecem informações nas fichas e nas notificações do **Gerente** sempre que algo
estiver aguardando definição de qualquer função (aprovações, agendamentos,
decisões).

**Urgência/Emergência:** todo cliente pode iniciar direto na FASE 5 — exceto
clientes novos, que passam obrigatoriamente pela FASE 1 primeiro. O Coordenador
pode lançar os procedimentos do atendimento emergencial; como não há
planejamento, aparece a opção de decidir se há apresentação comercial ou se vai
direto ao Assistente Comercial enviar contratos e links de pagamento.

Onde: Unidade. Responsável: Coordenador Clínico. Participam: Recepcionista,
Dentistas e Coordenador. Pilar: Saúde/Função/Estética/Prevenção (do Planner); em
urgência/emergência sem pilar definido, permanece "a definir".

## FASE 6 — Reavaliação
Controle de qualidade (enviar pedido de avaliação ao cliente) → reavaliação
clínica (pilar **Diagnóstico**, com gravação, transcrição e resumo) → se precisa
de novo planejamento, coleta novos dados e retorna à FASE 3.

Onde: Unidade. Responsável: Coordenador Clínico. Participam: Recepcionista e
Coordenador. Pilar: **Diagnóstico** (automático).

**Gatilho:** "Necessita de Novo Planejamento?" — NÃO → FASE 6 → FASE 7
(confirmada quando a recepcionista cria o alerta de retorno/pré-agendamento); SIM
→ FASE 6 → FASE 3 (Coordenador reúne novos dados e envia ao Centro de
Planejamento), Recepcionista agenda FASE 4 com Consultor.
**Status:** se SIM → "Aguardando o Envio para Planejamento".

## FASE 7 — Acompanhamento
Prevenção contínua, retorno agendado, cliente inativo, resgate. Em retorno
agendado, pergunta-se ao Coordenador "Necessita de Reavaliação?" — SIM →
Recepcionista agenda reavaliação (FASE 6); NÃO → agenda direto FASE 5. Aplica-se
a clientes do Programa de Prevenção, retornos periódicos, urgências/emergências e
inativos resgatados (mesma lógica).

**Regras de ATIVO/INATIVO (configuráveis na tela de Prazos/SLA):**
- ATIVO: em atendimento; com atendimento há menos de 12 meses (exceto FASE 1 e
  2); FASE 1 com menos de 60 dias; FASE 2 com menos de 90 dias.
- INATIVO: mais de 12 meses sem atendimento; cadastro na FASE 1 e mais de 60 dias
  sem ir à FASE 2; consulta inicial na FASE 2 e mais de 90 dias sem ir à FASE 4;
  FASE 4 há mais de 90 dias sem avançar à FASE 5; FASE 5 e FASE 6 sem agendamento
  há mais de 90 dias e sem agendamento futuro; FASE 7 sem atividade há mais de 12
  meses.

Onde: Unidade. Responsável: Coordenador. Participam: Recepcionista e Coordenador.
Pilar: **Prevenção** (automático, se não definido pelo Planner, para ativos na
FASE 7).
**Gatilho:** "Necessita de Reavaliação?" — SIM → FASE 7 → FASE 6 (após
agendamento e check-in); NÃO → FASE 7 → FASE 5 (após agendamento e check-in).

---

## Funções por ambiente

### FRANQUEADORA
(usuários da franqueadora não precisam acessar o ambiente das unidades, mas
acessam Jornada, Agenda, Financeiro e fichas dos clientes das unidades às quais
cada usuário está relacionado.)
- **Admin Master** — acesso a tudo; define as Metas, envia aos gerentes, aprova
  ou reprova as metas sugeridas pelos gerentes.
- **Encantadora (SDR)** — fase inicial; insere o cliente novo (lead de ações
  comerciais/marketing/redes sociais); cadastra e agenda (FASE 2, ou FASE 5 em
  urgência/emergência).
- **Dentista Planner** — recebe documentos/exames dos Coordenadores; atende
  Coordenadores de várias unidades; elabora o planejamento; solicita aprovação
  dos Coordenadores.
- **Consultor Comercial** — recebe o planejamento; faz as apresentações
  (agendadas pelas recepcionistas); atende clientes de várias unidades.
- **Assistente Comercial** — apoia consultores e unidades no envio de documentos
  para assinatura e links de pagamento; acompanha documentos e pagamentos.

### UNIDADE FRANQUEADA
- **Recepcionista** — fase inicial (quando o cliente procura a clínica direto);
  faz agendamentos em todas as fases que exigem, check-in/check-out; cadastra
  clientes.
- **Coordenador Clínico** — responsável técnico; faz avaliações e reavaliações;
  garante metodologia e qualidade; no controle de qualidade pode devolver o
  cliente ao Dentista para refazer procedimento ou indicar outro Dentista.
- **Dentista** — executa os procedimentos planejados e fechados; acessa fichas e
  jornada dos clientes agendados com ele; acessa a agenda; não agenda; vê só os
  próprios agendamentos.
- **Gerente de Unidade** — acessa todas as telas da unidade, usuários da unidade
  e dados da clínica; acompanha indicadores; aprova as metas da Franqueadora ou
  reprova com justificativa e propõe novas metas.
- **TSB (Técnica em Saúde Bucal)** — acessa fichas dos clientes com agendamento,
  jornada (visualização), agenda (não agenda); executa procedimentos específicos
  com autorização do Coordenador.
- **ASB (Auxiliar em Saúde Bucal)** — acessa fichas dos clientes com agendamento
  na sua unidade, jornada (visualização), agenda (não agenda); não executa
  procedimentos.

**Todos devem seguir o fluxo da Jornada do Cliente Risarte.**
