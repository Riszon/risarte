-- =============================================================================
-- 1047 — IMPORTAR EMPRESAS POR PLANILHA (Empresarial 0.107.0, 16/11/2026)
--
-- Pedido do dono: migrar para o sistema as empresas que JÁ fazem parte do
-- programa, por uma planilha modelo (`modelo-empresas-xlsx.ts`). A conferência
-- linha a linha é do app (`conferirPlanilhaDeEmpresas`, pura, roda no
-- servidor); esta função só GRAVA — e grava tudo numa transação: se uma
-- empresa falhar, nenhuma entra (tudo ou nada, como a planilha de titulares).
--
-- Grava, por empresa: a empresa, os documentos (o principal e os da aba
-- Outros CNPJs), as unidades da parceria e, se a planilha trouxe, os preços
-- combinados. NÃO gera cobrança de implantação (decisão do dono: as empresas
-- já estão no programa) e NÃO copia benefícios (valem os padrão da rede).
--
-- ⚠️ `security invoker` DE PROPÓSITO: quem grava é a pessoa logada, e as
-- regras das tabelas continuam valendo (só o gestor do programa cria
-- empresa). A função não abre porta nova.
--
-- ⚠️ DOCUMENTO QUE JÁ EXISTE é recusado (decisão do dono): a conferência do
-- app já recusa, e aqui a recusa vale também para duas importações ao mesmo
-- tempo — `DOCUMENT_EXISTS:<documento>`, desfazendo tudo.
--
-- Nada é apagado nem alterado: só `insert`.
-- =============================================================================

create or replace function empresarial.importar_empresas(p_empresas jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_e jsonb;
  v_c jsonb;
  v_d jsonb;
  v_id uuid;
  v_n integer := 0;
  v_doc text;
begin
  if jsonb_typeof(coalesce(p_empresas, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_PAYLOAD';
  end if;

  -- Duas importações ao mesmo tempo: uma espera a outra, e a segunda vê os
  -- documentos que a primeira gravou.
  perform pg_advisory_xact_lock(hashtextextended('empresarial.importar_empresas', 0));

  for v_e in select * from jsonb_array_elements(coalesce(p_empresas, '[]'::jsonb))
  loop
    v_c := v_e -> 'empresa';

    -- O documento (qualquer um da empresa) já está no sistema?
    for v_d in select * from jsonb_array_elements(coalesce(v_e -> 'documentos', '[]'::jsonb))
    loop
      v_doc := v_d ->> 'doc_number';
      if exists (select 1 from empresarial.company_documents cd where cd.doc_number = v_doc)
         or (coalesce((v_d ->> 'is_primary')::boolean, false)
             and exists (select 1 from empresarial.companies co where co.cnpj = left(v_doc, 14))) then
        raise exception 'DOCUMENT_EXISTS:%', v_doc;
      end if;
    end loop;

    insert into empresarial.companies (
      cnpj, legal_name, trade_name, state_registration, category, status,
      contract_started_at, contracted_holders, contracted_dependents,
      employee_count, main_clinic_id, payment_model, company_subsidy_type,
      company_subsidy_value, billing_basis, fixed_monthly_cents, billing_model,
      due_day, payment_methods, default_max_installments, grace_period_days,
      employee_grace_period_days, responsible_name, responsible_role,
      responsible_cpf, responsible_email, responsible_phone, address,
      assigned_consultant_id, notes
    ) values (
      v_c ->> 'cnpj',
      v_c ->> 'legal_name',
      v_c ->> 'trade_name',
      v_c ->> 'state_registration',
      coalesce(v_c ->> 'category', 'empresa_privada'),
      coalesce(v_c ->> 'status', 'ACTIVE'),
      (v_c ->> 'contract_started_at')::date,
      (v_c ->> 'contracted_holders')::integer,
      (v_c ->> 'contracted_dependents')::integer,
      (v_c ->> 'employee_count')::integer,
      (v_c ->> 'main_clinic_id')::uuid,
      v_c ->> 'payment_model',
      v_c ->> 'company_subsidy_type',
      (v_c ->> 'company_subsidy_value')::bigint,
      coalesce(v_c ->> 'billing_basis', 'PER_EMPLOYEE'),
      (v_c ->> 'fixed_monthly_cents')::bigint,
      coalesce(v_c ->> 'billing_model', 'unico'),
      coalesce((v_c ->> 'due_day')::integer, 5),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(v_c -> 'payment_methods') x),
        array['BOLETO', 'PIX', 'CARD']
      ),
      coalesce((v_c ->> 'default_max_installments')::integer, 24),
      coalesce((v_c ->> 'grace_period_days')::integer, 0),
      coalesce((v_c ->> 'employee_grace_period_days')::integer, 0),
      v_c ->> 'responsible_name',
      v_c ->> 'responsible_role',
      v_c ->> 'responsible_cpf',
      v_c ->> 'responsible_email',
      v_c ->> 'responsible_phone',
      case when jsonb_typeof(v_c -> 'address') = 'object' then v_c -> 'address' end,
      (v_c ->> 'assigned_consultant_id')::uuid,
      v_c ->> 'notes'
    )
    returning id into v_id;

    insert into empresarial.company_documents (company_id, doc_type, doc_number, holder_cpf, is_primary, nickname)
    select v_id,
           d ->> 'doc_type',
           d ->> 'doc_number',
           d ->> 'holder_cpf',
           coalesce((d ->> 'is_primary')::boolean, false),
           d ->> 'nickname'
    from jsonb_array_elements(coalesce(v_e -> 'documentos', '[]'::jsonb)) d;

    insert into empresarial.company_clinics (company_id, clinic_id)
    select distinct v_id, u::uuid
    from jsonb_array_elements_text(coalesce(v_e -> 'unidades', '[]'::jsonb)) u;

    if jsonb_typeof(v_e -> 'precos') = 'object' then
      insert into empresarial.adhesion_pricing (
        company_id, holder_fee_cents, dependent_individual_fee_cents,
        dependent_family_fee_cents, dependent_family_extra_fee_cents,
        dependent_mode
      ) values (
        v_id,
        (v_e -> 'precos' ->> 'holder_fee_cents')::integer,
        (v_e -> 'precos' ->> 'dependent_individual_fee_cents')::integer,
        (v_e -> 'precos' ->> 'dependent_family_fee_cents')::integer,
        (v_e -> 'precos' ->> 'dependent_family_extra_fee_cents')::integer,
        coalesce(v_e -> 'precos' ->> 'dependent_mode', 'FAMILY_PACKAGE')
      );
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function empresarial.importar_empresas(jsonb) from public, anon, authenticated;
grant execute on function empresarial.importar_empresas(jsonb) to authenticated, service_role;

comment on function empresarial.importar_empresas(jsonb) is
  'Importação da planilha de empresas (1047): empresa, documentos, unidades da '
  'parceria e preços combinados, numa transação. Recusa DOCUMENT_EXISTS. '
  'Security invoker (valem as regras das tabelas). A conferência é do app.';

-- CONFERÊNCIA (só leitura): a função existe, é invoker, logado executa e
-- anônimo não.
select
  p.proname as funcao,
  not p.prosecdef as e_invoker,
  has_function_privilege('authenticated', p.oid, 'execute') as logado_executa,
  has_function_privilege('anon', p.oid, 'execute') as anon_executa
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'empresarial' and p.proname = 'importar_empresas';
