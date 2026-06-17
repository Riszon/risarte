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

## Lições que já custaram bug (não repetir)

- **2ª FK para a mesma tabela = embeds ambíguos.** Quando `clients` ganhou
  `preferred_clinic_id` (2ª FK para `clinics`), todo embed `clinics ( name )`
  virou ambíguo (PGRST201) e quebrou listas/jornada. Desambiguar sempre com o
  nome da FK: `clinics!clients_clinic_id_fkey ( name )`.
- **Contagem de dias inteiros** usa subtração de data `(now()::date - col::date)`,
  NÃO `extract(day from interval)` (que só devolve o componente "dia").
- **Nunca editar arquivo-fonte com PowerShell `-replace`** (corrompe acentos
  UTF-8) — reescrever com a ferramenta Write.
- **Recursão de RLS** em policies de `profiles`/`user_clinic_roles`: usar os
  helpers SECURITY DEFINER, nunca subconsultar a própria tabela.
