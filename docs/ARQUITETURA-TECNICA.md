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

## Lições que já custaram bug (não repetir)

- **2ª FK para a mesma tabela = embeds ambíguos.** Quando `clients` ganhou
  `preferred_clinic_id` (2ª FK para `clinics`), todo embed `clinics ( name )`
  virou ambíguo (PGRST201) e quebrou listas/jornada. Desambiguar sempre com o
  nome da FK: `clinics!clients_clinic_id_fkey ( name )`.
- **Contagem de dias inteiros** usa subtração de data `(now()::date - col::date)`,
  NÃO `extract(day from interval)` (que só devolve o componente "dia").
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
