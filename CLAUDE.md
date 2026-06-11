# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

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

### Domain context

The product is a 7-phase client journey state machine for a dental franchise (Fase 2 Conversão Clínica → 3 Centro de Planejamento → 4 Conversão Comercial → 5 Início de Tratamento → 6 Reavaliação → 7 Acompanhamento), with every treatment plan classified into one of 6 "Metodologia Risarte" pillars. Enum labels for roles/clinic types live in `src/lib/roles.ts`; any new enum must keep DB enum ↔ TS const ↔ pt-BR label in sync. Routes are in Portuguese (`/clientes`, `/admin/usuarios`) because users see URLs; identifiers stay English.

### shadcn/ui here is Base UI, not Radix

- No `asChild`. Compose with `render={<Component />}` (children stay on the wrapper). Buttons rendering links need `nativeButton={false}`.
- `Select` must receive `items={[{ value, label }]}` on the root or the closed trigger shows the raw value instead of the label.
- `Select`'s `onValueChange` receives `string | null` — guard the null.
- `DropdownMenuLabel` is a GroupLabel: it crashes at runtime unless wrapped in `DropdownMenuGroup`.
- Menu items use `onClick`, not `onSelect`.

Brand theme (navy/off-white/gold) is CSS variables in `src/app/globals.css`, including a custom `--gold` token exposed as the `bg-gold` utility.
