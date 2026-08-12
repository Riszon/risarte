-- =============================================================================
-- 0215 — KIT COM NOME PRÓPRIO + EDITAR/INATIVAR ITEM
-- -----------------------------------------------------------------------------
-- Teste do dono (11/08/2026):
--
--   "existem vários procedimentos que podem utilizar o mesmo kit... deve ter a
--    opção de selecionar vários procedimentos para vincular a um kit"
--   "deve ter como editar, pois uma marca pode ter mudado a quantidade que vem
--    em uma caixa... também deve ter a opção excluir/inativar um item"
--
-- 1) O KIT DEIXA DE SER FILHO DO PROCEDIMENTO.
--
-- Na 0213 o kit era uma lista presa a UM procedimento. "Kit restauração" servia
-- para restauração de 1, 2 e 3 faces — e manter três cópias iguais é garantia
-- de que uma vai ficar desatualizada sem ninguém perceber. Agora:
--
--   • kit tem NOME, e existe sozinho (criar, renomear, inativar);
--   • um kit se liga a VÁRIOS procedimentos;
--   • um procedimento pode ter MAIS DE UM kit — o básico ("luva, sugador,
--     babador") mais o específico. Sem isso, o básico seria copiado em todo
--     kit, que é o problema de novo com outro nome.
--
-- Cascata preservada: kit e vínculo podem ser da rede ou da unidade, e o
-- vínculo próprio da unidade VENCE o da rede (mesma regra de preço e protocolo).
--
-- NADA DO QUE ELE CADASTROU SE PERDE: cada kit da 0213 vira um kit nomeado
-- "Kit — <procedimento>", com os itens copiados e o vínculo já criado. As
-- tabelas antigas só são removidas DEPOIS da cópia, no mesmo script.
--
-- 2) EDITAR ITEM, COM DUAS TRAVAS QUE O BANCO IMPÕE.
--
--   • Mudar o FATOR não mexe no saldo: o saldo já está em unidades de consumo.
--     240 sugadores continuam 240; o fator novo vale para as próximas entradas.
--   • Mudar a UNIDADE DE CONSUMO é BLOQUEADO quando há saldo ou movimento.
--     Trocar "unidade" por "grama" num item com 240 em estoque transforma 240
--     sugadores em 240 gramas de nada — e leva junto o custo de todo
--     procedimento que usa o item. Erro que não dá para desfazer olhando.
--
-- 3) EXCLUIR = INATIVAR (mesma regra dos procedimentos). Item que já teve
--    movimento ou está num kit nunca é apagado: some das listas de lançamento e
--    o histórico continua inteiro. Apagar de verdade, só o que nunca foi usado.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O KIT COMO ENTIDADE
-- -----------------------------------------------------------------------------
create table if not exists public.stock_kits (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = kit da REDE (padrão cascata).
  clinic_id uuid references public.clinics (id),
  name text not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists stock_kits_scope_idx
  on public.stock_kits (clinic_id, name);

comment on table public.stock_kits is
  'Kit de consumo com nome próprio. Existe sozinho e se liga a vários '
  'procedimentos — copiar a mesma lista em cada procedimento é garantia de '
  'que uma das cópias fica desatualizada.';

create table if not exists public.stock_kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.stock_kits (id) on delete cascade,
  item_id uuid not null references public.stock_items (id),
  -- Na unidade de CONSUMO do item (0,2 grama de resina, 1 aplicação).
  quantity numeric(10,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (kit_id, item_id)
);

create table if not exists public.procedure_kit_links (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  kit_id uuid not null references public.stock_kits (id) on delete cascade,
  clinic_id uuid references public.clinics (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create unique index if not exists procedure_kit_links_unique
  on public.procedure_kit_links (procedure_id, kit_id, clinic_id)
  nulls not distinct;

create index if not exists procedure_kit_links_proc_idx
  on public.procedure_kit_links (procedure_id, clinic_id);

alter table public.stock_kits enable row level security;
alter table public.stock_kit_items enable row level security;
alter table public.procedure_kit_links enable row level security;

drop policy if exists "stock_kits_select" on public.stock_kits;
create policy "stock_kits_select" on public.stock_kits
  for select to authenticated using (true);

drop policy if exists "stock_kits_write" on public.stock_kits;
create policy "stock_kits_write" on public.stock_kits
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_manage_stock(clinic_id))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_manage_stock(clinic_id))
  );

drop policy if exists "stock_kit_items_select" on public.stock_kit_items;
create policy "stock_kit_items_select" on public.stock_kit_items
  for select to authenticated using (true);

drop policy if exists "stock_kit_items_write" on public.stock_kit_items;
create policy "stock_kit_items_write" on public.stock_kit_items
  for all to authenticated
  using (
    exists (select 1 from public.stock_kits k
            where k.id = kit_id
              and (public.is_admin_master() or public.is_finance_franchisor()
                   or (k.clinic_id is not null
                       and public.can_manage_stock(k.clinic_id))))
  )
  with check (
    exists (select 1 from public.stock_kits k
            where k.id = kit_id
              and (public.is_admin_master() or public.is_finance_franchisor()
                   or (k.clinic_id is not null
                       and public.can_manage_stock(k.clinic_id))))
  );

drop policy if exists "procedure_kit_links_select" on public.procedure_kit_links;
create policy "procedure_kit_links_select" on public.procedure_kit_links
  for select to authenticated using (true);

drop policy if exists "procedure_kit_links_write" on public.procedure_kit_links;
create policy "procedure_kit_links_write" on public.procedure_kit_links
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_manage_stock(clinic_id))
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or (clinic_id is not null and public.can_manage_stock(clinic_id))
  );

-- -----------------------------------------------------------------------------
-- 2) LEVAR O QUE JÁ EXISTE (antes de remover qualquer coisa)
-- -----------------------------------------------------------------------------
do $$
declare
  v_old record;
  v_new uuid;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'procedure_kits'
  ) then
    return;
  end if;

  for v_old in
    select k.id, k.procedure_id, k.clinic_id, k.created_by, p.name as proc_name
    from public.procedure_kits k
    join public.procedures p on p.id = k.procedure_id
  loop
    -- Já convertido numa execução anterior? (a migração é idempotente)
    if exists (
      select 1 from public.procedure_kit_links l
      where l.procedure_id = v_old.procedure_id
        and l.clinic_id is not distinct from v_old.clinic_id
    ) then
      continue;
    end if;

    insert into public.stock_kits (clinic_id, name, notes, created_by)
    values (
      v_old.clinic_id,
      'Kit — ' || v_old.proc_name,
      'Convertido do kit que era preso a este procedimento (0215). '
        || 'Pode ser renomeado e usado em outros.',
      v_old.created_by
    )
    returning id into v_new;

    insert into public.stock_kit_items (kit_id, item_id, quantity)
    select v_new, ki.item_id, ki.quantity
    from public.procedure_kit_items ki
    where ki.kit_id = v_old.id
    on conflict (kit_id, item_id) do nothing;

    insert into public.procedure_kit_links
      (procedure_id, kit_id, clinic_id, created_by)
    values (v_old.procedure_id, v_new, v_old.clinic_id, v_old.created_by);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3) OS KITS VIGENTES E O CUSTO
-- -----------------------------------------------------------------------------
-- Vínculo da UNIDADE vence o da REDE: se a unidade montou os seus, são só eles
-- que valem. Misturar os dois faria a unidade herdar de volta o que trocou.
create or replace function public.kits_for(
  p_procedure_id uuid,
  p_clinic_id uuid
)
returns table (kit_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select l.kit_id
  from public.procedure_kit_links l
  join public.stock_kits k on k.id = l.kit_id
  where l.procedure_id = p_procedure_id
    and k.active
    and l.clinic_id = p_clinic_id
  union all
  select l.kit_id
  from public.procedure_kit_links l
  join public.stock_kits k on k.id = l.kit_id
  where l.procedure_id = p_procedure_id
    and k.active
    and l.clinic_id is null
    and not exists (
      select 1 from public.procedure_kit_links l2
      where l2.procedure_id = p_procedure_id and l2.clinic_id = p_clinic_id
    );
$$;

grant execute on function public.kits_for(uuid, uuid) to authenticated;

-- Soma TODOS os kits ligados ao procedimento (básico + específico).
drop function if exists public.kit_cost_cents(uuid, uuid);

create or replace function public.kit_cost_cents(
  p_procedure_id uuid,
  p_clinic_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(round(ki.quantity * coalesce(b.avg_cost_cents, 0))), 0)::bigint
  from public.kits_for(p_procedure_id, p_clinic_id) f
  join public.stock_kit_items ki on ki.kit_id = f.kit_id
  left join public.stock_balances b
    on b.item_id = ki.item_id and b.clinic_id = p_clinic_id;
$$;

grant execute on function public.kit_cost_cents(uuid, uuid) to authenticated;

create or replace function public.refresh_kit_costs(
  p_clinic_id uuid,
  p_item_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
  v_cost bigint;
begin
  if p_clinic_id is null then return 0; end if;

  for v_row in
    select distinct l.procedure_id
    from public.procedure_kit_links l
    join public.stock_kit_items ki on ki.kit_id = l.kit_id
    where (l.clinic_id is null or l.clinic_id = p_clinic_id)
      and (p_item_id is null or ki.item_id = p_item_id)
  loop
    v_cost := public.kit_cost_cents(v_row.procedure_id, p_clinic_id);

    insert into public.procedure_costs (
      procedure_id, clinic_id, materials_cents, materials_source, updated_at
    ) values (
      v_row.procedure_id, p_clinic_id, v_cost, 'kit', now()
    )
    on conflict (procedure_id,
                 coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set materials_cents = excluded.materials_cents,
                  materials_source = 'kit',
                  updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.refresh_kit_costs(uuid, uuid) to authenticated;

-- Salvar o kit e seus vínculos de uma vez: a lista de itens e a lista de
-- procedimentos precisam mudar juntas, senão um kit pode ficar ligado a um
-- procedimento com os itens do estado anterior.
create or replace function public.save_stock_kit(
  p_kit_id uuid,
  p_clinic_id uuid,
  p_name text,
  p_notes text,
  p_items jsonb,
  p_procedure_ids uuid[],
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_kit_id;
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_proc uuid;
begin
  if not (
    public.is_admin_master() or public.is_finance_franchisor()
    or (p_clinic_id is not null and public.can_manage_stock(p_clinic_id))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'NAME_REQUIRED';
  end if;

  if v_id is null then
    insert into public.stock_kits (clinic_id, name, notes, active, created_by)
    values (p_clinic_id, btrim(p_name), nullif(btrim(coalesce(p_notes, '')), ''),
            p_active, v_user)
    returning id into v_id;
  else
    update public.stock_kits
       set name = btrim(p_name),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           active = p_active
     where id = v_id;
  end if;

  -- A lista de itens é uma FOTO do que se usa hoje; o histórico do consumo
  -- real vive em stock_movements.
  delete from public.stock_kit_items where kit_id = v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if (v_item->>'quantity')::numeric > 0 then
      insert into public.stock_kit_items (kit_id, item_id, quantity)
      values (v_id, (v_item->>'itemId')::uuid, (v_item->>'quantity')::numeric)
      on conflict (kit_id, item_id) do update
        set quantity = excluded.quantity;
    end if;
  end loop;

  -- Vínculos deste kit NO MESMO ESCOPO. Vínculo de outro escopo é de quem o
  -- criou; um não apaga o outro.
  delete from public.procedure_kit_links
   where kit_id = v_id and clinic_id is not distinct from p_clinic_id;

  if p_procedure_ids is not null then
    foreach v_proc in array p_procedure_ids loop
      insert into public.procedure_kit_links
        (procedure_id, kit_id, clinic_id, created_by)
      values (v_proc, v_id, p_clinic_id, v_user)
      on conflict do nothing;
    end loop;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_stock_kit(
  uuid, uuid, text, text, jsonb, uuid[], boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) AS TABELAS ANTIGAS SAEM (a cópia já foi feita acima)
-- -----------------------------------------------------------------------------
drop function if exists public.kit_for(uuid, uuid);
drop table if exists public.procedure_kit_items;
drop table if exists public.procedure_kits;

-- -----------------------------------------------------------------------------
-- 5) EDITAR O ITEM — com as travas no banco
-- -----------------------------------------------------------------------------
create or replace function public.save_stock_item(
  p_id uuid,
  p_name text,
  p_brand text,
  p_unit_of_measure text,
  p_purchase_unit text,
  p_units_per_purchase numeric,
  p_category text,
  p_notes text,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_old record;
  v_has_history boolean;
begin
  -- O catálogo é da REDE: quem cadastra insumo é a Franqueadora.
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  if p_units_per_purchase is null or p_units_per_purchase <= 0 then
    raise exception 'INVALID_FACTOR';
  end if;

  if v_id is not null then
    select * into v_old from public.stock_items where id = v_id;
    if v_old.id is null then raise exception 'ITEM_NOT_FOUND'; end if;

    -- MUDAR A UNIDADE DE CONSUMO COM SALDO OU HISTÓRICO É PROIBIDO.
    -- 240 sugadores não viram 240 gramas: o saldo, o custo médio e o custo de
    -- todo procedimento que usa o item passariam a significar outra coisa, sem
    -- nenhum aviso e sem como voltar olhando.
    if v_old.unit_of_measure is distinct from btrim(p_unit_of_measure) then
      select exists (
        select 1 from public.stock_movements where item_id = v_id
        union all
        select 1 from public.stock_balances
         where item_id = v_id and quantity <> 0
      ) into v_has_history;

      if v_has_history then
        raise exception 'UNIT_LOCKED';
      end if;
    end if;

    update public.stock_items
       set name = btrim(p_name),
           brand = nullif(btrim(coalesce(p_brand, '')), ''),
           unit_of_measure = btrim(p_unit_of_measure),
           purchase_unit = btrim(p_purchase_unit),
           -- O FATOR muda livremente: ele vale para as PRÓXIMAS entradas. O
           -- saldo já está em unidades de consumo e não se mexe.
           units_per_purchase = p_units_per_purchase,
           category = nullif(btrim(coalesce(p_category, '')), ''),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           is_active = p_active
     where id = v_id;
  else
    insert into public.stock_items (
      name, brand, unit_of_measure, purchase_unit, units_per_purchase,
      category, notes, is_active, created_by
    ) values (
      btrim(p_name), nullif(btrim(coalesce(p_brand, '')), ''),
      btrim(p_unit_of_measure), btrim(p_purchase_unit), p_units_per_purchase,
      nullif(btrim(coalesce(p_category, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''), p_active, (select auth.uid())
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_stock_item(
  uuid, text, text, text, text, numeric, text, text, boolean) to authenticated;

-- Excluir = INATIVAR quando o item tem passado. Apagar de verdade só o que
-- nunca foi usado — a mesma regra do catálogo de procedimentos (0039).
create or replace function public.delete_stock_item(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used boolean;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select exists (
    select 1 from public.stock_movements where item_id = p_id
    union all
    select 1 from public.stock_kit_items where item_id = p_id
    union all
    select 1 from public.stock_balances where item_id = p_id and quantity <> 0
  ) into v_used;

  if v_used then
    update public.stock_items set is_active = false where id = p_id;
    return 'inativado';
  end if;

  delete from public.stock_balances where item_id = p_id;
  delete from public.stock_items where id = p_id;
  return 'excluido';
end;
$$;

grant execute on function public.delete_stock_item(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.stock_kits) as kits,
  (select count(*) from public.stock_kit_items) as itens_em_kits,
  (select count(*) from public.procedure_kit_links) as vinculos,
  (select count(distinct procedure_id) from public.procedure_kit_links)
    as procedimentos_com_kit,
  (select count(*) from public.stock_items where is_active) as itens_ativos,
  (select count(*) from public.stock_items where not is_active) as itens_inativos;
