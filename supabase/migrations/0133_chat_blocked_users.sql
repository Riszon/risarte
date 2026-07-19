-- =============================================================================
-- 0133 — Bloqueio de usuário no Chat (decisão do dono: só Admin Master gerencia;
--        o bloqueado perde o acesso à tela de Chat inteira)
-- -----------------------------------------------------------------------------
-- Tabela simples: um usuário bloqueado por linha. RLS: o Admin Master gerencia
-- tudo; o próprio usuário pode LER só a sua linha (para a tela de Chat saber que
-- ele está bloqueado e mostrar o aviso). Idempotente.
-- =============================================================================

create table if not exists public.chat_blocked_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  blocked_by uuid references auth.users (id),
  reason text,
  created_at timestamptz not null default now()
);

alter table public.chat_blocked_users enable row level security;

drop policy if exists chat_blocked_select on public.chat_blocked_users;
create policy chat_blocked_select on public.chat_blocked_users
  for select to authenticated
  using (public.is_admin_master() or user_id = auth.uid());

drop policy if exists chat_blocked_write on public.chat_blocked_users;
create policy chat_blocked_write on public.chat_blocked_users
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());
