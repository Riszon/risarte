# Estado da integração Asaas × riSZon

Documento de quem constrói a integração. A especificação (fonte da verdade,
com as decisões do dono) é `docs/integracao-asaas.md` — hoje na **versão 3**.

- **Tabelas:** `gateway_*` e `central_*`, no schema `public` ·
  **Migrações:** faixa **4000+** ·
  **Versão:** `ASAAS_VERSION` / `ASAAS_MIGRATION` em `src/lib/version.ts`.
- **Tudo em SANDBOX.** Nenhuma chave de produção entra antes da ASA7, e só com
  a aprovação explícita do dono na hora.
- **Branch:** `feat/asaas-integration`, num worktree separado
  (`C:/Users/Administrador/wt-asaas`). Cada fase aprovada entra no `main`,
  escondida atrás de permissão e com a trava de produção desligada.

## Onde estamos

| Fase | Situação | Migrações |
|---|---|---|
| **ASA0 — Fundação** | ✅ **concluída**: aprovada pelo dono e no `main` em 11/11/2026 (core 0.423.0); migrações nos dois bancos; webhook real recebido | **4000, 4001, 4002** |
| **ASA1, entrega 1** — abas Financeiro e Comercial, responsável financeiro, carência zero | ✅ **concluída**: aprovada pelo dono e no `main` em 11/11/2026 (core 0.426.0); 4003 nos dois bancos (produção pelo dono, conferência batida) | **4003** |
| ASA1, entrega 2 — a cobrança | plano aprovado (spec seção 14); **antes de começar**, o dono decide os pontos do 14.6 (parcela vencida e quitação por valor menor) | — |

⚠️ **Antes de planejar qualquer fase, ler a seção 13 da especificação**: a
resposta escrita do Asaas (11/11/2026) e o que ficou para cada fase.
- **ASA3:** uma entrada de split por carteira com `percentualValue` e
  `fixedValue` juntos (confirmado). Mostrar ao dono os cálculos da compensação
  nos três casos (tarifa fixa, percentual com mínimo e máximo, boleto pago pelo
  QR Code PIX) e a diferença máxima por meio de pagamento **antes de implementar**.
- **ASA4B:** Pix Automático com jornada sem pagamento inicial e split desde a
  primeira parcela. Cartão recorrente **em aberto**: mandar o objeto
  `creditCard` faria o cartão passar pelo servidor do riSZon, o que é proibido.
- **ASA7:** decidir a lista de IPs autorizados (IP fixo da Vercel: US$ 100/mês
  por projeto, compartilhado). **Nunca** ativar a lista no Asaas sem IP fixo.
- **ASA8:** a nota do paciente no primeiro de `PAYMENT_CONFIRMED` /
  `PAYMENT_RECEIVED` é proposta, a validar com o contador.

## ASA1, entrega 1 — abas Financeiro e Comercial e o responsável financeiro (Asaas 0.2.0, core 0.426.0, 11/11/2026)

### O que existe

- **4003** — `client_guardians.is_financial` com a regra de exclusão
  `client_guardians_one_financial` (no máximo um pagador por cliente,
  conferida no FIM do comando — o índice único comum recusava a troca do
  pagador num comando só, achado no ensaio); o pagador marcado sozinho no
  menor com um único responsável; `finance_settings_grace_zero` (carência
  presa em zero; a migração PARA com `GRACE_NOT_ZERO` se achar outro valor, sem
  mudar o dado); `central_history` com as abas `financeiro` e `comercial`.
- **Central por aba** (`src/lib/central/central.ts`): `podeVerAba`,
  `abasVisiveis`, `primeiraAba`. Conta = `modulo.central`; Financeiro =
  `canConfigureFinanceNetwork` (rede e todas as unidades) ou
  `canViewFinance` + função na unidade; Comercial = Admin Master. A Central
  aparece para quem vê alguma aba — o Gerente e o Franqueado passam a vê-la
  (só a aba Financeiro da própria unidade).
- **Aba Financeiro** (`central/aba-financeiro.tsx`, `central/financeiro-form.tsx`):
  herança campo a campo na unidade (vazio = segue a rede, `CampoHerdado`),
  carência só leitura, os alertas da unidade no pé. **Aba Comercial**
  (`central/aba-comercial.tsx`): os editores de Regras Comerciais com `escopo`
  e as condições dos programas só para leitura.
- `/financeiro/configuracao` e `/admin/regras-comerciais` redirecionam; o
  formulário antigo (`financeiro/configuracao/settings-form.tsx`) saiu.
- **Responsável financeiro** (`src/lib/responsaveis.ts`, `prontuarios/actions.ts`,
  `client-form.tsx`): o salvar atualiza por id em vez de apagar e recriar; o
  adulto pode ter um pagador opcional; a ficha mostra o selo.

### Regras que quem mexer aqui precisa saber

- ⚠️ **Componente de navegador da Central não importa `central.ts`** (ele
  importa `@/lib/auth`, que é de servidor, e a montagem quebra). A herança
  pura mora em `src/lib/central/heranca.ts`. Régua no
  `asaas-asa1-entrega1.test.ts`.
- ⚠️ **Aba nova = entrada em `ABAS_DA_CENTRAL`, ramo em `podeVerAba` e ramo
  em `central_history`.**
- ⚠️ **Os responsáveis vão SEMPRE no formulário**, também do adulto (antes,
  editar um adulto apagava os responsáveis de quando era menor).
- ⚠️ **Gravar a troca de pagador: quem deixa de ser vem primeiro**
  (`ordemDeGravacao`).
- ⚠️ **Banco de treino por IPv4:** o endereço direto (só IPv6) não respondeu
  deste PC em 11/11/2026. `scripts/test-db.mjs` aceita `TEST_DB_URL` pelo
  ambiente (o pooler `aws-0-sa-east-1.pooler.supabase.com`, usuário
  `postgres.<ref>`); a trava de produção vale igual.

### O que foi provado

- Ensaio no treino, transação desfeita: **25/25**
  (`scripts/asaas-ensaio-asa1-entrega1.mjs --confirmar`). `test:indica` 246/246.
- Testes: `asaas-asa1-entrega1.test.ts` + a suíte inteira (3.908) e o lint.
- Telas no servidor local contra o treino, por papel (só leitura): Admin vê as
  três abas nos dois níveis; os endereços antigos levam às abas; o Gerente vê
  só a aba Financeiro da própria unidade, só leitura, e é barrado no resto; o
  Financeiro edita a rede e é barrado em Comercial e Conta; a Recepção não abre
  a Central; a ficha mostra o selo do responsável financeiro.
- **Não visto:** salvar pela tela (multa por campo, troca de pagador no
  cadastro). A gravação está coberta pelo ensaio do banco e pela régua do
  código, não por clique.

## ASA0 — Fundação (Asaas 0.1.0, 10/11/2026)

### O que existe

- **4000** — `gateway_settings` (o interruptor de produção, desligado e **sem
  função que o ligue**), `gateway_accounts`, `gateway_key_usage`,
  `gateway_api_log`, `gateway_webhook_events`; o gatilho
  `gateway_accounts_guard` (recusa conta `production`, recusa trocar ambiente,
  dono ou endereço do webhook) e `gateway_accounts_no_delete`.
- **4001** — `card_acquirers.gateway_account_id`, `acquirer_rates.min_fee_cents`
  / `max_fee_cents` / `source`, e `_gateway_sync_fees`.
- **4002** — `central_unit_readiness`, `gateway_notices`, a lista de prontidão
  (`_central_readiness_raw` → `central_readiness`, `central_is_ready`), a queda
  automática da marcação, `_gateway_record_check`, `central_history` e o padrão
  das duas permissões.
- **Código:** `src/lib/asaas/` (cliente HTTP, travas de ambiente, tarifas,
  vinculação e verificação, rotina, Asaas de mentira), `src/lib/central/`
  (regras e leituras), `src/app/(app)/central/` (telas e ações),
  `src/app/api/webhooks/asaas/[ref]/` e `src/app/api/cron/gateway-accounts/`.
- **Roteiros:** `scripts/asaas-ensaio-asa0.mjs` (ensaio do banco, transação
  desfeita) e `scripts/asaas-sandbox-contas.mjs` (contas de teste).

### Regras que quem mexer aqui precisa saber

- ⚠️ **A CHAVE SÓ SAI DO VAULT EM `src/lib/asaas/account.ts`**
  (`credencialDaConta` → `_gateway_read_key`, que só responde à chave de
  serviço e grava cada uso). Há régua que reprova outra chamada
  (`asaas-asa0.test.ts`). Nada de `ASAAS_API_KEY` em código novo: a variável só
  existe no `.env.local`, para o roteiro das contas de teste.
- ⚠️ **NENHUMA REGRA DE ESCRITA em `gateway_*` e `central_*`.** Só função
  grava. O que a pessoa faz pela tela (abrir cadastro, termo, split, marcar
  pronta, desativar) é função guardada chamada COMO a pessoa; gravar a chave
  passa pelo servidor (precisa validar no Asaas antes) e o banco confere a
  permissão de novo (`_gateway_actor_can_link`).
- ⚠️ **O GERENTE SÓ GRAVA A CHAVE DEPOIS DO TERMO** — no banco. Na tela ele
  ainda precisa de `modulo.central` e `acao.central.vincular_conta`, que nascem
  **sem papel nenhum** (só o Admin Master).
- ⚠️ **PRODUÇÃO TEM DUAS TRAVAS:** o gatilho do banco e
  `recusaDeAmbiente` no cliente (`ASAAS_ALLOW_PRODUCTION=sim`, que não existe
  em lugar nenhum). Só a ASA7 mexe nisso.
- ⚠️ **TIMEOUT É RESULTADO DESCONHECIDO.** POST/PUT/DELETE nunca é repetido
  sozinho (`unknown_outcome`); 429 é repetido com espera para qualquer método,
  porque o Asaas recusou antes de processar. Erro 5xx num POST também não é
  repetido: quem chamar na ASA1 trata como desconhecido e consulta pelo
  `externalReference`.
- ⚠️ **O REGISTRO DAS CHAMADAS GUARDA O MODELO DA ROTA** (`/webhooks/{id}`),
  nunca o caminho preenchido, a consulta ou o corpo. Endpoint novo entra em
  `api.ts` com `path` de modelo e `params`.
- ⚠️ **TARIFA NUNCA É SOBRESCRITA:** a que mudou fecha a vigência
  (`valid_to`) e abre outra; tarifa `manual` não é tocada. Promoção com data de
  fim vira duas linhas (a promocional e a cheia do dia seguinte).
- ⚠️ **O ADQUIRENTE "ASAAS" NÃO É O PADRÃO DA UNIDADE** enquanto a integração
  não emite cobrança: as baixas manuais seguem com o adquirente de hoje.
- ⚠️ **PRONTIDÃO: item novo entra em `_central_readiness_raw`** (mesmas
  colunas) **e em `ITENS_DE_PRONTIDAO`** — a régua compara os dois. Lista vazia
  é "não consegui conferir", nunca "pronta". Toda emissão (ASA1 em diante)
  pergunta `central_is_ready(unidade)`.
- ⚠️ **ABA NOVA DA CENTRAL = uma entrada em `ABAS_DA_CENTRAL`** e um ramo em
  `central_history`. Nenhuma fase cria tela de configuração à parte.
- ⚠️ **A VERIFICAÇÃO "SEMANAL" RODA TODO DIA** e pega só a conta cuja última
  verificação tem 7 dias ou mais, ou falhou. Recusa da chave derruba a
  prontidão; falha passageira não derruba nada.
- ⚠️ **O ENSAIO DO BANCO USA UNIDADES SEM CONTA EM USO.** O treino tem as
  contas de teste do sandbox em Londrina, Cambé e na RISARTE Franchising; o
  ensaio usa a Unidade Teste, a Unidade Fake e a Franqueadora Teste. Se essas
  ganharem conta, ele diz NÃO MEDI.
- O cliente HTTP ANTIGO do Empresarial (`src/lib/empresarial/asaas.ts`) e a
  Edge Function `asaas-webhook` **não foram tocados**: saem na ASA5.

### O que foi provado, e como

- **Ensaio do banco** (`node scripts/asaas-ensaio-asa0.mjs --confirmar`):
  63 conferências, transação desfeita — quem abre conta, trava de produção,
  termo antes da chave do Gerente, ida e volta no Vault, uso registrado, regra
  de linha por papel (com o papel `authenticated`), webhook idempotente,
  tarifas com vigência, prontidão que cai sozinha, aviso ao Admin Master sem
  repetir, histórico por aba, desativação que apaga os segredos.
- **Testes** (`asaas-asa0.test.ts`, 48): travas de ambiente, cliente HTTP,
  tarifas, webhook, rotina, regras da Central e as réguas do segredo.
- **Prova de quebra:** 14 defeitos postos de propósito (8 no código, 6 no
  banco) — todos reprovados. A primeira rodada dos casos de banco "reprovou"
  pelo motivo errado (o ensaio tinha parado numa exceção por causa das contas
  de teste recém-criadas); o ensaio foi corrigido e a prova refeita.
- **Sandbox de verdade** (`npm run test:asaas`): as quatro contas de teste
  verificadas pelo caminho real do servidor (Vault → Asaas → tarifas). As
  tarifas vieram com promoção até 10/02/2027 e a cheia cadastrada para o dia
  seguinte.
- **Telas** (servidor local contra o treino, contas de teste, só leitura): a
  lista, a unidade com conta, a unidade sem conta, o nível Rede; nenhuma chave
  nem identificador do Vault no HTML; o Gerente de teste (sem a permissão) não
  abre nada.
- **Rota de webhook** (servidor local): sem token, token errado, endereço
  errado → 401; token certo → 200; o mesmo evento → 200 sem gravar de novo;
  corpo que não é evento → 400.
- **Portão:** `check-migrations` nas três, `npm run verificar`, `npm test`
  (3.860) e `npm run lint` verdes.

### O que NÃO foi provado

- **As telas num navegador** (foram conferidas pelo HTML que o servidor
  devolve, não olhando). Os botões (gravar chave, termo, marcar pronta,
  desativar) não foram clicados: as funções por trás estão no ensaio.
- **Vincular uma conta colando a chave pela tela** — as contas de teste
  entraram pelo roteiro. O caminho `vincularConta` só rodou com o Asaas de
  mentira nos testes; a parte de verificação rodou de verdade.
- `check:telas` completo não foi rodado (o disco C: está com ~12 GB livres).

### O projeto de teste na Vercel e o webhook real (10/11/2026)

- **`risarte-asaas`** (`https://risarte-asaas.vercel.app`): branch de produção
  `feat/asaas-integration`, região São Paulo, proteção padrão. Variáveis: só
  as três do Supabase de **treino** e `NEXT_PUBLIC_AMBIENTE=treino` (a chave de
  serviço marcada para Production e Preview — a Vercel não deixou desmarcar o
  Preview; é a do treino e as prévias ficam protegidas). Sem `CRON_SECRET`, sem
  ZapSign, sem chave do Asaas.
- ⚠️ **Projeto novo só monta a produção com um push na branch de produção.** O
  primeiro push foi antes de o projeto existir: foi preciso um commit vazio.
- ⚠️ **Variável sensível da Vercel não pode ser lida de volta.** A chave de
  serviço do treino se copia no Supabase (projeto de treino › Project Settings
  › API Keys › Legacy › `service_role`), nunca de outro projeto da Vercel. Sem
  ela a rota do webhook responde 500 e o log diz `service role key is not
  configured`.
- Conferido de fora: a página aponta para o banco de treino, a função roda em
  `gru1`, e a rota do webhook responde 401 sem token — o endereço de produção
  do projeto não passa pela proteção da Vercel.
- **Webhooks criados** nas quatro contas de teste pelo MESMO código do botão
  "Criar o webhook" (`ASAAS_WEBHOOK_BASE_URL=https://risarte-asaas.vercel.app
  npm run test:asaas`). Os avisos do Asaas sobre a fila vão para um endereço de
  teste (`ASAAS_WEBHOOK_EMAIL` muda).
- **Critério de aceite cumprido:** cobrança PIX de teste criada em Londrina
  (`--evento londrina`) → o Asaas chamou o endereço publicado → o evento
  `PAYMENT_CREATED` ficou gravado em `gateway_webhook_events` em segundos, com
  o identificador do evento e a nossa referência.

### Estado do treino (resíduos conhecidos)

- Quatro contas de teste ativas: a raiz na **RISARTE Franchising**,
  **Londrina**, **Cambé** e a carteira **RisLife Teste**, todas com webhook
  apontando para `risarte-asaas.vercel.app`. Cada uma (menos a RisLife) tem um
  adquirente "Asaas (teste)" com as tarifas, que **não** é o padrão da unidade,
  e uma chave Pix aleatória no sandbox.
- Prontidão de Londrina: só faltam "split habilitado" e "termo registrado"
  (os dois dependem de ato do Admin Master pela tela).
- Londrina tem dois eventos gravados: um de ensaio local (`evt_local_…`) e o
  `PAYMENT_CREATED` real da cobrança de R$ 5,00 de teste (em aberto no sandbox).

### Fechamento da ASA0 (11/11/2026)

1. ✅ Aprovada pelo dono.
2. ✅ 4000, 4001 e 4002 rodadas na produção pelo dono, nessa ordem, com as
   conferências batidas (5·13·2·0·false·0, 3·1·0, 7·1·2·0). ⚠️ A 4001 deu
   "Success. No rows returned" na primeira vez **sem ter entrado** — o editor
   rodou outra coisa; só a conferência à parte mostrou. Rodar migração: Ctrl+A,
   Delete, colar, clicar fora do texto, Run; e exigir ver a linha de conferência.
3. ✅ No `main` com a versão 0.423.0, a novidade e o manual 13g (a Central só
   para o Admin Master). A cópia solta de `docs/integracao-asaas.md` na pasta
   principal foi apagada antes (era idêntica à da branch).
4. Na produção a Central está vazia: nenhuma conta Asaas, trava de produção
   desligada. A verificação semanal roda todo dia e não encontra conta.

**A próxima fase é a ASA1** (cobrança avulsa e link), com plano e OK do dono antes.

⚠️ **Lição desta sessão:** texto com crases dentro de `node -e "…"` no Git Bash
vira substituição de comando — o shell tentou executar cada trecho entre
crases (nenhum rodou, todos falharam). Texto de documento se edita pela
ferramenta de edição, nunca por script de terminal.

### Perguntas ao gerente de contas do Asaas (do dono)

Estão na Parte A da especificação: subcontas para CNPJ diferente, base do
percentual com desconto/multa, split em chargeback, tarifas e liberação do Pix
Automático e da tokenização, IP do pagador na cobrança com token, token
devolvido pela fatura.
