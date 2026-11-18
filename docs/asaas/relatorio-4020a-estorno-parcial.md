# 4020a — Estorno de parte pelo Asaas: relatório e roteiro de teste (17/11/2026)

**Situação:** construída; está no projeto de teste (risarte-asaas.vercel.app, **0.481.0**, Asaas 0.20.0). **Não está na produção.** Spec 19.38.6 e 19.38.7; manual 13g.19; EV-383.

## O que foi feito

- **Estornar parte:** na ficha (cobrança paga pelo Asaas no Pix ou no cartão, e no cartão parcelado) e no distrato. O motivo é sempre obrigatório.
- **Cuidado 1, a confirmação reforçada no cartão:**
  - a tela mostra o valor, o paciente, a repartição prevista e o aviso em vermelho "no cartão, o estorno sai na hora e não pode ser desfeito";
  - acima do valor da Central (em branco = todos), o Gerente ou o franqueado confirma; quem pediu não consegue confirmar.
- **Cuidado 2, a repartição real:** depois do pedido, o riSZon lê no Asaas o que ele fez, grava e mostra "O Asaas fez". Se for diferente da previsão, avisa quem pediu e o Financeiro.
- **Cuidado 3, a parcela "Estornada":**
  - a parcela estornada inteira tem a baixa desfeita e não volta a ser cobrada sozinha;
  - só o Gerente reabre, com motivo;
  - no distrato, ela segue o distrato;
  - a taxa da rede continua devida.
- **A régua:**
  - Pix: 1º dia útil, a cada 7 dias, o 25º dia, e a queda aos 30 dias;
  - cartão em processamento: o Financeiro é avisado depois de 5 dias úteis;
  - sem saldo: o pedido fica parado, e quem pediu é avisado quando o estorno volta a ficar disponível.

## As provas

| Prova | Resultado |
|---|---|
| Ensaio da 4020a (treino) | 38/38; provado quebrando (parcial, taxa, parcela, confirma, régua) |
| Vizinhos | distrato 64/64, cobrança mensal 106/106, conferência 28/28, mensalidades 54/54 |
| Suíte inteira, tsc, eslint | 4873 passaram, 0 falhas; limpos |
| Sandbox (parcelado de Londrina 3× R$ 100,00) | **O Asaas recusou:** "só pode ser estornada parcialmente no próximo dia". O pedido ficou "Não saiu", nada foi estornado, e a mensagem agora diz "peça de novo amanhã". **Repetir em 18/11.** |

**Fato novo do Asaas:** no cartão, o estorno de **parte** não é aceito no mesmo dia da aprovação. Não contradiz a especificação; foi para o manual.

## Roteiro de teste (no projeto de teste, com os usuários do treino)

Use a venda direta **"Prova 4020a estorno parcial sem contato"** de Londrina (o pagador não tem contato, então nada é enviado ao paciente). Faça a partir de **18/11**: no dia da aprovação, o Asaas recusa o parcial.

1. **A Central** (Admin Master ou Financeiro da Franqueadora): Central › Rede › Taxas da franquia › "Estorno de cartão: acima de quanto o Gerente ou o franqueado confirma". Deixe **em branco**: todo estorno de cartão vai pedir confirmação.
2. **O pedido** (como Admin Master): ficha do paciente › Financeiro › no cartão parcelado, **Estornar parte**.
   - **Confira:** o paciente; "ainda pode ser estornado"; com R$ 50,00, a previsão "Parcela 1: R$ 50,00 (parte: a parcela continua paga)"; o aviso vermelho; "precisa da confirmação do Gerente ou do franqueado".
   - Escreva o motivo e **Pedir (vai para a confirmação)**.
3. **Quem pediu não confirma:** ainda como Admin, no topo da aba Financeiro, em "Pedidos de estorno", **não** aparece "Confirmar o estorno".
4. **A confirmação** (como Gerente de Londrina): mesma ficha › **Confirmar o estorno** › OK no aviso.
   - **Esperado:** "Pedido ao Asaas" e, abaixo, "O Asaas fez: R$ 50,00 …".
5. **A parcela inteira** (opcional, gasta R$ 100,00 do parcelado): repita com R$ 100,00 na parcela seguinte.
   - **Esperado:** quando o Asaas avisar, a parcela aparece em **"Parcelas estornadas"** como *Estornada*.
   - Como Gerente: **Reabrir**, com motivo. A parcela volta para a lista de cobranças.
6. **Cancelar um pedido:** faça um novo pedido e, antes de confirmar, **Cancelar o pedido** com motivo. Ele some da lista, e nada vai ao Asaas.

**Atenção:** amanhã eu também uso este parcelado para a prova no sandbox (R$ 120,00). Ele tem R$ 300,00 no total. Se fizer o passo 5, avise, para eu ajustar o valor.

## Falta

- A prova do sandbox em 18/11.
- O seu teste pela tela.
- A 4020a na produção: só com o seu "pode". As três migrações (4020a, 4021 e 4021a) vão juntas ou em sequência, em qualquer ordem entre a 4020a e a 4021.
