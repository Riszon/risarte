-- =============================================================================
-- 0407 — LEVANTAMENTO DE DÍVIDAS, FASE 4: A IMPORTAÇÃO DA PLANILHA
-- =============================================================================
-- Plano e decisões do dono: docs/Financeiro/DIVIDAS-PLANO.md (3.4, 4.5, fase 4).
--
-- O caminho (3.4):
--   arquivo → modelo de mapeamento → CONFERÊNCIA (linha a linha, guardada no
--   banco: sobrevive a recarregar a página) → gravar o LOTE numa transação só →
--   conferência por CNPJ → "Desfazer importação" enquanto nada foi pago.
--
-- ⚠️ A CONFERÊNCIA É CÓDIGO PURO (`src/lib/finance/dividas-importacao.ts`,
--    testado): ela lê as células e devolve, por linha, o que vai ser gravado
--    (`computed`), os avisos e se há erro. O banco GUARDA isso e, ao gravar,
--    passa cada linha pelas MESMAS portas do cadastro à mão (`debt_save`,
--    `debt_save_proposal`, `debt_save_negativation`, `debt_save_protest`,
--    `debt_link_payables`, `_debt_sync_finance`) — a importação não tem regra
--    própria de dívida; se a porta recusa, o lote inteiro volta.
-- ⚠️ A planilha REAL da rede não entra em migração, teste nem commit (D0): aqui
--    só a ESTRUTURA dela (os nomes das colunas do modelo padrão).
-- ⚠️ FOTOGRAFIA MENSAL (4.5) começa aqui: `debt_month_positions`, gravada pela
--    rotina diária no 1º dia útil do mês seguinte, por dívida, e nunca refeita.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A PERMISSÃO NOVA: importar (padrão e teto = Financeiro da Franqueadora)
-- -----------------------------------------------------------------------------
-- Padrões de fábrica (iguais a `src/lib/permissions.ts`; há teste comparando).
create or replace function public._debt_cap_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'modulo.dividas' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.lancar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.excluir' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.configurar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.importar' then array['finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_default_roles(text) from public, anon, authenticated;

create or replace function public._debt_cap_ceiling(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_capability in ('modulo.dividas', 'acao.dividas.lancar',
                          'acao.dividas.excluir', 'acao.dividas.configurar',
                          'acao.dividas.importar')
      then array['finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_ceiling(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select 'acao.dividas.importar', r
      from unnest(public._debt_cap_default_roles('acao.dividas.importar')) as r
    on conflict (capability, role) do nothing;
  end if;
end;
$$;
insert into public.permission_defaults (capability, roles)
values ('acao.dividas.importar', public._debt_cap_default_roles('acao.dividas.importar'))
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 2) MODELOS DE MAPEAMENTO (coluna da planilha → campo do riSZon)
-- -----------------------------------------------------------------------------
create table if not exists public.debt_import_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- {"abas": {"dividas": "Dívidas", "protestos": "Protestos"},
  --  "colunas": {"dividas": {"campo": "Cabeçalho", ...}, "protestos": {...}}}
  mapping jsonb not null,
  is_default boolean not null default false,
  system boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
comment on table public.debt_import_templates is
  'Modelos de mapeamento da importação de dívidas: qual coluna da planilha vai para qual campo. O da planilha da rede é o padrão (0407).';
create unique index if not exists debt_import_templates_name_uniq on public.debt_import_templates (lower(btrim(name)));
create unique index if not exists debt_import_templates_one_default on public.debt_import_templates ((true)) where is_default;

-- O modelo padrão: a estrutura da planilha da rede (só os nomes das colunas).
insert into public.debt_import_templates (name, mapping, is_default, system)
values (
  'Planilha da rede (Relatório de Dívidas)',
  jsonb_build_object(
    'abas', jsonb_build_object('dividas', 'Dívidas', 'protestos', 'Protestos'),
    'colunas', jsonb_build_object(
      'dividas', jsonb_build_object(
        'chave', '#',
        'devedor', 'Devedor (unidade)',
        'devedor_razao', 'Razão social devedora',
        'devedor_cnpj', 'CNPJ devedor',
        'credor', 'Credor',
        'credor_cnpj', 'CNPJ do credor',
        'categoria', 'Categoria',
        'subcategoria', 'Subcategoria',
        'natureza', 'Natureza',
        'situacao', 'Situação',
        'descricao', 'Descrição / origem',
        'contrato', 'Nº contrato / título',
        'vencimento', 'Data de vencimento',
        'valor_original', 'Valor original',
        'valor_atualizado', 'Valor atualizado',
        'data_referencia', 'Data de referência do valor',
        'proposta', 'Proposta de quitação',
        'proposta_condicao', 'Condição de pagamento da proposta',
        'proposta_validade', 'Validade da proposta',
        'negativada', 'Negativada?',
        'protestada', 'Protestada?',
        'cartorio', 'Cartório',
        'custas', 'Custas do protesto',
        'origem', 'Origem do lançamento',
        'fonte', 'Fonte da informação',
        'observacoes', 'Observações / pendências',
        'quantidade', 'Quantidade reunida'),
      'protestos', jsonb_build_object(
        'devedor', 'Devedor (unidade)',
        'credor', 'Credor (como está no levantamento)',
        'quantidade', 'Qtd. títulos',
        'valor', 'Valor protestado',
        'cartorio', 'Cartório (nome, cidade/UF)',
        'protocolo', 'Nº protocolo / título',
        'data', 'Data do protesto',
        'custas', 'Custas para cancelar',
        'anuencia', 'Carta de anuência',
        'ja_esta', 'Já está na aba Dívidas?',
        'vinculada', 'Nº da dívida vinculada (#)',
        'observacoes', 'Observações'))),
  true, true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3) O LOTE E AS LINHAS DA CONFERÊNCIA
-- -----------------------------------------------------------------------------
create sequence if not exists public.debt_import_code_seq;

create table if not exists public.debt_import_batches (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  file_name text not null check (btrim(file_name) <> ''),
  file_hash text,
  template_id uuid references public.debt_import_templates(id) on delete set null,
  mapping jsonb not null default '{}'::jsonb,
  status text not null default 'conferencia'
    check (status in ('conferencia', 'importado', 'desfeito', 'descartado')),
  -- Avisos do arquivo inteiro (ex.: "este arquivo já foi importado no lote X").
  warnings jsonb not null default '[]'::jsonb,
  -- Totais por CNPJ calculados na conferência (arquivo × a importar × ignorado).
  totals jsonb not null default '[]'::jsonb,
  -- O que a gravação fez (dívidas, protestos, credores e categorias criados,
  -- títulos gerados, falhas ao gerar).
  result jsonb,
  generate_titles boolean,
  tag_id uuid references public.debt_tags(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  committed_by uuid references auth.users(id),
  committed_at timestamptz,
  undone_by uuid references auth.users(id),
  undone_at timestamptz,
  undone_reason text,
  discarded_by uuid references auth.users(id),
  discarded_at timestamptz
);
comment on table public.debt_import_batches is
  'Lote de importação de dívidas (IMP-): o arquivo, a conferência, a gravação numa transação e o desfazer (0407).';

create or replace function public.debt_import_set_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
begin
  if new.code is null or btrim(new.code) = '' then
    v := nextval('public.debt_import_code_seq');
    new.code := 'IMP-' || lpad(v::text, greatest(5, length(v::text)), '0');
  end if;
  return new;
end;
$$;
drop trigger if exists debt_import_batches_code on public.debt_import_batches;
create trigger debt_import_batches_code before insert on public.debt_import_batches
  for each row execute function public.debt_import_set_code();

create table if not exists public.debt_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.debt_import_batches(id) on delete restrict,
  sheet text not null check (sheet in ('dividas', 'protestos')),
  row_no integer not null check (row_no > 0),
  -- O "#" da planilha (a aba Protestos aponta para ele).
  source_key text,
  -- As células da linha, como vieram (texto/número), por campo.
  cells jsonb not null default '{}'::jsonb,
  -- O que a pessoa corrigiu na conferência (células, devedor, credor, títulos).
  overrides jsonb not null default '{}'::jsonb,
  -- O que vai ser gravado (montado pela conferência; nulo quando há erro).
  computed jsonb,
  warnings jsonb not null default '[]'::jsonb,
  has_error boolean not null default false,
  -- Erro OU decisão pendente ("Verificar"): segura a gravação.
  blocking boolean not null default false,
  suggested text not null,
  -- Nulo = segue a sugerida.
  decision text,
  debt_id uuid references public.debts(id) on delete restrict,
  protest_id uuid references public.debt_protests(id) on delete restrict,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint debt_import_rows_decisions check (
    (sheet = 'dividas'
      and suggested in ('importar', 'ignorar', 'vincular')
      and (decision is null or decision in ('importar', 'ignorar', 'vincular')))
    or (sheet = 'protestos'
      and suggested in ('vincular', 'nova', 'ignorar', 'verificar')
      and (decision is null or decision in ('vincular', 'nova', 'ignorar', 'verificar')))),
  unique (batch_id, sheet, row_no)
);
comment on table public.debt_import_rows is
  'Cada linha da planilha na conferência da importação: células, correções, o que será gravado, avisos e a decisão (importar · ignorar · vincular) (0407).';
create index if not exists debt_import_rows_batch on public.debt_import_rows (batch_id, sheet, row_no);

-- A dívida guarda de qual lote veio (a coluna existe desde a 0404).
do $$
begin
  alter table public.debts
    add constraint debts_import_batch_fk foreign key (import_batch_id)
    references public.debt_import_batches(id) on delete restrict;
exception when duplicate_object then null;
end;
$$;
create index if not exists debts_import_batch on public.debts (import_batch_id) where import_batch_id is not null;

-- -----------------------------------------------------------------------------
-- 4) FOTOGRAFIA MENSAL POR DÍVIDA (4.5) — não é reconstruída depois
-- -----------------------------------------------------------------------------
create table if not exists public.debt_month_positions (
  month date not null check (extract(day from month) = 1),
  debt_id uuid not null references public.debts(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null,
  category_id uuid references public.debt_categories(id) on delete set null,
  subcategory_id uuid references public.debt_categories(id) on delete set null,
  nature_code text,
  tag_ids uuid[] not null default '{}',
  updated_cents bigint,
  balance_cents bigint not null,
  paid_in_month_cents bigint not null default 0,
  new_in_month boolean not null default false,
  taken_at timestamptz not null default now(),
  primary key (month, debt_id)
);
comment on table public.debt_month_positions is
  'Fotografia mensal de cada dívida (saldo, valor atualizado, situação, categoria, natureza, etiquetas, pago e nova no mês). Gravada uma vez, no mês seguinte; o mês corrente é calculado ao vivo (4.5, 0407).';

-- O mês de `p_month` (qualquer dia dele). Só grava o que ainda não tem foto.
create or replace function public._debt_snapshot_month(p_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_end_ts timestamptz := (v_end::timestamp at time zone 'America/Sao_Paulo');
  v_start_ts timestamptz := (v_m::timestamp at time zone 'America/Sao_Paulo');
  v_n integer;
begin
  insert into public.debt_month_positions (month, debt_id, clinic_id, supplier_id, status, category_id,
    subcategory_id, nature_code, tag_ids, updated_cents, balance_cents, paid_in_month_cents, new_in_month)
  select v_m, d.id, d.clinic_id, d.supplier_id, d.status, d.category_id, d.subcategory_id, d.nature_code,
         coalesce((select array_agg(l.tag_id order by l.tag_id) from public.debt_tag_links l where l.debt_id = d.id), '{}'),
         d.updated_cents,
         greatest(0, coalesce(d.updated_cents, d.original_cents, 0) - coalesce((
           select sum(coalesce(p.paid_amount_cents, 0)) from public.payables p
            where p.debt_id = d.id and p.status not in ('cancelada', 'recusada')), 0)),
         coalesce((
           select sum(pp.amount_cents) from public.payable_payments pp
             join public.payables p on p.id = pp.payable_id
            where p.debt_id = d.id and pp.reversal_of is null and not pp.reversed
              and pp.paid_at >= v_m and pp.paid_at < v_end), 0),
         d.created_at >= v_start_ts
    from public.debts d
   where d.created_at < v_end_ts
     and (d.deleted_at is null or d.deleted_at >= v_end_ts)
  on conflict (month, debt_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public._debt_snapshot_month(date) from public, anon, authenticated;

-- A rotina da madrugada (corpo da 0405 + a fotografia do mês anterior).
create or replace function public.debt_daily_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_old text;
  v_d uuid;
  v_prev date := date_trunc('month', public.today_br() - interval '1 month')::date;
begin
  for r in select id, status from public.debts where deleted_at is null loop
    v_old := r.status;
    if public._debt_refresh_status(r.id, true) is distinct from v_old then
      v_n := v_n + 1;
    end if;
  end loop;

  -- Proposta com validade vencida deixa de ser "ativa" (0405).
  for r in
    update public.debt_proposals
       set status = 'expirada', status_changed_at = now(), status_reason = 'Validade vencida'
     where status = 'ativa' and valid_until is not null and valid_until < public.today_br()
    returning id, debt_id, group_id
  loop
    for v_d in select id from public.debts where (id = r.debt_id or group_id = r.group_id) and deleted_at is null loop
      insert into public.debt_events (debt_id, user_id, kind, note, data)
      values (v_d, null, 'proposta_expirada', 'Validade vencida', jsonb_build_object('id', r.id));
    end loop;
  end loop;

  -- A fotografia do mês que fechou (0407): uma vez só. Sem dívida no mês, não
  -- há foto — o gráfico diz "sem histórico" em vez de inventar.
  if not exists (select 1 from public.debt_month_positions where month = v_prev) then
    perform public._debt_snapshot_month(v_prev);
  end if;
  return v_n;
end;
$$;
revoke execute on function public.debt_daily_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) AS PORTAS DA CONFERÊNCIA
-- -----------------------------------------------------------------------------
create or replace function public.debt_import_save_template(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := public._debt_text(p, 'name');
begin
  if not public.debt_can('acao.dividas.importar', null) then
    raise exception 'Você não tem permissão para importar dívidas.';
  end if;
  if v_name is null then raise exception 'Dê um nome ao modelo.'; end if;
  if jsonb_typeof(p -> 'mapping') is distinct from 'object' then raise exception 'Mapeamento inválido.'; end if;
  if v_id is null then
    insert into public.debt_import_templates (name, mapping, created_by, updated_by)
    values (v_name, p -> 'mapping', v_uid, v_uid)
    returning id into v_id;
  else
    update public.debt_import_templates
       set name = v_name, mapping = p -> 'mapping', active = coalesce((p ->> 'active')::boolean, active),
           updated_by = v_uid, updated_at = now()
     where id = v_id and not system;
    if not found then raise exception 'Modelo não encontrado (o modelo padrão da rede não se edita: salve um novo).'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um modelo com este nome.';
end;
$$;
revoke execute on function public.debt_import_save_template(jsonb) from public, anon, authenticated;
grant execute on function public.debt_import_save_template(jsonb) to authenticated;

-- Abre o lote com as linhas já conferidas pelo código.
create or replace function public.debt_import_stage(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_n integer := coalesce(jsonb_array_length(p -> 'rows'), 0);
begin
  if not public.debt_can('acao.dividas.importar', null) then
    raise exception 'Você não tem permissão para importar dívidas.';
  end if;
  if public._debt_text(p, 'file_name') is null then raise exception 'Arquivo sem nome.'; end if;
  if v_n = 0 then raise exception 'A planilha não tem linhas para importar.'; end if;
  if v_n > 3000 then raise exception 'A planilha tem linhas demais (máximo 3.000 por lote).'; end if;

  insert into public.debt_import_batches (file_name, file_hash, template_id, mapping, warnings, totals,
    created_by, updated_by)
  values (public._debt_text(p, 'file_name'), public._debt_text(p, 'file_hash'),
    nullif(p ->> 'template_id', '')::uuid, coalesce(p -> 'mapping', '{}'::jsonb),
    coalesce(p -> 'warnings', '[]'::jsonb), coalesce(p -> 'totals', '[]'::jsonb), v_uid, v_uid)
  returning id into v_id;

  insert into public.debt_import_rows (batch_id, sheet, row_no, source_key, cells, overrides, computed,
    warnings, has_error, blocking, suggested, decision, updated_by)
  select v_id, r ->> 'sheet', (r ->> 'row_no')::integer, nullif(btrim(r ->> 'source_key'), ''),
         coalesce(r -> 'cells', '{}'::jsonb), coalesce(r -> 'overrides', '{}'::jsonb),
         case when jsonb_typeof(r -> 'computed') = 'object' then r -> 'computed' end,
         coalesce(r -> 'warnings', '[]'::jsonb), coalesce((r ->> 'has_error')::boolean, false),
         coalesce((r ->> 'blocking')::boolean, false), r ->> 'suggested', nullif(r ->> 'decision', ''), v_uid
    from jsonb_array_elements(p -> 'rows') r;
  return v_id;
end;
$$;
revoke execute on function public.debt_import_stage(jsonb) from public, anon, authenticated;
grant execute on function public.debt_import_stage(jsonb) to authenticated;

-- A conferência refeita (depois de uma correção): o código manda TODAS as
-- linhas de novo; a decisão só muda quando vem a chave "decision".
create or replace function public.debt_import_update(p_batch_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  b public.debt_import_batches%rowtype;
  r jsonb;
begin
  if not public.debt_can('acao.dividas.importar', null) then
    raise exception 'Você não tem permissão para importar dívidas.';
  end if;
  select * into b from public.debt_import_batches where id = p_batch_id for update;
  if not found then raise exception 'Lote não encontrado.'; end if;
  if b.status <> 'conferencia' then raise exception 'Este lote não está mais em conferência.'; end if;

  for r in select * from jsonb_array_elements(coalesce(p -> 'rows', '[]'::jsonb)) loop
    update public.debt_import_rows
       set overrides = coalesce(r -> 'overrides', overrides),
           computed = case when jsonb_typeof(r -> 'computed') = 'object' then r -> 'computed' end,
           warnings = coalesce(r -> 'warnings', '[]'::jsonb),
           has_error = coalesce((r ->> 'has_error')::boolean, false),
           blocking = coalesce((r ->> 'blocking')::boolean, false),
           suggested = r ->> 'suggested',
           decision = case when r ? 'decision' then nullif(r ->> 'decision', '') else decision end,
           updated_by = v_uid, updated_at = now()
     where id = (r ->> 'id')::uuid and batch_id = p_batch_id;
    if not found then raise exception 'Linha do lote não encontrada.'; end if;
  end loop;

  update public.debt_import_batches
     set totals = coalesce(p -> 'totals', totals), warnings = coalesce(p -> 'warnings', warnings),
         updated_by = v_uid, updated_at = now()
   where id = p_batch_id;
end;
$$;
revoke execute on function public.debt_import_update(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.debt_import_update(uuid, jsonb) to authenticated;

create or replace function public.debt_import_discard(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.debt_can('acao.dividas.importar', null) then
    raise exception 'Você não tem permissão para importar dívidas.';
  end if;
  update public.debt_import_batches
     set status = 'descartado', discarded_by = v_uid, discarded_at = now(), updated_by = v_uid, updated_at = now()
   where id = p_batch_id and status = 'conferencia';
  if not found then raise exception 'Só um lote em conferência pode ser descartado.'; end if;
end;
$$;
revoke execute on function public.debt_import_discard(uuid) from public, anon, authenticated;
grant execute on function public.debt_import_discard(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) A GRAVAÇÃO — peças internas
-- -----------------------------------------------------------------------------
-- Credor: acha (CNPJ inteiro → raiz de 8 dígitos → nome) ou cadastra. Criado
-- pela importação vale para a REDE (as dívidas são de vários CNPJs) e fica
-- com o CNPJ que veio — só a raiz é o provisório do D18.
create or replace function public._debt_import_supplier(p jsonb, out supplier_id uuid, out created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := public._debt_text(p, 'name');
  v_doc text := nullif(regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g'), '');
  v_kind text := coalesce(public._debt_text(p, 'kind'), 'outros');
  v_owner uuid;
begin
  created := false;
  if v_name is null then raise exception 'Credor sem nome.'; end if;
  if v_doc is not null and length(v_doc) not in (8, 11, 14) then
    raise exception 'CNPJ do credor incompleto.';
  end if;
  if v_doc is not null then
    select s.id into supplier_id from public.suppliers s where s.document = v_doc order by s.created_at limit 1;
  end if;
  if supplier_id is null then
    select s.id into supplier_id from public.suppliers s
     where lower(btrim(s.name)) = lower(v_name) or lower(btrim(coalesce(s.legal_name, ''))) = lower(v_name)
     order by s.created_at limit 1;
  end if;
  if supplier_id is not null then return; end if;

  if not exists (select 1 from public.supplier_kinds k where k.code = v_kind) then v_kind := 'outros'; end if;
  select c.id into v_owner from public.clinics c where c.type = 'franchisor' order by c.created_at limit 1;
  insert into public.suppliers (clinic_id, name, document, kind, scope, notes, active, created_by, updated_by)
  values (v_owner, v_name, v_doc, v_kind, 'rede',
          'Cadastrado pela importação do Levantamento de Dívidas.', true, v_uid, v_uid)
  returning id into supplier_id;
  created := true;
end;
$$;
revoke execute on function public._debt_import_supplier(jsonb) from public, anon, authenticated;

-- Categoria/subcategoria: acha pelo nome (no mesmo nível) ou cria.
create or replace function public._debt_import_category(p_name text, p_parent uuid, p_nature text,
  out category_id uuid, out created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(btrim(p_name), '');
begin
  created := false;
  if v_name is null then raise exception 'Categoria sem nome.'; end if;
  select c.id into category_id from public.debt_categories c
   where coalesce(c.parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_parent, '00000000-0000-0000-0000-000000000000'::uuid)
     and lower(btrim(c.name)) = lower(v_name);
  if category_id is not null then return; end if;
  insert into public.debt_categories (parent_id, name, nature_code, sort_order, created_by, updated_by)
  values (p_parent, v_name,
          case when p_parent is null and exists (select 1 from public.debt_natures n where n.code = p_nature) then p_nature end,
          500, v_uid, v_uid)
  returning id into category_id;
  created := true;
end;
$$;
revoke execute on function public._debt_import_category(text, uuid, text) from public, anon, authenticated;

create or replace function public._debt_import_notary(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(btrim(p_name), '');
  v_id uuid;
begin
  if v_name is null then return null; end if;
  select n.id into v_id from public.debt_notary_offices n
   where lower(btrim(n.name)) = lower(v_name) order by n.created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.debt_notary_offices (name, created_by, updated_by)
  values (v_name, v_uid, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._debt_import_notary(text) from public, anon, authenticated;

-- Uma dívida da planilha, pelas portas do cadastro. `d` é o `computed` da
-- conferência (formato em `src/lib/finance/dividas-importacao.ts`,
-- `DadosDaDivida`).
create or replace function public._debt_import_debt(d jsonb, p_origin text, p_tag uuid, p_batch_id uuid,
  p_where text, out debt_id uuid, out new_suppliers integer, out new_categories integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sup uuid;
  v_cat uuid;
  v_sub uuid;
  v_new boolean;
  v_payload jsonb;
  v_prop jsonb := d -> 'proposal';
  v_neg jsonb := d -> 'negativation';
  v_prot jsonb := d -> 'protest';
  v_ids uuid[];
  v_pid uuid;
begin
  new_suppliers := 0;
  new_categories := 0;

  if d -> 'supplier' ? 'id' then
    v_sup := (d -> 'supplier' ->> 'id')::uuid;
  else
    select s.supplier_id, s.created into v_sup, v_new from public._debt_import_supplier(d -> 'supplier') s;
    if v_new then new_suppliers := 1; end if;
  end if;

  if jsonb_typeof(d -> 'category') = 'object' then
    if d -> 'category' ? 'id' then
      v_cat := (d -> 'category' ->> 'id')::uuid;
    else
      select c.category_id, c.created into v_cat, v_new
        from public._debt_import_category(d -> 'category' ->> 'name', null, d -> 'category' ->> 'nature_code') c;
      if v_new then new_categories := new_categories + 1; end if;
    end if;
  end if;
  if v_cat is not null and jsonb_typeof(d -> 'subcategory') = 'object' then
    if d -> 'subcategory' ? 'id' then
      v_sub := (d -> 'subcategory' ->> 'id')::uuid;
    else
      select c.category_id, c.created into v_sub, v_new
        from public._debt_import_category(d -> 'subcategory' ->> 'name', v_cat, null) c;
      if v_new then new_categories := new_categories + 1; end if;
    end if;
  end if;

  v_payload := coalesce(d -> 'debt', '{}'::jsonb) || jsonb_build_object(
    'clinic_id', d ->> 'clinic_id', 'supplier_id', v_sup, 'category_id', v_cat, 'subcategory_id', v_sub,
    'origin', p_origin, 'tag_ids', case when p_tag is null then '[]'::jsonb else jsonb_build_array(p_tag) end);
  debt_id := public.debt_save(v_payload);
  update public.debts set import_batch_id = p_batch_id where id = debt_id;

  if d ->> 'manual_stage' = 'em_negociacao' then
    perform public.debt_set_stage(debt_id, 'em_negociacao', 'Importação: situação "Em negociação" na planilha');
  end if;

  if jsonb_typeof(v_prop) = 'object' and coalesce(nullif(v_prop ->> 'amount_cents', '')::bigint, 0) > 0 then
    if nullif(v_prop ->> 'valid_until', '')::date < public.today_br() then
      -- Proposta já vencida entra no histórico como expirada (a porta recusa
      -- validade no passado de propósito, para o cadastro à mão).
      insert into public.debt_proposals (debt_id, proposed_on, amount_cents, payment_kind, valid_until, source,
        condition_text, status, status_reason, status_changed_at, created_by)
      values (debt_id, coalesce(nullif(v_prop ->> 'proposed_on', '')::date, public.today_br()),
        (v_prop ->> 'amount_cents')::bigint, 'a_vista', (v_prop ->> 'valid_until')::date,
        coalesce(public._debt_text(v_prop, 'source'), 'credor'), public._debt_text(v_prop, 'condition_text'),
        'expirada', 'Validade vencida na importação', now(), (select auth.uid()))
      returning id into v_pid;
      perform public._debt_event(debt_id, 'proposta', 'Importada já vencida',
        jsonb_build_object('id', v_pid, 'amount_cents', (v_prop ->> 'amount_cents')::bigint));
    else
      perform public.debt_save_proposal(v_prop || jsonb_build_object('debt_id', debt_id));
    end if;
  end if;

  if jsonb_typeof(v_neg) = 'object' then
    perform public.debt_save_negativation(v_neg || jsonb_build_object('debt_id', debt_id));
  end if;

  if jsonb_typeof(v_prot) = 'object' then
    perform public.debt_save_protest(
      (v_prot - 'notary_name') || jsonb_build_object('debt_id', debt_id,
        'notary_office_id', public._debt_import_notary(v_prot ->> 'notary_name')));
  end if;

  if p_origin = 'C' then
    select coalesce(array_agg(x::uuid), '{}') into v_ids
      from jsonb_array_elements_text(coalesce(d -> 'link_payable_ids', '[]'::jsonb)) x;
    perform public.debt_link_payables(debt_id, v_ids);
  end if;

  perform public._debt_event(debt_id, 'importada', p_where,
    jsonb_build_object('batch_id', p_batch_id,
                       'batch_code', (select b.code from public.debt_import_batches b where b.id = p_batch_id)));
end;
$$;
revoke execute on function public._debt_import_debt(jsonb, text, uuid, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) GRAVAR O LOTE (uma transação) e DESFAZER
-- -----------------------------------------------------------------------------
create or replace function public.debt_import_commit(p_batch_id uuid, p_generate_titles boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  b public.debt_import_batches%rowtype;
  r public.debt_import_rows%rowtype;
  v_eff text;
  v_tag uuid;
  v_tag_name text := 'Importação ' || to_char(public.today_br(), 'DD/MM/YYYY');
  v_debt uuid;
  v_ns integer;
  v_nc integer;
  v_suppliers integer := 0;
  v_categories integer := 0;
  v_debts integer := 0;
  v_protests integer := 0;
  v_titles integer := 0;
  v_fail jsonb := '[]'::jsonb;
  v_bad text;
  v_where text;
  v_office uuid;
  v_prot uuid;
  t record;
  v_result jsonb;
begin
  if not public.debt_can('acao.dividas.importar', null) then
    raise exception 'Você não tem permissão para importar dívidas.';
  end if;
  select * into b from public.debt_import_batches where id = p_batch_id for update;
  if not found then raise exception 'Lote não encontrado.'; end if;
  if b.status <> 'conferencia' then raise exception 'Este lote não está mais em conferência (já foi gravado, desfeito ou descartado).'; end if;

  -- Nada com erro ou decisão pendente segue para a gravação.
  select string_agg(case sheet when 'dividas' then 'Dívidas' else 'Protestos' end || ' ' || row_no, ', ' order by sheet, row_no)
    into v_bad
    from (select sheet, row_no from public.debt_import_rows
           where batch_id = p_batch_id and coalesce(decision, suggested) <> 'ignorar'
             and (blocking or coalesce(decision, suggested) = 'verificar' or computed is null)
           order by sheet, row_no limit 10) x;
  if v_bad is not null then
    raise exception 'Há linhas com erro ou decisão pendente (%): corrija ou marque "Ignorar" antes de gravar.', v_bad;
  end if;
  if not exists (select 1 from public.debt_import_rows
                  where batch_id = p_batch_id and coalesce(decision, suggested) <> 'ignorar') then
    raise exception 'Nenhuma linha marcada para importar.';
  end if;

  -- A etiqueta automática do dia (sugestão 7).
  select id into v_tag from public.debt_tags where lower(btrim(name)) = lower(v_tag_name);
  if v_tag is null then
    insert into public.debt_tags (name, created_by, updated_by) values (v_tag_name, v_uid, v_uid)
    returning id into v_tag;
  end if;

  -- Primeiro as dívidas (a aba Protestos aponta para elas pelo "#").
  for r in select * from public.debt_import_rows
            where batch_id = p_batch_id and sheet = 'dividas' and coalesce(decision, suggested) <> 'ignorar'
            order by row_no loop
    v_eff := coalesce(r.decision, r.suggested);
    v_where := 'Linha ' || r.row_no || ' da aba Dívidas';
    begin
      select x.debt_id, x.new_suppliers, x.new_categories into v_debt, v_ns, v_nc
        from public._debt_import_debt(r.computed, case when v_eff = 'vincular' then 'C' else r.computed -> 'debt' ->> 'origin' end,
                                      v_tag, p_batch_id, v_where) x;
    exception when others then
      raise exception '%: %', v_where, sqlerrm;
    end;
    update public.debt_import_rows set debt_id = v_debt where id = r.id;
    v_debts := v_debts + 1;
    v_suppliers := v_suppliers + v_ns;
    v_categories := v_categories + v_nc;
  end loop;

  -- Depois os protestos: ligados a uma dívida (do lote ou já cadastrada) ou
  -- como dívida nova.
  for r in select * from public.debt_import_rows
            where batch_id = p_batch_id and sheet = 'protestos' and coalesce(decision, suggested) <> 'ignorar'
            order by row_no loop
    v_eff := coalesce(r.decision, r.suggested);
    v_where := 'Linha ' || r.row_no || ' da aba Protestos';
    begin
      v_debt := null;
      if v_eff = 'nova' then
        if jsonb_typeof(r.computed -> 'nova') is distinct from 'object' then raise exception 'faltam os dados da dívida nova.'; end if;
        select x.debt_id, x.new_suppliers, x.new_categories into v_debt, v_ns, v_nc
          from public._debt_import_debt(r.computed -> 'nova', 'A', v_tag, p_batch_id, v_where) x;
        v_debts := v_debts + 1;
        v_suppliers := v_suppliers + v_ns;
        v_categories := v_categories + v_nc;
      elsif r.computed -> 'link' ? 'debt_id' then
        select d.id into v_debt from public.debts d
         where d.id = (r.computed -> 'link' ->> 'debt_id')::uuid and d.deleted_at is null;
        if v_debt is null then raise exception 'a dívida escolhida não existe mais.'; end if;
      else
        select ir.debt_id into v_debt from public.debt_import_rows ir
         where ir.batch_id = p_batch_id and ir.sheet = 'dividas' and ir.debt_id is not null
           and ir.source_key = r.computed -> 'link' ->> 'source_key'
         limit 1;
        if v_debt is null then
          raise exception 'a dívida nº % não está sendo importada (foi ignorada ou não existe na aba Dívidas).',
            coalesce(r.computed -> 'link' ->> 'source_key', '?');
        end if;
      end if;
      v_office := public._debt_import_notary(r.computed -> 'protest' ->> 'notary_name');
      v_prot := public.debt_save_protest(
        (coalesce(r.computed -> 'protest', '{}'::jsonb) - 'notary_name')
        || jsonb_build_object('debt_id', v_debt, 'notary_office_id', v_office));
    exception when others then
      raise exception '%: %', v_where, sqlerrm;
    end;
    update public.debt_import_rows set debt_id = v_debt, protest_id = v_prot where id = r.id;
    v_protests := v_protests + 1;
  end loop;

  -- Os títulos no Contas a Pagar (origens A e B), pela porta da fase 3. A que
  -- não puder (mês fechado, conta faltando) fica sem título e com o motivo — a
  -- lista mostra o aviso "ainda não estão no Contas a Pagar".
  if coalesce(p_generate_titles, false) then
    for t in select id, code from public.debts
              where import_batch_id = p_batch_id and deleted_at is null and origin <> 'C' and finance_synced_at is null
              order by code loop
      begin
        perform public._debt_sync_finance(t.id);
        v_titles := v_titles + 1;
      exception when others then
        v_fail := v_fail || jsonb_build_object('id', t.id, 'code', t.code, 'motivo', sqlerrm);
      end;
    end loop;
  end if;

  v_result := jsonb_build_object(
    'debts', v_debts, 'protests', v_protests, 'suppliers_created', v_suppliers,
    'categories_created', v_categories, 'titles', v_titles, 'title_failures', v_fail,
    'tag', v_tag_name);

  update public.debt_import_batches
     set status = 'importado', committed_by = v_uid, committed_at = now(), tag_id = v_tag,
         generate_titles = coalesce(p_generate_titles, false), result = v_result,
         updated_by = v_uid, updated_at = now()
   where id = p_batch_id;
  return v_result;
end;
$$;
revoke execute on function public.debt_import_commit(uuid, boolean) from public, anon, authenticated;
grant execute on function public.debt_import_commit(uuid, boolean) to authenticated;

-- Desfazer: só enquanto nenhuma dívida do lote tem pagamento. Cada dívida sai
-- pela exclusão de sempre (que cancela o título gerado e solta o vinculado).
-- Credores, categorias e cartórios criados ficam no cadastro.
create or replace function public.debt_import_undo(p_batch_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  b public.debt_import_batches%rowtype;
  d record;
  v_n integer := 0;
begin
  if not public.debt_can('acao.dividas.importar', null) or not public.debt_can('acao.dividas.excluir', null) then
    raise exception 'Você não tem permissão para desfazer uma importação.';
  end if;
  select * into b from public.debt_import_batches where id = p_batch_id for update;
  if not found then raise exception 'Lote não encontrado.'; end if;
  if b.status <> 'importado' then raise exception 'Só um lote importado pode ser desfeito.'; end if;
  if coalesce(length(btrim(p_reason)), 0) < 5 then raise exception 'Escreva o motivo para desfazer a importação.'; end if;
  if exists (
       select 1 from public.payables p
         join public.debts x on x.id = p.debt_id
        where x.import_batch_id = p_batch_id and x.deleted_at is null
          and coalesce(p.paid_amount_cents, 0) > 0 and p.status not in ('cancelada', 'recusada')) then
    raise exception 'Já há pagamento em título de dívida deste lote: a importação não pode mais ser desfeita. Se preciso, exclua as dívidas uma a uma.';
  end if;

  for d in select id from public.debts where import_batch_id = p_batch_id and deleted_at is null order by code loop
    perform public.debt_delete(d.id, 'Importação desfeita (' || b.code || '): ' || btrim(p_reason));
    v_n := v_n + 1;
  end loop;

  update public.debt_negativations
     set removed_at = now(), removed_by = v_uid, removed_reason = 'Importação desfeita (' || b.code || ')'
   where removed_at is null
     and debt_id in (select id from public.debts where import_batch_id = p_batch_id);
  update public.debt_protests
     set removed_at = now(), removed_by = v_uid, removed_reason = 'Importação desfeita (' || b.code || ')'
   where removed_at is null
     and id in (select protest_id from public.debt_import_rows where batch_id = p_batch_id and protest_id is not null);
  update public.debt_protests
     set removed_at = now(), removed_by = v_uid, removed_reason = 'Importação desfeita (' || b.code || ')'
   where removed_at is null
     and debt_id in (select id from public.debts where import_batch_id = p_batch_id);

  update public.debt_import_batches
     set status = 'desfeito', undone_by = v_uid, undone_at = now(), undone_reason = btrim(p_reason),
         updated_by = v_uid, updated_at = now()
   where id = p_batch_id;
  return v_n;
end;
$$;
revoke execute on function public.debt_import_undo(uuid, text) from public, anon, authenticated;
grant execute on function public.debt_import_undo(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) LEITURA (RLS) — só quem tem o módulo; nenhuma regra de escrita
-- -----------------------------------------------------------------------------
alter table public.debt_import_templates enable row level security;
alter table public.debt_import_batches enable row level security;
alter table public.debt_import_rows enable row level security;
alter table public.debt_month_positions enable row level security;

drop policy if exists "debt_import_templates_select" on public.debt_import_templates;
create policy "debt_import_templates_select" on public.debt_import_templates for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_import_batches_select" on public.debt_import_batches;
create policy "debt_import_batches_select" on public.debt_import_batches for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_import_rows_select" on public.debt_import_rows;
create policy "debt_import_rows_select" on public.debt_import_rows for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_month_positions_select" on public.debt_month_positions;
create policy "debt_month_positions_select" on public.debt_month_positions for select to authenticated
  using (public.debt_can('modulo.dividas', clinic_id));

-- -----------------------------------------------------------------------------
-- 9) AUDITORIA
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'debt_import_rows', 'Linhas da conferência da importação: registro técnico do lote; o que foi gravado aparece na trilha da dívida (0407).'),
  ('public', 'debt_month_positions', 'Fotografia mensal das dívidas: derivada e gravada uma vez pela rotina (0407).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois): o esperado é 1 · true · 4 · 1 · 0
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from public.debt_import_templates where is_default and system) as modelo_padrao,
--   (select 'acao.dividas.importar' = any (select capability from public.permission_defaults)) as permissao,
--   (select count(*) from pg_tables where schemaname = 'public'
--      and tablename in ('debt_import_templates', 'debt_import_batches', 'debt_import_rows', 'debt_month_positions')) as tabelas,
--   (select count(*) from pg_proc where proname = 'debt_import_commit') as gravacao,
--   (select count(*) from public.audit_missing_tables() t where t.table_name like 'debt%') as sem_auditoria;
