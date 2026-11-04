# riSZon no ar — produção e treino

Como o sistema está publicado e as armadilhas que já custaram tempo. Substitui a
memória local `risarte-producao-online` do Claude: memória local só existe num
PC, e este projeto é trabalhado em dois (ver `CLAUDE.md` §0e).

**Nenhum segredo neste arquivo.** Chaves e senhas ficam na Vercel, no Supabase e
nos `.env*.local` (fora do Git).

## Os dois endereços

| | Produção | Treino |
|---|---|---|
| Endereço | `https://risarte.vercel.app` | `https://risarte-treino.vercel.app` |
| Banco Supabase | `hvhbijctanrrkxhemlza` | `bsnptybalszjjbhxeejo` |
| Aparência | normal | faixa amarela + aba "TREINO" |
| `NEXT_PUBLIC_AMBIENTE` | **não definir** | `treino` |

- Vercel: equipe `ri-sz-on`. Os dois projetos publicam o **mesmo `main`**,
  automaticamente a cada push.
- Plano: estava em **Pro Trial** em 31/08/2026 — precisa virar Pro antes do fim
  do teste (o gratuito proíbe uso comercial).
- O que viaja entre os dois (código sim; migração por banco; dados e
  configuração nunca): `CLAUDE.md` §0b.

## Variáveis de ambiente (nomes, nunca valores)

| Variável | Tipo na Vercel | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Config | Só o **Project URL** (`https://<id>.supabase.co`), **sem** `/rest/v1/` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Config | Vai ao navegador por natureza; quem protege o dado é a RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Só servidor; a única marcada como Secret |
| `NEXT_PUBLIC_AMBIENTE` | Config | Só no treino, valor `treino` |
| `ZAPSIGN_API_TOKEN` | **Secret** | Assinatura digital (ZS1). **Treino e previews: token da conta SANDBOX** (`sandbox.app.zapsign.com.br`); **produção: token da conta real**, só no projeto de produção. Sem ele nada é enviado e as telas avisam |
| `ZAPSIGN_ENV` | Config | `sandbox` (treino) ou `production` (produção). **Vazio = sandbox**, de propósito: esquecer nunca cria documento com validade jurídica |
| `ZAPSIGN_WEBHOOK_SECRET` | **Secret** | O mesmo texto cadastrado como cabeçalho `x-riszon-webhook-secret` no webhook da conta ZapSign (entra em uso na ZS3) |
| `CRON_SECRET` | **Secret** | As rotinas de `/api/cron/*` (`vercel.json`) só rodam com ele; a Vercel manda sozinha em `Authorization: Bearer`. Um por projeto (treino e produção) |
| `RESEND_API_KEY` | **Secret** | E-mail (ZS3): a cópia assinada ao paciente, o alerta de consumo e o relatório mensal. Sem ela o sistema diz que o e-mail não está configurado e deixa na fila |
| `EMAIL_FROM` | Config | O remetente, `Risarte Odontologia <assinaturas@dominio-verificado>` — o domínio precisa estar verificado na Resend |
| `ASAAS_API_KEY` | **Secret** | Cobrança do Empresarial pelo ASAAS (`src/lib/empresarial/asaas.ts`). **Sem ela a integração fica dormente**: cobrança local e baixa manual, e as telas dizem "ASAAS não configurado". Sandbox no treino; produção só no projeto de produção |
| `ASAAS_BASE_URL` | Config | Opcional. Vazio = sandbox (`https://sandbox.asaas.com/api/v3`); produção: `https://api.asaas.com/v3` |
| `TREINO_SUPABASE_URL` | Config | **Só no projeto de PRODUÇÃO**: o endereço do banco de treino, para o espelho (`src/lib/espelho-treino.ts`, 0260) copiar equipe, acessos e permissões de lá para cá |
| `TREINO_SERVICE_ROLE_KEY` | **Secret** | **Só no projeto de PRODUÇÃO**: a chave de serviço do treino, usada pelo mesmo espelho |
| `GAMMA_API_KEY` | **Secret** | Apresentação comercial pelo Gamma. Sem ela o botão avisa que não está configurado |

### A Edge Function do ASAAS (`supabase/functions/asaas-webhook`) — segredo fora da Vercel

O receptor dos avisos de pagamento do ASAAS **não roda na Vercel**: é uma Edge
Function do Supabase, publicada por projeto, e o segredo dela fica em
**Supabase → Edge Functions → Secrets**, não nas variáveis da Vercel.

| Segredo (painel do Supabase) | Observação |
|---|---|
| `ASAAS_WEBHOOK_TOKEN` | O mesmo texto cadastrado como *access token* do webhook no painel do ASAAS, enviado no cabeçalho `asaas-access-token`. **Sem ele a função recusa tudo (500)** — desde a 0.388.1 (AP99); antes, sem a variável, ela aceitava qualquer chamada |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Já existem em todo projeto; a função os lê sozinha |

**Em 03/11/2026 a função NÃO estava publicada em nenhum dos dois projetos**
(`GET` e `POST` em `https://<id>.supabase.co/functions/v1/asaas-webhook`
respondem `404 {"code":"NOT_FOUND"}`). O dono publica quando tiver a chave do
ASAAS, **nesta ordem, por projeto**:

1. Cadastrar `ASAAS_WEBHOOK_TOKEN` nos segredos da Edge Function.
2. `supabase functions deploy asaas-webhook --no-verify-jwt --project-ref <id>`
   (o ASAAS não manda JWT; a proteção é o token).
3. Só então cadastrar a URL da função como webhook de pagamentos no painel do
   ASAAS, informando o mesmo token.

**Como provar de fora, sem gravar nada** (o corpo inválido é recusado antes de
qualquer escrita): `POST` com `--data 'isto-nao-e-json'` e sem o cabeçalho →
`401` = segredo cadastrado e exigido; `500 Webhook não configurado` = publicou
sem o segredo (volte ao passo 1); com o cabeçalho certo → `400 Bad request`.
`404` = não publicada.

### A identidade da Rita (assistente virtual) — um login técnico por banco

Desde a 0.397.0 (migrações 0365 e 3000). A Rita é autora nas trilhas, não uma
pessoa: login `rita@risarte.local` **sem senha e bloqueado**, perfil
`kind = 'agent'`, nenhuma função em unidade. Ela nasce por um roteiro que usa a
chave de serviço do arquivo de ambiente — **não** pela tela e **não** pelo
espelho do treino.

Ordem na produção:

1. Rodar a **0365** e depois a **3000** no SQL Editor.
2. No computador, na pasta `risarte`, conferir sem gravar:
   `node scripts/rita-criar-identidade.mjs` (usa o `.env.local`, que aponta
   para a produção; a primeira linha diz o banco).
3. Criar: `node scripts/rita-criar-identidade.mjs --confirmar`. Rodar de novo
   só confere ("A Rita já existe neste banco").

No treino: `RISARTE_ENV_FILE=.env.test.local node scripts/rita-criar-identidade.mjs --confirmar`
(já feito em 04/11/2026). ⚠️ `auth.users` é território comum com o Risarte
Academy: o roteiro só acrescenta um login, não apaga nem muda ninguém.

## Armadilhas da Vercel

- **`NEXT_PUBLIC_*` é embutida na MONTAGEM.** Mudar o valor não muda o site:
  exige republicar **com "Use existing Build Cache" desmarcado**, senão a Vercel
  reaproveita o pacote antigo com o valor velho.
- **Variável `Secret` não pode ser lida depois**, nem pelo dono. Por isso as
  duas `NEXT_PUBLIC_` são **Config**.
- **O `/rest/v1/` no fim da URL do Supabase** custou horas na publicação
  (31/08/2026): o login batia em `…/rest/v1/auth/v1/token` e recebia 404. A
  tela de login dizia "e-mail ou senha incorretos" para qualquer falha;
  corrigido na v0.224.0 — hoje ela mostra a causa real.
- **Região da função = São Paulo (`gru1`)**, em *Settings → Functions →
  Function Regions*. É configuração de painel (o `vercel.json` que existe desde
  a ZS1 só tem as rotinas `crons` — não mexe em região), exige deploy novo
  depois de salvar e tem de ser conferida **nos dois projetos**.
- **Rotinas da Vercel (`vercel.json` → `crons`, desde a ZS1):** horária
  (`/api/cron/signatures-hourly`) e mensal (`/api/cron/signatures-monthly`, dia
  1º). Exigem `CRON_SECRET` nos dois projetos e **plano Pro** para a horária
  (no gratuito a Vercel só aceita diária). Até a ZS6/ZS7 as rotas só respondem
  ao segredo e não fazem nada.
- **Webhook da ZapSign (desde a ZS3):** na conta ZapSign (sandbox para o
  treino, real para a produção) cadastrar a URL `https://<site>/api/webhooks/zapsign`
  com o cabeçalho `x-riszon-webhook-secret` = o valor de `ZAPSIGN_WEBHOOK_SECRET`
  do projeto, para os eventos `doc_signed`, `doc_refused`, `doc_expired`,
  `doc_deleted`. **O painel web da ZapSign não tem campo de cabeçalho:** o
  cadastro com o segredo é pela API (`POST /user/company/webhook/` com
  `headers[]`, e `POST /user/company/webhook/header/`), feito em 02/11/2026
  para o treino (sandbox, ids 73894 e 73895) pelo fluxo da área de
  transferência — repetir na conta real para a produção (ZS8).
  Sem isso o pacote nunca sai de "Enviado". Para provar sem a
  ZapSign: `node scripts/zapsign-simular-webhook.mjs ASS-000001 signed 1`
  (treino; `RISARTE_URL` e `ZAPSIGN_WEBHOOK_SECRET` no ambiente).
  Em `iad1` o sistema ficava 6,5× mais lento. Como medir: `CLAUDE.md` §0d.
- **Fluid Compute ligado.** Ao criar estado no nível do módulo em código de
  servidor, conferir que não guarda dado de pessoa (`CLAUDE.md` §0d).

## Conferido antes de publicar (31/08/2026)

Contra o banco de verdade: com a chave pública não se lê nenhuma tabela;
auto-cadastro **fechado** (`Signups not allowed for this instance`); todos os
baldes de arquivo privados.

## Pendente antes de abrir para a equipe

Efetivar o plano Pro (Vercel e Supabase), backups diários, *leaked password
protection* e verificação em duas etapas na conta do Supabase.

## Guias clique a clique (artefatos)

- *Publicar o riSZon* — https://claude.ai/artifact/HVuycChie2sTrcxYduUJUL
- *Lançamento do riSZon* — https://claude.ai/artifact/6ay3hP8g3S9Pd78tZm6mhY

## A completar

Montado em 18/09/2026 no PC Administrador **a partir do que o repositório já
registrava** (`ESTADO_DO_PROJETO.md`, "O SISTEMA ESTÁ PUBLICADO", e `CLAUDE.md`
§0b/§0d). A memória `risarte-producao-online` original está só no outro PC: na
próxima sessão lá, comparar com este arquivo, trazer para cá o que faltar e
então apagar a memória local.
