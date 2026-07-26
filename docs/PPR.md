# Programa de Prevenção Riso+ (PPR+)

Documento-fonte do módulo. Regras de negócio passadas pelo dono em 25/07/2026.
Dinheiro sempre em **centavos**; interface em **pt-BR**; código em inglês.
Faixa de migração deste módulo: **core (0162+)**.

---

## 1. O que é o PPR+

O **Programa de Prevenção Riso+ (PPR+)** é o programa de prevenção e
relacionamento da Risarte, vendido **ao cliente pessoa física** (cliente
Risarte), com **pagamento mensal recorrente**. O cliente adere a um plano, paga
uma mensalidade e passa a ter **consultas e radiografias sem custo, limpeza
periódica gratuita, descontos em tratamentos, parcelamento diferenciado e
vantagens para quem ele indicar**.

**Por que ele existe (objetivos do programa):**

1. **Receita recorrente** para a unidade franqueada (mensalidade do cliente).
2. **Relacionamento contínuo** entre o cliente e a unidade Risarte.
3. **Benefício real** para o cliente (prevenção, não só desconto).
4. **Mais vendas** para a mesma base, pelo relacionamento criado.
5. **Mais indicações** vindas dos participantes do programa.
6. **Riso+ Social:** cada participante acumula pontos, mês a mês, que serão
   usados para cuidar de pessoas carentes (módulo futuro).

> O PPR+ é um **programa essencial da Risarte** e será um **indicador de
> sucesso das unidades** dentro da rede.

**Diferença para o Risarte Empresarial:** o Empresarial é B2B (a empresa paga
pelos colaboradores). O PPR+ é B2C (o próprio cliente paga). Os dois usam o
mesmo tipo de motor de benefícios (cobertura + carência + frequência) e, no
futuro, os dois alimentam o **Riso+ Social**.

---

## 2. Planos

São **4 planos iniciais**, mas o módulo permite **criar novos planos** e
**renomear** os existentes. Todos os valores e características abaixo são
**configuráveis** (são apenas o ponto de partida).

| Plano | Adesão | Valor | Dependentes |
|---|---|---|---|
| **Light** | Individual | R$ 79,90 | não |
| **Standard** | Individual | R$ 99,90 | não |
| **Família** | Familiar | R$ 179,80 | 1 titular + 1 dependente |
| **Família+** | Familiar+ | R$ 199,90 | 1 titular + 2 dependentes (**e pode adicionar mais**, a R$ 59,90 cada) |

### Benefícios por plano

| Benefício | Light | Standard | Família | Família+ |
|---|:--:|:--:|:--:|:--:|
| Consultas sem custo | ✅ | ✅ | ✅ | ✅ |
| Radiografias sem custo (periapicais e interproximais) | ✅ | ✅ | ✅ | ✅ |
| Desconto à vista | 10% | 10% | 10% | 10% |
| Desconto no parcelado | — | 5% a 15% | 5% a 15% | 5% a 15% |
| Parcelamento diferenciado | até 12× | até 18× | até 18× | até 18× |
| Forma de pagamento facilitada (inclui boletos) | ✅ | ✅ | ✅ | ✅ |
| Indicados não pagam consulta | ✅ | ✅ | ✅ | ✅ |
| Indicado ganha 5% no 1º tratamento | — | ✅ | ✅ | ✅ |
| Limpeza grátis | a cada 6 meses | a cada 4 meses | a cada 4 meses | a cada 4 meses |
| Escova nova a cada limpeza | — | ✅ | ✅ | ✅ |
| Participação no Riso+ Social | — | ✅ | ✅ | ✅ |

---

## 3. O que é configurável (tela de configuração do PPR+)

Tudo abaixo é editável pelo Admin. **Os valores dos planos são da rede** — só a
Franqueadora define, a unidade não ajusta (decisão 9). As regras de
inadimplência seguem o padrão cascata (rede + ajuste por unidade):

- **Planos:** criar, renomear, ativar/desativar, ordenar; descrição comercial.
- **Valor** de cada plano (mensalidade) e **valor do dependente extra**.
- **Benefícios e vantagens** de cada plano (lista de texto que aparece na venda
  e no contrato).
- **Dependentes:** se o plano aceita, **quantos** e se aceita **extras pagos**.
- **Carência** para começar a usar (geral do plano e específica por benefício).
- **Descontos por procedimento** (ou por especialidade): isento (100%),
  percentual, ou sem benefício.
- **Frequência/limite** de cada benefício (ex.: limpeza a cada 4 meses).
- **Condições de parcelamento:** número máximo de parcelas, **parcela mínima**,
  faixa de desconto no parcelado.
- **Descontos à vista.**
- **Formas de pagamento aceitas** para os benefícios do programa.
- **Formas de pagamento da mensalidade:** cartão de crédito recorrente, débito
  recorrente, PIX recorrente.
- **Regras de inadimplência:** em quantos dias suspende e em quantos cancela.
- **Pontos do Riso+ Social** gerados por plano, por mês pago.

---

## 4. Venda do PPR+

- É vendido para o **cliente Risarte**, pela **própria unidade (venda direta)**
  ou pelo **comercial**.
- **Quem vende:** **Consultor Comercial** no fluxo comercial; **Recepcionista,
  Gerente de Unidade e Coordenador Clínico** na venda direta. A **SDR não
  vende**. **Cancelar/suspender:** Gerente de Unidade e Admin Master.
- Em ambos os fluxos existe o botão **"Oferecer PPR+"**, que abre a venda do
  programa (escolha do plano, titular, dependentes e grau de parentesco, forma
  de pagamento recorrente e dia da cobrança).
- Pagamento da mensalidade: **cartão de crédito recorrente, débito recorrente
  ou PIX recorrente**.
- **Contrato de adesão** emitido pelo sistema (impressão/PDF e, quando a
  ZapSign estiver ligada, assinatura digital).
- A adesão só fica **ativa** com **contrato assinado + primeira cobrança
  confirmada** (mesma regra de ouro do comercial). Antes disso: "aguardando
  ativação".

---

## 5. Situação do plano e efeitos

| Situação | O que acontece |
|---|---|
| **Aguardando ativação** | Vendido, sem contrato assinado e/ou sem 1º pagamento. Ainda **não usa** benefícios. |
| **Ativo** | Titular e dependentes usam todos os benefícios (respeitando carência e frequência). Selo PPR+ no prontuário. |
| **Suspenso / inativo** | Falta de pagamento da mensalidade. **Nenhum beneficiário usa os benefícios.** O selo mostra "PPR+ suspenso". |
| **Cancelado** | Todos os beneficiários **perdem os benefícios** e **perdem a etiqueta PPR+** do prontuário; fica apenas no **histórico** do cliente. |

---

## 6. Beneficiários e prontuário

- Cada participante é **titular** ou **dependente**, e cada um tem o **seu
  prontuário**.
- No prontuário aparece:
  - **Selo PPR+** com o plano e a situação (ativo / suspenso);
  - se é **titular** ou **dependente**;
  - **titular:** a lista de dependentes com o **grau de parentesco**, cada um
    **clicável** para abrir o prontuário do dependente;
  - **dependente:** quem é o **titular**, também **clicável**;
  - histórico do programa (adesões, trocas de plano, suspensões, cancelamento).

---

## 7. Motor de benefícios (como o desconto chega ao orçamento)

Ordem de precedência ao montar uma negociação comercial ou uma venda direta:

```
1º  Benefício do PROGRAMA do cliente (PPR+ ou Empresarial)
2º  Regra comercial da UNIDADE
3º  Regra comercial da REDE
```

Ou seja: **o PPR+ fica acima da regra comercial convencional** da rede e da
unidade. Ao lançar procedimentos para um beneficiário ativo, o sistema aplica
sozinho: cobertura (isento/desconto), desconto à vista ou por parcelamento,
número de parcelas permitido e formas de pagamento do programa — mostrando na
tela o **preço normal → benefício do PPR+ → preço final**.

Cada uso é registrado (**quando** e **por quem**), para controlar carência e
frequência: fez a limpeza hoje, a próxima libera daqui a 4 (ou 6) meses. Esse
mesmo registro alimenta a projeção de limpezas do dashboard.

---

## 8. Cartão do beneficiário (rastreável)

- Cada beneficiário tem um **código único** e um **cartão** com seus dados,
  plano e situação.
- Pode ser **impresso e entregue** ao cliente ou **enviado em arquivo digital**.
- O cartão é **rastreável**: a unidade consulta o código (ou lê o QR) e o
  sistema confirma se o beneficiário está **ativo**, qual o plano e quais
  benefícios já estão liberados.

---

## 9. Dashboard do PPR+ (por unidade)

- Planos **ativos**; **participantes** (titulares + dependentes).
- **Novos planos** no período; **cancelados**; **inativos/suspensos** (falta de
  pagamento).
- **Gráfico de crescimento** do PPR+ — em **quantidade de planos** e em
  **receita**.
- **Quantidade total de cada plano** e **taxa de crescimento de cada plano**.
- **Receita mensal** do PPR+ — geral e por plano.
- **Ticket médio** (receita total ÷ quantidade de planos).
- **Beneficiários em dia com a limpeza** — fizeram nos últimos 3 meses **ou**
  têm agendamento marcado.
- **Beneficiários que não estão usando** — mais de 4 meses sem nenhum
  agendamento na clínica.
- **Limpezas realizadas** pelo PPR+.
- **Agendamentos futuros de limpeza** (próxima semana, próximo mês, período
  específico).
- **Projeção de limpezas** futuras, calculada pela frequência de cada plano
  (fez a limpeza → libera nova em N meses).

## 10. Ranking das unidades (visão da Franqueadora)

Ranking por: **receita**, **quantidade de planos**, **quantidade de
beneficiários**, **cancelamentos**, **taxa de crescimento**, **limpezas
realizadas** e **novos planos vendidos**.

---

## 11. Riso+ Social

Cada cliente do PPR+ **acumula pontos mês a mês** enquanto o plano segue ativo
e pago. Esses pontos serão usados no **módulo Riso+ Social** (futuro) para
cuidar de pessoas carentes. O PPR+ e o Risarte Empresarial serão as duas fontes
de pontos. Por ora o sistema **registra e soma os pontos** (por cliente, por
unidade e por rede); o uso vem depois.

---

## 12. Modelo de dados (proposto)

| Tabela | Para quê |
|---|---|
| `ppr_plans` | Catálogo de planos (nome, valor, dependentes, ativo, ordem). Cascata rede/unidade. |
| `ppr_plan_perks` | Lista de benefícios/vantagens em texto de cada plano (venda + contrato). |
| `ppr_plan_rules` | Regras comerciais do plano: desconto à vista, faixa no parcelado, máximo de parcelas, parcela mínima, formas de pagamento. |
| `ppr_plan_benefits` | Benefício por procedimento/especialidade: cobertura (isento/%/nenhum), carência, frequência, limite. |
| `ppr_memberships` | A adesão vendida: unidade, plano, titular, situação, valor, forma de pagamento recorrente, dia de cobrança, contrato, quem vendeu, origem (comercial/venda direta). |
| `ppr_beneficiaries` | Titular e dependentes da adesão: cliente, papel, grau de parentesco, código do cartão, entrada/saída. |
| `ppr_charges` | Mensalidades: competência, valor, situação (paga/em aberto/atrasada), data do pagamento. |
| `ppr_benefit_usages` | Cada uso de benefício (ex.: limpeza): quem, quando, qual atendimento, quando libera de novo. |
| `ppr_events` | Histórico: adesão, troca de plano, suspensão, reativação, cancelamento, entrada/saída de dependente. |
| `ppr_social_points` | Pontos do Riso+ Social acumulados por mês/plano/cliente. |

Marcação no cliente (`clients`): `ppr_membership_id` + `ppr_active` — no mesmo
formato do Empresarial (`empresarial_company_id` + `empresarial_active`), para
o selo do prontuário e as consultas ficarem baratas.

---

## 13. Ordem de construção

| Fase | Entrega |
|---|---|
| **PPR1** ✅ | Fundação: migração 0162 (tabelas + RLS), `src/lib/ppr/` com as regras puras + testes, seed dos 4 planos. |
| **PPR2** ✅ | Seção dedicada `/ppr` no menu: "Sobre o programa" + **configuração completa** (`/ppr/configuracao`): planos, valores, vantagens, dependentes, carências, benefícios por procedimento/especialidade, faixas de parcelamento, formas de pagamento e prazos de inadimplência. |
| **PPR3** ✅ | **Venda:** botão "Oferecer PPR+" no cockpit do comercial e no prontuário; adesão com titular + dependentes; lista `/ppr/adesoes` + tela da adesão; contrato de adesão para imprimir; ativação pela regra de ouro; suspender/reativar/cancelar. |
| **PPR4** ✅ | **Prontuário:** selo PPR+ na linha de pílulas + bloco do programa com titular/dependentes clicáveis, situação e histórico; **cartão do beneficiário** (`/ppr/cartao/[id]`, imprimir ou PDF) e **validação pelo código** (`/ppr/validar`). |
| **PPR5** | **Motor de benefícios ligado** à negociação comercial e à venda direta (acima da regra da rede/unidade), com registro de uso e liberação por frequência. |
| **PPR6** | **Mensalidades e situação:** cobranças, suspensão por inadimplência, cancelamento e reativação (+ pontos do Riso+ Social). |
| **PPR7** | **Dashboard do PPR+** + **ranking das unidades** para a Franqueadora. |

---

## 14. Decisões confirmadas pelo dono (25/07/2026)

1. **Valor do plano = mensalidade.** Não existe taxa de adesão única; o cliente
   entra pagando o primeiro mês.
2. **Parcela mínima = valor mínimo da parcela** (ex.: nenhuma parcela abaixo de
   R$ X). O sistema reduz o número de parcelas até respeitar esse piso.
3. **Desconto no parcelado = tabela por número de parcelas** (ex.: até 6× =
   15%, até 12× = 10%, até 18× = 5%), configurável por plano. O sistema aplica
   sozinho — ninguém negocia dentro da faixa.
4. **Cliente em dois programas (PPR+ e Empresarial):** vale o **melhor
   benefício para o cliente**, procedimento a procedimento. **Nunca soma.**
5. **Ativação:** só com **contrato assinado + primeira mensalidade confirmada**
   (regra de ouro). **A carência conta a partir da ativação.**
6. **Inadimplência:** **30 dias** de atraso **suspende** (perde os benefícios);
   **90 dias** (3 mensalidades) **cancela**. Configurável.
7. **Indicações:** criar o campo **"Indicado por"** no cadastro do cliente; os
   benefícios do indicado (consulta sem custo e 5% no 1º tratamento) passam a
   ser aplicados automaticamente.
8. **Dependentes:** cadastrados na hora da venda (nome, nascimento, grau de
   parentesco); **CPF opcional** para menor de idade; pertencem à **mesma
   unidade do titular**.
9. **Preço igual em toda a rede.** Só a Franqueadora define o valor dos planos;
   a unidade não ajusta (sem cascata nos valores do PPR+).
10. **Quem vende:** **Consultor Comercial** (pelo fluxo comercial);
    **Recepcionista, Gerente e Coordenador Clínico** (pelo fluxo de venda
    direta). A **SDR não vende** o PPR+. **Cancelar/suspender: Gerente de
    Unidade e Admin Master.**
11. **Escova a cada limpeza:** o sistema **controla a entrega** ("escova
    entregue" no atendimento da limpeza).
12. **Riso+ Social:** pontos **proporcionais ao valor pago**, configuráveis por
    plano; o **Light não pontua**.
