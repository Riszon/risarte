# Arquitetura técnica (convenções de código)

Detalhamento técnico que apoia o `CLAUDE.md`. Aqui ficam as regras de **código**
(o "como"); o `CLAUDE.md` guarda as regras de **produto e negócio** (o "o quê").
Identificadores em inglês; texto de interface em pt-BR.

## Estrutura

Next.js 16 App Router + Supabase (Postgres/Auth/Storage, projeto
`hvhbijctanrrkxhemlza`, sa-east-1). Não há backend separado: páginas são server
components que consultam o Supabase direto; mutações são server actions
colocadas em `actions.ts` ao lado da rota que as usa. Cada módulo novo =
`src/app/(app)/<modulo>/` com `actions.ts` próprio (nunca acoplar módulos).

## Autenticação e RBAC multi-tenant (invariante central)

Autorização é validada **duas vezes**, e só a camada do banco é confiável:

1. **RLS do Postgres** (migrações 0001+): toda tabela de negócio tem policies
   construídas sobre funções SECURITY DEFINER — `is_admin_master()`,
   `user_clinic_ids()`, `user_full_access_clinic_ids()` (inclui o escopo da
   Franqueadora), `has_role_in_clinic(clinic_id, roles[])`, `is_network_viewer()`,
   `is_planner()`, `is_sdr()`, `providers_with_access(clinic, role)`,
   `user_has_client_history_access()`. Existem para evitar recursão de RLS;
   **reusar nas policies novas** em vez de subconsultar `user_clinic_roles`.
2. **Guardas no app** (`src/lib/auth.ts`): `getSessionContext()` /
   `requireAdminMaster()` / `hasRoleInClinic()`. Servem para UX (esconder botões,
   erros amigáveis) — nunca como única barreira.

Modelo de papéis: `profiles.is_admin_master` é flag global; os demais papéis
ficam em `user_clinic_roles` com UNIQUE (user_id, clinic_id) — uma função por
clínica, funções diferentes em clínicas diferentes. `profiles.email` é cópia
sincronizada de `auth.users.email` (trigger `handle_new_user`) para as telas de
admin nunca tocarem o schema de auth.

A "clínica ativa" do usuário é um cookie (`risarte_active_clinic`, definido em
`src/lib/actions/session.ts`); `getSessionContext()` resolve e valida. Toda
página por clínica filtra por `session.activeClinic.id`. Refresh de sessão e
redirect de não autenticados acontecem em `src/proxy.ts` (no Next 16,
middleware virou proxy).

## Três clients Supabase — escolher de propósito

- `src/lib/supabase/client.ts` — navegador, anon key (login, logout).
- `src/lib/supabase/server.ts` — server components/actions, anon key + cookies
  do usuário; **RLS se aplica**. Escolha padrão.
- `src/lib/supabase/admin.ts` — service-role key, **ignora RLS**. Só dentro de
  actions que já chamaram `requireAdminMaster()`, e só para o que a RLS não faz
  (criar usuários de auth, redefinir senha, ban/unban).

## Padrão de server action

Toda action: (1) guarda com `requireAdminMaster()` / `hasRoleInClinic()`;
(2) parse/normaliza FormData (máscaras de `src/lib/masks.ts` aplicadas no
navegador enquanto digita **E** no servidor antes de salvar — mesmas funções);
(3) muta; (4) `logAudit()` (`src/lib/audit.ts`, trilha LGPD — só ids, **nunca**
dado pessoal em `details`); (5) `revalidatePath()`; (6) retorna `{ ok, error? }`
com mensagem pt-BR exibida via toast (sonner). Erros de auth genéricos de
propósito (nunca revelar se um e-mail existe).

## Configurações em cascata (SLA, prazos, futura tabela de preços)

Linhas com `clinic_id NULL` = padrão da rede; linha com `clinic_id` sobrescreve
para aquela unidade (UNIQUE NULLS NOT DISTINCT (clinic_id, key) + upsert
`onConflict`). Usado em `sla_settings` (`resolveSla` em `src/lib/sla.ts`) e
`inactivity_settings`. Todo novo valor configurável por unidade segue este padrão.

## shadcn/ui aqui é Base UI, não Radix

- Sem `asChild`. Compor com `render={<Component />}`. Botão que vira link precisa
  de `nativeButton={false}`.
- `Select` precisa de `items={[{ value, label }]}` na raiz, senão o trigger
  fechado mostra o valor cru em vez do rótulo.
- `onValueChange` do `Select` recebe `string | null` — tratar o null.
- `DropdownMenuLabel` quebra em runtime fora de um `DropdownMenuGroup`.
- Itens de menu usam `onClick`, não `onSelect`.

Tema da marca (navy/off-white/gold) = variáveis CSS em `src/app/globals.css`,
incluindo o token `--gold` exposto como utilitário `bg-gold`.

## Migrações — regras de ouro

- Arquivos numerados em `supabase/migrations/`. **Nunca renumerar nem editar uma
  migração já aplicada — escreva uma nova.**
- Não são aplicadas por CLI: copiar para a área de transferência e o dono cola/
  roda no SQL Editor do Supabase. **Copiar sempre em UTF-8:**
  `[System.IO.File]::ReadAllText('<path>', [System.Text.Encoding]::UTF8) | Set-Clipboard`
  — NÃO `Get-Content -Raw` (PS 5.1 lê UTF-8 como Latin-1 → mojibake gravado no
  banco). Isso estragou texto das migrações 0004/0006/0008; corrigido na 0009.
- **Escrever migrações idempotentes** (seguras para rodar de novo): `create table
  if not exists`, `drop policy/trigger if exists` + create, `create or replace
  function`, seeds com `on conflict do nothing`, cron em blocos `do $$ ...
  exception when others then null; end $$`. Regra: ao re-rodar, "already exists"
  = aquela parte já foi aplicada (seguir); qualquer OUTRO erro = reportar.

## Portão de entrega — SEMPRE em pasta separada

`npm test` e o build. **O build de verificação roda com `NEXT_DIST_DIR`:**

```bash
NEXT_DIST_DIR=.next-verify npm run build
```

`next build` e `next dev` gravam na MESMA pasta `.next`. O dono deixa o servidor
local aberto (`Iniciar Risarte.bat` → `next dev`) enquanto testa; rodar o build
por cima **sobrescreve o estado do servidor dele** e o sistema passa a dar **404
em páginas que existem**. O sintoma engana: parece bug da tela recém-entregue, e
não é — já custou um diagnóstico inteiro em `/financeiro/configuracao`.

`next.config.ts` lê `NEXT_DIST_DIR` com padrão `.next`, então a Vercel não muda.
Se o `.next` já tiver sido contaminado: fechar a janela do servidor, apagar
`.next` e reabrir.

## Conferir a migração ANTES de mandar rodar

```bash
node scripts/check-migrations.mjs 0233
```

O portão de entrega compila TypeScript e **não enxerga SQL**. Duas migrações
seguidas (0232 e 0233) chegaram ao dono com erro mecânico que o Postgres só
acusa na hora de rodar, e cada uma custou uma ida e volta. O script pega as duas
causas, e as duas estão cobertas por teste manual documentado no commit:

1. **`create or replace function` com retorno diferente** → *"cannot change
   return type of existing function"*. Precisa de `drop function` antes.
2. **`returns table (...)` com número de colunas diferente do que o SELECT
   devolve** → *"Final statement returns too many columns"*. Inclui o caso do
   `select *` sobre `(values ...) as t(a,b,c)`, em que a coluna de filtro vaza
   para o retorno.

O script **cala quando não tem certeza** (union, subconsulta na lista de
seleção): checagem que erra é pior que checagem que não existe.

## Conferência dos DADOS (camada 1 dos testes)

```bash
npm run check:dados
```

> **O dono NÃO roda isto no Supabase.** Ele confunde com migração, e já
> aconteceu: colou `npm run check:dados` no SQL Editor e recebeu *syntax
> error at or near "npm"*. Para ele existe o atalho **`Conferir Sistema.bat`**
> (clique duplo). Migração vai no Supabase; comando vai no computador — dizer
> qual é qual faz parte da entrega.

Lê o banco e verifica **10 invariantes** — que o razão está são, que o saldo do
estoque é a soma dos movimentos, que o rateio da rodada fecha, que a conta da
taxa bate com os splits. Só leitura; imprime apenas contagens e valores (LGPD).

**Por que não confere os relatórios:** `dre_lines`, `cash_flow_series` e
companhia exigem usuário logado (`can_see_clinic_finance`, 0227). Um script
fora do navegador não é ninguém, e elas devolveriam vazio — o que passaria como
"tudo certo" sendo cegueira. As telas ficam para as camadas 2 (varredura de
rotas) e 3 (Playwright ponta a ponta, com projeto Supabase de teste).

**As regras ficam em `scripts/invariant-rules.mjs`, puras e com teste**
(`src/lib/__tests__/invariants.test.ts`): cada uma é exercitada com o defeito
REAL que já chegou ao dono — a venda cancelada que continuava como receita, a
conta congelada no primeiro recebimento do mês. Conferência que ninguém provou
que dispara passa por cegueira, não por saúde.

O script avisa quando um assunto está **sem dados**: invariante que passou por
ausência não é invariante aprovada.

## Varredura das TELAS (camada 2)

```bash
npm run check:telas
```

> Atalho do dono: **`Conferir Telas.bat`** (clique duplo). **Precisa do
> `Iniciar Risarte` aberto** — a varredura abre as páginas de verdade, pelo
> servidor local. Se o servidor não responder, o script diz isso em vez de
> acusar o sistema de quebrado.

Abre **cada rota do sistema** com o acesso de **cada tipo de usuário** e pega a
classe de defeito que a camada 1 não alcança: página que quebra ao abrir, rota
que existe respondendo 404 (o caso de `/financeiro/configuracao`), e permissão
barrando quem devia entrar — ou liberando quem não devia.

**Como ela entra logada.** Era o buraco declarado da camada 1: as funções de
relatório exigem usuário e um script não é ninguém. O script pede ao Supabase,
com a chave de serviço, um **link de acesso de uso único** de um usuário que já
existe e troca o link por uma sessão — o mesmo caminho do "entrar pelo link do
e-mail", só que o link nunca sai dali. **Nenhuma senha guardada, nenhum usuário
criado, nada novo no banco.** Os cookies são montados pelo **próprio
`@supabase/ssr`**, o mesmo pacote que o app usa para lê-los: escrever o formato
à mão seria adivinhar detalhe interno que muda de versão, e a varredura passaria
a dizer "caiu no login" em toda tela.

**404 aqui quase nunca é rota faltando** — as telas usam `notFound()` como
resposta de "você não pode ver isto". Quem separa defeito de permissão é o papel
de quem pediu: **para o Admin Master, 404 é sempre bug**. Ele varre duas vezes,
na Franqueadora e na unidade, porque são caminhos diferentes no mesmo código.

**SER MANDADO EMBORA É SER BARRADO** — e a primeira versão da régua não sabia
disso. As guardas recusam de **três** jeitos: `notFound()`, `redirect("/")` e
**`redirect` para outra tela** (o gerente que pede o consolidado da rede cai na
DRE da própria unidade). Conhecendo só os dois primeiros, a varredura acusou
três telas **corretamente protegidas** de "abriram para quem não devia". Régua
que erra é pior que régua que não existe: ela manda consertar o que está certo.
`isBlocked()` cobre os três, e o teste do falso positivo foi provado quebrando a
função de propósito antes de valer.

**Um usuário por papel, e só serve quem tem AQUELE papel e mais nenhum.** Um
gerente que também é recepcionista em outra unidade responderia como gerente, e
a varredura concluiria que a recepção enxerga contas a pagar. Papel sem usuário
exclusivo aparece como **não conferido** — mesma regra da camada 1.

**Só julga o que está ESCRITO no `CLAUDE.md`** (`PERMISSION_RULES`): recepção
fora de contas a pagar e compras, dentista fora do financeiro, gerente fora do
consolidado da rede, comprador dentro da mesa de negociação. O resto é relatado
como observação. Inventar matriz de permissão aqui seria transformar palpite em
teste — e ele passaria a "provar" o chute.

`/login` entra na varredura de propósito: logado, ele tem de mandar para dentro.
É a prova, a cada perfil, de que a sessão do script realmente vale — sem ela
todas as páginas "passariam" por estarem protegidas.

**Só GET, nenhuma ação executada.** O único rastro é o log de auditoria que as
fichas já gravam ao serem abertas.

As regras ficam em `scripts/screen-rules.mjs`, puras e com teste
(`src/lib/__tests__/screens.test.ts`) — inclusive a que reconhece a tela que
responde **200 e renderiza erro** (o React engole a exceção no limite de erro, e
olhar só o número da resposta deixaria passar).

## Teste ponta a ponta (camada 3)

```bash
npm run test:e2e
```

**O app de teste sobe na porta 3100, com o BANCO DE TESTE** (projeto Supabase
separado, `.env.test.local`, fora do Git). O servidor do dono continua na 3000
apontando para produção: portas, pastas de compilação (`.next-test`) e bancos
diferentes. Um teste que criasse paciente no banco de verdade seria pior que
nenhum teste.

**A trava aparece três vezes de propósito** (`scripts/test-db.mjs`,
`playwright.config.ts`, `e2e/apoio.ts`): qualquer endereço que contenha o
projeto de produção derruba tudo antes do primeiro comando. Script que apaga
dados não pode depender de disciplina.

**A prova de que o app fala com o banco certo não compara endereço:** o
`global-setup` cria uma sessão assinada pelo projeto de teste e abre uma tela
protegida. Se o app estivesse apontando para outro projeto, a sessão seria
recusada e nenhum teste rodaria.

**Ferramentas do banco de teste:**

```bash
npm run migrar:teste   # aplica as migrações do zero (prova que elas reconstroem o sistema)
npm run seed:teste     # semeia o cenário: 3 clínicas, 1 usuário por papel, catálogo, kits
npm run reset:teste    # limpa o MOVIMENTO e mantém o cenário
```

**A limpeza não é luxo:** cada execução cria um paciente, e a recepção acumula
avisos modais de "agende a apresentação" que cobrem a tela. Depois de algumas
rodadas o teste passa a brigar com o próprio lixo que produziu — já travou uma
execução inteira esperando um botão atrás do modal.

**`.next-test` É APAGADA A CADA EXECUÇÃO** (`scripts/limpar-build-teste.mjs`,
chamado pelo `npm run test:e2e`). No fim da rodada o Playwright **mata** o
servidor de teste, às vezes no meio de uma compilação, e o que fica gravado não é
confiável: a execução seguinte responde **404 em páginas que existem** — o mesmo
sintoma do `.next` do dono, e engana igual (parece permissão negada ou rota que
sumiu). Custou uma investigação inteira em `/prontuarios/[id]` (26/08/2026).

**A limpeza roda ANTES do Playwright, nunca de dentro dele.** Tentar apagar no
`playwright.config.ts` derruba a suíte: o config é lido de novo por **cada
processo de trabalho**, já com o servidor no ar, e a pasta some debaixo dele
(`ENOENT: build-manifest.json` em tudo). Por isso o `Assistir Testes.bat` chama
`npm run test:e2e`, não `npx playwright test`.

**O AVISO MODAL JÁ DEIXOU A APLICAÇÃO INTEIRA INVISÍVEL.** Fechar dois avisos
empilhados deixava o invólucro com `aria-hidden="true"` para sempre: os
elementos continuam na tela e no HTML, mas somem da **árvore de
acessibilidade** — que é por onde o Playwright (e um leitor de tela) enxerga.
`getByRole` passava a não achar nada, com cara de "a página não carregou", e a
foto do erro mostrava o sistema inteiro funcionando.

**Corrigido em 27/08/2026** pelo `AccessibilityGuard` (montado no layout), que
apaga a marca sobrada **só quando não há nenhuma janela aberta**. A causa é a
contagem do Base UI (`markOthers.js`) descartando a tabela ao zerar; o
componente diz isso e sai inteiro quando a biblioteca corrigir. No E2E os avisos
continuam sendo fechados pelo **botão "Fechar"** e `garantirTelaVisivel` fica
como segunda rede.

**CRONÔMETRO NÃO SE DESENHA NO SERVIDOR.** `useNow()` (`src/lib/use-now.ts`)
devolve `null` no servidor e no primeiro desenho do navegador; quem usa mostra
um traço até lá. Perguntar as horas nos dois lados dá respostas diferentes, o
React derruba a árvore com *hydration mismatch*, e o console enche de erro em
toda abertura do Atendimento — **erro que sempre aparece é erro que ninguém
lê**, e a camada 2 procura exatamente marcas de erro na página.

**Regras que o E2E segue:**

- **Entrar por sessão pronta** (link de uso único), menos em UM teste que usa o
  formulário de login — senão a tela de login vira a parte mais testada do
  sistema. Trocar de papel **limpa a sessão anterior**: sem isso o teste prova
  que o coordenador consegue fazer o que é da recepção.
- **Esperar o BANCO confirmar, nunca o relógio.** Recarregar por tempo derrubou
  o teste do plano três vezes com tudo salvo corretamente: a tela voltava do
  servidor antes de o dado chegar lá.
- **Cada passo termina perguntando ao banco.** Tela que diz "salvo" com o
  registro errado por trás é o defeito que teste de aparência não pega.
- **Defeito conhecido vira teste que falha de propósito** (`test.fail()`), não
  comentário: quando a correção sai, ele fica verde e avisa que o contorno pode
  ser removido.
- Achado durante o teste **não interrompe o teste** — vai para
  `docs/CORRECOES-TESTES.md` com prova, e as correções saem em lote (combinado
  com o dono em 24/08/2026).

## Lições que já custaram bug (não repetir)

- **2ª FK para a mesma tabela = embeds ambíguos.** Quando `clients` ganhou
  `preferred_clinic_id` (2ª FK para `clinics`), todo embed `clinics ( name )`
  virou ambíguo (PGRST201) e quebrou listas/jornada. Desambiguar sempre com o
  nome da FK: `clinics!clients_clinic_id_fkey ( name )`.
- **Contagem de dias inteiros** usa subtração de data `(now()::date - col::date)`,
  NÃO `extract(day from interval)` (que só devolve o componente "dia").
- **`new Date("2026-09-05T14:00:00")` É LIDO NO FUSO DA MÁQUINA.** No
  computador do dono dá 14:00 no Brasil; na Vercel (UTC) vira 14:00Z, que é
  **11:00 aqui**. Achado em 05/09/2026, com três sintomas de uma vez: a agenda
  recusava remarcar para as próximas 3 horas dizendo *"horário no passado"*, o
  que passava era **gravado 3 horas antes**, e os horários livres das próximas
  3 horas sumiam da lista. **O defeito não existe na máquina de quem programa —
  só onde o sistema roda de verdade**, que é a forma mais cara de defeito.
  Hora de negócio é **relógio de parede brasileiro**: usar
  `instantFromBrazil()` / `startOfDayInBrazil()` / `weekdayOf()`
  (`src/lib/dates.ts`), nunca `new Date` com texto montado. **Há teste que
  varre `src/app` e reprova as duas formas** (`dates.test.ts`) — só código de
  servidor, porque no navegador o fuso é o da pessoa.
- **EXIBIR TAMBÉM TEM FUSO, e este é o irmão silencioso do de cima.**
  `data.toLocaleString("pt-BR")` formata no relógio da MÁQUINA: no servidor da
  Vercel, a Auditoria mostrou **15:07 quando eram 12:07** — o dono viu com o
  relógio novo da barra lateral ao lado, marcando a hora certa (05/09/2026).
  Mesma raiz do item acima, terceira aparição do assunto. Toda formatação leva
  **`timeZone` explícito** (ou usa `formatBrDateTime()` / `formatInBrazil()`),
  e `d.setHours(0,0,0,0)` vira **`startOfTodayInBrazil()` /
  `startOfDayOf(d)`** — zerar o relógio da máquina fazia "hoje" começar às 21h
  de ontem em toda tela com filtro de período. **Três testes varrem `src`** e
  reprovam a volta: a conta, a exibição e a janela do dia da agenda.
- **Nunca editar arquivo-fonte com PowerShell `-replace`** (corrompe acentos
  UTF-8) — reescrever com a ferramenta Write.
- **`$$` no texto de substituição do `String.replace` do JS vira UM `$`.** Um
  script de correção que reescrevia `limit 1;\n$$;` trocou o delimitador da
  função por `$;` e quebrou a migração 0239 **em silêncio** — o arquivo continua
  parecendo certo de relance. Ao mexer em SQL por script, montar o delimitador
  (`const D = "$" + "$"`) ou usar função de substituição, e **conferir depois**
  se o número de `$$` no arquivo continua par.
- **Recursão de RLS** em policies de `profiles`/`user_clinic_roles`: usar os
  helpers SECURITY DEFINER, nunca subconsultar a própria tabela.
