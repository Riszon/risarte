-- =============================================================================
-- 1031 — AS CONTAGENS DO EMPRESARIAL SÓ RESPONDEM A QUEM ENXERGA A EMPRESA (AP50)
--
-- Sobra da varredura do schema `empresarial` (16/10/2026), corrigida a pedido
-- do dono: `dependentes_ativos`, `limite_de_titulares` e `limite_de_dependentes`
-- devolviam as CONTAGENS de qualquer empresa a qualquer pessoa logada que
-- tivesse o identificador dela — sem nome, só números, mas números do
-- contrato de uma empresa que a pessoa nem enxerga (quantos titulares e
-- dependentes foram contratados e quantos dependentes estão ativos).
--
-- O QUE MUDA: as três passam a conferir, antes de contar, se a empresa está
-- entre as que quem chama ENXERGA — a mesma régua da lista de empresas
-- (`accessible_company_ids`, usada na regra de leitura de `companies`). Quem
-- usa essas contagens pela tela (cadastro de titular e dependente, cobrança,
-- contrato, termos, ficha da empresa) já precisa enxergar a empresa para
-- chegar lá. A única função do banco que as chama
-- (`avisar_cadastros_pendentes`) exige o financeiro do programa, que enxerga
-- todas. Nenhuma tela chama com a chave de serviço.
--
-- O corpo da conta é o mesmo da definição em uso; muda só a linguagem (sql →
-- plpgsql, para a guarda) e a guarda no começo. Mesma assinatura e retorno.
-- Sem login elas já não executavam (só `authenticated` e `service_role`).
--
-- Nenhuma tabela nova. Nada apaga dado. Idempotente.
-- =============================================================================

create or replace function empresarial.dependentes_ativos(p_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- AP50: só de empresa que quem chama enxerga.
  if p_company_id is null or p_company_id not in (select empresarial.accessible_company_ids()) then
    raise exception 'NOT_ALLOWED';
  end if;

  return (
    select count(*)::int
    from empresarial.dependents d
    join empresarial.employees e on e.id = d.employee_id
    where e.company_id = p_company_id
      and e.status = 'ACTIVE'
      and d.status = 'ACTIVE'
  );
end;
$$;

create or replace function empresarial.limite_de_titulares(p_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- AP50: só de empresa que quem chama enxerga.
  if p_company_id is null or p_company_id not in (select empresarial.accessible_company_ids()) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Nulo de propósito quando o contrato não tem quantidade (sem trava).
  return (
    select case
      when c.contracted_holders is null then null
      else c.contracted_holders + coalesce((
        select sum(t.holders)
        from empresarial.company_inclusion_terms t
        where t.company_id = p_company_id
          and t.status = 'ACEITO'
      ), 0)
    end
    from empresarial.companies c
    where c.id = p_company_id
  );
end;
$$;

create or replace function empresarial.limite_de_dependentes(p_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- AP50: só de empresa que quem chama enxerga.
  if p_company_id is null or p_company_id not in (select empresarial.accessible_company_ids()) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Nulo de propósito quando o contrato não tem quantidade (sem trava).
  return (
    select case
      when c.contracted_dependents is null then null
      else c.contracted_dependents + coalesce((
        select sum(t.dependents)
        from empresarial.company_inclusion_terms t
        where t.company_id = p_company_id
          and t.status = 'ACEITO'
      ), 0)
    end
    from empresarial.companies c
    where c.id = p_company_id
  );
end;
$$;

revoke execute on function empresarial.dependentes_ativos(uuid) from public, anon, authenticated;
grant execute on function empresarial.dependentes_ativos(uuid) to authenticated, service_role;
revoke execute on function empresarial.limite_de_titulares(uuid) from public, anon, authenticated;
grant execute on function empresarial.limite_de_titulares(uuid) to authenticated, service_role;
revoke execute on function empresarial.limite_de_dependentes(uuid) from public, anon, authenticated;
grant execute on function empresarial.limite_de_dependentes(uuid) to authenticated, service_role;
