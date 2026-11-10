-- =============================================================================
-- 1042 — A IMPORTAÇÃO DA PLANILHA NUMA TRANSAÇÃO SÓ, COM O TETO DE DEPENDENTES
--         (AP111, 10/11/2026)
--
-- O QUE ESTAVA ERRADO (lido no código, `importEmployees`):
--   • titulares e dependentes eram DUAS gravações pela API. Se a segunda
--     falhasse, os titulares ficavam gravados e os dependentes não — a tela
--     avisava, mas o estado pela metade existia;
--   • o teto de DEPENDENTES do contrato (`limite_de_dependentes`, 1021), que
--     o cadastro um a um confere, não era conferido na planilha: 500
--     dependentes entravam numa empresa que fechou 50.
--
-- O QUE MUDA: uma função grava as duas abas juntas. Qualquer recusa (titular
-- que não existe, teto de dependentes) DESFAZ TUDO — nada fica pela metade.
--
-- ⚠️ `security invoker` DE PROPÓSITO: quem grava é a pessoa logada, e as
-- regras das tabelas (`employees_write`, `dependents_write`) continuam
-- valendo como valiam pela API. A função não abre porta nova.
--
-- ⚠️ O TETO É CONFERIDO DEPOIS DE GRAVAR, dentro da mesma transação, pelas
-- MESMAS funções do cadastro um a um (`limite_de_dependentes` e
-- `dependentes_ativos`): assim só conta o dependente realmente novo, de
-- titular ativo — reimportar a mesma planilha não é recusado.
--
-- ⚠️ O teto de TITULARES continua no app (`vagasParaTitulares`, AP97), antes
-- de chamar esta função — uma conta só para cada pergunta.
--
-- Nada é apagado nem alterado: só `insert ... on conflict do nothing`.
-- =============================================================================

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

  insert into empresarial.employees (company_id, cpf, full_name, phone, email, dependent_plan)
  select p_company_id, t.cpf, t.full_name, t.phone, t.email, 'NONE'
  from jsonb_to_recordset(coalesce(p_titulares, '[]'::jsonb))
    as t(cpf text, full_name text, phone text, email text)
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
  'invoker: valem as regras das tabelas. O teto de titulares é do app (AP97).';

-- CONFERÊNCIA (só leitura): a função existe, é invoker e só o logado executa.
select
  p.proname as funcao,
  not p.prosecdef as e_invoker,
  has_function_privilege('anon', p.oid, 'execute') as anon_executa,
  has_function_privilege('authenticated', p.oid, 'execute') as logado_executa
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'empresarial' and p.proname = 'importar_titulares';
