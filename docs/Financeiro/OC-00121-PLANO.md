# OC-00121 — o Painel da Rede por área, com "abrir na unidade" (plano, sem código)

*22/10/2026 · relato OC-00121 (Admin Master, sugestão): "colocar botões para
ver a rede por assunto — contas a pagar, recebíveis, fluxo de caixa, DRE —
com o total da rede e cada unidade; clicar na unidade e abrir o relatório
dela no ambiente dela; indicar quem puxa o resultado para cima ou para
baixo".*

> **Em uma frase:** o Painel da Rede ganha uma aba por assunto (Visão geral,
> Contas a pagar, Recebíveis, Fluxo de caixa, DRE). Cada aba mostra o total da
> rede, cada unidade com a cor de quem puxa para cima ou para baixo, e o
> botão **abrir na unidade**, que troca a unidade de trabalho e abre o
> relatório dela.

---

## 1. Não é defeito: é melhoria

O Painel da Rede (FIN8.3) faz o que foi combinado: responde "**em qual unidade
eu entro primeiro?**" — alertas, taxas da rede, a receber vencido e mês não
fechado. As outras perguntas estão **espalhadas**:

| Assunto | Hoje | Falta |
|---|---|---|
| Recebíveis | **Recebíveis da rede**: a receber, vencido e inadimplência por unidade, em ordem de atenção | o **recebido no mês**; abrir a unidade |
| DRE | **Consolidado → visão Rede**: receita, resultado e margem por unidade, "vs média" | ficar junto do resto; abrir a unidade |
| Contas a pagar | **não existe na rede** (só as taxas que a rede cobra) | tudo |
| Fluxo de caixa | **não existe na rede** (só o alerta "caixa negativo previsto") | tudo |
| Abrir a unidade | **nenhuma tela faz**: hoje é trocar a unidade no menu, cair no Início e procurar o relatório | o clique que já abre o relatório dela |

**A regra que vale (CLAUDE.md §8b) e não muda:** só a Franqueadora vê a rede
(Admin Master e Financeiro da Franqueadora) — **o Gerente nunca vê o
financeiro de outra unidade**. E **"Faturamento da Rede" não é "Resultado do
Grupo"**: somar o faturamento das franqueadas é comparação (benchmarking), não o
resultado da Franqueadora — a aba DRE diz isso na tela, como o Consolidado já diz.

---

## 2. Como vai funcionar

### 2.1. As abas (decisão K1)

No alto do Painel da Rede: **Visão geral · Contas a pagar · Recebíveis · Fluxo
de caixa · DRE**. Cada aba tem:

- **cartões com o total da rede** (o que importa daquele assunto);
- **a tabela por unidade**, em ordem de atenção, com a cor de cada uma (K3);
- em cada linha, **abrir na unidade** (K2).

| Aba | Total da rede | Por unidade |
|---|---|---|
| Visão geral | o que existe hoje (alertas, taxas, mês fechado) | idem, + abrir na unidade |
| Contas a pagar | a pagar · vencidas · a autorizar · pago no mês | as mesmas quatro colunas |
| Recebíveis | a receber · vencido · inadimplência · **recebido no mês** | as mesmas + a taxa contra o limite da unidade |
| Fluxo de caixa | entradas e saídas do mês · saldo previsto | entradas, saídas, saldo, **primeiro dia negativo previsto** |
| DRE | faturamento da rede · resultado somado · margem média | receita, resultado, margem, **vs média** |

### 2.2. "Abrir na unidade" (decisão K2)

O clique troca a **unidade de trabalho** para aquela unidade e abre o relatório
do mesmo assunto **dela** (o DRE da unidade, o contas a pagar da unidade…), com
o mesmo período. Lá em cima aparece uma faixa: **"Você está no financeiro da
Unidade X — voltar para a rede"** (hoje, dentro de uma unidade, o grupo "Rede"
some do menu e o caminho de volta não é óbvio).

### 2.3. Quem puxa para cima ou para baixo (decisão K3)

Cada unidade ganha uma cor em relação à **média da rede** naquele assunto (com
a frase do porquê, nunca só a cor): verde = melhor que a média, âmbar = perto,
vermelho = pior. Em contas a pagar e recebíveis, o "pior" é o **vencido**; no
fluxo de caixa, o **saldo previsto negativo**; no DRE, a **margem** (K3).

---

## 3. O que muda no banco (migração, no treino primeiro)

- `network_payables(de, até)` — contas a pagar por unidade (a pagar, vencidas,
  a autorizar, pago no período). Só Admin e Financeiro da Franqueadora.
- `network_cash_flow(de, até)` — por unidade: entradas, saídas, saldo e o
  primeiro dia negativo previsto (a mesma conta do Fluxo de caixa da unidade).
- `network_receivables` ganha o **recebido no período**.
- O DRE por unidade usa o que já existe (`network_units_summary`).
- Nada de tabela nova; leitura apenas.

## 4. Telas

| Tela | O que muda |
|---|---|
| Financeiro → Rede → **Painel da rede** | as cinco abas; abrir na unidade em cada linha |
| Financeiro de uma unidade (quando Admin/Financeiro da Franqueadora) | a faixa "voltar para a rede" |
| Recebíveis da rede e Consolidado | continuam (são o detalhe); ganham o "abrir na unidade" |

---

## 5. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **K1** | Onde fica | **No próprio Painel da Rede, em abas** (um lugar só para comparar) |
| **K2** | O clique na unidade | **Troca a unidade de trabalho e abre o relatório dela**, com a faixa "voltar para a rede" |
| **K3** | "Puxando para cima ou para baixo" no DRE | **Pela margem (%) contra a média da rede** — unidade grande e pequena comparam igual; o valor em R$ aparece ao lado |
| **K4** | Período | **Mês corrente, com seletor de mês** (o mesmo do Painel) |

### Decisões do dono (22/10/2026) — as quatro como recomendado

| # | Decisão |
|---|---|
| K1 | **Abas no Painel da Rede**: Visão geral · Contas a pagar · Recebíveis · Fluxo de caixa · DRE |
| K2 | O clique **entra na unidade** (troca a unidade de trabalho) e abre o relatório do mesmo assunto, no mesmo mês; faixa "voltar para a rede" |
| K3 | No DRE, **margem (%) contra a média da rede**; o valor em R$ ao lado |
| K4 | **Mês corrente, com seletor de ano/mês** |

⏳ Aguardando o OK do dono para começar o código.

---

## 6. Como vai ser provado

Ensaio das funções novas no treino (transação desfeita): a soma por unidade
bate com a tela da própria unidade (contas a pagar, recebíveis, fluxo, DRE); o
Gerente e o Franqueado recebem nada; sem login, recusa. Testes da parte pura
(as cores, a ordem, a média) com prova de quebra. Tela no treino como Admin e
como Financeiro da Franqueadora de teste: abrir na unidade e voltar para a rede.
