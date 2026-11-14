# Levantamento de Dívidas da Rede — plano e decisões

Pedido do dono: `docs/prompts/prompt-riszon-levantamento-dividas.md` (13/11/2026).

**Situação:** plano **aprovado pelo dono em 13/11/2026, com ajustes** (seção 6
traz cada decisão como ficou). Fases 0, 1, 2 e 3 entregues (1 = 0.442.0,
migração 0404; 2 = 0.443.0, migração 0405; 3 = 0.445.0, migração 0406; blocos
no `ESTADO_DO_PROJETO.md`); **a fase 4 só começa com novo OK do dono.** Uma fase por vez. A carga real da planilha só acontece na
fase 4, depois que o dono confirmar as pendências dela.

> **Dado real fica fora.** Este documento não traz nome de credor, valor nem
> CNPJ de credor da planilha `_dados_importacao/Relatorio_Dividas_revisado.xlsx`;
> só a estrutura dela. A pasta está no `.gitignore` desde o commit `aab08519`
> (D0). Testes usam **planilhas sintéticas**, nunca a real.

---

## 1. O que já existe e será reaproveitado

### 1.1 O módulo Financeiro está completo (FIN0 → FIN8)

| Peça | Existe? | Onde | Como a dívida usa |
|---|---|---|---|
| **Razão** (`financial_entries`) | ✅ | 0185 | Tudo nasce aqui; competência (`accrual_date`) × caixa (`cash_date`); `source_type`/`source_id`; nada se apaga, estorno por contra-lançamento |
| **Contas a pagar** (`payables` + `payable_payments`) | ✅ | 0194, 0235, 0317, 0372 | **Dona do título e do pagamento.** Uma linha por parcela; pagamento parcial; multa/juros pagos informados na baixa → 4.2.01; desconto → `payable_discount`; cancelamento com motivo; quem lançou/quem pagou |
| **Plano de contas** (`chart_of_accounts`) | ✅ | 0185 | Catálogo único da rede, editável. **Não tem grupo de passivo** nem "descontos obtidos"; tem 5.3.01 Empréstimos — principal (fora da DRE, atividade financiamento) e 4.2.01 Juros e multa pagos |
| **DRE** (`dre_lines` → `_dre_lines_raw`) | ✅ | 0320 | Competência, `open`+`settled`; exclui `payable_cash`/`receipt_cash` e os prefixos 5.1, 5.3, 5.4, 6 — **a regra está repetida em vários leitores** (ver 1.3, D5) |
| **Fluxo de caixa** (`cash_flow_series_raw`) | ✅ | 0301 | Realizado = razão por `cash_date`; previsto = `payables` abertas/parciais/aguardando, **de hoje em diante**. **Não há faixa "vencido não pago"** do lado das contas a pagar |
| **Conciliação** (`bank_transactions`, `…_matches`) | ✅ | 0195, 0301, 0302 | `pay_payable_from_bank_transaction` paga e concilia de uma vez — a dívida ganha conciliação **de graça** se o pagamento passar pela conta a pagar |
| **Fechamento de competência** (`fiscal_period_guard`) | ✅ | 0370 | Recusa lançamento de competência em mês fechado (passam só caixa e conta 6.x) |
| **Fornecedores** (`suppliers`, `supplier_kinds`, `save_supplier`) | ✅ | 0371 | Ficha completa com CNPJ, contatos, banco/PIX, abrangência rede/franqueadora/unidades, histórico |
| **Painel da rede / consolidado** | ✅ | 0236, 0237 | Lugar natural do menu (grupo "Rede" do `finance-nav.tsx`, `soRede`) |
| **Renegociação de parcelas do paciente (FIN2)** | ✅ | 0189–0193 | **Espelho do que precisamos do lado de pagar:** as cobranças novas não geram receita de novo; só multa/juros, benefício e desconto entram no razão |
| **Alertas do Financeiro** (`check_finance_alerts`) | ✅ | 0230 (corpo 0297) | 4 regras: orçamento de despesa, caixa negativo previsto, ponto de equilíbrio, **atraso a RECEBER**. Hoje **não existe** aviso por conta a pagar vencida (conferido na 0230) |
| Anexos em contas a pagar | ❌ | — | Não existe (o "comprovante" é só texto). Bucket novo |
| Data de implantação por unidade | ❌ | — | Não existe. Campo novo |

### 1.2 Padrões transversais que serão usados (sem duplicar)

- **Franqueadora já é entidade:** `clinics.type = 'franchisor'`. A "Risarte
  Administração" é uma linha de `clinics`, então **o devedor é sempre
  `clinic_id`** — unidade ou franqueadora, sem quebrar o multi-tenant e
  funcionando para N unidades. CNPJ em `clinics.cnpj`, razão social em
  `clinics.legal_name`.
- **Papéis:** `finance_franchisor` (Financeiro da Franqueadora) + Admin Master
  (`is_admin_master`) + Admin Principal (`is_owner`).
- **Matriz de permissões** (`permission_matrix`, `CAPACIDADES` em
  `src/lib/permissions.ts`) com **teto no banco** — mesmo desenho do Asaas
  (`_gateway_cap_ceiling`, 4006) e da assinatura (`signature_can`, 0340).
- **Auditoria campo a campo e imutável:** `audit_changes` (antes → depois,
  usuário, data/hora; recusa UPDATE/DELETE). Tabela nova termina com
  `audit_attach_all()`; nome em português em `auditoria-catalogo.ts`. A aba
  Histórico lê por uma **porta** com guarda, como `finance_history` (0372) —
  hoje só o Admin Master lê a trilha crua.
- **Escrita só por função `security definer`** (nenhuma regra de escrita nas
  tabelas), aviso pela **porta do banco** (`notifications` não aceita gravação
  direta), `revoke … from public, anon, authenticated` em função interna.
- **Código que nunca some:** sequência + `lpad`, como `MT-`, `ASS-`, `OC-`.
- **Importação:** `xlsx` (SheetJS) no navegador + conferência pura e testada
  (modelo: `src/lib/empresarial/importacao.ts`); `parseAmountCents`/`parseDate`
  da conciliação; `isValidCnpj`/`formatCnpj` em `src/lib/masks.ts`.
- **Exportação:** ExcelJS (`src/lib/finance/relatorio-xlsx.ts`) e PDF pela
  impressão (`botao-salvar-pdf.tsx`) ou `pdf-lib`.
- **Gráficos:** SVG próprio (`src/components/metas/grafico-da-meta.tsx`,
  `src/components/repasse/barras-do-repasse.tsx`); não há biblioteca de
  gráfico — não vou acrescentar uma.
- **Rotina diária:** pg_cron com dedupe de aviso (`finance_alerts`,
  `ortho_notices`) e "fotografia" (`goal_daily_values`, metas M2).
- **Upload privado + URL assinada:** padrão do `contratos-papel` (0392).
- **Configuração em cascata** rede → unidade com coluna anulável
  (`finance_settings`; regra da 0230).

### 1.3 Como cada integração da 3.13 vai funcionar

**Princípio da fonte única (quem é dono de quê):**

| Informação | Dona | A outra só referencia |
|---|---|---|
| A dívida, credor, restrições, propostas, acordo (cabeçalho), contatos, checklist | **`debt_*`** (novo) | — |
| Cada **parcela/título** a pagar (da dívida original ou do acordo) | **`payables`** | a dívida aponta por `payables.debt_id` / `payables.debt_agreement_id` |
| Cada **pagamento** | **`payable_payments`** | a tela da dívida só lê; "Registrar pagamento" chama a mesma função do Contas a Pagar |
| Contabilização | **`financial_entries`** | gerada pelas funções de sempre (`post_payable_accrual`, baixa) + as origens novas do acordo |

Não existe tabela "parcelas do acordo" nem "pagamentos da dívida": seriam a
cópia que depois diverge. **Baixa feita em um lado aparece no outro porque é
o mesmo registro.**

**As três origens:**

| Origem | Contas a Pagar | Conta usada | DRE | Fluxo de caixa |
|---|---|---|---|---|
| **A. Anterior à implantação** | cria 1 título por parcela, com selo **"saldo de implantação"** | conta de **saldo de abertura** da categoria — nova **5.5.01** (operacionais/tributos/trabalhistas) ou a **5.3.01** existente (empréstimos) — **fora da DRE** | só eventos futuros: juros/multa pagos (4.2.01), desconto obtido (nova 4.1.03), custas | **linha própria "Dívidas"** (separada da operação); o vencido vai para a faixa nova **"vencido não pago"** |
| **B. Nova, ainda não lançada** | cria 1 título por parcela | conta de **despesa** da categoria (ex.: materiais, utilidades) | despesa no mês de competência | previsto, na atividade da conta (operacional) |
| **C. Já está no Contas a Pagar** | **só vincula** (`debt_id` no título existente) | a que o título já tem | nada novo | nada novo |

- **Data de implantação (D2):** `clinics.go_live_on` = **16/11/2026** para os
  três CNPJs. **A origem é decidida pela data em que a dívida NASCEU**
  (emissão ou competência), **nunca pelo vencimento**: dívida contratada antes
  de 16/11 é A mesmo que a parcela vença depois. No cadastro manual o sistema
  **sugere** A ou B por essa regra; trocar exige justificativa (auditoria). Na
  importação vale a **coluna "Origem do lançamento"** da planilha (que não tem
  data de emissão) — a sugestão automática fica só como conferência.
- **Duplicidade contra o Contas a Pagar existente (ajuste 2):** no cadastro e
  na importação, o sistema procura títulos já lançados **do mesmo CNPJ**
  (credor + vencimento + valor, e contrato quando houver) e **sugere a origem
  C (vincular)** em vez de criar título novo.
- **Resumo do impacto antes de salvar** ("serão criados 3 títulos no Contas a
  Pagar da Risarte Cambé, total R$ X, conta 5.5.01; nenhum lançamento na DRE
  porque é saldo de abertura"). A conta mora em `src/lib/finance/dividas.ts`
  (pura, testada) e é **refeita pelo banco** na gravação — a tela mostra, o
  banco decide.
- **Editar** valor/vencimento atualiza o título ainda não pago (e o
  lançamento `payable_accrual` dele, como o refresh das taxas da rede faz).
  **Título com pagamento ou conciliado nunca é apagado:** a edição é
  recusada com o motivo na tela. **Excluir** a dívida (lógico, com motivo)
  cancela os títulos gerados por ela pela `cancel_payable` (que já recusa o
  pago) e **desvincula** os da origem C sem tocá-los.
- **Fechamento de competência:** a família 5.5 não muda resultado; o
  `fiscal_period_guard` passa a deixá-la passar como já deixa a 6.x — pela
  mesma função única da regra "fora do resultado" (abaixo).
- **Alçada (D8):** título gerado pela dívida nasce **sem passar pela alçada**
  do Contas a Pagar. A trava fica no **acordo**: acima de um valor
  configurável, espera aprovação do Admin Master (seção 4.7).
- **Relatório de saldo de abertura do passivo** por CNPJ: todas as dívidas A na
  data de implantação, por credor/categoria/conta, em Excel e PDF — para o
  contador.

**Visibilidade no Contas a Pagar (D1, com três condições):**

1. **Unidade franqueada não enxerga título da franqueadora.** Já é assim hoje
   (`finance_visible_clinic_ids`: Gerente e Franqueado veem só as próprias
   unidades); a fase 3 **prova com teste de RLS** (`set local role
   authenticated`, um usuário de cada papel de unidade) e a régua fica.
2. **Selo e filtro "saldo de implantação"** no Contas a Pagar entram na fase 3,
   junto com a geração dos títulos.
3. **Nenhum aviso por título de saldo de implantação.** Hoje não existe aviso
   de conta a pagar vencida (os 4 alertas da 0230 não olham isso); a regra
   vale para o que existe e para o que vier: **contagem, card ou aviso de
   "vencidas" exclui os títulos `opening_balance` e mostra, no lugar, uma linha
   única por CNPJ** ("saldo de implantação: N títulos, R$ X vencidos"). A régua
   da fase 3 reprova leitor de vencidas que não use a mesma função.

**Juros e atualização do valor (D6, D7):** o título carrega o valor devido no
lançamento (A: o **valor atualizado** na data de implantação; B: o original).
A correção que o credor vai somando fica **informativa** na dívida ("valor
atualizado em dd/mm") e **entra no razão só quando vira fato**: na baixa
(juros/multa informados → 4.2.01, mecanismo que já existe) ou no acordo.

**Renegociação (o acordo) no razão — espelho da FIN2:**

1. Os títulos em aberto da dívida (saldo **S**) passam para a situação nova
   **`renegociada`**: saem do "a pagar" e da projeção, **mas o lançamento de
   competência fica** (na B a despesa já foi reconhecida; na A está fora da
   DRE). Nada se apaga.
2. Nascem os títulos do acordo (entrada + parcelas), na conta nova **5.5.02
   Acordos de dívidas — principal** (fora da DRE), com `debt_agreement_id`.
3. A diferença entre o acordado **T** e **S**:
   - **T < S → desconto obtido D** (nova 4.1.03, receita financeira). Momento
     configurável na rede (`discount_recognition`): **(a) na data do acordo**,
     com estorno se o credor restabelecer a dívida — **padrão**; ou **(b)
     proporcional a cada parcela paga** (D × pago ÷ T a cada baixa). **"A
     validar com o contador."**
   - **T > S → encargos da renegociação** (4.2.01), **na data do acordo** por
     padrão, também configurável (`surcharge_recognition`, mesmas duas opções).
4. Desfazer o acordo só enquanto nenhuma parcela dele tiver sido paga:
   estorna (3), cancela (2) e devolve (1) — tudo em uma transação.
5. Acordo quebrado e renegociado de novo: os títulos em aberto do acordo velho
   viram `renegociada` e o novo repete 1–3. A dívida guarda todos os acordos.
6. **"Credor restabeleceu a dívida" (ajuste 1)** — ação sobre acordo quebrado:
   - os títulos em aberto do acordo viram `renegociada`;
   - nasce um título "dívida restabelecida" de **S − pago no acordo** (5.5.02),
     e o saldo devedor volta a esse valor (o credor pode somar encargos depois:
     atualização informativa, como qualquer dívida);
   - **estorna o desconto reconhecido até ali** por um contra-lançamento com
     **data de hoje** — nunca no mês do acordo, que pode estar fechado (o
     `reversal_of` tiraria o lançamento original do mês fechado; por isso é um
     lançamento novo e oposto, de origem própria). No modo (b) estorna só a
     parte que já tinha sido reconhecida.

**Fluxo de caixa (ajuste 3, D14):** os pagamentos de títulos de saldo de
implantação (5.5.01) e de acordos (5.5.02) aparecem numa **linha própria
"Dívidas (saldo de implantação e acordos)"**, separada das atividades
operacionais, **no realizado e no previsto**. Mais duas mudanças na tela
existente: (a) faixa **"vencido e não pago"** das contas a pagar (vale para
toda conta); (b) **cenário** "e se eu fechar esta proposta à vista?",
calculado só na tela, nunca gravado — o fluxo oficial não é tocado.

**DRE e a regra única "fora do resultado" (D5, ajuste 4):** principal nunca é
despesa nova. Entram só juros/multa/encargos pagos (4.2.01), desconto obtido
(4.1.03) e custas de cartório/honorários (conta nova de custas). Contas
**parametrizadas na categoria** e marcadas **"a validar com o contador"**.

Hoje a lista de prefixos fora da DRE (5.1, 5.3, 5.4, 6) está **repetida** em
cada leitor do razão. Na fase 3 ela vira **um lugar só**:

- no banco, `public.account_outside_result(code)` (e a irmã que dá a atividade
  do caixa), usada pela DRE, consolidado, ponte lucro × caixa, ponto de
  equilíbrio, hora clínica (custo fixo), orçado × realizado, metas e o
  `fiscal_period_guard`;
- no TypeScript, `contaForaDoResultado` espelhando a mesma lista;
- **régua obrigatória** (teste): (1) reprova leitor do razão que filtre prefixo
  por conta própria; (2) prende TS = SQL; (3) **prova que os indicadores da
  unidade não mudam** — DRE, ponto de equilíbrio, metas, hora clínica e orçado
  × realizado calculados antes e depois de lançar títulos de dívida (A e
  acordo) dão o mesmo número; (4) testes de RLS do D1.

**Conciliação:** pagamento de dívida e de acordo é pagamento de `payable` —
casa com o extrato pelo caminho que já existe.

**Visões:** na rede consolidada, os indicadores de endividamento usam a
receita e o caixa de **cada** CNPJ. O card "Dívidas da unidade" para o painel
financeiro da unidade fica pronto atrás de uma permissão que nasce **sem
nenhum papel**.

---

## 2. Modelo de dados proposto

Schema `public`, prefixo `debt_`, dinheiro em **bigint de centavos**, datas
civis brasileiras. Todas as tabelas entram na auditoria (`audit_attach_all`),
**exceto** as de histórico próprio (eventos, contatos, fotografias, linhas de
importação), declaradas em `audit_excluded_tables` com o motivo.

### 2.1 Configuração

| Tabela | Campos principais | Observação |
|---|---|---|
| `clinics.go_live_on` *(coluna nova)* | date | Data de implantação do riSZon por CNPJ (16/11/2026 nos três). Coluna em `clinics` porque é atributo da unidade e serve além das dívidas — mudança aditiva em arquivo do core |
| `debt_settings` | `clinic_id` (nulo = rede), `days_to_default` (30), `about_to_default_days` (5), `proposal_alert_days` int[] ({7,2}), `negativation_removal_bdays` (5), `closing_stale_days` (15), **`agreement_broken_tolerance_bdays` (3 dias úteis)**, **`agreement_approval_threshold_cents` (nulo = desligado)**, **`discount_recognition` (`na_data_do_acordo` · `proporcional`; padrão o 1º)**, **`surcharge_recognition` (idem; padrão o 1º)** | Cascata rede → devedor, colunas anuláveis. As duas formas de reconhecimento são **só da rede** |
| `debt_default_rules` | `creditor_kind` → `days_to_default` | Prazo diferente por categoria do credor (ex.: tributos, bancos) |
| `debt_natures` | `code` (financeira, operacional, tributaria, trabalhista), `label`, `sort_order`, `active` | Editável; desativar não apaga |
| `debt_categories` | `id`, `parent_id` (subcategoria), `name`, `nature_code`, `opening_account_code` (A), `expense_account_code` (B), `sort_order`, `active`, `system` | 13 categorias iniciais do pedido. **A conta é configurada aqui** e a dívida herda (pode sobrescrever) |
| `debt_tags` / `debt_tag_links` | nome livre, cor, `active`, `system` (etiqueta automática da importação) / (`debt_id`, `tag_id`) | Criadas na hora |

### 2.2 Credor = Fornecedor (um cadastro só) — D4

O credor **é** uma linha de `suppliers` (o título no Contas a Pagar já exige
`supplier_id`). Ficam no fornecedor: razão social, CNPJ, tipo
(`supplier_kinds`, ampliado com banco, órgão público federal/estadual/municipal,
concessionária, trabalhista), telefones, e-mail, WhatsApp. **O que é
sensível de dívida não fica no fornecedor:**

| Tabela | Campos |
|---|---|
| `debt_creditor_contacts` | `supplier_id`, `kind` (credor · assessoria de cobrança · advogado · cartório), `organization` (nome da assessoria), `person_name`, `phone`, `whatsapp`, `email`, `notes`, `active` |
| `debt_notary_offices` | cartório reutilizável: nome, cidade/UF, contato |

Tributo: credor = **órgão** (Receita Federal, PGFN, Estado, Município); o tipo
do débito (Simples, INSS…) é **subcategoria**. Credor só com a raiz do CNPJ
(8 dígitos) é aceito como provisório, com a pendência "completar CNPJ" (D18).

### 2.3 A dívida

**`debts`** (devedor = `clinic_id`)

- Identificação: `id`, `code` (`DV-000001`), `clinic_id`, `supplier_id`
  (credor), `group_id`, `debt_type` (empréstimo, capital de giro, limite,
  antecipação de recebíveis, boleto de compra, fatura, imposto, parcelamento
  anterior, outro), `contract_number`, `installment_label` ("R04 de 11"),
  `description`, `collection_contact_id` (assessoria que está com o título).
- **Dívidas reunidas (D11):** `bundled_count` (quantas dívidas a linha reúne —
  ex.: oferta do Serasa que junta várias do mesmo credor) e `needs_split`
  ("desdobrar depois"). Entram como **uma dívida só**; desdobrar vira ação da
  tela (gera N dívidas no mesmo grupo e preserva a original no histórico).
- Garantias: `has_guarantor`, `guarantor_name` (sócio avalista — **só o nome**,
  D13), `real_guarantee`, `receivables_assignment` (cessão de recebíveis),
  `guarantee_notes`.
- Categorização: `category_id`, `subcategory_id`, `nature_code`,
  `account_code` (sobrescreve a da categoria), tags. Flag `tax_active_debt`
  (tributo inscrito em dívida ativa).
- Valores: `original_cents`, `updated_cents`, `updated_ref_date`,
  `interest_cents`, `fine_cents`, `charges_cents`, `contract_rate_percent`.
  **Saldo devedor e pagos são calculados** dos `payables` — não guardados.
- Datas: `created_at` (automática), `accrual_month` (competência),
  `issue_date`, `due_date`, **`last_checked_on`** (data da última conferência
  no Serasa/credor — sugestão 2). Calculados na leitura: dias em atraso, faixa
  de aging, limite de 5 anos da negativação (informativo).
- Origem: `origin` (A/B/C), `origin_suggested`, `origin_override_reason`.
- Situação: `status` (gravado; regra na seção 4), `manual_stage`
  (em_negociacao · contestada · judicial · baixada — o que só gente decide),
  `stage_reason`.
- Gestão: `priority` (alta/média/baixa), `priority_reasons` text[],
  `owner_user_id`, `next_action`, `next_action_on`, `notes`.
- Rastro: `created_by`, `updated_by`, `updated_at`, `deleted_at`,
  `deleted_by`, `deleted_reason` (exclusão lógica, motivo obrigatório),
  `import_batch_id`.

**`debt_groups`** — mesmo contrato/pedido: `code`, `clinic_id`,
`supplier_id`, `label`, `contract_number`. Proposta e acordo podem ser feitos
**pelo grupo**.

**Vínculo com o Financeiro** — colunas novas em `payables` (aditivas, mesmo
desenho de `stock_purchase_id`/`network_fee`/`empresarial_billing_id`):
`debt_id`, `debt_agreement_id`, `debt_installment_no`, `debt_link` (`gerado` |
`vinculado` | `acordo` | `restabelecido`), `opening_balance` (bool "saldo de
implantação"), e o status novo **`renegociada`** no `check` de
`payables.status`.

### 2.4 Restrições

| Tabela | Campos |
|---|---|
| `debt_negativations` | `debt_id`, `bureau` (Serasa, SPC, Boa Vista, outro), `included_on`, `amount_cents`, `in_limpa_nome`, `target` (empresa · sócio avalista), `target_name`, `removal_confirmed_on`, `removal_attachment_id` |
| `debt_protests` | `debt_id` **ou** `group_id` (D16), `notary_office_id`, `protocol`, `protested_on`, `amount_cents`, `cancel_cost_cents`, `cost_quoted_on`, `consent_letter` (pendente · solicitada · recebida) + anexo, `cancel_status` (pendente · em andamento · cancelado), `cancelled_on` + comprovante |
| `debt_lawsuits` | `debt_id`, `process_number`, `court`/`district`, `phase`, `claim_cents`, `lawyer_name`, `has_freeze`, `has_seizure`, `has_search_and_seizure`, `closed_on` |
| `debt_extrajudicial_notices` | `debt_id`, `received_on`, anexo, `notes` |

"Conta atrasada" × "dívida negativada" sai da presença de negativação ativa.

### 2.5 Propostas, acordos, contatos, anexos, checklist

| Tabela | Campos | Regra |
|---|---|---|
| `debt_proposals` | `debt_id` ou `group_id`, `proposed_on`, `amount_cents`, `payment_kind` (à vista · parcelado), `down_payment_cents`, `installments`, `installment_cents`, `method` (Pix, boleto, débito), `valid_until`, `source` (Serasa Limpa Nome, credor, assessoria, feirão, advogado), `condition_text` (texto como veio), `status` (ativa · substituída · aceita · expirada · recusada) | **Só cresce**: nova proposta substitui a anterior, nunca a sobrescreve |
| `debt_agreements` | `code` (`AD-00001`), `agreed_on`, `total_cents`, `down_payment_cents`, `installments`, `method`, `negotiated_by`, `contact_id`, `channel`, `proposal_id`, `base_cents` (S congelado), `discount_cents`, `surcharge_cents`, **`discount_recognition`/`surcharge_recognition` (congelados da configuração no dia do acordo)**, **`broken_tolerance_bdays` (nulo = o da rede; preenchido conforme o termo)**, **`approved_by`/`approved_at`**, `status` (**aguardando aprovação** · em andamento · quebrado · **restabelecido** · cumprido · substituído · desfeito), `previous_agreement_id` | As **parcelas são `payables`** — não há tabela de parcelas |
| `debt_agreement_debts` | (`agreement_id`, `debt_id`, `base_cents`) | Um acordo pode cobrir várias dívidas (grupo) |
| `debt_contacts` | `debt_id`, `occurred_at`, `channel`, `contact_id`, `summary`, `user_id` | Linha do tempo; só cresce |
| `debt_attachments` | `debt_id`, `kind`, `ref_table`/`ref_id`, `path`, `file_name`, `uploaded_by`, `removed_at`/`removed_reason` | Bucket privado **`dividas`** (10 MB, PDF/imagens), URL assinada |
| `debt_closing_items` | `debt_id`, `item`, `applicable`, `done_on`, `done_by`, `attachment_id` | Nasce ao quitar, só com os itens que se aplicam |

### 2.6 Histórico, importação, fotografia, avisos

| Tabela | Para quê |
|---|---|
| `debt_events` | Eventos de negócio (situação manual **e automática**, acordo, aprovação, restabelecimento, quitação, importação, desfazer) — só cresce. A aba **Histórico** = `debt_events` + `audit_changes` das tabelas da dívida, pela porta `debt_history(debt_id)` |
| `debt_import_templates` | Mapeamento coluna → campo salvo como modelo (o da planilha da rede vira o padrão) |
| `debt_import_batches` / `debt_import_rows` | Arquivo, quem, quando, situação; cada linha com o mapeado, avisos, erros e decisão (importar · corrigir · ignorar · vincular a título existente). A conferência sobrevive a recarregar a página e permite **desfazer o lote** |
| `debt_month_positions` | Fotografia mensal **por dívida** (seção 4.5) |
| `debt_notices` | Dedupe dos avisos (uma vez por dívida/assunto/referência) |

### 2.7 Permissões e RLS

- Capacidades novas em `CAPACIDADES`: `modulo.dividas`, `acao.dividas.lancar`,
  `acao.dividas.renegociar`, `acao.dividas.importar`,
  `acao.dividas.configurar`, `acao.dividas.excluir` — padrão **Financeiro da
  Franqueadora** (Admin Master sempre passa). `acao.dividas.aprovar_acordo`:
  **só Admin Master** (D8). `acao.dividas.ver_unidade` (futuro Gerente, só
  leitura da própria unidade) — nasce **sem papel**.
- **Teto no banco** (`debt_can(capacidade, clinic_id)`): mesmo que alguém marque
  outro papel na matriz, o banco só aceita Admin Master/Principal e
  `finance_franchisor` — a exceção futura é `ver_unidade`, limitada à unidade
  da pessoa e sem contatos/anexos.
- **RLS:** toda `debt_*` tem só regra de leitura
  `debt_can('modulo.dividas', clinic_id)`; **nenhuma regra de escrita** — tudo
  por função `security definer` com guarda; funções internas com `revoke`.
  Bucket `dividas` com a mesma guarda em `storage.objects`.
- **Fora dos relatórios gerais:** nenhuma tela existente lê `debt_*`. O que
  aparece fora é **só o título** no Contas a Pagar do CNPJ (D1).

---

## 3. Mapa das telas e dos fluxos

**Menu:** Financeiro → grupo **Rede** → **Levantamento de Dívidas**
(`/financeiro/dividas`). Só aparece com a Franqueadora ativa.

**Abas:** Painel · Dívidas · Acordos · Credores · Configurações.

- **Painel** — seletor de devedor + "Rede consolidada"; cards da 3.10 com o
  **subtotal contestado/judicial separado** (D17); card **CNPJs com
  restrição** (sugestão 4); gráficos (evolução mensal por devedor e
  consolidado, por categoria, natureza, credor, aging, comparativo); filtro por
  etiqueta em todos.
- **Dívidas** — tabela com busca, os filtros da 3.9, ordenação, selos
  (Negativada · Protestada · Judicial · Proposta vencendo · Acordo quebrado ·
  Desdobrar · Informação velha), totais no rodapé respeitando os filtros,
  botões **Nova dívida**, **Importar planilha**, **Baixar planilha-modelo**,
  **Exportar (Excel/PDF)**, seleção para o simulador (fase 8).
- **Acordos** — aguardando aprovação, em andamento, quebrados; saldo a pagar,
  parcelas dos próximos 30 dias.
- **Credores** — credores com dívidas (total, nº, contatos, assessoria); abre a
  ficha do fornecedor + contatos de cobrança.
- **Configurações** — regra de inadimplência (rede, devedor, categoria de
  credor), tolerância do acordo quebrado, valor para aprovação de acordo,
  reconhecimento do desconto/encargos, datas de implantação,
  categorias/subcategorias, naturezas e contas, etiquetas, modelos de
  importação.
- **Qualidade dos dados** (sugestão 1, fase 4) — sem nº de contrato, sem valor
  original, CNPJ incompleto, "A classificar", vencimento igual à data do
  levantamento, protesto sem dívida ligada, linha para desdobrar, conferência
  com mais de 60 dias.

**Detalhe da dívida** (`/financeiro/dividas/[id]`): cabeçalho com código,
devedor (razão social + CNPJ), credor, situação, saldo e selos; botões
**Renegociar dívida · Registrar proposta · Registrar pagamento · Registrar
contato**; seções **Dados · Restrições · Propostas · Acordos e pagamentos ·
Contatos · Anexos · Histórico**.

### 3.1 Cadastro (manual)

1. Devedor → credor (busca no cadastro de fornecedores; "novo credor" abre o
   cadastro em janela) → categoria/subcategoria (natureza e conta vêm junto) →
   valores e datas (emissão/competência) → parcelas (1 ou N vencimentos).
2. **Origem:** sugerida pela data em que a dívida nasceu × implantação. Se
   houver título parecido no Contas a Pagar do mesmo CNPJ, o sistema mostra e
   **sugere C (vincular)**.
3. **Resumo do impacto** → Confirmar. Tudo numa transação.

### 3.2 Renegociar dívida (o fluxo principal)

```
[Renegociar dívida]
  1. O QUE ENTRA   esta dívida · o grupo · outras do mesmo credor e devedor
                   base S = soma do que falta pagar (por título)
  2. CONDIÇÕES     data do acordo · total T (pré-preenchido da proposta ativa)
                   entrada · nº de parcelas · tabela de vencimentos/valores
                   (editável; a última absorve o resíduo) · forma de pagamento
                   tolerância para quebra (padrão da rede ou a do termo)
                   quem negociou · com quem (contato/assessoria) · canal
  3. IMPACTO       "N títulos viram 'renegociada' (R$ S)"
                   "nascem 1 + k títulos na conta 5.5.02 (R$ T)"
                   "desconto obtido R$ S−T → 4.1.03 (na data do acordo |
                    a cada parcela paga)"
                   [Confirmar]
     └─ T acima do valor de aprovação → "Aguardando aprovação do Admin Master"
        (nada é gerado até aprovar; aviso crítico ao Admin)
  4. DOCUMENTOS    termo do acordo, boletos (pode anexar depois)
→ situação: Acordo em andamento · proposta usada vira "aceita"
```

Cada parcela do acordo é baixada pelo **Registrar pagamento** — a mesma
função do Contas a Pagar. Parcela vencida sem pagamento: no **dia seguinte**,
aviso **"parcela de acordo em atraso"**; passada a **tolerância** (3 dias
úteis na rede, ou a do acordo), **Acordo quebrado** + aviso crítico. Sobre o
acordo quebrado: **Renegociar de novo** ou **Credor restabeleceu a dívida**
(1.3, item 6). **Desfazer acordo** só sem nenhuma parcela paga.

### 3.3 Quitação e encerramento

Saldo zero → **Quitada — pendências de baixa** → checklist com os itens
aplicáveis (quitação; baixa da negativação, contando 5 dias úteis; anuência e
custas/protesto cancelado se protestada; processo extinto se houver ação).
Checklist completo → **Quitada — encerrada**.

### 3.4 Importação em lote

```
Enviar arquivo (XLSX/CSV) → escolher modelo de mapeamento (ou mapear e salvar)
→ conferência:  ✔ ok · ⚠ aviso · ✖ erro (motivo; corrigir na linha ou ignorar)
                credores e categorias que serão criados (confirmar)
                duplicidade dentro do arquivo e contra as dívidas já cadastradas
                título parecido no Contas a Pagar do CNPJ → sugerir C (vincular)
                origem = coluna "Origem do lançamento" (D2)
                "Grupo de dívidas" → 1 dívida, desdobrar depois, quantidade (D11)
                protestos: vincular / nova dívida / "Verificar" decide o usuário
→ resumo do impacto por CNPJ (títulos, contas, DRE)
→ gravar (um lote, uma transação) + etiqueta automática "importação dd/mm/aaaa"
→ conferência pós-importação: total importado por CNPJ × totais de referência
→ "Desfazer importação" enquanto nenhuma dívida do lote foi paga/renegociada
```

---

## 4. Regras de negócio e automações

### 4.1 Situação (uma regra só, no banco, espelhada em TS)

Precedência, de cima para baixo:

1. **Baixada/Cancelada** (manual, com motivo)
2. **Quitada — encerrada** / **Quitada — pendências de baixa** (saldo zero)
3. **Contestada** · **Em discussão judicial** (manual)
4. **Acordo quebrado** (parcela do acordo vencida além da tolerância)
5. **Acordo em andamento** (inclui "aguardando aprovação", com selo próprio)
6. **Em negociação** (manual — D10)
7. **Inadimplente** (atraso > prazo da regra: **tipo do credor → devedor →
   rede**; padrão 30 — o mais específico manda, como na alçada do Contas a
   Pagar; implementado assim na 0404)
8. **Em atraso** (1º ao prazo)
9. **A vencer**

Proposta ativa **não** muda a situação: vira selo e filtro.

**Gravada e calculada pela mesma regra:** `_debt_compute_status` é chamada
pelos gatilhos (pagamento, acordo, edição) e por uma **rotina diária** de
madrugada, que grava a mudança e registra o evento (inclusive "virou
inadimplente automaticamente").

### 4.2 Valores

- **Saldo devedor** = soma do que falta nos títulos ativos da dívida (ou do
  acordo vigente).
- **Economia potencial** e **desconto médio** só contam dívida **com proposta
  ativa**; **estimado para regularizar** = proposta, se houver, senão valor
  atualizado; **sem proposta** à parte (regra 3.9.2). **Custo total para
  regularizar** = estimado + custas de cartório em aberto.
- **Contestada e judicial entram nos totais**, com o **subtotal mostrado à
  parte** nos cards e filtro para tirar (D17).
- Alerta (não bloqueia) quando a proposta é **maior** que o valor atualizado.

### 4.3 Aging

Faixas 1–30, 31–60, 61–90, 91–180, 181–365, >365 pelo vencimento do título
mais antigo em aberto (no acordo, pela parcela do acordo).

### 4.4 Avisos (rotina diária + porta `_debt_notify`, dedupe em `debt_notices`)

| Aviso | Quando | Admin Master? |
|---|---|---|
| Proposta vencendo | 7 e 2 dias antes da validade | não |
| Parcela de acordo vencendo | 3 dias antes | não |
| **Parcela de acordo em atraso** | dia seguinte ao vencimento sem pagamento | não |
| **Acordo quebrado** | passada a tolerância | **sim** |
| **Acordo aguardando aprovação** | ao registrar acordo acima do valor | **sim** (é quem aprova) |
| **Novo protesto ou ação judicial lançados** | ao lançar | **sim** |
| Prestes a virar inadimplente | `about_to_default_days` antes do prazo | não |
| Checklist parado / baixa da negativação não confirmada | `closing_stale_days`; 5 dias úteis após o pagamento | não |
| Próxima ação vencida | `next_action_on` < hoje | não |

Quem recebe (D12): o **responsável** da dívida; sem responsável, os
Financeiros da Franqueadora. **O Admin Master recebe só os críticos**
marcados acima. Sino com categoria própria pelo link `/financeiro/dividas`.
**Títulos de saldo de implantação nunca geram aviso um a um** (D1-c).

### 4.5 Evolução mensal — fotografia, não reconstrução

**Fotografia mensal por dívida** (`debt_month_positions`: saldo, valor
atualizado, situação, categoria, natureza, tags, pago no mês, nova no mês). A
reconstrução pelo log falha aqui: o "valor atualizado" muda sem evento
financeiro, a importação traz dívidas com datas antigas e a categoria pode ser
corrigida depois — o gráfico de outubro mudaria em dezembro.

- Gravada pela rotina diária no **1º dia do mês** (fecha o mês anterior); o
  mês corrente é calculado ao vivo.
- **Por dívida** para filtrar por etiqueta/categoria no passado.
- **Começa a contar na importação (fase 4)**; antes disso o gráfico diz "sem
  histórico", em vez de inventar.

### 4.6 Indicadores de saúde financeira

- **Endividamento ÷ faturamento médio mensal** (receita bruta da DRE, média dos
  3 meses fechados) = "quantos meses de receita".
- **Comprometimento do caixa** = parcelas de acordo do mês ÷ receita do mês.
- **Custo financeiro** = 4.2.01 + encargos de dívidas pagos no período.
- Unidade sem DRE alimentada mostra "sem dados", não zero.

### 4.7 Aprovação de acordo (D8)

`agreement_approval_threshold_cents` na rede, **nulo = desligado** (padrão;
o dono define o valor depois). Ligado: acordo com total acima fica
**aguardando aprovação** do Admin Master — nenhum título nasce, nenhum título
original vira `renegociada`, nada vai ao razão até aprovar. Recusar volta a
dívida ao estado anterior, com motivo no histórico. Quem registrou não aprova
o próprio acordo (o Admin Master que registra precisa de outro Admin).

---

## 5. Plano de fases

| Fase | Entrega | Migração (estimada) |
|---|---|---|
| **0. Preparo** ✅ | `_dados_importacao/` no `.gitignore` (commit `aab08519`); decisões registradas; CNPJs conferidos (seção 7) | — |
| **1. Base** ✅ 0.442.0 | Configurações (categorias, subcategorias, naturezas, etiquetas, regra de inadimplência, tolerância, valor de aprovação, reconhecimento, data de implantação), credores (fornecedor + contatos de cobrança), cadastro/edição/exclusão lógica (origem gravada, ainda **sem gerar título**), grupos e "dívidas reunidas", situação + rotina diária, lista com filtros e totais, detalhe (Dados, Contatos, Histórico), auditoria, permissões e RLS | 0404 |
| **2. Restrições, propostas e anexos** ✅ 0.443.0 | Negativação, protesto (cartórios), judicial, notificação, histórico de propostas, anexos (bucket `dividas`), linha do tempo de contatos, selos, **data da última conferência** (sug. 2) | 0405 |
| **3. Integração com Contas a Pagar** ✅ 0.445.0 | Contas novas (5.5.01, 5.5.02, 4.1.03, custas — "a validar com o contador"); **regra única "fora do resultado"** em todos os leitores do razão + **régua obrigatória** (incluindo indicadores da unidade inalterados e RLS do D1); `payables.debt_*` e situação `renegociada`; origens A/B/C com resumo do impacto e **sugestão de C por duplicidade**; gerar os títulos das dívidas já cadastradas; **selo e filtro "saldo de implantação"** (sug. 6) e **vencidas sem aviso por título** (linha única por CNPJ); Registrar pagamento pela dívida; edição/estorno; fluxo de caixa com **linha própria "Dívidas"** e faixa **vencido não pago**; relatório de saldo de abertura. *Entregue sem a situação `renegociada` do título: ela só tem uso quando o acordo substitui os títulos, e entra na fase 5 junto com quem a grava.* | 0406 |
| **4. Importação** | Mapeamento + modelos, planilha-modelo, conferência, duplicidade (arquivo, dívidas e Contas a Pagar), origem pela coluna, "Grupo de dívidas", protestos, criação de credores/categorias, lote/desfazer, conferência por CNPJ, **etiqueta automática** (sug. 7), **tela Qualidade dos dados** (sug. 1); **fotografia mensal começa aqui**. Carga real só depois do OK do dono sobre as pendências da planilha | 0407 |
| **5. Renegociação e encerramento** | Situação `renegociada` no título (veio da fase 3); renegociar (3.2), parcelas como títulos, desconto/encargos com as duas formas de reconhecimento, **aprovação acima do valor**, aviso de parcela em atraso, **acordo quebrado com tolerância** (rede e por acordo), **credor restabeleceu a dívida** (estorno com data de hoje), desfazer, checklist de encerramento, aba Acordos | 0408 |
| **6. Painel e gráficos** | Cards da 3.10 (com subtotal contestado/judicial), **CNPJs com restrição** (sug. 4), evolução mensal (por devedor, consolidado, por categoria), distribuições, aging, comparativo, filtro por etiqueta | — (lê a fotografia) |
| **7. Saúde financeira e visões** | Indicadores de saúde, cenário de proposta no fluxo de caixa, card "Dívidas da unidade" (desligado), exportação Excel/PDF | 0409 (se precisar) |
| **8. Alertas e simulador** | Os avisos da 4.4 (com o Admin Master só nos críticos), simulador de quitação (conjunto, valor disponível = caixa projetado, ordem sugerida) | 0410 |

Os números de migração são estimativa: confiro com `git pull` antes de cada
fase. Cada fase termina com: migração no treino (`migrar:teste`) + ensaio em
transação desfeita (inclusive RLS com `set local role authenticated`, para
cada papel), portão (`verificar`, `test`, `lint`), commit,
`ESTADO_DO_PROJETO.md`, `changelog.ts` + seção do manual e o Word regerado.
A produção roda quem é dono.

**Backlog para depois da fase 8** (aprovadas, sem fase): sugestão 3
(prioridade sugerida automaticamente), 5 (modelos de mensagem ao credor), 9
(agenda de pagamentos dos acordos em calendário) e 10 (resumo mensal para o
dono). **Fora por enquanto:** sugestão 8 (prescrição), até validar com o
advogado.

---

## 6. Decisões do dono (13/11/2026)

| # | Decisão |
|---|---|
| **D0** | ✅ Feito: `_dados_importacao/` no `.gitignore`, conferido com `git check-ignore`, commit só disso (`aab08519`) |
| **D1** | Aprovado, com condições: (a) unidade franqueada não enxerga título da franqueadora — provado por teste de RLS na fase 3; (b) selo e filtro "saldo de implantação" na fase 3; (c) nenhum aviso de vencida por título de saldo de implantação — um aviso/linha única por CNPJ |
| **D2** | Implantação em **16/11/2026** nos três CNPJs. Origem pela data em que a dívida **nasceu**, nunca pelo vencimento. Toda a planilha é origem A; na importação vale a coluna "Origem do lançamento" |
| **D3** | Conferido no banco — **divergência na produção** (seção 7). Não corrigido: aguarda o dono |
| **D4** | Credor = Fornecedor |
| **D5** | Contas novas aprovadas, "a validar com o contador". A regra "fora da DRE" em **um lugar só**, reutilizado por todos os leitores; régua da fase 3 obrigatória |
| **D6** | Juros/multa na DRE quando pagos ou fixados em acordo |
| **D7** | Origem A com o valor atualizado na data de implantação |
| **D8** | Títulos sem alçada. **Acordo acima de valor configurável** espera aprovação do Admin Master; padrão desligado |
| **D9** | Dia seguinte ao vencimento: aviso "parcela de acordo em atraso". "Acordo quebrado" só depois da **tolerância: 3 dias úteis** na rede, informável por acordo (conforme o termo) |
| **D10** | "Em negociação" à mão |
| **D11** | "Grupo de dívidas" entra como **uma dívida**, marcada para desdobrar, com a **quantidade reunida**. Vale para as ofertas do Serasa que juntam dívidas do mesmo credor e, por ora, também para as de banco; o dono detalha os contratos depois |
| **D12** | Responsável → Financeiros da Franqueadora. Admin Master **só os críticos**: acordo quebrado, novo protesto/ação judicial, acordo aguardando aprovação |
| **D13** | Avalista/negativação de sócio: só o nome |
| **D14** | Faixa "vencido não pago" para toda conta a pagar |
| **D15** | Ordem das fases aprovada |
| **D16** | Protesto ligado a uma dívida ou a um grupo |
| **D17** | Contestada/judicial nos totais, **com subtotal separado nos cards** |
| **D18** | CNPJ só pela raiz: provisório, com pendência |

**Ajustes do dono ao plano:** (1) "credor restabeleceu a dívida" e as duas
formas de reconhecer desconto/encargos (1.3); (2) duplicidade contra o Contas a
Pagar existente sugerindo C (1.3, 3.1, 3.4); (3) linha própria "Dívidas" no
fluxo de caixa, realizado e previsto (1.3); (4) indicadores da unidade
inalterados, presos pela régua da fase 3 (1.3).

---

## 7. Conferência dos CNPJs (D3) — 13/11/2026, só leitura

Esperado (dono): **Londrina 32.042.156/0001-21 · Cambé 28.375.429/0001-82 ·
Administração 46.232.307/0001-19** (franqueadora, `type = 'franchisor'`). Os
três passam no dígito verificador.

**Produção** (`hvhbijctanrrkxhemlza`):

| Código | Unidade | Tipo | CNPJ no banco | Bate? |
|---|---|---|---|---|
| RF | RISARTE Franchising (razão social "RISARTE ADMINISTRACAO E GERENCIAMENTO COMERCIAL LTDA - ME") | franchisor | 32.042.156/0001-21 | ❌ **é o CNPJ de Londrina**; o esperado é 46.232.307/0001-19 |
| CBE | Risarte Cambé - Centro | franchise_unit | 28.375.429/0001-82 | ✅ |
| LDN | Risarte Londrina - Centro | franchise_unit | 32.042.156/0001-21 | ✅ |

**Treino** (`bsnptybalszjjbhxeejo`): só Londrina tem CNPJ (o certo); a RISARTE
Franchising, Cambé e as unidades de teste estão **sem CNPJ**.

**Não corrigi nada** (ordem do dono). Consequência para o plano: a importação
acha o devedor pelo CNPJ, então **com dois cadastros no mesmo CNPJ ela recusa
a linha** ("CNPJ ambíguo") em vez de escolher um — e a fase 4 só roda com o
CNPJ da franqueadora corrigido na produção e preenchido no treino.
