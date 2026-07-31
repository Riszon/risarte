-- =============================================================================
-- 1001 — Empresarial: empresa com VÁRIOS documentos, responsável e arquivos
-- -----------------------------------------------------------------------------
-- Pedido do dono (30/07/2026): a empresa parceira deixa de ser "1 empresa = 1
-- CNPJ". Passa a ter:
--   * vários documentos (CNPJ de matriz/filiais, ou CPF/CAEPF/CNO/NIF), com um
--     marcado como PRINCIPAL e apelido para identificar ("Filial Londrina");
--   * categoria (empresa privada, órgão público, produtor rural, autônomo...);
--   * modelo de faturamento (boleto único consolidado x um por CNPJ);
--   * responsável principal (quem assina e trata com o Risarte Empresarial);
--   * arquivos anexados na empresa (contrato social, cartão CNPJ...) e no
--     colaborador (RG, comprovante de vínculo...), em buckets privados.
--   * colaborador vinculado ao CNPJ específico (transparente quando só há um).
--
-- DECISÕES combinadas com o dono antes de escrever (ver relatório da sessão):
--   1. `companies.cnpj` CONTINUA existindo como ESPELHO do documento principal
--      (mantido por gatilho). A fonte da verdade é `company_documents`. Isso
--      evita quebrar os ~15 arquivos do app e o core, que lê `companies`.
--   2. DEPENDENTE herda o CNPJ do titular (só o colaborador tem o vínculo) —
--      não existe dependente num CNPJ diferente do titular.
--   3. Nomes técnicos em INGLÊS (padrão do repo); telas em pt-BR.
--
-- Idempotente.
-- =============================================================================

-- 1) Empresa: categoria, faturamento e responsável -----------------------------
alter table empresarial.companies
  add column if not exists category varchar(20) not null default 'empresa_privada',
  add column if not exists billing_model varchar(10) not null default 'unico',
  add column if not exists responsible_name varchar(255),
  add column if not exists responsible_role varchar(120),
  add column if not exists responsible_cpf varchar(14),
  add column if not exists responsible_email varchar(255),
  add column if not exists responsible_phone varchar(20);

do $$
begin
  alter table empresarial.companies
    add constraint companies_category_check check (category in (
      'empresa_privada','orgao_publico','consorcio','condominio',
      'produtor_rural','autonomo','obra_civil','estrangeiro'
    ));
exception when duplicate_object then null; end $$;

do $$
begin
  alter table empresarial.companies
    add constraint companies_billing_model_check
      check (billing_model in ('unico','por_cnpj'));
exception when duplicate_object then null; end $$;

comment on column empresarial.companies.cnpj is
  'ESPELHO do documento principal (empresarial.company_documents). Mantido por '
  'gatilho — não editar direto; a fonte da verdade é company_documents.';

-- 2) Documentos da empresa (um-para-muitos) -----------------------------------
create table if not exists empresarial.company_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  doc_type varchar(10) not null
    check (doc_type in ('CNPJ','CPF','CAEPF','CNO','NIF')),
  -- Só dígitos (NIF pode ser alfanumérico).
  doc_number varchar(20) not null,
  -- Com máscara, para exibir/imprimir.
  doc_formatted varchar(30) not null default '',
  -- CAEPF é vinculado ao CPF do produtor/titular.
  holder_cpf varchar(14),
  is_primary boolean not null default false,
  nickname varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, doc_type, doc_number)
);

create index if not exists company_documents_company_idx
  on empresarial.company_documents (company_id);

-- Exatamente UM principal por empresa.
create unique index if not exists company_documents_one_primary
  on empresarial.company_documents (company_id)
  where is_primary;

drop trigger if exists company_documents_set_updated_at on empresarial.company_documents;
create trigger company_documents_set_updated_at
  before update on empresarial.company_documents
  for each row execute function public.set_updated_at();

-- 3) Normalização + validação por tipo de documento ---------------------------
create or replace function empresarial.normalize_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_digits text;
  v_len int;
begin
  if new.doc_type = 'NIF' then
    -- Estrangeiro: alfanumérico, 4–20 (mantém como digitado, sem símbolos).
    new.doc_number := upper(regexp_replace(coalesce(new.doc_number, ''), '[^A-Za-z0-9]', '', 'g'));
    if length(new.doc_number) < 4 or length(new.doc_number) > 20 then
      raise exception 'DOC_INVALID_NIF'
        using hint = 'O NIF deve ter de 4 a 20 caracteres.';
    end if;
    new.doc_formatted := new.doc_number;
    new.holder_cpf := null;
    return new;
  end if;

  v_digits := regexp_replace(coalesce(new.doc_number, ''), '\D', '', 'g');
  v_len := length(v_digits);

  if new.doc_type = 'CNPJ' and v_len <> 14 then
    raise exception 'DOC_INVALID_CNPJ' using hint = 'O CNPJ deve ter 14 dígitos.';
  elsif new.doc_type = 'CAEPF' and v_len <> 14 then
    raise exception 'DOC_INVALID_CAEPF' using hint = 'O CAEPF deve ter 14 dígitos.';
  elsif new.doc_type = 'CPF' and v_len <> 11 then
    raise exception 'DOC_INVALID_CPF' using hint = 'O CPF deve ter 11 dígitos.';
  elsif new.doc_type = 'CNO' and v_len <> 12 then
    raise exception 'DOC_INVALID_CNO' using hint = 'O CNO deve ter 12 dígitos.';
  end if;

  new.doc_number := v_digits;
  new.doc_formatted := case new.doc_type
    when 'CNPJ' then regexp_replace(v_digits, '(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})', '\1.\2.\3/\4-\5')
    when 'CPF'  then regexp_replace(v_digits, '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4')
    when 'CAEPF' then regexp_replace(v_digits, '(\d{3})(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3/\4-\5')
    when 'CNO'  then regexp_replace(v_digits, '(\d{2})(\d{3})(\d{5})(\d{2})', '\1.\2.\3/\4')
    else v_digits
  end;

  -- CAEPF exige o CPF do titular; nos outros tipos o campo não se aplica.
  if new.doc_type = 'CAEPF' then
    if public.cpf_digits(new.holder_cpf) is null then
      raise exception 'DOC_CAEPF_NEEDS_HOLDER'
        using hint = 'Informe o CPF do titular do CAEPF.';
    end if;
  else
    new.holder_cpf := null;
  end if;

  return new;
end $$;

drop trigger if exists company_documents_normalize on empresarial.company_documents;
create trigger company_documents_normalize
  before insert or update of doc_type, doc_number, holder_cpf
  on empresarial.company_documents
  for each row execute function empresarial.normalize_document();

-- 4) Espelho: o documento principal alimenta companies.cnpj -------------------
create or replace function empresarial.sync_company_primary_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_number text;
begin
  select doc_number into v_number
  from empresarial.company_documents
  where company_id = v_company and is_primary
  limit 1;

  if v_number is not null then
    update empresarial.companies
      set cnpj = left(v_number, 14)
    where id = v_company and cnpj is distinct from left(v_number, 14);
  end if;
  return null;
end $$;

drop trigger if exists company_documents_sync_primary on empresarial.company_documents;
create trigger company_documents_sync_primary
  after insert or update of doc_number, is_primary or delete
  on empresarial.company_documents
  for each row execute function empresarial.sync_company_primary_document();

-- 5) Colaborador vinculado ao documento (CNPJ) específico ---------------------
alter table empresarial.employees
  add column if not exists company_document_id uuid
    references empresarial.company_documents (id) on delete set null;

create index if not exists employees_company_document_idx
  on empresarial.employees (company_document_id);

comment on column empresarial.employees.company_document_id is
  'CNPJ/documento da empresa a que este colaborador pertence. NULL = empresa com '
  'um único documento (o app resolve). Dependentes herdam o do titular.';

-- 6) Arquivos da empresa e do colaborador -------------------------------------
create table if not exists empresarial.company_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  file_type varchar(30) not null default 'outro'
    check (file_type in ('contrato_social','cartao_cnpj','procuracao','contrato_programa','outro')),
  file_name varchar(255) not null,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_files_company_idx
  on empresarial.company_files (company_id);

create table if not exists empresarial.employee_files (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references empresarial.employees (id) on delete cascade,
  -- Preenchido quando o arquivo é de um DEPENDENTE do titular.
  dependent_id uuid references empresarial.dependents (id) on delete cascade,
  file_type varchar(30) not null default 'outro'
    check (file_type in ('rg','cpf','comprovante_vinculo','termo_adesao','outro')),
  file_name varchar(255) not null,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists employee_files_employee_idx
  on empresarial.employee_files (employee_id);

-- 7) RLS das tabelas novas ----------------------------------------------------
alter table empresarial.company_documents enable row level security;
alter table empresarial.company_files enable row level security;
alter table empresarial.employee_files enable row level security;

drop policy if exists company_documents_select on empresarial.company_documents;
create policy company_documents_select on empresarial.company_documents
  for select to authenticated
  using (company_id in (select empresarial.accessible_company_ids()));

drop policy if exists company_documents_write on empresarial.company_documents;
create policy company_documents_write on empresarial.company_documents
  for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

drop policy if exists company_files_select on empresarial.company_files;
create policy company_files_select on empresarial.company_files
  for select to authenticated
  using (company_id in (select empresarial.accessible_company_ids()));

drop policy if exists company_files_write on empresarial.company_files;
create policy company_files_write on empresarial.company_files
  for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());

-- Arquivos do colaborador: quem já pode ver o colaborador (unidade/programa).
drop policy if exists employee_files_select on empresarial.employee_files;
create policy employee_files_select on empresarial.employee_files
  for select to authenticated
  using (
    employee_id in (
      select e.id from empresarial.employees e
      where public.is_admin_master()
         or public.is_network_viewer()
         or e.clinic_id in (select public.user_full_access_clinic_ids())
         or e.company_id in (select empresarial.accessible_company_ids())
    )
  );

drop policy if exists employee_files_write on empresarial.employee_files;
create policy employee_files_write on empresarial.employee_files
  for all to authenticated
  using (
    employee_id in (
      select e.id from empresarial.employees e
      where public.is_admin_master()
         or empresarial.is_program_manager()
         or public.is_sdr()
         or e.clinic_id in (select public.user_full_access_clinic_ids())
    )
  )
  with check (
    employee_id in (
      select e.id from empresarial.employees e
      where public.is_admin_master()
         or empresarial.is_program_manager()
         or public.is_sdr()
         or e.clinic_id in (select public.user_full_access_clinic_ids())
    )
  );

grant select, insert, update, delete
  on empresarial.company_documents, empresarial.company_files,
     empresarial.employee_files to authenticated;
grant all on empresarial.company_documents, empresarial.company_files,
     empresarial.employee_files to service_role;

-- 8) Buckets privados + policies (mesmo padrão do bucket staff-photos) --------
-- Caminho SEMPRE começa pelo id da empresa: <company_id>/...
insert into storage.buckets (id, name, public)
values ('empresarial-empresa-docs', 'empresarial-empresa-docs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('empresarial-colaborador-docs', 'empresarial-colaborador-docs', false)
on conflict (id) do nothing;

create or replace function empresarial.can_manage_company_files(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select empresarial.is_program_manager()
      or p_company_id in (select empresarial.accessible_company_ids());
$$;
grant execute on function empresarial.can_manage_company_files(uuid) to authenticated;

do $$
declare b text;
begin
  foreach b in array array['empresarial-empresa-docs','empresarial-colaborador-docs'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_select');
    execute format($p$
      create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L
             and empresarial.can_manage_company_files((storage.foldername(name))[1]::uuid))
    $p$, b || '_select', b);

    execute format('drop policy if exists %I on storage.objects', b || '_insert');
    execute format($p$
      create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L
             and empresarial.can_manage_company_files((storage.foldername(name))[1]::uuid))
    $p$, b || '_insert', b);

    execute format('drop policy if exists %I on storage.objects', b || '_delete');
    execute format($p$
      create policy %I on storage.objects for delete to authenticated
      using (bucket_id = %L
             and empresarial.can_manage_company_files((storage.foldername(name))[1]::uuid))
    $p$, b || '_delete', b);
  end loop;
end $$;

-- 9) Backfill: cada empresa existente ganha seu CNPJ como documento PRINCIPAL --
insert into empresarial.company_documents
  (company_id, doc_type, doc_number, is_primary, nickname)
select c.id, 'CNPJ', c.cnpj, true, 'Matriz'
from empresarial.companies c
where not exists (
  select 1 from empresarial.company_documents d where d.company_id = c.id
);

-- 10) Colaboradores existentes apontam para o documento principal da empresa --
update empresarial.employees e
set company_document_id = d.id
from empresarial.company_documents d
where d.company_id = e.company_id
  and d.is_primary
  and e.company_document_id is null;
