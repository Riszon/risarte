# A 4018c, a conferência dos ensaios, o teste de papéis e a ASA7 (17/11/2026)

Tudo está no treino e no projeto de teste. **Nada foi para a produção.** O levantamento do acordo na franqueadora ("No rows returned") foi registrado na especificação (20.18, item 2).

## 1. A 4018c: construída e provada

### a) A causa, tratada

**O que estava errado:** o aviso do split do Asaas pode chegar antes da baixa que cria as linhas de taxa. Na mensalidade, depois que as linhas nasciam, nada rodava a conferência do split.

**A correção:**
- Um gatilho **adiado** roda a conferência no fim da transação, com todas as linhas da baixa presentes, para qualquer origem.
- Ele precisa ser adiado: rodar a cada linha inserida conferiria um pedaço das linhas. A primeira congelaria, e o "split a mais" seria falso. **O ensaio prova que isso não acontece.**

**O levantamento: tudo o que dependia de a linha existir no aviso** (spec 19.40):

| O que depende | Situação |
|---|---|
| O razão: a despesa da taxa retida na unidade e a receita na franqueadora | **corrigido** |
| A passagem de "a reter" para "retida" (o repasse menor do Asaas reduz a retenção) | **corrigido** |
| A conta a pagar de taxa (a diferença do repasse menor vai "a cobrar") | **corrigido** |
| A marca e o aviso de "split a mais" | **corrigido**, sem aviso falso |
| O **Painel de repasses** (4010): **não via as mensalidades em ordem nenhuma** (recebido, devido, liquidado, a receber) | **corrigido na 4018c**: as pagas por fora entram na categoria nova "Mensalidade (fora do Asaas)" |
| A Conferência das taxas (4021a): não olhava o razão | **corrigido**: a divergência nova (item b) |
| A cobrança mensal (4021): a linha retida não é cobrada de novo | **certo** |
| O estorno (4020a): só se estorna o que foi pago, e aí as linhas já existem | **certo** |
| O resumo das taxas (Taxas da rede): lê as linhas de qualquer origem | **certo** |
| Os totais da nota fiscal (ASA8) | **a fazer na ASA8**: usará as linhas e o razão, protegidos pela divergência nova |

**O ensaio novo** (`asaas-ensaio-4018c-taxa-retida-no-razao.mjs`): **24/24**.
- **As duas ordens dão o mesmo resultado:** a baixa antes do aviso e o aviso antes da baixa. São as mesmas linhas, o mesmo retido, o mesmo razão da unidade e da rede e a mesma conta a pagar.
- Ele prova também o repasse menor (a retenção acompanha o que o Asaas repassou) e o repasse maior (a marca de R$ 5,00 aparece, sem aviso falso no meio da baixa).
- **Quebrado** (sem o gatilho), ele **reprova 8**.

**No treino:** as 16 linhas ganharam o lançamento. A conferência deu `gatilho_novo 1 · linhas_sem_razao 0`.

**O ensaio da 4010:** **59/59**, agora conferindo o painel de hoje. As quebras antigas (rateio e resumo) continuam reprovando.

### b) A Conferência das taxas olha o razão (4021a)

**A divergência nova é "Sem lançamento no razão"**, com três casos:
- a linha retida sem a despesa e a receita do mesmo valor;
- a conta de taxa cobrada sem a despesa e a receita, contando os ajustes de mês fechado (a fixa dispensada não entra);
- o pagamento da conta de taxa sem o caixa (a compensação de crédito não entra).

**Onde vale:** em toda unidade com conta Asaas ativa ou com a cobrança mensal ligada, em qualquer mês.

**Provada plantando os três defeitos:**
- **31/31**;
- quebrada (a rotina sem o razão), **reprova as 3 novas**;
- as 4 quebras antigas continuam reprovando.

**A conferência da 4021a na produção passa a ser** `tabelas_novas 2 · funcoes_novas 9 · divergencias 0`.

## 2. Antes da produção

### Os ensaios ajustados, um a um: nenhuma conferência removida nem afrouxada

**12 arquivos foram ajustados** (o 13º, o da 4021a, só ganhou conferências). **O número de conferências é o mesmo antes e depois em todos.**

| Ensaio | Conferências antes → depois | O que mudou |
|---|---|---|
| ASA0 | 63 → 63 | **"Gerente lê só a conta da própria unidade":** antes, "exatamente 1 conta"; agora, "a da unidade dele, nunca a da outra unidade do ensaio nem a da raiz, e só contas das unidades que ele gere" (ele gere 3 no treino). **"Ninguém logado lê o evento bruto"** virou **"só o Admin Master lê"** (a regra desde a 4005); ficou mais rígido, porque confere o Gerente e o Coordenador = 0 e o Admin = 1. |
| ASA1 entrega 2 | 85 → 85 | Só o cenário: a venda de teste é do tipo antigo. A conferência é a mesma. |
| ASA2 entrega 1 | 62 → 62 | Só o cenário: apaga, dentro da transação, a marca do resumo de hoje já mandado pela rotina real. A conferência é a mesma. |
| ASA3 entrega 1 | 50 → 50 | Só o cenário: as parcelas de dinheiro e permuta ficam de fora, e a multa e os juros partem do em branco. As conferências são as mesmas. |
| ASA3 entrega 2 | 76 → 76 | Só o cenário (as parcelas). |
| ASA3 entrega 3 (4010) | 59 → 59 | Confere o painel de hoje (com a 4018c). **"Devido no período" ficou mais rígido:** agora soma também as mensalidades. A quebra "rateio" passou a valer sobre a 4018c. |
| 4011, 4012, 4013, 4014 (4 arquivos) | 61, 47, 35, 32 → iguais | Só a reaplicação das migrações antigas: o CHECK reaplicado entra "not valid" (vale para as linhas novas), e o "encerrada" vira "cancelada" dentro da transação. As conferências são as mesmas. |
| 4015 | 43 → 43 | O mesmo da linha acima. **"O aviso uma vez no dia"** conta agora só os avisos desta transação (antes contava todos os da história do Gerente). Continua exigindo exatamente 1. |
| 4017 | 74 → 74 | Só a reaplicação. |

### O teste de papéis do Gerente, com uma unidade que ele não gere: 24/24

Uma parte nova mantém os papéis **reais** do treino: ele é Gerente da Unidade Teste, de Cambé e de Londrina. Diante da **Unidade Fake**, que ele não gere, o Gerente:
- não lê a prévia;
- não contesta;
- não a vê na lista nem na conferência;
- não lê os itens pela tabela;
- não lê o Painel de repasses (a porta nem é liberada a ele);
- não vê os pedidos de estorno.

As 14 conferências antigas continuam passando.

**A suíte inteira:** 4887 testes passaram, 0 falharam.

### A ordem na produção

**0427 da Jornada → 4018c → 4020a → 4021 → 4021a**, uma por vez, cada uma com a conferência e o desfazer. Eu mando o passo a passo de cada uma **só depois de você conferir a anterior**. A da 4018c sai quando você me disser que a 0427 está conferida.

## 3. A ASA7: a seção 21 atualizada (21.7)

A seção foi atualizada antes de codificar.

1. **O interruptor:** ele só liga com todas as migrações do Asaas na produção. A tela lista cada uma, "na produção" ou "falta", conferida pela marca que a migração deixa no banco.
2. **A chave com permissões mínimas: o Asaas permite.**
   - Cada chave tem permissões por recurso, "só ler" ou "ler e escrever". Há recursos próprios para transferência (que inclui o saque), Pix enviado e pagamento de contas.
   - **Sem permissões definidas, a chave nasce com tudo liberado.**
   - A documentação não mostra como ler as permissões de uma chave. Por isso, o riSZon confere pela **recusa**: pede só leituras (a lista de transferências, a de Pix enviados e a de contas pagas), e as três têm de voltar 403.
   - **A lista mínima:** 11 recursos, de clientes a webhooks (a tabela está na 21.7). Transferência, Pix enviado, pagamento de contas e o resto ficam **sem nenhuma permissão**.
   - Isso vira item obrigatório da prontidão da unidade e do roteiro da homologação.
   - **A prova no sandbox precisa criar uma chave nova numa subconta de teste. Criar a chave é com a sua aprovação na hora.**
3. **A varredura semanal** de todas as cobranças em aberto, somada aos 3 dias da diária.
   - **O custo:** de 3 a 15 chamadas por noite e de 5 a 35 por semana, por unidade. Isso fica **abaixo de 0,2% do limite de 25.000 a cada 12 horas**, e o limite é de cada conta.
4. **A prontidão da rede,** antes de o interruptor ligar:
   - a confirmação do Asaas, com o documento anexado (pasta privada);
   - o saldo mínimo definido;
   - ver, emitir e cancelar cobranças liberados para o Gerente e a Recepção (as 6 marcas na matriz);
   - o termo de privacidade publicado;
   - as migrações na produção.
5. **O roteiro da homologação** ganha:
   - desligar uma unidade no meio do piloto (as cobranças emitidas e os boletos na mão dos pacientes continuam pagáveis e dando baixa);
   - o estorno recusado por falta de saldo da franqueadora;
   - o boleto cancelado e pago mesmo assim;
   - o limite diário de criação de cobranças.

**A construção da 4022 começa agora**, sobre a 21.2 e a 21.7.

Fontes do Asaas: [Gerenciamento de permissões de chaves de API](https://docs.asaas.com/docs/gerenciamento-de-permissões-de-chaves-de-api), [Chaves de API](https://docs.asaas.com/docs/chaves-de-api), [Limites da API](https://docs.asaas.com/docs/duvidas-frequentes-limites-da-api), [Listar cobranças](https://docs.asaas.com/reference/listar-cobrancas).
