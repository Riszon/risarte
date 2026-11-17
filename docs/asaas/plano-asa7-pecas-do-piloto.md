# Plano da ASA7 — as peças que preparam o piloto

*Cópia da seção 21 de docs/integracao-asaas.md (17/11/2026).*

## ASA7 — As peças que preparam o piloto: PLANO (17/11/2026; APROVADO em 17/11/2026, com a decisão 1 trocada para (b) e quatro acréscimos — 21.6 e 21.7; CONSTRUÇÃO AUTORIZADA)

**O que entra:** só o que pode ser construído e provado no **sandbox**, antes de qualquer chave de produção. A chave de produção, o interruptor ligado e a primeira unidade de verdade **não entram**: cada um espera a sua aprovação, na hora.

### 21.1 O que já existe

- **A trava de produção** (4000): o banco recusa conta `production` enquanto `gateway_settings.production_enabled` for falso. **Não há função que ligue.** O cliente recusa uma chave de produção numa conta sandbox.
- **A prontidão por unidade** (4002, 4009): conta validada, walletId, tarifas, webhook ativo, chave Pix, antecipação desligada, split habilitado, termo registrado e "Pronta para cobrar".
- **O monitor da fila** (4005): a rotina diária confere se o Asaas pausou os avisos de alguma conta e avisa o Admin Master. **Está pronto.**
- **A conferência das taxas da rede** (4021a). Ela **não** compara as cobranças dos pacientes com o Asaas.

### 21.2 As peças (migração 4022)

1. **O interruptor de produção.**
   - Fica na aba Conta e tarifas (rede). Só o Admin Master liga, com o motivo e a confirmação reforçada; desligar volta à trava.
   - **Ligar não liga nenhuma unidade.** Cada unidade continua precisando da própria conta de produção, da prontidão completa e do "Pronta para cobrar".
   - **Construído desligado:** no treino, a prova liga e desliga numa transação desfeita. Na produção, ninguém liga sem o seu "pode".
2. **A marca do débito desabilitado** (19.37, item 2, já aprovada). Um item novo da prontidão, marcado pelo Admin Master com a data: "Desabilitei o débito no painel do Asaas da unidade (Minha conta › Configurações › Configurações do sistema)". Sem ela, a unidade sai da prontidão.
3. **O levantamento da unidade antes de ligar** (19.34.10).
   - Um botão na Central da unidade (Admin Master): "Levantar o que já existe no Asaas desta conta". Ele só lê, pela chave do Vault.
   - **O que conta:** as cobranças em aberto, os parcelamentos e as assinaturas ativas sem a referência do riSZon, com o total e os 20 mais antigos.
   - O resultado fica gravado com a data e alimenta o tamanho real da 4019 e da 4019b.
4. **A conciliação diária das cobranças** (a regra técnica da seção 7, "Conciliação diária", que ainda não existe).
   - Toda noite, em cada conta ativa, o riSZon lê no Asaas as cobranças **criadas, pagas ou mudadas nos últimos 3 dias** e compara com o riSZon.
   - **As divergências:**
     - paga no Asaas e aberta no riSZon (o aviso não chegou);
     - valor ou situação diferentes;
     - cancelada de um lado só;
     - cobrança do riSZon que não existe no Asaas;
     - cobrança nova no Asaas sem a referência do riSZon (criada no painel).
   - **O comportamento é o da 4021a:** cada divergência fecha sozinha quando o problema some, e só o Financeiro ou o Admin ignora, com motivo.
   - **Nada é baixado sozinho:** a divergência mostra o caminho (reprocessar o aviso ou conferir no painel).
5. **Copiar de outra unidade** (9.1).
   - Na Central da unidade nova, o Admin Master escolhe a unidade de origem e marca os blocos: régua, multa e juros, Comercial, Financeiro e maquininha.
   - A tela mostra cada valor que vai ser copiado antes de gravar, e o histórico registra "copiado de …".
   - **Nunca copia:** a conta Asaas, a chave, o walletId, os termos, as marcas da prontidão, as taxas da franquia e a cobrança mensal (são do contrato de cada unidade, 20.15.6).
6. **O roteiro da homologação** (documento, sem código): `docs/asaas/roteiro-homologacao.md`, com tudo o que só a produção prova, cada item com o valor mínimo, quem faz e como desfazer:
   - o split real com valores mínimos;
   - o envio por WhatsApp;
   - a recusa do cartão pelo banco emissor;
   - o PDF do boleto sem login;
   - o token de ações críticas no estorno do cartão;
   - a repartição do estorno do parcelado;
   - o parcial do cartão no dia seguinte;
   - a mensageria no parcelado;
   - a tokenização, para a ASA4B.

   Junto vai o passo a passo de ligar a primeira unidade, com o risco e como desfazer em cada passo (ajuste G).

### 21.3 Decisões para o dono

1. **O interruptor:**
   - (a) liga só o Admin Master, com motivo, e cada unidade continua precisando da própria prontidão (recomendado);
   - (b) além disso, ele só liga quando todas as migrações do Asaas estiverem na produção.
2. **O levantamento:**
   - (a) obrigatório: sem ele, a unidade não fica "Pronta para cobrar" (recomendado);
   - (b) opcional, só informativo.
3. **A conciliação diária:**
   - (a) toda noite, olhando 3 dias para trás, numa aba "Divergências com o Asaas" do Painel de cobranças, e um resumo por dia ao Financeiro só quando aparecer divergência nova (recomendado);
   - (b) só o painel, sem aviso.
4. **Quem vê a conciliação:**
   - (a) o Financeiro da Franqueadora e o Admin Master veem tudo; o Gerente e o franqueado veem só a própria unidade, sem ignorar (recomendado);
   - (b) só o Financeiro e o Admin.
5. **Copiar de outra unidade:**
   - (a) só os blocos de 21.2, item 5, nunca as taxas (recomendado);
   - (b) também as taxas da franquia, marcadas "copiado de …, conferir".
6. **A lista de IPs autorizados** (decisão de custo, antes das chaves de produção):
   - (a) continua desligada, sem IP fixo (recomendado enquanto não houver IP fixo);
   - (b) contratar o IP fixo da Vercel (US$ 100/mês) só no projeto de produção, e ligar a lista depois de conferir.

### 21.4 A prova

- **O ensaio quebrado:**
  - o interruptor fica desligado depois do ensaio;
  - o débito sem marca derruba a prontidão;
  - a cópia não leva o que não deve;
  - as divergências da conciliação nascem e fecham.
- **O sandbox:**
  - o levantamento em Londrina e Cambé;
  - a conciliação com um pagamento feito pelo painel do sandbox, sem o aviso.

### 21.5 Tamanho

- **A migração:** uma, a 4022.
- **O servidor:** duas leituras novas do Asaas: a lista de cobranças por data e a lista de assinaturas e parcelamentos.
- **A tela:** a aba das divergências, o botão do levantamento, a cópia e o interruptor.
- **O documento:** o roteiro da homologação.
- **Depois dela:** a 4019 e a 4019b, ajustadas pelo levantamento, e então o piloto em Londrina.

### 21.6 Aprovação (17/11/2026)

O dono aprovou o plano com as recomendações **1a, 2a, 3a, 4a, 5a e 6a**:
1. O interruptor: liga só o Admin Master, com motivo; cada unidade continua precisando da própria prontidão.
2. O levantamento é obrigatório: sem ele, a unidade não fica "Pronta para cobrar".
3. A conciliação diária: toda noite, 3 dias para trás, na aba "Divergências com o Asaas" do Painel de cobranças; um resumo por dia ao Financeiro só quando aparecer divergência nova.
4. Quem vê: o Financeiro da Franqueadora e o Admin Master veem tudo; o Gerente e o franqueado, só a própria unidade, sem ignorar.
5. Copiar de outra unidade: só os blocos de 21.2, item 5; nunca as taxas.
6. A lista de IPs autorizados continua desligada, sem IP fixo.

### 21.7 A troca e os acréscimos do dono (17/11/2026), antes de codificar

**1. A decisão 1 passa a ser (b):**
- O interruptor de produção só o Admin Master liga, com motivo.
- **E só quando todas as migrações do Asaas estiverem na produção.**
- A tela mostra a lista das migrações do Asaas, cada uma com "na produção" ou "falta". O banco confere cada uma pela marca que ela deixa (a função ou a tabela que ela cria), não por uma lista digitada.
- Com alguma faltando, o botão fica desabilitado, e o motivo fica escrito ao lado.

**2. A chave de produção com permissões mínimas** (compensa a lista de IPs desligada).

O que o Asaas permite ([Gerenciamento de permissões de chaves de API](https://docs.asaas.com/docs/gerenciamento-de-permissões-de-chaves-de-api), lido em 17/11/2026):
- **Permissão por recurso:** cada chave tem uma lista de permissões, uma por recurso, com o nível "só ler" (READ) ou "ler e escrever" (READ_WRITE).
  - Há recursos próprios para transferências (TRANSFER), Pix enviado (PIX_TRANSACTION), pagamento de contas (BILL), QR Code pago (PIX_DEBIT), recarga de celular, antecipação, subcontas etc.
  - **Não há permissão separada de "saque":** o saque é a transferência.
- **Onde se define:** a chave da conta é criada no painel web (Integrações › Chaves de API), só por administrador, e as permissões são definidas nessa criação ou na edição.
  - Nas subcontas, as permissões também são definidas pela API.
- **⚠️ Sem as permissões definidas, a chave nasce com tudo em "ler e escrever".** O Asaas diz que definir as permissões poderá se tornar obrigatório.
- **Pedido fora da permissão:** o Asaas recusa com 403 `insufficient_permission` e diz qual permissão faltou.
- **Ler as permissões de uma chave:** a documentação não mostra nenhuma forma de a chave ler as próprias permissões. Por isso, a conferência é pela recusa (abaixo).

**A chave de cada unidade terá só o que o riSZon usa** (tirado das chamadas que o código faz hoje):

| Recurso | Nível | Para quê |
|---|---|---|
| Clientes (CUSTOMER) | ler e escrever | o pagador |
| Notificações (CUSTOMER_NOTIFICATION) | ler e escrever | a régua de avisos |
| Cobranças (PAYMENT) | ler e escrever | emitir, cancelar, ler, boleto, Pix e linha digitável |
| Estornos (PAYMENT_REFUND) | ler e escrever | o estorno total e o parcial |
| Parcelamentos (INSTALLMENT) | ler e escrever | o cartão parcelado |
| Chargeback (CHARGEBACK) | só ler | a contestação |
| Chaves Pix (PIX_ADDRESS_KEY) | só ler | a prontidão (chave Pix cadastrada) |
| Config. de antecipação (ANTICIPATION_CONFIG) | só ler | a prontidão (antecipação desligada) |
| Extrato e saldo (FINANCIAL_TRANSACTION) | só ler | o saldo antes do estorno |
| Dados da conta (ACCOUNT_INFO) | só ler | o walletId, as tarifas e a situação da conta |
| Webhooks (WEBHOOK) | ler e escrever | o aviso do Asaas |

- **Sem nenhuma permissão** (nem ler): transferências, Pix enviado, pagamento de contas, QR Code pago, recarga, antecipação, subcontas, garantia, Serasa, notas fiscais e o resto.
- **Assinaturas e cartão (tokenização)** entram só com a ASA4B. **Notas fiscais** entram só com a ASA8. Cada uma com a sua aprovação.

**Na prontidão da unidade** (item obrigatório):
- O Admin Master marca "A chave foi criada com as permissões mínimas", com a data.
- O riSZon confere sozinho, só com leituras e sem mexer em nada: ele pede ao Asaas a lista de transferências, a de Pix enviados e a de contas pagas. **As três têm de ser recusadas por falta de permissão (403).**
  - Se alguma responde, a chave tem permissão demais, e a unidade sai da prontidão.
- A conferência roda ao gravar a chave e na verificação semanal das contas.

**Na homologação:** a mesma prova na chave de produção, antes da primeira cobrança.

**A prova no sandbox precisa de uma chave nova com as permissões mínimas** (numa subconta de teste). **Criar a chave é com a sua aprovação na hora.**

Se o Asaas não respeitar a restrição na produção (por exemplo, a chave responder à lista de transferências), eu te aviso, e você reavalia o IP fixo antes do piloto.

**3. A conciliação diária, mais a varredura semanal.**

**Toda noite** (os 3 dias para trás), em cada conta ativa:
- a lista das cobranças **criadas** nos 3 dias e a das **pagas** nos 3 dias (o Asaas não tem filtro por "alterada");
- e a leitura uma a uma das cobranças do riSZon que mudaram nos 3 dias e não apareceram nas listas (as canceladas de um lado só).

**Toda semana:** todas as cobranças **em aberto** de cada conta ativa (aguardando pagamento, vencidas e confirmadas ainda não recebidas), comparadas com o riSZon. Isso acha o que os 3 dias não alcançam.

**O custo em chamadas** (o Asaas lista até 100 por página; o limite é de 25.000 chamadas a cada 12 horas, **por conta**):

| Rotina | Unidade pequena (300 em aberto, 30 novas e 30 pagas em 3 dias) | Unidade grande (3.000 em aberto, 300 novas e 300 pagas em 3 dias) |
|---|---|---|
| Diária | ~3 a 5 chamadas | ~8 a 15 chamadas |
| Semanal | ~5 chamadas | ~35 chamadas |
| Uso do limite de 12 h da conta | **< 0,1%** | **< 0,2%** |

- A cota é de cada conta. As rotinas das unidades não somam no limite da raiz. A raiz faz só a conciliação das cobranças mensais da rede.
- As rotinas rodam uma conta por vez, longe do limite de 50 leituras ao mesmo tempo.
- **O Asaas pede que não se acompanhe a situação consultando a API, e sim pelos avisos.** As rotinas não fazem isso: são uma conferência por noite e uma por semana, e os avisos continuam sendo o caminho principal.

**4. A prontidão da rede**, conferida antes de o interruptor ligar (com qualquer item faltando, o interruptor não liga):
1. **A confirmação por escrito do Asaas** sobre o uso da chave da unidade pela franqueadora.
   - O Admin Master **anexa o documento** (PDF ou imagem), que fica numa pasta privada, com a data e quem anexou.
   - Sem o anexo, falta o item.
2. **O saldo mínimo da franqueadora definido** na Central (o campo que já existe, 19.37). Em branco, falta.
3. **As permissões de ver, emitir e cancelar cobranças liberadas para o Gerente e a Recepção** (as três de "Cobranças" na matriz de permissões). O riSZon confere a matriz, e falta o item se alguma das seis não estiver liberada.
4. **O termo de privacidade publicado**: a declaração que já existe (4007), com a data. Sem ela, falta.
5. **Todas as migrações do Asaas na produção** (item 1 acima).

**5. O roteiro da homologação ganha:**
- **Desligar uma unidade no meio do piloto:**
  - o passo a passo (a chave das cobranças automáticas e das mensalidades desligada, depois o "Pronta para cobrar" retirado);
  - o que acontece com as cobranças já emitidas: continuam valendo no Asaas, os avisos continuam chegando e dando baixa, e nenhuma nova é emitida;
  - os boletos na mão dos pacientes continuam pagáveis e dão baixa;
  - como cancelar em lote, se a decisão for parar tudo, com o aviso ao paciente.
- **O estorno recusado por falta de saldo da franqueadora:** a mensagem da unidade, o aviso ao Financeiro e a liberação quando o saldo volta (19.37.5).
- **O boleto cancelado e pago mesmo assim:** o alerta, e o caminho de devolver ou aceitar (4015).
- **O limite diário de criação de cobranças:** quanto a conta aceita por dia (`/payments/limits`), o que a tela mostra perto do limite, e o que acontece com a emissão em lote quando o limite acaba.

**O resto do plano (21.2) continua como aprovado:** o levantamento obrigatório (2a), a conciliação com resumo diário (3a), quem vê (4a), a cópia sem as taxas (5a) e a lista de IPs desligada (6a).
