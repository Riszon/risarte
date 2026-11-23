# A prova de R$ 10,00 no cartão de débito: o aviso

Este aviso vem antes da prova. Nada começa sem o seu "pode". Você digita o cartão, e no fim a cobrança é estornada.

## O que a prova responde
1. **Como o aviso do Asaas descreve o débito:** se o `billingType` vem `DEBIT_CARD` numa cobrança emitida como cartão.
2. **Se o Asaas aceita a correção do split** de uma cobrança paga no débito, antes do crédito.
3. **Como funciona o estorno** de um pagamento no débito com split.

## Onde
- **Cambé - Centro, a unidade piloto.** Está "Pronta", com a tarifa da produção: débito 1,89% + R$ 0,29 e crédito à vista 2,39% + R$ 0,29.
- **Hoje a produção não tem nenhuma cobrança emitida.** Esta será a primeira, e nenhum paciente pode pagar no débito sem querer enquanto ele estiver habilitado.

## Os números esperados (R$ 10,00)

| | Pago no débito | Se fosse no crédito |
|---|---|---|
| Tarifa do Asaas | **R$ 0,48** | R$ 0,53 |
| Líquido | **R$ 9,52** | R$ 9,47 |

- **Os R$ 0,05 de diferença são o que permite reconhecer o débito pelo valor líquido.**
- **O split fica em cerca de R$ 1,66 nos dois casos.** Com R$ 10,00, a diferença do débito some nos arredondamentos. A prova mede se o Asaas aceita a correção, não o valor dela.

## O passo a passo

| # | O quê | Quem |
|---|---|---|
| 1 | **Uma parcela de R$ 10,00 em Cambé**, de uma venda fechada em seu nome, como paciente. O meio é o cartão à vista. | você |
| 2 | **Gerar a cobrança no Asaas** pela parcela (na ficha, aba Financeiro), no cartão à vista. | você |
| 3 | **Habilitar o débito no painel do Asaas de Cambé** (Minha conta › Configurações › Configurações do sistema). A marca na Central **fica como está**. | você |
| 4 | **Abrir o link da cobrança, escolher o débito e digitar o cartão.** Se a fatura não oferecer o débito, **para aqui**: desabilite o débito, e a cobrança é cancelada sem nada pago. | você |
| 5 | **Desabilitar o débito no painel de Cambé logo depois de pagar.** A correção do split não precisa dele habilitado. | você |
| 6 | **Nos primeiros minutos, eu confiro:** o aviso (o `billingType`), o líquido (esperado R$ 9,52), como o débito foi reconhecido, a baixa com a tarifa do débito e o resultado da correção (aceita ou recusada). | eu |
| 7 | **No dia do crédito** (cerca de 3 dias depois do pagamento), eu confiro o split liquidado e o Painel de repasses. | eu |
| 8 | **O estorno total pelo riSZon**, depois do split liquidado. Eu confiro o estorno e a volta do split. | você, com o meu aviso antes |

## Se algo sair diferente
- **O aviso não diz `DEBIT_CARD`:** o valor líquido reconhece o débito, mas como discordância. O riSZon **não** corrige sozinho e avisa o Financeiro. A prova responde a pergunta 1, e eu trago a conta de volta antes de seguir.
- **O Asaas recusa a correção:** o que foi a mais vira crédito de Cambé. A R$ 10,00 esse crédito é perto de zero. Pela decisão de 21/11, o crédito passa a ser o caminho normal, e a conta volta para você antes de seguir.
- **Qualquer outra surpresa:** para tudo. O débito fica desabilitado, e nada mais é provado até a causa estar entendida.

## O custo e o risco
- **O custo é a tarifa do Asaas, cerca de R$ 0,48.** Ela pode não voltar no estorno.
- **O risco é baixo:**
  - o débito fica habilitado em Cambé só pelos minutos do pagamento, e não há outra cobrança que alguém possa pagar;
  - a 4026 está na produção, conferida;
  - o estorno devolve os R$ 10,00 ao cartão. O estorno puxa o valor de volta da conta de Cambé e, do split, das carteiras da rede: as contas precisam ter esse pouco de saldo.

## Depois
- O resultado vai para o registro das provas (`roteiro-homologacao.md`, seção E) e para a spec (23.3).
- Com a prova aprovada, habilitar o débito nas unidades passa a ser uma decisão sua, unidade por unidade, com a marca na Central.
