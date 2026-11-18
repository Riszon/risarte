# AP183 — Achados menores do roteiro da ortodontia (prioridade baixa)

**Situação:** plano para o dono aprovar, item por item. Nada foi mudado ainda.
Cada item pode ser aprovado, adiado ou descartado sozinho.

## 1. A primeira mensalidade nasce vencida (decisão sua)

**Visto:** instalação em 17/11, dia de vencimento 10. A 1ª mensalidade venceu
em 10/11, já aparece "Atrasada" e não tem como ganhar o desconto de
pontualidade.

**Causa:** o vencimento é sempre o dia de cobrança do mês, mesmo já passado.

**Opções:**
- **A (recomendada):** se o dia de vencimento do mês já passou quando o lote
  nasce, o lote começa no mês seguinte. O lote continua com o mesmo número de
  mensalidades; só anda um mês.
- **B:** o primeiro mês continua, mas vence alguns dias depois da emissão (por
  exemplo, 5 dias).

**Correção:** migração pequena na rotina do lote, partindo da 0430 (a do
AP181, já na produção), e a régua com os dois casos.

## 2. A janela "Emitir novas mensalidades" não fecha depois de emitir

**Visto:** depois de "Lote de mensalidades emitido.", a janela ficou aberta, já
falando do lote seguinte, com o botão de emitir ativo.

**Correção:** fechar a janela no sucesso, como as outras da ficha. Só tela.

## 3. Depois da alta, o controle já agendado continua ligado ao caso (decisão sua)

**Visto:** o caso teve alta e o controle de 17/02 continuou agendado, ligado ao
caso encerrado, sem aviso.

**Opções:**
- **A (recomendada):** a janela "Dar alta" mostra os controles agendados e
  oferece cancelá-los junto, com a opção já marcada.
- **B:** só avisar, sem cancelar nada.

**Correção:** tela e uma porta no banco para cancelar junto (migração pequena).

## 4. O cartão diz "mensalidade em atraso" quando é a contenção

**Visto:** depois da entrega, o cartão da ortodontia no prontuário dizia
"1 mensalidade em atraso"; o que estava em aberto era a cobrança da contenção.

**Correção:** o texto passa a dizer "cobrança em atraso", ou "contenção em
atraso" quando for ela. Só tela.

## 5. A agenda deixa marcar "Faltou" antes do horário (decisão sua)

**Visto:** às 21h foi possível marcar "Faltou" num horário de 00:00 do dia
seguinte.

**Opção recomendada:** "Faltou" só aparece depois do horário de início. Isso
vale para a agenda inteira, não só a ortodontia, por isso pede a sua decisão.

**Correção:** tela e a conferência no servidor.

## 6. "Desfazer a baixa" sem confirmação

**Visto:** a baixa de uma mensalidade é desfeita com um clique, sem pergunta.

**Correção:** uma confirmação antes ("Desfazer a baixa de R$ … de dd/mm?").
Só tela.

## 7. O motivo da regra comercial mostra "R$ 140.00"

**Visto:** "Mensalidade ortodôntica de R$ 140.00 abaixo do mínimo de R$
150.00". Os outros motivos da regra comercial também saem assim.

**Correção:** os motivos passam a sair no formato brasileiro (R$ 140,00).
Migração pequena nas funções que escrevem os motivos.

## O que fica do roteiro, não do sistema

- A Recepção que registra o pagamento não recebe o aviso "caso fechado", porque
  a regra não avisa quem fez. Isso já foi corrigido no roteiro.
- O reajuste anual só entra com 12 meses de tratamento. Também já está no
  roteiro.

## Decisões suas

- **D1 (item 1):** A ou B? Recomendo A.
- **D2 (item 3):** A ou B? Recomendo A.
- **D3 (item 5):** bloquear "Faltou" antes do horário na agenda inteira?
  Recomendo que sim.
- **D4:** faço os itens 2, 4, 6 e 7 junto com os outros, sem decisão a mais?
  Recomendo que sim.

## Tamanho

Pequeno. Os itens 1, 3 e 7 pedem uma migração pequena (podem ir juntos numa só,
na mesma entrega do AP182 se você quiser); o resto é só tela.

## Decisões do dono e o que foi feito (18/11/2026, 0.485.0)

- **Item 1 (D1):** o dono definiu uma regra nova: a 1ª mensalidade nasce na
  assinatura do contrato, com o 1º vencimento e os seguintes configuráveis, e
  o tratamento começa com contrato assinado, 1ª mensalidade paga e primeiro
  atendimento ortodôntico. Plano próprio: `AP183-D1-PLANO.md`, para aprovar.
- **Item 2:** não era defeito. O manipulador já fecha a janela; no roteiro, o
  painel do navegador estava escondido e a animação de fechar não rodou.
- **Item 3 (D2):** feito com a decisão do dono: a janela da alta lista os
  controles agendados, **nenhum marcado**; quem dá a alta marca os que devem
  ser cancelados.
- **Itens 4, 5 (D3), 6 e 7 (D4):** feitos.
