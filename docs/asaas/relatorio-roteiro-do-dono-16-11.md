# Roteiro de teste pelas telas — resultado (16/11/2026)

**Pedido do dono:** "faça você mesmo o roteiro teste e veja o resultado".

**Como foi feito:**
- **Onde:** no projeto de teste publicado (https://risarte-asaas.vercel.app, banco de treino, Asaas sandbox), pela tela de verdade, com o Playwright (`e2e-publicado/roteiro-dono-*.spec.ts`).
- **Como se entrou:** cada papel entra pelo link de acesso de uso único. Nenhuma senha foi digitada.
- **Os clientes:** todos novos, sem e-mail e sem celular, então nada foi enviado a ninguém. A exceção é o contrato da parte D, o **LDN-00047** do treino: as parcelas dele são em depósito à vista, e nenhuma cobrança do Asaas foi criada nem apagada para ele.
- **Ajustes no treino, desfeitos no fim:** o Gerente de teste foi Gerente de Londrina durante o roteiro, e a criação automática das cobranças de Londrina ficou ligada.

## Resultado

### Parte A — renegociação assinada (4017)

| Passo | Resultado |
|---|---|
| A2 | ✅ A forma dos boletos já vem marcada ("a da venda de origem"). O 1º vencimento vem uma semana à frente. O acordo fica "Aguardando assinatura", com prazo. As parcelas e os boletos antigos continuam valendo. A ficha mostra a faixa e "Em renegociação". |
| A3 | ✅ "Quando o cliente assinar, 2 boleto(s) já entregue(s) ao cliente serão cancelados. Enviar o termo?" (não confirmado). |
| A4 | ✅ **depois da correção 2.** O termo anexado aplica o acordo: as parcelas 2 e 3 viram Renegociada, os boletos delas são apagados no Asaas e nascem as 3 parcelas novas. |
| A5 | ✅ O pagamento da parcela 4 no sandbox, antes da assinatura, deixa o acordo "Cancelado pelo pagamento", com o aviso para refazer. |
| A6 | ✅ "O desconto abate, nesta ordem: juros R$ 0,67 · multa R$ 2,00 · benefício R$ 0,00 · principal R$ 0,00". |
| A7 | não rodado (opcional: só dá para ver depois do prazo). |
| A8 | ✅ **depois da correção 2.** Na forma 2, o mesmo link mostra os boletos novos e marca os 2 antigos como "Substituído pela renegociação — não pague". |
| A9 | ✅ "Esta parcela é de uma venda que ainda não foi fechada. Feche a venda (contrato assinado) antes de renegociar." |
| A10 | ✅ O "Enviar termo" lista a cobrança externa e exige a marca do Gerente "Cancelei no painel do Asaas". Confirmado, a marcação some. A Recepção nem vê o "Enviar termo" (a regra do manual: envia quem negociou, o Gerente, o Financeiro ou o Admin). |

### Parte B — exceção (4017a), na venda direta

| Passo | Resultado |
|---|---|
| B1 | ✅ Com o acordo pendente, o cancelamento é recusado e mostra o acordo e o botão "Cancelar o acordo pendente". Cancelado o acordo, a venda é cancelada. |
| B2 | ✅ A Recepção vê "Chame o Gerente da unidade…" e não vê o "Pedir exceção". O Gerente pede, com o motivo (conferido no banco). |
| B3 | ✅ O pedido aparece em "Pedidos de exceção", e o aviso chega ao Financeiro. O Financeiro autoriza (vale até 23/11). No pedido feito pelo Admin Master, ele não vê o "Autorizar". |
| B4 | ✅ Com a exceção, a venda é cancelada, as parcelas do acordo caem, o acordo fica Encerrado e a exceção fica "usada". |
| B5 | ✅ "Este acordo junta parcelas de outras vendas. O cancelamento fica para o distrato." Com a 4020, o Gerente já tem o "Abrir distrato". |

### Parte C — mensalidades (4018)

| Passo | Resultado |
|---|---|
| C1 | ✅ A tela mostra quem entra agora (PPR+ 0, Ortodontia 1), quem espera a ASA4B (PPR+ 5) e quantos têm contato. Aparece o aviso das assinaturas antigas. O "Ligar" fica bloqueado sem a marca "Avisei os clientes e cancelei as assinaturas antigas." |
| C2 | ✅ Londrina ligada a partir de 16/11. |
| C3 | ✅ A 1ª mensalidade do PPR+ nasce na assinatura. O boleto vai ao Asaas sem multa nem juros. Paga no sandbox, a adesão fica ativa sozinha. |
| C4 | ✅ O desconto de pontualidade vai ao Asaas (R$ 8,80, até o vencimento). Paga no prazo, o Asaas recebeu R$ 167,20. |
| C5 | ✅ "Passar para boleto": sem a concordância, nada muda; com ela, muda e fica registrada. |
| C6 | ✅ "Em atraso há 20 dias", pela mensalidade vencida. |
| C7 | ✅ "Esta mensalidade tem cobrança viva no Asaas. Espere o aviso do pagamento, ou cancele a cobrança antes de mudar ou dar baixa à mão." |
| C8 | ✅ Cancelada a adesão, a mensalidade que não venceu cai, e o boleto é apagado no Asaas. |
| C9 | ✅ Desligado: Londrina volta sem as mensalidades pelo Asaas. |

### Parte D — distrato (4020, seção 4 do relatório da 4020)

| Passo | Resultado |
|---|---|
| D1 | ✅ **depois da correção 3.** A Recepção registra o pedido na aba Financeiro. O Gerente é avisado, e o pedido aparece em "Distratos e devoluções". "Manter o contrato", com o motivo, deixa o pedido como "mantido". |
| D2 | ✅ O "Termo de distrato de plano de tratamento" tem a frase "As cobranças em aberto continuam valendo até a assinatura deste termo" e a checklist. |
| D3 | ✅ Com o termo assinado e a checklist aberta, o Efetivar fica bloqueado ("faltam 8 item(ns)"). Com os 8 itens, o distrato é efetivado e as parcelas do contrato caem. *Não conferido pela tela:* o aviso de "Não se aplica" sem motivo. O banco recusa (ensaio). |
| D4 | ✅ O termo mostra o acordo antes e depois, com "[REVISÃO JURÍDICA]" e "Deixa de ser cobrado R$ 137,20". Efetivado, o aberto do acordo caiu de R$ 237,20 para R$ 100,00, e o acordo continua para a venda direta. |
| D5 | ✅ **depois da correção 4.** A venda direta paga (concluída) mostra o bloco do distrato ("Já pago nesta venda: R$ 200,00. O cancelamento é pelo distrato, com o acerto (sem multa)"). O "Termo de distrato de venda direta" sai sem multa. Efetivado, a unidade devolve R$ 200,00. |
| D6 | ✅ O Gerente pede a devolução com o termo anexado e não vê o "Autorizar". O Financeiro autoriza, e a conta a pagar 1.9.03 é criada. |
| D7 | ✅ Central › Rede › Financeiro: "Distrato: avisar o Gerente com o contrato em atraso há quantos dias (15 a 365)". |

## Os defeitos que o roteiro achou (todos corrigidos no projeto de teste)

1. **Renegociação (4017): o 1º vencimento vinha com a data de hoje, que o banco sempre recusa.** Quem não mudasse a data recebia erro ao salvar. Agora vem uma semana à frente, e a data mínima é amanhã. *Na produção hoje: sim.*
2. **Regras de acesso que chamavam funções fechadas para o usuário logado (4015, 4017, 4017a).**
   - **O efeito:** o "Anexar termo assinado" falhava **sempre**, até para o Admin Master; a leitura direta da lista de exceções e a das listas da forma 2 também caíam.
   - **A correção:** liberar duas funções que só dizem "sim ou não" sobre a própria pessoa. Ela está dentro da 4020 e também, separada, em `docs/asaas/correcao-producao-regras-de-acesso.sql`.
   - **A prevenção:** o ensaio do distrato confere que nenhuma regra de acesso volta a chamar função fechada.
   - *Na produção hoje: sim.*
3. **Distrato (4020): a Recepção não via o "Pedir distrato".** Ela não tem a aba Plano. O pedido agora fica também no topo da aba Financeiro.
4. **Distrato (4020): a venda direta concluída (já paga) não mostrava nem o cancelamento nem o distrato.** Agora ela mostra o bloco do distrato.

## Para o dono saber

- **Cobranças pelo Asaas nas fichas:** o Gerente e a Recepção não veem o bloco "Cobrança pelo Asaas" de cada parcela (link, boleto, "Já cobrada fora").
  - **Por quê:** é a decisão da ASA1. Ver, emitir e cancelar cobranças nascem só com o Admin Master, e o dono libera os outros papéis no **Painel de permissões**.
  - **Antes de ligar as unidades:** essa liberação precisa ser feita.
- **O limite de entradas do Supabase do treino:** com muitas entradas pelo link de uso único seguidas, o Supabase passou a recusar por alguns minutos. Não afeta o uso normal.
