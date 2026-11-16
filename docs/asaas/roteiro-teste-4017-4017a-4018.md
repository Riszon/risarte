# Roteiro de teste pelas telas — 4017, 4017a e 4018

Para o dono testar no **projeto de teste** (https://risarte-asaas.vercel.app, banco de treino,
Asaas sandbox), em ordem, antes de a 4020 ir para a produção. Versão esperada no rodapé: **0.456.4**.

**Antes de começar**
- Entre como **Admin Master**. Nos passos marcados com 👤, use também um usuário **Gerente** de
  Londrina e um usuário do **Financeiro da Franqueadora** (para a regra de quem pede e de quem autoriza).
- Use **clientes de teste sem e-mail e sem celular**. Assim, nem o Asaas nem a ZapSign mandam
  mensagem a ninguém. Você não deve receber **nenhuma** mensagem neste roteiro.
- **Para simular um pagamento no sandbox:** no painel do Asaas sandbox da conta de Londrina,
  abra **Cobranças**, abra a cobrança e clique em **Confirmar pagamento** (ou **Receber em dinheiro**).
  O aviso volta ao riSZon em alguns segundos.
- Anote, a cada passo, **OK** ou **o que viu de diferente**, e o nome do cliente.

---

## Parte A — Renegociação assinada (4017)

**A1. Preparar.** Crie um cliente de teste e uma venda (plano) **fechada, com o contrato assinado**,
de 6 parcelas no **boleto, um por mês**, com a 1ª vencendo daqui a 10 dias.
- Esperado: em Ficha › Financeiro, as parcelas com o boleto emitido no Asaas.

**A2. Renegociar sem desconto.** Marque as parcelas 2 e 3 › **Renegociar** › 3× no boleto.
- Esperado: a tela mostra a forma "Um boleto por mês" já marcada.
- **Salvar** → o acordo fica **Aguardando assinatura**, com o prazo (até 5 dias, nunca depois do 1º vencimento novo).
- Esperado: a faixa **"Renegociação aguardando assinatura"** e a marca **"Em renegociação"** nas parcelas 2 e 3.
  **As parcelas antigas e os boletos delas não mudaram.**

**A3. Enviar o termo sem enviar de verdade.** No cartão da renegociação, clique em **Enviar termo**.
- Esperado: a tela avisa quantos boletos serão cancelados **quando o cliente assinar**.
- ⚠️ Se o cliente tiver e-mail ou celular, a ZapSign manda o termo de verdade. Com o cliente sem
  contato, **não confirme o envio**: volte e use o A4.

**A4. Anexar o termo assinado (exceção do impresso).** 👤 Como **Gerente**: **Anexar termo assinado**
(qualquer PDF ou foto).
- Esperado, na hora:
  - os boletos das parcelas 2 e 3 **cancelados no Asaas** (confira no painel do sandbox);
  - as parcelas 2 e 3 como **Renegociada**;
  - 3 parcelas novas com boleto emitido.

**A5. Pagar antes de assinar cancela o acordo.**
- Faça outra renegociação (parcelas 4 e 5) e **salve sem anexar**.
- No painel do sandbox, **confirme o pagamento** do boleto da parcela 4.
- Esperado: o acordo fica **Cancelado pelo pagamento**, a parcela 4 fica **paga**, a 5 volta ao normal e chega o aviso para refazer.

**A6. Desconto com a ordem dos componentes.** Deixe uma parcela vencer (ou use uma já vencida) e
renegocie com um desconto pequeno.
- Esperado: a tela mostra o abatimento na ordem **juros → multa → benefício → principal**.
- Desconto acima do teto, ou dado por quem não é Gerente: fica **esperando a autorização do Gerente**.

**A7. Prazo vencido.** (Opcional: só dá para ver depois do prazo.) Um acordo salvo e não assinado
fica **Expirado** sozinho, e nada muda nas parcelas antigas.

---

## Parte B — Exceção para cancelar venda com acordo (4017a)

**B1. Acordo pendente não precisa da franqueadora.**
- Faça uma renegociação e **salve sem anexar**.
- Tente cancelar a venda (Cancelamento do plano).
- Esperado: recusa, com os **acordos desta venda** listados embaixo, e o botão **Cancelar o acordo pendente**.
- Cancele o acordo, com o motivo. O cancelamento da venda segue normal (pode descartar o rascunho depois).

**B2. Acordo assinado, só desta venda.** Use a venda da Parte A (acordo assinado no A4, com parcelas em aberto).
- Tente cancelar a venda. Esperado: recusa e o botão **Pedir exceção ao Financeiro**.
- 👤 Como **Recepcionista**: em vez do botão, aparece a orientação de chamar o Gerente.
- 👤 Como **Gerente**: **Pedir exceção**, com o motivo.

**B3. A decisão.** 👤 Como **Financeiro da Franqueadora**: Financeiro › Cobranças automáticas › **Pedidos de exceção**.
- Esperado: o pedido aparece, e chegou um aviso.
- **Autorizar.**
- 👤 Teste também: quem pediu **não consegue autorizar o próprio pedido** (nem o Admin Master que pediu).

**B4. Usar a exceção.** 👤 Como **Gerente**, abra o termo de cancelamento da venda.
- Esperado: o acerto conta como pago **também o que o cliente pagou no acordo**, e o termo mostra a linha.
- Assine e efetive. Esperado:
  - as parcelas do acordo em aberto **canceladas**, com o boleto cancelado no Asaas;
  - o acordo como **Encerrado pelo cancelamento da venda**;
  - a exceção como **usada**.

**B5. Acordo que junta duas vendas.** Faça um cliente com duas vendas e um acordo com uma parcela de cada uma (anexe o termo).
- Tente cancelar uma das vendas. Esperado: **"Este acordo junta parcelas de outras vendas. O cancelamento fica para o distrato."**

---

## Parte C — Mensalidades pelo Asaas (4018)

**C1. Ver antes de ligar.** 👤 Como **Gerente** de Londrina: Financeiro › Cobranças automáticas › **Mensalidades pelo Asaas**.
- Esperado:
  - quantos **entram agora** e quantos **esperam a ASA4B**, por programa, e quantos têm contato;
  - o aviso amarelo **"Antes de ligar, cancele no painel do Asaas as assinaturas antigas dos clientes que entram."**;
  - o **Ligar** só funciona com a marca **"Avisei os clientes e cancelei as assinaturas antigas."**

**C2. Ligar** a partir de hoje.

**C3. PPR+ no boleto.** Crie uma adesão do PPR+ no **boleto** para um cliente de teste e assine.
- Esperado: a **1ª mensalidade** nasce na hora, com o boleto no Asaas, **sem multa nem juros**.
- Confirme o pagamento no sandbox. Esperado: a mensalidade **paga** e a adesão **ativa** sozinha.

**C4. Ortodontia com desconto de pontualidade.** Crie um caso da Ortodontia no **boleto**, com desconto de pontualidade (por exemplo, 5%).
- Esperado: no painel do sandbox, a cobrança com o **desconto até o vencimento**.
- Pague dentro do prazo. Esperado: a baixa pelo valor com desconto.

**C5. Passar da recorrência.** Numa adesão (ou caso) em **recorrência**, use **Passar para…** boleto.
- Esperado: a tela pede a **concordância do cliente** e só segue com a marca.

**C6. Mensalidade vencida no selo.** Deixe uma mensalidade vencida (ou ajuste a data de uma de teste para ontem, se tiver como).
- Esperado: o selo **"Em atraso"** do cliente conta a mensalidade.

**C7. Baixa à mão com boleto vivo.** Tente dar baixa à mão numa mensalidade com boleto vivo.
- Esperado: **recusada**, com a orientação de esperar o aviso ou cancelar a cobrança antes.

**C8. Cancelar a adesão.** Cancele a adesão do C3.
- Esperado: as mensalidades **que ainda não venceram** caem, com o boleto cancelado no Asaas; as vencidas ficam.

**C9. Desligar.** Volte em Mensalidades pelo Asaas e **Desligue** Londrina, para o treino ficar como estava.

---

## O que me mandar
- O resultado de cada passo (OK, ou o que viu), com o nome do cliente de teste.
- Se algo não bater, um print da tela e a hora aproximada.
- Mensagens: você não deve ter recebido nenhuma. Se recebeu, me diga qual e de quem.
