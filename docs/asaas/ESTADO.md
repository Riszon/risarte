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
| **ASA0 — Fundação** | código pronto e provado no treino e no sandbox (10/11/2026); **falta** o projeto da Vercel para o webhook real, a aprovação do dono e as migrações na produção | **4000, 4001, 4002** |
| ASA1 — Cobrança avulsa e link | próxima (plano e OK do dono antes) | — |

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

- **O webhook vindo do Asaas de verdade.** Precisa de endereço público: o
  terceiro projeto da Vercel ainda não existe. É o que falta para o critério
  de aceite "um evento de teste chega".
- **As telas num navegador** (foram conferidas pelo HTML que o servidor
  devolve, não olhando). Os botões (gravar chave, termo, marcar pronta,
  desativar) não foram clicados: as funções por trás estão no ensaio.
- **Vincular uma conta colando a chave pela tela** — as contas de teste
  entraram pelo roteiro. O caminho `vincularConta` só rodou com o Asaas de
  mentira nos testes; a parte de verificação rodou de verdade.
- `check:telas` completo não foi rodado (o disco C: está com ~12 GB livres).

### Estado do treino (resíduos conhecidos)

- Quatro contas de teste ativas: a raiz na **RISARTE Franchising**,
  **Londrina**, **Cambé** e a carteira **RisLife Teste**. Cada uma (menos a
  RisLife) tem um adquirente "Asaas (teste)" com as tarifas, que **não** é o
  padrão da unidade.
- As três contas emissoras têm chave Pix aleatória criada no sandbox; falta um
  "Verificar agora" para o riSZon enxergar.
- A conta de Londrina tem um webhook **de ensaio local** (`wh-local-ensaio`,
  não existe no Asaas) e um evento de ensaio gravado. "Criar o webhook" no
  endereço publicado substitui.

### O que falta para fechar a ASA0

1. **Projeto `risarte-asaas` na Vercel** (o dono cria, guiado): mesmo
   repositório, branch de produção `feat/asaas-integration`, região São Paulo
   (gru1), proteção padrão; variáveis **só** `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (as do treino) e
   `NEXT_PUBLIC_AMBIENTE=treino`. **Sem** `CRON_SECRET`, sem ZapSign, sem chave
   do Asaas.
2. Prova de que o endereço é alcançado sem a proteção da Vercel: POST de fora
   em `/api/webhooks/zapsign` devolve o 401 do riSZon.
3. Na Central publicada: "Criar o webhook" e "Verificar agora" nas contas;
   depois `node scripts/asaas-sandbox-contas.mjs --evento londrina --confirmar`
   e conferir "Último evento recebido".
4. Aprovação do dono → ele roda a 4000, a 4001 e a 4002 na produção, nessa
   ordem → a branch entra no `main` (com `APP_VERSION`, novidade e manual
   conforme a regra do manual: a Central nasce só para o Admin Master).

### Perguntas ao gerente de contas do Asaas (do dono)

Estão na Parte A da especificação: subcontas para CNPJ diferente, base do
percentual com desconto/multa, split em chargeback, tarifas e liberação do Pix
Automático e da tokenização, IP do pagador na cobrança com token, token
devolvido pela fatura.
