-- =============================================================================
-- 1029 — O FINANCEIRO DA FRANQUEADORA COBRA NO RISARTE EMPRESARIAL (OC-00105)
--
-- Relato OC-00105 (Financeiro da Franqueadora, treino, 16/10/2026): "Gerar
-- cobrança mensal" respondia "Sem permissão." NÃO ERA DEFEITO: a regra escrita
-- (manual do Empresarial §3) dava a cobrança só ao GESTOR DO PROGRAMA — Admin,
-- Franqueadora/Rede e Consultor RisLife. O Financeiro da Franqueadora nunca
-- esteve na lista; a pessoa do relato perdeu o acesso quando deixou de ser
-- Franqueadora/Rede (OC-00094, 14/10).
--
-- DECISÃO DO DONO (16/10/2026): o Financeiro faz SÓ O FINANCEIRO do programa —
-- gerar mensalidade e implantação (também em lote), dar baixa (também em lote),
-- editar, cancelar, estornar, checar inadimplência e o Acordo de cobrança.
-- Funil, proposta, contrato, termos e configurações seguem com os gestores.
-- A Franqueadora/Rede fica como está (registrado no BACKLOG).
--
-- 🔴 ACHADO NO CAMINHO, CONSERTADO JUNTO (é o mesmo assunto — quem cobra):
-- `cancel_billing` e `reverse_billing` NÃO conferiam quem chamava. Na
-- PRODUÇÃO, sem login, `cancel_billing` chegou à primeira checagem — quem
-- tivesse o identificador de uma cobrança podia cancelá-la sem entrar no
-- sistema. `reverse_billing` recusava sem login, mas aceitava qualquer
-- pessoa logada. As duas ganham a guarda do financeiro e fecham para `anon`.
--
-- O QUE MUDA NO BANCO:
--   1. `is_finance_franchisor()` e `is_program_finance()` (= gestor do
--      programa OU Financeiro da Franqueadora) — novas.
--   2. `accessible_company_ids()`: o Financeiro enxerga todas as empresas
--      do programa (LEITURA; sem isso não há o que cobrar).
--   3. Regra de gravação das cobranças: + Financeiro (o RisLife continua como
--      estava — a regra antiga não o incluía).
--   4. Baixa, checagem de inadimplência e o aviso de cadastros pendentes:
--      gestor OU Financeiro (mesma guarda de antes, régua ampliada).
--   5. Cancelar e estornar: guarda nova; fecham para quem não está logado.
--   6. `salvar_acordo_de_cobranca()` — porta estreita: grava SÓ as colunas do
--      acordo. Abrir a regra de alteração de empresa ao Financeiro deixaria
--      ele mudar a empresa inteira pela API.
--
-- As funções 2, 4 e 5 vêm do banco (definição em uso), com trocas pontuais.
-- Nenhuma tabela nova. Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) As réguas -----------------------------------------------------------------
create or replace function empresarial.is_finance_franchisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_clinic_roles ucr
    where ucr.user_id = (select auth.uid())
      and ucr.role = 'finance_franchisor'
  );
$$;

create or replace function empresarial.is_program_finance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select empresarial.is_program_manager() or empresarial.is_finance_franchisor();
$$;

revoke execute on function empresarial.is_finance_franchisor() from public, anon, authenticated;
grant execute on function empresarial.is_finance_franchisor() to authenticated;
revoke execute on function empresarial.is_program_finance() from public, anon, authenticated;
grant execute on function empresarial.is_program_finance() to authenticated;

-- 2) O Financeiro enxerga todas as empresas do programa ------------------------
CREATE OR REPLACE FUNCTION empresarial.accessible_company_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id
  from empresarial.companies c
  where empresarial.is_program_manager()
     or empresarial.is_finance_franchisor()  -- OC-00105: o financeiro cobra todas
     or c.assigned_consultant_id = (select auth.uid())
  union
  select distinct e.company_id
  from empresarial.employees e
  where e.clinic_id in (select public.user_full_access_clinic_ids());
$function$;

-- 3) Gravar cobranças: + Financeiro -------------------------------------------
drop policy if exists adhesion_billing_write on empresarial.adhesion_billing;
create policy adhesion_billing_write on empresarial.adhesion_billing
  for all to authenticated
  using (public.is_admin_master() or public.is_network_viewer() or empresarial.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_network_viewer() or empresarial.is_finance_franchisor());

-- 4) Baixa, inadimplência e aviso de cadastros --------------------------------
CREATE OR REPLACE FUNCTION empresarial.settle_billing(p_billing_id uuid, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bill record;
  v_rules record;
  v_risarte_pct numeric(5,2);
  v_risarte bigint;
begin
  -- AP16: só o gestor do programa (ou o Admin) dá baixa. Sem usuário (webhook
  -- do ASAAS, rotina) passa: quem chega sem login pela API já não executa.
  if auth.uid() is not null
     and not (public.is_admin_master() or empresarial.is_program_finance()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_bill from empresarial.adhesion_billing where id = p_billing_id;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;
  if v_bill.status = 'PAID' then return; end if;

  select * into v_rules
  from empresarial.split_rules
  where company_id = v_bill.company_id or company_id is null
  order by (company_id = v_bill.company_id) desc
  limit 1;

  v_risarte_pct := case
    when v_bill.billing_type = 'IMPLANTATION'
      then coalesce(v_rules.first_payment_risarte_pct, 0)
    else coalesce(v_rules.recurring_risarte_pct, 50)
  end;
  v_risarte := round(v_bill.total_amount_cents * v_risarte_pct / 100.0);

  update empresarial.adhesion_billing
    set status = 'PAID',
        paid_at = p_paid_at,
        split_risarte_cents = v_risarte,
        split_rislife_cents = v_bill.total_amount_cents - v_risarte
  where id = p_billing_id;

  -- Pagou: se não há mais atraso, a empresa volta a ficar ativa.
  perform empresarial.refresh_company_suspension(v_bill.company_id);
end $function$;

CREATE OR REPLACE FUNCTION empresarial.mark_overdue_and_suspend(p_grace_days integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_suspended int := 0;
begin
  -- AP16: suspender empresa por atraso é ato do gestor do programa (ou rotina).
  if auth.uid() is not null
     and not (public.is_admin_master() or empresarial.is_program_finance()) then
    raise exception 'NOT_ALLOWED';
  end if;

  update empresarial.adhesion_billing
    set status = 'OVERDUE'
  where status = 'PENDING'
    and due_date is not null
    and due_date < current_date;

  with overdue as (
    select distinct b.company_id
    from empresarial.adhesion_billing b
    where b.status = 'OVERDUE'
      and b.due_date is not null
      and b.due_date < current_date - p_grace_days
  )
  update empresarial.companies c
    set status = 'SUSPENDED',
        auto_suspended_at = now()
  from overdue o
  where c.id = o.company_id and c.status = 'ACTIVE';
  get diagnostics v_suspended = row_count;

  return v_suspended;
end $function$;

CREATE OR REPLACE FUNCTION empresarial.avisar_cadastros_pendentes(p_company_id uuid, p_reference_month date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not empresarial.is_program_finance() then  -- OC-00105
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
$function$;

-- 5) Cancelar e estornar: guarda nova, e fechadas para quem não está logado ---
CREATE OR REPLACE FUNCTION empresarial.cancel_billing(p_billing_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status text;
  v_company uuid;
begin
  -- OC-00105: cobrança é do financeiro do programa (gestor do programa ou
  -- Financeiro da Franqueadora). Sem esta guarda a função atendia QUALQUER
  -- chamada — a de cancelar, até sem login.
  if not (public.is_admin_master() or empresarial.is_program_finance()) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'CANCEL_REASON_REQUIRED'
      using hint = 'Informe o motivo do cancelamento.';
  end if;

  select status, company_id into v_status, v_company
  from empresarial.adhesion_billing where id = p_billing_id;
  if v_status is null then
    raise exception 'BILLING_NOT_FOUND';
  end if;
  if v_status = 'PAID' then
    raise exception 'BILLING_ALREADY_PAID'
      using hint = 'Cobrança já paga não pode ser cancelada.';
  end if;

  update empresarial.adhesion_billing
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancel_reason = btrim(p_reason),
      cancelled_by = (select auth.uid())
  where id = p_billing_id;

  perform empresarial.refresh_company_suspension(v_company);
end $function$;

revoke execute on function empresarial.cancel_billing(uuid, text) from public, anon, authenticated;
grant execute on function empresarial.cancel_billing(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION empresarial.reverse_billing(p_billing_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bill record;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
  v_user uuid := (select auth.uid());
  v_grace int := 5; -- o mesmo da checagem diária (`mark_overdue_and_suspend`)
begin
  -- OC-00105: cobrança é do financeiro do programa (gestor do programa ou
  -- Financeiro da Franqueadora). Sem esta guarda a função atendia QUALQUER
  -- chamada — a de cancelar, até sem login.
  if not (public.is_admin_master() or empresarial.is_program_finance()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_bill from empresarial.adhesion_billing where id = p_billing_id;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;

  -- Só se estorna o que foi pago. Cancelada e pendente não têm baixa a desfazer,
  -- e deixar passar criaria um "estorno" que não estorna nada — com rastro e
  -- tudo, enganando quem ler depois.
  if v_bill.status <> 'PAID' then raise exception 'NOT_PAID'; end if;
  if v_motivo is null then raise exception 'REASON_REQUIRED'; end if;

  -- A SITUAÇÃO VOLTA A SER A VERDADE DO VENCIMENTO (decisão do dono,
  -- 22/09/2026): vencida volta EM ATRASO, não "pendente". Voltar sempre como
  -- pendente esconderia o atraso e tiraria a cobrança dos alertas de
  -- inadimplência — exatamente onde ela precisa aparecer.
  --
  -- `today_br()` e não `current_date`: dia de negócio é data civil brasileira
  -- (§0d do CLAUDE.md). Das 21h à meia-noite o UTC já é amanhã, e uma cobrança
  -- que vence hoje voltaria marcada como vencida.
  update empresarial.adhesion_billing
     set status = case
           when due_date is not null and due_date < public.today_br() then 'OVERDUE'
           else 'PENDING'
         end,
         paid_at = null,
         split_risarte_cents = null,
         split_rislife_cents = null,
         reversed_at = now(),
         reversal_reason = v_motivo,
         reversed_by = v_user
   where id = p_billing_id;

  -- A EMPRESA VOLTA A RESPONDER PELO QUE DEVE. A baixa pode tê-la reativado;
  -- desfeita a baixa, a checagem roda de novo — só para ESTA empresa, e com a
  -- mesma carência de 5 dias da rotina diária. Sem isto, estornar seria um
  -- jeito silencioso de manter ativa uma empresa inadimplente.
  if exists (
    select 1 from empresarial.adhesion_billing b
     where b.company_id = v_bill.company_id
       and b.status = 'OVERDUE'
       and b.due_date is not null
       and b.due_date < public.today_br() - v_grace
  ) then
    update empresarial.companies
       set status = 'SUSPENDED', auto_suspended_at = now()
     where id = v_bill.company_id and status = 'ACTIVE';
  else
    -- Continua em dia: se estava suspensa pelo sistema, segue ativa.
    perform empresarial.refresh_company_suspension(v_bill.company_id);
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, null, 'update', 'empresarial_billing', p_billing_id::text,
    jsonb_build_object('estorno', true, 'de', v_bill.status)
  );
end;
$function$;

revoke execute on function empresarial.reverse_billing(uuid, text) from public, anon, authenticated;
grant execute on function empresarial.reverse_billing(uuid, text) to authenticated;

-- 6) O Acordo de cobrança, por uma porta estreita ------------------------------
-- Chave ausente no JSON = não mexe; chave presente (mesmo nula) = grava — é o
-- mesmo efeito do update que a tela fazia (`.update(valores)`).
create or replace function empresarial.salvar_acordo_de_cobranca(
  p_company_id uuid,
  p_acordo jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_master() or empresarial.is_program_finance()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_acordo is null or not (p_acordo ? 'billing_basis') then
    raise exception 'BILLING_BASIS_REQUIRED';
  end if;

  update empresarial.companies c set
    billing_basis = p_acordo->>'billing_basis',
    contracted_holders = case when p_acordo ? 'contracted_holders'
      then (p_acordo->>'contracted_holders')::int else c.contracted_holders end,
    contracted_dependents = case when p_acordo ? 'contracted_dependents'
      then (p_acordo->>'contracted_dependents')::int else c.contracted_dependents end,
    fixed_monthly_cents = case when p_acordo ? 'fixed_monthly_cents'
      then (p_acordo->>'fixed_monthly_cents')::bigint else c.fixed_monthly_cents end,
    excess_mode = case when p_acordo ? 'excess_mode'
      then p_acordo->>'excess_mode' else c.excess_mode end,
    excess_fixed_cents = case when p_acordo ? 'excess_fixed_cents'
      then (p_acordo->>'excess_fixed_cents')::bigint else c.excess_fixed_cents end,
    excess_holder_fee_cents = case when p_acordo ? 'excess_holder_fee_cents'
      then (p_acordo->>'excess_holder_fee_cents')::bigint else c.excess_holder_fee_cents end,
    excess_dependent_fee_cents = case when p_acordo ? 'excess_dependent_fee_cents'
      then (p_acordo->>'excess_dependent_fee_cents')::bigint else c.excess_dependent_fee_cents end
  where c.id = p_company_id;

  if not found then raise exception 'COMPANY_NOT_FOUND'; end if;
end;
$$;

revoke execute on function empresarial.salvar_acordo_de_cobranca(uuid, jsonb) from public, anon, authenticated;
grant execute on function empresarial.salvar_acordo_de_cobranca(uuid, jsonb) to authenticated;
