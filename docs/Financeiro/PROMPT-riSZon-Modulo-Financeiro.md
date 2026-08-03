# PROMPT — Módulo Financeiro do riSZon (v2 — com decisões de negócio fechadas)

> **Como usar:** salve `DOCUMENTO-BASE-FINANCEIRO.md` em `docs/financeiro/` dentro do repositório antes de colar este prompt. Abra o Claude Code na pasta do projeto, em sessão nova, e cole tudo abaixo da linha.

---

Vamos construir o **Módulo Financeiro do riSZon**. Leia este prompt inteiro antes de escrever qualquer código. Sua proposta anterior de FIN1/FIN2 está correta no espírito, mas precisa de um ajuste estrutural que explico na seção 2.

## 1. Leia antes de propor qualquer coisa

- `CLAUDE.md` — convenções travadas do projeto
- `ESTADO_DO_PROJETO.md` — onde paramos
- `docs/financeiro/DOCUMENTO-BASE-FINANCEIRO.md` — especificação funcional aprovada
- Schema atual do Supabase: `payment_installments`, tabelas de venda/negociação do I9, matriz de permissões, políticas RLS

Depois de ler, me diga em 5 linhas o que já existe de aproveitável e o que falta. Não comece a codar.

## 2. Correção estrutural na sua proposta

Você propôs começar pela aba Financeiro da ficha do cliente lendo direto de `payment_installments`. Isso resolve a tela e cria um silo: quando chegarmos em DRE, DFC, ponto de equilíbrio e consolidação da rede, nada fecha, porque não existe plano de contas, centro de custo nem separação entre competência e caixa.

**Regra:** a aba do cliente é uma *visão* sobre uma base contábil, não a base. Entra um **FIN0** antes do seu FIN1 — fundação, pouco código, nenhuma tela complexa.

Ordem: **FIN0 → FIN1 (aba do cliente) → FIN2 (renegociação) → demais fases.**

## 3. Decisões técnicas travadas — não precisa perguntar

1. **Papel "Financeiro da Franqueadora": criar no FIN0**, com escopo de unidades, no padrão dos outros papéis da franqueadora. Prefiro mexer na matriz de permissões uma vez só. Deixe previsto, sem implementar, um papel **Auditor/Controladoria somente-leitura**.
2. **Multa e juros:** 2% de multa + 1% ao mês, pro rata die. Configuração em cascata: padrão da rede em `/admin` + override por unidade. O teto de 2% é limite do CDC para contrato de consumo parcelado — comente no código e valide na UI.
3. **Congelamento de taxas:** cada parcela guarda multa e juros vigentes no momento em que foi gerada. Mudar a config da rede não reescreve o passado.
4. **Dinheiro em inteiro de centavos** (`BIGINT`), nunca `float`. Se `payment_installments` usa outro tipo hoje, me avise antes de migrar.
5. **Idioma:** UI e mensagens em português do Brasil; código, tabelas, colunas e commits em inglês.
6. **Fora desta rodada:** split de pagamento, repasse de dentistas e honorário do consultor são fases posteriores — mas o modelo do FIN0 tem que comportá-los sem migração destrutiva.

## 4. Invariantes técnicas — todas as fases

- **Multi-tenant:** toda tabela nova tem `clinic_id` e política RLS. Sem exceção.
- **Competência × caixa:** todo lançamento tem `accrual_date` (fato gerador → DRE) e `cash_date` (movimentação real → DFC).
- **Nada se apaga.** Lançamento pago ou conciliado não é editado nem excluído: gera-se estorno com motivo obrigatório.
- **Rastreabilidade:** todo lançamento aponta para a origem (`source_type` + `source_id`). Qualquer número em qualquer relatório precisa permitir drill-down até o documento.
- **Auditoria:** `created_by`, `created_at`, `updated_by`, `updated_at` em tudo, mais log de ações sensíveis (baixa, estorno, renegociação, reabertura de período).
- **Idempotência:** dar baixa é idempotente. Duplo clique não gera dois recebimentos.
- **Arredondamento:** meio para cima; a última parcela absorve o resíduo de centavos. Com teste.
- **Cálculo isolado e testado:** juros, multa, valor atualizado, rateio, simulação de renegociação e apuração de repasse vivem em módulo puro, com testes unitários e tabela de casos fixos. Nenhuma regra de dinheiro dentro de componente de UI.
- **LGPD:** relatório gerencial usa identificador anonimizado do paciente.

## 5. Roadmap do módulo

Desenhe o roadmap inteiro antes de codar, para garantir que a fundação serve ao destino. **Executamos uma fase por vez, com plano aprovado antes do código.**

| Fase | Entrega | Ref. documento |
|---|---|---|
| **FIN0** | Fundação: plano de contas, centros de custo, razão de lançamentos, papel Financeiro, config de multa/juros | 6.1, 6.2, 6.16 |
| **FIN1** | Aba Financeiro na ficha do cliente / contas a receber | 6.3, 6.5 |
| **FIN2** | Renegociação de parcelas | 6.5 |
| **FIN3** | Contas a pagar, fornecedores, despesas recorrentes | 6.6 |
| **FIN4** | Conciliação bancária (OFX) + taxas de adquirente e liquidação D+n | 6.7 |
| **FIN5** | Repasse de dentistas, honorário do consultor, split de pagamento | 6.12 |
| **FIN6** | DRE gerencial + DFC com projeção 30/60/90 | 6.8, 6.9, 8.1, 8.2 |
| **FIN7** | Orçado × realizado, dashboards da unidade e da rede, central de alertas | 6.10, 10 |
| **FIN8** | Franqueadora: royalties, consolidação com eliminação intercompany, expansão e payback | 6.14, 6.15 |

Estoque (6.11) e rentabilidade por serviço (6.13) entram entre FIN5 e FIN6 — proponha onde encaixa melhor.

## 6. FIN0 — Fundação (planejar primeiro)

Objetivo: criar o esqueleto contábil que sustenta todas as telas. Preferencialmente **uma migração só**.

**Plano de contas** — hierárquico, código numérico ordenável (1, 1.1, 1.1.01), único para a rede, com descrição, tipo (receita/despesa), grupo, natureza e classificação **fixo/variável**. Essa flag é o que permite calcular ponto de equilíbrio depois; não deixe para adicionar depois. Contas da franqueadora e das unidades separadas, mesma árvore. Campo `fiscal_account_code` (nullable) para futuro de-para com o plano contábil. Proponha um seed enxuto para eu revisar.

**Centros de custo** — são dados, não enum: tabela com `code` (imutável), `name` (editável), `parent_id`, `scope` (`franchisor` | `network` | `unit`), `clinic_id` (nulo quando `franchisor` ou `network`) e `active`. Criar centro novo é operação de tela, sem migração. Unidade só cria centro como **filho de um centro `network`**, para preservar comparabilidade no consolidado. Centro com lançamento vinculado não é excluído nem tem o código alterado — apenas desativado. Reclassificação de lançamento em período fechado só por contra-lançamento com justificativa. Entregue no FIN0 a tela de gestão dessa árvore para Admin Master e Financeiro da Franqueadora.

**Razão de lançamentos** (`financial_entries`) — tabela central. Mínimo: `clinic_id`, conta, centro de custo, `accrual_date`, `cash_date`, valor em centavos, sentido, status, `source_type`, `source_id`, autoria. Contas a receber e a pagar são projeções sobre essa base, não bases paralelas.

**Configuração financeira em cascata** — tela em `/admin`: multa, juros ao mês, carência em dias, política de arredondamento. Padrão da rede + override por unidade, com indicação visual clara do que é herdado e do que foi sobrescrito.

**Papel Financeiro da Franqueadora** na matriz de permissões.

**Fechamento de período** — só a estrutura (período fechado por unidade e mês). A trava efetiva entra no FIN6.

## 7. Decisões de negócio — respondidas, use como estão

### 7.1 Estrutura jurídica e consolidação

As duas unidades atuais são **franqueadas**, CNPJs independentes da franqueadora. A franqueadora não tem operação clínica própria hoje, mas terá unidades próprias no futuro.

- Campo `ownership` na unidade (`own` | `franchised`), desde o FIN0.
- **Dois consolidados distintos, e isso não é opcional:**
  - **Resultado do Grupo** — franqueadora + unidades próprias, com **eliminação intercompany** do royalty (receita da franqueadora que é despesa do franqueado). Unidade franqueada **não** entra aqui com faturamento.
  - **Faturamento da Rede** — todas as unidades, próprias e franqueadas, apenas para benchmarking, ranking e indicadores operacionais.
- Nunca some faturamento de franqueada no resultado da franqueadora. Se algum card fizer isso, é bug de negócio.
- O royalty gera lançamento espelhado: receita na franqueadora e despesa na unidade, vinculados pelo mesmo `source_id`, para a eliminação ser automática e auditável.

**A franqueadora é uma entidade contábil no sistema, não uma abstração.** Hoje o multi-tenant é por `clinic_id` e a franqueadora não tem onde lançar as despesas dela — folha da equipe da franqueadora, marketing institucional, jurídico, custos de expansão, desenvolvimento do próprio riSZon. Resolva no FIN0: a franqueadora existe como entidade financeira de primeira classe (unidade com `entity_type = franchisor`, ou tabela `entities` separada — proponha o que dá menos atrito com o RLS atual). Sem isso o FIN8 não tem como calcular resultado da franqueadora nem payback de expansão.

**Três visões, com permissão distinta:**

| Visão | Quem vê | O que mostra |
|---|---|---|
| **Unidade** | Gerente da Unidade (só a sua), Admin Master, Financeiro da Franqueadora | DRE, DFC, caixa, contas a pagar/receber, ocupação e margem daquela unidade |
| **Rede** | Admin Master, Financeiro da Franqueadora | Faturamento, ticket, ocupação, inadimplência e ranking de todas as unidades — comparativo, sem misturar com o resultado da franqueadora |
| **Franqueadora / Grupo** | Admin Master, Financeiro da Franqueadora | Receita de royalties e taxas, despesas próprias, resultado da franqueadora e, quando houver unidade própria, Resultado do Grupo com eliminação intercompany |

Gerente de Unidade **nunca** vê dado financeiro de outra unidade. No ranking da rede, se ele tiver acesso, as demais unidades aparecem anonimizadas (posição e mediana, não nome e número) — franqueado não pode ver o resultado do vizinho.

### 7.2 Plano de contas

Não existe plano de contas formal da contabilidade hoje. Construa o **plano gerencial** do zero, enxuto, orientado a decisão — não copie estrutura contábil-fiscal. Mantenha `fiscal_account_code` nulo por enquanto; o de-para será feito quando eu validar com o contador. Me apresente o seed proposto antes de rodar a migração.

### 7.3 Centro de custo

Subdivisão **por área**, não por especialidade clínica. Áreas padrão da rede: **Clínico, Comercial, Administrativo, Marketing, Infraestrutura/Ocupação**.

Motivo: custo não se aloca honestamente por especialidade — a mesma cadeira e a mesma recepção servem ortodontia e implante no mesmo dia, e rateio inventado destrói a confiança no número. Rentabilidade por especialidade sai do módulo 6.13, via receita e custo direto do procedimento. **Especialidade é dimensão de análise da receita, não centro de custo.**

### 7.4 Repasse de dentista

Modelo real da Risarte: **valor fixo por procedimento**, com **bônus percentual** sobre o total dos repasses fixos do período em caso de campanha, meta batida ou evolução no plano de carreira.

Modele assim (estrutura no FIN0, cálculo no FIN5):

- **Tabela de repasse por procedimento com vigência** — `procedure_id`, valor em centavos, `valid_from`, `valid_to`. Reajustar preço **nunca** altera repasse já apurado: a apuração usa a tabela vigente na data do procedimento. Escreva teste para isso.
- **Chaveada por nível do plano de carreira**, não por dentista. `career_level_id` → tabela de valores; o dentista aponta para um nível. Override individual por dentista é exceção, não regra. Isso é o que escala para 200 unidades.
- **Camada de bônus separada** — regra com percentual, período de vigência, condição (campanha, meta, nível) e base de cálculo (soma dos repasses fixos do período). Apurada no fechamento do mês, nunca procedimento a procedimento.
- **Gatilho:** apuração por **competência no procedimento realizado**; liberação para pagamento no **fechamento mensal**. Deixe configurável uma política de retenção para procedimento cujo recebimento está em atraso — não implemente agora, só não feche a porta.
- **Alerta obrigatório de margem:** como o repasse é fixo, desconto dado na negociação não reduz o repasse — ele come a margem inteira. O sistema precisa avisar, **no momento da negociação**, quando o preço negociado deixar a margem do procedimento abaixo do mínimo configurado (repasse + material + laboratório + taxa). Sem isso, o consultor pode fechar venda com margem negativa sem ninguém perceber.

### 7.5 Cartão e adquirente

- Contas a receber registra o **valor bruto** devido pelo paciente.
- O recebimento entra **líquido**; a taxa da adquirente é lançada como **despesa financeira variável da unidade** (não da franqueadora — senão a unidade não tem incentivo para negociar meio de pagamento ou puxar PIX).
- Cada parcela precisa de `expected_settlement_date` (D+1 débito, D+30 crédito, configurável por adquirente). Sem isso a projeção de 30/60/90 do DFC mente.

### 7.6 Limites dos alertas

Padrões iniciais, todos configuráveis em cascata como multa e juros:

- Inadimplência: atenção acima de **5%**, crítico acima de **8%**
- Queda de receita mês a mês: acima de **15%**
- Caixa mínimo da unidade: equivalente a **1 mês de custo fixo**
- Faltas na agenda: acima de **15%**

## 8. FIN1 e FIN2 — detalhes para quando chegarmos lá

**FIN1** — resumo no topo (em aberto, em atraso, pago no período); lista de cobranças com origem (negociação do consultor ou venda direta); atraso em destaque com dias e valor atualizado; baixa com forma de pagamento, data efetiva e comprovante. **Baixa parcial precisa existir** — paciente pagando metade da parcela é rotina em clínica. Permissão: Gerente da Unidade, Admin Master e Financeiro da Franqueadora.

**FIN2** — seleção das parcelas, simulação do novo parcelamento no mesmo editor de cobranças (entrada + parcelas), gravação com as antigas marcadas como `renegotiated` e as novas vinculadas por `renegotiation_id`. Registro de quem, quando e por quê. **A parcela renegociada mantém a marca de que esteve em atraso** — senão renegociar vira forma de zerar a inadimplência da unidade e o indicador 9.28 perde o sentido.

## 9. Protocolo de trabalho

1. Leia o repositório e o documento-base.
2. Me traga o diagnóstico de 5 linhas e o seed proposto do plano de contas.
3. Apresente o plano do **FIN0** — arquivos, migração, testes — e espere meu OK explícito.
4. Só então escreva código. Uma fase por vez.
5. Ao final: rode os testes, atualize `ESTADO_DO_PROJETO.md` e a seção do financeiro no `CLAUDE.md`, faça commit.
6. Se descobrir que alguma decisão da seção 7 é inviável ou conflita com o schema existente, **pare e me avise** em vez de contornar por conta própria.

Pode começar pela leitura e pelo diagnóstico.
