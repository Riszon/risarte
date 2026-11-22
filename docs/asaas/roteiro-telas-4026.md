# Roteiro das telas da 4026 (pagamento no cartão de débito), no projeto de teste

Site: https://risarte-asaas.vercel.app (TREINO), versão **0.490.0**. Entre como Admin Master.

A demonstração está gravada no treino (`scripts/asaas-demo-4026-debito.mjs`, 21/11/2026): duas parcelas de R$ 320,00 de um paciente de teste de Londrina, com a cobrança "Demonstração 4026", pagas no débito pelo aviso simulado.
- **Caso A:** o split foi corrigido.
- **Caso B:** a correção foi recusada, e o a mais virou crédito.
  - No treino, as tarifas do débito (1,89% + R$ 0,35) e do crédito (1,99% + R$ 0,49) são próximas. Por isso o crédito do caso B é só R$ 0,07.
  - Na produção, com 2,39% + R$ 0,29, seria cerca de R$ 0,27 nesse valor.

## 1. A parcela e a cobrança
- Abra o paciente: `/prontuarios/da0b7f27-dc34-49fc-b53d-7afdf5484192?aba=financeiro`.
- **Confira:** nas duas parcelas de R$ 320,00 pagas, a linha da cobrança diz **"Paga pelo Asaas — pago no cartão de débito"**.
- Painel de cobranças (`/financeiro/cobrancas`), filtro Londrina, situação paga.
- **Confira:** as duas cobranças aparecem com o meio **"Pago no cartão de débito"**.

## 2. O Painel de repasses
- `/financeiro/repasses-da-franquia`, mês de novembro de 2026, Londrina.
- **Confira:** no fim da página, a parte **"Pagamentos no cartão de débito"**, com duas linhas:
  - "split corrigido — pago no débito", com o valor que deixou de ir a mais;
  - "crédito — split a mais no débito · entra na próxima cobrança mensal", R$ 0,07.

## 3. O demonstrativo da cobrança mensal
- **Não dá para ver hoje no treino.** A cobrança de outubro de Londrina e a de Cambé já estão pagas no treino, e novembro ainda não fechou.
- O crédito do caso B entra na cobrança de novembro, aberta a partir de 1º/12. Aí aparece a linha **"Crédito — split a mais no débito"**, negativa, em `/financeiro/cobranca-da-rede`.
- No ensaio, a linha foi conferida pelo banco: o item, o valor, o uso na baixa e o acumulado.

## 4. A Central
- Londrina: `/central/unidades/9490e17e-2f0c-4a2d-838b-0990577a2ab7/conta`. No quadro "Antes de ligar", confira:
  - o item **"Cartão de débito conferido no painel do Asaas"**, com a marca atual;
  - os botões "Marcar: o débito está desabilitado" e "Marcar: o débito está habilitado";
  - o "habilitado" pede confirmação e lembra a prova de R$ 10,00. **Não clique em "habilitado"** se não quiser mudar a marca do treino.
- A faixa de prontidão de Londrina continua "Pronta", com o item novo.
- A franqueadora: Central da rede, aba Conta e tarifas.
  - **Confira:** a linha **"Débito desabilitado no painel do Asaas da franqueadora"** e o botão "Marcar: o débito está desabilitado".
  - A marca não muda a prontidão, e o banco recusa "habilitado" para a franqueadora.
