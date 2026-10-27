-- =============================================================================
-- 0324 — GRUPOS DE PROCEDIMENTOS (pedido do dono, 27/10/2026)
-- Plano e decisões GP1–GP3: docs/procedimentos/GRUPOS-PLANO.md
--
-- O grupo é um ATALHO para lançar no plano ("Implante + prótese sobre
-- implante", "Canal + restauração"), NÃO um procedimento novo: não tem preço,
-- repasse, kit nem regra de dente. Ao usar o grupo, cada procedimento vira um
-- item normal do plano, pelas mesmas travas de sempre (catálogo, preço do
-- catálogo, dente — 0306 e 0311). Um "combinado" com preço próprio seria um
-- segundo catálogo, divergindo do primeiro no primeiro reajuste.
--
--   GP1: Admin Master E Planner criam e editam; os grupos são da REDE.
--   GP2: o item lançado guarda de qual grupo veio (a etiqueta no plano).
--   GP3: orçamento e apresentação continuam item a item (nada muda lá).
--
-- Idempotente.
-- =============================================================================

-- 1) Tabelas ------------------------------------------------------------------
create table if not exists public.procedure_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 120),
  description text check (description is null or length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Quem criou fica na trilha de alterações (0288); aqui, só a última mão.
  updated_by uuid references public.profiles (id),
  updated_at timestamptz
);
create unique index if not exists procedure_groups_name_uq
  on public.procedure_groups (lower(btrim(name)));

create table if not exists public.procedure_group_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.procedure_groups (id) on delete cascade,
  -- Sem cascata: excluir procedimento que está num grupo é recusado (a tela
  -- explica); o caminho é tirar do grupo ou desativar.
  procedure_id uuid not null references public.procedures (id),
  -- A ORDEM importa: o implante entra antes da prótese sobre implante, e a
  -- regra do dente (0311) aceita a prótese porque o implante já está planejado.
  sort_order smallint not null,
  quantity smallint not null default 1 check (quantity between 1 and 20),
  unique (group_id, procedure_id)
);
create index if not exists procedure_group_items_procedure_idx
  on public.procedure_group_items (procedure_id);

alter table public.procedure_groups enable row level security;
alter table public.procedure_group_items enable row level security;

-- Lê quem lê o catálogo (todo logado, como `procedures`). Gravar é SÓ pelas
-- funções abaixo — não há regra de escrita de propósito.
drop policy if exists procedure_groups_select on public.procedure_groups;
create policy procedure_groups_select on public.procedure_groups
  for select to authenticated using (true);
drop policy if exists procedure_group_items_select on public.procedure_group_items;
create policy procedure_group_items_select on public.procedure_group_items
  for select to authenticated using (true);

-- 2) A etiqueta no item do plano (GP2) ------------------------------------------
alter table public.treatment_plan_option_items
  add column if not exists procedure_group_id uuid references public.procedure_groups (id);
create index if not exists tpo_items_procedure_group_idx
  on public.treatment_plan_option_items (procedure_group_id)
  where procedure_group_id is not null;

-- A etiqueta só fica se o procedimento do item ESTÁ no grupo. Não recusa: na
-- cópia de um plano (nova versão), um grupo editado depois não pode derrubar o
-- item — ele entra sem a etiqueta.
create or replace function public.plan_item_group_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.procedure_group_id is not null
     and not exists (select 1 from public.procedure_group_items gi
                      where gi.group_id = new.procedure_group_id
                        and gi.procedure_id = new.procedure_id) then
    new.procedure_group_id := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_item_group_check() from public, anon, authenticated;
drop trigger if exists plan_item_group_trg on public.treatment_plan_option_items;
create trigger plan_item_group_trg
  before insert or update of procedure_group_id, procedure_id
  on public.treatment_plan_option_items
  for each row execute function public.plan_item_group_check();

-- 3) As portas de gravação (GP1: Admin Master e Planner) ------------------------
-- p_items: [{ "procedureId": uuid, "quantity": int }, ...] NA ORDEM de lançar.
create or replace function public.save_procedure_group(
  p_id uuid,
  p_name text,
  p_description text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_ordem int := 0;
  v_proc uuid;
  v_qtd int;
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'NAME_REQUIRED'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) < 2 then
    raise exception 'GROUP_NEEDS_TWO';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'GROUP_TOO_BIG'; end if;
  if exists (select 1 from public.procedure_groups g
              where lower(btrim(g.name)) = lower(btrim(p_name))
                and g.id is distinct from p_id) then
    raise exception 'GROUP_NAME_TAKEN';
  end if;

  if p_id is null then
    insert into public.procedure_groups (name, description, updated_by, updated_at)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), auth.uid(), now())
    returning id into v_id;
  else
    update public.procedure_groups
       set name = btrim(p_name),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           updated_by = auth.uid(),
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'GROUP_NOT_FOUND'; end if;
    delete from public.procedure_group_items where group_id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_ordem := v_ordem + 1;
    v_proc := nullif(v_item ->> 'procedureId', '')::uuid;
    v_qtd := coalesce(nullif(v_item ->> 'quantity', '')::int, 1);
    if v_qtd not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;
    if v_proc is null or not exists (select 1 from public.procedures p
                                      where p.id = v_proc and p.is_active) then
      raise exception 'PROCEDURE_NOT_ACTIVE';
    end if;
    if exists (select 1 from public.procedure_group_items gi
                where gi.group_id = v_id and gi.procedure_id = v_proc) then
      raise exception 'PROCEDURE_REPEATED';
    end if;
    insert into public.procedure_group_items (group_id, procedure_id, sort_order, quantity)
    values (v_id, v_proc, v_ordem, v_qtd);
  end loop;
  return v_id;
end;
$$;

-- Inativar para de oferecer no plano; o que já foi lançado não muda.
create or replace function public.set_procedure_group_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.procedure_groups
     set is_active = coalesce(p_active, false), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
end;
$$;

-- Excluir só o que NUNCA foi usado num plano (mesma regra do catálogo): a
-- etiqueta dos planos aponta para ele.
create or replace function public.delete_procedure_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.procedure_groups g where g.id = p_id) then
    raise exception 'GROUP_NOT_FOUND';
  end if;
  if exists (select 1 from public.treatment_plan_option_items i where i.procedure_group_id = p_id) then
    raise exception 'GROUP_IN_USE';
  end if;
  delete from public.procedure_groups where id = p_id;
end;
$$;

revoke execute on function public.save_procedure_group(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.set_procedure_group_active(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.delete_procedure_group(uuid) from public, anon, authenticated;
grant execute on function public.save_procedure_group(uuid, text, text, jsonb) to authenticated;
grant execute on function public.set_procedure_group_active(uuid, boolean) to authenticated;
grant execute on function public.delete_procedure_group(uuid) to authenticated;

-- 4) Auditoria (regra 7 do CLAUDE.md) -----------------------------------------
select public.audit_attach_all();
