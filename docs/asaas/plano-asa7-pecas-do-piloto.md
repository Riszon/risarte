# Plano da ASA7 — as peças que preparam o piloto

*Cópia da seção 21 de `docs/integracao-asaas.md` (17/11/2026).*

## ASA7 — As peças que preparam o piloto: PLANO (17/11/2026; APROVADO com 1a–6a em 17/11/2026 — 21.6)

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

