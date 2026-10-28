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
| **ORTO2** | Avisos no sino: manutenção vencida sem agendamento, faltou, reavaliação vencida, mensalidade atrasada (rotina por unidade, como `notify_treatment_alerts`) |
| **ORTO3** | Indicadores de Metas: pacientes em tratamento, novos casos, finalizados no prazo, receita de ortodontia (recorte do `1.1.04`) — e o modelo pronto "Meta de Ortodontia" passa a usar o caso |
| **ORTO4** | Cobrança recorrente da mensalidade pelo ASAAS (junto com o lote das integrações) e a mensalidade em aberto na projeção do fluxo de caixa |
| **ORTO5** | Abertura automática do caso no fechamento da venda com procedimento de Ortodontia (hoje a tela Casos lista as vendas sem caso e abre com um clique) |

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
