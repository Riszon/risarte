# AP24 — Os três parâmetros do Indica +Risos que nada usa (plano para o dono)

**04/11/2026.** Decisão do dono no BACKLOG: **implementar os três**.

| Parâmetro (Configurações) | Valor da rede | O que deveria fazer |
|---|---|---|
| `beneficio_indicado_percentual` | 10% | Presente de boas-vindas no 1º plano do indicado |
| `beneficio_validade_dias` | 60 dias | Validade do presente, contada da avaliação |
| `premio_individual_percentual_origem` | 50% | Divisão do prêmio individual por conversão: quem pediu × quem fechou |

## O que já existe (lido no código)

- **A indicação guarda quem pediu e quem fechou**: `risartano_origem_id` e
  `risartano_conversao_id` (o Consultor da venda), e as datas
  `compareceu_em` e `convertida_em`.
- **O voucher do Indica** (resgate do Embaixador): o Consultor **aplica à mão**
  como desconto na negociação e **marca como usado** ligado à negociação
  (`indica.usar_voucher`). Decisão do dono de 28/09/2026.
- **Decisão 21 do levantamento da Rita** (`docs/sdr/DECISOES_RITA.md`): o
  benefício do indicado é *"Avaliação de Boas-vindas sem custo + 10% no
  primeiro tratamento fechado, uma única vez, dentro da validade"*; *"a Rita só
  informa; a aplicação é do comercial."*
- **As metas da equipe** (2007) premiam por faixa e por função (dinheiro só
  como relatório para a folha). **Não existe prêmio individual por
  conversão**: o 3º parâmetro hoje não tem o que dividir.

## A proposta

1. **O presente de boas-vindas na negociação.** Quando o cliente da
   negociação foi **indicado** e ainda não usou o presente, o painel da
   negociação mostra *"Presente de boas-vindas Indica +Risos: 10% — válido até
   dd/mm"* com o botão **Aplicar**. O Consultor aplica, o sistema calcula os
   10% e o desconto vai na negociação; no aceite o presente fica **usado**
   (uma vez só), ligado à negociação. Fora da validade, o painel diz que
   venceu.
2. **A validade** conta do **comparecimento à avaliação** (`compareceu_em`),
   como dizem as diretrizes ("60 dias após a avaliação").
3. **O prêmio individual por conversão** passa a existir: um valor por
   conversão (parâmetro novo, **desligado por padrão** — valor zero), dividido
   entre quem pediu e quem fechou pelo `premio_individual_percentual_origem`.
   Se a mesma pessoa pediu e fechou, ela leva o valor inteiro. Ele é apurado no
   mês junto com as metas e vai para o relatório da folha, como os prêmios em
   dinheiro das metas.

## Decisões para o dono

| # | Pergunta | Recomendação |
|---|---|---|
| **I1** | O presente entra **sozinho** na negociação ou o Consultor **aplica** com um botão? | **Botão "Aplicar"**, como o voucher e a decisão 21 ("a aplicação é do comercial"). O sistema calcula, limita a uma vez e confere a validade. |
| **I2** | O desconto do presente conta **dentro** do limite de desconto da regra comercial (e pode pedir autorização do Gerente) ou **por fora**, como benefício de programa? | **Por fora**, como o PPR+ e o Empresarial: é um benefício prometido ao indicado, não um desconto negociado. |
| **I3** | A validade conta de quando? | **Do comparecimento à avaliação**, como nas diretrizes. |
| **I4** | O prêmio individual por conversão: qual **valor** e em que **forma**? | **Valor em R$ por conversão**, configurável na rede, **começando desligado (R$ 0)**; apurado no mês com as metas e enviado ao relatório da folha. O dono liga quando definir o valor. |

A "Avaliação de Boas-vindas sem custo" da decisão 21 não é um destes três
parâmetros: fica fora desta entrega.
