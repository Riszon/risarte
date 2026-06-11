# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Visão do produto e expansão (regra de arquitetura)

Sistema de gestão da rede de franquias **Risarte Odontologia** (hoje 1 franqueadora + 2 unidades; meta: **200 unidades em 5 anos**). Este sistema será a base de gestão completa da rede: futuramente entram módulos de financeiro, RH, compras/estoque, marketing, prontuário completo e outros.

**Por isso, toda decisão de estrutura (banco, pastas, permissões, navegação) deve favorecer a adição de módulos sem retrabalho:**

- Novas áreas do sistema = novas rotas em `src/app/(app)/<modulo>/` com `actions.ts` próprio — nunca acoplar lógica de um módulo dentro de outro.
- Novas tabelas sempre com `clinic_id` + RLS usando os helpers existentes (`is_admin_master()`, `user_clinic_ids()`, `has_role_in_clinic()`, `is_network_viewer()`).
- Configurações que variam por unidade seguem o padrão cascata de `sla_settings` (linha com `clinic_id NULL` = padrão da rede; linha com `clinic_id` = sobrescrita da unidade). Vale para a futura tabela de preços.
- Navegação: itens novos entram no menu lateral (`src/components/app-sidebar.tsx`) filtrados por função — o menu já é orientado a permissões.
- Pensar em volume de 200 unidades: listas sempre com filtro por clínica e `limit`; nunca carregar a rede inteira numa tela operacional.

## Stack fixa (decidida — não trocar)

Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Supabase (PostgreSQL, Auth, Storage — região **São Paulo/sa-east-1** por LGPD) + deploy Vercel. Banco único multi-tenant.

## O que já está implementado (Etapas 1 e 2 do MVP)

- **Etapa 1 — Fundação:** projeto Next.js 16, tema Risarte (azul-marinho/off-white/dourado em `globals.css`), login com Supabase Auth (sem auto-cadastro; mensagens de erro genéricas), proteção de rotas em `src/proxy.ts`, migração 0001 (clinics, profiles, user_clinic_roles, audit_logs + RLS), repositório GitHub privado `Riszon/risarte`.
- **Etapa 2 — Cadastros:** menu lateral com **seletor de clínica ativa** (cookie `risarte_active_clinic`); área admin (CRUD de clínicas com botões separados Franqueadora/Unidade; criação de usuários via service-role, redefinição de senha, ativar/desativar, **uma função por clínica** por usuário); módulo de clientes (recepcionista cadastra/edita; toda visualização de ficha gera `audit_logs`); tela de SLAs (padrão da rede + sobrescrita por unidade); máscaras automáticas de CPF/CNPJ/telefone/CEP (`src/lib/masks.ts`, aplicadas no navegador E normalizadas no servidor); migrações 0002 e 0003.
- Padrões adotados (manter): server actions retornam `{ ok, error? }` com mensagens em pt-BR exibidas via toast; guarda de permissão no início de toda action; `logAudit()` após mutações e em acessos a dados de pacientes; `revalidatePath()` após gravar; formulários com `defaultValue` (não controlados) + FormData.

## Plano de fases — onde estamos

1. **MVP (atual):** ✅ etapa 1 (setup/auth/RBAC) → ✅ etapa 2 (cadastros + SLA) → **➡️ etapa 3: Jornada do Cliente (kanban por fase com tempo e alerta de SLA, agenda abrindo prontuário com fase + pilar, notificações de transição)** → etapa 4: módulo do Coordenador Clínico (avaliação, gravação após consentimento, fotos, upload, envio ao planejamento, aprovar/reprovar plano) → etapa 5: Centro de Planejamento (fila, diagnóstico, plano + alternativos, pilar, aprovação, orçamento por tabela de preços, contadores por Planner).
2. **Fase 2 (após MVP validado):** módulo comercial completo (apresentação com gravação, follow-up com histórico, integração **ASAAS** para pagamentos e **ZapSign** para assinaturas, mensagens WhatsApp pré-prontas de envio manual, regra de fechamento, NPS), transcrição/resumo por IA (serviço isolado e trocável), dashboards com metas.
3. **Fase 3 (futuro):** portal do cliente, automação WhatsApp (Business API), módulos de gestão.

**Rodada de refinamento visual (compromisso assumido):** ao final do MVP funcional, haverá uma rodada dedicada de design/layout/estética guiada pelo proprietário, tela por tela. Por isso, manter o visual sempre em camadas trocáveis: cores/identidade centralizadas nas variáveis CSS de `globals.css`, aparência nos componentes compartilhados de `src/components/ui/`, e lógica de negócio fora de ambos — para que mudanças estéticas nunca exijam retrabalho funcional.

Não avançar de etapa sem o OK do proprietário.

## Espinha dorsal: Jornada do Cliente Risarte

Máquina de estados com **7 fases**; cada cliente está sempre em uma fase + sub-etapa, com **tempo registrado em cada uma** (futura `journey_phase_history`):

1. Aquisição (fora do escopo por enquanto)
2. **Conversão Clínica** — recepção, consulta, coleta de dados (fotos, radiografias, escaneamento, áudio da consulta, transcrição/resumo); ao final, recepção agenda a apresentação comercial (SLA 48h)
3. **Centro de Planejamento (núcleo)** — diagnóstico → plano (+ alternativos) → pilar da Metodologia → aprovação do Coordenador → orçamento → sinaliza ao comercial (SLA 24h)
4. **Conversão Comercial** — apresentação online gravada; aceito → ZapSign + ASAAS; não aceito → follow-up com histórico. **Regra de ouro: só é venda com documentos assinados E pagamento confirmado** (ou boletos emitidos/enviados no boleto sem entrada)
5. **Início de Tratamento** — fechamento notifica a recepção automaticamente para agendar
6. **Reavaliação** — controle de qualidade; se precisar, volta à fase 3
7. **Acompanhamento** — prevenção, retornos, inativos, resgate

Toda transição de fase **notifica automaticamente a função responsável pelo próximo passo**. SLA estourado = **destaque visual evidente (badge vermelho)** em listas, kanban e agenda. Todo planejamento é classificado em **1 dos 6 pilares da Metodologia Risarte**: Diagnóstico, Planejamento, Saúde, Função, Estética, Prevenção. Agenda e prontuário exibem sempre fase da jornada + pilar.

## Matriz de funções (PODE / NÃO PODE)

| Função | PODE | NÃO PODE |
|---|---|---|
| **Recepcionista** | Cadastrar clientes; agendar apresentação comercial e acompanhar; receber notificação de fechamento p/ agendar início; solicitar anamnese e assinaturas; check-in/out | Avaliação clínica; diagnóstico/planejamento; alterar plano; apresentação comercial; fechamento |
| **Coordenador Clínico** | Ver agenda/fases (2,3,4,6); avaliação/reavaliação; gravar áudio da consulta; fotos/exames/escaneamento/radiografias; considerações; transcrição/resumo; enviar ao Centro de Planejamento; auxiliar o Planner; **aprovar/reprovar plano**; acompanhar jornada | Diagnóstico/planejamento; alterar plano; agendamentos; apresentação; fechamento |
| **Dentista Planner** | Ver agenda/fases; receber arquivos; diagnóstico; plano + alternativos; classificar pilar; solicitar aprovação ao Coordenador; gerar orçamento; sinalizar ao comercial | Avaliação clínica; agendamentos; contato direto com cliente; apresentação; fechamento |
| **Consultor Comercial** | Ver agenda/fases; receber plano+orçamento+resumo; preparar/realizar apresentação (com gravação); follow-up com histórico; pedir ajustes ao planejamento; pedir apoio à recepção/coordenador; renegociar; dar desconto; definir pagamento/parcelamento | Diagnóstico/planejamento; alterar plano; avaliação clínica; agendamentos |
| **Assistente Comercial** | Acompanhar fases 3 e 4; enviar documentos (ZapSign); enviar link de pagamento (ASAAS); acompanhar status; encaminhar cliente fechado à recepção | Diagnóstico/planejamento; avaliação; agendamentos; apresentação; negociação; alterar pagamento/parcelamento |
| **Gerente de Unidade** | Visão completa (leitura) + dashboard da sua unidade; SLAs e indicadores | Atos clínicos e comerciais; alterar planos |
| **Franqueadora/Rede** | Leitura + dashboard consolidado de TODAS as unidades; comparativos | Atos clínicos e comerciais |
| **Franqueado** | Leitura + dashboard da(s) unidade(s) que possui | Atos clínicos e comerciais |
| **Admin Master** | Tudo; cadastrar/personalizar usuários, clínicas e configurações | — |

No código: enums em `src/lib/roles.ts` (DB enum ↔ TS const ↔ rótulo pt-BR sempre em sincronia). Ao criar telas novas, aplicar esta matriz **na RLS** (barreira real) e na UI (esconder o que a função não pode).

## LGPD (obrigatório desde o MVP)

- Dados odontológicos = **dados sensíveis de saúde**: consentimento registrado (TCLE + termo LGPD com data/hora) antes de tratar; criptografia em trânsito e repouso; menor privilégio via RLS.
- **Gravação de consulta/apresentação só inicia após o consentimento do paciente estar registrado no sistema.**
- Exclusão de cliente = **anonimização/arquivamento** (status `anonymized`), nunca apagamento físico (guarda legal de prontuário). Não existe DELETE policy em `clients` de propósito.
- Todo acesso a prontuário/ficha gera registro em `audit_logs` (via `logAudit()` — só ids e metadados, **nunca** dados pessoais no campo `details`).
- Nunca expor dados de pacientes em logs, URLs ou mensagens de erro. Mídia futura: Supabase Storage com **URLs assinadas**, nunca públicas.
- Senha forte no login; estrutura pronta para 2FA futuro. Senhas criadas pelo admin: mínimo 6 caracteres com letras e números (decisão do proprietário).

## Regras de trabalho com o proprietário (Jeferson)

- Ele **não é programador**: explicar decisões em linguagem simples (analogias ajudam), em **português do Brasil**.
- Antes de codar cada etapa: apresentar um **plano resumido e aguardar o OK** dele. Consultá-lo antes de escolhas difíceis de reverter.
- Ao final de cada etapa: dizer **exatamente como testar** o que foi feito (roteiro numerado).
- **Código com nomes em inglês; interface 100% em português do Brasil.** Rotas em português (`/clientes`, `/admin/usuarios`) porque o usuário as vê.
- Ele não edita arquivos manualmente: para segredos, usar o fluxo da área de transferência (ele copia no painel, avisa, e o assistente lê via `Get-Clipboard` no PowerShell, valida e grava sem exibir). Uma tarefa de clipboard por vez.
- UI: visual limpo que transmita segurança; paleta azul-marinho, off-white e dourado discreto; responsivo (desktop e tablet); 100% via navegador.

---

## Commands

```powershell
npm run dev     # dev server at http://localhost:3000 (Turbopack, hot reload)
npm run build   # the verification gate: compiles + type-checks. Run before every commit.
npm run lint    # eslint (flat config)
npx shadcn@latest add <component>   # add UI components to src/components/ui/
```

There are no automated tests yet; `npm run build` (TypeScript strict) is the only check.

Machine quirks (this repo only exists on the owner's Windows 10 machine):
- Tool shells don't have Node on PATH. Prefix PowerShell commands with:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
- `api.github.com` is unreachable from this network: `gh` CLI does NOT work. Push with plain git over SSH (`git@github.com:Riszon/risarte.git`); repo-level operations (creating repos, PRs) must be done by the owner in the web UI.
- Database migrations are NOT applied by CLI. Write a numbered file in `supabase/migrations/`, copy it to the clipboard (`Get-Content -Raw <file> | Set-Clipboard`), and ask the owner to paste/Run it in the Supabase dashboard SQL Editor. Never renumber or edit an already-applied migration; write a new one.

## Architecture

Next.js 16 App Router + Supabase (Postgres/Auth/Storage, project `hvhbijctanrrkxhemlza`, sa-east-1). No separate backend: pages are server components querying Supabase directly; mutations are server actions colocated as `actions.ts` next to the route that uses them.

### Auth & multi-tenant RBAC (the core invariant)

Authorization is enforced twice, and only the database layer is trusted:

1. **Postgres RLS** (migrations 0001+): every business table has policies built on SECURITY DEFINER helper functions — `is_admin_master()`, `user_clinic_ids()`, `has_role_in_clinic(clinic_id, roles[])`, `is_network_viewer()`. These exist to avoid RLS recursion; reuse them in new policies instead of subquerying `user_clinic_roles` directly.
2. **App-side guards** (`src/lib/auth.ts`): `getSessionContext()` / `requireAdminMaster()` / `hasRoleInClinic()`. These exist for UX (hiding buttons, friendly errors) — never as the only barrier.

Role model: `profiles.is_admin_master` is a global flag; all other roles live in `user_clinic_roles` with a UNIQUE (user_id, clinic_id) — one role per clinic, different roles across clinics allowed. `profiles.email` is a synced copy of `auth.users.email` (kept by the `handle_new_user` trigger) so admin screens never touch the auth schema.

The "active clinic" the user is working in is a cookie (`risarte_active_clinic`, set via `src/lib/actions/session.ts`); `getSessionContext()` resolves and validates it. All clinic-scoped pages filter by `session.activeClinic.id`.

### Three Supabase clients — pick deliberately

- `src/lib/supabase/client.ts` — browser, anon key (login form, sign-out).
- `src/lib/supabase/server.ts` — server components/actions, anon key + user cookies; RLS applies. Default choice.
- `src/lib/supabase/admin.ts` — service-role key, **bypasses RLS**. Only inside server actions that already called `requireAdminMaster()`, and only for things RLS can't do (creating auth users, resetting passwords, ban/unban).

Session refresh + redirect of unauthenticated users happens in `src/proxy.ts` (Next 16 renamed middleware → proxy). Both `proxy.ts` and the server client tolerate missing env vars so the app renders a setup notice instead of crashing.

### Server action pattern

Every action: (1) guard with `requireAdminMaster()` or `hasRoleInClinic()`, (2) parse/normalize FormData (masks from `src/lib/masks.ts` are applied client-side as-you-type AND server-side before saving — same functions), (3) mutate, (4) `logAudit()` (`src/lib/audit.ts`, LGPD trail — ids only, never personal data in `details`), (5) `revalidatePath()`, (6) return `{ ok, error? }` with pt-BR error messages; the client component shows them via sonner toasts. Generic auth errors on purpose (never reveal whether an e-mail exists).

### Cascading settings (SLA, future price table)

`sla_settings` rows with `clinic_id NULL` are the network default; a row with a clinic_id overrides it for that unit (UNIQUE NULLS NOT DISTINCT (clinic_id, sla_key)). Resolution logic in `src/lib/sla.ts` (`resolveSla`). New network-wide configurable values should follow this same pattern.

### shadcn/ui here is Base UI, not Radix

- No `asChild`. Compose with `render={<Component />}` (children stay on the wrapper). Buttons rendering links need `nativeButton={false}`.
- `Select` must receive `items={[{ value, label }]}` on the root or the closed trigger shows the raw value instead of the label.
- `Select`'s `onValueChange` receives `string | null` — guard the null.
- `DropdownMenuLabel` is a GroupLabel: it crashes at runtime unless wrapped in `DropdownMenuGroup`.
- Menu items use `onClick`, not `onSelect`.

Brand theme (navy/off-white/gold) is CSS variables in `src/app/globals.css`, including a custom `--gold` token exposed as the `bg-gold` utility.
