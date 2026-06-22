-- =============================================================================
-- Risarte Odontologia — Migration 0039 (LOTE F — F3.1: Procedimentos)
-- Enriquece o catálogo de procedimentos (antes "Tabela de Preços"):
--   - renomeia category → specialty (Especialidade)
--   - novos campos: tuss_code, min_price_cents, max_price_cents,
--     commission_percent, commission_fixed_cents, pillar
--   - código interno AUTOMÁTICO (PRC-00001) quando não informado
--   - histórico de alterações (procedure_changes)
--   - edição liberada para Admin Master E Dentista Planner
-- O comissionamento (% e/ou R$) é só configuração; a realização é condicionada à
-- CONCLUSÃO do procedimento (tratada no módulo de execução/financeiro, depois).
-- Idempotente.
-- =============================================================================

-- category → specialty (idempotente).
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'procedures'
      and column_name = 'category'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'procedures'
      and column_name = 'specialty'
  ) then
    alter table public.procedures rename column category to specialty;
  end if;
end $$;

alter table public.procedures
  add column if not exists specialty text,
  add column if not exists tuss_code text,
  add column if not exists min_price_cents integer,
  add column if not exists max_price_cents integer,
  add column if not exists commission_percent numeric(6, 2) not null default 0,
  add column if not exists commission_fixed_cents integer not null default 0,
  add column if not exists pillar public.methodology_pillar;

-- -----------------------------------------------------------------------------
-- Código interno automático (rede): sequência global → PRC-00001.
-- -----------------------------------------------------------------------------
create sequence if not exists public.procedure_code_seq;

create or replace function public.next_procedure_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return 'PRC-' || lpad(nextval('public.procedure_code_seq')::text, 5, '0');
end;
$$;

create or replace function public.handle_new_procedure_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.next_procedure_code();
  end if;
  return new;
end;
$$;

drop trigger if exists procedures_set_code on public.procedures;
create trigger procedures_set_code
  before insert on public.procedures
  for each row execute function public.handle_new_procedure_code();

-- -----------------------------------------------------------------------------
-- Histórico de alterações do procedimento.
-- -----------------------------------------------------------------------------
create table if not exists public.procedure_changes (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  description text not null
);
create index if not exists procedure_changes_proc_idx
  on public.procedure_changes (procedure_id);
alter table public.procedure_changes enable row level security;

drop policy if exists "procedure_changes_select" on public.procedure_changes;
create policy "procedure_changes_select" on public.procedure_changes
  for select to authenticated using (true);

drop policy if exists "procedure_changes_insert" on public.procedure_changes;
create policy "procedure_changes_insert" on public.procedure_changes
  for insert to authenticated
  with check (public.is_admin_master() or public.is_planner());

-- -----------------------------------------------------------------------------
-- Acesso de escrita: Admin Master E Dentista Planner (antes só Admin).
-- -----------------------------------------------------------------------------
drop policy if exists "procedures_write" on public.procedures;
create policy "procedures_write" on public.procedures
  for all to authenticated
  using (public.is_admin_master() or public.is_planner())
  with check (public.is_admin_master() or public.is_planner());

drop policy if exists "clinic_procedure_prices_write" on public.clinic_procedure_prices;
create policy "clinic_procedure_prices_write" on public.clinic_procedure_prices
  for all to authenticated
  using (public.is_admin_master() or public.is_planner())
  with check (public.is_admin_master() or public.is_planner());
