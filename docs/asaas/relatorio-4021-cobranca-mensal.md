# Relatório — 4021, a cobrança mensal da rede (16/11/2026)

**Versões:** core 0.461.0, Asaas 0.18.0, migração 4021.

**Onde está:**
- no treino e no projeto de teste (https://risarte-asaas.vercel.app, mostrando 0.461.0);
- **não está na produção**: espera o seu teste e o "pode".

**O plano** (seção 20) foi aprovado com 1a a 6a e os quatro complementos (20.15). O que mudou na construção está na 20.16.

## 1. Ensaio no treino — 103/103

`RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa6-cobranca-mensal.mjs --confirmar`, numa transação desfeita, com valores de exemplo.

**O cenário:** Londrina, setembro e outubro de 2026.

**O que prova:**

- **A configuração:**
  - nasce em branco (falta tudo, e a prévia não abre);
  - só o Financeiro ou o Admin configura;
  - sem o valor de SDR e de tecnologia, ainda falta;
  - completa, libera.
- **A prévia de setembro:**
  - a tecnologia e o SDR proporcionais (a unidade começou em 16/09: 15 de 30 dias);
  - as duas linhas "a cobrar" entram, com a origem;
  - **ficam de fora:** a linha retida pelo split, o "a reter" do cartão parcelado, a linha dispensada e o saldo anterior (agosto);
  - total de R$ 480,00;
  - a unidade é avisada, com o prazo e a frase do silêncio;
  - a mesma prévia não abre duas vezes.
- **Quem vê:**
  - o Gerente lê a da sua unidade;
  - o Dentista e a Recepção não leem, e a lista deles vem vazia;
  - o Gerente de Londrina não lê a de Cambé;
  - as tabelas novas não têm leitura direta.
- **A contestação na prévia:**
  - aprovar antes do prazo, sem a unidade conferir, é recusado;
  - o Dentista não contesta;
  - o motivo é exigido;
  - com contestação aberta, a unidade não confere, e o Gerente não decide;
  - aceita: a linha e a taxa dela ficam dispensadas, e a conta a pagar do fundo some;
  - recusada: a linha volta a valer.
- **A aprovação e a emissão:**
  - só o Financeiro aprova: R$ 460,00;
  - a cobrança sai pela conta da franqueadora, com a unidade como pagadora;
  - boleto com Pix, sem desconto, multa de R$ 9,20 e juros de 1%;
  - o vencimento nunca no passado;
  - o pagador é a razão social e o CNPJ, e o e-mail financeiro vai para o cadastro;
  - emitida, a unidade é avisada;
  - a Recepção não vê a cobrança.
- **O pagamento pelo aviso do Asaas, com multa e juros:**
  - o lote fica pago, com R$ 10,00 de multa e juros;
  - as contas de taxa de setembro ficam pagas;
  - o caixa da unidade sai pelo total faturado;
  - o caixa da franqueadora entra pelo total, só como caixa, e a receita por competência continua no lançamento do mês;
  - a multa e os juros vão para o financeiro dos dois lados, sem taxa sobre taxa;
  - a tarifa do Asaas fica com a franqueadora;
  - o mesmo aviso de novo não baixa duas vezes;
  - a cobrança paga não se cancela.
- **Depois do fechamento:**
  - o estorno de setembro entra em outubro como ajuste;
  - a linha de setembro desfeita volta como ajuste negativo.
- **A contestação depois da emissão, com setembro já fechado:**
  - o boleto não muda;
  - o crédito de −R$ 250,00 sai em outubro, com a linha de origem;
  - a dispensa entra no mês aberto, nos dois lados;
  - o mês fechado não é mexido.
- **O saldo anterior:**
  - aparece em separado;
  - o Gerente não decide;
  - o Financeiro parcela em 2, com o motivo;
  - a parcela 1 entra em outubro;
  - a decisão não se repete.
- **A prévia de outubro pela rotina do dia:**
  - o total confere;
  - **cada linha de taxa tem um dono só:** faturado = devido, linha a linha;
  - o retido e o "a reter" nunca foram faturados.
- **Os avisos:**
  - o lembrete 1 dia útil antes do fim;
  - no silêncio, a prévia vai para a aprovação;
  - depois do prazo, a unidade não contesta mais;
  - vencida, o aviso à unidade e ao Financeiro; aos 30 dias, ao Admin Master.
- **Outubro:**
  - o fundo com conta própria vai por split, valor fixo;
  - cancelada para reemitir, a prévia remonta com as mesmas linhas;
  - paga: o crédito entra como compensação, sem saída de caixa;
  - o caixa da unidade e o da franqueadora são iguais ao boleto.
- **Mês sem nada e abaixo do mínimo:**
  - sem nada: sem cobrança;
  - R$ 3,00: acumula, e volta a entrar na prévia seguinte.
- **A 4021 roda duas vezes sem erro,** e nenhuma regra de acesso chama função fechada.

**Provado quebrando (cada modo reprova):**

| Modo | O que quebra | Resultado |
|---|---|---|
| `--quebrar=dobro` | a mesma linha faturada duas vezes | 8 falhas |
| `--quebrar=fora` | a linha do estorno fica de fora | 6 falhas |
| `--quebrar=reter` | o retido e o "a reter" faturados | 14 falhas |
| `--quebrar=baixa` | o pagamento sem liquidar as contas | 9 falhas |

**Também passaram:**
- os ensaios do distrato (64/64), da 4017a (39/39), da 4015a (13/13) e das mensalidades (54/54);
- os testes da 4021 (16/16);
- a suíte inteira.

**Não rodaram até o fim** os ensaios da renegociação e da 1B. Eles reaplicam a 4017, cuja regra não conhece o estado "encerrada" que o roteiro de hoje gravou no treino. Não é efeito da 4021.

## 2. Prova no sandbox — 4/4

`asaas-asa6-cobranca-mensal.integracao.test.ts`, pela **conta raiz** (a franqueadora).

**Como foi feita:**
- a unidade de Londrina foi a pagadora;
- valores de exemplo: tecnologia R$ 300,00 e SDR R$ 500,00;
- o e-mail foi um endereço @example.com, que não entrega a ninguém;
- **nada foi enviado a você.**

**O que aconteceu:**
1. A prévia de outubro abriu (R$ 800,00, marcada como exemplo). O prazo passou sem contestação, e a prévia foi aprovada.
2. **Emitida no Asaas:**
   - boleto de R$ 800,00, vencendo em 17/11;
   - multa de R$ 16,00 e juros de 1% ao mês, sem desconto;
   - a referência é o id da cobrança no riSZon.
3. **O pagador no Asaas:**
   - o CNPJ 32.042.156/0001-21;
   - o e-mail financeiro, com os avisos do Asaas ligados;
   - sem celular: só e-mail.
4. **Cancelada para reemitir:** apagada no Asaas, o lote caiu. A prévia remontou com o mesmo valor, foi aprovada e reemitida.
5. **Paga pela simulação do sandbox:**
   - a baixa veio sozinha, pelo aviso do Asaas à conta raiz;
   - as contas de taxa de outubro de Londrina ficaram pagas;
   - o caixa da unidade foi igual ao boleto;
   - a tarifa do Asaas (R$ 1,99) ficou com a franqueadora.
6. **No fim, o treino voltou ao que era:**
   - a configuração em branco;
   - SDR e tecnologia zerados;
   - outubro de Londrina fechado de novo.

   O lote pago ficou registrado, marcado como exemplo.

**Não provado no sandbox** (está no ensaio):
- o split do fundo (o fundo de teste não tem webhook, e outubro não tinha linha de fundo);
- o pagamento em atraso: o sandbox não emite com vencimento no passado. A prova do atraso das mensalidades é amanhã, como combinado.

## 3. Refinamentos da construção (detalhe na 20.16)

1. **O crédito do mês seguinte é compensação.** A linha negativa aparece, e o boleto vem menor. Na baixa, o crédito paga parte das contas de taxa sem saída de caixa.
2. **O caixa da franqueadora vai num lançamento só de caixa.** A receita por competência fica intacta, e os dois jeitos do contador ficam prontos.
3. **Mês fechado na contabilidade:** a dispensa entra no mês aberto, como ajuste. Se o 1º mês estiver fechado e sem a taxa fixa lançada, a prévia não abre e diz o porquê.
4. **O vencimento:** se o dia configurado já passou na aprovação, é amanhã, porque o Asaas não aceita data no passado.
5. **Os campos antigos de multa e juros** da aba Taxas não foram copiados: a configuração nova nasce em branco.

## 4. O que você deve testar no projeto de teste

Entre como Admin Master. Nos passos 👤, entre como Gerente de Londrina e como Financeiro da Franqueadora.

**Os valores que você digitar no teste são exemplo:** marque "Valores de exemplo".

1. **A configuração em branco.**
   - Em Central › Rede › Taxas da franquia, o quadro "Cobrança mensal às unidades": todos os campos em branco.
   - Na unidade de Londrina: "Falta: …" com a lista.
2. **Preencher (exemplo).**
   - **Na rede:** multa 2, juros 1, dia 10, mês calendário, 5 dias de prévia, proporcional. Marque "Valores de exemplo" e grave.
   - **Em Londrina:** um e-mail seu de teste **@example.com** (não use o seu e-mail real), o primeiro mês = outubro de 2026. Grave.
   - **Em Taxas da rede:** SDR e tecnologia com valores de exemplo.
   - **Esperado:** "Configuração completa".
   - **Observação:** outubro de Londrina está **fechado** no treino. Esperado: a prévia recusa, com a mensagem do mês fechado. Para seguir, reabra outubro de Londrina em Financeiro › Fechamento, ou use um mês aberto.
3. **A prévia.**
   - Em Financeiro › Rede › **Cobrança da rede**, abra a prévia de Londrina para outubro.
   - **Esperado:**
     - a linha da tecnologia e a do SDR, com o mês;
     - o resumo com o total;
     - o informativo (retido e "a reter");
     - a frase "Confira até DD/MM. Sem contestação até essa data, a cobrança segue para aprovação e é emitida.";
     - "Baixar a planilha" baixa o CSV.
4. 👤 **Gerente de Londrina:**
   - Em Financeiro › Rede › Cobrança da rede, abra a prévia e **conteste** uma linha, com o motivo (e um PDF, se quiser).
   - Tente **Conferi, está de acordo**. Esperado: recusado, há contestação aberta.
   - O Gerente não vê "Aprovar e emitir".
5. 👤 **Financeiro:**
   - **Recuse** a contestação, com o motivo. Esperado: a linha volta a valer.
   - O Gerente confere ("Conferi, está de acordo").
6. **Aprovar e emitir** (Financeiro ou Admin).
   - **Esperado:** a cobrança emitida, com "Abrir a fatura" e a linha digitável.
   - **No painel do sandbox da conta raiz:**
     - o boleto em nome da unidade (CNPJ);
     - a multa e os juros;
     - o cliente com o e-mail de teste.
7. **Cancelar para reemitir** (com o motivo).
   - **Esperado:** apagada no Asaas; a prévia de outubro volta a ser montada (abra de novo, aprove e emita).
8. **Pagar no sandbox** (botão de confirmar pagamento no painel da conta raiz).
   - **Esperado,** em até 1 minuto:
     - "Paga";
     - em Contas a pagar de Londrina, as taxas de outubro pagas.
9. **O saldo anterior.** Em "Saldo anterior desta unidade", as contas de taxa de Londrina antes de outubro.
   - **Esperado:** a lista e o total.
   - Grave uma decisão só se quiser: ela não se refaz.
10. **Quem não vê.** Entre como Recepcionista ou Dentista. Esperado: não há "Cobrança da rede" no menu, e o endereço direto volta ao Financeiro.
11. **No fim:**
    - apague os valores de exemplo (deixe os campos em branco);
    - zere SDR e tecnologia;
    - feche outubro de Londrina de novo, se reabriu.

**Mensagens:** você não deve receber nenhuma (o e-mail é @example.com).

## 5. Para a produção (quando você disser "pode")

- **A migração 4021:**
  - cria as tabelas e as funções;
  - não preenche nenhum valor (tudo em branco);
  - nenhuma unidade entra sozinha: sem o primeiro mês, a rotina não abre nada.
- **A emissão de verdade** só depois da ASA7 (a conta raiz de produção) e com a sua aprovação.

**Antes de ligar a 1ª unidade:**
1. **O saldo anterior:** rode `docs/asaas/levantamento-taxas-acumuladas.sql`, só leitura (no treino: Londrina com R$ 188,02 de novembro).
2. **Os valores do contrato.**
3. **Os meses fechados:** confira se o 1º mês da unidade não está fechado sem a taxa fixa.

## 6. Pendências

- **4021a** (a conciliação do mês, `reconciliation_issues` e o painel): é a próxima.
- **Amanhã (17/11):**
  - o estorno parcial do cartão parcelado: eu peço e aviso quando estiver esperando a sua autorização;
  - a prova do atraso das mensalidades.
- **Pendente do contador:** o reconhecimento da receita da taxa e a nota dos royalties (nada trava).
