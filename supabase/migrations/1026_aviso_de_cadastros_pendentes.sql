-- =============================================================================
-- 1026 — AVISO NO SINO: MENSALIDADE GERADA COM CADASTROS FALTANDO (OC-00090)
-- -----------------------------------------------------------------------------
-- Decisão do dono (07/10/2026): a mensalidade combinada é cobrada mesmo quando
-- a empresa ainda não mandou os dados dos colaboradores — o acordo já foi
-- feito, e o cadastro depende dela. O CONTRATADO virou o mínimo da conta (isso
-- é código: `titularesDaMensalidade`).
--
-- O que mora no banco é a outra metade do pedido: "deve aparecer mensagem e
-- notificação de que não foram cadastrados os colaboradores, para que possamos
-- priorizar e cobrar adequadamente estas informações".
--
-- POR QUE É FUNÇÃO DO BANCO: `public.notifications` não tem regra de INSERT
-- (0004) — aviso só nasce por função. E os números do aviso (contratados,
-- cadastrados) são contados AQUI, não recebidos de quem chama: um aviso com
-- número que o navegador mandou seria um aviso que qualquer um escreve.
--
-- UM POR EMPRESA POR MÊS, por pessoa: gerar, cancelar e gerar de novo a mesma
-- mensalidade não enche o sino. Aviso que repete é aviso que ninguém lê.
--
-- QUEM RECEBE: quem gere o programa — Admin Master, Franqueadora/Rede e
-- Consultor RisLife (o mesmo conjunto de `empresarial.is_program_manager()`),
-- só contas ativas.
--
-- Só cria função e avisos. Não altera tabela, não apaga nada. Idempotente.
-- =============================================================================

create or replace function empresarial.avisar_cadastros_pendentes(
  p_company_id uuid,
  p_reference_month date
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_limite int;
  v_ativos int;
  v_faltam int;
  v_titulo text;
  v_inicio text;
  v_corpo text;
  v_n int;
begin
  if not empresarial.is_program_manager() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_reference_month is null then
    return 0;
  end if;

  select coalesce(nullif(btrim(c.trade_name), ''), c.legal_name)
    into v_nome
  from empresarial.companies c
  where c.id = p_company_id;
  if v_nome is null then
    return 0;
  end if;

  -- Sem quantidade contratada não há "faltando": o limite é nulo de propósito.
  v_limite := empresarial.limite_de_titulares(p_company_id);
  if v_limite is null then
    return 0;
  end if;

  select count(*)::int
    into v_ativos
  from empresarial.employees e
  where e.company_id = p_company_id
    and e.status = 'ACTIVE';

  v_faltam := v_limite - v_ativos;
  if v_faltam <= 0 then
    return 0;
  end if;

  v_titulo := 'Cadastros pendentes no Empresarial: ' || v_nome;
  -- O começo do texto é a chave do "um por mês": título + este começo.
  v_inicio := 'Mensalidade de ' || to_char(p_reference_month, 'MM/YYYY') || ':';
  v_corpo := v_inicio
    || ' gerada com cadastros faltando — '
    || v_limite || case when v_limite = 1 then ' titular contratado' else ' titulares contratados' end
    || ', '
    || case
         when v_ativos = 0 then 'nenhum cadastrado'
         when v_ativos = 1 then '1 cadastrado'
         else v_ativos || ' cadastrados'
       end
    || '. Cobre da empresa os dados '
    || case when v_faltam = 1 then 'do titular que falta.' else 'dos ' || v_faltam || ' que faltam.' end;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select g.user_id, null, v_titulo, v_corpo,
         '/empresarial/' || p_company_id || '?aba=colaboradores'
  from (
    select p.id as user_id
    from public.profiles p
    where p.is_admin_master and p.is_active
    union
    select ucr.user_id
    from public.user_clinic_roles ucr
    join public.profiles p on p.id = ucr.user_id
    where ucr.role in ('franchisor_staff', 'rislife_consultant')
      and p.is_active
  ) g
  where not exists (
    select 1
    from public.notifications n
    where n.user_id = g.user_id
      and n.title = v_titulo
      and left(n.body, length(v_inicio)) = v_inicio
  );

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Privada por padrão (AP15: `revoke ... from public` não basta no Supabase);
-- quem gere o programa chama logado, e a guarda confere dentro.
revoke execute on function empresarial.avisar_cadastros_pendentes(uuid, date)
  from public, anon, authenticated;
grant execute on function empresarial.avisar_cadastros_pendentes(uuid, date)
  to authenticated, service_role;

comment on function empresarial.avisar_cadastros_pendentes(uuid, date) is
  'OC-00090: avisa quem gere o programa de que a mensalidade do mês foi gerada '
  'com titulares contratados ainda sem cadastro. Conta os números aqui; um '
  'aviso por empresa, por mês, por pessoa. Devolve quantos avisos criou.';

notify pgrst, 'reload schema';
