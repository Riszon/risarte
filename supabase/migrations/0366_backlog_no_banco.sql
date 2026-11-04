-- =============================================================================
-- 0366 — O BACKLOG PASSA A MORAR NO BANCO (BK1, 04/11/2026)
--
-- Pedido do dono: uma tela só dele com a lista VIVA do backlog — cada item
-- detalhado, abertos e resolvidos, por categoria e prioridade —, sem precisar
-- perguntar à sessão o que está em aberto. Plano e decisões B-D1 a B-D5 em
-- `docs/backlog/TELA-BACKLOG-PLANO.md`.
--
-- Até aqui o backlog era o arquivo `docs/BACKLOG.md`: só as sessões liam, e
-- o índice dele já tinha esquecido cinco itens abertos (AP69, AP70, AP71,
-- AP74, AP75 — achado ao preparar a importação).
--
-- QUEM GRAVA: o Admin Master (pela tela, BK2) e as sessões do Claude (pelo
-- comando `npm run backlog`, com a chave de serviço). Ninguém mais lê nem
-- grava. Toda escrita passa pelas funções abaixo — nenhuma política de
-- escrita nas tabelas —, e cada mudança vira uma linha na linha do tempo do
-- item (`backlog_item_events`), que só cresce.
--
-- NADA SE APAGA: item resolvido ou descartado muda de situação; categoria
-- com itens se desativa.
--
-- O TREINO NÃO É ESPELHO: a tabela existe lá (as migrações reconstroem tudo),
-- mas a lista de verdade é a da PRODUÇÃO. O comando grava na produção; o
-- treino só recebe uma importação de ensaio.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Categorias — cadastro, não lista fixa (B-D3: o dono cria e muda).
-- -----------------------------------------------------------------------------
create table if not exists public.backlog_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backlog_categories_name_ok check (btrim(name) <> '' and char_length(name) <= 60)
);

create unique index if not exists backlog_categories_name_key
  on public.backlog_categories (lower(btrim(name)));

comment on table public.backlog_categories is
  '0366: categorias do backlog (Admin Master edita; começa com as oito aprovadas pelo dono em 04/11/2026). Nunca se apaga: desativa.';

drop trigger if exists backlog_categories_updated_at on public.backlog_categories;
create trigger backlog_categories_updated_at
  before update on public.backlog_categories
  for each row execute function public.set_updated_at();

insert into public.backlog_categories (name, sort_order) values
  ('Defeito', 10),
  ('Segurança e LGPD', 20),
  ('Decisão do dono', 30),
  ('Melhoria', 40),
  ('Desempenho', 50),
  ('Limpeza técnica', 60),
  ('Tarefa do dono', 70),
  ('Adiado', 80)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Itens.
-- -----------------------------------------------------------------------------
create table if not exists public.backlog_items (
  id uuid primary key default gen_random_uuid(),
  -- AP1…AP111 vieram do arquivo; os novos seguem a numeração (AP112…).
  code text not null unique,
  title text not null,
  detail text not null default '',
  category_id uuid not null references public.backlog_categories (id) on delete restrict,
  -- O mesmo catálogo de módulos dos relatos (`MODULOS`, system-reports.ts);
  -- conferido pelo app e pelo comando, não aqui (o catálogo é do código).
  module text,
  priority text not null default 'media',
  status text not null default 'aberto',
  origin text not null default 'sessao',
  -- Quando foi achado (a data do título no arquivo; hoje, para os novos).
  found_on date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  resolved_at timestamptz,
  resolved_version text,
  resolution text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backlog_items_code_ok check (code ~ '^AP[0-9]+$'),
  constraint backlog_items_title_ok check (btrim(title) <> '' and char_length(title) <= 300),
  constraint backlog_items_priority_ok check (priority in ('urgente', 'alta', 'media', 'baixa')),
  constraint backlog_items_status_ok
    check (status in ('aberto', 'aguardando_dono', 'em_andamento', 'resolvido', 'descartado')),
  constraint backlog_items_origin_ok check (origin in ('backlog_md', 'relato', 'sessao', 'dono')),
  -- Resolvido e descartado têm data; os outros não.
  constraint backlog_items_closed_ok
    check ((status in ('resolvido', 'descartado')) = (resolved_at is not null))
);

create index if not exists backlog_items_status_priority_idx
  on public.backlog_items (status, priority);
create index if not exists backlog_items_category_idx
  on public.backlog_items (category_id);

comment on table public.backlog_items is
  '0366: o backlog do riSZon (antes docs/BACKLOG.md). Só o Admin Master lê; gravam as funções backlog_* (tela e comando das sessões). Nunca se apaga: resolve ou descarta.';

drop trigger if exists backlog_items_updated_at on public.backlog_items;
create trigger backlog_items_updated_at
  before update on public.backlog_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Relatos ligados ao item (BK4: vários relatos do mesmo defeito, um item).
-- -----------------------------------------------------------------------------
create table if not exists public.backlog_item_reports (
  item_id uuid not null references public.backlog_items (id) on delete restrict,
  report_id uuid not null references public.system_reports (id) on delete cascade,
  linked_by uuid references public.profiles (id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (item_id, report_id)
);

create index if not exists backlog_item_reports_report_idx
  on public.backlog_item_reports (report_id);

comment on table public.backlog_item_reports is
  '0366: que relato (system_reports) virou que item do backlog. Gravada pela BK4.';

-- -----------------------------------------------------------------------------
-- 4. Linha do tempo — só cresce.
-- -----------------------------------------------------------------------------
create table if not exists public.backlog_item_events (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.backlog_items (id) on delete restrict,
  kind text not null,
  from_value text,
  to_value text,
  note text,
  author_id uuid references public.profiles (id) on delete set null,
  -- Quem gravou pela chave de serviço não é pessoa: a sessão diz quem é.
  author_label text,
  created_at timestamptz not null default now(),
  constraint backlog_item_events_kind_ok check (kind in (
    'criado', 'importado', 'titulo', 'detalhe', 'categoria', 'modulo',
    'prioridade', 'situacao', 'nota', 'relato'
  ))
);

create index if not exists backlog_item_events_item_idx
  on public.backlog_item_events (item_id, created_at);

comment on table public.backlog_item_events is
  '0366: linha do tempo de cada item do backlog (criado, mudanças, notas). Só cresce.';

create or replace function public.backlog_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'BACKLOG_EVENTS_APPEND_ONLY';
end;
$$;

revoke execute on function public.backlog_events_append_only()
  from public, anon, authenticated;

drop trigger if exists backlog_item_events_append_only on public.backlog_item_events;
create trigger backlog_item_events_append_only
  before update or delete on public.backlog_item_events
  for each row execute function public.backlog_events_append_only();

-- -----------------------------------------------------------------------------
-- 5. Leitura: só o Admin Master. Escrita: nenhuma política (só as funções).
-- -----------------------------------------------------------------------------
alter table public.backlog_categories enable row level security;
alter table public.backlog_items enable row level security;
alter table public.backlog_item_reports enable row level security;
alter table public.backlog_item_events enable row level security;

drop policy if exists "backlog_categories_select" on public.backlog_categories;
create policy "backlog_categories_select" on public.backlog_categories
  for select to authenticated using (public.is_admin_master());

drop policy if exists "backlog_items_select" on public.backlog_items;
create policy "backlog_items_select" on public.backlog_items
  for select to authenticated using (public.is_admin_master());

drop policy if exists "backlog_item_reports_select" on public.backlog_item_reports;
create policy "backlog_item_reports_select" on public.backlog_item_reports
  for select to authenticated using (public.is_admin_master());

drop policy if exists "backlog_item_events_select" on public.backlog_item_events;
create policy "backlog_item_events_select" on public.backlog_item_events
  for select to authenticated using (public.is_admin_master());

-- -----------------------------------------------------------------------------
-- 6. Regras internas.
-- -----------------------------------------------------------------------------
-- Quem pode gravar: o Admin Master logado OU a chave de serviço (o comando
-- das sessões). Sem login, nunca — a guarda não depende de "não há usuário"
-- (a armadilha do AP102): a chave de serviço é reconhecida pelo papel do
-- token, e o anônimo não passa em nenhuma das duas.
create or replace function public._backlog_can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_admin_master(), false)
      or coalesce((select auth.role()) = 'service_role', false);
$$;

revoke execute on function public._backlog_can_write()
  from public, anon, authenticated;

create or replace function public._backlog_category_id(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id
    from public.backlog_categories c
   where lower(btrim(c.name)) = lower(btrim(p_name));
  if v_id is null then
    raise exception 'CATEGORY_NOT_FOUND';
  end if;
  return v_id;
end;
$$;

revoke execute on function public._backlog_category_id(text)
  from public, anon, authenticated;

create or replace function public._backlog_event(
  p_item uuid, p_kind text, p_from text, p_to text, p_note text, p_label text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.backlog_item_events
    (item_id, kind, from_value, to_value, note, author_id, author_label)
  values (
    p_item, p_kind, p_from, p_to, nullif(btrim(p_note), ''),
    (select auth.uid()),
    nullif(left(btrim(coalesce(p_label, '')), 120), '')
  );
$$;

revoke execute on function public._backlog_event(uuid, text, text, text, text, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Abrir um item novo — o código é do banco (AP + o maior + 1).
-- -----------------------------------------------------------------------------
create or replace function public.backlog_create_item(
  p_title text,
  p_detail text,
  p_category text,
  p_priority text default 'media',
  p_module text default null,
  p_status text default 'aberto',
  p_origin text default 'sessao',
  p_author_label text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_id uuid;
begin
  if not public._backlog_can_write() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_status in ('resolvido', 'descartado') then
    raise exception 'STATUS_NOT_FOR_NEW_ITEM';
  end if;

  -- Dois itens abertos ao mesmo tempo não pegam o mesmo número.
  perform pg_advisory_xact_lock(hashtext('backlog_items.code'));
  select 'AP' || (coalesce(max(substr(code, 3)::integer), 0) + 1)
    into v_code
    from public.backlog_items;

  insert into public.backlog_items
    (code, title, detail, category_id, module, priority, status, origin, created_by)
  values (
    v_code, btrim(p_title), coalesce(p_detail, ''),
    public._backlog_category_id(p_category),
    nullif(btrim(p_module), ''),
    coalesce(p_priority, 'media'), coalesce(p_status, 'aberto'),
    coalesce(p_origin, 'sessao'), (select auth.uid())
  )
  returning id into v_id;

  perform public._backlog_event(v_id, 'criado', null, v_code, null, p_author_label);
  return v_code;
end;
$$;

revoke execute on function public.backlog_create_item(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.backlog_create_item(text, text, text, text, text, text, text, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Importar do arquivo — só a chave de serviço; não duplica (pelo código).
-- -----------------------------------------------------------------------------
create or replace function public.backlog_import_item(
  p_code text,
  p_title text,
  p_detail text,
  p_category text,
  p_priority text,
  p_status text,
  p_module text,
  p_found_on date,
  p_resolved_on date,
  p_resolved_version text,
  p_resolution text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not coalesce((select auth.role()) = 'service_role', false) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.backlog_items
    (code, title, detail, category_id, module, priority, status, origin,
     found_on, resolved_at, resolved_version, resolution)
  values (
    btrim(p_code), btrim(p_title), coalesce(p_detail, ''),
    public._backlog_category_id(p_category),
    nullif(btrim(p_module), ''), p_priority, p_status, 'backlog_md',
    coalesce(p_found_on, (now() at time zone 'America/Sao_Paulo')::date),
    case when p_status in ('resolvido', 'descartado')
         then coalesce(p_resolved_on::timestamp at time zone 'America/Sao_Paulo', now())
    end,
    nullif(btrim(p_resolved_version), ''),
    nullif(btrim(p_resolution), '')
  )
  on conflict (code) do nothing
  returning id into v_id;

  if v_id is null then
    return false;
  end if;

  perform public._backlog_event(v_id, 'importado', null, p_status,
    'Importado de docs/BACKLOG.md', 'Importação do BACKLOG.md');
  return true;
end;
$$;

revoke execute on function public.backlog_import_item(text, text, text, text, text, text, text, date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.backlog_import_item(text, text, text, text, text, text, text, date, date, text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- 9. Mudar um item. Vazio = não muda. Cada campo mudado vira um evento.
-- -----------------------------------------------------------------------------
create or replace function public.backlog_update_item(
  p_code text,
  p_title text default null,
  p_detail text default null,
  p_category text default null,
  p_module text default null,
  p_priority text default null,
  p_status text default null,
  p_resolved_version text default null,
  p_resolution text default null,
  p_note text default null,
  p_author_label text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.backlog_items%rowtype;
  v_cat uuid;
  v_old_cat text;
  v_new_cat text;
  v_fechando boolean;
begin
  if not public._backlog_can_write() then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v from public.backlog_items
   where code = upper(btrim(p_code))
   for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if nullif(btrim(p_title), '') is not null and btrim(p_title) <> v.title then
    update public.backlog_items set title = btrim(p_title) where id = v.id;
    perform public._backlog_event(v.id, 'titulo', v.title, btrim(p_title), null, p_author_label);
  end if;

  if p_detail is not null and p_detail <> v.detail then
    update public.backlog_items set detail = p_detail where id = v.id;
    perform public._backlog_event(v.id, 'detalhe', null, null, null, p_author_label);
  end if;

  if nullif(btrim(p_category), '') is not null then
    v_cat := public._backlog_category_id(p_category);
    if v_cat <> v.category_id then
      select name into v_old_cat from public.backlog_categories where id = v.category_id;
      select name into v_new_cat from public.backlog_categories where id = v_cat;
      update public.backlog_items set category_id = v_cat where id = v.id;
      perform public._backlog_event(v.id, 'categoria', v_old_cat, v_new_cat, null, p_author_label);
    end if;
  end if;

  if p_module is not null and nullif(btrim(p_module), '') is distinct from v.module then
    update public.backlog_items set module = nullif(btrim(p_module), '') where id = v.id;
    perform public._backlog_event(v.id, 'modulo', v.module, nullif(btrim(p_module), ''), null, p_author_label);
  end if;

  if nullif(btrim(p_priority), '') is not null and btrim(p_priority) <> v.priority then
    update public.backlog_items set priority = btrim(p_priority) where id = v.id;
    perform public._backlog_event(v.id, 'prioridade', v.priority, btrim(p_priority), null, p_author_label);
  end if;

  if nullif(btrim(p_status), '') is not null and btrim(p_status) <> v.status then
    v_fechando := btrim(p_status) in ('resolvido', 'descartado');
    update public.backlog_items
       set status = btrim(p_status),
           resolved_at = case when v_fechando then now() end,
           resolved_version = case when v_fechando
                                   then coalesce(nullif(btrim(p_resolved_version), ''), resolved_version)
                              end,
           resolution = case when v_fechando
                             then coalesce(nullif(btrim(p_resolution), ''), resolution)
                        end
     where id = v.id;
    perform public._backlog_event(v.id, 'situacao', v.status, btrim(p_status),
      case when v_fechando
           then concat_ws(' — ', nullif(btrim(p_resolved_version), ''), nullif(btrim(p_resolution), ''))
      end,
      p_author_label);
  end if;

  if nullif(btrim(p_note), '') is not null then
    perform public._backlog_event(v.id, 'nota', null, null, p_note, p_author_label);
  end if;
end;
$$;

revoke execute on function public.backlog_update_item(text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.backlog_update_item(text, text, text, text, text, text, text, text, text, text, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Categorias: criar, renomear, ordenar, desativar.
-- -----------------------------------------------------------------------------
create or replace function public.backlog_save_category(
  p_id uuid,
  p_name text,
  p_sort_order integer default null,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public._backlog_can_write() then
    raise exception 'NOT_ALLOWED';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'NAME_REQUIRED';
  end if;

  if p_id is null then
    insert into public.backlog_categories (name, sort_order, active)
    values (btrim(p_name), coalesce(p_sort_order, 100), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.backlog_categories
       set name = btrim(p_name),
           sort_order = coalesce(p_sort_order, sort_order),
           active = coalesce(p_active, active)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'CATEGORY_NOT_FOUND';
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'CATEGORY_EXISTS';
end;
$$;

revoke execute on function public.backlog_save_category(uuid, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.backlog_save_category(uuid, text, integer, boolean)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. Auditoria (regra 7 do CLAUDE.md): a linha do tempo já É o histórico.
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('public', 'backlog_item_events',
        'Linha do tempo do backlog: ela própria é o histórico, só cresce (0366).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

notify pgrst, 'reload schema';
