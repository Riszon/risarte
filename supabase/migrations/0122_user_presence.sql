-- =============================================================================
-- 0122 — Presença (H4.9 Chat Hub R2)
-- -----------------------------------------------------------------------------
-- "Visto por último": cada usuário atualiza seu last_seen_at enquanto está no
-- sistema (via touch_presence, chamado de tempos em tempos pelo cliente). O
-- "online agora" (bolinha verde) é feito com Supabase Realtime Presence (em
-- memória, não usa esta tabela). Idempotente.
-- =============================================================================

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;

-- Leitura do "visto por último" liberada a qualquer autenticado (uso interno).
drop policy if exists "user_presence_select" on public.user_presence;
create policy "user_presence_select" on public.user_presence
  for select to authenticated using (true);

-- Escrita só via RPC (SECURITY DEFINER) — cada um atualiza a própria linha.
create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_presence (user_id, last_seen_at)
  values ((select auth.uid()), now())
  on conflict (user_id) do update set last_seen_at = now();
$$;
grant execute on function public.touch_presence() to authenticated;
