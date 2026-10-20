# CLAUDE.md

Guia para o Claude Code (claude.ai/code) ao trabalhar neste repositório.
Regras de **produto e negócio** ficam aqui; regras de **código** ficam em
`docs/ARQUITETURA-TECNICA.md`. Detalhe da jornada em `docs/JORNADA.md`; fila de
pendências em `docs/BACKLOG.md` (ler antes de iniciar qualquer etapa nova).

@AGENTS.md
@docs/ARQUITETURA-TECNICA.md

## 0. ⚠️ Trabalho em PARALELO — TRÊS sistemas, um banco (LER PRIMEIRO)

Este repositório é usado por **dois fluxos de trabalho em paralelo**, cada um com
sua própria sessão/agente. Eles compartilham o mesmo repo, o mesmo banco Supabase
e o mesmo deploy (Vercel), então **disciplina é obrigatória** para não misturar.

- **MVP core (riSZon)** — Jornada, clínico, agenda, prontuário, dentista (H4.x).
  Documentos de estado: `ESTADO_DO_PROJETO.md` + `docs/ROADMAP.md`.
- **Risarte Empresarial (B2B)** — schema `empresarial`, rotas `/empresarial`,
  `src/lib/empresarial`. Documentos de estado: `docs/risarte-empresarial/`.
  (Vai integrar ao riSZon; por isso mesmo repo e mesmo banco.)

### ⚠️ E existe um TERCEIRO sistema, FORA deste repositório

**Risarte Academy** — plataforma de treinamento (cursos, trilhas, provas,
certificados, ranking, mural). Mora em
`C:\Users\Jeferson\PROJETOS RISARTE\risarte-academy`, no schema **`treinamento`**,
e **usa o MESMO projeto Supabase** (`hvhbijctanrrkxhemlza`), **compartilhando os
logins pelo `auth.users`**. Baldes de arquivo: `lms-media`, `certificates`,
`covers`.

**Isto custou dados reais em 28/08/2026.** A limpeza dos dados de teste do
riSZon apagou 19 usuários, e quase toda tabela do Academy tem
`user_id references auth.users on delete cascade` — foram junto as matrículas,
o progresso e os certificados. O erro anterior a esse foi o inventário: eu listei
as tabelas lendo `supabase/migrations/` **deste** repositório e tratei o
resultado como se fosse o banco inteiro.

**REGRA, para qualquer operação em massa:**

1. **Pergunte ao BANCO o que existe nele**, nunca deduza das nossas migrações.
   `npm run backup:producao` já faz isso (lê o catálogo de cada schema).
2. **`auth.users` é território comum.** Mexer em usuário afeta os três sistemas.
3. **Não conclua "órfão" olhando só este repositório.** Um balde ou schema sem
   referência aqui pode ser de outro sistema. Descubra *por que* existe antes de
   apagar — no caso do Academy, a resposta apareceu em dez minutos.

**Regras que TODO agente segue (decisão do dono, 10/07/2026):**

1. **Faixas de migração (nunca colidir):** core usa **0106+** (faixa 0–999);
   Empresarial usa **1000+**; **Indica +Risos usa 2000+** (schema `indica`,
   estado em `docs/indica-mais-risos/`, branch `feature/indica-mais-risos`).
   ⚠️ Desde a 2005 o Indica tem **gatilhos blindados** em `appointments`,
   `commercial_sales` e `payment_installments` (`indica_automacao_*`): se
   falharem, o fluxo do núcleo segue e o erro vai para
   `indica.falhas_automacao`. Ao mexer nessas tabelas, rodar
   `npm run test:indica`. Antes de criar migração, use a faixa do SEU projeto
   e o próximo número livre dentro dela. (Core já foi até 0105; Empresarial 0096–0104.)
2. **Documentos de estado separados:** cada projeto atualiza só os SEUS documentos
   (acima). Nunca mexer no documento de estado do outro projeto.
3. **Versão separada** (`src/lib/version.ts`): o core edita `APP_VERSION`/
   `LATEST_MIGRATION`; o Empresarial edita `EMPRESARIAL_VERSION`/
   `EMPRESARIAL_MIGRATION`. Cada um mexe só nas SUAS duas linhas.
4. **Sempre terminar com a árvore limpa:** commite os SEUS arquivos antes de
   encerrar (foi a falta disso que misturou os dois projetos). Ao INICIAR, se achar
   trabalho sem commit do OUTRO projeto, faça um commit próprio e rotulado
   (`chore(empresarial): …` ou `chore(core): …`) ANTES de começar o seu — nunca
   misture os dois num mesmo commit. Rotule os commits por projeto no assunto.
5. **Arquivos de código compartilhados** (agenda, prontuários, `treatment_sessions`,
   `app-sidebar.tsx`, `roles.ts`, `layout.tsx`): o core é o dono deles; mudanças do
   Empresarial aí devem ser **mínimas e aditivas**. Prefira criar arquivos novos
   dentro do seu módulo em vez de editar os compartilhados.
6. **Publicação: tudo continua no `main`, deploy único** — publicar um projeto
   publica os dois. **Combinado com o dono em 27/08/2026: NÃO separar agora.**
   Um branch próprio para o Empresarial resolveria só um terço do acoplamento e
   pioraria outro terço:
   - **Publicação** — resolveria (o Empresarial deixaria de ir ao ar).
   - **Banco** — NÃO resolve: é um Supabase só, e migração do Empresarial roda no
     mesmo banco de qualquer jeito.
   - **Arquivos compartilhados** (menu, `version.ts`, papéis, layout) — PIORA:
     hoje é combinação entre os dois agentes; em branches vira conflito na hora
     de juntar, e quanto mais tempo separado, mais cara fica a junção.

   O que protege de verdade já está nas regras 1–5, e o Empresarial vive em
   rotas próprias atrás de permissão — publicá-lo junto não atrapalha a equipe.
   **Reabrir a discussão só quando** o riSZon for aberto para a equipe com o
   Empresarial ainda em obra; aí o branch (`feature/empresarial`) vale, e tem de
   ser criado pela sessão do Empresarial, com plano combinado entre as duas.

7. **TABELA NOVA ENTRA NA AUDITORIA (desde a 0288, 09/10/2026) — vale para os
   três projetos.** O banco registra sozinho cada inclusão, alteração e
   exclusão por um gatilho preso em cada tabela de cadastro
   (`audit_capture_trg`). Tabela criada depois nasce SEM ele. Toda migração
   que cria tabela em `public`, `empresarial` ou `indica` termina com
   `select public.audit_attach_all();` (idempotente) — ou, se a tabela não deve
   ser auditada (histórico, derivada, registro técnico), declara o motivo em
   `public.audit_excluded_tables`. A **Regra 9** do `check-migrations`
   reprova quem esquecer; a tela de Auditoria avisa o que ficou de fora; e
   `auditoria-alteracoes.test.ts` exige o nome em português da tabela em
   `src/lib/auditoria-catalogo.ts` (arquivo do core, mudança aditiva).

## 0b. ⚠️ O QUE VIAJA ENTRE OS AMBIENTES (e o que não viaja)

Existem **dois endereços no ar**, publicando do mesmo `main`:

| | Produção | Treino |
|---|---|---|
| Endereço | `risarte.vercel.app` | `risarte-treino.vercel.app` |
| Banco | `hvhbijctanrrkxhemlza` | `bsnptybalszjjbhxeejo` |
| Aparência | normal | faixa amarela + aba "TREINO" |

**Três coisas viajam de formas diferentes, e confundi-las gera erro caro:**

1. **CÓDIGO** — automático nos DOIS. Um push no `main` monta os dois projetos.
2. **MIGRAÇÃO** — manual, **por banco**. O dono roda na produção; o agente roda
   no teste com `npm run migrar:teste`. **Enquanto um banco não recebeu, a tela
   nova pode aparecer sem a estrutura que ela precisa** — o código deve tratar
   essa janela (ver `permission_matrix`: a tela mostra o padrão e desabilita o
   salvar em vez de fingir que gravou).
3. **DADOS E CONFIGURAÇÃO** (permissões, SLA, taxas, regras comerciais,
   procedimentos) — **NUNCA viajam**. Cada ambiente tem o seu banco.

**A consequência prática:** o treino pode divergir da produção sem ninguém
perceber, e aí a equipe treina num sistema que não é o que vai usar. Ao mudar
configuração que a equipe encontra, mudar **nos dois**.

**Variável de ambiente é embutida na MONTAGEM** (`NEXT_PUBLIC_*`): mudar o valor
na Vercel não muda o site sem republicar — e com "Use existing Build Cache"
desmarcado. Ver `docs/PRODUCAO-ONLINE.md` (endereços, variáveis, armadilhas e
os guias *Publicar o riSZon* / *Lançamento do riSZon*).

## 0c. ⚠️ A REGRA DO MANUAL — entrega que a equipe percebe atualiza o manual

**Ordem do dono, 04/09/2026.** O manual de treinamento
(`docs/treinamento/manual-treinamento-riSZon.md`) é o que a **equipe** lê. Ele
**não pode envelhecer**: manual desatualizado é pior que manual nenhum — a
pessoa segue um passo que não existe mais, conclui que o sistema quebrou e abre
chamado sobre uma tela que mudou de propósito. O custo cai justamente sobre
quem tem menos condição de perceber que o errado é o papel, não a tela.

**O gatilho é "a equipe percebe?", não o tamanho da mudança:**

| A entrega… | Manual | `ESTADO_DO_PROJETO.md` |
|---|---|---|
| muda tela, botão, texto, regra, permissão ou fluxo | **SIM** | sim |
| acrescenta módulo, papel, mensagem de erro ou aviso | **SIM** | sim |
| é refatoração, teste, script, correção invisível | não | sim |

Os dois documentos existem para leitores diferentes: o `ESTADO_DO_PROJETO.md`
é para quem constrói (e registra tudo); o manual é para quem opera (e registra
só o que se vê). Misturar os dois transforma o manual em diário técnico, e
manual que ninguém lê envelhece igual.

**O que fazer, no MESMO commit da entrega:**

1. **Atualizar a seção do manual que trata daquilo** — nunca um apêndice no
   fim. Um manual com "veja também a seção 15 para o que mudou" já está errado.
2. **Escrever a novidade em `src/lib/changelog.ts`**, na voz de quem opera
   (*"a tela de login passou a dizer qual foi o problema"*, não *"refatorado o
   tratamento de erro"*), apontando a seção do manual que mudou junto.
3. **Manter a disciplina da evidência:** afirmação nova entra com a origem em
   `docs/treinamento/evidencias-riSZon.md`; o que não der para confirmar no
   código vira **"Não identificado no código analisado"**, nunca descrição por
   suposição (regra do dono, 31/08/2026).
4. **Regerar o Word** — é ele que circula com a equipe: `npm run manual:docx`.
5. Bumpar `APP_VERSION`/`LATEST_MIGRATION` como já se faz.

**O passo 2 NÃO depende de ninguém lembrar.** `src/lib/__tests__/changelog.test.ts`
recusa `APP_VERSION` sem entrada correspondente: bumpar a versão sem escrever a
novidade **quebra o portão de entrega**. Foi de propósito — regra que depende de
memória some na primeira entrega apertada, e em um mês o registro vira
arqueologia. Os passos 1 e 4 ainda dependem de disciplina; se algum dia der para
prendê-los por teste, prender.

**Nunca editar o `.docx` à mão.** Ele é gerado a partir do `.md`; qualquer
edição direta desaparece na próxima entrega, sem aviso.

**A tela `/manual` lê o MESMO `.md`** (por `outputFileTracingIncludes` no
`next.config.ts`). Uma fonte, dois destinos — o que a equipe lê na tela e o que
ela lê impresso não podem divergir.

## 0d. ⚠️ ONDE O CÓDIGO RODA IMPORTA TANTO QUANTO O CÓDIGO

**08/09/2026.** O dono relatou "o sistema está lento, todas as telas mais ou
menos igual". A média por clique era **1421 ms**. Terminou em **220 ms** — o
sistema ficou **6,5× mais rápido**, e quase nada disso foi otimizar consulta.

**A causa maior: as funções da Vercel rodavam em `iad1` (Washington) e o banco
está em `sa-east-1` (São Paulo).** Cada consulta atravessava 8.000 km. Uma tela
com quatro consultas em sequência pagava ~760 ms só em viagem.

| | média por clique |
|---|---|
| Como estava | 1421 ms |
| Sem as duas idas à rede da autenticação | 1043 ms |
| **Com a função em São Paulo** | **220 ms** |

**A REGIÃO DA FUNÇÃO É CONFIGURAÇÃO DE PAINEL, NÃO ESTÁ NO REPOSITÓRIO** (não
há `vercel.json`). Vercel → *Settings → Functions → Function Regions* → só
**São Paulo (gru1)**, e **exige deploy novo depois de salvar**. Conferir nos
DOIS projetos: mudar num não muda no outro (o treino ficou para trás e só foi
notado ao medir separadamente).

### ⚠️ COMO MEDIR — e o erro que eu cometi

Eu afirmei ao dono que o servidor estava em São Paulo e **descartei a hipótese
certa**. Tinha lido `x-vercel-id` de `/login` — que é **estática** — e de rotas
que o proxy redireciona **na borda**. Nenhuma delas executa função, então o
cabeçalho só mostrava `gru1`, que é de onde o DONO está.

- **Só requisição LOGADA numa rota dinâmica revela a região da função.**
- Formato: `borda::função::id` (`gru1::iad1::abc`). **Duas partes = a função não
  rodou** — está medindo a borda, não o servidor.
- O instrumento pronto: `RISARTE_URL=... RISARTE_ENV_FILE=.env.test.local
  npm run check:telas` (entra logado, mede cada tela).

### ⚠️ RÉGUA QUE NÃO ACHA NADA TEM DE GRITAR, NUNCA RESPONDER "NÃO"

**09/09/2026 — três vezes no mesmo dia, e a terceira custou 20 minutos do dono.**
O padrão é sempre o mesmo: um script procura algo, o padrão de busca não casa com
NADA, e o script conclui **"não existe"** em vez de **"não consegui medir"**.

| O que eu media | O que o padrão procurava | Por que não achou | O que eu conclui (errado) |
|---|---|---|---|
| se o deploy saiu | `/_next/static/...buildManifest` | o Next 16 não gera esse nome | "não publicou" (tinha publicado) |
| se a correção subiu | `/_next/static/css/` | o Next 16 põe CSS em `chunks/` | "não chegou" (tinha chegado) |
| se o token já existia no arquivo | a string `--pat-branco` | ela existia como USO, não como DEFINIÇÃO | "já está lá" (não estava) |

**A regra:** todo instrumento tem de **falhar alto quando não encontra o que
medir**. Zero resultados é ausência de medição, não medição de ausência — e as
duas produzem a mesma frase na tela se ninguém separar.

Na prática: antes de comparar, conferir que a busca achou **pelo menos um**
candidato, e levantar erro quando achou zero. `check-screens.mjs` já faz isso
("se o servidor não responder, o script diz isso em vez de acusar o sistema de
quebrado"); scripts de uma vez só precisam do mesmo cuidado.

**E o parente disso:** perguntar se uma string existe no arquivo quando o que
importa é se ela existe **naquele papel**. `--pat-branco` aparecia como uso e
como definição; a guarda olhou só a presença e pulou o trabalho.

**A lição para toda investigação de lentidão:** medir a coisa errada com
confiança é pior que não medir — leva a descartar a causa verdadeira. Antes de
concluir "não é X", conferir se o que foi medido chega a exercitar X.

### ⚠️ O COMENTÁRIO DESCREVIA A LISTA, NÃO O EFEITO (11/09/2026)

**Eu apaguei os dados de teste do dono.** A limpeza da suíte
(`limparMovimento`) tinha uma lista de **21 tabelas** e um comentário ao lado
dizendo *"nenhuma tabela de cadastro entra aqui"*. Verdade sobre a lista; falso
sobre o efeito: o `truncate ... cascade` alcançava **87 tabelas**, sete delas no
schema `empresarial` — colaboradores, dependentes, arquivos, uso de benefício.

**Terceira aparição da mesma armadilha** (§0: o truncate que levou junto o
Risarte Academy). A lição de lá era "pergunte ao BANCO o que existe". Aqui ela
volta em outra roupa: **pergunte ao BANCO o que o comando ALCANÇA, não à lista
que você escreveu.**

```bash
npm run check:alcance      # o que o cascade da limpeza realmente esvazia
npm run check:destrutivo   # que comando de migração apaga dado (e se foi declarado)
```

**As três correções, nesta ordem de importância:**

1. **`TRUNCATE CASCADE` ignora a regra da chave estrangeira; `DELETE` respeita.**
   `empresarial.employees.client_id` é `on delete set null` — e o truncate
   apagava os colaboradores mesmo assim. `public.clients` saiu do truncate e
   passou a ser apagada por `delete`: agora o vínculo fica nulo e o cadastro
   fica de pé. Mais lento, e a troca é certa.
2. **A limpeza mede o próprio alcance antes de apagar** e RECUSA quando ele sai
   do schema `public`. Tabela nova que entre no caminho derruba a limpeza até
   alguém declarar, de propósito, que pode ser apagada.
3. **`npm run check:destrutivo` lê toda migração** e reprova comando que apaga
   dado sem um `-- DESTRUTIVO: <motivo>` na linha de cima. Comando dentro de
   corpo de função não conta — aquilo é comportamento, não execução; a primeira
   versão da régua acusou 40 e viraria ruído.

**Para responder "a atualização pode perder dado?":** rodar
`npm run check:destrutivo`. As 261 migrações do histórico foram conferidas uma a
uma em 11/09/2026 — as 7 destrutivas são estreitas e justificadas no próprio
arquivo (de-duplicar papéis, limpar aviso corrompido, órfãos do PPR, derrubar
tabela antiga **depois** de copiar).

**A quarta vez virou instrumento (10/09/2026):**

```bash
RISARTE_URL=... RISARTE_ENV_FILE=.env.test.local RISARTE_EMAIL=... npm run qual:versao
```

Ele entra logado e lê a versão da barra lateral. **Não achou a versão = ERRO,
nunca "versão velha"** — e o erro imprime o trecho do HTML em volta de "Vers",
para o diagnóstico começar com a evidência em vez de com um palpite. Foi assim
que se descobriu, na primeira execução, que **o React parte o texto**:
`Versão {APP_VERSION}` sai como `Versão<!-- -->0.239.2`, e procurar a frase
inteira não acha nada. O deploy estava no ar; quem estava errado era a régua —
que foi exatamente o diagnóstico das três vezes anteriores.

### O que mais cortou tempo

**`getClaims()` no lugar de `getUser()`** (`src/proxy.ts` e `src/lib/auth.ts`).
`getUser()` vai à rede a cada chamada, e o sistema perguntava **duas vezes por
clique** — proxy e página. Os dois projetos usam chave assimétrica (conferir em
`/.well-known/jwks.json`), então a assinatura é verificada localmente.

**O preço disso, e como está pago:** token já emitido vale até vencer (1h),
então banir no Supabase deixou de cortar na hora. `profiles.is_active` era
buscado a cada requisição e **nunca conferido** — agora é exigido, e desativar
corta no clique seguinte, por decisão do banco. Quem cai lá vai para
`/conta-desativada`, que fica **fora do grupo `(app)`** de propósito: lá dentro
toda tela chama `getSessionContext()`, que é quem manda para lá — seria laço.

**Fluid Compute LIGADO** (uma cópia atende várias requisições). Combina com este
sistema, que passa o tempo esperando o banco. O risco é estado de módulo
compartilhado entre pessoas — varrido em 08/09/2026: só há cache de feriados, do
texto do manual e a presença do chat (que roda no navegador). Nenhum dado de
pessoa. **Ao criar estado no nível do módulo em código de servidor, verificar de
novo.**

## 0e. ⚠️ Ambiente de trabalho: DOIS PCs sincronizados

**Guia completo, `.stignore` oficial e o que fazer quando algo dá errado:
`docs/DOIS-PCS.md`. Ler na primeira sessão de cada PC e sempre que o Git ou o
Syncthing se comportarem de forma estranha.**

- Dois computadores: **PC Administrador** (`DESKTOP-4CFTCVB`) e **Notebook do
  Jeferson**. A pasta `Risarte riSZon` é sincronizada pelo SyncTrayzor
  (Syncthing); o código é versionado no GitHub.
- **O código viaja SÓ pelo GitHub.** O `.stignore` (igual nos dois PCs, não
  sincronizado) tira `risarte/` inteira do Syncthing, exceto os `.env*.local` e
  os arquivos pesados de `docs/marca/`. Se o Syncthing copiasse código, o
  `git pull` do outro PC recusaria atualizar.
- Cada PC tem a **sua** chave SSH no GitHub, Node **24** e
  `core.autocrlf = true`.

### Ao iniciar uma sessão

1. `git status` (tem de estar limpo; se não estiver, PARAR e mostrar ao dono)
   e `git pull` antes de qualquer alteração.
2. Ler "Estado da última sessão" abaixo: se o outro PC não registrou o
   encerramento, o trabalho dele pode estar sem push — resolver lá primeiro.
3. Procurar arquivos `*.sync-conflict-*`. Se existirem, **avisar o dono e NÃO
   apagá-los sem a confirmação dele**.
4. Se o pull mudou `package.json`/`package-lock.json`, rodar `npm install`
   (`node_modules` não é sincronizado; cada PC tem o seu).

### Ao encerrar uma sessão

1. Commit e push de todo o trabalho, mesmo incompleto (trabalho em andamento
   que não pode ir ao ar vai num branch — o `main` publica sozinho). Conferir
   `git status -sb` sem `[ahead N]`.
2. Atualizar "Estado da última sessão" abaixo (data, PC, feito, pendente,
   próximo passo) e incluir no push.
3. **⚠️ ACHADO DE PASSAGEM VIRA LINHA NO `docs/BACKLOG.md`** (seção *Achados de
   passagem*), **no mesmo dia em que foi encontrado** — ordem do dono,
   25/09/2026: *"se encontrar e não registrar para lembrar depois do que
   precisamos corrigir, podemos esquecer e o relato de ter encontrado não teve
   utilidade nenhuma."*

   **Dizer no chat NÃO é registrar.** A conversa termina, a sessão fecha, e o
   que sobra é o custo de ter procurado sem o benefício de ter achado. Quase
   todo defeito caro deste projeto foi visto por alguém antes de doer.

   O achado **não entra no commit da vez** (misturar dois assuntos esconde os
   dois): entra no BACKLOG, separando **o que está confirmado** do **que é
   suspeita** — item que mistura os dois faz alguém "corrigir" um palpite.

### Regras

- **Nunca trabalhar no mesmo projeto nos dois PCs ao mesmo tempo.**
- `.env.local` se edita num PC só por vez (não tem Git por trás).
- Não depender de memórias locais do Claude (`~/.claude`): tudo que for
  importante para a continuidade fica registrado neste arquivo ou em `docs/`.
- **⚠️ NADA APAGA DADO SEM ALGUÉM PEDIR** (ordem do dono, 25/09/2026, depois do
  OC-00088): script, rotina agendada ou migração que apague alguma coisa tem de
  **exigir autorização explícita** — `RISARTE_APAGAR_TREINO=sim`, `--confirmar`,
  `CI`, ou um `-- DESTRUTIVO:` declarado. O inventário completo do que consegue
  apagar (e o que cada caminho exige) está em `docs/BACKLOG.md`, seção
  *Inventário do apagamento*; a régua que **reprova a entrega** é
  `src/lib/__tests__/apagar-com-autorizacao.test.ts`.

  **E a régua se prova quebrando o código de propósito.** A primeira versão
  dela passou verde com a trava do `reset-test.mjs` arrancada, porque procurava
  a *palavra* `RISARTE_APAGAR_TREINO` — que continuava no arquivo, dentro do
  texto da mensagem de erro que ensina a autorizar. **Régua nova só vale depois
  de ter reprovado uma vez.**

### Estado da última sessão

*(atualizado ao fim de cada sessão — o estado do PRODUTO fica na §7 e em
`ESTADO_DO_PROJETO.md`)*

**20/10/2026 — PC Administrador (core 0.332.0 → 0.333.0, migração 0309)**

- **Vigência do preço (Odontograma OD1, D3).** Decisões do dono: banco aplica
  à 0h + aviso; hoje ou futuro; editar, preço da unidade e reajuste em massa.
  O preço de hoje continua nas colunas de sempre — **nenhum leitor mudou**.
- ⚠️ **O histórico de preço nasce por GATILHO** (`procedure_price_history`):
  todo caminho que grava preço registra sozinho. Não gravar histórico "à mão"
  em action nenhuma — duplicaria. Ele é imutável; só sai em cascata quando um
  procedimento nunca usado é apagado (`pg_trigger_depth() > 1`).
- ⚠️ **O histórico conta o que VALEU**: reajuste aplicado com atraso registra o
  dia em que o preço mudou, não a data marcada; e não passa por cima de
  mudança feita à mão depois da data (achados no ensaio).
- ⚠️ Num script `node -e`, `\n` dentro de texto vira quebra de linha de
  verdade e quebra o arquivo de teste (2× nesta sessão) — editar teste pela
  ferramenta de edição.
- ⏳ **0309 pendente na produção.** Resíduo no treino: 1 reajuste agendado e
  cancelado no "Ajuste de Bordas Incisais".
- Cache do servidor de teste limpo ao encerrar (AP40).

**19/10/2026 (8ª) — PC Administrador (core 0.331.1 → 0.332.0, migração 0308)**

- **ODONTOGRAMA começou** (prompt do dono; plano e decisões em
  `docs/odontograma/OD0-PLANO.md`). OD0 fechada com 13 decisões; OD1 passo 2:
  a **0308** (referência TUSS + situações Risarte + regras dos 370
  procedimentos, das planilhas aprovadas) e a tela **Administração →
  Odontograma**.
- ⚠️ **As planilhas voltaram com "Decisão" vazia** — o dono disse "revisei, pode
  seguir": tratado como aprovado como proposto, e registrado assim.
- ⚠️ **Num CHECK, "desconhecido" PASSA** (conta com valor vazio): a regra
  "face exige nº de faces" deixava passar; corrigido com `coalesce(…, false)`.
  Ao escrever CHECK com OR/AND sobre coluna anulável, testar com o vazio.
- ⚠️ **Odontograma = ACRESCENTAR o dente ao que existe** (catálogo, plano,
  negociação, sessões, repasse, auditoria) — nunca um segundo sistema ao lado.
- ✅ **0308 APLICADA nos dois bancos** (o dono rodou na produção em 20/10/2026 e a conferência deu o esperado (60 dentes, 7 faces, 308 faces por dente, 61 regiões / 33 com dentes, 5 + 33 situações, 370 regras, 0 procedimento odontológico sem regra, 7 tabelas na auditoria); conferido de fora: sem login, trocar faces recusa com "permission denied" e as situações não aparecem; a chave de serviço, que não é Admin, recebe NOT_ALLOWED antes de gravar; a regra do implante (82000980) está lá: dente, efeito RZ-IMPLANTE). Próximo: vigência do preço (D3) e o
  desenho `<Odontogram />`.
- Cache do servidor de teste limpo ao encerrar (AP40).

**19/10/2026 (7ª) — PC Administrador (core 0.331.0 → 0.331.1, sem migração)**

- **OC-00004 — as tarefas da ASB na certificação.** DEFEITO (eu tinha dito
  "regra" antes de mapear): seis itens da lista eram ações que o sistema
  NUNCA deixou a ASB fazer — missão impossível. O dono pediu tirar "também da
  permissão": não havia permissão a tirar. Entraram pedidos (franqueadora e
  local), entrada, envio para uso, inventário, ajuste e indicação.
- ⚠️ **Indicador novo = conferir que AQUELA FUNÇÃO consegue fazer aquilo no
  sistema** (tela E banco). O catálogo de 25/09 foi montado pelas colunas que
  registram autor, não pela permissão — e assim ofereceu ações impossíveis.
  AP55 (TSB e Recepção), AP56 (agenda), AP57 ("Onde" antigos).
- ⚠️ Filtro da origem aceita `a|b` (= qualquer um); `check:indicadores`
  lê `public`, `empresarial` e `indica`.
- Cache do servidor de teste limpo ao encerrar (AP40).

**19/10/2026 (6ª) — PC Administrador (core 0.330.0 → 0.331.0, migração 0307)**

- **A lista de Procedimentos (pedido do dono):** com a TUSS no treino ela
  tinha 49 mil pixels. Agora: blocos por especialidade, cartão de resumo
  (clique abre, um por vez), **inativos numa seção própria**, e em cada linha
  o que falta / a sobra / o uso (0307). Especialidades parecidas: o dono
  decidiu **não juntar** (AP54 fechado).
- ⚠️ **Teste que lê arquivo do disco tem de normalizar CRLF**: ao trocar de
  ramo, o Git devolveu os arquivos com CRLF e a régua da 0306 (que procurava
  `\n`) reprovou sem defeito nenhum. As duas réguas agora normalizam.
- **Não visto:** como Planner e o modo unidade. ✅ **0307 APLICADA nos dois bancos** (o dono rodou na produção em 19/10/2026 e a conferência deu o esperado; conferido de fora: sem login a contagem recusa com "permission denied" (uma função inexistente, de controle, responde "não encontrada" — a recusa é da 0307); a chave de serviço, que não é Admin nem Planner, recebe NOT_ALLOWED. Ela só lê).
- Cache do servidor de teste limpo ao encerrar (AP40).

**19/10/2026 (5ª) — PC Administrador (core 0.329.1 → 0.330.0, migração 0306)**

- **OC-00067 + OC-00068 (um caso só): o Planner e o catálogo.** As duas eram
  REGRA (0039 deu o catálogo ao Planner; 0036 previa linha livre no
  orçamento), e o Planner ainda mudava o preço de qualquer item. Decisões do
  dono: o Planner **consulta** e edita DIRETO só as **sessões**; **item
  personalizado sai para todos**; o **preço é o do catálogo, fixo**;
  procedimento novo é **sugestão** que o Admin aprova (já cria), recusa ou
  pede informação.
- ⚠️ **Gatilho que confere `current_user` tem de ser `security invoker`**:
  com `security definer`, `current_user` é sempre o dono e a trava nunca
  vale — o ensaio da 0306 pegou isso (régua presa por teste).
- ⚠️ **O preço do item do plano quem põe é o BANCO**
  (`plan_item_catalog_guard` + `catalog_price_for`); a tela não manda.
  Funções do banco que mexem nos itens (rodam como dono) passam livres.
- AP53 (BACKLOG): as especialidades seguem com o Planner. No treino ficaram 8
  itens personalizados antigos (a cópia de plano não os leva).
- **TUSS odontológica (pedido do dono):** 370 procedimentos (capítulo 8,
  códigos 81–87) na planilha `Procedimentos TUSS - Odontologia.xlsx` (pasta
  sincronizada, fora do repositório), no formato da importação; especialidade
  pelo capítulo, pilar/tempo/preço em branco. ✅ **Importada no TREINO** pela
  tela (Admin de teste): 370 novos, 0 atualizados, todos com preço R$ 0,00.
  No treino eles convivem com os 9 de antes (ex.: "Restauração em resina 1
  face" e "Restauração em resina fotopolimerizável 1 face"). ✅ **Importada na PRODUÇÃO em
  19/10/2026** (decisão do dono: pela chave do servidor, todos ATIVOS): 370
  procedimentos, PRC-00001 a PRC-00370, todos com preço R$ 0,00; o roteiro
  conferiu as 370 linhas contra o que a tela gravou no treino (iguais) e
  recusaria colisão de nome/TUSS (a produção tinha 0). Histórico "Criado
  (importação de planilha)" sem autor, e a trilha de alterações registra as
  370 como "Sistema". ⚠️ **Falta o PREÇO** antes de a equipe orçar. AP54:
  especialidades parecidas ficam (decisão do dono).
- **Não visto na tela:** como Planner (conta de teste em modo portal no
  treino) e o orçamento (nenhum plano em rascunho lá). ✅ **0306 APLICADA nos dois bancos** (o dono rodou na produção em 19/10/2026 e a conferência deu o esperado; conferido de fora: sem login, sugerir, editar sessões, aprovar e o aviso interno recusam com "permission denied"; com a chave de serviço, que não é Admin, aprovar responde NOT_ALLOWED antes de gravar; a tabela de sugestões não entrega nada sem login e está vazia. A produção tem 0 procedimentos e 0 itens de plano, então ninguém foi afetado).
- Cache do servidor de teste limpo ao encerrar (AP40).

**19/10/2026 (4ª) — PC Administrador (core 0.329.0 → 0.329.1, sem migração)**

- **OC-00104 — o destaque da linha em Problemas parava no meio.** Defeito: o
  link dentro da `<li>` flex não esticava (`min-w-0 flex-1`). Medido no
  navegador antes/depois.
- ⚠️ **O painel do navegador escondido mede tudo como 0** (`innerWidth` = 0):
  para medir largura, fixar o tamanho com `resize_window` antes.
- ⚠️ **A régua do texto pegou o próprio COMENTÁRIO** que citava a classe e
  passou com a correção arrancada — de novo o padrão do §0d. Régua que procura
  classe lê só o `className`.
- Cache do servidor de teste limpo ao encerrar (AP40).

**19/10/2026 (3ª) — PC Administrador (core 0.328.0 → 0.329.0, migração 0305)**

- **AP52 (pedido do dono): a mesma função em duas turmas abertas virava duas
  missões** medindo o mesmo trabalho (na produção: uma dentista em Cambé e
  Londrina). Decisão do dono: **uma missão vale para as duas** — aceitar,
  cumprir e aprovar levam as matrículas irmãs junto; um certificado só; ela
  conta no grupo de cada unidade.
- ⚠️ **Mexer em `start_training_mission`, `record_training_completion` ou
  `_certify_enrollment` = manter a chamada a `_sync_training_siblings`**
  (régua presa por `uma-missao-por-funcao.test.ts`).
- A 0305 acerta o caso existente: 1 matrícula na produção (TR-00004) passa a
  "em andamento" com o marco da irmã. **Não visto na tela** (o quadro só
  existe no real). ✅ **0305 APLICADA nos dois bancos** (o dono rodou na produção em 19/10/2026 e a conferência deu o esperado; conferido de fora: as duas matrículas de dentista (TR-00004 e TR-00005) estão em andamento com o MESMO marco, 19/10 10:21; sem login, aceitar recusa com "permission denied"; a regra das irmãs não é chamável por usuário (só pelo servidor, e com identificador inexistente não mexe em nada)).

**19/10/2026 (2ª) — PC Administrador (core 0.327.0 → 0.328.0, migração 0304)**

- **OC-00111 (PRODUÇÃO) — modo portal: "não consigo escolher a unidade para
  aceitar" e "não consigo relatar".** DOIS defeitos: o Início lia só UMA
  missão (`.limit(1)`) — com TSB em Cambé e ASB em Londrina, a de Cambé não
  tinha como ser aceita; e a boia do portal nascia sem unidade, com o banco
  recusando o relato (a tranca da 0277 esconde a unidade fechada de
  `user_clinic_ids`). O OC-00111 foi registrado pelo TREINO.
- Decisões do dono: **um quadro por missão** (`missoesAbertas`, com a
  unidade), **relato na unidade da FICHA** (`my_report_clinic`, 0304) e o
  **sino no portal** (`/notificacoes` em `PORTAL_PATHS`; o chat segue fora).
- ⚠️ **No portal, `session.activeClinic` é nulo e `user_clinic_ids()` é
  vazio** — função do banco que precisa da unidade da pessoa no portal lê
  `user_clinic_roles_all` (como `my_report_clinic`).
- **AP52 (BACKLOG):** a mesma função em duas turmas abertas vira duas missões
  que medem o mesmo trabalho (confirmado na produção; o efeito no
  certificado é suspeita).
- **Não visto na tela** (o quadro só existe no real). ✅ **0304 APLICADA nos dois bancos** (o dono rodou na produção em 19/10/2026 e a conferência deu o esperado; conferido de fora: sem login, a função da unidade da ficha recusa com "permission denied"; com a chave de serviço, que não é pessoa nenhuma, devolve vazio — ela só responde sobre quem está logado).

**19/10/2026 — PC Administrador (core 0.326.0 → 0.327.0, migração 0303)**

- **OC-00003 (PRODUÇÃO) — "o convocado não recebe alerta".** REGRA: o quadro
  da missão existe só no Início do sistema REAL (a certificação mora lá); o
  dono testou entrando como o dentista no TREINO. Mas nenhum aviso no sino era
  criado (confirmado na produção). Decisões do dono: **aviso no sino** ao
  convocar (gatilho na matrícula; os já convocados de turma aberta receberam o
  seu), **a equipe da coletiva no Início** e o **painel Acompanhamento** em
  Administração → Certificação.
- ⚠️ **O progresso dos outros é a ÚLTIMA MEDIÇÃO GUARDADA**
  (`progress_snapshot`, `record_training_progress` só para service_role).
  Toda medição que já existia guarda o retrato antes de registrar a conclusão.
  Não medir a rede inteira ao abrir tela.
- ⚠️ **A equipe = o MESMO grupo que segura a unidade** (`my_training_group`
  espelha `_system_access_raw`, 0277). Mudou um, mudar o outro.
- ⚠️ **O painel lê numa consulta própria**: se a 0303 não rodou num banco, só
  ele avisa; a lista de Turmas não cai junto.
- Na produção: TR-00002 (reciclagem, "suspende agora") com dois dentistas
  convocados — **nenhum suspenso** (só suspende quem tinha acesso).
- Visto na tela no treino: o painel. **Não visto:** o quadro da equipe e o
  sino (só existem no real). A 0303 no treino avisou o dentista convocado na
  TR-00018 de lá. ✅ **0303 APLICADA nos dois bancos** (o dono rodou na produção em 19/10/2026 e a conferência deu o esperado; conferido de fora: sem login, a equipe e a gravação do progresso recusam com "permission denied"; a leitura do painel (colunas novas) responde; os dois dentistas convocados na TR-00002 têm 1 aviso cada no sino, ainda não lidos).
- Cache do servidor de teste limpo ao encerrar (AP40).

**17/10/2026 — PC Administrador (core 0.325.0 → 0.326.0, migração 0302)**

- **OC-00110 — "conciliei e não entrou na DRE"; "não acho as contas pagas".**
  NÃO era defeito: as 3 linhas foram LANÇADAS e estão na DRE de SETEMBRO (a
  competência é a data do extrato); o print era de outubro. Conserto do texto:
  o Lançar diz o mês (`mesDaDre`). O filtro "Pagas" já existia.
- Decisões do dono: **Pagar conta** pela conciliação
  (`pay_payable_from_bank_transaction`, 0302) + aviso no Lançar quando há
  conta a pagar em aberto do mesmo valor; **Relatório de contas pagas**
  (`contas-a-pagar/pagas`, PDF e planilha, pela data do pagamento).
- ⚠️ **Pagar pela conciliação NÃO é caminho novo para o dinheiro:** a 0302
  chama `register_payable_payment` e `reconcile_bank_transaction`. Só o
  saldo EXATO (com multa/juros: pagar em Contas a pagar e casar por Vários).
- ⚠️ **O saldo da conta a pagar é `amount − pago − desconto`** (sem
  estornos); `paid_amount_cents` NÃO inclui o desconto por pontualidade.
- Visto na tela no treino: o relatório (Franchising, 6 pagamentos,
  R$ 679,12), a planilha e o texto do mês no Lançar. **Não visto:** o botão
  Pagar conta (nenhuma conta do treino tem o valor de uma linha pendente; não
  criei dado de teste na unidade do relato). ✅ **0302 APLICADA nos dois bancos** (o dono rodou na produção e a conferência deu o esperado; conferido de fora: sem login a função recusa com "permission denied" antes de rodar; com a chave de serviço responde TRANSACTION_NOT_FOUND para linha inexistente, antes de gravar; a leitura nova da Conciliação (contas com os pagamentos) responde. A produção tem 0 contas bancárias e 0 pagamentos de contas, então ninguém foi afetado).
- Cache do servidor de teste limpo ao encerrar (AP40).

**16/10/2026 (noite, 4ª) — PC Administrador (core 0.324.0 → 0.325.0, migração 0301)**

- **OC-00108 — "não há opção para baixa do crédito" na Conciliação.** NÃO era
  defeito na regra: o recebimento do paciente nasce na baixa da parcela
  (Recebíveis) e na Conciliação só se CASA; "Lançar" cria e duplicaria. A
  conta do relato estava na RISARTE Franchising, por isso o Lançar mostrava as
  contas da franqueadora. Melhorias escolhidas pelo dono: **Vários** (uma
  linha × vários lançamentos, soma no centavo), **Transferência** (conta
  **6.3.01**, ativo — fora da DRE pelo `not like '6%'`), **aviso contra
  duplicar** no Lançar e a tela lendo **tudo** (antes, 1.000 linhas).
- ⚠️ **Lançamento casado com várias linhas vive em `bank_transaction_matches`**
  (a linha fica com `matched_entry_id` nulo). Um lançamento casa com UMA linha
  só, nos dois caminhos (índice único + `ENTRY_ALREADY_RECONCILED`).
- ⚠️ **`check-migrations`: a comparação de retorno passou a ignorar espaço
  em volta de parênteses e vírgulas** (falso positivo em
  `cash_flow_series_raw`); provado que ainda pega mudança real.
- ⚠️ **No treino, a conta bancária e o extrato foram MOVIDOS para a Risarte
  Cambé - Centro** (resposta do dono). ✅ **0301 APLICADA nos dois bancos** (o dono rodou na produção em 16/10/2026 e a conferência deu o esperado; conferido de fora: a conta 6.3.01 existe como ativo, a tabela nova existe e está vazia; sem login, as três funções da conciliação recusam com "permission denied" antes de rodar; com a chave de serviço, o Vários responde TRANSACTION_NOT_FOUND para linha inexistente, antes de gravar. A produção tem 0 contas bancárias, então ninguém foi afetado).
- **AP51 (BACKLOG):** o saldo pelo sistema soma todas as contas bancárias da
  unidade; casar a maquininha sozinho exigiria o relatório da adquirente.
- Visto na tela no treino (Admin de teste, Cambé): botões, orientação,
  janelas de Transferência e Vários (canceladas; nada gravado).
- Cache do servidor de teste limpo ao encerrar (AP40).

**16/10/2026 (noite, 3ª) — PC Administrador (core 0.323.0 → 0.324.0, migração 0300)**

- **OC-00109 — a nota fiscal "dividida pelas linhas".** NÃO era: as 12 contas
  são as 12 DUPLICATAS do próprio XML (cartão, a prazo); os produtos entraram
  no estoque com o valor real. O defeito era o TEXTO ("(17 itemns)", sem
  "parcela"). Decisões do dono: descrição "parcela X/Y (N itens)" — também nas
  antigas; **Pagar a nota** (todas as parcelas em aberto, pela mesma porta do
  Pagar); e trocar as parcelas na importação (nota / à vista / em N vezes, com
  a forma de pagamento).
- ⚠️ **A lista de formas de pagar é uma só** (`formas-de-pagar.ts`), e a
  função do banco que escreve a descrição conhece as mesmas (teste compara).
- Visto na tela no treino (Admin de teste na RISARTE Franchising): as 12
  parcelas com o texto novo e a janela de pagar a nota (cancelada).
  ⚠️ Os textos das contas da nota do relato NO TREINO já foram reescritos pela
  0300. ✅ **0300 APLICADA nos dois bancos** (o dono rodou na produção em 16/10/2026 e a conferência deu o esperado; conferido de fora: "pagar a nota" recusa sem login antes de rodar; a produção tem 0 contas vindas de nota, então a reescrita do texto não tocou nada lá).
- Cache do servidor de teste limpo ao encerrar (AP40).

**16/10/2026 (noite, 2ª) — PC Administrador (Empresarial 0.80.1 → 0.80.2, migração 1031)**

- **AP50, a sobra:** as três contagens do Empresarial (titulares e dependentes
  contratados, dependentes ativos) respondiam sobre QUALQUER empresa a
  qualquer logado. A 1031 exige que quem chama enxergue a empresa
  (`accessible_company_ids`). Números iguais; nenhuma tela muda.
- ✅ **1031 APLICADA nos dois bancos** (o dono rodou na produção em 16/10/2026
  e a conferência deu o esperado; conferido de fora: sem login as três recusam
  antes de rodar, e a chave de serviço — que não enxerga empresa — cai na
  guarda nova, NOT_ALLOWED).

**16/10/2026 (noite) — PC Administrador (Empresarial 0.80.0 → 0.80.1, migração 1030)**

- **AP50 — VARREDURA DO EMPRESARIAL (pedido do dono).** 🔴 `delete_employee`,
  `complete_employee` e `link_dependent` GRAVAVAM SEM LOGIN e sem conferir
  quem chama (confirmado na produção). A 1030 põe no banco a régua da tela
  (`can_manage_employees` = `canManageEmployees`; e a unidade, como
  `canUseClinic`) e fecha as três para `anon`. Nenhuma tela muda.
- ⚠️ **Prova de "executa sem login" na produção sem gravar:** chamar com
  identificador INEXISTENTE — a função para no NOT_FOUND antes de gravar; se a
  resposta for o NOT_FOUND, ela executou. "permission denied" = fechada.
- ✅ **1030 APLICADA nos dois bancos** (o dono rodou na produção em 16/10/2026
  e a conferência deu o esperado — 0 executam sem login, 5 logado; conferido
  de fora: as cinco recusam ANTES de rodar sem login, onde antes três
  executavam).

**16/10/2026 (fim da tarde) — PC Administrador (Empresarial 0.79.0 → 0.80.0, migração 1029)**

- **OC-00105 — "Sem permissão" ao gerar cobrança no Empresarial.** NÃO era
  defeito: a regra escrita dava a cobrança só ao gestor do programa (Admin,
  Franqueadora/Rede, RisLife); o Financeiro da Franqueadora nunca esteve na
  lista. **Decisão do dono: o Financeiro faz SÓ O FINANCEIRO do programa**
  (cobranças, baixas, estorno, inadimplência, Acordo de cobrança); o
  comercial segue com o gestor. Régua `isProgramFinance` ↔
  `empresarial.is_program_finance()` (1029). A Franqueadora/Rede fica como
  está (AP49, decisão do dono).
- 🔴 **AP50, achado e corrigido junto:** `cancel_billing` executava SEM LOGIN
  na produção; `reverse_billing` aceitava qualquer logado.
- ⚠️ **O Acordo de cobrança grava por porta estreita**
  (`salvar_acordo_de_cobranca`): abrir a regra de alteração de empresa ao
  Financeiro deixaria ele mudar a empresa inteira pela API.
- ⚠️ A aba de cobranças mostrava os botões para todo mundo — agora só para
  quem cobra (`podeCobrar`).
- Visto na tela no treino como `financeiro@example.com`: a prévia da
  mensalidade abriu (não confirmada; nada gravado). ✅ **1029 APLICADA nos dois bancos** (o dono rodou na
  produção em 16/10/2026 e a conferência deu o esperado; conferido de fora:
  `cancel_billing`, `reverse_billing` e `salvar_acordo_de_cobranca` recusam
  ANTES de rodar sem login — antes `cancel_billing` executava — e também com a
  chave de serviço, que nenhuma tela usa para elas; o webhook do ASAAS usa
  `settle_billing`, que não mudou de permissão).
- Cache do servidor de teste limpo ao encerrar (AP40).

**16/10/2026 (tarde) — PC Administrador (core 0.322.0 → 0.323.0, migração 0299)**

- **AP48 (o dono pediu):** o grupo do teste coletivo não salvava pela tela —
  mesmo DELETE sem WHERE. 0299 corrige. ⚠️ **Régua global**:
  `delete-sem-where.test.ts` (versão mais recente de cada função).
  ✅ **0299 APLICADA nos dois bancos** (o dono rodou na produção em 16/10/2026 e a conferência deu o esperado; conferido de fora: sem login recusa com "permission denied"; a chave de serviço, que não é Admin Master, recebe NOT_ALLOWED antes de gravar). Na produção o grupo do teste coletivo está VAZIO (0 cargos, 0 pessoas) — coerente com nunca ter salvado pela tela; o Admin precisa montá-lo de novo se for usar a liberação coletiva.
- A pasta `_extratos-oc103` foi apagada (OK do dono) e saiu do
  `.git/info/exclude`.

**16/10/2026 — PC Administrador (core 0.321.0 → 0.322.0, migração 0298)**

- **OC-00103 — A IMPORTAÇÃO DO EXTRATO NÃO FUNCIONAVA PELA TELA, PARA NENHUM
  ARQUIVO.** O relato era do TREINO (a produção não tem conta bancária). Os
  arquivos do Inter estavam certos.
- 🔴 **A API DO SUPABASE RECUSA DELETE/UPDATE SEM WHERE** (`safeupdate`,
  carregado no papel `authenticator`), também dentro de função. **Prova por
  transação desfeita NÃO enxerga isso** — a conexão direta não carrega o
  safeupdate (e `load 'safeupdate'` é recusado). Para provar pelo caminho
  da API sem gravar: fazer a função falhar de propósito LOGO DEPOIS do
  comando suspeito e ler qual erro veio. **Esvaziar a tabela inteira =
  `where true`.** Regra 10 do `check-migrations`.
- ⚠️ **Extrato do Inter vem em UTF-8**; a tela lia tudo como Latin-1.
  `decodeStatement` escolhe pelo conteúdo.
- ✅ **0298 APLICADA nos dois bancos** (o dono rodou na produção em 16/10/2026 e a conferência deu o esperado — 1 versão, comando corrigido, o antigo ausente, sem login não executa, logado executa; conferido de fora, sem login: recusa com "permission denied"; com a chave de serviço responde ACCOUNT_NOT_FOUND para conta inexistente, antes de gravar). ⚠️ A produção tem 0 contas bancárias: a importação de verdade só pode ser provada lá quando alguém cadastrar uma.
- **AP48 (BACKLOG):** `save_training_cohort` tem o mesmo defeito (não
  executado — mudaria a configuração).
- Os extratos do relato ficaram em `_extratos-oc103/` só durante o
  diagnóstico; apagados no mesmo dia, com o OK do dono.
- **Não visto na tela:** a importação de verdade (fica para quem relatou, na
  conta dele, depois da 0298).

**15/10/2026 (fim da noite) — PC Administrador (core 0.320.0 → 0.321.0, sem migração)**

- **Resto do lote do BACKLOG (escolha do dono): AP47, AP41, AP45 e a ajuda
  das telas** — todos resolvidos.
- ⚠️ **A API CORTA EM 1.000 — régua nova** (`limite-da-api.test.ts`):
  `.limit` acima de 1.000 reprova; tela que soma lê em páginas
  (`lerTodasAsPaginas`), e lista grande de ids vai em lotes
  (`lerPorLotes`). Leitura que falha vira aviso, nunca número pela metade.
- ⚠️ **AGENDA x PLANEJAMENTO ANUAL: uma regra só** (`situacaoDoPlanoNoDia`).
  Ao mexer na validação do agendamento ou nos próximos horários, usar ela —
  duas réguas para o mesmo dia é como uma oferece o que a outra recusa.
- ⚠️ **`ListaComBusca` dentro de `FilterForm` precisa de
  `aplicaAoEscolher`** — o campo escondido não avisa a mudança e o filtro
  não aplicaria.
- ⚠️ **Ajuda de rota com `[id]`:** declarar as pastas vizinhas em
  `naoVale` (a régua lê o disco).
- **Visto na tela** (treino, Admin de teste): a pessoa da Auditoria — digitar
  filtra, Enter escolhe e o filtro aplica (⚠️ no servidor de desenvolvimento
  leva mais de 5 s; esperar antes de concluir "não aplicou" — eu quase
  concluí). `check:telas`: 1.024 aberturas, só a AP31.
- **Não visto na tela:** as outras listas novas, o painel ? das quatro telas e
  o recesso com avulso — presos por teste (20 quebras de propósito
  reprovadas). E2E do planejamento ajustado e **não rodado**.
- Cache do servidor de teste limpo ao encerrar (AP40).

**15/10/2026 (noite) — PC Administrador (core 0.319.0 → 0.320.0, migrações 0296 e 0297)**

- **AP42 (0296, decisão do dono: liberar no banco).** ⚠️ Réguas POR NOME
  (Coordenador e ASB), não pela matriz: a matriz da produção liga as mesmas
  ações para a Franqueadora/Rede, que ficou em consulta (OC-00094).
  Receber/nota/mínimo/kits seguem `can_manage_stock` (criam conta a pagar).
- 🔴 **0297 — Financeiro sem login, com DUAS BRECHAS:** a guarda "se HÁ
  usuário e ele não pode…" deixa passar quem NÃO está logado. Ao escrever
  guarda para rotina agendada, FECHAR a função para `anon` — a rotina roda
  como dono do banco e não precisa da porta aberta.
- ✅ **0296 APLICADA nos dois bancos** (o dono rodou na produção em 15/10/2026 e rodou a conferência; conferido de fora, sem login: `can_request_purchase` e `can_post_stock_entry` existem e recusam — uma função inexistente, de controle, responde "não encontrada").
- ✅ **0297 APLICADA nos dois bancos** (o dono rodou na produção em 15/10/2026 e a conferência deu o esperado — 60 funções, 0 sem login, 60 logado, 60 chave de serviço, brecha fechada; conferido de fora, sem login: `cash_balance_before`, `charge_fixed_network_fees` e `dre_lines` recusam com "permission denied" ANTES de rodar — a das cobranças só foi chamada depois de a primeira provar que a 0297 estava lá).
- Ainda deste lote (escolha do dono): AP47, AP41, AP45 e a ajuda das telas.

**15/10/2026 (tarde) — PC Administrador (core 0.318.0 → 0.319.0, migração 0295)**

- **Pendências do BACKLOG (escolha do dono):** AP23/AP46 (celular), AP44
  (Jornada), AP43 (0295), AP21 e AP22 — todos resolvidos. Novo: **AP47**
  (telas que somam com `.limit(5000)` e recebem 1.000).
- ⚠️ **NO CELULAR O MENU LATERAL É GAVETA** (decisão do dono): abaixo de
  768 px some; o ☰ da barra a abre por um evento da janela
  (`ABRIR_MENU_LATERAL`). Item novo na barra de cima: pensar no celular — os
  menos usados vão para o ⋯ (`MenuMaisDaBarra`).
- ⚠️ **`suppressHydrationWarning` só no `<html>`** (tema escuro, AP22). Há
  régua que reprova a licença em qualquer outro lugar.
- ⚠️ **`check-migrations` agora olha os três schemas.** Conferir migração
  ANTIGA contra outra faixa pode acusar à toa (a ordem é a do nome, não a do
  tempo); para migração nova, vale.
- ✅ **0295 APLICADA nos dois bancos** (o dono rodou na produção em 15/10/2026 e a conferência dele deu o esperado — 21 funções, 0 sem login, 21 logado, 21 chave de serviço; conferido de fora, sem login: `commercial_set_stage` e `accept_negotiation` agora recusam com "permission denied" ANTES de rodar — antes a primeira respondia CLIENT_NOT_FOUND).
- ✅ **0294 APLICADA nos dois bancos** (conferido de fora em 15/10/2026: sem login, `can_decide_purchase` existe e recusa; lido com a chave de serviço, a permissão "Aprovar compra da unidade" está ligada para Financeiro da Franqueadora e Gerente).
- Cache do servidor de teste limpo ao encerrar (AP40).

**15/10/2026 — PC Administrador (core 0.317.0 → 0.318.0, migração 0294)**

- **OC-00102 — QUEM APROVA A COMPRA + AJUDA DE CADA TELA.** Decisões do dono:
  na compra da PRÓPRIA Franqueadora o **Financeiro da Franqueadora** aprova
  (régua `can_decide_purchase`, 0294); nas unidades, o gerente (e o Admin).
  Ajuda = botão **?** na barra de cima, painel com passos
  (`src/lib/ajuda-das-telas.ts`), **escrita só para Compras** — ao escrever
  outra tela, a régua `ajuda-das-telas.test.ts` exige botão, rota e seção do
  manual existentes.
- ⚠️ **Permissão nova na matriz não alcança ninguém sem LINHA no banco**
  (com a matriz gravada, `auth.ts` usa só o que está lá). Migração que cria
  permissão semeia as linhas; e a tela trata a janela até a migração rodar
  (`semAprovarNoBanco` em `purchases-access.ts`).
- ✅ **0294 aplicada nos dois bancos** (conferida de fora em 15/10/2026).
- 🔴 **A 0294 foi ao `main` com o item 4 QUEBRADO** (aspas perdidas ao
  acrescentá-lo por script) e passou pelo `check-migrations`; o treino não
  acusou porque o item 4 entrou lá à parte. Achado relendo antes de colar.
  **Regra: acrescentou algo à migração depois do `migrar:teste`, roda o
  ARQUIVO INTEIRO no treino (duas vezes, transação desfeita) antes de colar.**
- Os roteiros de entrar no treino foram refeitos como UM só
  (`entrar-treino.mjs`, só contas @example.com, recusa a produção).
- Cache do servidor de teste limpo ao encerrar (AP40).

**14/10/2026 (noite, 3ª) — PC Administrador (core 0.316.0 → 0.317.0, sem migração)**

- **OC-00101 — SETA ← NA BARRA DE CIMA** (decisão do dono): volta à tela
  anterior do jeito que estava (`history.back`). Quando acende:
  `src/lib/voltar.ts`. De carona: "← Compras" no Painel da Franqueadora.
- ⚠️ **Escutar a troca de endereço e redesenhar na hora dá erro no React**
  ("useInsertionEffect must not schedule updates"): o Next grava o endereço
  nessa fase. Avisar com `queueMicrotask`. Para conferir erro de console,
  **usar aba NOVA** — o leitor do console não zera ao recarregar.
- **AP46 (BACKLOG):** a barra de cima transborda no celular (antes da seta).
- `check:telas` rodado (a barra de cima vai em toda tela): só sobrou a AP31.
  ⚠️ No servidor recém-ligado, tela que demora a compilar aparece como "não
  respondeu em 60s" — rodar de novo antes de acusar a tela.
- ⚠️ Os roteiros de apoio `cookie-treino.mjs` e `entrega-sessao.mjs` SUMIRAM
  da pasta temporária no meio da sessão (nenhum script do projeto apaga ali;
  suspeita: antivírus, por gerarem sessão). Refazer quando precisar.
- Resíduo no treino: aberturas de ficha pelo Admin de teste (registro normal
  de "Consultou" na Auditoria).
- Cache do servidor de teste limpo ao encerrar (AP40).

**14/10/2026 (noite, 2ª) — PC Administrador (core 0.315.0 → 0.316.0, sem migração)**

- **OC-00100 — LISTAS LONGAS COM BUSCA** (André, Financeiro da Franqueadora).
  Não era defeito nem regra: o `<select>` do navegador não procura. Peça nova
  `ListaComBusca` (`src/components/ui/lista-com-busca.tsx`) em 27 listas de
  12 telas de Compras, Estoque e Financeiro; manual 7.5.
- ⚠️ **A BUSCA DE TEXTO MORA EM `src/lib/busca.ts`** (sem acento, por pedaços
  de palavra). Campo de procurar novo usa ela — a tela de Permissões já usa.
- ⚠️ **O editor de arquivos troca `\u0300` pelo caractere invisível ao
  gravar** (aconteceu duas vezes nesta sessão). Faixa de acento em regex se
  escreve por script com `String.fromCharCode(92)`, e a régua confere.
- ⚠️ **Painel do navegador escondido não desenha quadros:** o que espera "a
  lista terminou de abrir" só acontece na próxima foto. Antes de concluir
  "o foco não chegou", tirar uma foto entre os passos.
- **AP45 (BACKLOG):** listas longas de outros módulos (procedimentos no
  prontuário e nos benefícios, pessoas na Auditoria) seguem sem busca.
- **Não visto na tela:** a lista da requisição de Compras (criaria rascunho
  no treino) e o uso no celular.
- Nenhum resíduo no treino (a janela de conta a pagar foi cancelada).
- Cache do servidor de teste limpo ao encerrar (AP40).

**14/10/2026 (noite) — PC Administrador (core 0.313.0 → 0.314.0, sem migração)**

- **OC-00074 — Jornada mostra se o cliente tem agendamento** (decisão do dono:
  todas as fases, "Sem agendamento" em destaque em todas). Regra em
  `src/lib/agendamento-na-jornada.ts`; leitura que falha não vira "Sem
  agendamento". Manual 6.5: quem agenda depois do fechamento é a Recepção.
- **AP44 (BACKLOG):** a Jornada tem `.limit(1000)` nos clientes — corta em
  silêncio quando a rede crescer.
- **0.315.0:** clicar na marca abre a agenda (no dia; ou para agendar, com o
  cliente já escolhido). Regra em `linkDaAgenda`.
- Resíduo no treino: 1 agendamento de teste (16/12/2026 13:00, Início de
  Tratamento, cliente fictício "Teste do portão 1", observação "TESTE
  OC-00074 (pode ignorar)"). Não apagado.
- Cache do servidor de teste limpo ao encerrar (AP40).

**14/10/2026 (fim da tarde) — PC Administrador (core 0.312.0 → 0.313.0, migração 0293)**

- **OC-00091 — A APRESENTAÇÃO NÃO TERMINAVA.** Iniciar pelo funil pegou o
  agendamento de AMANHÃ (janela ±1 dia), a venda concluída não encerrava, e o
  atendimento aberto de outro dia não aparecia no quadro — o consultor ficava
  preso pela regra "profissional ocupado".
- ⚠️ **Decisões do dono:** venda concluída e follow-up encerram; a regra do
  profissional ocupado CONTINUA.
- ⚠️ **A venda concluída encerra por GATILHO na venda**
  (`commercial_sales_end_presentation`), e encerra mesmo quando quem confirma
  não chamou o cliente — exceção estreita à regra "quem chamou conclui", só
  para apresentação comercial. O gatilho nunca derruba a venda.
- ✅ **0293 APLICADA nos dois bancos** (o dono rodou na produção em 14/10/2026 e a conferência dele deu o esperado — gatilho da venda, função do gatilho, sem login não executa, follow-up encerra e só o que estava acontecendo; conferido de fora, só leitura: a função do gatilho não é chamável pela API; a produção tinha 0 atendimentos em andamento e 0 vendas registradas. Gatilho não aparece pela API — a prova da existência é a consulta do dono).
- **AP43 (BACKLOG):** `commercial_set_stage` executa SEM LOGIN até a guarda
  (antigo — a 0293 não mexeu nas permissões); a guarda recusa (NOT_ALLOWED).
- **Não visto na tela:** o selo "Marcado para…" e a frase nova da recusa.
- Cache do servidor de teste limpo ao encerrar (AP40).

**14/10/2026 (tarde) — PC Administrador (core 0.311.0 → 0.312.0, sem migração)**

- **OC-00094 a OC-00099 (André, Franqueadora/Rede): UMA causa.** A função é de
  consulta; o banco grava só de Admin, Financeiro da Franqueadora e Gerente.
  A matriz ligava ações para a Franqueadora/Rede e três telas abriam o
  formulário que o banco recusava.
- ⚠️ **A TELA SEGUE O BANCO** (decisão do dono): as regras de GRAVAR em
  `finance/access.ts`, `stock-access.ts` e `purchases-access.ts` exigem
  matriz E banco. **VER continua seguindo só a matriz** — não tirar leitura de
  ninguém (quase aconteceu com o Coordenador em Compras; a régua prende).
- ✅ **Feito pelo dono em 14/10/2026** — conferido de fora, só leitura: na produção o André tem a função Financeiro da Franqueadora na RISARTE Franchising (a de Franqueadora/Rede saiu); no treino a cópia chegou igual, com a porta do sistema aberta lá. Na PRODUÇÃO a porta do sistema dele segue fechada (portão de certificação) — assunto à parte.
- ⏳ **Com o dono:** para o André montar lista de compras da Franqueadora,
  ligar "Criar requisição de compra" para o Financeiro da Franqueadora na
  matriz — o banco já aceita.
- ⚠️ **No treino, a conta de teste `rede@example.com` (Franqueadora/Rede)
  tem o NOME do André.** Quem entrar com ela continua só consultando.
- **Não visto na tela:** como Franqueadora/Rede (a conta `rede@example.com`
  está com a porta do sistema FECHADA no treino; não abri sem pedido).
- **AP42 (BACKLOG):** Coordenador e ASB têm na matriz ações de estoque/compras
  que o banco não aceita.
- Cache do servidor de teste limpo ao encerrar (AP40).

**14/10/2026 — PC Administrador (core 0.310.0 → 0.311.0, migração 0292)**

- **OC-00002 — PERMISSÕES: "TORNAR PADRÃO" + TELA NOVA.** O selo "fora do
  padrão" comparava com o padrão de FÁBRICA (código); toda decisão do dono
  ficava marcada para sempre (13 de 27 na produção). Decisões do dono: o
  botão grava o padrão **no banco**; a tela salva por **barra de alterações**.
- ⚠️ **DOIS PADRÕES:** o fixado (`permission_defaults`, 0292) manda; sem ele,
  o de fábrica (`Capability.padrao`). "Tornar padrão" copia o GRAVADO, no
  banco — nunca o rascunho. Padrão não decide acesso de ninguém.
- ⚠️ **No treino a tabela nova tem a trava do espelho** (como a matriz). Achado
  testando — sem ela, o treino divergiria da produção.
- **Manual 13b corrigido de carona:** dizia que permissão não vai para o
  treino; vai desde a 0260.
- ✅ **0292 APLICADA nos dois bancos** (o dono rodou na produção em 14/10/2026 e a conferência dele deu o esperado — tabela, 2 funções, trava do treino, gatilho da auditoria, sem login não executa, 0 padrões; conferido de fora, só leitura: sem login as duas funções recusam e a tabela não entrega nada; com a chave de serviço as colunas existem e há 0 padrões fixados). O "Tornar padrão"
  está liberado na produção; o dono ainda não fixou nenhum.
- **Não visto gravando na tela:** o Salvar e o Tornar padrão num banco que
  aceita — provados por transação desfeita.
- Resíduo no treino: 1 linha em `permission_defaults`
  (`acao.indica.indicar`, igual ao original — mesmo efeito de não ter linha),
  gravada antes da trava; e 2 registros de auditoria do teste.
- Cache do servidor de teste limpo ao encerrar (AP40).

**13/10/2026 (fim da noite, 2ª) — PC Administrador (core 0.309.0 → 0.310.0, sem migração)**

- **OC-00071 — HORAS POSSÍVEIS × HORAS TRABALHADAS** no Planejamento Anual.
  O relato (horário avulso não aumentava a estimativa) **não era defeito**: a
  tela dizia por escrito que avulso não entrava. O dono pediu a mudança e
  mais. Agora: avulso aumenta, fechamento de agenda reduz, e há o quadro com
  horas de funcionamento, de cadeira, agendadas, trabalhadas, ocupação, passo
  a passo, mês a mês e filtro De/Até.
- ⚠️ **AS TRÊS DECISÕES DO DONO** (não mudar sem ele): duas contas
  (funcionamento e cadeira; ocupação sobre a de cadeira); **hora trabalhada =
  tempo MARCADO do atendimento concluído**, nunca o relógio chamou→concluiu;
  fechamento de unidade e de sala reduzem, o de profissional não.
- ⚠️ **A CONTA MORA EM `src/lib/horas-da-agenda.ts`** (pura, em minutos). A
  página não calcula. Leitura que falha **não vira zero** — a tela recusa.
- **Achados corrigidos de carona:** período planejado pela REDE não era
  descontado; "hoje" e o ano vinham do relógio da máquina.
- **AP41 (BACKLOG, não mexi):** num dia fechado por período planejado, com
  horário avulso por cima, a AGENDA aceita o horário normal inteiro; a regra
  escrita (AJ7) diz que vale só a janela do avulso. A conta nova segue a regra
  escrita. Decisão do dono.
- **Não visto na tela:** período da rede, feriado fechado, fechamento de
  profissional, a falha de leitura e a tela como Gerente (a leitura dele foi
  conferida no banco).
- Resíduo no treino: **2 fechamentos de agenda de teste** na "Risarte Unidade
  Teste", em 27/12/2026 (02h–04h unidade toda; 10h–11h Sala 1), com a
  observação "TESTE OC-00071 (pode ignorar)". Não apagados.
- Cache do servidor de teste limpo ao encerrar (AP40).

**13/10/2026 (madrugada) — PC Administrador (core 0.308.0 → 0.309.0, migração 0291)**

- **QUEM ESTÁ ONLINE (pedido do dono).** O sistema já sabia (a bolinha do
  Chat), mas só mostrava no Chat. Agora: **antena com número na barra de
  cima** (janela com online e ausentes) e a aba **Online agora** na Auditoria
  (online, ausente, saiu, não entrou hoje), mais o quadro **Agora** no Painel
  de uso. Decisões do dono: **só o Admin Master vê**; mostra hora de entrada,
  última atividade, **em qual tela** e quem não entrou hoje.
- ⚠️ **"EM QUAL TELA" É O MÓDULO, NUNCA O ENDEREÇO** (`telaParaRegistrar` +
  `access_session_screen`): o identificador do paciente não sai do navegador,
  e o banco recusa número e maiúscula. Quem olha a ficha de quem continua na
  trilha de ações, com as regras dela. Ao mexer nisso, não alargar.
- ⚠️ **A régua de "online" mora no BANCO** (`presence_now`: 5 minutos, acesso
  de hoje, dentro do tempo de inatividade). A tela não recalcula. O Chat tem a
  régua dele (Realtime, conta o mouse) — as duas podem discordar por
  instantes, e o manual diz isso.
- ⚠️ **TELA NOVA PRECISA DE NOME:** pasta nova em `src/app/(app)` (ou em
  `admin/`) sem entrada em `NOME_DA_TELA` reprova o portão — senão apareceria
  como "Outra tela" na lista. Vale para os três projetos (o arquivo é do core,
  mudança aditiva).
- ✅ **0291 APLICADA nos dois bancos** (o dono rodou na produção em 13/10/2026 e a conferência dele deu o esperado; conferido de fora, só leitura: sem login as três funções recusam; a chave de serviço — que não é Admin Master — recebe lista vazia e resumo nulo; as duas colunas existem; e a única tela já gravada lá é só o módulo). Na hora da
  conferência a produção tinha 5 acessos no dia, 1 já com a tela informada.
- A 0291 foi **corrigida depois de aplicada no treino** (lista de colunas
  explícita, e a tela passou a ser a informada por último); reapliquei no
  treino. O arquivo que vai ao dono é o corrigido.
- **Não visto:** a lista com mais de 1.000 pessoas (a leitura em páginas está
  presa por régua).
- Resíduo no treino: acessos e telas das contas de teste (Admin e Recepção)
  desta sessão — registro normal de uso.
- Cache do servidor de teste limpo ao encerrar (AP40).

**13/10/2026 (fim da noite) — PC Administrador (Empresarial 0.78.0 → 0.79.0, migração 1028)**

- **AP39 — NO FUNIL, SÓ É GANHO COM OS DOIS SELOS; SÓ IMPLANTA COM A
  CONFERÊNCIA** (dono: "opção A"). Dois botões do cartão passavam por fora
  ("Fechar (ganho) → criar empresa" e "Mover para Implantação") e saíram.
  ⚠️ **A REGRA MORA NO BANCO** (`guard_lead_closing`, 1028): confere a
  PASSAGEM de fase — o que já estava lá não é tocado. Ao mexer em fase do
  funil, lembrar que ganho e implantação não se escolhem: chegam pelos selos
  e pela conferência.
- **AP36 — EMPRESA PERDIDA PODE SER REABERTA** na mesma ficha (dono: "opção
  A"). Aba Fechamento → *Reabrir negociação*, com fase e motivo. O painel
  passou a contar a perda pelo HISTÓRICO de fases, para reabrir não apagar a
  perda da estatística. Quem pode reabrir = quem pode marcar como perdido (o
  dono não restringiu).
- AP37 de carona: o cartão mostra o aviso "criada, mas não copiei…".
- ✅ **1028 APLICADA nos dois bancos** (o dono rodou na produção em
  13/10/2026 e a conferência dele deu o esperado: gatilho ligado, depois do
  `close_when_sealed`). ⚠️ **De fora NÃO dá para ver gatilho** — a prova da
  ordem é a consulta do dono. O que conferi de fora, só leitura: a função não
  é chamável pela API (nem sem login, nem com a chave de serviço) e o funil
  da produção segue com 0 empresas. Não tentei gravar para "testar" a recusa:
  isso não se faz na produção — a recusa está provada no treino.
- **Não visto na tela:** o link "Reabrir pela ficha" no cartão de uma perdida.
- Resíduo no treino: "ZZZ Fechamento do agente" foi reaberta, selada, virou
  **empresa cadastrada** ("ZZZ Fechamento LTDA", CNPJ fictício trocado para
  99.888.777/0003-28) e está em Implantação, com conferência de teste.
- Cache do servidor de teste limpo ao encerrar (AP40).

**13/10/2026 (noite) — PC Administrador (Empresarial 0.77.0 → 0.78.0, migração 1027)**

- **O CONTRATO DENTRO DO SISTEMA** (o que faltava do OC-00083). O dono mandou
  o modelo "Contrato PRE+ 2026". O texto mora no BANCO (`contract_templates`,
  cascata rede → empresa), editável em Configurações → Contrato; o sistema
  preenche a empresa, os valores da cláusula 4ª, o vencimento, as cidades e a
  data, e monta o **Anexo I** com os benefícios da proposta. Botão **Ver o
  contrato** ao lado de *Ver a proposta*. Bloco M do `FUNIL-COMERCIAL.md`;
  manual do Empresarial §6.10 e §15.
- ⚠️ **O SISTEMA NÃO ESCREVE CLÁUSULA.** Onde a proposta não cabe no modelo
  (valor fixo, preço por quantidade), ele AVISA e o consultor personaliza o
  texto daquela empresa. Ao mexer nisso, manter: preencher lacuna sim, redigir
  não.
- ⚠️ **DADO PESSOAL FORA DO REPOSITÓRIO** (decisão do dono): nome, RG e CPF de
  quem assina pela Risarte ficam só em `contract_settings`, digitados na
  tela. O modelo veio preenchido com um cliente real — só o texto entrou, e há
  teste que reprova CPF, RG ou nome de pessoa no texto semeado.
- **Corrigido no texto, a pedido do dono:** "EMPRESARIA" → "EMPRESARIAL";
  "DÉCIMA SE PRIMEIRA GUNDA" → "DÉCIMA PRIMEIRA"; e a cláusula 1ª passou a
  apontar para a 8ª (rol) e a 10ª (coparticipação). Pontos de conteúdo para o
  jurídico dele estão no BACKLOG.
- ✅ **1027 APLICADA nos dois bancos** (o dono rodou na produção em
  13/10/2026: o gatilho da auditoria foi preso nas 2 tabelas novas; conferido
  de fora, só leitura: sem login as duas tabelas recusam; 1 linha de dados da
  Risarte, com o representante EM BRANCO; 1 modelo da rede com 15 cláusulas, o
  texto corrigido, os campos no lugar e nenhum CPF; as 3 colunas novas
  existem). A produção ainda não tem nenhum levantamento no funil.
- ⏳ **Depois da 1027, o dono digita os dados de quem assina pela Risarte nos
  DOIS ambientes.** No treino ficou um representante fictício.
- **Não visto:** o contrato impresso/PDF; o caso de valor fixo na tela.
- ⚠️ **AP40: o disco C: deste PC ENCHEU no meio da sessão** — `.next-test`
  (cache do servidor de teste local) estava com 18 GB. Limpei com
  `node scripts/limpar-build-teste.mjs`; voltou a 26 GB livres. **Ao encerrar
  uma sessão que subiu o servidor de teste, rodar esse script.** O `.next`
  do servidor de desenvolvimento tem 6 GB e não foi tocado.
- Resíduo no treino: "ZZZ Fechamento do agente" ganhou endereço fictício,
  nacionalidade e vencimento dia 10; a trilha de alterações guarda um texto
  personalizado de teste que foi criado e desfeito.

**13/10/2026 (tarde) — PC Administrador (Empresarial 0.76.0 → 0.77.0, sem migração)**

- **OC-00083, 3ª volta — a ficha da empresa no funil.** A foto do relato era
  da tela antiga. O que continuava verdade e foi corrigido: a aba
  **Fechamento abria em branco** antes do ganho e para a perdida; **dados e
  histórico só existiam na janelinha do card**; o cabeçalho dizia uma frase
  fixa. Agora: **Dados da empresa** + **Próximo passo** no alto, aba
  Fechamento com conteúdo em toda fase, e a sexta aba, **Histórico** (linha do
  tempo única + registrar tentativa, reunião e anotação). Bloco L do
  `FUNIL-COMERCIAL.md`; manual do Empresarial §4, §5 e §7.
- 🔴 **Achado varrendo as fases:** o selo da aba Fechamento desmentia a fase
  (ganha SEM cadastro aparecia "implantação concluída"). Passou a olhar a fase.
- ✅ O contrato dentro do sistema foi feito no mesmo dia (bloco acima).
- ✅ AP39, AP36 e AP37 resolvidos no mesmo dia (bloco da 1028, acima). AP38
  (sugestão da proposta não se atualiza) segue no BACKLOG.
- **Não visto na tela:** *Criar empresa* na aba Fechamento e *Marcar reunião*
  na aba Histórico.
- Resíduo no treino: "ZZZ Fechamento do agente" ficou **perdida**, com contato
  e telefone fictícios, uma anotação e uma tentativa de teste.
- ✅ **A 0290 (painel de uso) foi aplicada na PRODUÇÃO no mesmo dia** (bloco
  abaixo).

**13/10/2026 — PC Administrador (core 0.307.0 → 0.308.0, migração 0290)**

- **AUDITORIA — PAINEL DE USO + FILTROS (pedido do dono):** a Auditoria abre
  agora na aba **Painel de uso**: números do período, pontos de atenção (o
  painel aponta sozinho quem nunca entrou, quem sumiu, quem caiu de uso, quem
  deixa a tela aberta, quem exportou/excluiu muito), pessoas por dia, os seis
  rankings pedidos, uso por função e por unidade, e o mapa dia × hora. Filtros
  por **unidade** e **função** no painel e no Relatório de atividade (e na
  planilha). "Da unidade" = quem TEM FUNÇÃO nela.
- 🔴 **AP34 (defeito meu, etapas 1 e 3):** o tempo "parado" contava até a hora
  em que o sistema ENCERROU o acesso — que só acontece no próximo clique. 91
  horas num caso do treino. Agora conta até a última atividade, ou até o Sair.
- 🔴 **AP35 (defeito meu, etapa 3):** a API corta em 1.000 linhas (medido) e
  o relatório somava o que vinha. Agora lê em páginas. ⚠️ Suspeita registrada:
  outras listagens grandes do sistema podem ter o mesmo corte — não procurei.
- ✅ **0290 APLICADA nos dois bancos** (o dono rodou na produção em 13/10/2026 e a conferência dele deu o esperado; conferido de fora, só leitura: sem login as cinco funções recusam, a chave de serviço — que não é Admin Master — recebe vazio, e só existe UMA versão do relatório). O Painel de uso, os
  filtros por unidade e função e a conta nova do tempo valem na produção.
- **Medido de novo na produção em 13/10 (só contagens):** a trilha de
  alterações segue com os mesmos 13 lançamentos de 09/10; nos últimos 7 dias
  houve acesso em 2 dias (09/10 e 13/10). **Ainda não dá para dizer quanto a
  trilha cresce por dia** — medir quando a equipe estiver usando.
- ⚠️ A 0290 foi **corrigida depois de aplicada no treino e antes de ir para a
  produção** (a regra do tempo); reapliquei as funções no treino à mão. O
  arquivo que vai ao dono é o corrigido.
- Resíduo no treino: 5 exportações de teste na trilha (Admin de teste).
- ⏰ **Supabase Pro vence em 30/10/2026.**

**09/10/2026 (noite) — PC Administrador (core 0.306.1 → 0.307.0, migração 0289)**

- **AUDITORIA, etapa 3 de 3 — COMPLETA.** Aba **Relatório de atividade**: por
  pessoa (dias com acesso, em uso, parado, quedas por inatividade, ações,
  inclusões/alterações/exclusões) e dia a dia; lista de quem tem acesso e não
  entrou; planilha Excel pelo gerador do Financeiro. A conta mora no banco
  (`audit_activity_report`) e bate, linha por linha, com a conta feita à mão.
- ✅ **0289 APLICADA nos dois bancos** (o dono rodou na produção em
  13/10/2026 e a conferência dele deu o esperado; conferido de fora, só
  leitura: sem login a função recusa, e a chave de serviço — que não é Admin
  Master — recebe vazio). **A AUDITORIA PEDIDA EM 09/10 ESTÁ INTEIRA NO AR.**
- **Medido na produção em 13/10 (só contagens):** a trilha de alterações tem
  13 lançamentos, todos do dia 09/10 e todos feitos por pessoa. A produção
  quase não é usada ainda — **não dá para dizer quanto a trilha cresce por
  dia**. Medir de novo quando a equipe estiver usando.
- Filtro por unidade/função: feito na 0290 (bloco acima). **Ainda por fazer:**
  medir quanto a trilha de alterações cresce por dia na produção.
- Resíduo no treino: 2 exportações de teste na trilha (Admin de teste).

**09/10/2026 (fim da tarde) — PC Administrador (core 0.305.0 → 0.306.0, migração 0288)**

- **AUDITORIA, etapa 2 de 3 (pedido do dono):** o BANCO registra sozinho cada
  inclusão, alteração e exclusão, com o antes e o depois, em 195 tabelas dos
  três schemas (`audit_changes`, gatilho `audit_capture`). 44 tabelas ficam
  de fora, cada uma com o motivo gravado (`audit_excluded_tables`). A tela de
  Auditoria virou quatro abas: Alterações, Ações, Acessos e O dia de uma
  pessoa. 205 tipos de registro e 195 tabelas com nome em português.
- ⚠️ **Decisões do dono que mudam regra antiga** (§6): a trilha de alterações
  guarda TUDO, inclusive dado pessoal; só o Admin Master lê; cliente
  anonimizado mantém o histórico; o chat fica de fora.
- ⚠️ **Regra nova para os três projetos** (§0, regra 7): migração que cria
  tabela termina com `select public.audit_attach_all();`.
- ✅ **0288 APLICADA nos dois bancos** (o dono rodou na produção em
  09/10/2026: o gatilho foi preso em 195 tabelas; conferido de fora, sem
  login: as funções recusam e ninguém lê a trilha nem a lista de exclusões;
  44 declaradas fora). A trilha estava vazia na conferência — o primeiro
  lançamento nasce na primeira alteração de alguém.
- Etapa 3 entregue no mesmo dia (bloco acima).
- **AP32 (BACKLOG):** 3 conferências do `npm run test:indica` falham no treino,
  com e sem o gatilho da auditoria — é da sessão do Indica.
- Resíduo no treino: 5 lançamentos de exemplo na auditoria, em nome do Admin
  de teste (a trilha não se apaga; os dados em si voltaram ao que eram).
- ✅ **AP30 respondido pelo dono (09/10): é DE PROPÓSITO** — Dentista e
  Planner não precisam ver o Estoque. O padrão do código, a régua da varredura
  e o manual diziam o contrário e foram corrigidos (0.306.1); nada mudou na
  tela. Sobra uma linha gravada na matriz dos dois bancos dando ao Dentista o
  "consumo avulso" — sem a tela, não tem efeito; o dono pode desmarcar em
  Administração → Permissões.
- ✅ **Supabase Pro RENOVADO até 30/10/2026** (dono, 09/10). ⏰ Lembrar de
  novo perto dessa data.

**09/10/2026 — PC Administrador (core 0.304.0 → 0.305.0, migração 0287)**

- **AUDITORIA, etapa 1 de 3 (pedido do dono):** registro de cada acesso
  (`access_sessions`), desconexão por inatividade (60 min padrão, por função
  em Administração → Sessão e inatividade; a mais curta vence), login por dia,
  gravação em andamento protege, navegador e IP, quadro Acessos na Auditoria.
  Quem decide é o BANCO (`access_session_check`, no lote de
  `getSessionContext`); sem resposta, ninguém é trancado.
- 🔴 **AP29:** o login NUNCA era gravado na trilha (0 em 283 na produção) —
  `void recordLogin()` perdia a corrida para a navegação. Corrigido.
- ✅ **0287 APLICADA nos dois bancos** (o dono rodou na produção em
  09/10/2026; conferido de fora: as 5 funções recusam sem login, ninguém lê
  acesso sem estar logado, padrão em 60 min). A regra já vale para todos.
- ⏳ **Não visto na tela:** o login pelo formulário (o agente não digita senha
  em serviço de autenticação externo), a gravação protegendo e duas abas.
  Conferir o "Entrou no sistema" no primeiro login depois de publicar.
- Etapa 2 entregue no mesmo dia (bloco acima); etapa 3 a fazer.
- AP30: respondido no mesmo dia — é de propósito (bloco acima).
- **AP31:** rota do Indica respondendo 404 ao Admin na varredura (da outra
  sessão).

**07/10/2026 (fim da tarde) — PC Administrador (core 0.303.0 → 0.304.0, migração 0286)**

- **OC-00087 + 🔴 AP28:** o diagnóstico do relato (sequência só na opção
  principal) achou defeito maior — `ensure_treatment_sessions` gerava as
  sessões da opção PRINCIPAL mesmo com a venda aceita na alternativa, e gerava
  também o que ficou de fora na compra parcial. **0286** corrige as duas
  geradoras (a negociação aceita manda no plano, na opção e nos itens).
  Cockpit: uma aba por opção em "Atendimentos e sequência" e o campo "Tempo do
  atendimento" (total repartido entre as sessões).
- ✅ **0286 APLICADA nos dois bancos** (o dono rodou na produção em
  07/10/2026 e conferiu que as duas funções leem a venda; de fora, sem login,
  as duas recusam — antes da 0286 elas respondiam a quem não estava logado).
- Produção sem nenhuma negociação em 07/10 → ninguém afetado. No treino, 1
  venda segue com 8 sessões de outra opção (não corrigidas; BACKLOG AP28).
- Resíduo no treino: o plano de teste do "Teste do portão 1" ganhou 3 e 2
  sessões e um atendimento conjunto de 90 min na alternativa.
- ⚠️ **A pasta temporária de apoio foi limpa pelo sistema** no meio da sessão:
  sumiram os roteiros antigos, inclusive o retrato "antes" das portas das 6
  contas de teste (AP6). O estado anterior era FECHADO para as seis.

**07/10/2026 (tarde) — PC Administrador (Empresarial 0.75.0 → 0.76.0, migração 1026)**

- **OC-00090: a mensalidade por titular cobra pelo CONTRATADO** (regra nova do
  dono — antes somava só os cadastrados e recusava sem nenhum). O limite
  (contrato + termos aceitos) é o mínimo, com a faixa dele; dependentes só os
  cadastrados. Vale no boleto, no lote e nas telas (ficha, relatório, painel,
  proposta) — régua em `mensalidade-pelo-contratado.test.ts`.
- Alerta "Faltam cadastros" no alto da ficha (só gestores do programa) e na
  prévia; **aviso no sino** dos gestores, um por empresa por mês
  (`empresarial.avisar_cadastros_pendentes`, **1026**).
- ✅ **1026 APLICADA nos dois bancos** (o dono rodou na produção em
  07/10/2026; conferido de fora, sem login: a função existe e recusa).
- ⏳ A geração com aviso foi provada por transação desfeita e pela API, **não
  clicada na tela** (a empresa do relato, Cedássio, é teste de outra pessoa).
- **AP27 (BACKLOG):** ao ligar o ASAAS, o boleto sai num passo próprio
  ("Emitir boleto") — gerar a cobrança não emite sozinho (decisão do dono).

**07/10/2026 — PC Administrador (core 0.302.0 → 0.303.0, sem migração)**

- **OC-00092 (dúvida "onde aprovo o plano?") + AP25 + AP26:** para quem
  avalia um plano aguardando aprovação, as opções já vêm ABERTAS (decisão do
  dono); o cartão do Início do Coordenador apontava para `/planejamento`
  (só Planner) e agora abre `/planos` no filtro; "Ficha"/"Ver plano" de
  `/planos` abrem na aba Plano; manual 6.2 com o passo a passo.
- ⏳ **E2E ajustado e NÃO rodado** (`03-planejamento.spec.ts`, `apoio.ts`):
  a suíte limpa o treino. Rodar na próxima vez que o treino puder ser limpo.
- Resíduo no treino: **plano de teste "aguardando aprovação"** no cliente
  fictício "Teste do portão 1 (pode ignorar)", Risarte Unidade Teste —
  deixado de propósito para o dono ver a tela. Não apagado.
- O repositório segue sendo encontrado no ramo `feature/indica-mais-risos`;
  entreguei no `main` e devolvi ao ramo do Indica.

**05/10/2026 — PC Administrador (core 0.301.0 → 0.302.0, sem migração)**

- **OC-00093:** o "Abrir" de aviso NÃO LIDO só marcava como lido (o
  `router.refresh()` cancelava a ida). Corrigido; e o aviso de cliente abre
  o prontuário na aba do assunto (mapa por título em `notifications.ts`,
  aprovado pelo dono; `?aba=` no prontuário). Visto na tela no treino.
- ⚠️ **Achei o repositório no ramo `feature/indica-mais-risos`** (mesmo
  ponto do `main`, 11b409c). Entreguei no `main` e devolvi o repositório ao
  ramo do Indica, como estava.
- Resíduo de teste no treino: 4 avisos "TESTE OC-00093" na conta
  `admin@example.com` (todos lidos). Não apagados.
- ⏰ **Supabase Pro venceu em 29/09/2026** — confirmar com o dono se renovou.

**26/09/2026 — PC Administrador (core 0.286.0 → 0.296.1; Empresarial 0.69.0 → 0.73.0; migrações 0273–0282, 1022 e 1023)**

**Tudo no ar e aplicado nos dois bancos** (0273, 0274 e 0275 conferidas lendo
a produção, com trava que EXIGE ser produção).

- **Portão de certificação — Etapas 1b e 2 completas.**
  - **0273: a missão só conta depois do CLIQUE da pessoa** (`started_at`).
    Antes disso ela usa o treino à vontade. Turmas por unidade, com prévia
    antes de convocar; certificado é tabela (fato histórico).
    ⚠️ **Defeito grave achado por sonda antes de ir ao ar (AP9):** a guarda
    "só a própria pessoa inicia" usava `<>` com `auth.uid()` — nulo, a trava
    ficava ABERTA para quem não estava logado. Virou Regra 5 do
    `check-migrations`.
  - **0274: reciclagem com três políticas** — mantém o acesso, prazo (suspende
    de madrugada quem não concluiu) ou suspende agora. Quatro travas provadas no
    treino: só suspende quem tinha acesso; só restaura o que ele suspendeu;
    encerrar a turma devolve o acesso; só reciclagem suspende.
  - **Etapa 2 (0.290.0): a medição.** Cada indicador ganhou `quando` — a data
    da AÇÃO, não da criação. O banco desmentiu 3 origens do catálogo, e a régua
    `check:indicadores` passou a conferir autor + data (instante) + filtros.
    **Missão com critério sem medida NÃO está cumprida.**
  - **0275 (0.291.0): turma para várias unidades ou a rede toda.** Uma turma,
    uma lista de unidades; liberação coletiva continua POR UNIDADE; uma turma
    aberta por unidade; matrícula por (pessoa, FUNÇÃO). Progresso medido ao
    abrir cada unidade (a rede toda seriam dezenas de milhares de consultas).
    ⚠️ Fechou uma brecha da 0273: `training_candidates` listava a equipe de
    qualquer unidade para qualquer usuário logado. ⚠️ Com a 0275, turma →
    clínica tem TRÊS caminhos: `clinics(name)` na turma dá **PGRST201** —
    provado na produção. Não usar esse embed; o nome vem da lista carregada.
  - **Relatos, sugestões e chat** viraram indicadores das 13 funções (82 no
    total) — o chat por decisão do dono, com o aviso "meta 1" preso por teste.
- ⚠️ **A dependência das chaves do treino NÃO existia.** Eu tinha registrado que
  a Etapa 2 dependia de copiar `TREINO_*` para o `.env.local`. Não depende: em
  produção elas estão na Vercel, e para testar aqui basta pôr os valores do
  `.env.test.local` em `process.env` **dentro do processo do teste** — nenhum
  arquivo é escrito. Ver as sondas descritas no commit da 0.290.0.

**Pendências (nesta ordem):**

1. ⏰ **Supabase Pro vence em 29/09/2026** — três dias.
2. **Etapa 3 do portão.** ✅ **Parte 1 (0276, core 0.293.0): a tranca virou
   POR UNIDADE E FUNÇÃO** — regra do dono: uma missão por função vale em todas
   as unidades dessa função; funções diferentes liberam cada uma sozinha;
   coletiva segura a unidade até o grupo cumprir. Quem já trabalhava ficou
   *anterior ao portão*; Admin libera sem missão (motivo obrigatório). Provado
   no treino (sonda com todos os motivos + login real no servidor local).
   ✅ **0276 APLICADA na produção** (26/09): 1 linha *anterior* — correto: das 7
   pessoas com função, 6 nunca tiveram a porta registrada (modo portal desde a
   0259), e a outra é Admin. Ninguém perdeu acesso (conferido lendo o banco). ⚠️ No treino, 16 dos 24
   Risartanos têm a porta "sistema" FECHADA no banco de treino — por isso a
   varredura `check:telas` apontada para o treino deixa gerente, financeiro e
   comprador no modo portal (3 falhas que NÃO são da 0276; conferido).
   ✅ **AP14 corrigido (0277, core 0.294.0): a tranca vale no BANCO.** A
   tabela virou `user_clinic_roles_all` e uma VIEW com o nome antigo esconde de
   quem chama as funções das unidades fechadas — as 70 funções e ~130 regras
   obedecem sem reescrita. Provado antes/depois no treino; varredura das telas
   idêntica à anterior. ⚠️ **Estrutura (gatilho/política/coluna) vai em
   `user_clinic_roles_all`** — Regra 6 do `check-migrations`. ✅ **0277
   APLICADA na produção** (7 fechadas = as 6 pessoas no portal; conferido).
   🔴 **A conferência achou o AP15:** `revoke ... from public` NÃO deixa função
   privada no Supabase — 19 funções "privadas" executavam SEM LOGIN (provado
   na produção: fluxo de caixa). As 3 da 0277 fechadas na **0278 (APLICADA na
   produção; conferido de fora, sem login: recusa)**; ✅ **as 16 antigas (+ restore_training_access) fechadas na
   0279 (AP15) — APLICADA na produção** (conferido de fora, sem login: recusam). 🔴 **AP16 (BACKLOG), achado medindo o
   AP15:** 107 funções SEM guarda executam sem login; confirmado na produção
   que `find_client_basic_by_cpf` (paciente por CPF — LGPD) e
   `empresarial.settle_billing` (dá baixa) executam. ✅ **Corrigido em grande
   parte na 0280 (APLICADA na produção; conferido sem login)** — 63 internas fechadas, 42 só para
   logado, 5 guardas. Pendente (BACKLOG AP16): fechar os schemas para anon
   depende do ACADEMY — o dono rodou a consulta: nenhuma política do
   `treinamento` para anon, mas 5 funções dele leem `public`
   (`current_user_roles/clinics/scope_all`, `get_ranking`, `get_feed`).
   ⚠️ **AP17 (suspeita):** se leem `user_clinic_roles`, a janela da 0277
   pode estar escondendo a função dos novatos no Academy. Registrado para
   RETOMAR (ordem do dono): BACKLOG, seção *ACADEMY — PARA RETOMAR*, com a
   consulta pronta. O dono escolheu seguir para a parte 2 antes. Regra 8 do check-migrations
   (`$$` ímpar) nasceu de um erro pego na revisão da 0280.
   Regra 7 do `check-migrations` impede a repetição.
   ✅ **PARTE 2 (0281, core 0.295.0): a liberação.** Missão cumprida →
   certificado (automático, ou após o Aprovar do Admin; reciclagem sempre
   automática e devolve o acesso suspenso); porta fechada à mão não reabre
   (avisa o Admin). **Só o SERVIDOR registra** (`record_training_completion`
   só para service_role), depois de medir; conferência no Início, no botão
   "Conferir minha missão" e ao abrir a unidade na turma. Fila "Aguardando a
   sua aprovação" com os números. Provado no treino (16 checagens + API).
   ✅ **0281 APLICADA na produção** (conferido de fora: só a chave de serviço
   registra; sem login recusa; aprovar exige Admin).
   ✅ **TESTE PONTA A PONTA feito (26/09, pedido do dono)** no treino como
   produção, com `recepcao@example.com`: convocação → missão → cadastros →
   aprovação → sistema real aberto. 🔴 Achou: a 0281 criou 2ª ligação
   matrícula→profiles e a fila de aprovação + a lista de turmas QUEBRARAM NA
   PRODUÇÃO (PGRST201) — corrigido no código (0.295.1) + régua
   `embed-ambiguo.test.ts`; e dois textos enganosos no Início. Treino
   devolvido ao estado anterior (ficaram a turma TR-00013 encerrada, 2
   clientes de teste e o certificado da usuária de teste).
   ✅ **AP16 item 3 (0282, core 0.296.0): guarda de UNIDADE** em 17 funções de
   custo/repasse/estoque/financeiro — original vira `_X_raw`, a porta confere
   `can_read_clinic_data`. Provado no treino (recepção barrada na outra
   unidade). ✅ **0282 APLICADA na produção** (27/09; conferido: portas e
   originais no lugar, nada responde sem login).
   ✅ **AP13 (Empresarial 0.73.0 + core 0.296.1, sem migração, 27/09):**
   cobrança, termo de inclusão e proposta deixaram de calcular com o preço
   padrão / sem dependentes / com zero quando uma leitura falha — recusam
   com "não foi possível conferir". A régua do AP11 passou a pegar a
   contagem RENOMEADA (`{ count: x }` … `x ?? 0`). Conferido na tela: prévia
   = ficha (R$ 219,50).
   ✅ **AP18 (1024, Empresarial 0.74.0, 27/09):** o valor fixo da proposta
   passou a existir na EMPRESA e manda na mensalidade (fixo + termos
   aceitos), no termo (novo fixo − o que paga hoje) e nas 6 telas; a
   implantação é sempre o 1º pagamento (campos da proposta saíram; colunas
   ficam no banco). Conferido no treino, logado. ✅ **1024 APLICADA na
   produção** (27/09; conferido pela API: 1 empresa, por titular, sem fixo).
   ✅ **AP19 (1025, Empresarial 0.75.0, 27/09):** termo por titular pela
   tabela (= boleto); "novo valor fixo" só no valor fixo; cartão "Acordo de
   cobrança" em Dados Gerais. ✅ **1025 APLICADA na produção** (27/09; conferido pela API, inclusive o filtro das somas do fixo).
   ✅ **OC-00080 (0283, core 0.297.0, 27/09):** os avisos "Iniciar
   tratamento" e "Agendar apresentação" só saem quando o agendamento existe
   (gatilho em appointments); tela com "Abrir agenda" e "Fechar" (adia 15
   min). **0283 APLICADA na produção** (conferido: gatilho no lugar; a função
   não responde sem login).
   ✅ **AP6/AP8/AP10 (core 0.298.1, 27/09):** a varredura de telas deixou de
   medir o modo portal e passou a usar SÓ contas de teste (`@example.com`)
   onde existem — ela usava uma recepcionista e um dentista REAIS do treino
   (5 registros "view" de auditoria no nome deles, não apagados). Com o OK do
   dono, a porta "sistema" das 6 contas de teste foi ABERTA no treino:
   **8 perfis, 856 aberturas, 0 falha**. Tipos dos testes viraram portão
   (`npm run tipos`, dentro do `verificar` e na CI).
   ✅ **OC-00076 + Comercial (0.299.0/0.299.1):** botão Confirmar e selo
   "Confirmado" no Atendimento; selo também no cartão "A apresentar".
   ✅ **OC-00085/86 (0285, core 0.300.0, 27/09):** a avaliação termina no
   cockpit; o envio para a gravação e ESPERA o áudio ser salvo; quem envia
   encerra; "Encerrar sem enviar" com motivo. **0285 APLICADA na produção**
   (conferido: sem login, as duas funções recusam). ⏳ Falta ver o áudio de
   verdade (o navegador de teste bloqueia o microfone).
   ✅ **AP20 + item 10 (0284, core 0.298.0, 27/09):** início cancelado ou
   falta traz o aviso de volta com o motivo; uma linha por cliente na janela.
   **0284 APLICADA na produção** (conferido: gatilho no lugar; a função não
   responde sem login). AP19 (3 pontas soltas) no BACKLOG.
   (Registro antigo do plano da parte 2, já entregue:) gravar o certificado (só pelo servidor,
   depois de medir), fila de aprovação, coletiva, e a reciclagem devolvendo o
   acesso sozinha (decisão do dono). Porta fechada pelo Admin NÃO reabre ao
   cumprir: grava o certificado e avisa o Admin (decisão do dono).
3. **O dono definir as metas** em Administração → Certificação (seguem em
   branco na produção) e **conferir `risarte-training-deadlines`** em
   Database → Cron Jobs da produção (não dá para ler pela API).
4. ✅ **AP11 FECHADO (0.292.0 / Empresarial 0.70.0).** 16 travas deixavam
   passar quando a contagem falhava — a pior, a **mensalidade em dobro** do
   Empresarial, que não tem trava no banco. Peça única `src/lib/contagem.ts`
   e régua `contagem-nas-acoes.test.ts`. ⚠️ A busca achou 9; os outros 7
   estavam escritos de outro jeito (ler só o `data` e ignorar o `error`),
   um deles escrito por mim na 1021. **Ficou de fora, declarado:** as telas —
   o Início ainda diria "0 esperando" se a contagem falhasse.
4b. ✅ **Trava da mensalidade no banco (1022, Empresarial 0.71.0) — APLICADA
   na produção** (o dono conferiu o índice `adhesion_billing_mensalidade_unica`
   em 26/09). Chave (empresa, DOCUMENTO, mês): empresa
   com dois CNPJs recebe dois boletos. A tela da empresa não tinha trava
   nenhuma — dois cliques cobravam em dobro.
4c. ✅ **AP12 corrigido (1023, Empresarial 0.72.0) — 1023 APLICADA nos dois
   bancos** (conferido lendo a produção em 26/09, com régua que acusa coluna
   inexistente). Cada titular paga implantação uma vez: cada
   implantação guarda quantos cobriu (`holders_covered`) e a próxima cobra só
   a diferença, pela faixa da empresa inteira. Provado no treino como usuário
   logado (80 → clique duplo recusado → 2ª etapa cobra 20). Implantação
   antiga fica nula ("não sei") e a tela avisa.
4d. **AP13 (BACKLOG):** preço da adesão lido sem conferir o erro — cai no
   preço padrão do código em silêncio. Mexe na mensalidade também.
5. **AP10** (BACKLOG): o `check-migrations` não pega erro de tipo que o
   Postgres pega (`= any()` sobre enum).
6. Cadastrar os benefícios PADRÃO DA REDE na produção (segue VAZIO).
7. AP8, Notebook (§4 de `docs/DOIS-PCS.md`), teste final do LOTE B.

**25/09/2026 (tarde/noite) — PC Administrador (core 0.283.0 → 0.286.0; migrações 0271 e 0272)**

**Tudo no ar e APLICADO NOS DOIS BANCOS** — conferido lendo a produção (só
leitura, com trava que EXIGE ser produção), não pelo painel.

- **OC-00088 encerrado.** A causa não foi o sistema: foi a suíte de testes,
  rodada por mim, que limpava o movimento do TREINO. Hoje a limpeza exige
  `RISARTE_APAGAR_TREINO=sim` e mostra quantas linhas perderia.
  **Decisão do dono: NÃO recuperar** — *"por ser um ambiente teste"*. A
  restauração voltaria o banco inteiro, inclusive o que foi feito de bom
  depois.
- **A garantia inteira virou portão (0.284.0).** Inventário de TODO caminho
  que apaga (seção *Inventário do apagamento* no BACKLOG): dois scripts, ambos
  travados; as duas rotinas agendadas **não apagam** (a retenção anonimiza com
  UPDATE). `apagar-com-autorizacao.test.ts` reprova script novo que apague sem
  pedir. ⚠️ **A primeira versão dessa régua passou verde com a trava
  arrancada** — procurava a PALAVRA, que continuava no texto da mensagem de
  erro. Virou regra no §0e: **régua nova só vale depois de ter reprovado uma
  vez.**
- **PORTÃO DE CERTIFICAÇÃO — Etapa 1 (0271 e 0272).** Do documento "Avaliação
  no riSZon teste". ⚠️ **A tranca já existia desde a 0259**: o riSZon real
  nasce FECHADO para todo Risartano novo. Faltava a chave.
  - **42 ações contáveis em 13 funções**, levantadas perguntando ao BANCO (155
    tabelas / 224 colunas apontam para `profiles`). Cada indicador declara a
    `origem` — a consulta da Etapa 2 escrita por extenso.
    **`npm run check:indicadores`** confere as 42 contra o banco.
  - **Franqueado e Franqueadora/Rede ficam de fora, declarado no código:** são
    papéis de leitura; meta para eles mediria navegação, não competência.
  - **Padrão ÚNICO DA REDE, sem cascata por unidade** (ordem do dono) — a
    única configuração do sistema fora da cascata, e há teste que reprova se
    alguma função do módulo passar a mencionar unidade.
  - **Grupo do teste coletivo** por cargo ou por pessoa. **Grupo vazio NÃO é
    "todo mundo"** — é configuração incompleta.
    ⚠️ Achado escrevendo a action: a função apagava as DUAS listas, então
    salvar no modo "pessoas" apagaria a seleção de cargos em silêncio.
    Corrigido antes de rodar: **nulo = não mexer, lista vazia = trocar.**

**Pendências (nesta ordem):**

1. ⏰ **Supabase Pro vence em 29/09/2026** — quatro dias.
2. **O dono precisa DEFINIR AS METAS** em Administração → Certificação. Está
   tudo em branco: enquanto estiver, ninguém é barrado.
3. **Etapa 2 do portão (a medição).** Bloqueada por uma dependência: a
   produção precisa das chaves do treino no `.env.local` deste PC
   (`TREINO_SUPABASE_URL`, `TREINO_SERVICE_ROLE_KEY`) — elas existem na
   Vercel, não aqui. Fluxo da área de transferência, uma por vez.
   ⚠️ **Decisão de desenho já tomada:** certificado é FATO HISTÓRICO, não
   contagem. Ao cumprir, congelar no banco da produção — senão uma limpeza do
   treino descertifica quem já passou.
4. **Cadastrar os benefícios PADRÃO DA REDE na produção** (segue VAZIO).
5. **AP8** (BACKLOG): `tsc --noEmit` acusa 8 erros em dois arquivos de teste;
   nenhum portão olha para lá.
6. Notebook: seguir a §4 de `docs/DOIS-PCS.md`.
7. Teste final do LOTE B (config da agenda + Relatórios).

**24–25/09/2026 — PC Administrador (core 0.275.0 → 0.277.0; Empresarial 0.54.0 → 0.68.0; migrações 1020 e 1021)**

**Tudo no ar nos dois ambientes. 1020 e 1021 aplicadas na produção e no
treino** — conferido lendo o banco da produção (só leitura, com trava que
EXIGE ser produção) e a versão pelas duas telas.

- **OC-00083 fechado (Blocos I4, J e K).** A **quantidade contratada** trava o
  cadastro, e o **termo de inclusão** (`TI-`) libera — curto de propósito,
  referente ao acordo que já existe; é o **aceite** que autoriza, não o
  rascunho. O teto de **dependentes** entrou depois (1021): a 1020 gravava o
  campo e **ninguém o lia** — achado ao levantar as pendências, não por relato.
- **A aba Proposta virou trilha de 6 passos** (Bloco J), na ordem do trabalho,
  com a simulação fixa ao lado. Eram 9 blocos numa coluna e a simulação no
  meio do formulário, com as faixas de preço DEPOIS dela.
  ⚠️ **Amontoou na primeira versão** e o dono mandou a foto: a ficha era
  `max-w-4xl` e eu pedi três colunas; e `sm:grid-cols-4` numa barra de 320px
  fez "MENSALIDADE" escrever por cima de "POR TITULAR". **Lição: dentro de
  coluna estreita, ponto de corte de JANELA mente** — a coluna virou
  `@container`.
- **Manual próprio do Empresarial** (`docs/treinamento/manual-empresarial.md`,
  21 seções), dentro do módulo em `/empresarial/manual`, reusando o leitor do
  núcleo. Word em `npm run manual:empresarial`.
- **Relatos OC-00055/00056/00057/00059:** a implantação deixou de esperar os
  cadastros (usa a **quantidade contratada**; sem base, pede o valor) e o
  cadastro de titular **abre limpo** — o dependente tinha o mesmo defeito, sem
  relato. O vencimento já era editável desde 31/07: virou orientação.
- **OC-00064/OC-00084 (tema escuro) — eu respondi errado e o dono corrigiu.**
  Eu disse "resolvido na 0.265.0" com base no registro, sem medir. A correção
  de 21/09 (`color-scheme: dark`) era **necessária e metade**: os `<select>`
  usam `bg-transparent`, então as `<option>` ficavam transparentes, o navegador
  pintava a listinha de branco e a letra clara sumia. Agora `option/optgroup`
  têm fundo e letra declarados (340+ caixas de uma vez).

⚠️ **O PADRÃO DESTES DOIS DIAS: a régua errada dizendo que estava tudo bem.**
Aconteceu cinco vezes. A pior foi o tema escuro: `tema-escuro.test.ts` lê o
CÓDIGO procurando "mancha clara + letra herdada" e passou o tempo todo —
**corretamente**, porque quem pintava de branco era o NAVEGADOR. Defeito que
só existe depois que o navegador desenha só se mede com um navegador
desenhando. Daí os dois testes E2E novos (`14-cadastro-limpo`,
`15-caixa-de-selecao-escura`). As outras quatro: semear numa coluna
inexistente e **acusar a tela** de não contar faixas; procurar `sm:grid-cols-4`
na página inteira e acusar a simulação; procurar a versão na página inteira
quando a barra lateral também a mostra; e um servidor de teste que subiu
falando com a **PRODUÇÃO** porque o `.env.test.local` começa com BOM (morto
antes de qualquer requisição; a conferência agora RECUSA rodar se a página não
enxergar o dado criado no treino).

⚠️ **Playwright: os navegadores nunca tinham sido instalados neste PC.**
`npx playwright install chromium` foi rodado em 25/09 — a suíte E2E agora roda
aqui.

**Pendências (nesta ordem):**

1. ⏰ **Supabase Pro vence em 29/09/2026.**
2. **Cadastrar os benefícios PADRÃO DA REDE na produção** —
   Configurações → Benefícios está **VAZIO** (conferido lendo o banco em
   25/09). Enquanto estiver, toda proposta nova nasce sem nada a oferecer. É o
   item mais barato com maior efeito.
3. **`docs/BACKLOG.md` → seção "Achados de passagem"**: AP1 (vencimento no
   relógio do servidor) e AP2 (`/risartanos/[codigo]` 404).
4. **Notebook: seguir a seção 4 de `docs/DOIS-PCS.md`** antes de trabalhar lá.
5. Trava de mensalidade duplicada (migração pequena) e depois o **ASAAS**, que
   é o grande buraco operacional do Empresarial.
6. Teste final do LOTE B (config da agenda + Relatórios), de sessões
   anteriores.

**21–23/09/2026 — PC Administrador (relatos da equipe: core 0.262.0 → 0.275.0; Empresarial 0.50.0 → 0.54.0)**

Sessão inteira movida por relatos do sistema. **Tudo o que segue já está no ar
nos dois ambientes, e as migrações 0266, 0267, 0268, 0269 e 1013 foram
aplicadas na produção e no treino.**

- **Jornada (0266)** — só o Admin força a passagem de fase; o resto anda por
  evento. Três buracos fechados junto: *Concluir a reavaliação*, *Devolver ao
  Coordenador* e — **achado medindo, não supondo** — o *Devolver ao
  Planejamento* do Consultor, que a matriz nova tinha quebrado. A auditoria
  passou a gravar `forcado`. Mapa completo em `docs/JORNADA.md` §4.
- **Responder relato (0267)** — `/problemas` recusava a resposta do próprio
  Admin **desde a 0264**: a função perguntava o PAPEL DA REQUISIÇÃO para saber
  por qual porta a chamada entrou, e o papel não muda quando uma função chama
  outra. Fechou junto uma brecha: `anon` tinha execute por herança.
- **Modo escuro (0.265.0)** — `color-scheme` nunca foi declarado (as opções do
  `<select>` sumiam) e a agenda pintava manchas de papel branco (contraste
  **1,06**, medido pixel a pixel; hoje 5,9–11,8). 25 pontos corrigidos no
  sistema inteiro, presos por `tema-escuro.test.ts`.
- **Agendar (0.266.0)** — a lista de clientes vinha **cortada em 300 nomes, em
  silêncio**; agora se procura digitando (nome, código ou CPF), reusando o
  `search_clients`.
- **Gravação da consulta (0.267.0 e 0.268.0)** — começa ao chamar o paciente e
  para ao concluir o atendimento; vive na barra de cima para atravessar as
  telas; a faixa arrasta e encolhe, mas **não fecha**. ⚠️ **Mudança de regra
  registrada no §6**: o áudio da avaliação/reavaliação dispensa o consentimento
  (dono + jurídico, 21/09), preso por teste.
- **Agenda do comercial (0268)** — a apresentação online deixou de depender do
  horário e dos dias da unidade; jornada própria em cascata (rede → consultor),
  configurada em Administração → Agenda do Comercial.
- **Funil × sala de espera (0269)** — as duas telas passaram a se falar: a
  recepção põe "em espera" e o cartão do Comercial mostra, com o tempo
  correndo; o consultor move o cartão e o atendimento anda sozinho ("em
  atendimento" → "concluído"). O menu Atendimento saiu do Consultor.
  ⚠️ **A matriz de permissões tinha uma LINHA GRAVADA** liberando aquele menu:
  linha de banco ganha de padrão de código, e mudar só `permissions.ts` não
  teria efeito nenhum. A 0269 apaga a linha (destrutivo declarado).
- **Print com a lista aberta (0.273.0 e 0.274.0, sem migração)** — **entreguei
  errado e o teste do dono achou no mesmo dia.** Eu vi a metade certa (o
  clique e o aviso de permissão fecham a lista) e parei ali. A causa que
  faltava: a foto da **aba** copia o desenho da página, e **lista aberta não é
  desenho da página** — é janela do sistema operacional por cima. Tempo
  nenhum faz aparecer o que não está lá. Agora a captura com tempo pede a
  **tela inteira**, e a função devolve a superfície escolhida para avisar
  quem escolher "aba". Virou **botão** (era interruptor, e passou
  despercebido). **Quarta aparição do padrão da régua, em roupa nova: conferi
  o MEU mecanismo (a contagem acontecia) em vez do resultado que ele pediu
  (ver a lista no print).**
- **Estorno de cobrança (EMPRESARIAL, 1013 — v0.51.0)** — a baixa indevida
  passou a poder ser desfeita, com motivo obrigatório; devolve a situação do
  vencimento, apaga o split e **reavalia a suspensão da empresa**. Faixa 1000+,
  roteiro em `docs/risarte-empresarial/ROTEIRO-TESTE.md` §9.1, e no
  `version.ts` só as duas linhas do Empresarial — **os documentos do core não
  foram tocados** (§0).

**O padrão que se repetiu três vezes nestes dois dias — conferir a RÉGUA antes
de confiar nela:** a linha da matriz que anulava a mudança do menu; o "permission
denied" do estorno, que era a minha conferência usando a chave de serviço (o app
fala como usuário logado); e a resposta do OC-00058 gravada com o texto de outro
relato, achada só porque li a conversa depois de gravar — "deu certo" não é
conferência.

**Pendências (nesta ordem):**

1. ⏰ **Supabase Pro vence em 29/09/2026** — lembrar o dono a cada sessão.
2. **Notebook: seguir a seção 4 de `docs/DOIS-PCS.md`** antes de trabalhar lá
   (`.stignore`, `git pull`, autocrlf/Node, tabela de PCs).
3. Conferir na produção, no próximo Risartano cadastrado sem acesso, se a lista
   mostra "Unidade · Função (prevista)" (EV-084).
4. Ver na tela a mensagem com os dados de acesso (EV-082) e os dois botões
   novos da jornada (EV-087).
5. Teste final do LOTE B (config da agenda + Relatórios), de sessões anteriores.

- **Funil do Empresarial em ABAS (OC-00083 — 0.52.0, 0.53.0 e 0.54.0, migração
  1014)** — a ficha da empresa mostrava TUDO de uma vez, sem olhar a fase; hoje
  são cinco abas (Levantamento · Proposta · Apresentação · Envio · Fechamento),
  a ficha abre na etapa da empresa e cada aba diz o que falta. A **proposta
  virou documento** (página para imprimir/PDF) e depois **etapa própria**, com
  prazo, carência e detalhamento em blocos — carência que agora **viaja para o
  cadastro da empresa** no fechamento, em vez de ser redigitada. Detalhe em
  `docs/risarte-empresarial/FUNIL-COMERCIAL.md` (Blocos E, F e G).
  ⚠️ **Achado no caminho, e era do NÚCLEO:** `CabecalhoDeModulo` mostrava o
  chapéu OU a seta de voltar, nunca os dois — o nome da seção era texto morto
  em **13 telas** de Compras e do Empresarial. Corrigido em commit próprio
  (core 0.275.0).

**Nada em andamento pela metade**: árvore limpa, tudo no GitHub, e os dois
ambientes na mesma versão — **core 0.275.0 / migração 0270** e **Empresarial
0.54.0 / migração 1014**, conferido lendo o banco e abrindo as telas logado,
não pelo painel.

**Relatos encerrados nestes dias:** OC-00053, OC-00058, OC-00060, OC-00061,
OC-00063, OC-00069, OC-00072 e OC-00073. **Em teste pelo dono:** OC-00083.

**O padrão da régua apareceu mais QUATRO vezes em 23/09** — e todas as quatro
foram a régua errada, não o sistema: a janela de 700 caracteres que não achou
as abas e acusou 7 fichas certas; a contagem que dizia *"falta 1 campo"* onde
faltava o levantamento inteiro; o `válida até` que não casava por causa de um
espaço; e, antes delas, a contagem da captura que eu dei por boa sem conferir
o resultado que o dono pediu. **Conferir a régua antes de acusar a tela virou
o primeiro passo, não o último.**

**18/09/2026 — PC Administrador (preparação do ambiente, sem mudança de código)**

- Feito: instalados Git 2.55 e Node 24.19 (via winget); criada e cadastrada no
  GitHub a chave SSH `risarte-pc-administrador`; `.stignore` definitivo criado
  e conferido pela API do Syncthing (código ignorado; `.env` e marca
  sincronizados); `git pull` em dia. O `node_modules` que veio pelo Syncthing
  funciona, então não houve `npm install` (daqui em diante cada PC tem o seu).
- Feito também: `docs/DOIS-PCS.md` (guia completo) e `docs/PRODUCAO-ONLINE.md`
  (substitui a memória local `risarte-producao-online`, montado com o que o
  repositório registrava; a memória original está só no Notebook).
- Pendente: **no Notebook, seguir a seção 4 de `docs/DOIS-PCS.md`** (criar o
  `.stignore`, `git pull`, conferir autocrlf/Node, completar a tabela de PCs,
  levar a memória `risarte-producao-online` para `docs/PRODUCAO-ONLINE.md`).
- Pendente no PC Administrador: fechar e reabrir o app do Claude (até lá, o
  Git e o Node só funcionam com o prefixo de PATH do §2). O npm avisa que
  existe a versão 12 — **não atualizar** num PC só.
- Próximo passo: o item do Notebook, antes de qualquer trabalho lá. Sessão
  encerrada com a árvore limpa e tudo no GitHub; nenhum trabalho de produto em
  andamento.

## 1. Visão geral

Sistema de gestão da rede de franquias **Risarte Odontologia** (hoje 1
franqueadora + 2 unidades — Cambé e Londrina; meta: **200 unidades em 5 anos**).
A espinha dorsal é a **Jornada do Cliente**: uma máquina de 7 fases que conduz a
pessoa do primeiro contato até o acompanhamento pós-tratamento. Com o tempo
entram módulos de financeiro, RH, compras/estoque, marketing e prontuário —
por isso **toda decisão de estrutura deve favorecer somar módulos sem retrabalho**
(novas rotas em `src/app/(app)/<modulo>/`, novas tabelas com `clinic_id` + RLS,
configs por unidade no padrão cascata, menu lateral orientado a permissões,
listas sempre com filtro por clínica pensando em 200 unidades).

## 2. Stack e ambiente

Stack fixa (decidida — não trocar): **Next.js 16** (App Router) + TypeScript +
Tailwind v4 + **shadcn/ui (Base UI)** + **Supabase** (Postgres/Auth/Storage,
região **sa-east-1 / São Paulo** por LGPD) + deploy **Vercel**. Banco único
multi-tenant. Projeto Supabase `hvhbijctanrrkxhemlza`.

```powershell
npm run dev     # servidor dev em http://localhost:3000 (Turbopack, hot reload)
# Portão de verificação. SEMPRE este comando — ele apaga a pasta e monta do
# ZERO. A v0.229.0 passou aqui e quebrou na Vercel: o cache do Turbopack pulou
# justamente a rota com defeito. Portão que passa por ausência não é portão.
# O script também define NEXT_DIST_DIR, que existe porque `next build` e
# `next dev` gravam na MESMA pasta `.next`: buildar com o servidor do dono
# aberto QUEBRA o servidor dele (404 em página que existe, com cara de bug da
# tela nova — já aconteceu em /financeiro/configuracao).
npm run verificar
# Migração nova: conferir ANTES de mandar rodar. O build compila TypeScript e
# NÃO enxerga SQL — 0232 e 0233 chegaram ao dono com erro que só o Postgres
# acusa, e cada uma custou uma ida e volta.
node scripts/check-migrations.mjs 0233
# E RODAR NO TREINO antes de mandar ao dono (AP10): o script lê texto; o
# Postgres pega o resto. Prova de dado = transação desfeita.
npm run migrar:teste
# Tipos do projeto INTEIRO, testes inclusive (AP8) — já roda dentro do verificar.
npm run tipos
npm run test    # testes unitários (Vitest) das regras de negócio em src/lib. Rodar antes de cada commit.
npm run lint    # eslint — baseline ZERO desde 04/09/2026 (os 3 antigos saíram). Qualquer problema é novo.
```

**Portão de cada entrega = `npm run build` + `npm test`.** Os testes unitários
(`src/lib/__tests__/`) travam as regras puras (matriz da jornada, máscaras,
preços em centavos, cascata de SLA, categorias de notificação, estágio do
plano); ao mudar uma dessas regras de propósito, atualizar o teste junto. Há CI
no GitHub Actions (`.github/workflows/ci.yml`): a cada push no `main` roda
testes + build na nuvem (aba Actions mostra ✅/❌). E2E (Playwright + banco de
teste) fica para a preparação de lançamento.
**Particularidades das máquinas (Windows, dois PCs — ver §0e):**

- Node não está no PATH dos shells. Prefixar comandos PowerShell com:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
- `api.github.com` é inacessível nesta rede: `gh` NÃO funciona. Push por git via
  SSH (`git@github.com:Riszon/risarte.git`); operações de repositório (criar
  repo, PR) o dono faz na web.
- Migrações não são aplicadas por CLI: escrever arquivo numerado em
  `supabase/migrations/`, copiar em **UTF-8** e o dono cola/roda no SQL Editor
  do Supabase. Detalhes e regras de idempotência em `docs/ARQUITETURA-TECNICA.md`.

## 3. Arquitetura — a Jornada do Cliente (7 fases)

Cada cliente está sempre em **uma fase + um sub-status**, com tempo registrado em
cada uma (`journey_phase_history`). O **Centro de Planejamento (Fase 3) é o
núcleo** do sistema: é onde o caso vira diagnóstico, plano e orçamento.

1. **Aquisição** — entrada de novos cadastros (SDR/recepção).
2. **Conversão Clínica** — consulta, coleta de dados (fotos, exames, áudio,
   transcrição); ao fim, agenda a apresentação comercial.
3. **Centro de Planejamento (núcleo, SLA 24h)** — diagnóstico → plano (+
   alternativos) → pilar da Metodologia → aprovação do Coordenador → orçamento →
   sinaliza ao comercial.
4. **Conversão Comercial** — apresentação online gravada; aceito → assinatura +
   pagamento; não aceito → follow-up. **Regra de ouro: só é venda com documentos
   assinados E pagamento confirmado.**
5. **Início de Tratamento** — fechamento notifica a recepção para agendar.
6. **Reavaliação** — controle de qualidade; se preciso, volta à Fase 3.
7. **Acompanhamento** — prevenção, retornos, inativos, resgate.

Toda transição **notifica automaticamente a função do próximo passo**. SLA
estourado = **badge vermelho** em listas, kanban e agenda. Todo plano é
classificado em **1 dos 6 pilares**: Diagnóstico, Planejamento, Saúde, Função,
Estética, Prevenção. Agenda e prontuário exibem sempre fase + pilar. Quem move
o cliente de fase depende da função (matriz de movimentação em `docs/JORNADA.md`,
imposta na função `move_client_phase`).

## 4. Decisões já tomadas (com a justificativa)

- **Assinatura digital = ZapSign.** Integração nacional, simples e com custo
  previsível; entra na Fase 2 (módulo comercial).
- **WhatsApp começa manual.** Mensagens pré-prontas que o usuário envia à mão
  antes de automatizar — valida o conteúdo e evita o custo/risco da Business API
  cedo. Automação fica para a Fase 3.
- **Sem migração de dados.** No início há **entrada dupla** (sistema novo +
  planilha atual) por um período — mais barato e seguro que migrar histórico
  legado de qualidade incerta.
- **Escala inicial pequena: ~15 usuários e ~60 avaliações/mês.** Dimensiona as
  decisões de performance (não otimizar prematuramente), mas a estrutura já é
  pensada para 200 unidades.
- **Portal do cliente adiado** para depois do MVP — foco primeiro no fluxo
  interno da equipe, que é onde está o valor imediato.
- **SLAs configuráveis pelo Admin Master** (padrão da rede + sobrescrita por
  unidade), não fixos no código — cada operação tem ritmo diferente.
- **NPS após o fechamento** (não durante) — mede satisfação no momento certo,
  sem atrapalhar a negociação.
- **Métricas de produtividade do Planejador no dashboard** — o Centro de
  Planejamento é o gargalo do negócio; medir é pré-requisito para escalar.
- **Abordagem online-first** — exige internet por enquanto; offline/sync é fase
  dedicada depois do núcleo (avaliar PWA + PowerSync/ElectricSQL). Manter o
  modelo "sync-friendly" desde já.
- **Pagamentos = ASAAS** (Fase 2), pelos mesmos motivos do ZapSign.
- **Rodada de refinamento visual** dedicada (tela por tela, guiada pelo dono) ao
  final do MVP funcional — por isso manter o visual em camadas trocáveis (cores
  em `globals.css`, aparência em `src/components/ui/`, lógica fora de ambos).

## 5. Controle de acesso por papéis (matriz PODE / NÃO PODE)

Papéis ficam em `user_clinic_roles` (um por clínica). Admin Master = flag global.
Enums sincronizados em `src/lib/roles.ts` (enum do banco ↔ const TS ↔ rótulo
pt-BR). Aplicar a matriz **na RLS** (barreira real) e na UI (esconder o proibido).

| Função | PODE | NÃO PODE |
|---|---|---|
| **Recepcionista** | Cadastrar clientes; agendar/acompanhar; check-in/out; solicitar anamnese e assinaturas; receber notificação de fechamento p/ agendar início | Avaliação clínica; planejamento; alterar plano; apresentação; fechamento |
| **SDR (Encantador)** | Cadastrar clientes (já pertencem à **unidade** escolhida, código FRA — Opção A); agendar (inclusive em outra unidade); editar cliente; ver os clientes que ela cadastrou | Mover fases (botões removidos); atos clínicos, de planejamento e comerciais |
| **Coordenador Clínico** | Avaliação/reavaliação; gravar consulta; fotos/exames; enviar ao Centro de Planejamento; **aprovar/reprovar plano**; auxiliar o Planner | Diagnóstico/planejamento; alterar plano; apresentação; fechamento |
| **Dentista Planner** | Diagnóstico; plano + alternativos; classificar pilar; pedir aprovação; gerar orçamento; sinalizar ao comercial; vê consolidados da rede | Avaliação clínica; agendamentos; contato direto; apresentação; fechamento |
| **Dentista (executor)** | Vê agenda e SEUS pacientes; executa o plano aprovado; tipos Início/Sessão/Retorno | Mover fases; planejar; negociar; ver clientes de outros |
| **Consultor Comercial** | Apresentação (com gravação); follow-up; renegociar; desconto; definir pagamento; vê só os SEUS clientes | Planejamento; alterar plano; avaliação; agendamentos |
| **Assistente Comercial** | Enviar documentos (ZapSign) e link de pagamento (ASAAS); acompanhar status; encaminhar fechado à recepção | Planejamento; avaliação; apresentação; negociação |
| **Gerente de Unidade** | Visão completa (leitura) + dashboard da sua unidade; SLAs e indicadores | Atos clínicos/comerciais; alterar planos |
| **Franqueadora / Rede** | Leitura + dashboard consolidado de TODAS as unidades | Atos clínicos/comerciais |
| **Franqueado** | Leitura + dashboard da(s) unidade(s) que possui | Atos clínicos/comerciais |
| **Admin Master** | Tudo; cadastrar usuários, clínicas e configurações | — |

Funções da Franqueadora (SDR, Planner, Consultor, Assistente) têm **escopo de
unidades** (Todas / específicas / Nenhuma) que limita o que enxergam. TSB e ASB
(funções de unidade) estão previstas. Detalhe fino em `docs/JORNADA.md`.

## 6. Restrições — LGPD (requisito de arquitetura desde o MVP)

- Dados odontológicos = **dados sensíveis de saúde**: consentimento registrado
  (TCLE + termo LGPD com data/hora) **antes** de tratar; menor privilégio via RLS.
- **Gravação de consulta/apresentação só inicia após o consentimento estar
  registrado** no sistema — **com uma exceção, aberta pelo dono em 21/09/2026
  com orientação do jurídico dele:** o **áudio da avaliação e da reavaliação**
  (fases 2 e 6) não depende do consentimento registrado. A razão é o relato
  OC-00060: a gravação precisa começar junto com o atendimento, senão o
  avaliador esquece de ligar e não há o que transcrever.

  **A exceção é estreita e está presa por teste** (`dispensaConsentimento` em
  `src/lib/gravacao.ts`, com `gravacao.test.ts`): vale para UM tipo de arquivo
  (áudio) e DUAS fases. Foto, exame, vídeo, documento e anamnese continuam
  exigindo o consentimento, e o áudio fora dessas fases também. Ao mexer nisso,
  mexa na função pura — dispensa de LGPD espalhada em `if`s cresce sozinha.

  **E dispensar a papelada não é gravar escondido:** enquanto grava, uma faixa
  fixa mostra "Gravando" com o tempo correndo, de onde o paciente na cadeira
  enxerga (mesma decisão, mesmo dia).
- Exclusão de cliente = **anonimização** (status `anonymized`), nunca apagamento
  físico (guarda legal do prontuário). Não existe DELETE policy em `clients` de
  propósito.
- Todo acesso a ficha/prontuário gera `audit_logs` (via `logAudit()` — só ids e
  metadados, **nunca** dado pessoal em `details`). **Esta regra continua valendo
  para `audit_logs`** — a trilha de AÇÕES.
- ⚠️ **A trilha de ALTERAÇÕES (`audit_changes`, 0288) GUARDA TUDO, antes e
  depois, inclusive dado pessoal e de saúde — decisão do dono em 09/10/2026,
  que muda a regra anterior.** Nas palavras dele: *"Guarda o conteúdo completo
  de todos os campos. Quanto à LGPD, neste caso, não terá risco aumentado, pois
  o acesso à auditoria é para o admin, poucos acessos e tudo dentro do
  sistema."* As quatro decisões, e o que as sustenta no código:
  - **Só o Admin Master lê** (RLS; não há regra de escrita; gatilhos recusam
    editar, apagar e esvaziar — nem o dono do banco consegue).
  - **Cliente anonimizado: a trilha MANTÉM o conteúdo antigo.** Eu avisei que
    este é o ponto juridicamente fraco (anonimizar é o direito de exclusão da
    LGPD, e uma cópia do dado sobrevive aqui) e recomendei conferir com o
    jurídico; o dono manteve. **Se o jurídico pedir o contrário, a mudança é
    uma migração que mascara os lançamentos do cliente — não existe hoje.**
  - **Segredo nunca entra** (senha, token, hash: gravados como "[oculto]").
  - **O chat da equipe fica de fora.**
  Ao mexer nisso: quem pode LER é o que segura a decisão. Abrir a leitura a
  outro papel (gerente, franqueado) reabre a discussão de LGPD inteira — pedir
  ao dono antes.
- Nunca expor dado de paciente em logs, URLs ou mensagens de erro. Mídia em
  Supabase Storage com **URLs assinadas**, nunca públicas.

## 7. Estado atual

**Fase do plano: MVP.** Concluído e validado pelo dono:

- **Etapa 1 — Fundação:** Next.js 16 + tema Risarte, login Supabase (sem
  auto-cadastro), proteção em `src/proxy.ts`, RLS base. (0001)
- **Etapa 2 — Cadastros:** clínica ativa; área admin (clínicas, usuários,
  senha, ativar/desativar); módulo de clientes auditado; SLAs; máscaras. (0002–0003)
- **Etapa 3 — Base da Jornada:** kanban por fase com SLA; agenda com profissional
  responsável; notificações; cliente único na rede + transferência; TSB/ASB;
  pilar automático + treatment_pillar; `journey_status` (sub-status); check-in +
  painel de atendimento; decisões da Fase 5; ativo/inativo configurável. (0004–0020)
- **LOTE D — ajustes do teste geral:** bug da SDR ao agendar (`unit_scheduling_staff`);
  "quem chamou conclui"; status em tratamento; tela de Atendimento (consultor,
  filtros, linha do tempo); cadastro com CPF primeiro. (0021–0024)
- **Etapa 4 — Coordenador Clínico (4.1 + 4.2):** consentimento (LGPD); upload de
  fotos/exames/vídeo/áudio (bucket privado `clinical-media`, links assinados);
  gravação de áudio; considerações editáveis; galeria; "Enviar ao Centro de
  Planejamento". **4.3 (aprovar/reprovar plano)** fica para a Etapa 5. (0025, 0027, 0028)
- **LOTE E — correções pré-Etapa 5:** modelo SDR (cliente pertence à unidade,
  código FRA — Opção A); regras de Jornada (sem botões da SDR, dentista sem
  Jornada, inativos + filtro); unidade visível na lista/ficha; conflitos de
  agendamento; editar cliente + transferir A→B; atendimento do Consultor;
  **compartilhamento de cliente entre unidades (E7)**. (0026, 0029–0034)

- **Etapa 5.1 — Centro de Planejamento (validada):** fila priorizada em
  `/planejamento` (apresentação comercial mais próxima; empate = quem entrou
  antes na Fase 3); estrutura do plano na ficha (diagnóstico + opções
  principal/alternativas); envio para aprovação que define o sub-status
  "Aguardando Aprovação" e notifica o Coordenador. (migração 0035)

- **Etapa 5.2 — Orçamento (entregue):** tela admin **Tabela de Preços**
  (`/admin/precos`, catálogo no padrão cascata: preço padrão da rede + ajuste por
  unidade); **orçamento por opção** na ficha (itens do catálogo ou linhas livres,
  total por opção; valores em centavos). (migração 0036)
- **Etapa 5.3 / 4.3 — Aprovação do plano (entregue):** o Coordenador **aprova**
  ou **devolve** (com orientações → sub-status "Revisão com Coordenador") o plano
  submetido; aprovado → o Planner **envia ao Comercial** (Fase 3 → 4, com trava de
  "plano aprovado"). RPC `review_treatment_plan`. (migração 0037)

Com isso a **Etapa 5 (Centro de Planejamento) e a 4.3 estão completas** — o núcleo
clínico do MVP (Jornada + Coordenador + Planejamento) está fechado.

**Em andamento — LOTE F** (feedback pós-teste da Etapa 5, em `docs/BACKLOG.md`,
7 sub-etapas F1–F7). **F1 + F2 entregues:** F1 = filtros aplicam sozinhos
(componente `FilterForm`, sem botão "Filtrar"), ficha abre em **modo leitura**
com botão "Editar" (`ClientDataSection`), e o cadastro reconhece o cliente já
existente e **autopreenche** os dados; F2 = compartilhamento notifica as **duas**
unidades ao iniciar/encerrar e a ficha mostra **Histórico de compartilhamento**
(migração 0038). **F3.1 entregue:** módulo **Procedimentos** (`/procedimentos`,
substitui a antiga "Tabela de Preços") com novos campos (código interno
automático, TUSS, especialidade, preço padrão/mín/máx, comissionamento %+R$,
pilar), busca + filtros (especialidade/ativo/pilar), editar todos os campos,
**excluir = desativar** (procedimento já usado nunca é apagado), histórico de
alterações, e acesso de **Admin Master + Dentista Planner** (migração 0039).
**F3.2 entregue (sem migração):** **importar planilha Excel** (`.xlsx`, com botão
"Baixar modelo" e biblioteca SheetJS via CDN) e **reajuste de preço em massa**
(percentual aplicado a Todos / por Especialidade / por Pilar / Selecionados).
**F3 (Procedimentos) completo.** **F4 entregue (migração 0040):** aprovação **por
opção** — o Coordenador aprova/reprova cada opção (com considerações que valem
ao aprovar ou reprovar); o plano vira "aprovado" só quando todas as opções têm
decisão e ≥1 é aprovada (se todas reprovadas, devolve ao Planner). O plano
principal aparece primeiro e em destaque, e o Coordenador vê só o **total** de
cada opção (não o preço item a item) e não edita o orçamento. **F5 entregue (sem
migração):** a fila do Centro de Planejamento (`/planejamento`) agora separa os
casos por **situação** (aguardando planejamento / aguardando aprovação / em
revisão / aprovados / enviados ao Comercial) com **contadores clicáveis** e
filtro de **período** (Hoje / Esta semana / Este mês / período específico).
**F6 entregue (sem migração):** central de notificações categorizada
(`/notificacoes`) — categorias **Plano de Tratamento / Compartilhamento / Início
de Tratamento / Transferência / Outras** (classificadas pelo título em
`src/lib/notifications.ts`), com chips/contadores clicáveis, filtro e selo de
categoria por aviso. **F7 entregue (sem migração) — LOTE F COMPLETO:** cockpit do
Planner (`/planejamento/[clientId]`) — tela dedicada em 2 colunas: à esquerda as
**evidências do cliente** (galeria de mídia que abre em pop-up/lightbox +
considerações + consentimento), à direita o **editor do plano**, sem trocar de
tela; a fila abre o cliente direto no cockpit.

**LOTE B COMPLETO (B1–B6):** **B1** — agenda com visões **Dia / Semana / Mês**
(`src/lib/agenda-view.ts`, `WeekGrid` por `dayCount`, `MonthView`, `AgendaToolbar`).
**B2/B3** — config de agenda por unidade (horário, dias e **cadeiras**) em
`/admin/agenda` no padrão cascata (migração 0043, `clinic_agenda_settings`); ao
agendar, valida fora-do-horário / dia fechado / cadeiras lotadas (exceto
Urgência/Emergência). **B4/B5/B6** — tela **Relatórios** (`/relatorios`, papéis de
gestão/rede): quadros-resumo de agendamentos (situação/tipo/profissional/unidade),
rede por fase **sem nomes** de pacientes, e produtividade do Planner (planos
criados/enviados/aprovados/devolvidos + tempo médio criação→aprovação). Adiados
do B1 (polimento): semana começando no domingo + esconder fim de semana sem
agendamento.

A barra lateral mostra a **versão do sistema** e a **última migração**
(`src/lib/version.ts`: `APP_VERSION` + `LATEST_MIGRATION`) acima do botão Sair —
bumpar os dois a cada entrega publicada.

**Correções pós-teste (migrações 0041–0042):** 0041 corrigiu o erro "não foi
possível registrar a avaliação" (cast de enum no `review_plan_option`), exige
procedimentos lançados em cada opção para enviar, busca de Procedimentos com
sugestões (datalist) e botão "Tornar principal". 0042: encerrar compartilhamento
pela unidade B → a ficha mostra "Compartilhamento encerrado" + detalhes (e B
perde o acesso) em vez de 404 (`client_shares.ended_by` + tratamento na ficha);
após a aprovação o Planner **não edita** o plano (leitura) — há **"Reabrir para
edição"** (`reopenTreatmentPlan` → rascunho, exige nova aprovação antes do
Comercial); **reprovar opção exige considerações** (obrigatórias).

**Migrações 0001–0043 escritas.** O dono aplica cada uma no SQL Editor do
Supabase; **0001–0042 aplicadas; 0043 pendente** (config da agenda da B2/B3 —
`clinic_agenda_settings`).

## 8. Próximos passos (ordem de prioridade)

> Etapa 5, LOTE F (F1–F7) e LOTE B (B1–B6) **concluídos**. Resumo de estado
> também em `ESTADO_DO_PROJETO.md` (raiz), atualizado a cada etapa.

1. **Aplicar a migração 0043** e fazer o **teste final do LOTE B** (config da
   agenda + Relatórios).
2. **Rodada de refinamento visual** — tela por tela, guiada pelo dono (cores,
   espaçamento, textos), agora que o fluxo está completo.
3. **Fase 2 (após MVP validado):** módulo comercial — apresentação gravada,
   assinatura digital (ZapSign) + pagamento (ASAAS) com a regra de ouro, NPS
   pós-fechamento, WhatsApp manual, transcrição/resumo por IA, dashboards com metas.

Adiados (em `docs/BACKLOG.md`, não esquecer): semana começando no domingo +
esconder fim de semana sem agendamento; foto por webcam; gênero + rótulos;
offline/sync (PWA + PowerSync/ElectricSQL).

**Módulo Risarte Empresarial (B2B) — em construção.** Programa que conecta
empresas parceiras à rede: o colaborador vira **cliente do riSZon** (mesmo banco),
com selo "Risarte Empresarial", desconto no orçamento, mensalidade da empresa e
split Risarte/RisLife. Schema próprio **`empresarial`** (1º schema separado do
projeto — exige "Exposed schemas" no painel). Contexto e DDL em
`docs/risarte-empresarial/` (briefing + `ADENDO-01-motor-de-beneficios.md`).
Decisões: dinheiro em centavos; papel novo `rislife_consultant` (Franqueadora);
benefícios personalizáveis por empresa (cobertura/desconto/frequência/limite/
carência/pagamento) com acompanhamento de uso e painéis de economia.
**Fases 0–8 construídas (migrações 0096–0103), aguardando teste do dono** —
roteiro em `docs/risarte-empresarial/ROTEIRO-TESTE.md`. ASAAS/ZapSign/Gamma ficam
"prontos para plugar" (chave + deploy das Edge Functions em `supabase/functions/`).

Não avançar de etapa sem o OK do proprietário.

## 8b. Módulo Financeiro (em construção — FIN0 entregue)

Especificação funcional aprovada em `docs/financeiro/DOCUMENTO-BASE-FINANCEIRO.md`
e o briefing de execução em `docs/financeiro/PROMPT-riSZon-Modulo-Financeiro.md`.
**Ler os dois antes de qualquer fase nova.**

**Regra estrutural:** a aba financeira do cliente é uma **visão** sobre uma base
contábil — nunca a base. Tudo nasce em `financial_entries` (o razão); contas a
receber e a pagar são projeções sobre ele. Sem isso, DRE, DFC, ponto de
equilíbrio e consolidação da rede não fecham.

**Invariantes de toda fase do Financeiro:**

- **Competência × caixa:** todo lançamento tem `accrual_date` (fato gerador →
  DRE) e `cash_date` (movimentação → DFC).
- **Nada se apaga.** Lançamento liquidado/conciliado não é editado nem
  excluído: gera-se **contra-lançamento** com motivo (trigger no banco).
- **Rastreabilidade:** `source_type` + `source_id` em tudo; qualquer número de
  relatório precisa chegar ao documento de origem.
- **Dinheiro em BIGINT de centavos** nas tabelas do módulo (o núcleo antigo usa
  INTEGER; conversão fica para janela dedicada).
- **Arredondamento** meio para cima; a última parcela absorve o resíduo.
- **Cálculo isolado e testado** em `src/lib/finance/` — nenhuma regra de
  dinheiro dentro de componente de tela.
- **Taxas congeladas:** a parcela guarda multa/juros vigentes quando foi gerada;
  mudar a configuração não reescreve o passado.
- **LGPD:** relatório gerencial usa identificador anonimizado do paciente.

**Decisões de negócio travadas (dono, 31/07/2026):**

- **Multa 2% + juros 1% ao mês, pro rata die**, cascata rede→unidade. O teto de
  2% é limite do **CDC art. 52, §1º** (contrato de consumo parcelado) e está
  travado no banco.
- **Atraso conta no dia seguinte** ao vencimento (carência configurável).
- **Multa e juros incidem sobre o valor CHEIO da parcela** (mais o benefício
  perdido), nunca sobre o saldo — *revisa a decisão de 31/07 em 04/08/2026*:
  receber metade não pode cortar a multa pela metade, senão a baixa parcial vira
  desconto disfarçado. Ordem de abatimento de um recebimento: **principal →
  benefício perdido → multa → juros**.
- **Pontualidade é condição do benefício.** Cliente de programa (PPR+ /
  Empresarial) só tem o desconto porque paga em dia: atrasou, aquela parcela
  volta ao preço sem benefício e a multa/juros incidem sobre o valor maior.
  **O critério é o RISCO, não o rótulo do meio de pagamento** (correção de
  04/08/2026, migração 0192 — a regra nasceu olhando "boleto e recorrência" e
  deixava passar PIX parcelado com vencimentos futuros, que é o mesmo risco).
  Toda cobrança é promessa de pagamento e corre risco, **exceto no cartão**
  (`cartao`, `cartao_parcelado`), onde a adquirente já garantiu o dinheiro.
  Procedimento que ficou **100% gratuito nunca é cobrado** — sai da base. O
  valor em risco é rateado entre as parcelas e congelado
  (`benefit_discount_cents`) no fechamento da venda.
- **Não existe desconto na baixa.** Receber menos que o total devido é baixa
  **parcial**; perdoar diferença é ato de **renegociação** — Gerente da unidade,
  Financeiro da Franqueadora (com autorização do Gerente) ou Admin Master.
- **Renegociação (FIN2):** a dívida nova nasce com **tudo** o que é devido hoje
  (o que falta + benefício perdido + multa + juros). O perdão é **desconto**,
  tem o **mesmo teto da regra comercial da unidade** e vira lançamento em
  **1.9.02**. Acima do teto, ou qualquer desconto de quem não é Gerente/Admin,
  fica **aguardando autorização** e as cobranças não mudam antes disso. As
  cobranças novas **não geram lançamento de competência** — a receita do
  serviço já foi reconhecida pelas originais; só multa/juros (4.1.01),
  benefício incorporado (1.1.01) e desconto (1.9.02) entram no razão.
- **Renegociação substitui** as parcelas antigas (viram `renegotiated`, com a
  marca de que estiveram em atraso — senão renegociar zeraria a inadimplência
  e o indicador 9.28 perderia sentido).
- **Centro de custo por ÁREA** (Clínico, Comercial, Administrativo, Marketing,
  Infraestrutura), nunca por especialidade clínica. Unidade só cria centro como
  **filho de um centro da rede**, para o consolidado ficar comparável.
- **Dois consolidados distintos:** *Resultado do Grupo* (franqueadora +
  unidades **próprias**, com eliminação intercompany do royalty) × *Faturamento
  da Rede* (todas as unidades, só benchmarking). **Faturamento de franqueada
  nunca entra no resultado da franqueadora** — se algum card somar, é bug de
  negócio.
- **Repasse de dentista:** valor **fixo por procedimento**, tabela com vigência,
  chaveada por **nível do plano de carreira**; bônus percentual apurado no
  fechamento do mês. Reajuste de tabela nunca recalcula repasse já apurado.
- **Gerente de unidade nunca vê financeiro de outra unidade**; no ranking da
  rede as demais aparecem anonimizadas.

**Papel novo:** `finance_franchisor` (Financeiro da Franqueadora), com escopo de
unidades. Auditor/Controladoria somente-leitura está previsto, não implementado.

**Alçada das contas a pagar (FIN3, decisão do dono 04/08/2026):** cada conta do
plano de contas tem um **modo** — `automatica` (despesa contratada: nunca pede
autorização e **não olha o teto**), `sem_autorizacao` (livre, mas respeita o
teto) ou `com_autorizacao` (sempre exige). Cascata rede→unidade e geral→conta,
sendo que **a conta pesa mais que o escopo**: regra da rede sobre uma conta não
é derrubada pelo teto geral da unidade. **Quem lançou não autoriza a própria
conta** (o Financeiro da Franqueadora e o Admin Master são a exceção).
**Recepção não entra em contas a pagar** — pagar fornecedor não é ato de balcão.
Multa e juros que NÓS pagamos são **informados** (quem define é o fornecedor) e
vão para **4.2.01**, separados da despesa.

**Adquirente (FIN4b):** a taxa do cartão é **despesa da UNIDADE** (conta
2.4.01), nunca da franqueadora — senão a unidade não tem incentivo para
negociar a taxa nem para puxar o cliente para o PIX. A tabela de taxa/prazo tem
**vigência**: renegociar a taxa não reescreve o que já foi recebido. O cliente
paga o **bruto** (é isso que quita a dívida dele); a clínica recebe o
**líquido**, em **D+n**, e é essa data que vai para a projeção de caixa.

**Abrangência da adquirente (FIN4b.2, dono 06/08/2026):** o cadastro tem escopo
**unidade / rede / unidades específicas**. Rede e unidades específicas são ato
da **Franqueadora** (`clinic_id` nulo) — a unidade não reescreve a taxa que a
rede negociou. Na hora de escolher sozinho, **o cadastro próprio da unidade
ganha do padrão da rede** (quem tem contrato próprio é quem paga aquela taxa).
A **franquia gratuita mensal conta por unidade**, não somando a rede: a fatura
da adquirente chega por conta/CNPJ.

**Momento da cobrança da taxa (FIN4b.2):** cada faixa diz se a taxa é cobrada
**no pagamento** (sai do que entra na baixa — não pagou, não custou) ou **na
emissão** (o custo nasce ao gerar o documento, pago ou não; é como o banco
cobra o boleto). Só boleto e PIX aceitam "emissão" — no cartão não há documento
a emitir. **Trava de dupla cobrança, exigida pelo dono pensando no ASAAS:**
`register_boleto_issue()` recusa quando a faixa diz "pagamento"
(`FEE_NOT_ON_ISSUE`) ou quando a baixa já cobrou; `apply_acquirer_fee()` **não
cobra** quando a faixa diz "emissão" — nem se a emissão não tiver sido
registrada (deixar de lançar um custo é erro menor que lançar duas vezes o
mesmo custo); e a origem `boleto_issue` aponta para a **parcela** no índice
único do razão, então o webhook futuro do ASAAS cai na mesma porta e não
duplica. Adiado: **segunda via de boleto** (hoje é uma cobrança por parcela).

**FUSO, A SEGUNDA METADE — HORA também é relógio brasileiro (05/09/2026).** A
0201 resolveu o *dia*; a *hora* continuou sendo lida no fuso da máquina.
`new Date("2026-09-05T14:00:00")` dá 14:00 no computador do dono e **11:00** na
Vercel (UTC). Resultado: a agenda recusava remarcar para as próximas 3 horas
dizendo "horário no passado", o que passava era gravado 3 horas antes, e os
horários livres das próximas 3 horas sumiam. Usar **`instantFromBrazil()`** /
`startOfDayInBrazil()` / `weekdayOf()` (`src/lib/dates.ts`); há teste que varre
`src/app` e reprova a volta do padrão. **Nada disso aparece rodando local** — só
onde o sistema está publicado.

**FUSO: data de negócio é data civil brasileira (0201).** `new Date()
.toISOString().slice(0,10)` devolve a data em **UTC** e, das 21h à meia-noite,
já é o dia seguinte — parcela do dia virava atrasada e a baixa nascia com data
de amanhã. No app, a única fonte de "hoje" é **`todayInBrazil()`**
(`src/lib/dates.ts`); no banco, o fuso é `America/Sao_Paulo` e existe
**`public.today_br()`** para funções novas. Nunca usar `toISOString()` para
obter "hoje".

**A REGRA DE OURO É IMPOSTA PELO BANCO (0203).** Não se recebe por uma venda que
não foi fechada: gatilho em `payment_receipts` levanta `SALE_NOT_CLOSED`.
Estorno e cobrança de renegociação passam (desfazer não se bloqueia; dívida
renegociada já era devida). A regra estava só na documentação e na tela, e o
teste do dono achou R$ 869,00 recebidos numa negociação nunca aceita
(06/08/2026). **Quando uma regra de negócio importa, ela mora no banco.**

**Cockpit do Consultor = fila de trabalho.** O quadro vai até *Fechamentos*;
"Aguardando iniciar", "Tratamento iniciado", cancelados e perdidos vivem no
**Histórico** (decisão do dono, 06/08/2026) — o consultor precisa enxergar o que
ainda depende dele, não o que já encerrou.

**Plano de tratamento NÃO tem acréscimo** (dono, 06/08/2026). O preço vem do
orçamento aprovado pelo Coordenador; somar valor por cima enfraquece a aprovação
clínica. Venda direta mantém acréscimo, restrito ao Gerente.

**Cancelar plano de tratamento (0206, dono 07/08/2026).** Três passos, e **nada
é desfeito antes do último**: *apurar* (congela o acerto) → *assinar* (o
paciente assina o termo) → *efetivar* (sessões, cobranças e fase mudam).
Descartar no meio não deixa rastro no tratamento.

- **Destino do paciente:** quem **não fechou** continua na **Fase 4**. Quem
  fechou vai para **Fase 6 (reavaliação)** ou **Fase 7 (acompanhamento, com
  data de retorno obrigatória)** — escolha do Gerente no ato. Voltar à Fase 4
  quem já estava em tratamento seria fingir que o clínico não aconteceu.
- **O realizado é cobrado COM o desconto** do contrato (retirar desconto já
  concedido é cláusula que o CDC olha com rigor).
- **Multa de rescisão** é percentual configurável (cascata rede→unidade),
  **padrão 0%**, e incide sobre o **não executado** — compensa a agenda
  perdida, não pune o que já foi entregue.
- **Cliente devendo** → nasce cobrança nova (15 dias). **Clínica devendo** →
  nasce conta a pagar em **1.9.03**; a forma de devolver é decidida no
  Financeiro (estorno em cartão depende da adquirente e nem sempre existe).
- **Sessão concluída nunca é desfeita** — é histórico clínico.
- **O sistema não lê o contrato assinado** (não há texto armazenado): ele aplica
  as regras acima e **cita** o contrato de origem. Divergência é conciliada por
  gente, no campo de observações do termo.
- Pendência: o **benefício do programa não volta** no cancelamento do Comercial
  (na venda direta volta) — `ppr_benefit_usages` não guarda vínculo com a
  negociação.

**A taxa da adquirente entra NA BAIXA (FIN4c, 0204).** A **modalidade vem do
meio da BAIXA, não do meio da venda**: parcela de boleto paga por PIX no balcão
custou o PIX. Sem taxa cadastrada, a baixa **não falha** — segue sem taxa (é
problema de cadastro, não de atendimento). O **estorno reverte a taxa** junto,
com a direção invertida; a taxa de **emissão de boleto não volta** (o banco
cobrou por emitir, e isso independe da baixa).

**⚠️ O CÓDIGO DO DOCUMENTO NUNCA SOME** (regra do dono, 07/08/2026, depois de
ele sumir em três telas diferentes). Todo código gerado — **`PT-`** plano de
tratamento, **`VD-`** venda direta, **`RN-`** renegociação, **`CN-`**
cancelamento — **acompanha o registro para sempre e em todo lugar**: listagens,
cabeçalhos, eventos de histórico, notificações, termos e documentos impressos.

O código é o que **rastreia o documento**: amarra plano, cobranças, razão
contábil, termo assinado e histórico. Quando some de uma tela, o caso vira um
buraco — ninguém liga o que aconteceu no clínico ao que aconteceu no financeiro.

**Armadilha que já causou o problema três vezes:** consulta que filtra por
status "ativo" (`aceita`, `em_aberto`, `stage` do funil) **exclui o encerrado e
leva o código junto**. Cancelado, perdido ou concluído é exatamente quando
alguém vai procurar o código — sempre incluir os estados encerrados. Evento de
histórico sem código é evento incompleto.

**Os dois fluxos de venda andam juntos.** Comparativo completo em
`docs/COMPARATIVO-VENDAS.md`. Regra: o que muda na venda direta tem de ser
verificado no fechamento pelo Comercial e vice-versa — os dois terminam nas
mesmas `payment_installments`.

**A cobrança guarda o meio de pagamento (0200).** `payment_installments
.payment_method` era sempre nulo — o meio só existia na venda. Agora a cobrança
**herda o meio da venda** quando não traz um próprio (`save_payment_schedule`),
nos dois fluxos: venda direta e negociação do Comercial. Regra do dono: **o que
for testado na venda direta tem de funcionar igual no fluxo do Comercial.**
O meio aparece no resumo das duas telas — ele é o que muda taxa, prazo de
liquidação e risco do benefício.

**Faixa de taxa (FIN4b.2):** dá para **editar** (para consertar digitação) e
**encerrar a vigência** (o caminho certo quando a taxa mudou). Faixa que já
precificou recebimentos **não é apagada** — gatilho `RATE_IN_USE` no banco.

**Repasse ao dentista (FIN5, 0209).** Valor **FIXO por procedimento**, tabela com vigência chaveada por **nível do plano de carreira** (individual é exceção). Apuração nasce na **conclusão da sessão**, com competência na data do procedimento e valor **congelado** — reajuste nunca recalcula o apurado. **Bônus percentual sobre o total do período**, nunca por procedimento. Fechamento mensal gera **duas contas a pagar por dentista**: fixo em **2.1.01** e bônus em **2.1.02** (o plano de contas separa produção de premiação). O sistema **não paga** — quem paga é o Financeiro.

**Repasse por NÍVEL, visível onde se decide (0212).** A pergunta que faltava era "quanto ganha *um* sênior" — só existia "quanto ganha o Dr. Fulano". Agora há `payout_rate_by_level` e `payout_matrix` (os **mesmos quatro degraus** da apuração; conta diferente da que grava = tela que mente). Aparece em três lugares: **comparativo procedimento × nível** em Repasses (célula editável), **repasse por nível** no cadastro do procedimento, e **margem por nível** no precificador. Valor em itálico = veio do **cadastro do procedimento**, não do nível — os dois mostram o mesmo R$, e é essa diferença que revela a tabela incompleta. O catálogo grava no escopo da **rede**; a unidade sobrescreve em Repasses (**unidade vence rede**, desempate que a 0210 não tinha).

**Taxa média do pagamento — sugerida pelo razão (0212).** É quanto o meio de pagamento come do preço, e entra como custo **proporcional** (sobe com o preço) porque na hora de precificar não se sabe como o cliente vai pagar; o preço é um só, então usa-se a média da mistura. `suggested_avg_acquirer_fee` calcula **taxas de adquirente ÷ recebido nos últimos 90 dias** (inclui a taxa de emissão de boleto; estornados saem dos dois lados). **Devolve nada** quando não há taxa lançada — um "0%" seria lido como "não pago taxa".

**Reajuste em massa e comissão em massa moram na Precificação (0212).** Saíram do catálogo por decisão do dono: mexer em preço sem ver custo e margem na mesma tela é o erro que o precificador existe para impedir.

**Alerta de margem.** Como o repasse é fixo, **desconto não reduz repasse**: sai inteiro da margem. A negociação mostra a margem ao vivo e **avisa** abaixo de `min_margin_percent` (cascata rede→unidade) — **não bloqueia**, porque o teto de desconto já é a trava. **Material e laboratório ainda não entram** (são do Estoque); a tela declara isso.

## 8c. Estoque (em construção — E1+E2 entregues, migração 0213)

**O documento base já diz como este módulo morre:** *"falta de baixa no uso"*
(§7). Todo estoque de clínica quebra no mesmo ponto — alguém teria de digitar
"usei 2 anestésicos" no meio do atendimento, ninguém digita, e em três meses o
saldo não vale nada. Por isso **a baixa é automática, pelo KIT do procedimento**
(E3); o registro manual existe só para a exceção.

- **O saldo é PROJEÇÃO, não base.** Tudo nasce em `stock_movements`;
  `stock_balances` é derivado e reconstruível. Ninguém escreve saldo direto — a
  única porta é `post_stock_movement()`, que calcula, congela e projeta sob
  trava. Estoque com saldo digitado é estoque que ninguém audita.
- **Custo médio ponderado.** Entrada recalcula o médio; **saída sai pelo médio
  vigente e o valor fica CONGELADO no movimento** — comprar mais caro amanhã não
  reescreve o custo do que foi usado ontem (mesma regra do repasse). Saldo
  zerado ou negativo não pondera: o custo da entrada vira o custo.
- **Saída NÃO é recusada por falta de saldo** — registra negativo e alerta.
  Travar aqui seria parar atendimento por causa de cadastro, o erro que a baixa
  da adquirente já ensinou a não repetir. Saldo negativo *é* a informação:
  faltou dar entrada em alguma nota.
- **Ajuste e perda exigem motivo.** A diferença do inventário é o dado (perda,
  furto, kit errado); sem motivo ninguém audita depois.
- **Item é da REDE; saldo, mínimo, máximo, local e fornecedor habitual são da
  UNIDADE** (cada uma compra pelo seu preço e guarda onde quer). **Kit** segue a
  mesma cascata: padrão da rede, ajuste por unidade.
- **O KIT TEM NOME PRÓPRIO E SERVE A VÁRIOS PROCEDIMENTOS (0215).** Na 0213 ele
  era filho de um procedimento — "Kit restauração" viraria três cópias (1, 2 e 3
  faces) e uma delas ficaria desatualizada sem ninguém perceber. Agora: kit é
  entidade (criar, renomear, inativar), **um kit → vários procedimentos**, e
  **um procedimento pode ter vários kits** (básico + específico; sem isso o
  básico seria copiado em todo kit). Itens e vínculos são gravados juntos
  (`save_stock_kit`) — separados, um procedimento ficaria ligado ao kit com o
  conteúdo anterior. Vínculo da unidade **vence** o da rede (não mistura: herdar
  de volta o que a unidade trocou seria pior que não ter cascata).
- **Editar item: o FATOR muda livre, a UNIDADE DE CONSUMO não** (0215). O fator
  novo vale só para as próximas entradas — o saldo já está contado em unidades
  de consumo. Trocar a unidade com saldo/movimento é **bloqueado no banco**
  (`UNIT_LOCKED`): 240 sugadores não viram 240 gramas, e o erro levaria junto o
  custo de todo procedimento que usa o item.
- **Excluir = inativar** quando o item tem movimento ou está num kit (mesma
  regra do catálogo de procedimentos). Apagar de verdade, só o que nunca foi
  usado.
- **UNIDADE DE COMPRA ≠ UNIDADE DE CONSUMO (0214).** O dono achou no teste: *"eu
  pago R$ 25,00 na caixa de sugadores, mas vem 100 unidades"*. A 0213 tratava as
  duas como iguais e cada sugador entrava no procedimento por R$ 25,00 — erro de
  100× e **silencioso**. A correção é um conceito só: **unidade de CONTROLE**
  (o que se consome) + **fator de conversão** da embalagem. Resolve também o
  fracionamento (tubo de resina → grama) e o **rendimento** (frasco de adesivo →
  20 aplicações; ninguém mede ml de adesivo na clínica). **O saldo vive sempre
  na unidade de controle**; a entrada é lançada como está na nota e o BANCO
  converte — a mesma conta vale para a nota digitada hoje e para a integração de
  compras amanhã.
- **Unidades são listas fechadas**, nunca texto livre: "un", "und", "UN" e
  "unid" viram quatro itens no consolidado da rede.
- **Custo unitário carrega 4 casas; valor total é centavo inteiro.** R$ 180,00 ÷
  7 g = 2571,4286 centavos/g — arredondar a cada movimento subestimaria o custo
  sempre para o mesmo lado. Regra: **taxa tem decimais, valor é centavo**.
- **LOTE E VALIDADE SÃO DA COMPRA, NÃO DO ITEM.** A caixa de março tem lote e
  validade diferentes da de agosto; gravar no item faria a compra nova apagar a
  informação da anterior — errado e silencioso. Ficam no **movimento de entrada**
  (com fornecedor e nota), e `stock_expiring()` aponta o que vence primeiro.
  **Limite declarado:** o consumo **ainda não escolhe lote** (sem baixa FIFO nem
  recusa de vencido) — controle por lote muda a baixa, e fica para depois da E3.
- **CUSTO DE MATERIAL É CALCULADO, NUNCA GUARDADO (0216).** A 0213 fazia o kit
  *escrever* o resultado em `procedure_costs.materials_cents` para não mexer nos
  três consumidores. **Foi erro de desenho, e o teste do dono achou:** ele somou
  os kits (R$ 17,92) e a Precificação mostrava R$ 11,69. Valor guardado é foto —
  fica certo no instante em que é tirada e envelhece sozinho; todo caminho que
  muda o custo passa a ter de lembrar de tirar outra, e um não lembrou. Pior: o
  recálculo só cobria a **clínica ativa**, então salvar um kit da REDE deixava as
  outras unidades com o número velho (uma tinha R$ 220,00 contra R$ 0,00 real).
  Agora `material_cost_for()` resolve na leitura: **tem kit, o kit manda; não
  tem, vale o valor informado à mão**. Não existe cache para envelhecer.
  **Regra geral: não cachear número derivado de dinheiro** — o custo de
  recalcular é sempre menor que o de formar preço com valor velho.
- **Compra vira ESTOQUE, não despesa** (decisão do dono, 11/08/2026): material
  comprado em janeiro e usado em março não pode afundar janeiro. Daí o grupo
  **6 (Ativos) / 6.1.01 Estoque de materiais** e a natureza `asset`, a única que
  **não entra na DRE**. O custo vira **2.2** no consumo (E4).
- **Quem opera:** entrada, mínimo e inventário = **Gerente + Admin/Financeiro**;
  consumo avulso = **coordenador, TSB, ASB** (⚠️ **Dentista e Planner NÃO veem
  o Estoque** — decisão do dono, confirmada em 09/10/2026; a regra antiga os
  incluía); **recepção fora**
  (mesma lógica de contas a pagar). O catálogo de itens é da Franqueadora.
- O módulo mora em **`/estoque`**, fora do Financeiro de propósito: dentista e
  TSB precisam da tela e não podem ver financeiro.

**BAIXA AUTOMÁTICA NA CONCLUSÃO DA SESSÃO (E3, 0217).** Mesmo gancho do repasse:
a sessão passa a `done`. Nenhuma tela nova para o dentista.

- **Concluir de novo não consome de novo** — índice único por (sessão, item).
- **Reabrir NÃO devolve o material**: ele foi usado de verdade; devolver ao
  saldo seria inventar gaze que não está mais na gaveta.
- **Nunca bloqueia**: sem saldo → negativo + alerta; sem kit → não consome.
- **O que não tem kit fica visível** (`sessions_without_kit`, 30 dias) — silêncio
  aqui vira rotina, e rotina vira saldo que ninguém confia.
- **O consumo é o PREVISTO, não o medido.** Usou duas anestesias? Registro
  avulso corrige. A tela declara isso.
- **O mesmo item em dois kits vira uma linha só** (soma antes de baixar).
- **Sem baixa retroativa**: ninguém sabe o que foi usado nas sessões antigas, e
  inventar consumo velho estragaria o custo médio de hoje.
- A conta do movimento saiu para `apply_stock_movement()` (sem guarda de papel);
  `post_stock_movement()` virou a porta com a guarda. **Uma conta só** — duplicar
  a matemática nos dois caminhos é como eles passam a divergir.

**VENDA DIRETA TAMBÉM BAIXA (0218).** Na venda direta a sessão é **criada
pronta** (`insert ... status='done'`), não criada e depois concluída — e os dois
gatilhos escutavam só `after update`. **O mesmo buraco estava no repasse do
FIN5:** procedimento vendido na venda direta nunca gerou repasse (68 sessões no
banco de teste, zero repasses, zero baixas). Agora ambos são `after insert or
update`, com `TG_OP` no lugar de `old.status` (ler OLD em INSERT levanta erro).
Sem apuração retroativa, por decisão do dono. **Regra:** gatilho de conclusão
tem de ouvir a CRIAÇÃO — há fluxo que nasce concluído.

**FRASCO ABERTO (0218/0219).** "2,78 ml de adesivo" é ficção: existe *1 frasco
pela metade*. Item marcado com `track_open_package` separa **fechados** de **em
uso**, e o consumo sai do aberto.

**ABRIR EMBALAGEM É ATO DE GENTE, NUNCA DO SISTEMA (0219 — correção do dono).**
A 0218 abria a seguinte sozinha quando a conta zerava, e a premissa estava
errada: o consumo do kit é **estimativa** (0,2 g de resina, 1 aplicação de
adesivo) e estimativa não sabe se o frasco acabou. Abrir sozinho faria o sistema
afirmar um fato físico que ele não conhece, e o saldo de fechados cairia por
conta própria. Agora `in_use_quantity` **pode ficar negativo** — é a estimativa
dizendo *"pela conta este frasco já deveria ter acabado"*, não um erro — e o
sistema **avisa** (`packages_running_out`) em vez de decidir.

**A troca de embalagem é o MOMENTO DA VERDADE.** `open_stock_package()` é
manual, e é onde a estimativa se acerta com a realidade: a sobra (ou a falta) da
anterior vira **ajuste com motivo**, em vez de ser arrastada para a próxima —
senão o erro de uma embalagem contamina todas as seguintes. O movimento
`abertura` é reclassificação: não move valor. A conta do custo não muda.

**ENVIAR PARA USO É PARA QUALQUER EMBALAGEM (0220).** Não é só resina e adesivo:
**caixa de sugador e pacote de algodão também saem inteiros** — ninguém retira 40
sugadores da caixa, retira a caixa. Botão em cada item (`units_per_purchase > 1`).
Regra única do consumo: **sai do que está EM USO; sem nada em uso, sai do
fechado** — com uma exceção deliberada para o item fracionado
(`track_open_package`), onde sai do "em uso" mesmo sem nada aberto, ficando
negativo: é o único jeito de dizer "usaram resina sem ninguém ter aberto tubo".
Para sugador isso seria ruído; para resina é a informação. **O que resta aparece
em PERCENTUAL** — "~35% do frasco" é honesto; "7 aplicações" sugere uma precisão
que a estimativa não tem. Enviar reforço **não** encerra a embalagem anterior; o
acerto só acontece quando ela é dada por encerrada.

**GORRO/MÁSCARA/PROPÉ — duas coisas diferentes (0218).**
- **Do paciente** (gorro, propé, babador) → **kit de atendimento**
  (`stock_kits.kind = 'atendimento'`), baixado **uma vez por atendimento**
  quando `appointments.attendance` vira `done`. Quem faz três procedimentos na
  mesma consulta não usa três gorros. Não se liga a procedimento.
- **Do profissional** (máscara e gorro dele) → item de **uso geral**
  (`general_use`), fora dos kits de procedimento, baixado por lançamento avulso
  quando a caixa vai para a sala. **O custo dele já está na HORA DE CADEIRA** do
  precificador: é estrutura. Rateá-lo por procedimento contaria duas vezes e
  inflaria o preço sugerido.

**A COMPRA ENTRA NA CONTABILIDADE (E4, 0221).** As duas metades da decisão:
**comprar não é gastar** (a nota vira conta a pagar em **6.1.01**, ativo, fora do
resultado) e **gastar é usar** (o consumo vira custo em **2.2.01**, na
competência do procedimento). Cada movimento também baixa o ativo, então o saldo
de 6.1.01 **é** o valor do estoque — e `stock_ledger_check()` compara com a
prateleira.

- **Perda não é custo de procedimento** (dono, 12/08/2026): consumo em
  **2.2.01**, quebra/vencimento/inventário em **2.2.02**. Juntos, o custo dos
  procedimentos subiria por material que caiu no chão, e o desperdício ficaria
  invisível dentro do custo do serviço. A conta 2.2 virou grupo.
- **Um lançamento por movimento**, não consolidado mensal: rastreabilidade é
  invariante do módulo. Consolidar depois é fácil; recuperar rastro não é.
- `register_stock_purchase()` cria nota, entradas e contas a pagar **numa
  transação** — se a conta a pagar falhasse depois das entradas, o estoque
  subiria sem a obrigação e a conferência nunca mais fecharia. As parcelas
  precisam fechar com o total da nota.
- **Limites declarados:** nota com serviço junto → só as linhas de estoque aqui,
  frete/serviço seguem em Contas a Pagar; **devolução ao fornecedor** fica de
  fora; **entrada manual não contabiliza** (não há documento nem obrigação) e a
  conferência mostra a diferença em vez de escondê-la; nada retroativo.

**INVENTÁRIO, REPOSIÇÃO E EXCESSO (E5, 0222).**

- **A DIFERENÇA É A INFORMAÇÃO**, não um erro a apagar: ela mede perda, furto,
  kit mal cadastrado e consumo fora do previsto. Por isso a contagem vira
  **movimento de ajuste com motivo**, nunca correção silenciosa do saldo.
- **A CONTAGEM CONGELA O ESPERADO** (`expected_quantity` na linha). Entre contar
  e aplicar pode haver atendimento; se o ajuste fosse "deixe o saldo igual ao
  contado", ele **apagaria esse consumo legítimo**. O ajuste é
  `contado − esperado no momento da contagem`.
- **Contar e corrigir são atos diferentes:** a folha fica `aberta` e só vira
  ajuste quando aplicada. Uma contagem aberta por unidade (`COUNT_ALREADY_OPEN`).
- **Sobra e falta aparecem separadas** — compensar as duas esconderia que faltou
  um item caro e sobrou um barato.
- **Acima do máximo é alerta** (`overstocked_items`): falta todo mundo olha,
  sobra ninguém olha — e é dinheiro parado, ou perda programada em material com
  validade.
- **Reposição em EMBALAGENS**, arredondada para **cima** (meia caixa não existe;
  faltar custa mais que sobrar um pouco). Sem máximo, o alvo é o **dobro do
  mínimo** — repor até o mínimo deixaria o item em alerta no dia seguinte.

**Ordem:** E1+E2 ✅ (cadastro, saldo, movimentos, kit) → **E3** ✅ baixa
automática → **E4** ✅ compra + razão → **E5** ✅ inventário, reposição e excesso.
**MÓDULO ESTOQUE COMPLETO** — mais a **leitura do XML da NF-e** (0223).

**MÓDULO COMPRAS — em construção** (plano em `docs/COMPRAS.md`, 12/08/2026;
descongelado ao fechar o FIN8). A regra que organiza tudo: **a negociação é da
rede, o dinheiro é da unidade** — a franqueadora consolida e negocia por todas,
mas cada unidade aprova, é faturada, paga e recebe a sua parte. Por isso o
**pedido** (por unidade e por fornecedor), e não a cotação, é o objeto que
carrega valor.

**AS TRÊS DECISÕES, RESOLVIDAS (17/08/2026):**

- **Papel novo `purchaser`** (Comprador da Franqueadora), não o Financeiro
  acumulando: **quem compra não é quem paga**, e separar as duas é controle
  interno básico.
- **Compra local PERMITIDA e marcada** (`is_local`). Proibir não impede a
  compra — faz ela sair do sistema, e aí some do estoque, do custo e do
  dashboard. Marcada, vira **vazamento medido**, que é o único que dá para
  reduzir.
- **A franqueadora pode alterar quantidades, com a mudança VISÍVEL** para a
  unidade aprovar — quem paga é ela. (Vale a partir do C2.)

**C1 — A NECESSIDADE (0238 + 0239).** `purchase_requests` +
`purchase_request_items`, código **`PC-`**.

- **A 0238 é só o papel**, separada de propósito: o Postgres não deixa
  adicionar e usar um valor de enum na mesma transação (mesma razão da 0184).
  **Rodar 0238 antes da 0239.**
- **A lista vem da `replenishment_list()` da E5** — quem decide o que falta
  continua sendo o Estoque; uma segunda régua aqui divergiria dele.
- **PREVISÃO EM TRÊS DEGRAUS, com a origem viajando junto:** última compra
  desta unidade → última compra da rede → custo médio. **Mostrar a origem do
  número faz parte do número** (mesma regra do repasse por nível e do custo do
  kit). Previsão com mais de 6 meses aparece marcada.
- **O preço é CONGELADO na linha.** É contra ele que a economia da negociação
  vai ser medida no C4; se ele se recalculasse, a economia mudaria de valor a
  cada abertura de tela.
- **Item sem preço NÃO impede o envio:** a franqueadora vai cotar de qualquer
  jeito, e exigir previsão travaria a primeira compra de um item novo.
- **Rascunho é da unidade** — a franqueadora só enxerga a partir de `enviada`,
  senão o gerente perde a liberdade de rascunhar.
- **Linha livre** (sem `item_id`) para o que não se estoca, com conta de despesa
  escolhida na hora: obrigar tudo a virar item encheria o catálogo de coisa que
  nunca terá saldo.

**C2 — A MESA DE NEGOCIAÇÃO (0240).** `purchase_rounds` +
`purchase_round_items` + `purchase_quotes` + `purchase_quote_items`, código
**`RC-`**. Só o **comprador**, o Admin e o Financeiro da Franqueadora entram: a
unidade vê a própria parte quando a rodada fecha, e mostrar a cotação dos
fornecedores ao franqueado seria entregar a negociação da rede para o outro lado
dela.

- **EM BRANCO NÃO É ZERO.** Fornecedor que não cotou fica com preço **nulo** e
  não concorre; **zero é um preço de verdade** (bonificação) e concorre.
  Confundir os dois faria a mesa premiar justamente quem não respondeu — e o
  pedido nasceria sem preço, por isso `award_round_item` **recusa** escolher
  quem não cotou.
- **Requisição entra em UMA rodada** (`REQUEST_NOT_AVAILABLE`): negociar a
  mesma necessidade duas vezes faria a unidade receber o item em dobro.
- **Item sem cotação nenhuma NÃO trava a rodada** — volta como não negociado e
  a unidade resolve local, caminho já medido pelo `is_local` do C1. Travar a
  mesa por causa de uma gaze a faria parar de existir.
- **Fechar sem nada escolhido é recusado** (`NOTHING_AWARDED`): isso não é
  fechar, é cancelar.
- **A franqueadora pode mudar a quantidade** (decisão 3 do dono), com motivo
  gravado ao lado do pedido original — a unidade vê a mudança ao aprovar no C3,
  porque é ela quem paga.
- **Rateio proporcional ao pedido, sobra para quem mais pediu** — mesma lei da
  última parcela de venda e da última depreciação. Sem ela, comprar 45 do que 47
  foi pedido deixaria fração espalhada e a soma das partes não bateria com o
  total comprado. A regra está em `allocate()` (TS, com teste) e espelhada no
  `round_allocation` (SQL).
- **A economia da rodada só conta item JÁ NEGOCIADO:** comparar previsão de item
  sem cotação contra zero mostraria 100% de economia que não existe. E economia
  **negativa aparece** — esconder faria o indicador só provar o que se quer.

**C3a — APROVAÇÃO E PEDIDO (0241).** `purchase_allocations` +
`purchase_orders` + `purchase_order_items`, código **`PD-`**.

- **A PARTE DA UNIDADE PASSA A SER GRAVADA** ao fechar a rodada. No C2 ela era
  calculada (`round_allocation`), e calculado não serve para aprovar: editar a
  rodada depois mudaria em silêncio o que a unidade já decidiu. Congelar é a
  mesma regra do preço previsto (C1), do repasse (0209) e da alçada (0194). A
  migração **grava também as rodadas já fechadas**, para não refazer teste.
- **UM PEDIDO POR UNIDADE E POR FORNECEDOR** — é ele que é faturado, pago e
  entregue naquele endereço.
- **Silêncio não vira aprovação:** sem decisão, o pedido não nasce. É dinheiro
  da unidade. `round_pending_approvals` mostra o silêncio para a franqueadora
  cobrar — mas cobrança é de gente, não automatismo.
- **Quem decide é o gerente da unidade**, não a franqueadora: ela negociou, mas
  quem paga é a unidade.
- **Item que já virou pedido não volta atrás** (`ALREADY_ORDERED`): desfazer
  exige cancelar o pedido, que é o documento.
- **Recusa com motivo visível.** Sem esse registro, o volume combinado com o
  fornecedor cairia sem ninguém saber por quê — e é o que derruba a negociação
  da rodada seguinte.
- **Pedido vazio é recusado** (`NOTHING_APPROVED`): criaria documento só para
  alguém cancelar depois.

**C3b — O RECEBIMENTO (0242).** `purchase_receipts` + `purchase_receipt_items`,
e o pedido guarda `received_quantity` por item.

- **O DINHEIRO SEGUE O CAMINHO QUE JÁ EXISTE:** o recebimento chama
  `register_stock_purchase` (0221) — o mesmo da compra avulsa. Ele já faz a
  entrada com conversão de embalagem, o custo médio, a compra virando ativo em
  6.1.01 e a conta a pagar. Um segundo caminho para "compra vira dívida" é como
  os dois passam a divergir.
- **A NOTA MANDA NO PREÇO, NÃO O PEDIDO.** Entra no estoque o valor da nota: é
  o que foi pago. Divergiu, **aceita e registra** — barrar deixaria o material
  fora do estoque e a clínica com saldo errado. A diferença alimenta
  `supplier_price_divergence`, que é o que a franqueadora leva para a próxima
  negociação. O preço do pedido fica **congelado** na linha do recebimento:
  corrigir o pedido depois apagaria a evidência.
- **Parcial é normal**; o pedido só fica `recebido` quando nada mais falta. E
  **sobra num item NÃO compensa falta em outro** — compensar esconderia a
  pendência com o fornecedor justamente onde ela precisa aparecer.
- **Quantidade a mais também entra:** o material está na prateleira, e o estoque
  tem de dizer a verdade.
- **Linha livre não vai para a prateleira** (não é material estocado), mas entra
  na conta a pagar como as demais.

**C4 — O PAINEL (0243).** Existe para provar ou derrubar a tese do módulo.

- **A ECONOMIA É CONTRA A PREVISÃO, NÃO CONTRA A REALIDADE**, e a tela diz isso.
  Previsão velha faz a economia parecer maior do que foi; apresentá-la como
  dinheiro medido seria provar a tese com a régua da própria tese.
- **Só item negociado entra na economia** — comparar previsão de item sem
  cotação contra zero mostraria 100% onde não houve compra.
- **Economia negativa aparece**: é o caso que derruba a tese, e esconder seria
  o pior uso possível do painel.
- **O vazamento tem dois caminhos**, e o segundo é o que importa: requisição
  marcada como local (declarada) e **compra lançada direto no Estoque sem
  pedido** (não declarada). O segundo é medido pela ausência de vínculo com
  recebimento; a diferença entre os dois separa decisão de hábito.
- **Zero não é ausência:** unidade sem compra nenhuma devolve nulo, não 0% de
  vazamento — senão ela pareceria exemplar por não ter comprado nada. Mesma
  regra no prazo de entrega e na taxa de entrega.
- **Prazo médio só conta o que já chegou:** pedido em aberto como zero faria o
  fornecedor lento parecer rápido.
- **Duas visões na mesma tela:** franqueadora vê a rede e escolhe unidade;
  gerente e franqueado veem só a própria. Mostrar ao franqueado quanto a rede
  economizou para ele é o argumento que sustenta a centralização.

**Ordem:** C1 ✅ → C2 ✅ → C3a ✅ → C3b ✅ → C4 ✅. **MÓDULO COMPRAS COMPLETO.**

**O PROBLEMA DA NOTA NÃO É LER, É SABER QUE ITEM É AQUELE.** O fornecedor
escreve `RESINA COMP Z350XT A2 4G 3M`; no cadastro está `Resina composta A2`.
Nenhuma regra de texto faz um virar o outro, e a mesma resina tem descrição
diferente em cada distribuidor. **Casar por nome é a maneira certa de gravar
material errado dando baixa em procedimento errado.**

**Casa-se por CÓDIGO, em três degraus:**
1. **GTIN** (`stock_items.gtin`) — identifica o produto **no mundo**, então um
   fornecedor novo já é reconhecido de primeira. Validado com dígito verificador:
   a NF-e aceita "SEM GTIN" e alguns emissores põem lixo no campo, e um GTIN
   inválido virando chave amarraria dois produtos ao mesmo item, em silêncio.
2. **CNPJ + `cProd`** (`supplier_item_links`) — aquele item naquele fornecedor.
3. **Descrição** — só **sugere**, nunca casa. E é a **confirmação de alguém** que
   cria o vínculo: por isso o sistema acerta mais a cada nota, em vez de errar
   mais.

**O de-para é DA REDE** (chaveado por CNPJ, não por `supplier_id`): o que Cambé
amarra uma vez, Londrina recebe pronto.

**A mesma nota não entra duas vezes** — `nfe_key` (44 dígitos) única por unidade;
importar de novo dobraria estoque **e** conta a pagar. **O XML fica no Storage**
(bucket privado `nfe`): é documento fiscal. **O XML é lido no NAVEGADOR**
(`DOMParser` nativo, sem dependência nova) e nada é gravado antes da conferência.

**Fora do escopo:** download automático da SEFAZ (exige certificado A1),
**PDF/DANFE** (exigiria OCR — errar número aqui contamina custo médio e preço de
todo procedimento) e notas de serviço.

**PADRÃO DE NOME DO NOSSO ITEM:** o que tem campo próprio **não** entra no nome
(marca, embalagem, fator, GTIN). `Resina composta A2`, não
`Resina 3M Z350 A2 seringa 4g` — senão o mesmo item vira dois no consolidado da
rede e ninguém descobre até o relatório sair errado.
**Transferência entre unidades** fica para o fim da E5 (os tipos já existem no
banco, sem tela). **Controle por lote** (baixa pelo que vence primeiro, recusa de
vencido) fica para depois da E3, por decisão do dono.

## 8d. FIN6 — DRE e Fluxo de Caixa (em construção)

**Decisões do dono (12/08/2026), na tela de perguntas:**

- **Depreciação = cadastro de bens**, não lançamento manual (ele escolheu contra
  a minha recomendação de prazo; a escolha é melhor a longo prazo — a DRE passa
  a consumir número calculado em vez de digitado).
- **Competência da DRE = liquidado + em aberto.** Previsto, estornado e
  cancelado ficam fora. A venda de março aparece em março mesmo que o cliente
  pague em junho — é a definição de competência.
- **Fechamento de período fica para o FIN7.** Trava é assunto de processo, e
  travar antes de conferir os primeiros meses só atrapalharia.
- **Centro de custo = filtro na mesma tela da DRE**, não relatório separado.

**BENS E DEPRECIAÇÃO (FIN6.0, 0224).** **Comprar um bem não é gastar** — mesma
regra do estoque. Cadeira de R$ 30 mil não afunda o mês da compra: nasce em
**6.2.01 (ativo)** e vira R$ 250/mês por dez anos em **5.2.01**, que é o que
custa usá-la.

- **Depreciação linear, e a ÚLTIMA PARCELA ABSORVE O RESÍDUO** — mesma regra das
  parcelas de venda. Sem ela, R$ 10.000 em 36 meses deixaria centavos órfãos e o
  bem nunca zeraria.
- **Começa no mês SEGUINTE à entrada em uso**, e `in_service_date` ≠ data da
  compra: equipamento comprado em dezembro e instalado em fevereiro deprecia a
  partir de março.
- **Depreciar de novo não duplica** (único por bem+mês) e **nunca deprecia além
  do custo**.
- **Vida útil com padrão por categoria, EDITÁVEL** — padrão que ninguém pode
  mudar vira número errado com cara de oficial. Valor residual **zero**.
- **Baixa** (`dispose_asset`) para a depreciação e joga o valor restante em
  **5.2.02**; sem ela o sistema depreciaria para sempre uma cadeira que foi para
  o lixo. **Limite declarado:** venda de bem registra a baixa contábil; o
  dinheiro recebido é lançado à parte.
- Código **`AT-`** — o código do documento nunca some.

**A DRE (FIN6.1, 0225).** Por **competência**: liquidado + em aberto, filtrado
por período e por centro de custo. Estrutura do documento base — receita bruta →
deduções → **receita líquida** → custos diretos → **lucro bruto** → despesas
operacionais → **EBITDA** → depreciação → resultado financeiro → **lucro
líquido**.

- **O SINAL VEM DA DIREÇÃO** (entrada soma, saída subtrai), então cada subtotal é
  soma acumulada. Sem isso seria preciso manter uma tabela "esta conta subtrai,
  aquela soma" em sincronia com o plano de contas — e ela ficaria desatualizada
  no dia em que alguém criasse uma conta.
- **Estorno some dos DOIS lados** (`status in (settled, open) and reversal_of is
  null`). Filtrar só por status deixaria o contra-lançamento sozinho, e a receita
  estornada entraria **com o sinal invertido**, virando despesa.
- **Fora da DRE:** 6 (ativos), **5.1** (comprar bem não é gastar — entra pela
  depreciação; contar os dois seria contar duas vezes), **5.3** (empréstimo é
  troca de dívida por caixa) e **5.4** (distribuição sai DEPOIS do lucro).
- **Análise vertical sobre a receita LÍQUIDA**, não a bruta: sobre a bruta toda
  unidade pareceria mais eficiente, e o erro seria maior onde o imposto é maior.
- **Comparação com período de MESMO tamanho** — comparar janeiro (31 dias) com
  fevereiro (28) mostraria queda que é só calendário.
- **Toda linha abre os lançamentos** até o documento (a invariante do FIN0
  finalmente na tela).
- **Verde = melhorou o resultado, sempre.** Como o sinal já vem da direção, não
  existe "linha boa quando sobe": custo caindo de −1.200 para −1.000 dá delta
  positivo igual a receita subindo.

**A DRE SOMAVA O DOBRO (0226 — correção da 0225).** Conferência no razão contra
os dados reais, antes de o dono terminar o teste. Duas causas independentes:

- **LIQUIDAÇÃO NÃO É FATO GERADOR.** O razão grava **duas linhas por venda**, de
  propósito desde o FIN0: competência (`installment_accrual`, sem `cash_date`) e
  caixa (`receipt_cash`, com `cash_date`). A 0225 somava as duas — parcela paga
  virava receita de novo, conta paga virava despesa de novo (R$ 4.416 + R$ 5.096
  das MESMAS parcelas). **Regra geral: relatório de competência lê uma linha,
  relatório de caixa lê a outra — nunca as duas.** `receipt_cash` e
  `payable_cash` são as duas únicas origens de pura liquidação; tudo o mais
  (multa, juros, taxa de adquirente, boleto, extrato conciliado) **nasce já
  pago e é o único registro do fato** — excluí-las apagaria a despesa.
- **VENDA CANCELADA CONTINUAVA COMO RECEITA** (43 parcelas, R$ 10.941). Contas a
  pagar já cancelavam o lançamento desde a 0194; o recebimento nunca fez.
  **Regra: toda mudança de status do documento tem de chegar ao razão** — o
  documento é a verdade, e relatório que lê razão desatualizado mente com cara
  de número oficial. Gatilho nos dois sentidos (descancelar devolve a receita) e
  guarda `paid_amount_cents = 0`: parcela cancelada que já recebeu mantém a
  receita, senão o dinheiro ficaria no caixa sem origem no resultado.
- **Renegociação não muda:** a parcela vira `renegociada` (≠ `cancelada`) e
  mantém o lançamento — a receita foi reconhecida na venda (regra da 0189).

**O FLUXO DE CAIXA (FIN6.2, 0227).** A outra pergunta, a que quebra clínica
lucrativa: **vai faltar dinheiro, e quando?** As duas metades vêm de lugares
diferentes, de propósito:

- **Realizado = o RAZÃO, pela `cash_date`** — exatamente o que a DRE passou a
  ignorar na 0226. Os dois relatórios leem o mesmo razão por metades opostas, e
  por isso nunca divergem da origem.
- **Previsto = os DOCUMENTOS** (parcelas e contas), pelo que **ainda falta**
  (valor − já pago). O razão guarda o valor CHEIO da parcela; projetar por ele
  faria a parcela de R$ 500 já recebida pela metade entrar como R$ 500.
- **Data do previsto = `expected_settlement_date`**, senão o vencimento: cartão
  liquida em D+30, e usar o vencimento mostraria o dinheiro um mês antes de ele
  existir.
- **VENCIDO NÃO ENTRA NA PROJEÇÃO** (decisão do dono): já falhou uma data;
  contá-lo de novo é como projeção de caixa mente para o lado otimista — e o
  erro otimista é o que quebra caixa. Aparece à parte, para ser cobrado.
- **Conta esperando autorização ENTRA na saída prevista**, ao contrário da DRE.
  Regras diferentes porque as perguntas são diferentes: para o resultado ainda
  não é despesa reconhecida; para o caixa é conta que quase certamente será paga.
- **O aviso sai da série DIÁRIA**, sempre — agrupado por mês, um buraco no dia 8
  coberto por um recebimento no dia 25 desapareceria, e é justamente ele que faz
  o cheque voltar.
- **Atividade:** operacional / investimento (5.1) / financiamento (5.3, 5.4).
  Separa "a operação gera caixa" de "fechou no azul porque vendeu uma cadeira".
- **Saldo de partida** = saldo inicial das contas bancárias (campo que a
  Conciliação já pede) + o caixa anterior. Sem conta cadastrada começa em zero
  **e a tela diz isso** — saldo incompleto declarado é honesto; inventado vira
  decisão errada.
- A conta (régua de dias vazios, saldo acumulado, agrupamento) mora em
  `src/lib/finance/cash-flow.ts`, com teste. O SQL devolve só os dias COM
  movimento.
- **Limites declarados na tela:** projeção bruta (a taxa da adquirente entra
  quando o dinheiro entra); sem calendário de feriados; conta recorrente só
  entra depois de gerada.

**`security definer` SEM GUARDA ENTREGA O DADO A QUEM CHAMAR (0227).** Função
`security definer` roda como dona do banco e **passa por cima do RLS** — a DRE,
o drill-down e a lista de bens nasceram sem checagem, então qualquer usuário
logado poderia ler o relatório de outra unidade pela API, mesmo sem enxergar a
tela. Agora existe **`can_see_clinic_finance(clinic_id)`**, uma função só, usada
por todos: guarda copiada solta vira duas versões da mesma régua.

**PONTO DE EQUILÍBRIO E A PONTE LUCRO × CAIXA (FIN6.3, 0228).**

- **Fixo × variável já existia** (`chart_of_accounts.cost_behavior`, semeado no
  FIN0 e **editável no Plano de contas**). Nenhuma coluna nova: a classificação
  é do dono, não do código — margem calculada sobre rótulo que ninguém pode
  corrigir vira número errado com cara de oficial.
- **DOIS pontos de equilíbrio, não um.** O contábil inclui a depreciação; o de
  **caixa** não. Respondem perguntas diferentes ("estou destruindo valor?" ×
  "vai faltar dinheiro este mês?"), e mostrar só um esconde a outra.
- **Receita financeira abate o custo fixo**, não entra na receita: somá-la à
  base inflaria o faturamento e faria o ponto parecer mais perto do que está.
- **Margem de contribuição ≤ 0 não tem ponto de equilíbrio** — a tela diz que o
  problema é preço ou custo direto, não volume. A conta daria um número
  negativo ou gigante, e um número absurdo com cara de resposta é pior que
  nenhum.
- **O dia da virada** ("passou do ponto por volta do dia 21") é declarado como
  régua, não previsão: o movimento não é igual todo dia.
- **A PONTE FECHA POR CONSTRUÇÃO.** Cada lançamento cai em um de três baldes —
  só competência, só caixa, ou os dois — e daí sai `caixa = lucro − (só
  competência) + (só caixa)`, porque a parte comum é a mesma soma dos dois
  lados. Existe `residualCents`: **se sobrar um centavo, a tela mostra qual
  lançamento escapou**, em vez de fechar com uma linha "outros" que esconde
  erro. Nada cai em balde genérico — conta sem categoria aparece pelo código.

**Ordem:** 6.0 bens ✅ → 6.1 DRE ✅ → 6.2 fluxo de caixa ✅ → 6.3 ponto de
equilíbrio ✅. **FIN6 fechado.**

## 8e. FIN7 — orçado × realizado, alertas e fechamento (em construção)

**Decisões do dono (17/08/2026), na tela de perguntas:**

- **A UNIDADE faz o seu orçamento; a franqueadora enxerga, não impõe.** Sem
  cascata rede→unidade: número que o gerente assumiu ele defende, número que
  caiu de cima ele explica.
- **Receita E despesa.** Sem meta de faturamento não dá para dizer se o mês foi
  ruim porque gastou demais ou porque vendeu de menos.
- **Realizado = COMPETÊNCIA**, o mesmo recorte da DRE. Comparar com o que já foi
  pago faria toda conta em aberto parecer economia, e o mês fecharia parecendo
  melhor do que foi.

**ORÇAMENTO (FIN7.1/7.2, 0229).** `budget_lines` por clínica/ano/mês/conta.

- **A META É GUARDADA COM O SINAL DO REALIZADO** (receita positiva, despesa
  negativa). Assim `realizado − orçado` positivo significa **sempre** "melhor
  que o previsto" — receita acima da meta e despesa abaixo dela dão o mesmo
  sinal. É a mesma lição da DRE: uma regra só, sem tabela de "nesta conta subir
  é bom, naquela é ruim". A tela mostra e recebe magnitude; o sinal é aplicado
  em **um lugar só** (`budget_sign` no banco, espelhado em `budgetSign` no TS).
- **Meta zero apaga a linha** — meta zerada e meta inexistente são a mesma
  coisa; guardar as duas mostraria "0,00" onde ninguém orçou.
- **Mês E acumulado do ano até ele.** Despesa não é uniforme: quem paga o seguro
  anual em março estoura março e fecha o ano no lugar. Comparar o acumulado
  contra a meta do ano INTEIRO diria que março está 75% abaixo, sempre.
- **Farol com folga configurável** (5% padrão, "estourou" acima do dobro):
  orçamento acertado no centavo não existe, e farol que acende com 1% ninguém
  olha.
- **Copiar o ano anterior + sugerir pela média de 3 meses**, nenhum dos dois
  sobrescrevendo meta já preenchida. Orçamento em branco não é preenchido: 12
  meses × 30 contas é trabalho que ninguém faz duas vezes. A sugestão é
  **rascunho declarado** — a média achata o sazonal.
- **Limite declarado:** orçamento sem centro de custo. Orçar por centro exigiria
  ratear realizado que hoje nasce sem centro, e rateio inventado é pior que
  ausência de rateio.

**ALERTAS (FIN7.3, 0230).** Quatro regras, uma vez por dia às 9h, por pg_cron:
orçamento de DESPESA passando de 90% da meta, caixa projetado ficando negativo,
faturamento atrás do ponto de equilíbrio perto do fim do mês, atraso acumulado
acima do limite.

- **ALERTA QUE REPETE TODO DIA É ALERTA QUE NINGUÉM LÊ.** `finance_alerts` guarda
  (unidade, regra, referência) e o aviso sai **uma vez**; só rearma quando a
  condição some e volta (`cleared_at`). Sem isso o gerente ganharia quatro
  notificações por dia até o fim do mês e ignoraria todas.
- **RODA SEM USUÁRIO — e isso obrigou uma separação.** No cron `auth.uid()` é
  nulo e toda guarda recusaria tudo. As contas foram para funções **`_raw`** (sem
  guarda) e as públicas viraram casca com a guarda — mesmo desenho de
  `apply_stock_movement` × `post_stock_movement`. **As `_raw` levam `revoke ...
  from public`:** no Postgres função nova nasce executável por TODO MUNDO, e uma
  conta sem guarda exposta assim entregaria o número de qualquer unidade.
- **O alerta de orçamento só vale para DESPESA** — 90% da meta de receita no meio
  do mês é notícia boa.
- **Quem recebe: só a unidade** (gerente e franqueado). Franqueadora fora: com
  200 unidades seriam centenas de avisos/dia, e rede é assunto de painel (FIN8).
- **`brl()` formata dinheiro sem depender do idioma do servidor** — `to_char`
  com `G`/`D` usa a configuração regional e o mesmo alerta sairia "1,234.56" ou
  "1.234,56" conforme o servidor.
- **A unidade ajusta os próprios limites** (`save_alert_settings`, porta estreita
  para as colunas de alerta); multa e juros continuam sendo regra da rede.

**A CASCATA DA `finance_settings` NUNCA FOI CASCATA (corrigido na 0230).** Ela
sempre disse resolver "campo a campo", mas as quatro colunas antigas eram NOT
NULL com padrão: toda linha de unidade já nascia com 2,00/1,00/0/half_up e o
`coalesce` nunca chegava na rede. Ficou escondido enquanto só a Franqueadora
criava linha de unidade; ao deixar a UNIDADE criar linha para ajustar alerta,
ela congelaria multa e juros nos padrões — mudança futura da rede jamais
chegaria nela, sem nada na tela denunciando. Colunas passaram a anuláveis e a
tela resolve contra a rede antes de exibir. **Regra: configuração em cascata só
funciona com coluna ANULÁVEL na linha que sobrescreve.**

**FECHAMENTO DE COMPETÊNCIA (FIN7.4, 0231).** A trava adiada no FIN6.

- **A trava NÃO vale para pagamento e recebimento.** Pagar hoje uma conta de
  janeiro não altera o resultado de janeiro (`receipt_cash`/`payable_cash` nem
  entram na DRE desde a 0226). Se pegasse nelas, fechar o mês quebraria a
  recepção no dia seguinte — e ninguém fecharia mês nenhum.
- **Nem toda alteração muda o resultado.** Conciliar escreve `reconciled_at` e
  não move um centavo; travar isso impediria conciliar o extrato de um mês
  fechado, que é justamente quando se concilia. O gatilho só reage a **valor,
  direção, conta, data de competência, status e centro de custo**.
- **Tirar de um mês fechado é tão proibido quanto pôr:** no UPDATE o guarda
  checa a data ANTIGA e a nova.
- **Quem fecha × quem reabre (decisão do dono, 17/08/2026):** a **unidade**
  fecha (é ela que sabe se terminou de lançar); a **franqueadora** reabre, com
  justificativa escrita. Trava que quem está travado destrava sozinho vira
  lembrete, não controle.
- **Não se fecha fora de ordem** nem mês que ainda não terminou. Mês anterior
  vazio não atrapalha (unidade que começou em março não precisa fechar janeiro).
- **A conferência NÃO bloqueia** — lista pendências e o botão vira "fechar mesmo
  assim". Bloquear faria o mês nunca fechar, que dá no mesmo que não ter trava.
  Só a **depreciação não rodada** é severidade alta: fechar sem ela deixa o
  resultado subestimado.
- **`financeErrorMessage`** (`src/lib/finance/errors.ts`) traduz os códigos do
  banco num lugar só, e devolve `null` no que não reconhece — erro novo nunca
  vira mensagem errada com cara de certa.

**Ordem:** 7.1/7.2 orçamento ✅ → 7.3 alertas ✅ → 7.4 fechamento ✅. **FIN7
fechado.**

## 8f. FIN8 — franqueadora, royalties e consolidação (em construção)

**TAXAS DA REDE E SPLIT (FIN8.1, 0232).** O `docs/COMERCIAL.md` §8 já dizia
"todo recebimento da unidade sofre split"; aqui ele existe.

- **A BASE É O DINHEIRO QUE ENTROU** (decisão do dono, 17/08/2026), não a
  competência. Cada BAIXA dispara o cálculo sobre o valor recebido. Desconto
  concedido já está embutido no que entrou; parcela nunca paga não gera taxa; e
  o franqueado confere olhando o extrato dele. **Eu tinha proposto apuração
  mensal sobre competência e estava errado** — a decisão já existia no doc.
- **Seis taxas:** royalty, fundo, centro de planejamento, comercial
  (percentuais, custo **variável**) + sistema e SDR (fixas mensais, custo fixo).
- **Cascata com exceção por unidade, e a linha guarda o MOTIVO** (`note`):
  configuração que diverge sem registro de por quê vira briga de memória seis
  meses depois. **Desligar ≠ apagar:** desligada é acordo ("esta unidade não
  paga royalty"); apagada é "não tem acordo próprio, segue a rede".
- **Padrão da rede semeado em ZERO** — taxa começa desligada até alguém decidir
  o número. Semear com percentual inventado faria a primeira baixa cobrar errado.
- **O percentual fica CONGELADO na baixa** (`split_charges.percent`): mudar a
  regra não recalcula o passado. Mesma lei do repasse (0209) e da alçada (0194).
- **O dinheiro anda pelo CONTAS A PAGAR** — uma conta por taxa por mês, que
  cresce a cada recebimento. É o caminho que já aparece no fluxo de caixa, entra
  na DRE e tem baixa com histórico; lançar por fora criaria um segundo caminho
  para o mesmo dinheiro. **Como `post_payable_accrual` não reescreve lançamento
  existente**, o refresh atualiza o valor do razão à mão — senão ele ficaria
  congelado no primeiro recebimento do mês.
- **RECEBER NUNCA PODE SER RECUSADO.** A taxa é competência; se o mês da baixa
  já está fechado (FIN7.4), o razão a recusaria e derrubaria junto o registro do
  recebimento — o oposto da regra do fechamento. Nesse caso a taxa cai no **mês
  aberto**, como nota que chegou atrasada.
- **A franqueadora não paga taxa a si mesma.** Unidade PRÓPRIA paga: a
  eliminação do intercompany é assunto do consolidado (8.2), não da cobrança.
- **Limites declarados:** ASAAS não plugado (hoje a unidade recebe tudo e paga
  pela conta; quando entrar, o mesmo cálculo vira o valor retido); do lado da
  franqueadora entra receita por competência **sem cobrança formal com parcela**
  — a baixa vem pela conciliação.

**TAXAS COMO DADOS + CAMPANHAS (FIN8.1b, 0233).** Pedidos do dono: cadastrar
taxa nova, inativar/excluir, e lançar campanhas por período.

- **Taxa virou DADO, não enum.** `network_fee_types` no banco; criar a sétima é
  operação de tela. Mesmo caminho dos centros de custo. **Sumiu a cópia da lista
  no TypeScript** — ela envelheceria no dia em que alguém cadastrasse uma nova,
  e a tela mostraria uma lista diferente da que o banco cobra.
- **As contas são ESCOLHIDAS, não inventadas:** quem cadastra aponta a conta de
  despesa da unidade e a de receita da franqueadora, entre as analíticas que já
  existem. Sistema que cria conta contábil sozinho faz o plano crescer sem
  ninguém olhar.
- **Inativar ≠ excluir.** Inativar para de cobrar e preserva o histórico;
  excluir só se **nunca cobrou** (senão `FEE_IN_USE`). As seis originais são
  `system`: nunca se apagam. Mesma regra do item de estoque (0215).
- **Natureza travada depois da primeira cobrança** (`KIND_LOCKED`): percentual
  virando fixo faria o histórico deixar de explicar o valor cobrado.
- **Campanha > acordo da unidade > padrão da rede.** Entre campanhas, a da
  unidade ganha da rede; empatou, a que começou por último — sem desempate,
  duas campanhas sobrepostas dariam resultado diferente a cada consulta.
- **Dois modos só:** `valor` (troca; 0 = isenção) e `desconto` (corta % do
  vigente). Mais modos dariam a mesma coisa por caminhos diferentes, e cada
  caminho é um lugar onde a conta pode divergir.
- **A campanha alcança VÁRIAS taxas (0234):** `fees text[]`, nulo/vazio =
  todas. Campanha de taxas escolhidas **ganha** de campanha "todas" — o mais
  específico manda. Sem chave estrangeira de propósito: `delete_network_fee_type`
  **recusa** apagar taxa que esteja em campanha (`FEE_IN_CAMPAIGN`), porque
  esvaziar a lista transformaria campanha de uma taxa em campanha de todas.
- **Seleção que mistura percentual e fixa não aceita o modo `valor`** — trocar
  por qual? A tela manda usar desconto, que vale para as duas naturezas.
- **Campanha não recalcula o passado** — o percentual congela na baixa; e a
  regra vale pelo **dia da baixa**, não pelo de hoje, então baixa lançada com
  atraso cobra o que valia quando o dinheiro entrou.
- `applyCampaign` no TS espelha `network_fee_for` no SQL (a tela precisa mostrar
  o efeito antes de salvar); os testes prendem os dois números.

**DESCONTO POR PONTUALIDADE (FIN8.1c, 0235).** Percentual por taxa, na mesma
cascata. Forma escolhida pelo dono: **conta nasce cheia, abatimento entra na
baixa** se paga até o vencimento (a alternativa era nascer com desconto e perdê-lo
no atraso, espelhando o PPR+).

- **É REDUÇÃO DE DESPESA, NÃO ENTRADA DE DINHEIRO:** crédito na própria conta de
  despesa (`payable_discount`), então a DRE mostra a despesa líquida e a ponte
  lucro × caixa continua fechando. Lançar como receita financeira faria a unidade
  parecer ter ganhado algo por pagar em dia — ela apenas gastou menos.
- **O outro lado cai junto** (`network_fee_discount`): a franqueadora reconheceu
  a receita cheia; sem o contra-lançamento ela ficaria inflada no valor dos
  descontos concedidos.
- **Incide sobre o SALDO**, não sobre o valor original — conta paga pela metade
  fora do prazo não ganha prêmio sobre a parte atrasada.
- **A tela sugere; o banco decide** (`DISCOUNT_NOT_ALLOWED` acima do concedido).
- **Mexe em fluxo que já roda em produção** (pagamento de conta): parâmetro novo
  com **padrão zero**, e `refresh_payable_payment` só muda quando há desconto de
  verdade. `paid + discount >= amount` é o que fecha a conta — sem isso, R$ 1.000
  pago com R$ 900 + R$ 100 ficaria "parcial" para sempre.
- Só para conta com `network_fee`: fornecedor tem desconto negociado caso a caso.

**CONSOLIDAÇÃO (FIN8.2, 0236).** Só a Franqueadora enxerga.

- **Resultado do Grupo** = franqueadora + unidades **próprias**; **Faturamento
  da Rede** = todas as unidades lado a lado, só para comparar. **Os dois não se
  somam** — a franqueadora ganha o royalty da franqueada, não a receita dela.
- **A ELIMINAÇÃO NÃO MUDA O LUCRO.** Despesa da unidade própria (−X) e receita
  da franqueadora (+X) já se anulam ao somar. O que ela conserta é o
  **faturamento**, que sem ela apareceria inflado dos dois lados. É isso que
  consolidar significa, e é o que a tela explica.
- **Quem é o par de quem:** despesa intercompany de unidade DO GRUPO sempre
  elimina (o outro lado é a franqueadora); **receita** intercompany da
  franqueadora só elimina quando veio de unidade do grupo — a de franqueada é
  dinheiro de fora, receita de verdade.
- **Limite declarado:** só elimina o rastreável até a conta de taxa
  (`network_fee_revenue`/`network_fee_discount`). Intercompany manual fica de
  fora **e a tela avisa**, em vez de eliminar por conta própria.
- **Drill-down por UNIDADE, não por lançamento:** no consolidado a pergunta é
  quem trouxe o número; o caminho até o documento continua na DRE da unidade.
- **`clinics.ownership` ganhou tela** (`set_clinic_ownership`). Existia desde o
  FIN0 sem interface — sem ela o grupo mostraria só a franqueadora para sempre e
  ninguém saberia por quê. **As três unidades estão como `franchised`.**

**PAINEL DA REDE (FIN8.3, 0237).** Onde os alertas da rede moram desde que ficou
decidido, no FIN7.3, que a franqueadora não entra na lista do sino.

- **O painel LÊ o que o motor de alertas já apurou**, não recalcula. Recalcular
  por unidade a cada abertura refaria a projeção diária de caixa — e poderia
  **divergir do aviso que a unidade recebeu**. Painel que discorda do aviso é
  confusão. Consequência assumida: mostra o retrato da última apuração, a tela
  diz isso, e há botão para apurar na hora.
- **Vermelho é só o que já dói** (caixa negativo previsto, taxa vencida);
  amarelo é o que ainda dá para resolver. Se tudo fosse vermelho o painel
  deixaria de ordenar prioridade — e a lista já vem ordenada por quem está pior.
- **Mês anterior não fechado é amarelo, não vermelho:** é processo atrasado, não
  dinheiro faltando.
- **Cobrança das taxas fecha o ciclo do 8.1** — a franqueadora cobrava e não
  tinha onde olhar quem pagou. **"Em aberto" desconta o abatimento por
  pontualidade:** cobrá-lo seria cobrar o que a própria rede concedeu.

**FIN8 fechado. O MÓDULO FINANCEIRO ESTÁ COMPLETO** (FIN0 → FIN8). A trava do 7.4 **não pode valer para pagamento e recebimento**:
pagar hoje uma conta de janeiro não muda o resultado de janeiro (desde a 0226
essas linhas nem entram na DRE), e travá-las quebraria o trabalho da recepção no
dia seguinte ao fechamento.

**Roadmap:** FIN0 fundação ✅ → FIN1 contas a receber ✅ → FIN2
renegociação ✅ → FIN3 contas a pagar ✅ → FIN4 conciliação ✅ → FIN4 conciliação OFX + adquirente →
FIN5 repasse/split → **Estoque** → **Rentabilidade por serviço** → FIN6 DRE+DFC
→ FIN7 orçado×realizado e alertas → FIN8 franqueadora/royalties/consolidação.
**Uma fase por vez, com plano aprovado antes do código.**

## 9. Convenções de trabalho com o proprietário (Jeferson)

- Ele **não é programador**: explicar decisões em linguagem simples (analogias
  ajudam), em **português do Brasil**.
- Antes de codar cada etapa: apresentar um **plano resumido e aguardar o OK**.
  Consultá-lo antes de escolhas difíceis de reverter.
- Ao final de cada etapa: dizer **exatamente como testar** (roteiro numerado).
- **Código com nomes em inglês; interface 100% em pt-BR.** Rotas em português
  (`/clientes`, `/admin/usuarios`).
- Ele não edita arquivos: para segredos, usar o fluxo da área de transferência
  (ele copia no painel, avisa, e o assistente lê via `Get-Clipboard`, valida e
  grava sem exibir). **Uma tarefa de clipboard por vez.**
