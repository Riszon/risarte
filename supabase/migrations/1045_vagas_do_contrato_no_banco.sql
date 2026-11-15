-- =============================================================================
-- 1045 — AS VAGAS DO CONTRATO CONFERIDAS PELO BANCO (Empresarial 0.105.0,
--         15/11/2026; levantamento do módulo, grupo A, pedido do dono)
--
-- O QUE ESTAVA ERRADO (lido no código):
--   • REATIVAR um titular (`set_employee_active`) não conferia a vaga: uma
--     empresa com 10 vagas chegava a 12 ativos inativando e reativando;
--   • REATIVAR um dependente (update direto em `dependents`) não conferia o
--     teto de dependentes;
--   • o cadastro um a um conferia só no app — pela API, o insert direto em
--     `employees`/`dependents` passava sem trava.
--
-- O QUE MUDA: dois gatilhos conferem, no banco, toda pessoa que PASSA A
-- ATIVA (entra ativa ou volta a ser ativa), por qualquer caminho: tela,
-- planilha, função ou API.
--
-- ⚠️ A REGRA É A DE SEMPRE (decisão do dono: "pode incluir mais além do
-- contrato, como já tem a regra hoje para incluir novos"):
--   • o limite = o contratado + os termos de inclusão ACEITOS (as mesmas
--     contas de `limite_de_titulares`/`limite_de_dependentes`, agora com a
--     conta numa função interna só — a porta continua com a guarda da 1031);
--   • contrato sem quantidade = sem trava (nulo, regra da 1020);
--   • o máximo da proposta é um teto à parte e só vale para quem foi
--     combinado (HOLDERS/DEPENDENTS/BOTH, mesma leitura do app);
--   • passou do limite → o caminho é o termo de inclusão: aceito, ele soma ao
--     limite e o cadastro (ou a reativação) passa.
--   • dependente de titular INATIVO não ocupa vaga (1021): ele só é conferido
--     quando o titular está ativo — e, quando o titular volta, os dependentes
--     ativos dele entram na conta.
--
-- ⚠️ SÓ A TRANSIÇÃO PARA ATIVO É CONFERIDA. Quem já está ativo não é
-- mexido: empresa que hoje está acima do limite continua funcionando, só não
-- inclui nem reativa mais ninguém sem termo de inclusão.
--
-- ⚠️ A recusa vem com código e números, para a tela montar a frase:
--   VAGAS_TITULARES:<LIMIT|MAX>:<teto>:<ativos antes>
--   VAGAS_DEPENDENTES:<LIMIT|MAX>:<teto>:<ativos antes>
-- (espelho em TS: `recusaDasVagas`, src/lib/empresarial/vagas.ts).
--
-- Nada é apagado nem alterado: só funções e gatilhos novos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A conta, numa função interna (sem guarda) — as portas da 1031 passam a
--    chamá-la. Um lugar só para a soma "contratado + termos aceitos".
-- -----------------------------------------------------------------------------
create or replace function empresarial._limite_de_titulares_raw(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.contracted_holders is null then null
    else c.contracted_holders + coalesce((
      select sum(t.holders)
      from empresarial.company_inclusion_terms t
      where t.company_id = p_company_id
        and t.status = 'ACEITO'
    ), 0)
  end::integer
  from empresarial.companies c
  where c.id = p_company_id;
$$;

create or replace function empresarial._limite_de_dependentes_raw(p_company_id uuid)
returns integer
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
  end::integer
  from empresarial.companies c
  where c.id = p_company_id;
$$;

-- Dependente de titular inativo não ocupa vaga (1021).
create or replace function empresarial._dependentes_ativos_raw(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from empresarial.dependents d
  join empresarial.employees e on e.id = d.employee_id
  where e.company_id = p_company_id
    and e.status = 'ACTIVE'
    and d.status = 'ACTIVE';
$$;

revoke execute on function empresarial._limite_de_titulares_raw(uuid) from public, anon, authenticated;
revoke execute on function empresarial._limite_de_dependentes_raw(uuid) from public, anon, authenticated;
revoke execute on function empresarial._dependentes_ativos_raw(uuid) from public, anon, authenticated;

-- As portas (mesma assinatura e mesma guarda da 1031).
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
  return empresarial._limite_de_titulares_raw(p_company_id);
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
  if p_company_id is null or p_company_id not in (select empresarial.accessible_company_ids()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return empresarial._limite_de_dependentes_raw(p_company_id);
end;
$$;

create or replace function empresarial.dependentes_ativos(p_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_company_id is null or p_company_id not in (select empresarial.accessible_company_ids()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return empresarial._dependentes_ativos_raw(p_company_id);
end;
$$;

revoke execute on function empresarial.limite_de_titulares(uuid) from public, anon, authenticated;
grant execute on function empresarial.limite_de_titulares(uuid) to authenticated, service_role;
revoke execute on function empresarial.limite_de_dependentes(uuid) from public, anon, authenticated;
grant execute on function empresarial.limite_de_dependentes(uuid) to authenticated, service_role;
revoke execute on function empresarial.dependentes_ativos(uuid) from public, anon, authenticated;
grant execute on function empresarial.dependentes_ativos(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. A conferência dos DEPENDENTES de uma empresa (usada pelos dois gatilhos).
--    Conta o estado DEPOIS da gravação: recusa quando passou do teto.
-- -----------------------------------------------------------------------------
create or replace function empresarial._conferir_vagas_de_dependentes(
  p_company_id uuid,
  p_entrando integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite int;
  v_maximo int;
  v_alvo text;
  v_ativos int;
begin
  if coalesce(p_entrando, 0) <= 0 then return; end if;

  v_limite := empresarial._limite_de_dependentes_raw(p_company_id);
  select c.max_adhesions, c.adhesion_limit_target
    into v_maximo, v_alvo
  from empresarial.companies c
  where c.id = p_company_id;
  -- O máximo da proposta só vale para dependentes quando foi combinado para
  -- eles (mesma leitura de `addDependent` e da 1042).
  if v_alvo = 'HOLDERS' then v_maximo := null; end if;
  if v_limite is null and v_maximo is null then return; end if;

  v_ativos := empresarial._dependentes_ativos_raw(p_company_id);
  if v_limite is not null and v_ativos > v_limite then
    raise exception 'VAGAS_DEPENDENTES:LIMIT:%:%', v_limite, v_ativos - p_entrando;
  end if;
  if v_maximo is not null and v_ativos > v_maximo then
    raise exception 'VAGAS_DEPENDENTES:MAX:%:%', v_maximo, v_ativos - p_entrando;
  end if;
end;
$$;

revoke execute on function empresarial._conferir_vagas_de_dependentes(uuid, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. O gatilho dos TITULARES: quem passa a ATIVO.
-- -----------------------------------------------------------------------------
create or replace function empresarial.vagas_do_titular()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite int;
  v_maximo int;
  v_alvo text;
  v_ativos int;
  v_deps int;
begin
  if new.status is distinct from 'ACTIVE' then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'ACTIVE' then return null; end if;

  -- Duas gravações da mesma empresa ao mesmo tempo: uma espera a outra, e a
  -- segunda conta com o que a primeira gravou.
  perform pg_advisory_xact_lock(
    hashtextextended('empresarial.vagas:' || new.company_id::text, 0)
  );

  v_limite := empresarial._limite_de_titulares_raw(new.company_id);
  select c.max_adhesions, c.adhesion_limit_target
    into v_maximo, v_alvo
  from empresarial.companies c
  where c.id = new.company_id;
  -- O máximo da proposta só vale para titulares quando foi combinado para
  -- eles (mesma leitura de `conferirVagasParaTitulares`).
  if v_alvo = 'DEPENDENTS' then v_maximo := null; end if;

  if v_limite is not null or v_maximo is not null then
    -- SÓ TITULARES, só os ativos (o novo já está na conta: gatilho AFTER).
    select count(*)::int into v_ativos
    from empresarial.employees e
    where e.company_id = new.company_id and e.status = 'ACTIVE';

    if v_limite is not null and v_ativos > v_limite then
      raise exception 'VAGAS_TITULARES:LIMIT:%:%', v_limite, v_ativos - 1;
    end if;
    if v_maximo is not null and v_ativos > v_maximo then
      raise exception 'VAGAS_TITULARES:MAX:%:%', v_maximo, v_ativos - 1;
    end if;
  end if;

  -- O titular que volta traz para a conta os dependentes ativos dele.
  select count(*)::int into v_deps
  from empresarial.dependents d
  where d.employee_id = new.id and d.status = 'ACTIVE';
  perform empresarial._conferir_vagas_de_dependentes(new.company_id, v_deps);

  return null;
end;
$$;

revoke execute on function empresarial.vagas_do_titular() from public, anon, authenticated;

drop trigger if exists employees_vagas_do_contrato on empresarial.employees;
create trigger employees_vagas_do_contrato
  after insert or update of status on empresarial.employees
  for each row execute function empresarial.vagas_do_titular();

-- -----------------------------------------------------------------------------
-- 4. O gatilho dos DEPENDENTES: quem passa a ATIVO, com o titular ativo.
-- -----------------------------------------------------------------------------
create or replace function empresarial.vagas_do_dependente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_status_titular text;
begin
  if new.status is distinct from 'ACTIVE' then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'ACTIVE' then return null; end if;

  select e.company_id, e.status into v_company, v_status_titular
  from empresarial.employees e
  where e.id = new.employee_id;
  -- Titular inativo: o dependente não ocupa vaga (1021). Ele entra na conta
  -- quando o titular voltar (gatilho do titular).
  if v_company is null or v_status_titular is distinct from 'ACTIVE' then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('empresarial.vagas:' || v_company::text, 0)
  );
  perform empresarial._conferir_vagas_de_dependentes(v_company, 1);
  return null;
end;
$$;

revoke execute on function empresarial.vagas_do_dependente() from public, anon, authenticated;

drop trigger if exists dependents_vagas_do_contrato on empresarial.dependents;
create trigger dependents_vagas_do_contrato
  after insert or update of status on empresarial.dependents
  for each row execute function empresarial.vagas_do_dependente();

comment on function empresarial.vagas_do_titular() is
  'Gatilho (1045): titular que passa a ATIVO só entra se couber no limite do '
  'contrato (contratado + termos aceitos) e no máximo da proposta. Recusa '
  'VAGAS_TITULARES:<LIMIT|MAX>:<teto>:<ativos antes> (ou VAGAS_DEPENDENTES, '
  'pelos dependentes ativos que ele traz).';
comment on function empresarial.vagas_do_dependente() is
  'Gatilho (1045): dependente que passa a ATIVO, de titular ativo, só entra se '
  'couber no teto de dependentes. Recusa VAGAS_DEPENDENTES:<LIMIT|MAX>:<teto>:<ativos antes>.';

-- CONFERÊNCIA (só leitura): 2 gatilhos, 6 funções internas fechadas a
-- logados, as 3 portas abertas a logados.
select
  (select count(*) from pg_trigger
    where tgname in ('employees_vagas_do_contrato', 'dependents_vagas_do_contrato')
      and not tgisinternal) as gatilhos,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial'
      and p.proname in ('_limite_de_titulares_raw', '_limite_de_dependentes_raw',
                        '_dependentes_ativos_raw', '_conferir_vagas_de_dependentes',
                        'vagas_do_titular', 'vagas_do_dependente')
      and not has_function_privilege('authenticated', p.oid, 'execute')) as internas_fechadas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial'
      and p.proname in ('limite_de_titulares', 'limite_de_dependentes', 'dependentes_ativos')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')) as portas_ok;
