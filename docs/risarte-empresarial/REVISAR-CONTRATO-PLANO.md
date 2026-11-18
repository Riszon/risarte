# Regras combinadas e "Revisar contrato" — plano (18/11/2026)

Pedido do dono: *"quando eu crio uma empresa através de uma importação eu fico
limitado às personalizações da empresa… elas já estão configuradas para não
pagar implantação, e esta premissa está errada. Quando criada a empresa deve
ter como visualizar todas as regras combinadas, faixa de pagamento etc. e deve
ter uma opção de revisar contrato, para revisar todas as regras e benefícios
contratados, onde pode ser feito alterações nos combinados — o que
necessitaria de anexos ou mudança no contrato assinado."*

**Situação: aprovado pelo dono em 18/11/2026 (R1–R6 como recomendado; R7 com os ajustes dele). Etapa 1 entregue na Empresarial 0.110.0.**

## O que o levantamento achou

1. **Não existe a regra "não paga implantação".** A importação (1047)
   simplesmente não gera a cobrança de implantação. Mas a ficha não mostra
   regra nenhuma de implantação, então parece que ela foi desligada.
   Hoje, apertar **Gerar implantação** numa empresa importada cobraria uma
   implantação inteira, mesmo que ela já tenha pago fora do sistema.
2. **A empresa importada não tem lead de origem.** Todo caminho para mudar
   o combinado (destravar a proposta, levar as alterações para a empresa,
   montar o contrato para a ZapSign) parte do lead. Na importada nenhum
   funciona.
3. **Várias regras não aparecem nem se editam na ficha:**
   - as faixas de preço;
   - o modo dos dependentes (individual ou pacote familiar) e o tamanho do
     pacote;
   - a regra da implantação (só titulares, ou com dependentes);
   - o mínimo, o máximo e o alvo do limite de adesões;
   - a fidelidade e a multa de saída, que nem existem na empresa (só no
     lead).
4. **O que se edita não tem trava nem histórico de versão.** Preços,
   benefícios, faixas e split mudam direto, sem aditivo. Só a proposta do
   lead trava depois de assinada (1041). Não há "aditivo" no módulo; o termo
   de inclusão muda só a quantidade.

## Etapas

### Etapa 1 — "Regras combinadas" (sem migração)

Uma visão única na ficha da empresa, só leitura, com tudo o que foi
combinado, em blocos:

- **Preço:** por titular ou valor fixo, as faixas por quantidade e os preços
  dos dependentes (modo e tamanho do pacote).
- **Quantidade:** contratado (titulares e dependentes), termos de inclusão
  aceitos, mínimo e máximo, e o que acontece acima do contratado.
- **Implantação:** a regra (só titulares ou com dependentes) e a situação
  (não cobrada / cobrada / paga, quantos titulares cobertos).
- **Cobrança:** quem paga (empresa, parcial, colaborador), vencimento, uma
  cobrança ou uma por CNPJ, formas de pagamento e parcelas.
- **Carências:** da empresa e do colaborador.
- **Benefícios:** procedimentos com desconto/limite/carência, e as
  vantagens.
- **Unidades da parceria, split, Riso+ Social e "combinado na venda".**
- **De onde veio:** funil (com o contrato assinado) ou importação.

Cada bloco diz quando vale o padrão da rede ("padrão da rede: R$ …").

### Etapa 2 — "Revisar contrato" (migração 1050)

Um botão **Revisar contrato** abre uma **revisão** (código `RV-00001`):

1. Ela nasce com uma **cópia de todas as regras de hoje**.
2. Na revisão se altera tudo o que a Etapa 1 mostra (no mesmo jeito da
   montagem da proposta), e um **motivo** é obrigatório.
3. A tela mostra **o que muda** (de → para).
4. Para valer, a revisão precisa do **documento**: o aditivo assinado pela
   ZapSign, ou um PDF assinado anexado.
5. Ao **aplicar**, as regras novas entram na empresa e a revisão guarda a
   foto de **antes e depois** (histórico de versões). Cobrança já gerada não
   muda.

As regras comerciais da empresa passam a mudar **só por revisão**; o
cadastro (endereço, contatos, responsável) continua livre. O banco trava.

### Etapa 3 — o aditivo pela ZapSign

Um modelo "Termo aditivo" para a empresa, com a lista do que mudou, enviado
pela ZapSign como o contrato de adesão. Quando assinado, a revisão fica
pronta para aplicar.

## Decisões para o dono

- **R1. Quem pode alterar as regras depois de criada a empresa?**
  Recomendado: só por revisão, com a trava no banco. Hoje se altera direto,
  sem aditivo.
- **R2. O que vale como documento da revisão?** Recomendado: o aditivo pela
  ZapSign **ou** um PDF assinado anexado. As importadas têm contrato em papel.
- **R3. A partir de quando vale?** Recomendado: da próxima cobrança gerada;
  o que já foi gerado não muda.
- **R4. A implantação da empresa importada.** Recomendado: na revisão, três
  escolhas:
  - **cobrar** (pela regra combinada);
  - **já paga antes do sistema** (informa quantos titulares; o Gerar
    implantação passa a cobrar só quem entrar depois);
  - **isenta** (combinado com a empresa; o botão não cobra).
- **R5. Fidelidade e multa de saída** passam a ser regras da empresa
  (copiadas do lead no fechamento e editáveis na revisão)? Recomendado: sim.
- **R7. Implantação dos dependentes novos** — ✅ **aprovada pelo dono
  (18/11/2026)**. Hoje a implantação de dependente só sai na 1ª implantação
  da empresa (quando combinada "com dependentes"); dependente incluído
  depois não tem como ser cobrado. O que fica combinado:
  - um botão na aba Financeiro cobra só os dependentes que entraram e ainda
    não pagaram implantação (o sistema anota quem já pagou: ninguém paga
    duas vezes);
  - o valor é **um mês do pacote de dependentes do titular** (individual,
    familiar ou extras, pelo preço combinado);
  - quem paga segue a 1049: titular que paga os próprios dependentes recebe
    essa cobrança no nome dele;
  - vale só para empresa com "implantação com dependentes" combinada (na
    importada, ligada pela revisão do contrato).
  - titular que já pagou o pacote individual e passa ao familiar **paga a
    implantação do familiar inteira** (decisão do dono, 18/11/2026, contra a
    recomendação de cobrar só a diferença). O mesmo vale ao passar para
    familiar + extras: cobra o pacote novo inteiro.
- **R6. Quem abre e quem aplica a revisão?** Recomendado: o gestor do
  programa abre e aplica; o consultor RisLife abre nas empresas dele, e só o
  gestor aplica.
