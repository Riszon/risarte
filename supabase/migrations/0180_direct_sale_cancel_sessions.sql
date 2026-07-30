-- =============================================================================
-- 0180 — J4a: cancelar a venda direta CANCELA os procedimentos dela
-- -----------------------------------------------------------------------------
-- Bug relatado pelo dono (29/07/2026): "as vendas canceladas não estão
-- cancelando os procedimentos, continua marcado como concluído".
--
-- Causa: `create_direct_sale_v2` cria uma linha em `treatment_sessions` por
-- procedimento vendido, mas a sessão NÃO guardava de qual venda veio (plan_id
-- null e nada mais). Sem esse vínculo, o cancelamento não tinha como desfazer
-- os procedimentos — eles ficavam "Concluído" para sempre no prontuário.
--
-- Aqui: (1) `treatment_sessions.direct_sale_id` + preenchimento retroativo;
-- (2) novo status 'cancelled' na sessão; (3) `cancel_direct_sale` (RPC) que
-- cancela a venda E as sessões dela, devolvendo o benefício do programa;
-- (4) reparo das vendas JÁ canceladas.
--
-- Também: cliente do **Risarte Empresarial** passa a ver TODAS as formas de
-- pagamento da rede (decisão do dono, 29/07/2026) — o programa sobrepõe a
-- restrição de meios da unidade, como já acontece com o PPR+.
-- Idempotente.
-- =============================================================================

-- 1) Vínculo da sessão com a venda direta -------------------------------------
alter table public.treatment_sessions
  add column if not exists direct_sale_id uuid
    references public.direct_sales (id) on delete set null;

create index if not exists treatment_sessions_direct_sale_idx
  on public.treatment_sessions (direct_sale_id);

-- 2) Status 'cancelled' (procedimento de venda cancelada) ---------------------
do $$
begin
  alter table public.treatment_sessions
    drop constraint if exists treatment_sessions_status_check;
  alter table public.treatment_sessions
    add constraint treatment_sessions_status_check
    check (status in ('pending', 'scheduled', 'done', 'cancelled'));
exception when others then null;
end $$;

-- 3) Preenchimento retroativo do vínculo --------------------------------------
-- As sessões da venda nascem no MESMO comando da venda: casa por cliente +
-- nome do procedimento + created_at praticamente igual (janela de 5s), sempre
-- entre sessões SEM plano (que são, por definição, de venda direta).
do $$
begin
  with candidates as (
    select s.id as session_id,
           i.sale_id,
           row_number() over (
             partition by s.id
             order by abs(extract(epoch from (s.created_at - d.created_at)))
           ) as rn
    from public.treatment_sessions s
    join public.direct_sales d
      on d.client_id = s.client_id
     and d.clinic_id = s.clinic_id
     and s.created_at between d.created_at - interval '5 seconds'
                          and d.created_at + interval '5 seconds'
    join public.direct_sale_items i
      on i.sale_id = d.id
     and i.description = s.procedure_name
    where s.plan_id is null
      and s.direct_sale_id is null
  )
  update public.treatment_sessions s
     set direct_sale_id = c.sale_id
    from candidates c
   where c.session_id = s.id
     and c.rn = 1;
exception when others then null;
end $$;

-- 4) cancel_direct_sale: cancela a venda E os procedimentos dela --------------
-- Antes o app fazia um UPDATE direto; agora existe uma função só, que garante
-- os dois lados (era o bug: a tela cancelava a venda e ignorava as sessões).
create or replace function public.cancel_direct_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
  v_user uuid := (select auth.uid());
begin
  select * into v_sale from public.direct_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'NOT_FOUND'; end if;
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_sale.clinic_id,
         array['receptionist','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.direct_sales set
    cancelled = true,
    status = 'cancelada',
    cancelled_at = now(),
    cancelled_by = v_user,
    updated_at = now()
  where id = p_sale_id;

  -- Os procedimentos da venda deixam de valer: saem de "concluído"/"em aberto"
  -- e ficam CANCELADOS (o histórico continua visível, mas não conta como feito
  -- nem aparece como pendente para agendar).
  update public.treatment_sessions set
    status = 'cancelled',
    done_at = null,
    executed_by = null,
    appointment_id = null
  where direct_sale_id = p_sale_id
    and status <> 'cancelled';

  -- Venda cancelada devolve o benefício do programa (a limpeza volta a estar
  -- liberada, por exemplo).
  delete from public.ppr_benefit_usages where direct_sale_id = p_sale_id;

  -- As cobranças da venda cancelada também deixam de existir (o Financeiro não
  -- deve cobrar por venda cancelada).
  update public.payment_installments set status = 'cancelada'
   where direct_sale_id = p_sale_id and status = 'em_aberto';

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_cancel',
          p_sale_id::text, jsonb_build_object('sessions_cancelled', true));
end;
$$;

grant execute on function public.cancel_direct_sale(uuid) to authenticated;

-- 5) A venda direta passa a NASCER com o vínculo -----------------------------
-- MESMA função da 0159 (assinatura e regras idênticas — não mexer nelas aqui);
-- a ÚNICA mudança é `direct_sale_id` nas sessões criadas.
create or replace function public.create_direct_sale_v2(
  p_client_id uuid,
  p_appointment_id uuid,
  p_attendance_done_before boolean,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client_name text;
  v_sale uuid;
  v_item jsonb;
  v_subtotal integer := 0;
  v_program integer := 0;
  v_final integer := 0;
  v_count integer := 0;
  v_user uuid := (select auth.uid());
  v_can_close boolean;
  v_reais text;
  v_provider uuid;
  v_done boolean := coalesce(p_attendance_done_before, false);
begin
  select clinic_id, full_name into v_clinic, v_client_name
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic,
         array['receptionist','sdr','clinical_coordinator','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_appointment_id is null then raise exception 'APPOINTMENT_REQUIRED'; end if;
  select provider_user_id into v_provider
  from public.appointments a
  where a.id = p_appointment_id and a.client_id = p_client_id;
  if not found then raise exception 'APPOINTMENT_INVALID'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;

  insert into public.direct_sales
    (clinic_id, client_id, client_name, appointment_id, attendance_done_before,
     notes, created_by, status)
  values (v_clinic, p_client_id, v_client_name, p_appointment_id, v_done,
          nullif(btrim(p_notes), ''), v_user, 'aguardando_fechamento')
  returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.direct_sale_items
      (sale_id, clinic_id, procedure_id, description, quantity,
       unit_price_cents, program_discount_cents, final_cents)
    values (
      v_sale, v_clinic,
      nullif(v_item->>'procedure_id', '')::uuid,
      coalesce(v_item->>'description', 'Procedimento'),
      coalesce((v_item->>'quantity')::int, 1),
      coalesce((v_item->>'unit_price_cents')::int, 0),
      coalesce((v_item->>'program_discount_cents')::int, 0),
      coalesce((v_item->>'final_cents')::int, 0)
    );
    v_subtotal := v_subtotal
      + coalesce((v_item->>'unit_price_cents')::int, 0)
        * coalesce((v_item->>'quantity')::int, 1);
    v_program := v_program + coalesce((v_item->>'program_discount_cents')::int, 0);
    v_final := v_final + coalesce((v_item->>'final_cents')::int, 0);
    v_count := v_count + coalesce((v_item->>'quantity')::int, 1);
  end loop;

  update public.direct_sales set
    subtotal_cents = v_subtotal,
    program_discount_cents = v_program,
    discount_cents = 0,           -- desconto MANUAL começa em zero
    final_cents = v_final,
    updated_at = now()
  where id = v_sale;

  -- PROCEDIMENTOS no prontuário: já realizado → CONCLUÍDO (baixa do dentista do
  -- atendimento); a realizar/em atendimento → EM ABERTO (pending).
  -- J4a: agora COM o vínculo da venda — é isso que permite cancelar depois.
  insert into public.treatment_sessions
    (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
     session_index, session_total, status, appointment_id, done_at, executed_by,
     direct_sale_id)
  select
    p_client_id, v_clinic, null, null,
    nullif(i->>'procedure_id', '')::uuid,
    coalesce(i->>'description', 'Procedimento'),
    1, 1,
    case when v_done then 'done' else 'pending' end,
    p_appointment_id,
    case when v_done then now() else null end,
    case when v_done then v_provider else null end,
    v_sale
  from jsonb_array_elements(p_items) i,
       generate_series(1, greatest(1, coalesce((i->>'quantity')::int, 1)));

  v_reais := 'R$ ' || (v_final / 100)::text || ',' ||
             lpad((v_final % 100)::text, 2, '0');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_clinic,
    'Venda direta na unidade — ' || v_reais,
    coalesce(v_client_name, 'Cliente') || ' — venda direta de ' || v_reais
      || ' (' || v_count || ' procedimento(s)) lançada na unidade.',
    '/comercial/venda-direta'
  from public.providers_with_access(v_clinic, 'commercial_consultant') pwa
  where pwa.user_id is distinct from v_user;

  v_can_close := public.direct_sale_can_close(v_clinic);
  if not v_can_close then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'Venda direta aguardando fechamento',
      coalesce(v_client_name, 'Cliente') || ' — ' || v_reais
        || '. Defina a forma de pagamento, envie o contrato e a cobrança.',
      '/prontuarios/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role in ('receptionist','unit_manager')
      and ucr.user_id is distinct from v_user;
  end if;

  if v_done then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
      'ATENÇÃO: venda direta lançada APÓS o atendimento',
      coalesce(v_client_name, 'Cliente')
        || ' — o atendimento foi realizado ANTES da venda ser lançada. O certo é'
        || ' vender antes de atender; acompanhe para corrigir o fluxo da unidade.',
      '/comercial/venda-direta'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('unit_manager','franchisee')
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'direct_sale', v_sale::text,
    jsonb_build_object('items', v_count, 'exception', v_done));

  return v_sale;
end;
$$;

grant execute on function
  public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text)
  to authenticated;

-- 6) Reparo das vendas JÁ canceladas -----------------------------------------
-- Procedimentos de venda cancelada que continuaram "done"/"pending" passam a
-- 'cancelled' (era exatamente o que o dono viu na tela).
do $$
begin
  update public.treatment_sessions s
     set status = 'cancelled',
         done_at = null,
         executed_by = null
    from public.direct_sales d
   where d.id = s.direct_sale_id
     and d.cancelled = true
     and s.status <> 'cancelled';

  update public.payment_installments p
     set status = 'cancelada'
    from public.direct_sales d
   where d.id = p.direct_sale_id
     and d.cancelled = true
     and p.status = 'em_aberto';
exception when others then null;
end $$;

-- 7) Empresarial libera TODAS as formas de pagamento -------------------------
-- Decisão do dono (29/07/2026): cliente do Risarte Empresarial não fica preso
-- à lista de meios da unidade (o boleto não aparecia). O programa sobrepõe,
-- como já acontece com o PPR+.
create or replace function public.client_program_frees_methods(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.empresarial_company_id is not null
       and c.empresarial_active is not false
    from public.clients c where c.id = p_client_id
  ), false);
$$;

grant execute on function public.client_program_frees_methods(uuid)
  to authenticated;

-- A validação da negociação passa a respeitar isso (mantém tudo da 0179).
create or replace function public.evaluate_negotiation_rules(
  p_negotiation_id uuid,
  p_from_consultant boolean default true
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_subtotal integer;
  v_final integer;
  v_excluded integer;
  v_max_disc numeric;
  v_max_inst integer;
  v_methods text[];
  v_discount_pct numeric;
  v_violations text[] := '{}';
  v_client_name text;
  v_user uuid := (select auth.uid());
  v_ppr record;
  v_tier_pct numeric;
  v_min_cents integer;
  v_installment_cents integer;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_neg.clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Totais e aprovação parcial: SÓ os itens da opção selecionada (0152).
  select coalesce(sum(case when ni.included then i.quantity * i.unit_price_cents else 0 end), 0),
         count(*) filter (where not ni.included)
    into v_subtotal, v_excluded
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items i on i.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and i.option_id = v_neg.option_id;

  v_final := greatest(0, v_subtotal + v_neg.adjustment_cents);

  select coalesce(u.max_discount_percent, n.max_discount_percent),
         coalesce(u.max_installments, n.max_installments),
         coalesce(u.allowed_methods, n.allowed_methods)
    into v_max_disc, v_max_inst, v_methods
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_neg.clinic_id
  left join public.commercial_rules n on n.clinic_id is null;

  -- J4a: Empresarial libera todas as formas de pagamento.
  if public.client_program_frees_methods(v_neg.client_id) then
    v_methods := null;
  end if;

  -- PPR+ acima da regra da rede/unidade (0167/0168).
  select * into v_ppr from public.ppr_client_conditions(v_neg.client_id);
  if v_ppr.max_installments is not null then
    v_max_inst := greatest(coalesce(v_max_inst, 1), v_ppr.max_installments);
    if v_methods is not null then
      if v_ppr.allowed_methods is null then
        v_methods := null;
      else
        select array(select distinct unnest(v_methods || v_ppr.allowed_methods))
          into v_methods;
      end if;
    end if;
    v_tier_pct := public.ppr_client_tier_percent(v_neg.client_id, v_neg.installments);
    if v_max_disc is not null then
      v_max_disc := greatest(v_max_disc, coalesce(v_tier_pct, 0));
    end if;
  end if;

  v_discount_pct := case
    when v_subtotal > 0 and v_neg.adjustment_cents < 0
      then (-v_neg.adjustment_cents)::numeric * 100 / v_subtotal
    else 0
  end;

  if v_max_disc is not null and v_discount_pct > v_max_disc then
    v_violations := v_violations || format(
      'Desconto de %s%% acima do máximo permitido (%s%%)',
      round(v_discount_pct, 1), v_max_disc);
  end if;
  if v_max_inst is not null and v_neg.installments > v_max_inst then
    v_violations := v_violations || format(
      'Parcelamento em %sx acima do máximo permitido (%sx)',
      v_neg.installments, v_max_inst);
  end if;
  if v_methods is not null and v_neg.payment_method is not null
     and not (v_neg.payment_method = any(v_methods)) then
    v_violations := v_violations || format(
      'Meio de pagamento "%s" não permitido pela regra comercial',
      v_neg.payment_method);
  end if;
  if v_neg.installments <= 1 and v_neg.payment_method is not null
     and v_neg.payment_method not in ('pix','deposito_avista') then
    v_violations := v_violations
      || 'À vista (1x) o pagamento é só por PIX ou depósito à vista';
  end if;

  -- I8: parcela mínima do MEIO DE PAGAMENTO escolhido (só no parcelado).
  if v_neg.installments > 1 and v_neg.payment_method is not null then
    v_min_cents := public.commercial_min_installment_cents(
      v_neg.clinic_id, v_neg.payment_method);
    if v_ppr.min_installment_cents is not null then
      v_min_cents := greatest(coalesce(v_min_cents, 0), v_ppr.min_installment_cents);
      v_min_cents := nullif(v_min_cents, 0);
    end if;
    if v_min_cents is not null and v_final > 0 then
      v_installment_cents := ceil(
        greatest(0, v_final - coalesce(v_neg.down_payment_cents, 0))::numeric
        / v_neg.installments);
      if v_installment_cents > 0 and v_installment_cents < v_min_cents then
        v_violations := v_violations || format(
          'Parcela de R$ %s abaixo do mínimo de R$ %s para "%s"',
          to_char(v_installment_cents / 100.0, 'FM999G999D00'),
          to_char(v_min_cents / 100.0, 'FM999G999D00'),
          v_neg.payment_method);
      end if;
    end if;
  end if;

  update public.plan_negotiations set
    subtotal_cents = v_subtotal,
    final_cents = v_final,
    is_partial = (v_excluded > 0),
    rule_authorized = case when p_from_consultant then false else rule_authorized end,
    rule_violations = case when array_length(v_violations, 1) > 0
                           then array_to_string(v_violations, '; ') else null end,
    status = case
      when array_length(v_violations, 1) > 0
           and not (rule_authorized and not p_from_consultant)
        then 'aguardando_autorizacao'
      when status in ('aguardando_autorizacao', 'aceita', 'devolvida')
        then 'em_negociacao'
      else status
    end,
    consultant_id = case when p_from_consultant
                         then coalesce(consultant_id, v_user)
                         else consultant_id end,
    updated_at = now()
  where id = p_negotiation_id;

  if array_length(v_violations, 1) > 0 and p_from_consultant then
    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Negociação fora da regra — autorizar?',
      coalesce(v_client_name, 'Cliente') || ' — ' || array_to_string(v_violations, '; '),
      '/comercial/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id
      and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  return v_violations;
end;
$$;

revoke all on function public.evaluate_negotiation_rules(uuid, boolean) from public;
grant execute on function public.evaluate_negotiation_rules(uuid, boolean) to authenticated;
