-- =============================================================================
-- 0223 — LEITURA DO XML DA NOTA FISCAL + DE-PARA DO ITEM
-- -----------------------------------------------------------------------------
-- O PROBLEMA NÃO É LER A NOTA, É SABER QUE ITEM É AQUELE.
--
-- O fornecedor escreve `RESINA COMP Z350XT A2 4G 3M`; no seu cadastro está
-- `Resina composta A2`. Nenhuma regra de texto faz um virar o outro — a mesma
-- resina tem descrição diferente em cada distribuidor, e às vezes muda de uma
-- nota para a outra do MESMO fornecedor. Tentar casar por nome é a maneira
-- certa de gravar material errado dando baixa em procedimento errado.
--
-- A SAÍDA É NÃO USAR O NOME. A nota traz CÓDIGOS, e código não muda:
--
--   1. GTIN (código de barras) — identifica o produto NO MUNDO. A mesma resina
--      tem o mesmo GTIN em qualquer fornecedor, então um fornecedor NOVO já é
--      reconhecido de primeira.
--   2. CNPJ do emitente + código do produto — identifica aquele item NAQUELE
--      fornecedor. Sempre existe, mesmo sem GTIN.
--   3. Descrição — só para SUGERIR na primeira vez. Nunca para decidir.
--
-- O de-para é DA REDE (chaveado por CNPJ, não por `supplier_id`): numa
-- franquia, o que Cambé amarra uma vez, Londrina já recebe pronto. Amarrar por
-- unidade faria cada uma reaprender o mesmo de-para.
--
-- E O SISTEMA NUNCA DECIDE SOZINHO NA PRIMEIRA VEZ: ele sugere, alguém
-- confirma, e é a confirmação que cria o vínculo.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O CÓDIGO DE BARRAS NO NOSSO ITEM
-- -----------------------------------------------------------------------------
alter table public.stock_items
  add column if not exists gtin text;

-- Parcial: itens sem GTIN são a maioria e não podem colidir entre si.
create unique index if not exists stock_items_gtin_unique
  on public.stock_items (gtin)
  where gtin is not null and btrim(gtin) <> '';

comment on column public.stock_items.gtin is
  'Código de barras (GTIN/EAN). É a chave que atravessa fornecedores: a mesma '
  'resina tem o mesmo GTIN em qualquer distribuidor. Também abre a porta para '
  'contar inventário com leitor.';

-- -----------------------------------------------------------------------------
-- 2) O DE-PARA — o que o fornecedor chama de X é o nosso item Y
-- -----------------------------------------------------------------------------
create table if not exists public.supplier_item_links (
  id uuid primary key default gen_random_uuid(),
  -- Só dígitos, como o resto do sistema guarda documento.
  supplier_cnpj text not null,
  supplier_code text not null,
  item_id uuid not null references public.stock_items (id) on delete cascade,
  -- Guardado para a tela mostrar "o fornecedor chama isto de…" e para ajudar
  -- quem for conferir um vínculo suspeito depois.
  last_description text,
  gtin text,
  times_used integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  unique (supplier_cnpj, supplier_code)
);

create index if not exists supplier_item_links_item_idx
  on public.supplier_item_links (item_id);

comment on table public.supplier_item_links is
  'De-para DA REDE: código do produto no fornecedor → nosso item. Chaveado por '
  'CNPJ e não por supplier_id porque o aprendizado de uma unidade serve a '
  'todas — numa franquia é isso que faz a automação valer a pena rápido.';

alter table public.supplier_item_links enable row level security;

drop policy if exists "supplier_item_links_select" on public.supplier_item_links;
create policy "supplier_item_links_select" on public.supplier_item_links
  for select to authenticated using (true);

drop policy if exists "supplier_item_links_write" on public.supplier_item_links;
create policy "supplier_item_links_write" on public.supplier_item_links
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor()
    or exists (select 1 from public.user_clinic_roles r
               where r.user_id = (select auth.uid())
                 and r.role = 'unit_manager'::public.user_role)
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor()
    or exists (select 1 from public.user_clinic_roles r
               where r.user_id = (select auth.uid())
                 and r.role = 'unit_manager'::public.user_role)
  );

-- Resolve as linhas da nota de uma vez: GTIN primeiro (vale entre
-- fornecedores), depois CNPJ + código.
create or replace function public.resolve_supplier_items(
  p_cnpj text,
  p_codes text[],
  p_gtins text[]
)
returns table (
  supplier_code text,
  item_id uuid,
  matched_by text
)
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select unnest(p_codes) as code,
           unnest(coalesce(p_gtins, array[]::text[])) as gtin
  )
  select
    l.code,
    coalesce(g.id, s.item_id),
    case when g.id is not null then 'gtin'
         when s.item_id is not null then 'fornecedor'
         else null end
  from lines l
  left join public.stock_items g
    on nullif(btrim(l.gtin), '') is not null
   and g.gtin = btrim(l.gtin)
   and g.is_active
  left join public.supplier_item_links s
    on s.supplier_cnpj = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')
   and s.supplier_code = l.code
  where coalesce(g.id, s.item_id) is not null;
$$;

grant execute on function public.resolve_supplier_items(text, text[], text[])
  to authenticated;

-- Criar/atualizar o vínculo. É a CONFIRMAÇÃO de alguém que o cria — nunca o
-- palpite do sistema.
create or replace function public.link_supplier_item(
  p_cnpj text,
  p_code text,
  p_item_id uuid,
  p_description text default null,
  p_gtin text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_id uuid;
begin
  if v_cnpj = '' or coalesce(btrim(p_code), '') = '' then
    raise exception 'INVALID_KEY';
  end if;

  insert into public.supplier_item_links (
    supplier_cnpj, supplier_code, item_id, last_description, gtin,
    times_used, last_used_at, created_by
  ) values (
    v_cnpj, btrim(p_code), p_item_id,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_gtin, '')), ''), 1, now(), (select auth.uid())
  )
  on conflict (supplier_cnpj, supplier_code) do update
    set item_id = excluded.item_id,
        last_description = coalesce(excluded.last_description,
                                    public.supplier_item_links.last_description),
        gtin = coalesce(excluded.gtin, public.supplier_item_links.gtin),
        times_used = public.supplier_item_links.times_used + 1,
        last_used_at = now()
  returning id into v_id;

  -- O GTIN da nota também enriquece o nosso item, quando ele ainda não tem —
  -- é o que faz o próximo fornecedor ser reconhecido de primeira.
  if coalesce(btrim(p_gtin), '') <> '' then
    update public.stock_items
       set gtin = btrim(p_gtin)
     where id = p_item_id
       and coalesce(btrim(gtin), '') = ''
       and not exists (select 1 from public.stock_items o
                       where o.gtin = btrim(p_gtin) and o.id <> p_item_id);
  end if;

  return v_id;
end;
$$;

grant execute on function public.link_supplier_item(text, text, uuid, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A MESMA NOTA NÃO ENTRA DUAS VEZES
-- -----------------------------------------------------------------------------
alter table public.stock_purchases
  add column if not exists nfe_key text,
  add column if not exists xml_path text;

-- A chave da NF-e tem 44 dígitos e identifica a nota no país inteiro. Sem esta
-- trava, subir o arquivo de novo dobraria o estoque E a conta a pagar — e a
-- conferência com a prateleira nunca mais fecharia.
create unique index if not exists stock_purchases_nfe_key_unique
  on public.stock_purchases (clinic_id, nfe_key)
  where nfe_key is not null;

comment on column public.stock_purchases.xml_path is
  'Caminho do XML no Storage. É documento fiscal: guardar permite reconferir a '
  'origem de qualquer número depois.';

-- A assinatura muda (chave + xml), então precisa cair antes.
drop function if exists public.register_stock_purchase(
  uuid, uuid, text, date, jsonb, jsonb, uuid, text);

create or replace function public.register_stock_purchase(
  p_clinic_id uuid,
  p_supplier_id uuid,
  p_invoice_number text,
  p_issue_date date,
  p_items jsonb,
  p_installments jsonb,
  p_cost_center_id uuid default null,
  p_notes text default null,
  p_nfe_key text default null,
  p_xml_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase uuid;
  v_payable uuid;
  v_item jsonb;
  v_inst jsonb;
  v_total bigint := 0;
  v_line bigint;
  v_user uuid := (select auth.uid());
  v_when date := coalesce(p_issue_date, public.today_br());
  v_count integer := 0;
  v_key text := nullif(regexp_replace(coalesce(p_nfe_key, ''), '\D', '', 'g'), '');
begin
  if not public.can_manage_stock(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS';
  end if;
  if p_installments is null or jsonb_array_length(p_installments) = 0 then
    raise exception 'NO_INSTALLMENTS';
  end if;

  if v_key is not null and exists (
    select 1 from public.stock_purchases
    where clinic_id = p_clinic_id and nfe_key = v_key
  ) then
    raise exception 'NFE_ALREADY_IMPORTED';
  end if;

  insert into public.stock_purchases (
    clinic_id, supplier_id, invoice_number, issue_date, notes, created_by,
    nfe_key, xml_path
  ) values (
    p_clinic_id, p_supplier_id,
    nullif(btrim(coalesce(p_invoice_number, '')), ''), v_when,
    nullif(btrim(coalesce(p_notes, '')), ''), v_user,
    v_key, nullif(btrim(coalesce(p_xml_path, '')), '')
  )
  returning id into v_purchase;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := round((v_item->>'packages')::numeric
                    * (v_item->>'packageCostCents')::numeric)::bigint;
    v_total := v_total + v_line;
    v_count := v_count + 1;

    perform public.apply_stock_movement(
      p_clinic_id => p_clinic_id,
      p_item_id => (v_item->>'itemId')::uuid,
      p_kind => 'entrada',
      p_movement_date => v_when,
      p_source_type => 'purchase',
      p_source_id => v_purchase,
      p_purchase_quantity => (v_item->>'packages')::numeric,
      p_purchase_unit_cost_cents => (v_item->>'packageCostCents')::bigint,
      p_lot_code => nullif(v_item->>'lotCode', ''),
      p_expires_at => nullif(v_item->>'expiresAt', '')::date,
      p_supplier_id => p_supplier_id,
      p_invoice_number => nullif(btrim(coalesce(p_invoice_number, '')), '')
    );

    -- APRENDE: a confirmação de quem importou vira o vínculo da próxima nota.
    if coalesce(v_item->>'supplierCode', '') <> ''
       and coalesce(v_item->>'supplierCnpj', '') <> '' then
      perform public.link_supplier_item(
        v_item->>'supplierCnpj',
        v_item->>'supplierCode',
        (v_item->>'itemId')::uuid,
        v_item->>'supplierDescription',
        v_item->>'gtin'
      );
    end if;
  end loop;

  update public.stock_purchases set total_cents = v_total where id = v_purchase;

  for v_inst in select * from jsonb_array_elements(p_installments)
  loop
    v_payable := public.save_payable(
      p_clinic_id => p_clinic_id,
      p_supplier_id => p_supplier_id,
      p_account_code => '6.1.01',
      p_cost_center_id => p_cost_center_id,
      p_description => 'Compra de material'
        || case when coalesce(btrim(p_invoice_number), '') <> ''
                then ' — NF ' || btrim(p_invoice_number) else '' end
        || ' (' || v_count || ' item'
        || case when v_count = 1 then '' else 'ns' end || ')',
      p_amount_cents => (v_inst->>'amountCents')::bigint,
      p_due_date => (v_inst->>'dueDate')::date,
      p_accrual_date => v_when,
      p_document_number => nullif(btrim(coalesce(p_invoice_number, '')), '')
    );

    update public.payables set stock_purchase_id = v_purchase
     where id = v_payable;
  end loop;

  return v_purchase;
end;
$$;

grant execute on function public.register_stock_purchase(
  uuid, uuid, text, date, jsonb, jsonb, uuid, text, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) ONDE O XML FICA GUARDADO
-- -----------------------------------------------------------------------------
-- Documento fiscal: guardar permite reconferir a origem de qualquer número
-- depois. Bucket PRIVADO — a nota traz CNPJ e valores do fornecedor.
insert into storage.buckets (id, name, public)
values ('nfe', 'nfe', false)
on conflict (id) do nothing;

drop policy if exists "nfe_read" on storage.objects;
create policy "nfe_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'nfe'
    and (
      public.is_admin_master() or public.is_finance_franchisor()
      or (split_part(name, '/', 1))::uuid in (select public.user_clinic_ids())
    )
  );

drop policy if exists "nfe_write" on storage.objects;
create policy "nfe_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'nfe'
    and public.can_manage_stock((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "nfe_update" on storage.objects;
create policy "nfe_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'nfe'
    and public.can_manage_stock((split_part(name, '/', 1))::uuid)
  );

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.supplier_item_links) as vinculos_de_para,
  (select count(*) from public.stock_items
    where coalesce(btrim(gtin), '') <> '') as itens_com_codigo_de_barras,
  (select count(*) from public.stock_purchases where nfe_key is not null)
    as notas_importadas_por_xml,
  (select count(*) from public.stock_purchases) as notas_no_total;
