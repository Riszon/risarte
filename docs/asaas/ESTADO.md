# Estado da integração Asaas × riSZon

Documento de quem constrói a integração. A especificação (fonte da verdade,
com as decisões do dono) é `docs/integracao-asaas.md` — hoje na **versão 3**.

- **Tabelas:** `gateway_*` e `central_*`, no schema `public` ·
  **Migrações:** faixa **4000+** ·
  **Versão:** `ASAAS_VERSION` / `ASAAS_MIGRATION` em `src/lib/version.ts`.
- **Tudo em SANDBOX.** Nenhuma chave de produção entra antes da ASA7, e só com
  a aprovação explícita do dono na hora.
- **Branch:** `feat/asaas-integration`, num worktree separado
  (`C:/Users/Administrador/wt-asaas`). Cada fase aprovada entra no `main`,
  escondida atrás de permissão e com a trava de produção desligada.

## Onde estamos

| Fase | Situação | Migrações |
|---|---|---|
| **ASA0 — Fundação** | ✅ **concluída**: aprovada pelo dono e no `main` em 11/11/2026 (core 0.423.0); migrações nos dois bancos; webhook real recebido | **4000, 4001, 4002** |
| **ASA1, entrega 1** — abas Financeiro e Comercial, responsável financeiro, carência zero | ✅ **concluída**: aprovada pelo dono e no `main` em 11/11/2026 (core 0.427.0); 4003 nos dois bancos (produção pelo dono, conferência batida) | **4003** |
| **ASA1, entrega 2** — a cobrança de parcela, as travas e a quitação por valor menor | ✅ **concluída**: aprovada pelo dono e no `main` em 11/11/2026 (core 0.433.0, Asaas 0.3.0); 4004 nos dois bancos (produção pelo dono, conferência batida); testada pelo dono no projeto de teste | **4004** |
| **ASA2, entrega 1** — o aviso do Asaas vira baixa | ✅ **concluída: aprovada pelo dono em 11/11/2026, 4005 rodada na produção e `main` em 12/11/2026** (core 0.435.0, Asaas 0.4.0); 4005 no treino; ensaio 63/63; sandbox de ponta a ponta com Pix, boleto e cartão (pago pelo dono) dando baixa sozinhos; prova do pagamento atrasado ✅ em 12/11 (boleto de R$ 10,00 vencido em 11/11, pago com R$ 10,20 e baixa de R$ 10,20 = 10,00 + multa 0,20); produção conferida com o dono logado (Novidades 0.435.0, campo de arredondamento R$ 0,10 na Central, ficha do paciente sem erro) | **4005** |
| ASA2, entrega 2 — selo "Em atraso" e Painel de cobranças ("A receber do Asaas" e cobranças emitidas) | ✅ **aprovada pelo dono no treino em 12/11/2026** (core 0.437.0, Asaas 0.5.0; spec seção 17); 4006 no treino e na produção (o dono rodou em 12/11/2026; conferência bateu); ensaio 47/47 (provado quebrando o teto); no `main` | **4006** |
| ASA2, entrega 3 — a régua (aba Cobrança e comunicação) e o comprovante | ✅ **na produção (13/11/2026)**: 4007 rodada pelo dono, conferência bateu; main na 0.439.0; prova de envio real no sandbox OK (core 0.439.0, Asaas 0.6.0; spec 17.4 e 17.5); ensaio 78/78 (provado quebrando o D7); prova no sandbox sem envio 17/17; 2º lembrete fixo no dia (D9, aprovado) | **4007** |
| ASA3, entrega 1 — o split na emissão (aba Taxas da franquia) | ✅ **na produção (13/11/2026)**: 4008 rodada pelo dono, conferência bateu; main e produção na 0.440.0; (core 0.440.0, Asaas 0.7.0; spec seção 18); ensaio 51/51 (provado quebrando a conta a pagar); **prova no sandbox OK (13/11)**: Pix, boleto e cartão, 1 centavo por carteira, Asaas arredonda para baixo; ponta a ponta no projeto de teste OK (spec 18.5.1) | **4008** |
| ASA3, entrega 2 — a fila do split, o estorno pelo riSZon, o saldo, o webhook que se corrige e Taxas da franquia na unidade | 🟡 **construída, no treino** (core 0.442.0, Asaas 0.8.0; spec 18.7 a 18.7.7); ensaio 73/73 (provado quebrando); sandbox: fila e webhook OK; falta a prova do estorno de boleto com o celular do dono (aprovação na hora) e o teste do dono | **4009** |

⚠️ **Antes de planejar qualquer fase, ler a seção 13 da especificação**: a
resposta escrita do Asaas (11/11/2026) e o que ficou para cada fase.
- **ASA3:** uma entrada de split por carteira com `percentualValue` e
  `fixedValue` juntos (confirmado). Mostrar ao dono os cálculos da compensação
  nos três casos (tarifa fixa, percentual com mínimo e máximo, boleto pago pelo
  QR Code PIX) e a diferença máxima por meio de pagamento **antes de implementar**.
- **ASA4B:** Pix Automático com jornada sem pagamento inicial e split desde a
  primeira parcela. Cartão recorrente **em aberto**: mandar o objeto
  `creditCard` faria o cartão passar pelo servidor do riSZon, o que é proibido.
- **ASA7:** decidir a lista de IPs autorizados (IP fixo da Vercel: US$ 100/mês
  por projeto, compartilhado). **Nunca** ativar a lista no Asaas sem IP fixo.
- **ASA8:** a nota do paciente no primeiro de `PAYMENT_CONFIRMED` /
  `PAYMENT_RECEIVED` é proposta, a validar com o contador.

## ASA3, entrega 1 — o split na emissão (Asaas 0.7.0, core 0.440.0, 13/11/2026)

### O que existe

- **4008** — `network_fee_types.split_account_id` (destino de cada taxa; vazio
  = conta raiz do mesmo ambiente); `gateway_split_settings` (tolerância S5,
  multa e juros da cobrança à unidade, em branco); `charge_splits` (o enviado
  por carteira, com rateio por taxa, id do Asaas e o **liquidado** do aviso);
  `charges.split_applied/split_skip_reason`; `split_charges.retained_cents` e
  `charge_id`; `refresh_network_fee_payable` soma só o NÃO retido; razão
  `split_retained` (despesa da unidade) e `split_retained_revenue` (receita da
  franqueadora). A taxa da baixa com split JÁ NASCE retida
  (`_split_charge_born_retained`): a conta a pagar nem é criada; o apurado do
  mês mostra "pago no split" (`network_fee_summary.retained_cents`). `_gateway_split_retention` (gatilho na baixa e nos avisos);
  `_gateway_on_split_event` (gatilho em `gateway_webhook_events` ao processar
  `PAYMENT_SPLIT_*`; os guardados antes foram reprocessados). Portas
  `gateway_split_read/save`. S4: `network_fees_sem_pontualidade` (= 0).
- **Servidor:** `src/lib/asaas/split.ts` (puro: tarifa da janela, método B,
  teto, `decidirSplit`); `cobranca.ts` pede o plano (`_charge_split_plan`),
  manda `split` no `POST /payments` e grava com os ids
  (`_charge_save_split`). Split não gravado = cobrança NÃO marcada emitida
  ("Tentar de novo" acha pela referência e grava). Teto estourado = erro
  `split_teto` + aviso.
- **Tela:** Central → Rede → Taxas da franquia (`aba-taxas.tsx`,
  `split-form.tsx`); `/financeiro/taxas-da-rede` redireciona para lá quem
  configura a rede.

### Falta

- ✅ Prova no sandbox (13/11/2026, spec 18.5.1). O split precisa estar
  HABILITADO na conta principal (o dono habilitou no sandbox); sem isso o Asaas
  recusa a cobrança com split. Treino com as taxas iguais às da produção.
- Entrega 2: fila de atualização do split nas cobranças em aberto; estorno
  (D13); bloqueio dentro dos 2 dias úteis. Entrega 3: Painel de repasses.

## ASA2, entrega 3 — a régua de avisos do Asaas e o comprovante (Asaas 0.6.0, core 0.439.0, 12/11/2026)

### O que existe

- **4007** — `gateway_notification_rules` (os 8 avisos da rede, padrão D8),
  `gateway_notification_settings` (a declaração do termo, só o Admin; a
  versão da régua), `gateway_notification_units` (o botão de cada unidade;
  nenhuma nasce ligada), `gateway_notification_optouts` (por CPF, na rede
  toda; desligam Recepção, Gerente, Financeiro, Admin; religam Gerente,
  Financeiro, Admin). Portas `gateway_regua_read/save/declare_privacy/unit_set/
  unit_overview` e `gateway_optout_status/set`. `charges.receipt_url` pelo
  aviso de pagamento (as antigas preenchidas). `central_history(cobranca)`.
- **A FILA** mora em `gateway_customers.regua_*`: gatilhos marcam pendente
  (pagador novo, unidade ligada/desligada, régua, declaração, contato da ficha
  e do responsável, pedido de não receber, conta desativada).
  `_gateway_regua_queue` resolve no banco o que não pede Asaas e devolve o
  resto com o modo (`on`/`off`/`clear`); `_gateway_regua_done` só limpa o
  pendente se nada mudou depois do início da rodada; erro espera 10 min, 40
  min… até 6 h.
- **Servidor:** `src/lib/asaas/regua.ts` (puro: celular, `pacoteDosAvisos`,
  custo) e `regua-servidor.ts` (fila, a régua antes da cobrança nascer, saldo).
  Cron `/api/cron/gateway-regua` a cada 10 min, 50 pagadores por conta, sem
  insistir no 429. Saldo na rotina diária (`GET /finance/balance`) para quem
  tem WhatsApp na régua; zerado avisa Gerente e Admin. Tarifas de aviso
  gravadas na verificação da conta.
- ⚠️ **TRAVA FORA DA PRODUÇÃO (D10):** em conta sandbox, só o contato da lista
  `ASAAS_SANDBOX_CONTATOS_PERMITIDOS` (servidor; começa vazia) vai ao Asaas;
  sem contato permitido, o pagador fica com os avisos desligados. Está em
  `aplicarNoAsaas` (o único ponto que chama `updateCustomer`), para a fila e
  para a emissão. Depois de incluir um contato na lista, é preciso pôr o
  pagador na fila de novo (alterar o contato na ficha, ou desligar e ligar a
  unidade).
- ⚠️ **Canal só com o contato** (provado no sandbox): o Asaas recusa ligar
  e-mail de pagador sem e-mail. E-mail só com e-mail; SMS, WhatsApp e ligação
  só com celular.
- ⚠️ **Prazos reais do Asaas** (medidos no sandbox, 12/11/2026): 1º lembrete
  5/10/15/30; **2º lembrete só 0 (fixo no dia)**; vencida do dia só 0; 2º de
  vencida 1/7/15/30. **D9 (dono, 12/11):** o 2º lembrete fica fixo no dia; o
  banco só aceita 0 e o pacote não manda prazo nele.
- **Apagar o contato (D6):** `email: ""` e `mobilePhone: ""` no
  `PUT /customers/{id}` deixam os dois nulos (provado).

### Provas

- `node scripts/asaas-ensaio-asa2-entrega3.mjs --confirmar` (treino, desfeito): 78/78.
- `node scripts/asaas-prova-regua-sandbox.mjs --confirmar` (sandbox, sem envio:
  pagador sem celular, avisos desligados, e-mail `example.com`, apagado no fim): 17/17.
- `src/lib/__tests__/asaas-asa2-entrega3.test.ts`.

## ASA2, entrega 2 — selo "Em atraso" e Painel de cobranças (Asaas 0.5.0, core 0.437.0, 12/11/2026)

### O que existe

- **4006** — `finance_settings.overdue_badge_business_days` (rede, padrão 3,
  0–15); `overdue_badge_cutoff()` (o último vencimento que já conta como
  atraso hoje; usa `_payout_add_business_days`: fora fim de semana e feriado
  nacional); `client_overdue_badges(ids)` (dias desde o vencimento mais antigo
  em aberto, só das unidades em que quem pergunta pode ver; sem valor).
- **Permissões que o banco lê** (`_gateway_cap_clinics`, como a 0340):
  `acao.cobranca.selo_atraso` (padrão Gerente e Franqueado) e
  `modulo.painel_cobrancas` (padrão vazio = só o Admin). **Teto** em
  `_gateway_cap_ceiling`: o selo nunca alcança dentista, planner, TSB, ASB, SDR;
  o painel só Gerente, Franqueado e Financeiro. O Financeiro da Franqueadora vê
  a rede inteira; papel da franqueadora alcança as unidades do escopo
  (`user_full_access_clinic_ids`).
- **Painel:** `gateway_receivables_due(unidade)` (pagas e não liquidadas) e
  `gateway_charges_list(...)`; com `p_export` a leitura grava em `audit_logs`
  (`export`, `gateway_charges_panel`, com os filtros). Tela
  `financeiro/cobrancas` e planilha `financeiro/cobrancas/planilha`.
- **`charges.fee_cents` e `net_cents`**, gravados pelo gatilho
  `gateway_webhook_events_store_net` quando o aviso de pagamento é processado;
  as antigas preenchidas pela 4006.
- **Código:** `src/lib/finance/selo-atraso.ts` (corte, selos, `podeVerPainelDeCobrancas`),
  `src/components/selo-em-atraso.tsx`, `src/lib/finance/painel-cobrancas.ts`
  (agenda, filtros, planilha — puro e testado).

### Regras que quem mexer aqui precisa saber

- ⚠️ **"Em atraso" não se calcula no código:** pergunte `overdue_badge_cutoff()`.
  Multa e juros continuam desde o vencimento (`daysLate`), só o "atraso" do
  selo e dos avisos muda.
- ⚠️ **Não repita lista de papéis do selo no código:** o banco devolve vazio a
  quem não pode. Mudou o teto, mude `_gateway_cap_ceiling` e o teste.
- ⚠️ **Cartão parcelado no "A receber"** entra na ASA4, quando for provado se
  cada parcela do cartão traz a própria data prevista (16.8.1).

## ASA2, entrega 1 — o aviso do Asaas vira baixa (Asaas 0.4.0, core 0.435.0, 11/11/2026)

### O que existe

- **4005** — o aviso gravado pelo webhook é processado por
  `_gateway_process_event` (tenta, grava o resultado ou o erro; nunca levanta
  erro), `_gateway_apply_event` (o que cada aviso faz, seção 16.2) e
  `_gateway_on_paid` (D21 → baixa → taxa real → situação). Funções internas,
  todas só da chave de serviço: `_gateway_confirm_sale`, `_gateway_receipt`,
  `_gateway_apply_fee`, `_gateway_reverse_receipt`, `_gateway_bank_account`,
  `_gateway_notify`, `_gateway_process_pending`, `_gateway_overdue_summary`.
  Portas: `gateway_reprocess_event` (Admin), `gateway_surplus_apply` e
  `gateway_surplus_mark_refunded` (Gerente, Financeiro, Admin),
  `network_fee_waive_after_refund` (Financeiro, Admin).
- **Tabelas e colunas:** `gateway_payment_surpluses` (duplicidade);
  `payment_waivers.kind` (`dispensa` | `arredondamento`, este sem autor);
  `split_charges.kept_after_refund` e `waived_*`; `bank_accounts.gateway_account_id`
  (a conta "Asaas"); `charges.fine_cents`, `paid_cents`, `paid_on`,
  `credit_date`, `receipt_id`; `gateway_webhook_events.attempts`, `charge_id`,
  `result`; `*.payment_confirmed_source`; `finance_settings.gateway_rounding_tolerance_cents`.
- **`apply_receipt_split` recriada** (núcleo): não desfaz a taxa da rede
  mantida no estorno pelo Asaas (D13).
- **Emissão:** multa em reais (`fine` FIXED) e juros proporcionais ao valor
  cheio, calculados em `_charge_compute`.
- **Webhook** processa os pendentes da conta depois de gravar e sempre
  responde 200. **Rotina diária** (`rodarRotinaDosAvisos`): pendentes,
  resumo das vencidas e fila pausada (`interrupted`).

### Regras que quem mexer aqui precisa saber

- ⚠️ **A baixa do aviso não passa por `register_payment_receipt`** (que exige
  pessoa logada): `_gateway_receipt` repete a mesma regra. Mudou a regra de
  abatimento? Mude nas duas.
- ⚠️ **A trava da baixa manual é contornada só por `risarte.baixa_do_asaas`**,
  ligada dentro de `_gateway_receipt` e `_gateway_reverse_receipt`.
- ✅ **O valor pago vem de `payment.value`** do aviso — **provado em 12/11/2026**:
  no pagamento atrasado, `value` traz o total com multa e juros (10,20),
  `originalValue` o valor da emissão (10,00) e `interestValue` multa + juros
  somados (0,20).
- ⚠️ **Reaplicar a 4004 depois da 4005 quebra** (as funções de emissão mudaram
  de formato): o ensaio da ASA1 entrega 2 só confere a 4004 quando a 4005 já
  está no banco.

## ASA1, entrega 2 — a cobrança de parcela (Asaas 0.3.0, core 0.433.0, 11/11/2026)

### O que existe

- **4004** — `charges` (o `id` é o `externalReference` no Asaas; nasce com as
  origens e meios das próximas fases, recusados por regra na ASA1; UMA ativa
  por parcela pelo índice `charges_one_active_per_installment`; nunca apagada),
  `gateway_customers` (o pagador no Asaas por CONTA e CPF), `payment_waivers`
  (a dispensa: valor por natureza, autor, motivo; imutável),
  `finance_settings.overdue_reissue_max_days` (rede, padrão 7, 0–30).
  `installment_balance` passa a descontar a dispensa do que FALTA ("pago"
  continua sendo só o dinheiro que entrou; quitada com dispensa não corre mais
  juros). Portas: `charge_preview`, `charge_prepare`, `charge_retry_prepare`,
  `charge_cancel_check` (`cancel` / `counter`), `charge_mark_external` /
  `charge_unmark_external`, `register_payment_with_waiver`. Do servidor (só
  chave de serviço): `_charge_compute` (a conta, a mesma da prévia e da
  gravação), `_charge_for_gateway`, `_gateway_customer_save`,
  `_charge_mark_issued` / `_error` / `_cancelled`. Travas:
  `payment_installments_charge_lock` (valor, vencimento, benefício, multa,
  juros, meio, cliente, cancelar/renegociar, apagar) e
  `payment_receipts_charge_lock` (sem baixa manual com cobrança do Asaas
  ativa; a externa continua manual; a ASA2 libera a baixa dela com
  `set local risarte.baixa_do_asaas = '1'`). `_cpf_ok` confere os dígitos.
- **Servidor** (`src/lib/asaas/cobranca.ts`): `emitirNoAsaas` consulta o Asaas
  pela referência ANTES de criar (e de novo se o POST esgotar o tempo — nunca
  repete às cegas), acha o pagador pelo CPF ou cria (só nome + CPF,
  `notificationDisabled`), cria a cobrança com multa/juros/desconto sempre
  explícitos, lê o Pix ou a linha digitável. `cancelarNoAsaas` recusa a
  cobrança paga no Asaas e só grava depois de o Asaas confirmar. Endpoints em
  `api.ts`; o Asaas de mentira (`fake.ts`) guarda clientes e cobranças na memória.
- **Tela** (ficha › Financeiro): `cobranca-da-parcela.tsx` +
  `cobranca-actions.ts` (a permissão da tela `acao.cobranca.*` e a porta do
  banco em toda ação); a quitação por valor menor no **Registrar
  recebimento** (`registerReceipt` com `waiverReason`); o limite de dias na
  aba Financeiro da rede. Textos puros em `src/lib/cobrancas.ts`.

### Provas

- Ensaio no treino em transação desfeita **91/91**
  (`scripts/asaas-ensaio-asa1-entrega2.mjs --confirmar`), provado quebrando
  (sem a trava da baixa e sem congelar os juros na dispensa: 2 falhas).
- Prova real no sandbox (`npm run test:asaas`): cobrança Pix em nome da mãe
  (responsável financeira de um menor), uma só no Asaas pela referência,
  paga pelo sandbox; boleto com linha digitável cancelado por "recebeu no
  balcão"; a paga não se cancela; vencida reemitida em 3 dias com o valor
  atualizado e sem multa nova. Dados de TESTE ficaram no treino ("Teste
  Asaas ASA1 Paciente"); Londrina (sandbox) ficou com termo, split declarado e
  marcada como pronta.
- Régua `asaas-asa1-entrega2.test.ts` (20; inclui o tempo esgotado na emissão, de ponta a ponta com o Asaas de mentira): o corpo enviado ao Asaas, o tempo
  esgotado que não repete, o Asaas de mentira, as mensagens de todos os códigos
  do banco, nenhuma tela com campo de cartão, criar/cancelar só de `cobranca.ts`.
- Telas no servidor local: a ficha com a cobrança paga pela mãe, Link/Pix/
  WhatsApp, "Recebeu no balcão", "Dar baixa" escondido com cobrança ativa; o
  campo novo na aba Financeiro da rede.

### Regras que quem mexer aqui precisa saber

- ⚠️ **A conta do valor mora em `_charge_compute`** — a prévia e a gravação
  usam a mesma. Mudar regra de valor é lá.
- ⚠️ **Situação ativa = `emitindo`, `emitida`, `vencida`, `erro_emissao`,
  `externa`** — a mesma lista no índice, nas travas e em `SITUACOES_ATIVAS`
  (régua).
- ⚠️ **Código de recusa novo no banco precisa de mensagem em
  `src/lib/cobrancas.ts`** (régua).
- ⚠️ **A baixa vinda do Asaas (ASA2) liga `risarte.baixa_do_asaas`** na
  transação, senão a trava recusa.
- Achado do núcleo (fechar venda direta falhava desde a 0373) corrigido em
  outra sessão (core 0.431.0, migração 0399). O ensaio continua criando a
  venda já fechada sem os gatilhos (não é o que ele mede).
- A tela diz por que a parcela não oferece cobrança (`motivoSemCobranca` em
  `src/lib/cobrancas.ts`; a unidade pronta vem de `central_is_ready` no
  carregador). Os motivos de venda e pagador aparecem na prévia, ao clicar.

## ASA1, entrega 1 — abas Financeiro e Comercial e o responsável financeiro (Asaas 0.2.0, core 0.427.0, 11/11/2026)

### O que existe

- **4003** — `client_guardians.is_financial` com a regra de exclusão
  `client_guardians_one_financial` (no máximo um pagador por cliente,
  conferida no FIM do comando — o índice único comum recusava a troca do
  pagador num comando só, achado no ensaio); o pagador marcado sozinho no
  menor com um único responsável; `finance_settings_grace_zero` (carência
  presa em zero; a migração PARA com `GRACE_NOT_ZERO` se achar outro valor, sem
  mudar o dado); `central_history` com as abas `financeiro` e `comercial`.
- **Central por aba** (`src/lib/central/central.ts`): `podeVerAba`,
  `abasVisiveis`, `primeiraAba`. Conta = `modulo.central`; Financeiro =
  `canConfigureFinanceNetwork` (rede e todas as unidades) ou
  `canViewFinance` + função na unidade; Comercial = Admin Master. A Central
  aparece para quem vê alguma aba — o Gerente e o Franqueado passam a vê-la
  (só a aba Financeiro da própria unidade).
- **Aba Financeiro** (`central/aba-financeiro.tsx`, `central/financeiro-form.tsx`):
  herança campo a campo na unidade (vazio = segue a rede, `CampoHerdado`),
  carência só leitura, os alertas da unidade no pé. **Aba Comercial**
  (`central/aba-comercial.tsx`): os editores de Regras Comerciais com `escopo`
  e as condições dos programas só para leitura.
- `/financeiro/configuracao` e `/admin/regras-comerciais` redirecionam; o
  formulário antigo (`financeiro/configuracao/settings-form.tsx`) saiu.
- **Responsável financeiro** (`src/lib/responsaveis.ts`, `prontuarios/actions.ts`,
  `client-form.tsx`): o salvar atualiza por id em vez de apagar e recriar; o
  adulto pode ter um pagador opcional; a ficha mostra o selo.

### Regras que quem mexer aqui precisa saber

- ⚠️ **Componente de navegador da Central não importa `central.ts`** (ele
  importa `@/lib/auth`, que é de servidor, e a montagem quebra). A herança
  pura mora em `src/lib/central/heranca.ts`. Régua no
  `asaas-asa1-entrega1.test.ts`.
- ⚠️ **Aba nova = entrada em `ABAS_DA_CENTRAL`, ramo em `podeVerAba` e ramo
  em `central_history`.**
- ⚠️ **Os responsáveis vão SEMPRE no formulário**, também do adulto (antes,
  editar um adulto apagava os responsáveis de quando era menor).
- ⚠️ **Gravar a troca de pagador: quem deixa de ser vem primeiro**
  (`ordemDeGravacao`).
- ⚠️ **Banco de treino por IPv4:** o endereço direto (só IPv6) não respondeu
  deste PC em 11/11/2026. `scripts/test-db.mjs` aceita `TEST_DB_URL` pelo
  ambiente (o pooler `aws-0-sa-east-1.pooler.supabase.com`, usuário
  `postgres.<ref>`); a trava de produção vale igual.

### O que foi provado

- Ensaio no treino, transação desfeita: **25/25**
  (`scripts/asaas-ensaio-asa1-entrega1.mjs --confirmar`). `test:indica` 246/246.
- Testes: `asaas-asa1-entrega1.test.ts` + a suíte inteira (3.908) e o lint.
- Telas no servidor local contra o treino, por papel (só leitura): Admin vê as
  três abas nos dois níveis; os endereços antigos levam às abas; o Gerente vê
  só a aba Financeiro da própria unidade, só leitura, e é barrado no resto; o
  Financeiro edita a rede e é barrado em Comercial e Conta; a Recepção não abre
  a Central; a ficha mostra o selo do responsável financeiro.
- **Não visto:** salvar pela tela (multa por campo, troca de pagador no
  cadastro). A gravação está coberta pelo ensaio do banco e pela régua do
  código, não por clique.

## ASA0 — Fundação (Asaas 0.1.0, 10/11/2026)

### O que existe

- **4000** — `gateway_settings` (o interruptor de produção, desligado e **sem
  função que o ligue**), `gateway_accounts`, `gateway_key_usage`,
  `gateway_api_log`, `gateway_webhook_events`; o gatilho
  `gateway_accounts_guard` (recusa conta `production`, recusa trocar ambiente,
  dono ou endereço do webhook) e `gateway_accounts_no_delete`.
- **4001** — `card_acquirers.gateway_account_id`, `acquirer_rates.min_fee_cents`
  / `max_fee_cents` / `source`, e `_gateway_sync_fees`.
- **4002** — `central_unit_readiness`, `gateway_notices`, a lista de prontidão
  (`_central_readiness_raw` → `central_readiness`, `central_is_ready`), a queda
  automática da marcação, `_gateway_record_check`, `central_history` e o padrão
  das duas permissões.
- **Código:** `src/lib/asaas/` (cliente HTTP, travas de ambiente, tarifas,
  vinculação e verificação, rotina, Asaas de mentira), `src/lib/central/`
  (regras e leituras), `src/app/(app)/central/` (telas e ações),
  `src/app/api/webhooks/asaas/[ref]/` e `src/app/api/cron/gateway-accounts/`.
- **Roteiros:** `scripts/asaas-ensaio-asa0.mjs` (ensaio do banco, transação
  desfeita) e `scripts/asaas-sandbox-contas.mjs` (contas de teste).

### Regras que quem mexer aqui precisa saber

- ⚠️ **A CHAVE SÓ SAI DO VAULT EM `src/lib/asaas/account.ts`**
  (`credencialDaConta` → `_gateway_read_key`, que só responde à chave de
  serviço e grava cada uso). Há régua que reprova outra chamada
  (`asaas-asa0.test.ts`). Nada de `ASAAS_API_KEY` em código novo: a variável só
  existe no `.env.local`, para o roteiro das contas de teste.
- ⚠️ **NENHUMA REGRA DE ESCRITA em `gateway_*` e `central_*`.** Só função
  grava. O que a pessoa faz pela tela (abrir cadastro, termo, split, marcar
  pronta, desativar) é função guardada chamada COMO a pessoa; gravar a chave
  passa pelo servidor (precisa validar no Asaas antes) e o banco confere a
  permissão de novo (`_gateway_actor_can_link`).
- ⚠️ **O GERENTE SÓ GRAVA A CHAVE DEPOIS DO TERMO** — no banco. Na tela ele
  ainda precisa de `modulo.central` e `acao.central.vincular_conta`, que nascem
  **sem papel nenhum** (só o Admin Master).
- ⚠️ **PRODUÇÃO TEM DUAS TRAVAS:** o gatilho do banco e
  `recusaDeAmbiente` no cliente (`ASAAS_ALLOW_PRODUCTION=sim`, que não existe
  em lugar nenhum). Só a ASA7 mexe nisso.
- ⚠️ **TIMEOUT É RESULTADO DESCONHECIDO.** POST/PUT/DELETE nunca é repetido
  sozinho (`unknown_outcome`); 429 é repetido com espera para qualquer método,
  porque o Asaas recusou antes de processar. Erro 5xx num POST também não é
  repetido: quem chamar na ASA1 trata como desconhecido e consulta pelo
  `externalReference`.
- ⚠️ **O REGISTRO DAS CHAMADAS GUARDA O MODELO DA ROTA** (`/webhooks/{id}`),
  nunca o caminho preenchido, a consulta ou o corpo. Endpoint novo entra em
  `api.ts` com `path` de modelo e `params`.
- ⚠️ **TARIFA NUNCA É SOBRESCRITA:** a que mudou fecha a vigência
  (`valid_to`) e abre outra; tarifa `manual` não é tocada. Promoção com data de
  fim vira duas linhas (a promocional e a cheia do dia seguinte).
- ⚠️ **O ADQUIRENTE "ASAAS" NÃO É O PADRÃO DA UNIDADE** enquanto a integração
  não emite cobrança: as baixas manuais seguem com o adquirente de hoje.
- ⚠️ **PRONTIDÃO: item novo entra em `_central_readiness_raw`** (mesmas
  colunas) **e em `ITENS_DE_PRONTIDAO`** — a régua compara os dois. Lista vazia
  é "não consegui conferir", nunca "pronta". Toda emissão (ASA1 em diante)
  pergunta `central_is_ready(unidade)`.
- ⚠️ **ABA NOVA DA CENTRAL = uma entrada em `ABAS_DA_CENTRAL`** e um ramo em
  `central_history`. Nenhuma fase cria tela de configuração à parte.
- ⚠️ **A VERIFICAÇÃO "SEMANAL" RODA TODO DIA** e pega só a conta cuja última
  verificação tem 7 dias ou mais, ou falhou. Recusa da chave derruba a
  prontidão; falha passageira não derruba nada.
- ⚠️ **O ENSAIO DO BANCO USA UNIDADES SEM CONTA EM USO.** O treino tem as
  contas de teste do sandbox em Londrina, Cambé e na RISARTE Franchising; o
  ensaio usa a Unidade Teste, a Unidade Fake e a Franqueadora Teste. Se essas
  ganharem conta, ele diz NÃO MEDI.
- O cliente HTTP ANTIGO do Empresarial (`src/lib/empresarial/asaas.ts`) e a
  Edge Function `asaas-webhook` **não foram tocados**: saem na ASA5.

### O que foi provado, e como

- **Ensaio do banco** (`node scripts/asaas-ensaio-asa0.mjs --confirmar`):
  63 conferências, transação desfeita — quem abre conta, trava de produção,
  termo antes da chave do Gerente, ida e volta no Vault, uso registrado, regra
  de linha por papel (com o papel `authenticated`), webhook idempotente,
  tarifas com vigência, prontidão que cai sozinha, aviso ao Admin Master sem
  repetir, histórico por aba, desativação que apaga os segredos.
- **Testes** (`asaas-asa0.test.ts`, 48): travas de ambiente, cliente HTTP,
  tarifas, webhook, rotina, regras da Central e as réguas do segredo.
- **Prova de quebra:** 14 defeitos postos de propósito (8 no código, 6 no
  banco) — todos reprovados. A primeira rodada dos casos de banco "reprovou"
  pelo motivo errado (o ensaio tinha parado numa exceção por causa das contas
  de teste recém-criadas); o ensaio foi corrigido e a prova refeita.
- **Sandbox de verdade** (`npm run test:asaas`): as quatro contas de teste
  verificadas pelo caminho real do servidor (Vault → Asaas → tarifas). As
  tarifas vieram com promoção até 10/02/2027 e a cheia cadastrada para o dia
  seguinte.
- **Telas** (servidor local contra o treino, contas de teste, só leitura): a
  lista, a unidade com conta, a unidade sem conta, o nível Rede; nenhuma chave
  nem identificador do Vault no HTML; o Gerente de teste (sem a permissão) não
  abre nada.
- **Rota de webhook** (servidor local): sem token, token errado, endereço
  errado → 401; token certo → 200; o mesmo evento → 200 sem gravar de novo;
  corpo que não é evento → 400.
- **Portão:** `check-migrations` nas três, `npm run verificar`, `npm test`
  (3.860) e `npm run lint` verdes.

### O que NÃO foi provado

- **As telas num navegador** (foram conferidas pelo HTML que o servidor
  devolve, não olhando). Os botões (gravar chave, termo, marcar pronta,
  desativar) não foram clicados: as funções por trás estão no ensaio.
- **Vincular uma conta colando a chave pela tela** — as contas de teste
  entraram pelo roteiro. O caminho `vincularConta` só rodou com o Asaas de
  mentira nos testes; a parte de verificação rodou de verdade.
- `check:telas` completo não foi rodado (o disco C: está com ~12 GB livres).

### O projeto de teste na Vercel e o webhook real (10/11/2026)

- **`risarte-asaas`** (`https://risarte-asaas.vercel.app`): branch de produção
  `feat/asaas-integration`, região São Paulo, proteção padrão. Variáveis: só
  as três do Supabase de **treino** e `NEXT_PUBLIC_AMBIENTE=treino` (a chave de
  serviço marcada para Production e Preview — a Vercel não deixou desmarcar o
  Preview; é a do treino e as prévias ficam protegidas). Sem `CRON_SECRET`, sem
  ZapSign, sem chave do Asaas.
- ⚠️ **Projeto novo só monta a produção com um push na branch de produção.** O
  primeiro push foi antes de o projeto existir: foi preciso um commit vazio.
- ⚠️ **Variável sensível da Vercel não pode ser lida de volta.** A chave de
  serviço do treino se copia no Supabase (projeto de treino › Project Settings
  › API Keys › Legacy › `service_role`), nunca de outro projeto da Vercel. Sem
  ela a rota do webhook responde 500 e o log diz `service role key is not
  configured`.
- Conferido de fora: a página aponta para o banco de treino, a função roda em
  `gru1`, e a rota do webhook responde 401 sem token — o endereço de produção
  do projeto não passa pela proteção da Vercel.
- **Webhooks criados** nas quatro contas de teste pelo MESMO código do botão
  "Criar o webhook" (`ASAAS_WEBHOOK_BASE_URL=https://risarte-asaas.vercel.app
  npm run test:asaas`). Os avisos do Asaas sobre a fila vão para um endereço de
  teste (`ASAAS_WEBHOOK_EMAIL` muda).
- **Critério de aceite cumprido:** cobrança PIX de teste criada em Londrina
  (`--evento londrina`) → o Asaas chamou o endereço publicado → o evento
  `PAYMENT_CREATED` ficou gravado em `gateway_webhook_events` em segundos, com
  o identificador do evento e a nossa referência.

### Estado do treino (resíduos conhecidos)

- Quatro contas de teste ativas: a raiz na **RISARTE Franchising**,
  **Londrina**, **Cambé** e a carteira **RisLife Teste**, todas com webhook
  apontando para `risarte-asaas.vercel.app`. Cada uma (menos a RisLife) tem um
  adquirente "Asaas (teste)" com as tarifas, que **não** é o padrão da unidade,
  e uma chave Pix aleatória no sandbox.
- Prontidão de Londrina: só faltam "split habilitado" e "termo registrado"
  (os dois dependem de ato do Admin Master pela tela).
- Londrina tem dois eventos gravados: um de ensaio local (`evt_local_…`) e o
  `PAYMENT_CREATED` real da cobrança de R$ 5,00 de teste (em aberto no sandbox).

### Fechamento da ASA0 (11/11/2026)

1. ✅ Aprovada pelo dono.
2. ✅ 4000, 4001 e 4002 rodadas na produção pelo dono, nessa ordem, com as
   conferências batidas (5·13·2·0·false·0, 3·1·0, 7·1·2·0). ⚠️ A 4001 deu
   "Success. No rows returned" na primeira vez **sem ter entrado** — o editor
   rodou outra coisa; só a conferência à parte mostrou. Rodar migração: Ctrl+A,
   Delete, colar, clicar fora do texto, Run; e exigir ver a linha de conferência.
3. ✅ No `main` com a versão 0.423.0, a novidade e o manual 13g (a Central só
   para o Admin Master). A cópia solta de `docs/integracao-asaas.md` na pasta
   principal foi apagada antes (era idêntica à da branch).
4. Na produção a Central está vazia: nenhuma conta Asaas, trava de produção
   desligada. A verificação semanal roda todo dia e não encontra conta.

**A próxima fase é a ASA1** (cobrança avulsa e link), com plano e OK do dono antes.

⚠️ **Lição desta sessão:** texto com crases dentro de `node -e "…"` no Git Bash
vira substituição de comando — o shell tentou executar cada trecho entre
crases (nenhum rodou, todos falharam). Texto de documento se edita pela
ferramenta de edição, nunca por script de terminal.

### Perguntas ao gerente de contas do Asaas (do dono)

Estão na Parte A da especificação: subcontas para CNPJ diferente, base do
percentual com desconto/multa, split em chargeback, tarifas e liberação do Pix
Automático e da tokenização, IP do pagador na cobrança com token, token
devolvido pela fatura.
