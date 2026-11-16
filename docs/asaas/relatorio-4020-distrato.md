# Relatório — 4020, distrato com checklist (16/11/2026)

**Versões:**
- core 0.456.5, Asaas 0.17.0, migração 4020;
- vai junto o aviso das assinaturas (0.456.4).

**Onde está:**
- no treino e no projeto de teste (https://risarte-asaas.vercel.app, mostrando 0.456.5);
- **não está na produção**: espera o seu roteiro da 4017, 4017a e 4018 e o "pode".

## 1. Ensaio no treino — 63/63

`RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-distrato.mjs --confirmar`, numa transação desfeita.

**O que prova:**

- **Pedido e decisão:**
  - a Recepção pede; o Dentista não;
  - não há segundo pedido aberto;
  - só o Gerente mantém, e com motivo.
- **Atraso:**
  - 70 dias de atraso viram aviso ao Gerente;
  - o aviso não se repete no mesmo dia;
  - o contrato continua de pé;
  - "manter" para o aviso;
  - o prazo vem da Central.
- **Acordo de duas vendas (contrato + venda direta):**
  - a parte do contrato é a proporção da origem (57,84% no cenário);
  - o acerto conta essa parte do pago no acordo;
  - as parcelas abertas do acordo são **reduzidas** na proporção, e o acordo continua para a venda direta;
  - o termo mostra antes e depois.
- **Checklist:**
  - efetivar sem ela é recusado, e nada é cancelado;
  - "não se aplica" exige motivo;
  - a Recepção não marca.
- **Parcial:** cai com as outras.
- **Pagamento depois do termo:** efetivar é recusado (descarte e abra de novo).
- **Acordo que ainda não vale:** é cancelado antes.
- **Ortodontia:**
  - o caso fica interrompido;
  - as mensalidades futuras caem;
  - a vencida continua como dívida.
- **Venda direta:**
  - sem pago, o cancelamento simples; com pago, só pelo distrato;
  - o acerto é sem multa;
  - no cartão parcelado aprovado, as linhas da taxa **a reter não caem**.
- **Devolução:**
  - sem o termo, recusada;
  - pedir acima do saldo, recusado;
  - o Gerente não autoriza;
  - o Financeiro autoriza → conta a pagar 1.9.03;
  - o Financeiro vê todas as devoluções;
  - a taxa continua devida.
- **Riso+ Social:** o estorno da mensalidade do PPR+ tira os pontos, e a mensalidade continua paga.
- **Leituras:** o Dentista não lê os distratos.

**Provado quebrando (cada modo reprova):**

| Modo | O que quebra | Resultado |
|---|---|---|
| `--quebrar=antes` | efetiva sem a checklist | 3 falhas |
| `--quebrar=proporcao` | a parte da venda vira 100% | 4 falhas |
| `--quebrar=taxa` | a taxa some no distrato | 2 falhas |
| `--quebrar=pontos` | o estorno deixa os pontos | 1 falha |
| `--quebrar=parcial` | a parcial não cai | 1 falha |

**Também passaram:**
- os ensaios anteriores:

  | Ensaio | Resultado |
  |---|---|
  | renegociação | 73/73 |
  | 4017a | 39/39 |
  | 4015a | 13/13 |
  | 1B | 42/42 |
  | mensalidades | 54/54 |
  | 4013 | 34/34 |
  | 4014 | 31/31 |
  | 4012 | 43/43 |
  | 4011 | 60/60 |

- `test:indica` 246/0;
- a suíte inteira, 4554 testes.

## 2. Prova no sandbox — 4/4

`asaas-asa4-distrato.integracao.test.ts`, conta de Londrina.
- **Pagador sem e-mail e sem celular: nenhuma mensagem foi enviada.**
- **Cenário:** venda direta na **forma 2**, com 4 boletos vivos e a lista com o link.
- **O que aconteceu:**
  1. O 1º boleto foi pago pela simulação, e a baixa veio pelo aviso do Asaas.
  2. O cancelamento simples foi recusado.
  3. Abrir o distrato **não apagou nada** no Asaas.
  4. Efetivar sem a checklist foi recusado.
  5. Com a checklist e o termo, efetivar:
     - os **3 boletos em aberto apagados no Asaas**;
     - o pago intocado (RECEIVED);
     - a venda cancelada.
  6. A página da lista mostrou: **pago, cancelado, cancelado, cancelado**.

## 3. Refinamentos da construção (diferenças do plano)

1. **Pagamento depois do termo.**
   - **O plano:** dizia "recalculado ao efetivar".
   - **O que foi feito:** o efetivar é **recusado**, e a tela orienta a descartar e abrir de novo.
   - **Por quê:** assim o número do termo assinado é sempre o número efetivado.
2. **A lista da forma 2.**
   - **O plano:** dizia "revogada".
   - **O que foi feito:** a lista **continua no ar** e mostra cada boleto como "Cancelado".
   - **Por quê:** revogar faria a página recusar o link inteiro.
3. **Venda direta já concluída** (a 1ª baixa fecha a venda): o caminho dela é o distrato, e a mensagem diz isso.
4. **A quebra `lista` virou `parcial`**, porque a lista não é revogada.

## 4. O que você deve testar no projeto de teste (depois do roteiro da 4017, 4017a e 4018)

Entre como Admin Master e, nos passos 👤, como Gerente, Recepcionista e Financeiro da Franqueadora. Use clientes sem e-mail e sem celular.

1. **Pedido de distrato.**
   - 👤 Recepcionista: na ficha de um cliente com plano fechado, no cartão do tratamento, clique em **Pedir distrato** com o motivo.
   - 👤 Gerente: chega o aviso. Em Financeiro › Cobranças automáticas › **Distratos e devoluções**, o pedido aparece.
   - Clique em **Manter o contrato**, com o motivo. Esperado: o pedido sai da lista.
2. **Abrir o distrato do contrato.**
   - 👤 Gerente: **Cancelar tratamento** → **Gerar termo de distrato**.
   - Esperado:
     - o termo com o título "Termo de distrato";
     - a frase "As cobranças em aberto continuam valendo até a assinatura deste termo";
     - a **checklist** com os 8 itens.
   - Os boletos continuam vivos no painel do sandbox.
3. **A checklist.**
   - Marque o termo como assinado e tente **Efetivar**. Esperado: bloqueado, "faltam N itens".
   - Marque um item como **Não se aplica** sem motivo. Esperado: pede o motivo.
   - Marque os 8.
   - **Efetivar** → confirma o cancelamento dos boletos. Esperado: no sandbox, os boletos em aberto apagados.
4. **Acordo de duas vendas.**
   - Num cliente com um plano e uma venda direta, renegocie uma parcela de cada uma num acordo só e anexe o termo assinado.
   - Abra o distrato do plano. Esperado:
     - o termo mostra o acordo **antes e depois**, com "[REVISÃO JURÍDICA]";
     - depois de efetivar, as parcelas do acordo reduzidas, e o acordo continua para a venda direta.
5. **Venda direta com algo pago.**
   - Dê baixa numa parcela e tente **Cancelar venda**. Esperado: a orientação do distrato.
   - **Abrir distrato** → o termo de distrato da venda direta, sem multa.
6. **A devolução.**
   - Num distrato efetivado em que a unidade devolve, use **Pedir a devolução** com o termo anexado (PDF).
   - 👤 Financeiro: em **Distratos e devoluções**, **Autorizar**. Esperado: a conta a pagar 1.9.03 em Contas a pagar.
   - Teste também: quem pediu não autoriza.
7. **Central.** Na Central › Financeiro, o campo "Distrato: avisar o Gerente com o contrato em atraso há quantos dias (15 a 365)", com 60.
8. **Mensalidades.** A tela de ligar as mensalidades mostra o aviso das assinaturas antigas (a parte C do roteiro já cobre).

Mensagens: você não deve receber nenhuma.

## 5. Pendências

- **Prova do estorno parcial do Pix (4020a):**
  - os R$ 30,00 estão esperando a sua autorização no painel do sandbox;
  - me avise com "autorizei", e eu mostro o aviso que chegou, o split da franqueadora e o que aconteceu com a baixa.
- **Prova do estorno parcial do cartão parcelado:**
  - o Asaas só aceita a partir de **17/11**;
  - eu peço e aviso quando estiver esperando a autorização.
- **A produção da 4020:** depois do seu roteiro e do "pode".
- **Ortodontia na produção:** levantamento rodado em 16/11/2026, sem nenhuma linha. Não há o que corrigir.
