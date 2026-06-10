<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Risarte Odontologia — project conventions

- Multi-tenant system for a dental franchise. Single Supabase database; every
  business table carries `clinic_id` and has RLS enabled. Region sa-east-1 (LGPD).
- Code identifiers in English; ALL user-facing text in Brazilian Portuguese.
- Roles per clinic live in `user_clinic_roles` (a user can hold different roles
  in different clinics). Admin Master is a global flag on `profiles`.
- Next.js 16: route protection lives in `src/proxy.ts` (not middleware.ts);
  `cookies()`, `params`, `searchParams` are async-only.
- Supabase clients: `src/lib/supabase/client.ts` (browser) and
  `src/lib/supabase/server.ts` (server components/actions).
- DB schema changes go in `supabase/migrations/` as numbered SQL files.
- LGPD: dental records are sensitive health data. Never expose patient data in
  logs, URLs, or error messages. Media files use signed URLs only. Client
  deletion = anonymization, never physical delete. Audit access via `audit_logs`.
- The product owner is not a programmer: explain decisions simply (pt-BR),
  present a short plan before coding each stage, and wait for his OK.
