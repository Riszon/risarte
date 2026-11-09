-- =============================================================================
-- 0371 — FORNECEDORES: FICHA COMPLETA, TIPO CONFIGURÁVEL, ABRANGÊNCIA E HISTÓRICO
-- -----------------------------------------------------------------------------
-- Pedido do dono (09/11/2026), quatro pontos sobre Financeiro → Fornecedores:
--   1. "tem poucas informações sobre os fornecedores";
--   2. escolher se o fornecedor vale só para a Franqueadora, para todas as
--      unidades, ou para unidades escolhidas;
--   3. a lista de "Tipo" tem poucas opções (era fixa no código e no banco, e só
--      aparecia como rótulo na lista — nenhum relatório ou regra usava);
--   4. quem cadastrou, quando, e o histórico de alterações na ficha.
--
-- DECISÕES DO DONO (09/11/2026, "seguir recomendações"):
--   * Obrigatórios: nome, tipo, abrangência e CNPJ/CPF.
--   * Tipo vira lista que a Franqueadora edita (`supplier_kinds`).
--   * Fornecedor da REDE TODA ou SÓ DA FRANQUEADORA: só Admin Master e
--     Financeiro da Franqueadora cadastram. O Gerente cadastra e altera só o
--     que é das unidades que ele gerencia.
--   * Os que já existem ficam como estão hoje: o da Franqueadora vira "Só
--     Franqueadora"; o de uma unidade vira "Unidades escolhidas: aquela".
--     Nada é apagado nem juntado (a RisLife em duplicidade fica para o dono
--     decidir).
--   * Comprador, Coordenador e ASB passam a ENXERGAR fornecedores (antes só
--     quem via o financeiro; em Compras e Estoque a lista vinha vazia).
--   * Histórico na ficha: vê quem vê o fornecedor. A trilha já existia
--     (`audit_capture`, 0288) — esta migração só abre uma janela para ela,
--     limitada aos registros DAQUELE fornecedor.
--
-- O QUE FAZ:
--   1) `supplier_kinds` (tipos editáveis) com a lista nova; `suppliers.kind`
--      deixa o CHECK fixo e passa a apontar para ela.
--   2) Colunas novas na ficha (razão social, IE/IM, WhatsApp, e-mail
--      financeiro, site, endereço, banco, PIX, forma e prazo de pagamento,
--      conta padrão do plano de contas) e `scope` (abrangência).
--   3) `supplier_clinics`: as unidades de um fornecedor "Unidades escolhidas".
--   4) Quem vê (`can_see_supplier`) e onde vale (`supplier_serves_clinic`,
--      `suppliers_for_clinic`); RLS refeita.
--   5) `save_supplier`: a única porta de gravação de quem não é Franqueadora.
--   6) `supplier_history` e `supplier_same_document`.
--   7) Telefone passa a ser gravado só com dígitos (a tela gravava o texto
--      digitado com a máscara pela metade: "(43) 9995-40246").
--
-- Não apaga dado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) TIPOS DE FORNECEDOR — lista editável da rede
-- -----------------------------------------------------------------------------
create table if not exists public.supplier_kinds (
  code text primary key,
  label text not null check (length(trim(label)) > 0),
  sort_order integer not null default 500,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

comment on table public.supplier_kinds is
  'Tipos de fornecedor (catálogo da rede, editável pela Franqueadora). Tipo '
  'desativado continua valendo para quem já o usa, mas some da lista de escolha.';

-- Os 7 códigos antigos continuam (fornecedor existente não muda de código);
-- alguns ganham rótulo mais claro. "servicos" (genérico) sai da lista de
-- escolha, mas segue válido para quem já o tem.
insert into public.supplier_kinds (code, label, sort_order, active) values
  ('laboratorio',       'Laboratório de prótese',              10, true),
  ('ortodontia',        'Ortodontia e alinhadores',            20, true),
  ('dental',            'Materiais odontológicos',             30, true),
  ('equipamentos',      'Equipamentos e manutenção',           40, true),
  ('medicamentos',      'Medicamentos',                        50, true),
  ('esterilizacao',     'Esterilização e coleta de resíduos',  60, true),
  ('limpeza',           'Limpeza e conservação',               70, true),
  ('uniformes',         'Uniformes e EPI',                     80, true),
  ('contabil_juridico', 'Contabilidade e jurídico',            90, true),
  ('ti',                'TI e software',                      100, true),
  ('marketing',         'Marketing',                          110, true),
  ('ocupacao',          'Aluguel e condomínio',               120, true),
  ('utilidades',        'Água, luz, telefone e internet',     130, true),
  ('seguros',           'Seguros',                            140, true),
  ('bancos',            'Bancos e financeiras',               150, true),
  ('impostos',          'Impostos e órgãos públicos',         160, true),
  ('pessoal',           'Prestador pessoa física',            170, true),
  ('servicos',          'Outros serviços',                    180, false),
  ('outros',            'Outros',                             999, true)
on conflict (code) do nothing;

alter table public.supplier_kinds enable row level security;

drop policy if exists "supplier_kinds_select" on public.supplier_kinds;
create policy "supplier_kinds_select" on public.supplier_kinds
  for select to authenticated using (true);

drop policy if exists "supplier_kinds_write" on public.supplier_kinds;
create policy "supplier_kinds_write" on public.supplier_kinds
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

-- O CHECK fixo (0194) sai; a lista passa a ser a tabela acima.
alter table public.suppliers drop constraint if exists suppliers_kind_check;

do $$
begin
  alter table public.suppliers
    add constraint suppliers_kind_fkey
    foreign key (kind) references public.supplier_kinds (code)
    on update cascade;
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2) A FICHA COMPLETA + ABRANGÊNCIA
-- -----------------------------------------------------------------------------
-- `name` continua sendo o nome que aparece nas listas (nome fantasia).
-- `clinic_id` continua obrigatório e passa a significar "onde foi cadastrado";
-- onde o fornecedor VALE é `scope` (+ `supplier_clinics`).
alter table public.suppliers
  add column if not exists legal_name text,
  add column if not exists state_registration text,
  add column if not exists municipal_registration text,
  add column if not exists whatsapp text,
  add column if not exists finance_email text,
  add column if not exists website text,
  add column if not exists address_zip text,
  add column if not exists address_street text,
  add column if not exists address_number text,
  add column if not exists address_complement text,
  add column if not exists address_district text,
  add column if not exists address_city text,
  add column if not exists address_state text,
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists bank_account text,
  add column if not exists bank_account_type text
    check (bank_account_type in ('corrente', 'poupanca', 'pagamento')),
  add column if not exists account_holder text,
  add column if not exists account_holder_document text,
  add column if not exists pix_key_type text
    check (pix_key_type in ('cpf_cnpj', 'email', 'telefone', 'aleatoria')),
  add column if not exists pix_key text,
  add column if not exists default_payment_method text
    check (default_payment_method in ('boleto', 'pix', 'transferencia',
      'cartao', 'debito_automatico', 'dinheiro')),
  add column if not exists payment_terms_days integer
    check (payment_terms_days between 0 and 365),
  add column if not exists default_account_code text
    references public.chart_of_accounts (code),
  add column if not exists scope text not null default 'unidades'
    check (scope in ('franqueadora', 'rede', 'unidades'));

comment on column public.suppliers.clinic_id is
  'Onde o fornecedor foi cadastrado. Onde ele VALE é scope (+ supplier_clinics).';
comment on column public.suppliers.scope is
  'Abrangência: franqueadora = só a Franqueadora; rede = todas as unidades e a '
  'Franqueadora; unidades = as listadas em supplier_clinics.';
comment on column public.suppliers.payment_notes is
  'Outras condições de pagamento (texto livre).';

create index if not exists suppliers_document_idx
  on public.suppliers (document) where document is not null;

-- -----------------------------------------------------------------------------
-- 3) AS UNIDADES DE UM FORNECEDOR "UNIDADES ESCOLHIDAS"
-- -----------------------------------------------------------------------------
create table if not exists public.supplier_clinics (
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  primary key (supplier_id, clinic_id)
);

comment on table public.supplier_clinics is
  'Unidades onde vale um fornecedor de abrangência "unidades". Só faz sentido '
  'com suppliers.scope = unidades; nas outras abrangências fica vazia.';

create index if not exists supplier_clinics_clinic_idx
  on public.supplier_clinics (clinic_id);

-- Os que já existem ficam como estão hoje (decisão do dono). Só mexe em quem
-- ainda não foi tocado (scope no padrão e sem unidade listada), para rodar de
-- novo não desfazer o que alguém tiver mudado na tela.
update public.suppliers s
   set scope = 'franqueadora'
  from public.clinics c
 where c.id = s.clinic_id
   and c.type = 'franchisor'
   and s.scope = 'unidades'
   and not exists (select 1 from public.supplier_clinics x where x.supplier_id = s.id);

insert into public.supplier_clinics (supplier_id, clinic_id, created_at, created_by)
select s.id, s.clinic_id, s.created_at, s.created_by
  from public.suppliers s
 where s.scope = 'unidades'
   and not exists (select 1 from public.supplier_clinics x where x.supplier_id = s.id)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 4) ONDE VALE E QUEM VÊ
-- -----------------------------------------------------------------------------
-- O fornecedor vale nesta unidade? (SECURITY DEFINER: lê supplier_clinics sem
-- passar pela RLS dela, que por sua vez pergunta pelo fornecedor — evita laço.)
create or replace function public.supplier_serves_clinic(
  p_scope text, p_supplier_id uuid, p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_scope
    when 'rede' then true
    when 'franqueadora' then exists (
      select 1 from public.clinics c
       where c.id = p_clinic_id and c.type = 'franchisor')
    else exists (
      select 1 from public.supplier_clinics sc
       where sc.supplier_id = p_supplier_id and sc.clinic_id = p_clinic_id)
  end;
$$;

revoke execute on function public.supplier_serves_clinic(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.supplier_serves_clinic(text, uuid, uuid) to authenticated;

-- Quem vê um fornecedor: a Franqueadora (Admin, Financeiro, Comprador) vê
-- todos; nas unidades, quem trabalha com financeiro, compras ou estoque vê os
-- que valem na sua unidade.
create or replace function public.can_see_supplier(p_supplier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or public.is_purchaser()
    or exists (
      select 1
        from public.suppliers s
        join public.user_clinic_roles ucr
          on ucr.user_id = (select auth.uid())
         and ucr.role in ('unit_manager', 'franchisee', 'finance_franchisor',
                          'purchaser', 'clinical_coordinator', 'asb')
       where s.id = p_supplier_id
         and public.supplier_serves_clinic(s.scope, s.id, ucr.clinic_id)
    )
  );
$$;

revoke execute on function public.can_see_supplier(uuid) from public, anon, authenticated;
grant execute on function public.can_see_supplier(uuid) to authenticated;

-- A lista de fornecedores que valem numa unidade. Roda com a RLS de quem
-- chama: devolve só o que a pessoa enxerga. As telas encadeiam filtros
-- (`.eq("active", true)`, `.order("name")`) sobre o resultado.
create or replace function public.suppliers_for_clinic(p_clinic_id uuid)
returns setof public.suppliers
language sql
stable
security invoker
set search_path = ''
as $$
  select s.*
    from public.suppliers s
   where public.supplier_serves_clinic(s.scope, s.id, p_clinic_id);
$$;

revoke execute on function public.suppliers_for_clinic(uuid) from public, anon, authenticated;
grant execute on function public.suppliers_for_clinic(uuid) to authenticated;

-- RLS nova. Gravar direto na tabela: só a Franqueadora (Admin / Financeiro).
-- O Gerente grava pela `save_supplier`, que confere as unidades dele.
drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers
  for select to authenticated
  using (public.can_see_supplier(id));

drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

alter table public.supplier_clinics enable row level security;

drop policy if exists "supplier_clinics_select" on public.supplier_clinics;
create policy "supplier_clinics_select" on public.supplier_clinics
  for select to authenticated
  using (public.can_see_supplier(supplier_id));

drop policy if exists "supplier_clinics_write" on public.supplier_clinics;
create policy "supplier_clinics_write" on public.supplier_clinics
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

-- -----------------------------------------------------------------------------
-- 5) GRAVAR UM FORNECEDOR — a porta única da tela
-- -----------------------------------------------------------------------------
-- `p` traz os campos da ficha, `id` (nulo = novo), `scope`, `clinic_ids` (para
-- "unidades") e `owner_clinic_id` (a unidade ativa na tela, usada como "onde
-- foi cadastrado" no fornecedor novo). Devolve o id.
create or replace function public.save_supplier(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_full boolean;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_old public.suppliers%rowtype;
  v_scope text := coalesce(nullif(p ->> 'scope', ''), 'unidades');
  v_clinics uuid[];
  v_owner uuid := nullif(p ->> 'owner_clinic_id', '')::uuid;
  v_name text := nullif(trim(p ->> 'name'), '');
  v_kind text := nullif(trim(p ->> 'kind'), '');
  v_doc text := nullif(regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g'), '');
  v_c uuid;
begin
  if v_uid is null then
    raise exception 'É preciso estar logado.';
  end if;

  v_full := public.is_admin_master() or public.is_finance_franchisor();

  select coalesce(array_agg(distinct x::uuid), '{}')
    into v_clinics
    from jsonb_array_elements_text(coalesce(p -> 'clinic_ids', '[]'::jsonb)) x;

  -- Obrigatórios (decisão do dono): nome, tipo, abrangência, CNPJ/CPF.
  if v_name is null then
    raise exception 'Informe o nome do fornecedor.';
  end if;
  if v_kind is null or not exists (select 1 from public.supplier_kinds k where k.code = v_kind) then
    raise exception 'Escolha o tipo do fornecedor.';
  end if;
  if v_doc is null or length(v_doc) not in (11, 14) then
    raise exception 'Informe o CNPJ (14 dígitos) ou o CPF (11 dígitos).';
  end if;
  if v_scope not in ('franqueadora', 'rede', 'unidades') then
    raise exception 'Abrangência inválida.';
  end if;
  if v_scope = 'unidades' then
    if cardinality(v_clinics) = 0 then
      raise exception 'Escolha ao menos uma unidade.';
    end if;
    if exists (
      select 1 from unnest(v_clinics) u(id)
       where not exists (
         select 1 from public.clinics c
          where c.id = u.id and c.type = 'franchise_unit')
    ) then
      raise exception 'Unidade inválida na lista.';
    end if;
  else
    v_clinics := '{}';
  end if;

  if v_id is not null then
    select * into v_old from public.suppliers where id = v_id;
    if not found then
      raise exception 'Fornecedor não encontrado.';
    end if;
  end if;

  -- Quem pode: a Franqueadora, qualquer coisa; o Gerente, só "unidades
  -- escolhidas" dentro das unidades que ele gerencia — e, ao alterar, só
  -- fornecedor que já era só das unidades dele.
  if not v_full then
    if v_scope <> 'unidades' then
      raise exception 'Fornecedor da rede toda ou só da Franqueadora é cadastrado pelo Financeiro da Franqueadora.';
    end if;
    foreach v_c in array v_clinics loop
      if not public.has_role_in_clinic(v_c, array['unit_manager']::public.user_role[]) then
        raise exception 'Você só pode escolher as unidades que gerencia.';
      end if;
    end loop;
    if v_id is not null then
      if v_old.scope <> 'unidades' or exists (
        select 1 from public.supplier_clinics sc
         where sc.supplier_id = v_id
           and not public.has_role_in_clinic(sc.clinic_id, array['unit_manager']::public.user_role[])
      ) then
        raise exception 'Este fornecedor vale também fora das suas unidades; quem altera é o Financeiro da Franqueadora.';
      end if;
    end if;
    if v_owner is null or not (v_owner = any (v_clinics)) then
      v_owner := v_clinics[1];
    end if;
  end if;

  if v_owner is null then
    v_owner := coalesce(
      v_clinics[1],
      (select c.id from public.clinics c where c.type = 'franchisor' order by c.created_at limit 1));
  end if;

  if v_id is null then
    insert into public.suppliers (
      clinic_id, name, legal_name, document, kind, scope,
      state_registration, municipal_registration,
      contact_name, phone, whatsapp, email, finance_email, website,
      address_zip, address_street, address_number, address_complement,
      address_district, address_city, address_state,
      bank_name, bank_branch, bank_account, bank_account_type,
      account_holder, account_holder_document, pix_key_type, pix_key,
      default_payment_method, payment_terms_days, default_account_code,
      payment_notes, notes, active,
      created_by, updated_by
    ) values (
      v_owner, v_name, nullif(trim(p ->> 'legal_name'), ''), v_doc, v_kind, v_scope,
      nullif(trim(p ->> 'state_registration'), ''), nullif(trim(p ->> 'municipal_registration'), ''),
      nullif(trim(p ->> 'contact_name'), ''),
      nullif(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), ''),
      nullif(regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'), ''),
      nullif(trim(p ->> 'email'), ''), nullif(trim(p ->> 'finance_email'), ''),
      nullif(trim(p ->> 'website'), ''),
      nullif(regexp_replace(coalesce(p ->> 'address_zip', ''), '\D', '', 'g'), ''),
      nullif(trim(p ->> 'address_street'), ''), nullif(trim(p ->> 'address_number'), ''),
      nullif(trim(p ->> 'address_complement'), ''), nullif(trim(p ->> 'address_district'), ''),
      nullif(trim(p ->> 'address_city'), ''), nullif(upper(trim(p ->> 'address_state')), ''),
      nullif(trim(p ->> 'bank_name'), ''), nullif(trim(p ->> 'bank_branch'), ''),
      nullif(trim(p ->> 'bank_account'), ''), nullif(p ->> 'bank_account_type', ''),
      nullif(trim(p ->> 'account_holder'), ''),
      nullif(regexp_replace(coalesce(p ->> 'account_holder_document', ''), '\D', '', 'g'), ''),
      nullif(p ->> 'pix_key_type', ''), nullif(trim(p ->> 'pix_key'), ''),
      nullif(p ->> 'default_payment_method', ''),
      nullif(p ->> 'payment_terms_days', '')::integer,
      nullif(p ->> 'default_account_code', ''),
      nullif(trim(p ->> 'payment_notes'), ''), nullif(trim(p ->> 'notes'), ''),
      coalesce((p ->> 'active')::boolean, true),
      v_uid, v_uid
    )
    returning id into v_id;
  else
    update public.suppliers set
      name = v_name,
      legal_name = nullif(trim(p ->> 'legal_name'), ''),
      document = v_doc,
      kind = v_kind,
      scope = v_scope,
      state_registration = nullif(trim(p ->> 'state_registration'), ''),
      municipal_registration = nullif(trim(p ->> 'municipal_registration'), ''),
      contact_name = nullif(trim(p ->> 'contact_name'), ''),
      phone = nullif(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), ''),
      whatsapp = nullif(regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'), ''),
      email = nullif(trim(p ->> 'email'), ''),
      finance_email = nullif(trim(p ->> 'finance_email'), ''),
      website = nullif(trim(p ->> 'website'), ''),
      address_zip = nullif(regexp_replace(coalesce(p ->> 'address_zip', ''), '\D', '', 'g'), ''),
      address_street = nullif(trim(p ->> 'address_street'), ''),
      address_number = nullif(trim(p ->> 'address_number'), ''),
      address_complement = nullif(trim(p ->> 'address_complement'), ''),
      address_district = nullif(trim(p ->> 'address_district'), ''),
      address_city = nullif(trim(p ->> 'address_city'), ''),
      address_state = nullif(upper(trim(p ->> 'address_state')), ''),
      bank_name = nullif(trim(p ->> 'bank_name'), ''),
      bank_branch = nullif(trim(p ->> 'bank_branch'), ''),
      bank_account = nullif(trim(p ->> 'bank_account'), ''),
      bank_account_type = nullif(p ->> 'bank_account_type', ''),
      account_holder = nullif(trim(p ->> 'account_holder'), ''),
      account_holder_document = nullif(regexp_replace(coalesce(p ->> 'account_holder_document', ''), '\D', '', 'g'), ''),
      pix_key_type = nullif(p ->> 'pix_key_type', ''),
      pix_key = nullif(trim(p ->> 'pix_key'), ''),
      default_payment_method = nullif(p ->> 'default_payment_method', ''),
      payment_terms_days = nullif(p ->> 'payment_terms_days', '')::integer,
      default_account_code = nullif(p ->> 'default_account_code', ''),
      payment_notes = nullif(trim(p ->> 'payment_notes'), ''),
      notes = nullif(trim(p ->> 'notes'), ''),
      active = coalesce((p ->> 'active')::boolean, v_old.active),
      updated_at = now(),
      updated_by = v_uid
    where id = v_id;
  end if;

  -- As unidades: tira as que saíram, põe as que entraram (cada uma vira uma
  -- linha no histórico do fornecedor).
  delete from public.supplier_clinics sc
   where sc.supplier_id = v_id
     and not (sc.clinic_id = any (v_clinics));

  insert into public.supplier_clinics (supplier_id, clinic_id, created_by)
  select v_id, u.id, v_uid from unnest(v_clinics) u(id)
  on conflict do nothing;

  return v_id;
end;
$$;

revoke execute on function public.save_supplier(jsonb) from public, anon, authenticated;
grant execute on function public.save_supplier(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) HISTÓRICO NA FICHA e CNPJ REPETIDO
-- -----------------------------------------------------------------------------
-- A trilha (`audit_changes`) é só do Admin Master. Esta janela devolve apenas
-- os registros DESTE fornecedor (a ficha e as unidades dele), e só para quem
-- enxerga o fornecedor.
create or replace function public.supplier_history(p_supplier_id uuid)
returns table (
  id bigint,
  occurred_at timestamptz,
  user_id uuid,
  user_name text,
  actor text,
  table_name text,
  op text,
  changes jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
         a.table_name, a.op, a.changes
    from public.audit_changes a
    left join public.profiles pr on pr.id = a.user_id
   where public.can_see_supplier(p_supplier_id)
     and a.schema_name = 'public'
     and (
       (a.table_name = 'suppliers' and a.row_id = p_supplier_id::text)
       or (a.table_name = 'supplier_clinics' and a.row_id like p_supplier_id::text || ',%')
     )
   order by a.occurred_at desc, a.id desc
   limit 300;
$$;

revoke execute on function public.supplier_history(uuid) from public, anon, authenticated;
grant execute on function public.supplier_history(uuid) to authenticated;

-- Outro fornecedor com o mesmo CNPJ/CPF, em qualquer lugar da rede — para a
-- tela avisar antes de cadastrar em duplicidade. Devolve nome e abrangência.
create or replace function public.supplier_same_document(p_document text, p_except uuid)
returns table (id uuid, name text, scope text, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.scope, s.active
    from public.suppliers s
   where (select auth.uid()) is not null
     and (public.is_admin_master() or public.is_finance_franchisor()
          or public.is_purchaser() or exists (
            select 1 from public.user_clinic_roles ucr
             where ucr.user_id = (select auth.uid())
               and ucr.role in ('unit_manager', 'franchisee')))
     and length(regexp_replace(coalesce(p_document, ''), '\D', '', 'g')) in (11, 14)
     and s.document = regexp_replace(p_document, '\D', '', 'g')
     and (p_except is null or s.id <> p_except)
   order by s.name
   limit 10;
$$;

revoke execute on function public.supplier_same_document(text, uuid) from public, anon, authenticated;
grant execute on function public.supplier_same_document(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) TELEFONE SÓ COM DÍGITOS (a tela formata na hora de mostrar)
-- -----------------------------------------------------------------------------
update public.suppliers
   set phone = nullif(regexp_replace(phone, '\D', '', 'g'), '')
 where phone ~ '\D';

-- Tabelas novas entram na auditoria (regra 0288).
select public.audit_attach_all();
