# Trabalho em dois PCs — guia completo

Este projeto é trabalhado em **dois computadores**. Este guia é a fonte oficial
de como mantê-los iguais. O `CLAUDE.md` §0e resume as regras e guarda o
"Estado da última sessão"; o passo a passo fica aqui.

## 1. Como funciona (a ideia em uma frase)

**O código viaja pelo GitHub; o Syncthing leva só o que o Git não leva.**

| O quê | Por onde viaja | Por quê |
|---|---|---|
| Código, docs versionados, `CLAUDE.md`, migrações | **GitHub** (`git pull` / `git push`) | É a fonte oficial: tem histórico e junta trabalho sem perder nada |
| `.env.local`, `.env.test.local` | **Syncthing** | Têm senhas: não podem ir para o GitHub |
| Arquivos pesados da marca (`docs/marca/*.pdf`, `.ai`, `.zip`, `.png`, `extraido/`) | **Syncthing** | Grandes demais para o Git (`docs/marca/.gitignore`) |
| Backups (`backup-producao-*`), `senhas-ambiente-treino.txt` | **Syncthing** | Estão fora da pasta do código |
| `node_modules`, `.next*`, `test-results` | **Nenhum** — cada PC gera o seu | São recriados por `npm install` / build |
| `.git` | **Nenhum** — cada PC tem o seu | Sincronizar `.git` pelos dois lados corrompe o repositório |

**Por que o Syncthing NÃO pode copiar o código:** se ele copiar `CLAUDE.md` do
PC A para o PC B, o `git pull` no B encontra o arquivo "já mudado" sem commit e
**recusa atualizar**. Código por dois caminhos = conflito garantido.

## 2. Os dois PCs

| | PC Administrador | Notebook do Jeferson |
|---|---|---|
| Nome no Syncthing | `DESKTOP-4CFTCVB` | `Notebook do Jeferson` |
| ID no Syncthing (início) | `CNQWDBP` | `Q2EA3CG` |
| Pasta sincronizada | `C:\Users\Administrador\Risarte riSZon` | *(anotar na 1ª sessão)* |
| Chave SSH no GitHub | `risarte-pc-administrador` | *(anotar na 1ª sessão)* |
| Git / Node | 2.55 / 24.19 (18/09/2026) | *(anotar na 1ª sessão)* |

Pasta do Syncthing: ID `w2qx4-pqhzm`, rótulo **riSZon**. O código fica na
subpasta `risarte/` (remoto `git@github.com:Riszon/risarte.git`, branch `main`).

**Exigido nos dois:** Node **24** (é o que o CI usa), `core.autocrlf = true`,
chave SSH **própria** de cada PC cadastrada no GitHub, e o `.stignore` abaixo.

## 3. O `.stignore` (IGUAL nos dois PCs)

Fica na **raiz da pasta sincronizada** (a que contém a pasta oculta
`.stfolder`), com o nome exato `.stignore`. **O Syncthing não sincroniza este
arquivo** — cada PC tem o seu, e os dois precisam ter este conteúdo:

```
// Syncthing: o que viaja de um PC para o outro. MODELO OFICIAL em
// risarte/docs/DOIS-PCS.md — os dois PCs têm de ter este arquivo IGUAL.
// Ele NÃO é sincronizado pelo próprio Syncthing: cada PC tem o seu.
//
// Regra: o CÓDIGO (tudo dentro de risarte/) viaja SÓ pelo GitHub.
// O Syncthing leva apenas o que o Git não leva: os .env e os arquivos pesados
// da marca. Se o Syncthing também copiasse o código, o git pull do outro PC
// encontraria os arquivos "já mudados" e recusaria atualizar.
//
// A ordem importa: as linhas com ! (incluir) vêm ANTES da que ignora.

// Segredos locais (fora do Git de propósito)
!/risarte/.env.local
!/risarte/.env.test.local

// Arquivos pesados da marca (fora do Git de propósito — ver docs/marca/.gitignore)
!/risarte/docs/marca/extraido
!/risarte/docs/marca/*.pdf
!/risarte/docs/marca/*.ai
!/risarte/docs/marca/*.zip
!/risarte/docs/marca/*.png

// Todo o resto de risarte/ (código, .git, node_modules, .next...) fica de fora
/risarte/*

// Permissões do Claude Code são de cada PC (o nome já diz: "local")
/.claude/settings.local.json
```

**Ao mudar este modelo:** mudar aqui (commit), e aplicar à mão nos DOIS PCs.

**Arquivo novo fora do Git que precisa ir para o outro PC** (outro `.env`, outro
arquivo pesado): acrescentar uma linha `!` **acima** de `/risarte/*`, aqui e nos
dois `.stignore`. Sem isso ele fica só num PC.

## 4. Primeira vez no Notebook (uma vez só)

O PC Administrador foi preparado em 18/09/2026. No Notebook, **antes de
qualquer trabalho**:

**Passo 1 — `.stignore` (você, dono):**
1. Clique com o botão direito no ícone do SyncTrayzor (perto do relógio) e abra
   a janela dele.
2. Na pasta **riSZon**, clique em **Editar** → aba **Padrões a ignorar**
   (*Ignore Patterns*).
3. Apague o que houver, cole o texto da seção 3 inteiro e clique **Salvar**.

(Alternativa: criar o arquivo `.stignore` na pasta com o Bloco de Notas, em
"Salvar como", tipo **Todos os arquivos**, codificação **UTF-8**.)

**Passo 2 — abrir o Claude Code na pasta `risarte` e pedir:**
> "Primeira sessão neste PC depois da preparação do PC Administrador. Rode
> `git status` e `git pull` e depois siga a seção 4 de `docs/DOIS-PCS.md`."

**Passo 3 — o que o Claude faz a partir daí:**
1. `git status` **antes** do pull. Esperado: limpo (no máximo
   `.claude/settings.local.json`). **Se aparecer arquivo modificado**, PARAR e
   mostrar ao dono — ver "`git pull` recusou" na seção 7.
2. `git pull`. Chegam os commits do PC Administrador (`020f3de`, `960023c` e o
   que veio depois).
3. Conferir e anotar na tabela da seção 2:
   `git config --global core.autocrlf` (tem de ser `true`), `node -v` (24),
   `git --version`, o caminho da pasta sincronizada e o título da chave SSH
   deste PC em github.com/settings/keys.
4. Conferir o Syncthing (seção 6).
5. Comparar a memória local `risarte-producao-online` do Claude **deste** PC
   com `docs/PRODUCAO-ONLINE.md`, trazer para o documento o que faltar (nunca
   segredo) e, depois que o dono confirmar, apagar a memória.
6. Procurar outras memórias locais do projeto (`~/.claude/projects/*/memory/`)
   com informação que não esteja no repositório, e fazer o mesmo.
7. Commit + push, e atualizar "Estado da última sessão" no `CLAUDE.md` §0e.

## 5. Rotina de TODA sessão (nos dois PCs)

### Ao começar

1. **O outro PC encerrou direito?** Ler "Estado da última sessão" no
   `CLAUDE.md` §0e depois do pull. Se o último registro não for o do outro PC,
   ou o dono lembrar de trabalho sem push lá, **ligar o outro PC e fazer o push
   lá primeiro**. Nunca refazer à mão o trabalho que ficou no outro PC.
2. `git status` — tem de estar limpo. Se não estiver, PARAR e mostrar ao dono.
3. `git pull`.
4. Procurar `*.sync-conflict-*` na pasta sincronizada (fora de `node_modules`).
   Se houver, **avisar o dono e NÃO apagar sem a confirmação dele**.
5. Se o pull trouxe mudança em `package.json` ou `package-lock.json`, rodar
   `npm install`:
   ```bash
   git diff --stat "HEAD@{1}" HEAD -- package.json package-lock.json
   ```
   (Saída vazia = nada mudou, pular o `npm install`.)

### Ao encerrar

1. `npm run verificar` / `npm test` se houve mudança de código (portão normal).
2. Commit de **todo** o trabalho, mesmo incompleto. Trabalho em andamento que
   não pode ir ao ar vai num branch (`wip/<assunto>`) — lembrar que o `main`
   publica sozinho na Vercel.
3. `git push`. Conferir que `git status -sb` mostra `## main...origin/main`
   **sem** `[ahead N]`.
4. Atualizar "Estado da última sessão" no `CLAUDE.md` §0e (data, qual PC, o que
   foi feito, pendente, próximo passo) — e esse commit também vai no push.
5. Se mexeu em `.env.local`: esperar o Syncthing mostrar **Atualizado** (*Up to
   Date*) antes de desligar o PC.

### Regras

- **Nunca trabalhar nos dois PCs ao mesmo tempo.**
- **`.env.local` se edita num PC só por vez.** Ele não tem Git por trás: duas
  edições viram arquivo `sync-conflict`.
- Nada importante mora só nas memórias locais do Claude (`~/.claude`): vai para
  o `CLAUDE.md` ou para `docs/`.

## 6. Como conferir que o Syncthing está certo

Pelo SyncTrayzor: a pasta **riSZon** tem de mostrar **Atualizado** e o outro PC
**Conectado** (quando ligado).

Pelo Claude (lê a API local do Syncthing; não mostra a chave):

```powershell
[xml]$x = Get-Content "$env:LOCALAPPDATA\Syncthing\config.xml"
$h = @{ 'X-API-Key' = $x.configuration.gui.apikey }; $b = 'http://127.0.0.1:8384/rest'; $f = 'w2qx4-pqhzm'
Invoke-RestMethod -Method Post "$b/db/scan?folder=$f" -Headers $h | Out-Null; Start-Sleep 3
'risarte/CLAUDE.md','risarte/package.json','risarte/.env.local','risarte/docs/marca/LOGOS.ai' | ForEach-Object {
  $r = Invoke-RestMethod "$b/db/file?folder=$f&file=$([uri]::EscapeDataString($_))" -Headers $h
  "{0,-35} ignorado={1}" -f $_, $r.local.ignored }
```

Esperado: `CLAUDE.md` e `package.json` → `ignorado=True`; `.env.local` e
`LOGOS.ai` → `ignorado=False`. **Se `CLAUDE.md` der `False`, o `.stignore`
deste PC está errado ou faltando** — corrigir antes de trabalhar. (Se a
consulta não achar o arquivo, isso é "não consegui medir", não "está certo".)

Se o SyncTrayzor guardar a configuração em outro lugar, procurar `config.xml`
em `%LOCALAPPDATA%\Syncthing` ou `%APPDATA%\SyncTrayzor`.

## 7. Quando algo dá errado

**`git pull` recusou ("Your local changes would be overwritten" ou
"untracked working tree files would be overwritten").** Quase sempre o
Syncthing copiou código — o `.stignore` deste PC está faltando ou errado.
1. Não apagar nada. `git diff` e `git status` mostram o que mudou.
2. `git fetch` e comparar com o que está no GitHub:
   `git diff origin/main -- <arquivo>`. Saída vazia = o arquivo já é igual ao
   do GitHub (chegou pelo Syncthing), e é seguro descartar a cópia local para o
   pull passar — **com o OK do dono**.
3. Se houver diferença, é trabalho real: mostrar ao dono antes de qualquer
   coisa. Pode ser trabalho do outro PC que nunca teve push.
4. Corrigir o `.stignore` (seção 3) e conferir (seção 6).

**Arquivo `*.sync-conflict-*` apareceu.** O Syncthing recebeu duas versões do
mesmo arquivo. Mostrar ao dono os dois (o original e o de conflito), decidir
juntos qual fica. **Nunca apagar sem confirmação.**

**Esqueci o push no outro PC e ele está desligado.** Ligar o outro PC, fazer
commit + push lá, e só então `git pull` aqui. O Syncthing não traz o código
(de propósito).

**`git push` recusado ("rejected — fetch first").** O GitHub tem commit que
este PC não tem (sessão no outro PC sem pull aqui antes). `git pull` e depois
`git push`. Se o pull der conflito de conteúdo, mostrar ao dono.

**`git status` mostra muitos arquivos "modificados" sem ninguém ter mexido.**
Diferença de fim de linha entre os PCs. Conferir
`git config --global core.autocrlf` nos dois (tem de ser `true`).

**`git` ou `node` "não é reconhecido".** Fechar e reabrir o app do Claude (o
PATH novo só vale para janelas abertas depois da instalação). Enquanto isso,
prefixar os comandos com a linha do `CLAUDE.md` §2.

**PC novo ou reinstalado.** Instalar Git for Windows e Node 24
(`winget install --id Git.Git -e` e `winget install --id OpenJS.NodeJS.LTS -e`),
criar chave SSH própria (`ssh-keygen -t ed25519 -C "risarte-<nome-do-pc>"`),
cadastrar em github.com/settings/keys, criar o `.stignore` (seção 3), e só
depois conectar a pasta no Syncthing. Anotar o PC na tabela da seção 2.
