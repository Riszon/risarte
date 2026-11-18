-- =============================================================================
-- 0432 — AP183 D1: quando a ortodontia começa e quando nasce a 1ª mensalidade (18/11/2026)
-- =============================================================================
-- Regra do dono (18/11/2026; plano docs/ortodontia/AP183-D1-PLANO.md, com as
-- decisões E1–E4): a 1ª mensalidade não nasce vencida; nasce no fechamento da
-- venda (E1), com o 1º vencimento escolhido no acordo e as seguintes no dia de
-- vencimento; o tratamento começa com contrato assinado, 1ª mensalidade paga e
-- a instalação, e a data de início é sempre a da instalação (E2); a agenda não
-- deixa agendar a instalação sem a 1ª mensalidade paga (E3); o caso legado não
-- muda (E4).
--
-- O que muda no banco:
--   1) colunas: plan_negotiation_ortho.first_due_date, ortho_case_terms.first_due_date,
--      ortho_cases.installed_on (a instalação que espera a 1ª mensalidade);
--   2) _ortho_first_fee_paid (a regra única) e _ortho_next_due (o próximo dia
--      de vencimento a partir de hoje);
--   3) save_negotiation_ortho com o 1º vencimento (assinatura nova);
--   4) _ortho_emit_batch (de 0430): o 1º lote vence no 1º vencimento;
--   5) _ortho_open_from_sale (de 0335): emite as mensalidades no fechamento;
--   6) _ortho_begin_treatment e ortho_set_status (de 0417): o caso da venda
--      espera a 1ª mensalidade paga (FIRST_FEE_UNPAID no botão);
--   7) gatilho em ortho_charges: a 1ª mensalidade paga inicia o caso que já
--      teve a instalação (nunca derruba a baixa — também a do Asaas);
--   8) a agenda: ortho_installation_block (conferência antes de gravar) e os
--      gatilhos de segurança em treatment_sessions e appointments;
--   9) casos já abertos "aguardando início" sem mensalidades ganham o 1º lote.
--
-- Ao recriar qualquer uma destas funções, partir DESTA migração. Coordenado
-- com a sessão do Asaas (18/11/2026): o lote leva o meio de cobrança; nada
-- muda cobrança já emitida.
-- =============================================================================

-- 1) Colunas ---------------------------------------------------------------------
alter table public.plan_negotiation_ortho add column if not exists first_due_date date;
alter table public.ortho_case_terms add column if not exists first_due_date date;
alter table public.ortho_cases add column if not exists installed_on date;

-- 2) As regras -------------------------------------------------------------------
-- A 1ª mensalidade do caso está paga? O caso legado (e o sem mensalidade) não
-- espera nada (E4).
create or replace function public._ortho_first_fee_paid(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.origin is distinct from 'venda' then true
    else coalesce((
      select ch.status = 'paga'
        from public.ortho_charges ch
       where ch.case_id = c.id and ch.kind = 'mensalidade' and ch.status <> 'cancelada'
       order by ch.reference_month, ch.due_date
       limit 1), true)
  end
  from public.ortho_cases c where c.id = p_case_id;
$$;
revoke execute on function public._ortho_first_fee_paid(uuid) from public, anon, authenticated;

-- O próximo "dia p_day" a partir de hoje (este mês, se ainda não passou).
create or replace function public._ortho_next_due(p_day integer)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when date_trunc('month', public.today_br())::date + (greatest(1, least(28, coalesce(p_day, 10))) - 1) >= public.today_br()
      then date_trunc('month', public.today_br())::date + (greatest(1, least(28, coalesce(p_day, 10))) - 1)
    else (date_trunc('month', public.today_br()) + interval '1 month')::date + (greatest(1, least(28, coalesce(p_day, 10))) - 1)
  end;
$$;
revoke execute on function public._ortho_next_due(integer) from public, anon, authenticated;

-- 3) O acordo com o 1º vencimento (assinatura nova) ------------------------------
drop function if exists public.save_negotiation_ortho(uuid, integer, integer, text, integer, numeric, boolean, integer, text, text);
create or replace function public.save_negotiation_ortho(
  p_negotiation_id uuid,
  p_monthly_fee_cents integer,
  p_installments_count integer,
  p_billing_method text,
  p_billing_day integer,
  p_punctuality_discount_percent numeric,
  p_retainer_charged boolean,
  p_retainer_fee_cents integer,
  p_retainer_terms text default null,
  p_notes text default null,
  p_first_due_date date default null
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_neg record;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
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
  if v_neg.status not in ('em_negociacao','aguardando_autorizacao','devolvida') then
    raise exception 'NEGOTIATION_CLOSED';
  end if;
  -- AP183 D1 (0432): o 1º vencimento não pode ficar no passado.
  if p_first_due_date is not null and p_first_due_date < public.today_br() then
    raise exception 'FIRST_DUE_IN_PAST';
  end if;

  insert into public.plan_negotiation_ortho
    (negotiation_id, clinic_id, client_id, monthly_fee_cents, installments_count,
     billing_method, billing_day, punctuality_discount_percent,
     retainer_charged, retainer_fee_cents, retainer_terms, notes, first_due_date, created_by, updated_by)
  values
    (p_negotiation_id, v_neg.clinic_id, v_neg.client_id,
     greatest(0, coalesce(p_monthly_fee_cents, 0)), coalesce(p_installments_count, 12),
     coalesce(p_billing_method, 'boleto'), coalesce(p_billing_day, 10),
     greatest(0, coalesce(p_punctuality_discount_percent, 0)),
     coalesce(p_retainer_charged, false), greatest(0, coalesce(p_retainer_fee_cents, 0)),
     nullif(btrim(p_retainer_terms), ''), nullif(btrim(p_notes), ''), p_first_due_date, v_user, v_user)
  on conflict (negotiation_id) do update set
    monthly_fee_cents = excluded.monthly_fee_cents,
    installments_count = excluded.installments_count,
    billing_method = excluded.billing_method,
    billing_day = excluded.billing_day,
    punctuality_discount_percent = excluded.punctuality_discount_percent,
    retainer_charged = excluded.retainer_charged,
    retainer_fee_cents = excluded.retainer_fee_cents,
    retainer_terms = excluded.retainer_terms,
    notes = excluded.notes,
    first_due_date = excluded.first_due_date,
    updated_by = v_user,
    updated_at = now();

  return public.evaluate_negotiation_rules(p_negotiation_id, true);
end;
$$;
revoke execute on function public.save_negotiation_ortho(uuid, integer, integer, text, integer, numeric, boolean, integer, text, text, date) from public, anon, authenticated;
grant execute on function public.save_negotiation_ortho(uuid, integer, integer, text, integer, numeric, boolean, integer, text, text, date) to authenticated;

-- 4) A emissão do lote -------------------------------------------------------------
create or replace function public._ortho_emit_batch(
  p_case_id uuid,
  p_count integer,
  p_amount_cents integer,
  p_billing_method text,
  p_punctuality numeric,
  p_first_month date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
  v_seq integer;
  v_first date;
  v_last date;
  v_id uuid;
  v_count integer := greatest(1, least(120, coalesce(p_count, 12)));
  v_amount integer := greatest(0, coalesce(p_amount_cents, 0));
  v_prev_last date;
  i integer;
  v_month date;
  v_first_due date;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_t from public.ortho_case_terms where case_id = p_case_id;

  select coalesce(max(seq), 0) + 1 into v_seq
    from public.ortho_billing_batches where case_id = p_case_id;

  -- AP181 (0430): o último mês já coberto = o fim de um lote ATIVO ou a última
  -- mensalidade NÃO cancelada. Um lote que a suspensão cancelou não conta mais
  -- (antes contava o last_month de qualquer lote, e o lote novo nascia depois
  -- dos meses cancelados, deixando o paciente sem mensalidade).
  select greatest(
           (select max(b.last_month) from public.ortho_billing_batches b
             where b.case_id = p_case_id and b.status = 'ativo'),
           (select max(ch.reference_month) from public.ortho_charges ch
             where ch.case_id = p_case_id and ch.kind = 'mensalidade'
               and ch.status <> 'cancelada'))
    into v_prev_last;

  -- Nunca antes do mês atual (R7); na retomada, o mês da retomada é cobrado
  -- (decisão do dono, 18/11/2026).
  v_first := coalesce(
    p_first_month,
    greatest((v_prev_last + interval '1 month')::date,
             date_trunc('month', coalesce(v_c.start_date, public.today_br()))::date,
             date_trunc('month', public.today_br())::date));
  v_first := date_trunc('month', v_first)::date;
  -- AP183 D1 (0432): o 1º lote do caso vence no 1º vencimento combinado no
  -- acordo, nunca no passado; as seguintes, no dia de vencimento de cada mês.
  if v_seq = 1 and p_first_month is null and v_t.first_due_date is not null then
    v_first_due := greatest(v_t.first_due_date, public.today_br());
    v_first := date_trunc('month', v_first_due)::date;
  end if;
  v_last := (v_first + make_interval(months => v_count - 1))::date;

  insert into public.ortho_billing_batches
    (case_id, clinic_id, seq, installments_count, first_month, last_month, amount_cents,
     billing_method, punctuality_discount_percent, created_by)
  values
    (p_case_id, v_c.clinic_id, v_seq, v_count, v_first, v_last, v_amount,
     p_billing_method, greatest(0, least(100, coalesce(p_punctuality, 0))), (select auth.uid()))
  returning id into v_id;

  -- Lote novo encerra o anterior (ele já cumpriu o que tinha de emitir).
  update public.ortho_billing_batches set status = 'encerrado'
   where case_id = p_case_id and id <> v_id and status = 'ativo';

  if v_amount > 0 then
    for i in 0 .. v_count - 1 loop
      v_month := (v_first + make_interval(months => i))::date;
      insert into public.ortho_charges
        (case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, batch_id, created_by)
      values
        (p_case_id, v_c.clinic_id, v_c.client_id, 'mensalidade', v_month,
         case when i = 0 and v_first_due is not null then v_first_due
              else (v_month + (coalesce(v_t.billing_day, 10) - 1)) end,
         v_amount, 'em_aberto', v_id, (select auth.uid()))
      on conflict (case_id, reference_month, kind) do update
        set batch_id = coalesce(public.ortho_charges.batch_id, excluded.batch_id);
    end loop;
  end if;

  -- O acordo do caso passa a ser o do lote (a ORTO9 muda o valor na renovação).
  update public.ortho_case_terms set
    monthly_fee_cents = v_amount,
    installments_count = v_count,
    billing_method = coalesce(p_billing_method, billing_method),
    punctuality_discount_percent = greatest(0, least(100, coalesce(p_punctuality, punctuality_discount_percent)))
  where case_id = p_case_id;

  perform public._ortho_log(p_case_id, 'lote_emitido',
    'Lote ' || v_seq || ' de mensalidades emitido: ' || v_count || ' mensalidades, '
    || to_char(v_first, 'MM/YYYY') || ' a ' || to_char(v_last, 'MM/YYYY'));
  return v_id;
end;
$$;
revoke execute on function public._ortho_emit_batch(uuid, integer, integer, text, numeric, date) from public, anon, authenticated;

-- 5) O caso nasce na venda já com as mensalidades -----------------------------------
create or replace function public._ortho_open_from_sale(p_negotiation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_p record;
  v_o record;
  v_s record;
  v_existing uuid;
  v_id uuid;
  v_client_name text;
  v_code text;
  v_user uuid := (select auth.uid());
  v_t public.ortho_case_terms;
  v_first_due date;
begin
  select n.id, n.plan_id, n.option_id, n.client_id, n.clinic_id, n.code
    into v_neg from public.plan_negotiations n where n.id = p_negotiation_id;
  if v_neg.id is null then return null; end if;

  select * into v_p from public.treatment_plan_ortho where option_id = v_neg.option_id;
  if v_p.option_id is null and not exists (
    select 1 from public.treatment_plan_option_items i
    join public.procedures p on p.id = i.procedure_id
    where i.option_id = v_neg.option_id and p.specialty ilike '%ortod%'
  ) then
    return null;
  end if;

  select id into v_existing from public.ortho_cases
   where client_id = v_neg.client_id
     and status in ('aguardando_inicio','em_tratamento','contencao','suspenso')
   limit 1;
  if v_existing is not null then
    update public.ortho_cases set negotiation_id = coalesce(negotiation_id, p_negotiation_id),
                                  plan_id = coalesce(plan_id, v_neg.plan_id)
     where id = v_existing;
    perform public._ortho_log(v_existing, 'venda_fechada',
      'Venda fechada no Comercial' || coalesce(' (' || v_neg.code || ')', '') || ' — o caso já estava aberto');
    return v_existing;
  end if;

  select * into v_s from public.ortho_effective_settings(v_neg.clinic_id);
  select * into v_o from public.plan_negotiation_ortho where negotiation_id = p_negotiation_id;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     maintenance_procedure_id, plan_id, negotiation_id, notes, origin, created_by)
  values
    (v_neg.clinic_id, v_neg.client_id, null,
     coalesce(v_p.treatment_kind, 'aparelho_fixo'), 'aguardando_inicio', null,
     coalesce(v_p.planned_months, v_s.planned_months, 24),
     coalesce(v_p.maintenance_interval_days, v_s.maintenance_interval_days, 30),
     null, v_s.maintenance_procedure_id, v_neg.plan_id, p_negotiation_id,
     nullif(btrim(v_p.notes), ''), 'venda', v_user)
  returning id, code into v_id, v_code;

  insert into public.ortho_case_terms
    (case_id, clinic_id, monthly_fee_cents, billing_day, installation_fee_cents,
     retainer_charged, retainer_fee_cents, retainer_terms,
     installments_count, billing_method, punctuality_discount_percent, first_due_date, updated_by)
  values
    (v_id, v_neg.clinic_id,
     coalesce(v_o.monthly_fee_cents, v_s.monthly_fee_cents, 0),
     coalesce(v_o.billing_day, v_s.billing_day, 10), 0,
     coalesce(v_o.retainer_charged, v_s.retainer_charge_enabled, false),
     coalesce(v_o.retainer_fee_cents, v_s.retainer_fee_cents, 0),
     coalesce(v_o.retainer_terms, v_s.retainer_terms),
     coalesce(v_o.installments_count, 12), coalesce(v_o.billing_method, 'boleto'),
     coalesce(v_o.punctuality_discount_percent, v_s.punctuality_discount_percent, 0),
     coalesce(v_o.first_due_date, public._ortho_next_due(coalesce(v_o.billing_day, v_s.billing_day, 10))),
     v_user)
  on conflict (case_id) do nothing;

  perform public._ortho_log(v_id, 'caso_aberto',
    'Caso aberto no fechamento da venda' || coalesce(' ' || v_neg.code, '')
    || case when v_p.option_id is not null then ' — características da proposta ortodôntica do plano' else '' end
    || case when v_o.negotiation_id is not null then ' — acordo comercial da negociação' else ' — acordo pelo padrão da unidade' end);

  -- AP183 D1 (0432): as mensalidades nascem no fechamento da venda, com o
  -- meio de cobrança no lote (a emissão pelo Asaas, 4018, lê o meio do lote).
  select * into v_t from public.ortho_case_terms where case_id = v_id;
  if coalesce(v_t.monthly_fee_cents, 0) > 0 then
    perform public._ortho_emit_batch(v_id, coalesce(v_t.installments_count, 12),
      v_t.monthly_fee_cents, coalesce(v_t.billing_method, 'boleto'),
      v_t.punctuality_discount_percent, null);
  end if;
  select min(due_date) into v_first_due from public.ortho_charges
   where case_id = v_id and kind = 'mensalidade' and status <> 'cancelada';

  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_neg.clinic_id,
    'Ortodontia: caso fechado — agendar a instalação',
    coalesce(v_client_name, 'Paciente') || ' fechou o tratamento ortodôntico (' || v_code
      || '). As mensalidades já foram emitidas'
      || coalesce(' (a 1ª vence em ' || to_char(v_first_due, 'DD/MM/YYYY') || ')', '')
      || '. A instalação do aparelho é agendada depois de paga a 1ª mensalidade; o caso está aguardando início.',
    '/ortodontia/casos/' || v_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_neg.clinic_id
    and ucr.role in ('unit_manager','clinical_coordinator','receptionist')
    and ucr.user_id is distinct from v_user;

  return v_id;
end;
$$;
revoke execute on function public._ortho_open_from_sale(uuid) from public, anon, authenticated;

-- 6) O início espera a 1ª mensalidade -------------------------------------------------
create or replace function public._ortho_begin_treatment(
  p_case_id uuid,
  p_date date,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
  v_date date := coalesce(p_date, public.today_br());
  v_reeval integer;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then return; end if;

  -- AP183 D1 (0432): o caso da venda só começa com a 1ª mensalidade paga.
  -- Instalação concluída antes disso: guarda a data e espera o pagamento
  -- (o gatilho ortho_charges_first_fee_start inicia com esta data).
  if v_c.status = 'aguardando_inicio' and not public._ortho_first_fee_paid(p_case_id) then
    if v_c.installed_on is null then
      update public.ortho_cases set installed_on = v_date where id = p_case_id;
      perform public._ortho_log(p_case_id, 'instalacao_aguarda_mensalidade',
        'Instalação em ' || to_char(v_date, 'DD/MM/YYYY')
        || ' — o tratamento começa quando a 1ª mensalidade for paga');
    end if;
    return;
  end if;

  select s.reevaluation_interval_months into v_reeval
    from public.ortho_effective_settings(v_c.clinic_id) s;
  update public.ortho_cases set
    status = 'em_tratamento',
    start_date = coalesce(start_date, v_date),
    installed_on = coalesce(installed_on, v_date),
    next_reevaluation_date = coalesce(next_reevaluation_date,
      (coalesce(start_date, v_date) + make_interval(months => coalesce(v_reeval, 6)))::date),
    finished_at = null, finish_reason = null,
    retainer_delivered_at = null, discharged_at = null,
    interrupted_at = null, interrupt_reason = null,
    suspended_at = null, suspend_reason = null
  where id = p_case_id;
  perform public.ortho_plan_maintenances(p_case_id);
  perform public._ortho_log(p_case_id, 'tratamento_iniciado',
    case when v_c.status = 'aguardando_inicio' then 'Tratamento iniciado em '
         when v_c.status = 'suspenso' then 'Tratamento retomado em '
         else 'Caso reaberto em ' end || to_char(v_date, 'DD/MM/YYYY')
    || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
  -- R7: no INÍCIO, o lote do acordo nasce (as N mensalidades). Retomar ou
  -- reabrir não emite sozinho: quem gere emite o lote novo na ficha.
  if v_c.status = 'aguardando_inicio'
     and not exists (select 1 from public.ortho_billing_batches b where b.case_id = p_case_id) then
    select * into v_t from public.ortho_case_terms where case_id = p_case_id;
    if coalesce(v_t.monthly_fee_cents, 0) > 0 then
      perform public._ortho_emit_batch(p_case_id, coalesce(v_t.installments_count, 12),
        v_t.monthly_fee_cents, v_t.billing_method, v_t.punctuality_discount_percent,
        date_trunc('month', coalesce(v_c.start_date, v_date))::date);
    end if;
  end if;
end;
$$;
revoke execute on function public._ortho_begin_treatment(uuid, date, text) from public, anon, authenticated;

create or replace function public.ortho_set_status(
  p_case_id uuid, p_status text, p_reason text default null, p_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_date date := coalesce(p_date, public.today_br());
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_status not in ('em_tratamento','contencao','finalizado','interrompido','suspenso') then
    raise exception 'INVALID_STATUS';
  end if;
  if p_status = v_c.status then return; end if;

  if p_status = 'em_tratamento' then
    if v_c.status not in ('aguardando_inicio','contencao','finalizado','interrompido','suspenso') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if v_c.status in ('finalizado','interrompido')
       and exists (select 1 from public.ortho_cases
                    where client_id = v_c.client_id and id <> p_case_id
                      and status in ('aguardando_inicio','em_tratamento','contencao','suspenso')) then
      raise exception 'CASE_ALREADY_OPEN';
    end if;
    -- AP183 D1 (0432): sem a 1ª mensalidade paga, o caso da venda não começa.
    if v_c.status = 'aguardando_inicio' and not public._ortho_first_fee_paid(p_case_id) then
      raise exception 'FIRST_FEE_UNPAID';
    end if;
    perform public._ortho_begin_treatment(p_case_id, v_date, p_reason);

  elsif p_status = 'contencao' then
    perform public.ortho_deliver_retainers(p_case_id, v_date, null, null, p_reason);

  elsif p_status = 'finalizado' then
    if v_c.status not in ('em_tratamento','contencao','suspenso') then raise exception 'INVALID_TRANSITION'; end if;
    update public.ortho_cases set
      status = 'finalizado',
      finished_at = coalesce(finished_at, v_date),
      discharged_at = v_date,
      finish_reason = coalesce(nullif(btrim(p_reason), ''), finish_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    perform public._ortho_log(p_case_id, 'finalizado',
      case when v_c.status = 'contencao' then 'Alta do acompanhamento em '
           else 'Tratamento encerrado em ' end || to_char(v_date, 'DD/MM/YYYY')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));

  elsif p_status = 'suspenso' then
    -- Q5: nunca automático — quem gere suspende, com motivo.
    if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.ortho_cases set
      status = 'suspenso', suspended_at = v_date, suspend_reason = btrim(p_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    update public.ortho_billing_batches set status = 'encerrado'
     where case_id = p_case_id and status = 'ativo';
    perform public._ortho_log(p_case_id, 'suspenso',
      'Tratamento suspenso em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));

  elsif p_status = 'interrompido' then
    if v_c.status not in ('aguardando_inicio','em_tratamento','contencao','suspenso') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.ortho_cases set
      status = 'interrompido', interrupted_at = v_date, interrupt_reason = btrim(p_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    update public.ortho_billing_batches set status = 'encerrado'
     where case_id = p_case_id and status = 'ativo';
    perform public._ortho_log(p_case_id, 'interrompido',
      'Tratamento interrompido em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));
  end if;
end;
$$;
revoke execute on function public.ortho_set_status(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.ortho_set_status(uuid, text, text, date) to authenticated;

-- 7) A 1ª mensalidade paga inicia o caso que já teve a instalação ---------------------
create or replace function public.ortho_charges_first_fee_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
begin
  -- Nunca derruba a baixa (inclusive a do Asaas, que repetiria o aviso).
  begin
    select * into v_c from public.ortho_cases where id = new.case_id;
    if v_c.status = 'aguardando_inicio' and v_c.installed_on is not null
       and public._ortho_first_fee_paid(v_c.id) then
      perform public._ortho_begin_treatment(v_c.id, v_c.installed_on, '1ª mensalidade paga');
    end if;
  exception when others then
    raise warning 'ortho_charges_first_fee_start (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.ortho_charges_first_fee_start() from public, anon, authenticated;

drop trigger if exists ortho_charges_first_fee_start on public.ortho_charges;
create trigger ortho_charges_first_fee_start
  after update of status on public.ortho_charges
  for each row
  when (new.kind = 'mensalidade' and new.status = 'paga' and old.status is distinct from 'paga')
  execute function public.ortho_charges_first_fee_start();

-- 8) A agenda: a instalação só com a 1ª mensalidade paga (E3) --------------------------
create or replace function public._ortho_installation_blocked(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.treatment_sessions s
      join public.ortho_cases c
        on c.client_id = s.client_id and c.status = 'aguardando_inicio' and c.origin = 'venda'
     where s.id = p_session_id
       and public._sessao_ortodontica(s.procedure_id)
       and not public._ortho_first_fee_paid(c.id)
  );
$$;
revoke execute on function public._ortho_installation_blocked(uuid) from public, anon, authenticated;

-- A conferência que a agenda faz ANTES de gravar (só diz sim ou não).
create or replace function public.ortho_installation_block(p_session_ids uuid[])
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  return exists (
    select 1 from unnest(coalesce(p_session_ids, '{}'::uuid[])) as x(id)
     where public._ortho_installation_blocked(x.id)
  );
end;
$$;
revoke execute on function public.ortho_installation_block(uuid[]) from public, anon, authenticated;
grant execute on function public.ortho_installation_block(uuid[]) to authenticated;

-- A rede de segurança: ligar a sessão do aparelho a um agendamento. Cada
-- comando cita colunas de UMA tabela só (lição da 0399).
create or replace function public.ortho_installation_guard_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.appointment_id is not null
     and new.appointment_id is distinct from old.appointment_id
     and public._ortho_installation_blocked(new.id) then
    raise exception 'ORTHO_FIRST_FEE_UNPAID';
  end if;
  return new;
end;
$$;
revoke execute on function public.ortho_installation_guard_session() from public, anon, authenticated;

create or replace function public.ortho_installation_guard_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.treatment_session_id is not null
     and (tg_op = 'INSERT' or new.treatment_session_id is distinct from old.treatment_session_id)
     and new.status::text <> 'cancelled'
     and public._ortho_installation_blocked(new.treatment_session_id) then
    raise exception 'ORTHO_FIRST_FEE_UNPAID';
  end if;
  return new;
end;
$$;
revoke execute on function public.ortho_installation_guard_appointment() from public, anon, authenticated;

drop trigger if exists ortho_installation_guard on public.treatment_sessions;
create trigger ortho_installation_guard
  before update of appointment_id on public.treatment_sessions
  for each row execute function public.ortho_installation_guard_session();

drop trigger if exists ortho_installation_guard on public.appointments;
create trigger ortho_installation_guard
  before insert or update of treatment_session_id on public.appointments
  for each row execute function public.ortho_installation_guard_appointment();

-- 9) Casos já abertos "aguardando início", da venda, ainda sem mensalidades -----------
do $$
declare
  v record;
  v_n integer := 0;
begin
  for v in
    select c.id, t.monthly_fee_cents, t.installments_count, t.billing_method,
           t.punctuality_discount_percent, t.billing_day
      from public.ortho_cases c
      join public.ortho_case_terms t on t.case_id = c.id
     where c.status = 'aguardando_inicio' and c.origin = 'venda'
       and coalesce(t.monthly_fee_cents, 0) > 0
       and not exists (select 1 from public.ortho_billing_batches b where b.case_id = c.id)
  loop
    update public.ortho_case_terms
       set first_due_date = coalesce(first_due_date, public._ortho_next_due(v.billing_day))
     where case_id = v.id;
    perform public._ortho_emit_batch(v.id, coalesce(v.installments_count, 12), v.monthly_fee_cents,
      coalesce(v.billing_method, 'boleto'), coalesce(v.punctuality_discount_percent, 0), null);
    v_n := v_n + 1;
  end loop;
  raise notice 'AP183 D1: % caso(s) aguardando início ganharam o 1º lote de mensalidades', v_n;
end
$$;

-- =============================================================================
-- CONFERÊNCIA (só contagens). Esperado: 3 · 1 · 1 · 2 · 0
--   1) as três colunas novas
--   2) o acordo aceita o 1º vencimento
--   3) o gatilho da 1ª mensalidade
--   4) as duas travas da agenda
--   5) casos da venda aguardando início sem mensalidades (com valor)
-- =============================================================================
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'plan_negotiation_ortho' and column_name = 'first_due_date')
        or (table_name = 'ortho_case_terms' and column_name = 'first_due_date')
        or (table_name = 'ortho_cases' and column_name = 'installed_on'))) as colunas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'save_negotiation_ortho'
      and pg_get_function_identity_arguments(p.oid) like '%p_first_due_date date%') as acordo,
  (select count(*) from pg_trigger where tgname = 'ortho_charges_first_fee_start') as gatilho_pagamento,
  (select count(*) from pg_trigger where tgname = 'ortho_installation_guard') as travas_agenda,
  (select count(*) from public.ortho_cases c join public.ortho_case_terms t on t.case_id = c.id
    where c.status = 'aguardando_inicio' and c.origin = 'venda' and coalesce(t.monthly_fee_cents, 0) > 0
      and not exists (select 1 from public.ortho_billing_batches b where b.case_id = c.id)) as sem_mensalidades;
