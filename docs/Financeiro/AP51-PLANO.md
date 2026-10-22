# AP51 — Em qual conta o dinheiro entrou ou saiu (plano)

*22/10/2026 · pedido do dono: "pode corrigir o AP51"*

## 1. O que foi confirmado (antes de mexer)

- **Defeito confirmado no código, sem efeito hoje.** O "Saldo pelo sistema" da
  Conciliação de uma conta bancária é o saldo de abertura DELA somado a TODO o
  dinheiro da unidade desde aquela data — de qualquer conta
  (`summarizeReconciliation` + a leitura da página). Com uma conta só, bate;
  com duas (corrente + aplicação), a diferença das duas sai errada.
  Produção: **0 contas bancárias**; treino: 1 (Cambé). Ninguém é afetado hoje.
- **Mesma raiz, achado agora:** o recebimento **em dinheiro** no balcão entra
  no saldo pelo sistema e é comparado com o extrato do banco — o dinheiro na
  gaveta aparece como diferença até ser depositado.
- **A causa:** o razão (`financial_entries`) não guarda em qual conta (ou no
  caixa físico) o dinheiro entrou/saiu.
- **Item 2 (casar a maquininha sozinho):** não é defeito; seria módulo novo
  (importar o relatório da adquirente). **Decisão do dono: depois** — fica no
  BACKLOG.
- **Item 3 (lentidão do "Casar"):** suspeita não medida; segue no BACKLOG.

## 2. Decisão já tomada (22/10/2026)

**Escolher a conta na baixa.** Ao receber ou pagar, o campo "Entrou em" /
"Saiu de" lista as contas da unidade + o Caixa (dinheiro), já preenchido
quando há uma escolha óbvia.

## 3. O que já existe e será reaproveitado

- `bank_accounts.kind` já aceita **`caixa`** (além de corrente, poupança e
  aplicação): o dinheiro em espécie vira uma "conta" da unidade, sem tabela
  nova.
- A **transferência entre contas próprias** já existe na Conciliação (conta
  **6.3.01**, ativo, fora da DRE — OC-00108).

## 4. O que muda

**Banco (migração 0317, no treino primeiro):**
- `financial_entries.bank_account_id` (anulável) — onde o dinheiro está.
- As funções que lançam dinheiro passam a receber/gravar a conta:
  `register_payment_receipt` (recebimento, multa/juros, benefício perdido),
  `register_payable_payment` (pagamento, multa/juros), Pagar a nota (0300),
  e os **estornos herdam a conta** do original. Taxa da adquirente e de
  emissão de boleto herdam a conta do recebimento. O que vem da Conciliação
  (Lançar, Pagar conta, Transferência) já sabe a conta: a da linha do extrato.
- Parâmetro novo com **padrão** (quem chama do jeito antigo continua
  funcionando — a janela entre o código e a migração).
- Conta **principal** da unidade (`bank_accounts.is_default`), uma por
  unidade.

**Telas:**
- Baixa nos Recebíveis (e na ficha do cliente), Pagar em Contas a pagar e
  Pagar a nota: o campo "Entrou em" / "Saiu de".
- Conciliação: o saldo pelo sistema de cada conta conta **só o que é dela**.
  O Caixa aparece como conta sem extrato, com o saldo pelo sistema para
  conferir com a gaveta.
- Cadastro de contas: marcar a principal; criar o Caixa.

**Não muda:** DRE, Fluxo de caixa (soma tudo, como hoje), Painel da rede.

## 5. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **L1** | O **Caixa (dinheiro)** da unidade | **Criado sozinho** na primeira baixa em dinheiro, um por unidade (tipo "caixa" do cadastro) |
| **L2** | Cartão, Pix e boleto: qual conta vem preenchida | **A conta principal** da unidade (com uma conta só, é ela); dá para trocar na hora |
| **L3** | O que já foi lançado antes, sem conta | **Conta como da principal** (nada muda para quem tem uma conta); os recebimentos antigos **em dinheiro** passam para o Caixa |
| **L4** | O depósito do dinheiro no banco | Na Conciliação, a linha do depósito vira **"Transferência do Caixa"**: entra no banco e sai do Caixa, sem mexer no resultado |

### Decisões do dono (22/10/2026) — as quatro como recomendado

| # | Decisão |
|---|---|
| L1 | O **Caixa** da unidade é **criado sozinho** na primeira baixa em dinheiro (tipo "caixa" do cadastro), um por unidade |
| L2 | Cartão, Pix e boleto vêm com a **conta principal** da unidade; dá para trocar na hora; dinheiro vem com o Caixa |
| L3 | O lançamento antigo **sem conta conta como da principal**; os recebimentos antigos **em dinheiro** passam para o Caixa |
| L4 | O depósito do dinheiro no banco vira **"Transferência do Caixa"** na Conciliação (entra no banco e sai do Caixa, conta 6.3.01) |

✅ OK do dono em 22/10/2026 ("pode começar o código do AP51").

---

## O que foi feito (0.342.0, migração 0317)

- **Um gatilho decide a conta de todo lançamento com dinheiro**
  (`financial_entry_bank_account`), em vez de mexer função por função —
  assim nenhum caminho fica de fora (inclusive os de dentro do banco, como
  Pagar conta pela conciliação e Pagar a nota). As funções de sempre não
  mudaram de assinatura; a escolha da tela entra por três portas novas
  (`register_payment_receipt_to`, `register_payable_payment_from`,
  `pay_stock_purchase_from`), que marcam a escolha e a limpam depois — o
  ensaio pegou que, sem limpar, a escolha vazava para a baixa seguinte da
  mesma transação.
- **Casar com o extrato move o lançamento para a conta da linha** (o extrato
  é a prova de onde o dinheiro está). Não estava no plano; resolve sozinho o
  "Pagar conta" pela conciliação e o caso de alguém casar dinheiro do caixa
  com o depósito.
- **Pagamento em dinheiro também vai para o Caixa** (o plano falava de
  recebimento): sai da gaveta do mesmo jeito.
- Antes da 0317 num banco, a tela segue pela função de sempre e lê a conta e
  a principal à parte — tudo conta como antes.
- Provado: ensaio 24/24, quebra da migração 10/10, 13 testes com quebra 7/7,
  tela no treino (EV-208).

## 6. Como vai ser provado

Ensaio da migração no treino (transação desfeita, arquivo 2×) e prova de
quebra: receber em dinheiro cai no Caixa; receber no cartão cai na principal;
pagar por outra conta sai dela; estorno volta na mesma conta; com duas contas,
cada saldo pelo sistema conta só o dela; quem chama sem a conta (código antigo)
continua funcionando. Testes da parte pura com prova de quebra. Tela no treino
com o Admin de teste na Cambé (a unidade da conta bancária de ensaio), sem
gravar dinheiro de verdade fora de transação desfeita.
