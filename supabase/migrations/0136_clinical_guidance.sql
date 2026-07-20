-- =============================================================================
-- Risarte Odontologia — Migration 0136 (Cockpit do Coordenador — Bloco B, refino)
-- Orientação da rede sobre Avaliação e Reavaliação.
--
-- O roteiro do cockpit é a ESTRUTURA (informativa) do fluxo — o coordenador não
-- preenche nada nele. Além disso, o Admin pode escrever uma orientação livre
-- sobre a avaliação e sobre a reavaliação, que o coordenador consulta rapidamente
-- no cockpit. Conteúdo da REDE (sem clinic_id): um texto por tipo.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.clinical_guidance (
  kind text primary key check (kind in ('avaliacao', 'reavaliacao')),
  content text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.clinical_guidance enable row level security;

-- Sempre existem as duas linhas (facilita o upsert e a leitura).
insert into public.clinical_guidance (kind, content)
values ('avaliacao', null), ('reavaliacao', null)
on conflict (kind) do nothing;

-- Leitura: qualquer usuário autenticado (é orientação geral, não sensível).
drop policy if exists "clinical_guidance_select" on public.clinical_guidance;
create policy "clinical_guidance_select" on public.clinical_guidance
  for select to authenticated
  using (true);

-- Escrita: só o Admin Master edita a orientação da rede.
drop policy if exists "clinical_guidance_write" on public.clinical_guidance;
create policy "clinical_guidance_write" on public.clinical_guidance
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());
