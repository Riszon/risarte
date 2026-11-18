-- =============================================================================
-- 1049 — QUEM PAGA OS DEPENDENTES (Empresarial 0.109.0, 18/11/2026)
--
-- Pedido do dono: "quando cadastra os dependentes deve ter como indicar se
-- quem paga a mensalidade é o mesmo do titular ou se é outro que paga. Muitos
-- titulares incluem dependentes mas pagam por fora, com a cobrança no próprio
-- CPF do titular ou num CNPJ."
--
-- Decisões dele (18/11/2026):
--   1. a escolha é NO TITULAR e vale para todos os dependentes dele (o preço
--      do dependente é um pacote do titular — individual, familiar, extras);
--   2. o pagador pode ser a EMPRESA (como sempre foi), o PRÓPRIO TITULAR
--      (no CPF dele) ou OUTRO (nome + CPF ou CNPJ);
--   3. a implantação dos dependentes segue a regra combinada com a empresa
--      e, quando há, vai para o MESMO pagador da mensalidade;
--   4. a planilha de titulares ganha a coluna (Empresa / Titular).
--
-- O QUE MUDA NO BANCO:
--   • employees: quem paga os dependentes (padrão EMPRESA — nada muda para
--     quem já está cadastrado) e, para OUTRO, o nome e o documento;
--   • adhesion_billing: a cobrança à parte guarda DE QUEM são os dependentes
--     (employee_id) e quem paga (nome e documento); a trava de "uma
--     mensalidade por mês" passa a contar também o pagador.
--
-- ⚠️ A CONTA (quanto sai da cobrança da empresa e vai para cada pagador) é do
-- app, na mesma leitura da mensalidade (`computeMonthlyBreakdown`); o banco
-- guarda a escolha, confere o documento e segura a duplicata.
--
-- Nada é apagado: colunas novas com padrão e o índice da trava recriado
-- (a regra antiga é um caso da nova: employee_id nulo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A escolha, no titular
-- -----------------------------------------------------------------------------
alter table empresarial.employees
  add column if not exists dependents_payer text not null default 'EMPRESA',
  add column if not exists dependents_payer_name text,
  add column if not exists dependents_payer_document text;

alter table empresarial.employees drop constraint if exists employees_dependents_payer_check;
alter table empresarial.employees add constraint employees_dependents_payer_check check (
  dependents_payer in ('EMPRESA', 'TITULAR', 'OUTRO')
  -- OUTRO precisa de nome e de um CPF (11) ou CNPJ (14), só números.
  -- coalesce: documento nulo daria NULL, e o check aceita NULL.
  and (
    dependents_payer <> 'OUTRO'
    or (
      nullif(btrim(dependents_payer_name), '') is not null
      and coalesce(dependents_payer_document, '') ~ '^([0-9]{11}|[0-9]{14})$'
    )
  )
);

comment on column empresarial.employees.dependents_payer is
  'Quem paga a mensalidade dos dependentes deste titular (1049): EMPRESA (na '
  'cobrança da empresa, o padrão), TITULAR (cobrança à parte no CPF dele) ou '
  'OUTRO (cobrança à parte em dependents_payer_name / _document).';
comment on column empresarial.employees.dependents_payer_document is
  'Só OUTRO: CPF (11) ou CNPJ (14), só números.';

-- -----------------------------------------------------------------------------
-- 2. A cobrança à parte
-- -----------------------------------------------------------------------------
alter table empresarial.adhesion_billing
  add column if not exists employee_id uuid references empresarial.employees (id) on delete set null,
  add column if not exists payer_name text,
  add column if not exists payer_document text;

comment on column empresarial.adhesion_billing.employee_id is
  'Cobrança à parte dos DEPENDENTES deste titular (1049). Nulo = a cobrança da empresa.';
comment on column empresarial.adhesion_billing.payer_document is
  'Quem paga a cobrança à parte: CPF (11) ou CNPJ (14), só números. Nulo na da empresa.';

alter table empresarial.adhesion_billing drop constraint if exists adhesion_billing_payer_check;
alter table empresarial.adhesion_billing add constraint adhesion_billing_payer_check check (
  employee_id is null
  or (
    nullif(btrim(payer_name), '') is not null
    and coalesce(payer_document, '') ~ '^([0-9]{11}|[0-9]{14})$'
  )
);

create index if not exists adhesion_billing_employee_idx
  on empresarial.adhesion_billing (employee_id) where employee_id is not null;

-- A trava da 1022 ("uma mensalidade por empresa, documento e mês") ganha o
-- pagador: a cobrança da empresa e a de cada titular que paga à parte são
-- coisas diferentes no mesmo mês, e cada uma continua única.
drop index if exists empresarial.adhesion_billing_mensalidade_unica;
create unique index adhesion_billing_mensalidade_unica
  on empresarial.adhesion_billing (company_id, company_document_id, employee_id, reference_month)
  nulls not distinct
  where billing_type = 'MONTHLY' and status <> 'CANCELLED';

comment on index empresarial.adhesion_billing_mensalidade_unica is
  'Uma mensalidade por empresa, documento, pagador à parte (employee_id) e mês '
  '(1022, ampliada na 1049). Cancelada não conta.';

-- -----------------------------------------------------------------------------
-- 3. A planilha de titulares: a coluna "Quem paga os dependentes"
--    (recriada a partir da 1042; só muda o insert dos titulares. Titular que
--    já existia não muda: on conflict do nothing, como antes.)
-- -----------------------------------------------------------------------------
create or replace function empresarial.importar_titulares(
  p_company_id uuid,
  p_titulares jsonb,
  p_dependentes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_titulares int := 0;
  v_dependentes int := 0;
  v_sem_titular int;
  v_limite int;
  v_maximo int;
  v_alvo text;
  v_ativos int;
begin
  -- Duas planilhas da mesma empresa ao mesmo tempo: uma espera a outra, para
  -- o teto ser conferido com o que a primeira gravou.
  perform pg_advisory_xact_lock(
    hashtextextended('empresarial.importar_titulares:' || p_company_id::text, 0)
  );

  -- 1049: a coluna "Quem paga os dependentes" (EMPRESA / TITULAR; vazio =
  -- EMPRESA). OUTRO pede nome e documento: só pela tela.
  insert into empresarial.employees (company_id, cpf, full_name, phone, email, dependent_plan, dependents_payer)
  select p_company_id, t.cpf, t.full_name, t.phone, t.email, 'NONE',
         case when upper(coalesce(t.dependents_payer, '')) = 'TITULAR' then 'TITULAR' else 'EMPRESA' end
  from jsonb_to_recordset(coalesce(p_titulares, '[]'::jsonb))
    as t(cpf text, full_name text, phone text, email text, dependents_payer text)
  on conflict (company_id, cpf) do nothing;
  get diagnostics v_titulares = row_count;

  if jsonb_array_length(coalesce(p_dependentes, '[]'::jsonb)) > 0 then
    select count(*) into v_sem_titular
    from jsonb_to_recordset(p_dependentes) as d(holder_cpf text)
    where not exists (
      select 1 from empresarial.employees e
      where e.company_id = p_company_id and e.cpf = d.holder_cpf
    );
    if v_sem_titular > 0 then
      raise exception 'HOLDER_NOT_FOUND:%', v_sem_titular;
    end if;

    insert into empresarial.dependents (employee_id, cpf, full_name, phone, relationship)
    select e.id, d.cpf, d.full_name, d.phone, d.relationship
    from jsonb_to_recordset(p_dependentes)
      as d(holder_cpf text, cpf text, full_name text, phone text, relationship text)
    join empresarial.employees e
      on e.company_id = p_company_id and e.cpf = d.holder_cpf
    on conflict (employee_id, cpf) do nothing;
    get diagnostics v_dependentes = row_count;
  end if;

  -- O teto de dependentes: só quando esta planilha trouxe dependente novo.
  if v_dependentes > 0 then
    v_limite := empresarial.limite_de_dependentes(p_company_id);
    select c.max_adhesions, c.adhesion_limit_target
      into v_maximo, v_alvo
    from empresarial.companies c
    where c.id = p_company_id;
    -- O máximo da proposta só vale para dependentes quando foi combinado para
    -- eles (mesma leitura de `addDependent`).
    if v_alvo = 'HOLDERS' then
      v_maximo := null;
    end if;

    if v_limite is not null or v_maximo is not null then
      v_ativos := empresarial.dependentes_ativos(p_company_id);
      if v_limite is not null and v_ativos > v_limite then
        raise exception 'DEPENDENT_LIMIT:%:%:%', v_limite, v_ativos - v_dependentes, v_dependentes;
      end if;
      if v_maximo is not null and v_ativos > v_maximo then
        raise exception 'DEPENDENT_MAX:%:%:%', v_maximo, v_ativos - v_dependentes, v_dependentes;
      end if;
    end if;
  end if;

  return jsonb_build_object('titulares', v_titulares, 'dependentes', v_dependentes);
end;
$$;

revoke all on function empresarial.importar_titulares(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function empresarial.importar_titulares(uuid, jsonb, jsonb) to authenticated, service_role;

comment on function empresarial.importar_titulares(uuid, jsonb, jsonb) is
  'Importação da planilha (titulares + dependentes) numa transação só. Recusa '
  'HOLDER_NOT_FOUND, DEPENDENT_LIMIT e DEPENDENT_MAX desfazem tudo. Security '
  'invoker: valem as regras das tabelas. O teto de titulares é do app (AP97). '
  'Desde a 1049 grava quem paga os dependentes (EMPRESA/TITULAR) do titular novo.';

-- CONFERÊNCIA (só leitura): as 3 colunas no titular, as 3 na cobrança, as 2
-- regras, o índice com o pagador e a planilha com a coluna nova.
select
  (select count(*) from information_schema.columns
    where table_schema = 'empresarial' and table_name = 'employees'
      and column_name in ('dependents_payer', 'dependents_payer_name', 'dependents_payer_document')) as colunas_no_titular,
  (select count(*) from information_schema.columns
    where table_schema = 'empresarial' and table_name = 'adhesion_billing'
      and column_name in ('employee_id', 'payer_name', 'payer_document')) as colunas_na_cobranca,
  (select count(*) from pg_constraint
    where conname in ('employees_dependents_payer_check', 'adhesion_billing_payer_check')) as regras,
  (select indexdef like '%employee_id%' from pg_indexes
    where schemaname = 'empresarial' and indexname = 'adhesion_billing_mensalidade_unica') as trava_com_o_pagador,
  (select pg_get_functiondef(p.oid) like '%dependents_payer%' from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial' and p.proname = 'importar_titulares') as planilha_com_o_pagador;
