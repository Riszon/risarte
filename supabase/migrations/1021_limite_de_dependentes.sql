-- =============================================================================
-- 1021 — O TETO DE DEPENDENTES (OC-00083, I4 — a metade que ficou faltando)
--
-- Decisão do dono (24/09/2026), na I4: "deve ser definido a quantidade máxima
-- de adesões para aquele acordo (sendo por titulares OU DEPENDENTES OU AMBOS)
-- de acordo o combinado na proposta."
--
-- ⚠️ A 1020 ENTREGOU SÓ A METADE. Ela criou `contracted_dependents`, o
-- fechamento passou a gravar o campo, e o termo de inclusão já conta
-- dependentes — mas NADA conferia esse teto na hora de cadastrar. O acordo
-- dizia "no máximo 50 dependentes" e o sistema aceitava 500, em silêncio.
-- Achado ao levantar as pendências do módulo, não por relato: o campo existia
-- e ninguém o lia.
--
-- Esta migração é o espelho exato da `limite_de_titulares`: mesma conta, mesma
-- leitura de NULO, mesma porta. Duas contas diferentes para a mesma pergunta é
-- como elas passam a divergir.
--
-- Idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- QUANTOS DEPENDENTES ESTA EMPRESA PODE TER HOJE
-- -----------------------------------------------------------------------------
--
-- Contratado + o que os termos de inclusão ACEITOS acrescentaram — igualzinho
-- aos titulares. Fica no banco, e não só no app, porque é a conta que decide
-- se um cadastro entra: a mesma resposta precisa valer para a tela de hoje e
-- para qualquer caminho futuro (importação de planilha, integração).
--
-- ⚠️ NULO = SEM TETO, nunca "zero". Toda empresa fechada antes da 1020 tem o
-- campo vazio, e tratá-lo como zero impediria o cadastro do primeiro
-- dependente de todas elas.
create or replace function empresarial.limite_de_dependentes(p_company_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
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
  where c.id = p_company_id;
$$;

revoke all on function empresarial.limite_de_dependentes(uuid) from public;
grant execute on function empresarial.limite_de_dependentes(uuid) to authenticated, service_role;

comment on function empresarial.limite_de_dependentes(uuid) is
  'Quantos dependentes a empresa pode ter: o contratado mais o que os termos '
  'de inclusão ACEITOS acrescentaram. NULO = contrato sem teto de '
  'dependentes, portanto sem trava. Espelho de limite_de_titulares(uuid).';

-- -----------------------------------------------------------------------------
-- QUANTOS DEPENDENTES ATIVOS EXISTEM
-- -----------------------------------------------------------------------------
--
-- ⚠️ POR QUE UMA FUNÇÃO, e não uma consulta na tela: `dependents` não tem
-- `company_id` — ela pendura no titular. Contar exige juntar as duas tabelas e
-- filtrar OS DOIS status, e essa regra escrita em cada lugar que precisar dela
-- é a receita para um lugar contar o dependente de um titular demitido.
--
-- Dependente de titular INATIVO não ocupa vaga: se ocupasse, a empresa que
-- trocou de funcionário ficaria travada por gente que não está mais no
-- programa.
create or replace function empresarial.dependentes_ativos(p_company_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from empresarial.dependents d
  join empresarial.employees e on e.id = d.employee_id
  where e.company_id = p_company_id
    and e.status = 'ACTIVE'
    and d.status = 'ACTIVE';
$$;

revoke all on function empresarial.dependentes_ativos(uuid) from public;
grant execute on function empresarial.dependentes_ativos(uuid) to authenticated, service_role;

comment on function empresarial.dependentes_ativos(uuid) is
  'Dependentes ATIVOS de titulares ATIVOS da empresa. Dependente de titular '
  'inativo não ocupa vaga — senão a empresa que trocou de funcionário ficaria '
  'travada por quem não está mais no programa.';
