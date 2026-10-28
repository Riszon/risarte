# Ortodontia — plano e desenho do módulo

**Pedido do dono (27/10/2026):** *"Precisamos criar o módulo de ortodontia…
acompanhar melhor todos os clientes que estão em tratamento ortodôntico na
clínica… quantidade, evolução por unidade, novos, finalizados, no prazo,
atrasados, faltantes, previsão de finalização… linha de receita própria na DRE…
o cliente paga mensalidade (não é procedimento)… o ortodontista recebe por
manutenção realizada… os acordos vão na proposta e no contrato… acesso por
função (Gerente, Recepção, Coordenador, Admin, Franqueadora)."*

> **Em uma frase:** cada paciente de ortodontia vira um **caso** com
> cronograma de manutenções, mensalidade e situação; o sistema mostra, por
> unidade e para a rede, quem está no prazo, quem atrasou, quem faltou, quem
> precisa de agendamento e quanto a ortodontia rende — e cada manutenção
> realizada gera o repasse do ortodontista sozinha.

Faixa de migração: **core (0329)**. Rotas: `/ortodontia/*`. Código:
`src/lib/ortodontia/`. Interface em pt-BR; identificadores em inglês.

---

## 1. O que existe hoje (conferido no código, 27/10/2026)

| Assunto | Hoje | O furo |
|---|---|---|
| Especialidade | `specialties` tem "Ortodontia"; os procedimentos e os Risartanos guardam o nome | Nada **agrupa** os pacientes de ortodontia nem os acompanha ao longo dos meses |
| Procedimento | O plano lança um procedimento com N sessões, preço fechado e repasse por sessão | A ortodontia **não é** um procedimento com preço fechado: é um **tratamento de meses** com **mensalidade** |
| Repasse | `provider_payouts` nasce quando a **sessão do plano** é concluída (`treatment_sessions`) | A manutenção ortodôntica não é sessão do plano: o ortodontista **não recebia** pelo sistema |
| DRE | Plano de contas tem `1.2.01 PPR+ — mensalidades` | **Não havia conta de ortodontia**; e a mensalidade do PPR+ **não é lançada** no razão (achado — ver BACKLOG) |
| Agenda | A recepção agenda sessões e retornos; falta e conclusão ficam no agendamento | Nada liga o agendamento à **manutenção prevista** do cronograma |
| Metas | Modelo "Ortodontia no trimestre" conta **procedimentos** de Ortodontia | Sem caso, não há como medir pacientes em tratamento, atrasados ou finalizados |

---

## 2. O desenho

### 2.1. O caso ortodôntico (`ortho_cases`)

Um caso = um paciente, numa unidade, com um ortodontista responsável.
Código **ORT-000001**. Campos que importam:

- **Tipo:** aparelho fixo, alinhadores, aparelho removível, contenção, outro.
- **Situação:** `aguardando_inicio` → `em_tratamento` → `contencao` (**= contenções
  entregues: tratamento finalizado, em acompanhamento**, O1/0331) →
  `finalizado` (**alta**); ou `interrompido` (desistência, transferência,
  abandono). Só **um caso aberto por paciente** (índice parcial; `contencao`
  ainda conta como aberto — o paciente segue "em ortodontia" sem mensalidade).
- **Contenção (O1):** `retainer_charged`, `retainer_fee_cents`,
  `retainer_terms` (cópia da configuração ao abrir), `retainer_delivered_at`
  (= `finished_at`), `discharged_at` (alta). `ortho_deliver_retainers` faz a
  entrega.
- **Faltas (O3):** `extension_days` = faltas × intervalo, mantido pelo gatilho
  `ortho_maintenances_extension`; `planned_end_date` já o soma.
- **Cronograma:** data de início, **meses previstos**, **data prevista de
  término** (= início + meses), **intervalo das manutenções** (padrão 30 dias),
  próxima **reavaliação** (padrão a cada 6 meses).
- **Dinheiro:** **mensalidade** (centavos), dia de cobrança, valor de
  instalação/entrada (informativo — a instalação segue pelo plano/venda).
- **Repasse:** o **procedimento de manutenção** (do catálogo) que define o
  valor do repasse pela tabela de repasse já existente (`payout_rate_for`).
- **Elos opcionais:** negociação/venda do Comercial (quando o caso nasce de um
  plano vendido) e o plano de tratamento.

### 2.2. As manutenções (`ortho_maintenances`)

Ao **iniciar** o caso, o sistema gera o cronograma: uma manutenção prevista a
cada intervalo, do início até o término previsto (`ortho_plan_maintenances`,
idempotente — só acrescenta o que falta). Cada uma tem situação `prevista` →
`agendada` → `realizada` | `faltou` | `cancelada`.

**A agenda liga sozinha.** Um agendamento do paciente **com o ortodontista do
caso** (sessão, início de tratamento ou retorno) é ligado à manutenção
prevista mais próxima (±45 dias) — ou cria uma manutenção extra. Concluir o
atendimento marca **realizada**; falta marca **faltou**; cancelar devolve a
`prevista`. A recepção não precisa aprender nada novo: agenda como sempre.

**A evolução** (fio/arco, observações, próximo passo) é registrada pelo
ortodontista ou pelo Coordenador na manutenção — e vale também para registrar
uma manutenção feita sem agendamento (`ortho_register_maintenance`).

**O repasse** nasce quando a manutenção vira `realizada`: uma linha em
`provider_payouts` (a mesma tabela do Repasse), com o valor da tabela de
repasse para o procedimento de manutenção e o ortodontista. `session_id` passou
a aceitar nulo; a linha aponta para `ortho_maintenance_id` (uma das duas,
nunca as duas). O fechamento mensal do repasse **não muda**.

### 2.3. A mensalidade (`ortho_charges`)

Uma cobrança por caso por mês de competência, gerada pela tela de
Mensalidades (como o PPR+). **É devida independentemente do comparecimento** —
regra do dono, escrita na proposta e no contrato. Situações: `em_aberto`,
`paga`, `atrasada`, `cancelada`. Finalizar ou interromper o caso cancela as
cobranças dos meses **seguintes**.

**Razão:** cada cobrança é **um lançamento** na conta nova
**`1.1.04 Ortodontia — mensalidades`** (receita de serviços clínicos):
nasce `open` na competência do mês (DRE); a baixa põe `cash_date` e `settled`
(fluxo de caixa realizado); desfazer a baixa volta a `open`; cancelar vira
`cancelled`. Um lançamento só, para a DRE contar uma vez — a separação
competência/caixa das parcelas (duas linhas) existe para a baixa parcial, que a
mensalidade não tem.

Limites conhecidos (v1): a mensalidade em aberto **não entra na projeção** do
fluxo de caixa (ela lê parcelas e contas a pagar) nem na conciliação bancária.

### 2.4. Configuração em cascata (`ortho_settings`)

Padrão da rede (`clinic_id` nulo) + ajuste por unidade: mensalidade padrão,
meses previstos, intervalo das manutenções, meses até a reavaliação, dias de
tolerância do prazo, procedimento de manutenção, dia de cobrança. O Admin
edita a rede; o Gerente edita a própria unidade.

### 2.5. O que as telas respondem

| Tela | Para quem | Responde |
|---|---|---|
| `/ortodontia` (Painel) | Gerente, Coordenador, Franqueado, Franqueadora, Admin | Quantos em tratamento, novos, finalizados, **no prazo × atrasados**, faltas, sem agendamento, previsão de término (3/6/12 meses), receita das mensalidades, inadimplência, **de onde vêm** os pacientes (Indica, Riso+, Empresarial, indicação direta), evolução mês a mês, e **por unidade** para a rede |
| `/ortodontia/atencao` | Recepção (a tela dela), e todos | Quem **precisa de ação**: sem próximo agendamento, manutenção vencida, faltou na última, reavaliação vencida, pedido clínico aberto, término atrasado — e, para quem vê dinheiro, mensalidade atrasada |
| `/ortodontia/casos` | Todos do módulo | A lista, com busca e filtros (situação, ortodontista) |
| `/ortodontia/casos/novo` | Gerente, Coordenador, Admin | Abrir o caso (paciente, ortodontista, tipo, cronograma, mensalidade) |
| `/ortodontia/casos/[id]` | Todos do módulo (o dentista só os seus) | A ficha: cronograma de manutenções com evolução, situação financeira, indicações do paciente, histórico, ações (iniciar, contenção, finalizar, interromper, registrar manutenção, vincular agendamento) |
| `/ortodontia/casos/[id]/contrato` | Quem gere e quem fecha | O **termo do tratamento ortodôntico** para imprimir/PDF, com as cláusulas da mensalidade |
| `/ortodontia/mensalidades` | Quem vê dinheiro | Gerar o mês, dar baixa, marcar atrasadas |
| `/ortodontia/configuracao` | Admin (rede) e Gerente (unidade) | A cascata |

**No prontuário:** selo e cartão "Ortodontia" com situação, próxima
manutenção e atalho para a ficha do caso. **No orçamento impresso** (proposta):
quando a opção tem procedimento de Ortodontia, sai o bloco **Condições do
tratamento ortodôntico** (mensalidade, prazo, manutenções, a regra do
comparecimento) — do caso, se já existir, senão da configuração da unidade.

### 2.6. Acesso (matriz de permissões, 0246)

| Capacidade | Padrão | O que abre |
|---|---|---|
| `modulo.ortodontia` | Gerente, Coordenador, Recepção, Franqueado, Franqueadora/Rede, Dentista, Financeiro da Franqueadora | O menu e a lista de casos (o dentista só vê os casos em que é o ortodontista) |
| `modulo.ortodontia.painel` | Gerente, Coordenador, Franqueado, Franqueadora/Rede, Financeiro da Franqueadora | O Painel com os números (a Recepção cai na tela Atenção) |
| `acao.ortodontia.gerir` | Gerente, Coordenador | Abrir, editar, iniciar, finalizar, interromper o caso; configurar a unidade (Gerente) |
| `acao.ortodontia.evoluir` | Dentista, Coordenador | Registrar a manutenção e a evolução |
| `acao.ortodontia.financeiro` | Gerente, Recepção, Franqueado, Franqueadora/Rede, Financeiro da Franqueadora | Ver mensalidades e dar baixa |

O Admin passa por cima de tudo. A **barreira real** é o banco: as funções
conferem o papel (`ortho_can_manage`, `ortho_can_settle`, …) e as regras de
linha deixam ler só quem é da unidade (ou da rede).

> ✅ Decidido (O2, 28/10/2026, 0331): a baixa é do **Gerente** e do
> **Financeiro da Franqueadora** (`acao.ortodontia.financeiro`: `unit_manager`,
> `franchisor_staff`, `finance_franchisor`). A Recepção e o Franqueado **veem**
> a situação financeira (`canViewOrthoMoney`), sem dar baixa.

---

## 3. Ordem de construção

| Fase | Entrega |
|---|---|
| **ORTO1** ✅ | Fundação: migração 0329 (tabelas, RLS, funções, razão, repasse, conta 1.1.04, permissões); regras puras + testes; Painel, Atenção, Casos (lista, novo, ficha, termo), Mensalidades, Configuração; selo no prontuário; bloco na proposta; menu; manual; novidades |
| **ORTO1b** ✅ | Decisões O1/O2/O3 do dono (28/10/2026, migração 0331, v0.363.0): entrega das contenções finaliza + acompanhamento + contenção cobrável; baixa do Gerente e do Financeiro; faltas prorrogam o término + assiduidade; termo atualizado |
| **ORTO6** ✅ | A tela do ortodontista (28/10/2026, migração 0332, v0.364.0; §5.3): dinheiro do caso em `ortho_case_terms` lido só por quem vê dinheiro (Coordenador entra — Q8; Dentista fora — R13); evolução espelhada no Desenvolvimento Clínico com adendo (R11); alertas da anamnese e atalhos na ficha (R12). Achado e corrigido: concluir manutenção sem procedimento quebrava |
| **ORTO7** ✅ | Do clínico ao plano (28/10/2026, migração 0333, v0.365.0; §5.3): indicação do Coordenador na rodada da avaliação (`clinical_evaluations.ortho_*`); `treatment_plan_ortho` por opção (Planner define, aprova com a opção, tranca com o plano); termo com prazo como referência e "quem inicia"; Q3 (dentista da instalação assume) e troca do responsável no histórico; o caso pela venda herda a proposta |
| **ORTO2** | Avisos no sino: manutenção vencida sem agendamento, faltou, reavaliação vencida, mensalidade atrasada — **a rotina diária já existe** (`ortho_daily_alerts`, 0335): falta acrescentar estes avisos nela |
| **ORTO3** | Indicadores de Metas: pacientes em tratamento, novos casos, finalizados no prazo, receita de ortodontia (recorte do `1.1.04`) — e o modelo pronto "Meta de Ortodontia" passa a usar o caso |
| **ORTO4** | Cobrança recorrente da mensalidade pelo ASAAS (junto com o lote das integrações) e a mensalidade em aberto na projeção do fluxo de caixa |
| **ORTO5** ✅ | Absorvido pelo ORTO8 (0334): o caso nasce no fechamento da venda (`_ortho_open_from_sale`); a lista "vendas sem caso" do Painel fica para as vendas fechadas antes da 0.366.0 |
| **ORTO8** ✅ | Do Comercial ao caso (28/10/2026, migração 0334, v0.366.0; §5.3): acordo ortodôntico na negociação (`plan_negotiation_ortho`) com limites (Q4) na regra comercial; o caso nasce no fechamento; "Novo caso" saiu, caso legado com porta do Admin (Q1); avisos e "aguardando início com/sem horário" no Painel, Atenção e Início |
| **ORTO9** ✅ | Mensalidades por lote (28/10/2026, migração 0335, v0.367.0; §5.3): lote de N ao iniciar; rotina diária 60/30/15/vencido; renovar/não renovar; pontualidade na baixa; reajuste anual; suspenso; termo. Fecha o pedido R1–R13 |

---

## 4. Decisões para o dono conferir

| # | Pergunta | O que foi feito |
|---|---|---|
| **O1** | A mensalidade é cobrada enquanto o caso está em **contenção**? | **Decidido pelo dono em 28/10/2026 (0331):** a mensalidade é cobrada **até a entrega das contenções**. A entrega **finaliza o tratamento** (`finished_at` = data da entrega) e o caso passa a **acompanhamento** (`contencao` ganhou este sentido). A contenção **pode ser cobrada**: liga/desliga, valor e condição especial na configuração (rede → unidade), copiados para o caso ao abrir; ao entregar nasce uma `ortho_charges` de `kind = 'contencao'`, na mesma conta 1.1.04 (renomeada "Ortodontia — mensalidades e contenções"). Tudo escrito no termo. |
| **O2** | Quem recebe a mensalidade na unidade? | **Decidido pelo dono em 28/10/2026 (0331):** **Gerente da unidade e Financeiro** (da Franqueadora), além do Admin e da Franqueadora/Rede. A Recepção **só vê** a situação do paciente (ficha, Atenção, Mensalidades sem botões). Recepção e Franqueado saíram da guarda `ortho_can_settle` e da matriz. |
| **O3** | "Atrasado" = passou da data prevista de término + tolerância (30 dias, configurável) e ainda `em_tratamento`. | **Mantido pelo dono em 28/10/2026 (0331)**, com dois acréscimos: **cada falta prorroga o término previsto em um intervalo de manutenção** (`extension_days` = faltas × intervalo, por gatilho; o cronograma ganha a vaga no fim) e as telas mostram a **assiduidade** (realizadas ÷ realizadas + faltas) ao lado de "em tratamento"/"atrasado". No termo. |
| **O4** | Falta = agendamento com o ortodontista marcado como **não compareceu**; manutenção **vencida** = prevista há mais de 7 dias sem agendamento. | Sim; os 7 dias são regra escrita (`regras.ts`). |
| **O5** | O repasse do ortodontista usa a **tabela de repasse** do procedimento de manutenção (por nível ou individual). Sem tabela, registra **zero** para alguém perceber — a mesma regra do repasse por sessão. | Sim. |
| **O6** | A instalação do aparelho (valor de entrada) segue pelo plano/venda normal, em `1.1.01`; só a **mensalidade** vai para `1.1.04`. | Sim. |

---

## 5. Pedido de 28/10/2026 — a ortodontia entra pelo fluxo normal (ORTO6 a ORTO9)

**O que o dono pediu** (resumido em regras numeradas; o texto original está no
histórico da sessão de 28/10/2026):

| # | Regra |
|---|---|
| R1 | A mensalidade tem **desconto por pontualidade**, configurável. |
| R2 | Quem **fecha a venda** do tratamento ortodôntico é o **Consultor Comercial**, pelo fluxo normal do Comercial. Na clínica só se **confere se o cliente está em dia**. |
| R3 | O **Coordenador** pode **indicar/sugerir** ortodontia na avaliação ou reavaliação. O **Dentista Planner** indica no planejamento. O **Coordenador aprova ou reprova**. Aprovado, o Planner **envia ao Comercial**; o Consultor apresenta e vende. Só com **contrato assinado e pagamento definido** o cliente está pronto para iniciar. |
| R4 | O botão **"Novo caso" não pode existir** (abre caso sem passar pelo Comercial). Fechou a venda: **avisos** de "caso de ortodontia fechado" e de **solicitação de agendamento**; o **Painel** mostra quem **aguarda iniciar** e se **tem ou não horário agendado**. |
| R5 | **Quem define o quê:** o Planner define as características (previsão de tempo, tipo de aparelho, contenção final); o Coordenador aprova/reprova; o Consultor ajusta o **acordo comercial** (preço, cobra ou não a contenção, descontos, forma de pagamento) **dentro dos limites de negociação**. |
| R6 | O **prazo é uma referência**, não um compromisso da clínica — claro no termo. |
| R7 | **Emissão das mensalidades:** pix recorrente, débito recorrente, crédito recorrente, cartão de crédito parcelado, boleto ou **à vista de um período**. |
| R8 | Definidas N mensalidades (ex.: 12): aviso a **60 dias** do fim, mais forte a **30** e a **15**, para **emitir novas mensalidades** ou declarar que **não será necessário** (finalizando). |
| R9 | **No termo:** serão emitidas X mensalidades; novas serão emitidas se necessário; **reajuste anual**; se o cliente **não assumir** as próximas, o tratamento é **suspenso** e pode ser **cancelado**. |
| R10 | O termo fala de quem **inicia** o tratamento; ao longo dele o paciente pode ser atendido por **outro especialista** da equipe (o responsável pode sair da Risarte). |
| R11 | A **evolução** registrada pelo ortodontista vai **também para o Desenvolvimento Clínico**. |
| R12 | **Alertas importantes do prontuário** aparecem na tela do ortodontista; **botão de fácil acesso** aos planos de tratamento e ao desenvolvimento clínico do paciente. |
| R13 | O **ortodontista não vê valores** (mensalidade nem qualquer valor pago). |

### 5.1. O que existe hoje para cada regra (conferido no código, 28/10/2026)

| Regra | Hoje | O furo |
|---|---|---|
| R1 | Desconto por pontualidade existe só nas **taxas da rede** (`network_fees.punctuality_discount_percent`); para paciente existe o inverso (perda do benefício no atraso, 0188) | Nada na mensalidade ortodôntica |
| R2, R4 | A venda é `plan_negotiations` → `commercial_sales` (contrato assinado **e** pagamento confirmado = fechado, `commercial_close_step`); o fechamento já avisa a Recepção ("FECHAMENTO! Iniciar tratamento", pop-up), o Coordenador e o Gerente. O caso ortodôntico **não nasce** no fechamento: o Painel lista "vendas sem caso" e o Gerente/Coordenador abre pelo botão **Novo caso** | O caso nasce fora do Comercial; não há aviso próprio da ortodontia; o Painel não diz se a instalação está agendada |
| R3 | A avaliação (`clinical_evaluations`, Coordenador) **não tem** campo de indicação/encaminhamento; o odontograma tem os códigos `RZ-APARELHO`/`RZ-CONTENCAO`. O plano (`treatment_plans`, Planner) é aprovado **por opção** pelo Coordenador (`review_plan_option`); o Planner move 3→4 e os Consultores são avisados. Ortodontia no plano = **procedimento com especialidade "Ortodontia"** (detecção por texto) | Não há "indicação de ortodontia" na avaliação; o plano não tem as **características do caso** (meses, aparelho, contenção) |
| R5 | A negociação tem desconto, parcelas, forma, entrada, **regras** (`commercial_rules`: desconto máximo, parcelas, formas, mínimos) e **autorização do Gerente** fora da regra | A negociação não tem os **termos da ortodontia** (mensalidade, nº de mensalidades, contenção, pontualidade, forma de emissão) nem limites para eles |
| R6, R9, R10 | O termo (`orthoClauses`) fala do prazo, do ortodontista responsável e da mensalidade até a entrega | Faltam: prazo como referência; "quem inicia"; X mensalidades + renovação; reajuste anual; suspensão/cancelamento |
| R7 | `ortho_charges.payment_method`: pix, boleto, cartão, crédito recorrente, dinheiro; geração **mês a mês** pela tela; sem ASAAS (ORTO4) | Sem débito recorrente, sem "cartão parcelado"/"à vista do período", sem o conceito de **lote de N mensalidades** |
| R8 | Nenhum aviso "vencendo em X dias" no sistema; a rotina diária por unidade existe como padrão (`check_finance_alerts`, cron) | Nada para o fim do lote |
| R9 (suspensão) | Situações: aguardando início, em tratamento, em acompanhamento, alta, interrompido | **Não há "suspenso"** |
| R11 | Evolução fica em `ortho_maintenances` (fio/arco, observações, próximo passo); o Desenvolvimento Clínico é `clinical_progress_notes` (uma por agendamento, trava ao concluir, adendo depois) | Separados |
| R12 | Alertas da anamnese (`AlertasDaAnamnese`) aparecem no prontuário e no cockpit do Planner; o prontuário tem abas (`?aba=`) | Não aparecem nas telas da ortodontia; não há atalhos |
| R13 | O dinheiro é escondido **só na tela** (`canViewOrthoMoney`); o banco deixa o dentista ler `ortho_cases.monthly_fee_cents` e `ortho_charges`; o **selo do prontuário** mostra a mensalidade a todo mundo | Barreira só visual, e com vazamento no selo |

### 5.2. O desenho proposto

**O princípio:** o caso ortodôntico passa a ser **o resultado de uma venda**.
Avaliação → Planejamento (características) → Aprovação do Coordenador →
Comercial (acordo) → Fechamento (contrato + pagamento) → **o caso nasce sozinho**
em "aguardando início" → Agenda da instalação → Tratamento.

1. **Indicação na avaliação (R3).** Na avaliação e na reavaliação, o
   Coordenador marca **"Indicar ortodontia"** com uma observação
   (`clinical_evaluations.ortho_indicated`, `ortho_indication_note`). O Planner
   vê a indicação no cockpit dele.
2. **Características do caso no plano (R3, R5).** A opção do plano que tem
   procedimento de Ortodontia ganha o bloco **"Proposta ortodôntica"**
   (`treatment_plan_ortho`, 1 por opção): meses previstos (referência), tipo
   de aparelho, tipo de contenção final, intervalo das manutenções,
   observações. Preenchido pelo Planner; **aprovado junto com a opção** pelo
   Coordenador (nada novo para ele aprender); vai para o Comercial com o plano.
3. **Acordo comercial (R1, R5, R7).** Na negociação, quando a opção tem a
   proposta ortodôntica, o Consultor preenche **"Condições da ortodontia"**
   (`plan_negotiations` ganha o bloco): mensalidade, **quantas mensalidades**
   neste lote, **forma de emissão** (pix/débito/crédito recorrente, cartão
   parcelado, boleto, à vista do período), **desconto por pontualidade (%)**,
   **cobra a contenção?** e valor, dia de cobrança. Os padrões vêm da
   configuração da ortodontia (rede → unidade). **Limites** (R5): desconto
   máximo e formas permitidas são os **mesmos da regra comercial** da unidade;
   a configuração da ortodontia ganha **mensalidade mínima** e **pontualidade
   máxima**. Fora do limite → `aguardando_autorizacao` e o **Gerente
   autoriza**, exatamente como hoje.
4. **O caso nasce no fechamento (R2, R4).** `commercial_close_step`, ao fechar
   (assinado + pagamento confirmado) uma venda com proposta ortodôntica, cria o
   `ortho_cases` em `aguardando_inicio` com tudo copiado (plano, negociação,
   características, acordo). O botão **"Novo caso" sai** das telas e a função
   `ortho_create_case` **deixa de aceitar** abertura sem venda — salvo o
   caminho **"caso legado"** (ver Q1). Avisos do fechamento: além dos de hoje,
   **"Ortodontia: caso fechado — agendar a instalação"** para Gerente,
   Coordenador e Recepção (o pop-up de agendar já existe e **se apaga sozinho**
   ao marcar o início, 0283/0284).
5. **Painel e Atenção (R4).** Linha **"Aguardando início"** com, por paciente,
   **"instalação em dd/mm"** (há agendamento de início/sessão futuro) ou
   **"sem horário"**. Cartão no **Início** do Gerente/Coordenador/Recepção
   com o número de pacientes aguardando sem horário.
6. **O ortodontista responsável (R10).** `orthodontist_id` passa a aceitar
   vazio até o início; é definido pelo Coordenador/Gerente, ou **assumido do
   dentista do primeiro agendamento** de instalação (ver Q3). Trocar o
   responsável fica no histórico do caso. O termo diz **quem inicia** e que
   outro especialista da equipe pode continuar.
7. **Lotes de mensalidades (R7, R8, R9).** `ortho_billing_batches`: por caso,
   lote nº, quantidade, mês inicial e final, valor, forma de emissão,
   pontualidade, situação (`ativo`, `encerrado`), decisão (`renovar`,
   `nao_renovar`). Ao iniciar o tratamento, o sistema **gera as N cobranças**
   do lote (competência mês a mês, como hoje; a DRE continua certa). "Cartão
   parcelado" e "à vista do período" **quitam o lote de uma vez** na baixa.
   **Rotina diária** por unidade (padrão `check_finance_alerts`): a 60, 30 e
   15 dias do vencimento da última mensalidade do lote **sem decisão**, aviso
   crescente ao Gerente e ao Financeiro ("Ortodontia: lote de mensalidades
   termina em N dias — renovar ou encerrar?"), um por marco (sem repetir). Ações:
   **"Emitir novas mensalidades"** (lote novo; **reajuste** sugerido se passou
   12 meses do início — Q2) ou **"Não será necessário"**.
8. **Suspensão (R9).** Situação nova **`suspenso`**: lote encerrado sem
   renovação e sem alta → Atenção avisa "sem mensalidades assumidas"; o
   **Gerente suspende** (botão; manutenções previstas param) e, se for o caso,
   **interrompe** (cancela). Nunca automático (Q5). Voltar de suspenso =
   lote novo.
9. **Pontualidade na baixa (R1).** `ortho_mark_charge_paid` aplica o desconto
   quando a data do pagamento ≤ vencimento (`paid_amount_cents`), e o
   lançamento do razão (ainda `open`) passa a valer o líquido antes de
   liquidar. A tela mostra "R$ X (com desconto de pontualidade)".
10. **Termo (R6, R9, R10).** Cláusulas novas em `orthoClauses`: prazo como
    referência; quem inicia + possível troca; X mensalidades + novas se
    necessário; reajuste anual; suspensão/cancelamento por não assumir.
    O orçamento impresso ganha o mesmo bloco.
11. **Evolução no Desenvolvimento Clínico (R11).** `ortho_save_evolution` grava
    também uma nota em `clinical_progress_notes` (ligada ao agendamento da
    manutenção e à manutenção: `ortho_maintenance_id`), com o texto "Ortodontia
    — manutenção N: fio/arco…, observações…, próximo passo…". Se a nota daquele
    atendimento já estiver **travada**, entra como **adendo** (regra da 0315).
12. **A tela do ortodontista (R12, R13).** Na ficha do caso: **alertas da
    anamnese** (compacto, o mesmo componente do prontuário) e dois botões:
    **"Planos de tratamento"** e **"Desenvolvimento clínico"** (abas do
    prontuário). **Dinheiro:** os valores saem de `ortho_cases` para uma tabela
    irmã **`ortho_case_terms`** (mensalidade, dia, instalação, contenção,
    pontualidade, lotes) com **regra de linha só para quem vê dinheiro**
    (Gerente, **Coordenador** — Q8 —, Recepção, Franqueado, Financeiro, Rede,
    Admin); a leitura de `ortho_charges` idem. Assim o dentista **não consegue** ler
    valor nem pela API. O selo do prontuário e a lista de casos deixam de
    mostrar valor para quem não vê dinheiro; o termo só abre para quem gere ou
    fecha.

### 5.3. Ordem de construção proposta

| Fase | Entrega | Tamanho |
|---|---|---|
| **ORTO6** ✅ | **A tela do ortodontista** (R11, R12, R13): evolução espelhada no Desenvolvimento Clínico; alertas da anamnese e atalhos na ficha; valores fora do alcance do dentista (tabela irmã + RLS + selo/lista/termo). Migração 0332, v0.364.0 (28/10/2026). | Pequena — entregue |
| **ORTO7** ✅ | **Do clínico ao plano** (R3, R5 parte clínica, R6, R10, Q3): indicação na avaliação/reavaliação; "Proposta ortodôntica" na opção do plano, aprovada com a opção; ortodontista "quem inicia" (assumido do agendamento de instalação; troca no histórico); cláusulas de prazo como referência e responsável no termo; o caso pela venda herda a proposta. Migração 0333, v0.365.0 (28/10/2026). | Média — entregue |
| **ORTO8** ✅ | **Do Comercial ao caso** (R1 config, R2, R4, R5 parte comercial, R7 registro da forma, Q1, Q4): acordo ortodôntico na negociação (`plan_negotiation_ortho`) com limites na regra comercial e autorização do Gerente; o caso nasce no fechamento (`_ortho_open_from_sale`); "Novo caso" saiu, `ortho_create_case` exige venda fechada; caso legado com porta do Admin; avisos (categoria Ortodontia); Painel/Atenção/Início "aguardando início com/sem horário". Migração 0334, v0.366.0 (28/10/2026). **Absorveu o ORTO5.** | Grande — entregue |
| **ORTO9** ✅ | **Mensalidades por lote** (R1 baixa, R7, R8, R9, Q2, Q5, Q6): `ortho_billing_batches`, as N cobranças de uma vez; rotina diária 60/30/15/vencido (`ortho_daily_alerts` + cron); renovar/não renovar; pontualidade na baixa com data; reajuste anual na configuração (sugerido na renovação); situação suspenso; cláusulas no termo. Migração 0335, v0.367.0 (28/10/2026). A rotina é o lugar do ORTO2, que segue pendente. | Grande — entregue |
| ORTO4 (mantido) | A **emissão real** (boleto/pix/recorrência) pelo ASAAS, no lote das integrações. Até lá a forma de emissão fica **registrada** e a cobrança é emitida fora do sistema. | — |

Por que nesta ordem: ORTO6 é pequena e resolve riscos imediatos (vazamento de
valor, evolução fora do prontuário); ORTO7 e ORTO8 seguem o caminho do
paciente (quem indica → quem vende); ORTO9 depende do acordo comercial (quantas
mensalidades, forma) que só existe depois do ORTO8.

### 5.4. Decisões para o dono (28/10/2026)

| # | Pergunta | Proposta (vale se não houver resposta diferente) |
|---|---|---|
| **Q1** | Pacientes que **já estão em tratamento** antes do sistema (sem venda no Comercial): quem cadastra e por onde? | Caminho **"caso legado"**, só para o Gerente/Coordenador, marcado como legado (`origin = 'legado'`), com a data de início real; o Admin pode **fechar essa porta** por unidade quando a transição acabar. Fora disso, não existe abrir caso sem venda. |
| **Q2** | **Reajuste anual:** percentual fixo da rede ou índice (IPCA/IGP-M)? | Percentual configurado pela rede (ajustável por unidade), **sugerido** na renovação do lote depois de 12 meses do início; o Gerente pode alterar na hora. O termo cita "reajuste anual conforme percentual informado". Índice oficial fica para depois (o sistema não acompanha índices). |
| **Q3** | Quem escolhe o **ortodontista responsável** e quando? | O Coordenador ou o Gerente, na ficha, antes da instalação; se ninguém escolher, o **dentista do agendamento de instalação** vira o responsável. O termo assinado no fechamento diz "a ser designado pela clínica" quando ainda não há nome. |
| **Q4** | **Limites** do acordo ortodôntico: reaproveitar a regra comercial? | Sim: desconto máximo e formas permitidas da `commercial_rules` da unidade; a configuração da ortodontia ganha **mensalidade mínima** e **desconto máximo de pontualidade**. Fora do limite → autorização do Gerente (fluxo que já existe). |
| **Q5** | **Suspender** é automático quando o lote acaba sem renovação? | Não. O sistema **avisa** (Atenção + sino) e o **Gerente suspende** e, depois, cancela — com motivo, no histórico. |
| **Q6** | **Desconto por pontualidade:** padrão na configuração (rede → unidade), o Consultor ajusta até o máximo, aplicado na **baixa** quando pago até o vencimento. | Confirmar. |
| **Q7** | A **emissão** (boleto, pix, recorrência) continua **fora do sistema** até o ASAAS (ORTO4)? | Sim: o sistema registra a forma e controla o lote; a cobrança em si é emitida na conta do ASAAS/banco, e a baixa é feita na tela Mensalidades. |
| **Q8** | O **Coordenador** vê valores da ortodontia? | **Decidido pelo dono em 28/10/2026: vê.** Hoje não vê (`canViewOrthoMoney` = Gerente, Recepção, Franqueado, Financeiro, Rede). Na ORTO6 o `clinical_coordinator` entra em `ORTHO_MONEY_VIEW_ROLES` e na regra de linha de `ortho_case_terms`/`ortho_charges` (vê; **não dá baixa** — a baixa segue a O2: Gerente e Financeiro). |
