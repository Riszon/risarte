# Módulo Compras

_Plano desenhado em 12/08/2026 com o dono. **DESCONGELADO em 17/08/2026**, ao
fechar o FIN8. As três decisões do fim foram **resolvidas** (ver lá). **C1
entregue** nas migrações 0238+0239._

## O objetivo, nas palavras do dono

> "o objetivo de concentrar a compra na franqueadora é otimizar e melhorar a
> capacidade de negociação diante dos fornecedores."

**É esse objetivo que define a arquitetura inteira: a NEGOCIAÇÃO é da rede, mas
o DINHEIRO é da unidade.** Cada unidade aprova, é faturada, paga e recebe a sua
parte. Todo o resto do desenho decorre disso — e é por isso que o pedido, não a
cotação, é o objeto que carrega valor.

## O ciclo e o dono de cada passo

| Etapa | Quem faz |
|---|---|
| **Necessidade** — a lista nasce | Unidade (automática pelo estoque + itens avulsos) |
| **Envio à franqueadora** | **Gerente da unidade** |
| **Consolidação, cotação e negociação** | Franqueadora (comprador) |
| **Aprovação do orçamento** | **Unidade** |
| **Pedido, faturamento, pagamento e entrega** | Unidade, individualmente |

## C1 — A necessidade da unidade

Botão **"Gerar lista de compras"**: traz tudo abaixo do mínimo com a quantidade
sugerida **em embalagens** — é a `replenishment_list()` que a E5 (0222) já
calcula. O gerente acrescenta o que faltar e ajusta quantidades.

**Previsão de custo em três degraus, e a tela declara qual usou:**

1. **Última compra desta unidade** — o mais confiável
2. **Última compra da rede** — quando esta unidade nunca comprou o item
3. **Custo médio atual** — quando não há compra nenhuma

Sem dizer de onde veio, um preço de dois anos atrás pareceria tão sólido quanto
o de ontem. (Mesma regra do repasse por nível e do custo do kit: **mostrar a
origem do número faz parte do número**.)

**Material de limpeza e escritório entram no mesmo fluxo** — viram itens de
estoque com categoria própria e reaproveitam custo, entrada e nota. Para o que
não se estoca (uma cadeira, um conserto), a linha é **livre**, com a conta de
despesa escolhida na hora.

## C2 — A mesa de negociação da franqueadora

Tela com todas as requisições enviadas, **consolidadas por item**: *"Resina A2 —
47 tubos, de 6 unidades"*, com filtro por unidade e por período, e a previsão
total pelo histórico ao lado.

O comprador registra a **cotação por fornecedor** (preço por item, prazo,
condição) e escolhe de quem comprar cada item — pode dividir: resina do
fornecedor A, descartáveis do B. Fechado isso, o sistema devolve **a cada
unidade a parte dela**, já com o preço negociado.

## C3 — A unidade aprova, e o pedido nasce

Cada unidade vê o que foi negociado para ela, com **o preço negociado ao lado da
previsão** — a economia fica explícita. O gerente aprova ou recusa itens.

Aprovado, nasce **um pedido por unidade e por fornecedor**: é ele que é
faturado, pago e entregue naquele endereço. Quando o material chega, o **XML da
nota (0223) se amarra ao pedido**, permitindo comparar **pedido × recebido ×
pago**.

## C4 — Dashboard

Produtos mais comprados, ranking de fornecedores, volume e valor por período,
prazo médio de entrega. E os dois indicadores que medem a tese:

- **Quanto a negociação conjunta economizou** — preço negociado contra a
  previsão pelo histórico, por rodada e acumulado. É o número que prova (ou
  derruba) a decisão de centralizar.
- **Quanto foi comprado por fora**, direto pela unidade. É o vazamento que corrói
  o poder de negociação, e ele só desaparece do radar se ninguém medir.

## Modelo de dados esboçado

- `purchase_requests` + `purchase_request_items` — a requisição da unidade
- `purchase_rounds` — a rodada da franqueadora, juntando várias requisições
- `purchase_quotes` — cotação por fornecedor dentro da rodada, preço por item
- `purchase_orders` + itens — **o pedido POR UNIDADE E POR FORNECEDOR**; é aqui
  que mora o dinheiro, e é o que se amarra à nota fiscal recebida

A separação entre *rodada* (rede) e *pedido* (unidade) é o coração do módulo:
juntar tudo num objeto só faria o faturamento individual virar remendo.

## Ordem

**C1 ✅ → C2 → C3 → C4.** Cada etapa é testável sozinha, e a C1 já entrega valor
sem as outras: a lista pronta com previsão de custo.

## Três decisões — RESOLVIDAS em 17/08/2026

1. **Papel novo "Comprador da Franqueadora"** — **decidido: papel novo**
   (`purchaser`, migração 0238). *Motivo* — comprar e pagar são funções diferentes,
   e separá-las é controle interno básico.
2. **A unidade pode comprar direto?** — **decidido: pode, marcada como
   compra local** (`purchase_requests.is_local`). *Motivo* — urgência sempre
   acontece, e proibir só faz a compra sair do sistema. Marcada, ela aparece no
   dashboard como vazamento medido.
3. **A franqueadora pode alterar quantidades?** — **decidido: pode, com a
   alteração visível para a unidade aprovar** (vale a partir do C2). *Motivo* — ela vai pagar por aquilo.
