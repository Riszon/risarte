-- =============================================================================
-- 0334 — ORTODONTIA (ORTO8): DO COMERCIAL AO CASO
--
-- Pedido do dono em 28/10/2026 (docs/ortodontia/ORTO-PLANO.md §5, regras R1
-- (configuração), R2, R4, R5 (parte comercial), R7 (registro da forma) e
-- decisões Q1 e Q4):
--   * R5/R7: o Consultor fecha o ACORDO ORTODÔNTICO na negociação
--     (`plan_negotiation_ortho`: mensalidade, quantas mensalidades no lote,
--     forma de emissão, dia, desconto de pontualidade, contenção cobrada ou
--     não) — dentro dos LIMITES da ortodontia (mensalidade mínima, pontualidade
--     máxima — Q4, na configuração rede → unidade); fora do limite, a
--     negociação cai em `aguardando_autorizacao` e o Gerente autoriza, pelo
--     mesmo caminho de hoje (`evaluate_negotiation_rules`).
--   * R2/R4: contrato assinado + pagamento confirmado = venda; se a opção tem
--     a proposta ortodôntica (ou procedimento de Ortodontia), O CASO NASCE
--     SOZINHO em "aguardando início", com as características do Planner e o
--     acordo do Consultor, e avisa Gerente, Coordenador e Recepção.
--   * R4/Q1: não existe mais abrir caso sem venda — `ortho_create_case` exige a
--     venda fechada; quem já estava em tratamento antes do sistema entra como
--     CASO LEGADO (`ortho_create_legacy_case`, Gerente/Coordenador), por uma
--     porta que o Admin pode fechar por unidade (`legacy_entry_enabled`).
--
-- Idempotente. `ortho_effective_settings` e `ortho_save_settings` mudam de
-- assinatura (drop + create); as demais ficam (create or replace).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) R1/Q4 — A CONFIGURAÇÃO: pontualidade, mínimos e a porta do caso legado
-- -----------------------------------------------------------------------------
alter table public.ortho_settings
  add column if not exists punctuality_discount_percent numeric(5,2) not null default 0,
  add column if not exists max_punctuality_discount_percent numeric(5,2) not null default 10,
  add column if not exists min_monthly_fee_cents integer not null default 0,
  add column if not exists legacy_entry_enabled boolean;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_settings_punctuality_check') then
    alter table public.ortho_settings
      add constraint ortho_settings_punctuality_check
      check (punctuality_discount_percent between 0 and 100
             and max_punctuality_discount_percent between 0 and 100
             and min_monthly_fee_cents >= 0);
  end if;
end $$;

-- O retorno ganha 4 colunas: precisa derrubar antes (regra 1 do check-migrations).
drop function if exists public.ortho_effective_settings(uuid);
create function public.ortho_effective_settings(p_clinic_id uuid)
returns table (
  monthly_fee_cents integer,
  planned_months integer,
  maintenance_interval_days integer,
  reevaluation_interval_months integer,
  finish_tolerance_days integer,
  maintenance_procedure_id uuid,
  billing_day integer,
  retainer_charge_enabled boolean,
  retainer_fee_cents integer,
  retainer_terms text,
  punctuality_discount_percent numeric,
  max_punctuality_discount_percent numeric,
  min_monthly_fee_cents integer,
  legacy_entry_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(u.monthly_fee_cents, n.monthly_fee_cents, 0),
    coalesce(u.planned_months, n.planned_months, 24),
    coalesce(u.maintenance_interval_days, n.maintenance_interval_days, 30),
    coalesce(u.reevaluation_interval_months, n.reevaluation_interval_months, 6),
    coalesce(u.finish_tolerance_days, n.finish_tolerance_days, 30),
    coalesce(u.maintenance_procedure_id, n.maintenance_procedure_id),
    coalesce(u.billing_day, n.billing_day, 10),
    coalesce(u.retainer_charge_enabled, n.retainer_charge_enabled, false),
    coalesce(u.retainer_fee_cents, n.retainer_fee_cents, 0),
    coalesce(u.retainer_terms, n.retainer_terms),
    coalesce(u.punctuality_discount_percent, n.punctuality_discount_percent, 0),
    coalesce(u.max_punctuality_discount_percent, n.max_punctuality_discount_percent, 10),
    coalesce(u.min_monthly_fee_cents, n.min_monthly_fee_cents, 0),
    coalesce(u.legacy_entry_enabled, n.legacy_entry_enabled, true)
  from (select 1) one
  left join public.ortho_settings u on u.clinic_id = p_clinic_id
  left join public.ortho_settings n on n.clinic_id is null;
$$;
revoke execute on function public.ortho_effective_settings(uuid) from public, anon, authenticated;
grant execute on function public.ortho_effective_settings(uuid) to authenticated;

drop function if exists public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text);
create or replace function public.ortho_save_settings(
  p_clinic_id uuid,
  p_monthly_fee_cents integer,
  p_planned_months integer,
  p_interval_days integer,
  p_reevaluation_months integer,
  p_tolerance_days integer,
  p_maintenance_procedure_id uuid,
  p_billing_day integer,
  p_retainer_charge_enabled boolean default false,
  p_retainer_fee_cents integer default 0,
  p_retainer_terms text default null,
  p_punctuality_discount_percent numeric default 0,
  p_max_punctuality_discount_percent numeric default 10,
  p_min_monthly_fee_cents integer default 0,
  p_legacy_entry_enabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_clinic_id is null then
    if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  elsif not (public.is_admin_master()
             or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  -- A porta do caso legado é do Admin (Q1): o Gerente não a abre nem fecha.
  if p_legacy_entry_enabled is not null and not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.ortho_settings
    (clinic_id, monthly_fee_cents, planned_months, maintenance_interval_days,
     reevaluation_interval_months, finish_tolerance_days, maintenance_procedure_id,
     billing_day, retainer_charge_enabled, retainer_fee_cents, retainer_terms,
     punctuality_discount_percent, max_punctuality_discount_percent, min_monthly_fee_cents,
     legacy_entry_enabled, updated_by)
  values
    (p_clinic_id, coalesce(p_monthly_fee_cents, 0), coalesce(p_planned_months, 24),
     coalesce(p_interval_days, 30), coalesce(p_reevaluation_months, 6),
     coalesce(p_tolerance_days, 30), p_maintenance_procedure_id,
     coalesce(p_billing_day, 10),
     coalesce(p_retainer_charge_enabled, false), coalesce(p_retainer_fee_cents, 0),
     nullif(btrim(p_retainer_terms), ''),
     coalesce(p_punctuality_discount_percent, 0), coalesce(p_max_punctuality_discount_percent, 10),
     coalesce(p_min_monthly_fee_cents, 0),
     case when p_clinic_id is null then coalesce(p_legacy_entry_enabled, true) else p_legacy_entry_enabled end,
     (select auth.uid()))
  on conflict (clinic_id) do update set
    monthly_fee_cents = excluded.monthly_fee_cents,
    planned_months = excluded.planned_months,
    maintenance_interval_days = excluded.maintenance_interval_days,
    reevaluation_interval_months = excluded.reevaluation_interval_months,
    finish_tolerance_days = excluded.finish_tolerance_days,
    maintenance_procedure_id = excluded.maintenance_procedure_id,
    billing_day = excluded.billing_day,
    retainer_charge_enabled = excluded.retainer_charge_enabled,
    retainer_fee_cents = excluded.retainer_fee_cents,
    retainer_terms = excluded.retainer_terms,
    punctuality_discount_percent = excluded.punctuality_discount_percent,
    max_punctuality_discount_percent = excluded.max_punctuality_discount_percent,
    min_monthly_fee_cents = excluded.min_monthly_fee_cents,
    -- O Gerente salva sem mexer na porta (nulo = fica como está).
    legacy_entry_enabled = case when p_legacy_entry_enabled is null
                                then public.ortho_settings.legacy_entry_enabled
                                else excluded.legacy_entry_enabled end,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;
revoke execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text, numeric, numeric, integer, boolean) from public, anon, authenticated;
grant execute on function public.ortho_save_settings(uuid, integer, integer, integer, integer, integer, uuid, integer, boolean, integer, text, numeric, numeric, integer, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) R5/R7 — O ACORDO ORTODÔNTICO DA NEGOCIAÇÃO (o Consultor fecha)
-- -----------------------------------------------------------------------------
create table if not exists public.plan_negotiation_ortho (
  negotiation_id uuid primary key,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  monthly_fee_cents integer not null default 0 check (monthly_fee_cents >= 0),
  -- Quantas mensalidades neste lote (R8/R9: o lote; a renovação é a ORTO9).
  installments_count integer not null default 12 check (installments_count between 1 and 120),
  -- R7: como as mensalidades são emitidas (a emissão em si fica fora do sistema até o ASAAS — Q7).
  billing_method text not null default 'boleto'
    check (billing_method in ('pix_recorrente','debito_recorrente','credito_recorrente','cartao_parcelado','boleto','avista_periodo')),
  billing_day integer not null default 10 check (billing_day between 1 and 28),
  -- R1: desconto para pagamento até o vencimento (aplicado na baixa — ORTO9).
  punctuality_discount_percent numeric(5,2) not null default 0 check (punctuality_discount_percent between 0 and 100),
  retainer_charged boolean not null default false,
  retainer_fee_cents integer not null default 0 check (retainer_fee_cents >= 0),
  retainer_terms text,
  notes text,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A ligação com nome fixo: o app embute `ortho:plan_negotiation_ortho!plan_negotiation_ortho_negotiation_id_fkey`.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_negotiation_ortho_negotiation_id_fkey') then
    alter table public.plan_negotiation_ortho
      add constraint plan_negotiation_ortho_negotiation_id_fkey
      foreign key (negotiation_id) references public.plan_negotiations (id) on delete cascade;
  end if;
end $$;
create index if not exists plan_negotiation_ortho_client_idx on public.plan_negotiation_ortho (client_id);

alter table public.plan_negotiation_ortho enable row level security;
-- Lê quem lê a negociação (0147).
drop policy if exists "plan_negotiation_ortho_select" on public.plan_negotiation_ortho;
create policy "plan_negotiation_ortho_select" on public.plan_negotiation_ortho
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','clinical_coordinator','receptionist']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );
-- Gravar: só pelas funções. Direto, só o Admin.
drop policy if exists "plan_negotiation_ortho_write" on public.plan_negotiation_ortho;
create policy "plan_negotiation_ortho_write" on public.plan_negotiation_ortho
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

-- Os limites da ortodontia (Q4): mensalidade mínima e pontualidade máxima da
-- configuração (rede → unidade); contenção "cobrada" sem valor também pede o
-- Gerente. Interna: `evaluate_negotiation_rules` chama.
create or replace function public._negotiation_ortho_violations(p_negotiation_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.plan_negotiation_ortho;
  v_s record;
  v_out text[] := '{}';
begin
  select * into v_o from public.plan_negotiation_ortho where negotiation_id = p_negotiation_id;
  if v_o.negotiation_id is null then return v_out; end if;
  select * into v_s from public.ortho_effective_settings(v_o.clinic_id);

  if coalesce(v_s.min_monthly_fee_cents, 0) > 0 and v_o.monthly_fee_cents < v_s.min_monthly_fee_cents then
    v_out := v_out || format(
      'Mensalidade ortodôntica de R$ %s abaixo do mínimo de R$ %s',
      to_char(v_o.monthly_fee_cents / 100.0, 'FM999G999D00'),
      to_char(v_s.min_monthly_fee_cents / 100.0, 'FM999G999D00'));
  end if;
  if v_o.punctuality_discount_percent > coalesce(v_s.max_punctuality_discount_percent, 10) then
    v_out := v_out || format(
      'Desconto de pontualidade de %s%% acima do máximo permitido (%s%%)',
      v_o.punctuality_discount_percent, coalesce(v_s.max_punctuality_discount_percent, 10));
  end if;
  if v_o.retainer_charged and v_o.retainer_fee_cents <= 0 then
    v_out := v_out || 'Contenção marcada como cobrada, sem valor'::text;
  end if;
  return v_out;
end;
$$;
revoke execute on function public._negotiation_ortho_violations(uuid) from public, anon, authenticated;

-- A regra comercial inteira (0327) + os limites da ortodontia. Mesma assinatura.
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
  v_program integer;
  v_discountable integer;
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
  v_emp record;
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

  -- Totais: SÓ os itens da opção selecionada (0152). J7: o benefício do
  -- programa é somado à parte, e a base do desconto manual exclui os itens que
  -- já recebem benefício (decisão do dono, 25/07/2026).
  select
    coalesce(sum(case when ni.included
                      then i.quantity * i.unit_price_cents else 0 end), 0),
    coalesce(sum(case when ni.included
                      then ni.program_discount_cents else 0 end), 0),
    coalesce(sum(case when ni.included and coalesce(ni.program_discount_cents, 0) = 0
                      then i.quantity * i.unit_price_cents else 0 end), 0),
    count(*) filter (where not ni.included)
    into v_subtotal, v_program, v_discountable, v_excluded
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items i on i.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and i.option_id = v_neg.option_id;

  -- Total autoritativo: o que o cliente paga de fato.
  v_final := greatest(0, v_subtotal - v_program + v_neg.adjustment_cents);

  select coalesce(u.max_discount_percent, n.max_discount_percent),
         coalesce(u.max_installments, n.max_installments),
         coalesce(u.allowed_methods, n.allowed_methods)
    into v_max_disc, v_max_inst, v_methods
  from (select 1) one
  left join public.commercial_rules u on u.clinic_id = v_neg.clinic_id
  left join public.commercial_rules n on n.clinic_id is null;

  -- J5: Risarte Empresarial — formas de pagamento e parcelamento da EMPRESA.
  select * into v_emp from public.empresarial_client_conditions(v_neg.client_id);
  if v_emp.max_installments is not null then
    v_max_inst := greatest(coalesce(v_max_inst, 1), v_emp.max_installments);
    if v_methods is not null then
      if v_emp.allowed_methods is null then
        v_methods := null;
      else
        select array(select distinct unnest(v_methods || v_emp.allowed_methods))
          into v_methods;
      end if;
    end if;
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

  -- J7: o desconto manual é medido sobre a base DESCONTÁVEL (sem os itens que
  -- já têm benefício do programa) — antes era sobre o subtotal cheio, o que
  -- deixava passar desconto acima do teto real.
  v_discount_pct := case
    when v_discountable > 0 and v_neg.adjustment_cents < 0
      then (-v_neg.adjustment_cents)::numeric * 100 / v_discountable
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

  -- GP7 (0326): pacote abaixo do mínimo pede a autorização do Gerente.
  v_violations := v_violations
    || public._negotiation_package_floor(p_negotiation_id, v_neg.adjustment_cents, v_discountable);
  -- PM (0327): procedimento abaixo do mínimo também pede o Gerente.
  v_violations := v_violations
    || public._negotiation_procedure_floor(p_negotiation_id, v_neg.adjustment_cents, v_discountable);
  -- ORTO8 (0334): o acordo ortodôntico também tem limites (Q4).
  v_violations := v_violations
    || public._negotiation_ortho_violations(p_negotiation_id);

  update public.plan_negotiations set
    subtotal_cents = v_subtotal,
    program_discount_cents = v_program,
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
revoke execute on function public.evaluate_negotiation_rules(uuid, boolean) from public, anon, authenticated;
grant execute on function public.evaluate_negotiation_rules(uuid, boolean) to authenticated;

-- O Consultor (ou o Gerente, ou o Admin) salva o acordo; a regra é reavaliada
-- na hora (fora do limite → aguardando autorização do Gerente).
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
  p_notes text default null
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

  insert into public.plan_negotiation_ortho
    (negotiation_id, clinic_id, client_id, monthly_fee_cents, installments_count,
     billing_method, billing_day, punctuality_discount_percent,
     retainer_charged, retainer_fee_cents, retainer_terms, notes, created_by, updated_by)
  values
    (p_negotiation_id, v_neg.clinic_id, v_neg.client_id,
     greatest(0, coalesce(p_monthly_fee_cents, 0)), coalesce(p_installments_count, 12),
     coalesce(p_billing_method, 'boleto'), coalesce(p_billing_day, 10),
     greatest(0, coalesce(p_punctuality_discount_percent, 0)),
     coalesce(p_retainer_charged, false), greatest(0, coalesce(p_retainer_fee_cents, 0)),
     nullif(btrim(p_retainer_terms), ''), nullif(btrim(p_notes), ''), v_user, v_user)
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
    updated_by = v_user,
    updated_at = now();

  return public.evaluate_negotiation_rules(p_negotiation_id, true);
end;
$$;
revoke execute on function public.save_negotiation_ortho(uuid, integer, integer, text, integer, numeric, boolean, integer, text, text) from public, anon, authenticated;
grant execute on function public.save_negotiation_ortho(uuid, integer, integer, text, integer, numeric, boolean, integer, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) O CASO: de onde veio (venda ou legado) e o acordo guardado na irmã
-- -----------------------------------------------------------------------------
alter table public.ortho_cases
  add column if not exists origin text not null default 'venda';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_cases_origin_check') then
    alter table public.ortho_cases
      add constraint ortho_cases_origin_check check (origin in ('venda','legado'));
  end if;
end $$;
-- O que já existia sem venda por trás é, por definição, legado.
update public.ortho_cases set origin = 'legado'
 where negotiation_id is null and origin = 'venda';

alter table public.ortho_case_terms
  add column if not exists installments_count integer not null default 12,
  add column if not exists billing_method text,
  add column if not exists punctuality_discount_percent numeric(5,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_case_terms_billing_check') then
    alter table public.ortho_case_terms
      add constraint ortho_case_terms_billing_check
      check (installments_count between 1 and 120
             and punctuality_discount_percent between 0 and 100
             and (billing_method is null or billing_method in
                  ('pix_recorrente','debito_recorrente','credito_recorrente','cartao_parcelado','boleto','avista_periodo')));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4) R2/R4 — O CASO NASCE NO FECHAMENTO DA VENDA (e avisa quem agenda)
-- -----------------------------------------------------------------------------
-- Interna: `commercial_close_step` chama ao fechar. Venda sem ortodontia (sem
-- proposta e sem procedimento de Ortodontia na opção) → nada. Paciente já com
-- caso aberto → só liga a venda ao caso. Nunca derruba o fechamento (o
-- chamador embrulha em exceção).
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
     and status in ('aguardando_inicio','em_tratamento','contencao')
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
     installments_count, billing_method, punctuality_discount_percent, updated_by)
  values
    (v_id, v_neg.clinic_id,
     coalesce(v_o.monthly_fee_cents, v_s.monthly_fee_cents, 0),
     coalesce(v_o.billing_day, v_s.billing_day, 10), 0,
     coalesce(v_o.retainer_charged, v_s.retainer_charge_enabled, false),
     coalesce(v_o.retainer_fee_cents, v_s.retainer_fee_cents, 0),
     coalesce(v_o.retainer_terms, v_s.retainer_terms),
     coalesce(v_o.installments_count, 12), v_o.billing_method,
     coalesce(v_o.punctuality_discount_percent, v_s.punctuality_discount_percent, 0),
     v_user)
  on conflict (case_id) do nothing;

  perform public._ortho_log(v_id, 'caso_aberto',
    'Caso aberto no fechamento da venda' || coalesce(' ' || v_neg.code, '')
    || case when v_p.option_id is not null then ' — características da proposta ortodôntica do plano' else '' end
    || case when v_o.negotiation_id is not null then ' — acordo comercial da negociação' else ' — acordo pelo padrão da unidade' end);

  -- R4: quem agenda e quem gere ficam sabendo (a Recepção já recebe o
  -- pop-up "FECHAMENTO! Iniciar tratamento" do fechamento; este é o da ortodontia).
  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_neg.clinic_id,
    'Ortodontia: caso fechado — agendar a instalação',
    coalesce(v_client_name, 'Paciente') || ' fechou o tratamento ortodôntico (' || v_code
      || '). Agende a instalação do aparelho (início de tratamento) com um ortodontista; o caso está aguardando início.',
    '/ortodontia/casos/' || v_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_neg.clinic_id
    and ucr.role in ('unit_manager','clinical_coordinator','receptionist')
    and ucr.user_id is distinct from v_user;

  return v_id;
end;
$$;
revoke execute on function public._ortho_open_from_sale(uuid) from public, anon, authenticated;

-- O fechamento (0202/0295) + a abertura do caso ortodôntico. Mesma assinatura.
create or replace function public.commercial_close_step(
  p_negotiation_id uuid,
  p_step text,
  p_value boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_sale public.commercial_sales;
  v_sale_id uuid;
  v_card uuid;
  v_user uuid := (select auth.uid());
  v_signed boolean;
  v_paid boolean;
  v_closed boolean := false;
  v_client_name text;
  v_reais text;
  v_label text;
  v_ortho uuid;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_neg.status <> 'aceita' then raise exception 'NOT_ACCEPTED'; end if;
  -- 0202: 'payment' continua aceito como apelido de 'payment_confirmed' para
  -- não quebrar chamada antiga em cache do navegador.
  if p_step not in ('contract','payment','payment_issued','payment_confirmed') then
    raise exception 'INVALID_STEP';
  end if;

  select * into v_sale from public.commercial_sales where negotiation_id = p_negotiation_id;
  if v_sale.id is null then
    insert into public.commercial_sales
      (negotiation_id, client_id, clinic_id, plan_id, final_cents)
    values (p_negotiation_id, v_neg.client_id, v_neg.clinic_id, v_neg.plan_id, v_neg.final_cents)
    returning * into v_sale;
  end if;
  v_sale_id := v_sale.id;

  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if p_step = 'contract' then
    update public.commercial_sales set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Contrato ';
  elsif p_step = 'payment_issued' then
    update public.commercial_sales set
      payment_issued = p_value,
      payment_issued_at = case when p_value then now() else null end,
      payment_issued_by = case when p_value then v_user else null end,
      -- Mesma regra da venda direta (§7.6): valor zerado pelo programa não tem
      -- o que cobrar — emitir já confirma.
      payment_confirmed = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                               then true else payment_confirmed end,
      payment_confirmed_at = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                                  then now() else payment_confirmed_at end,
      payment_confirmed_by = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                                  then v_user else payment_confirmed_by end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Cobrança ';
  else
    update public.commercial_sales set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Pagamento ';
  end if;

  select contract_signed, payment_confirmed into v_signed, v_paid
  from public.commercial_sales where id = v_sale_id;

  v_card := public.commercial_ensure_card(v_neg.client_id);
  perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
    'fechamento_passo',
    v_label || case when p_value then 'confirmado' else 'desmarcado' end);

  -- REGRA DE OURO, inalterada: assinado + pagamento CONFIRMADO = venda.
  if v_signed and v_paid then
    update public.commercial_sales set closed_at = now(), updated_at = now()
    where id = v_sale_id;
    v_closed := true;

    update public.journey_phase_history set exited_at = now()
    where client_id = v_neg.client_id and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_neg.client_id, v_neg.clinic_id, 'treatment_start', v_user);
    update public.clients set journey_phase = 'treatment_start', phase_entered_at = now()
    where id = v_neg.client_id;

    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    v_reais := 'R$ ' || (v_neg.final_cents / 100)::text || ',' ||
               lpad((v_neg.final_cents % 100)::text, 2, '0');

    perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
      'venda_concluida', 'VENDA CONCLUÍDA — ' || v_reais || ' (contrato assinado + pagamento)');

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'FECHAMENTO! Iniciar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano. Fale com o cliente, dê as boas-vindas e agende o início do tratamento.',
      '/agenda?cliente=' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'receptionist'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Novo fechamento — acompanhar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano e vai iniciar o tratamento. Acompanhe a execução com excelência.',
      '/prontuarios/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Venda fechada — ' || v_reais,
      coalesce(v_client_name, 'Cliente') || ' — venda de ' || v_reais
        || ' concluída (contrato assinado e pagamento confirmado).',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;

    -- ORTO8 (0334): venda com ortodontia → o caso nasce aqui. Nunca derruba o
    -- fechamento: se a ortodontia falhar, fica o aviso no log do banco.
    begin
      v_ortho := public._ortho_open_from_sale(p_negotiation_id);
    exception when others then
      raise warning '_ortho_open_from_sale (%): %', p_negotiation_id, sqlerrm;
    end;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'commercial_sale', p_negotiation_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed,
                       'ortho_case_id', v_ortho));

  return jsonb_build_object('signed', v_signed, 'paid', v_paid, 'closed', v_closed,
                            'ortho_case_id', v_ortho);
end;
$$;
revoke execute on function public.commercial_close_step(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.commercial_close_step(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) R4/Q1 — SEM VENDA NÃO SE ABRE CASO; quem já estava em tratamento é LEGADO
-- -----------------------------------------------------------------------------
-- A abertura manual passa a exigir a venda FECHADA (contrato + pagamento) por
-- trás — é o caminho das vendas fechadas antes desta versão ("vendas sem caso"
-- no Painel). O acordo da negociação preenche o que a tela não mandar.
create or replace function public.ortho_create_case(
  p_client_id uuid,
  p_orthodontist_id uuid,
  p_treatment_kind text,
  p_start_date date,
  p_planned_months integer,
  p_interval_days integer,
  p_monthly_fee_cents integer,
  p_billing_day integer,
  p_installation_fee_cents integer default 0,
  p_maintenance_procedure_id uuid default null,
  p_negotiation_id uuid default null,
  p_notes text default null,
  p_start_now boolean default false,
  p_retainer_charged boolean default null,
  p_retainer_fee_cents integer default null,
  p_retainer_terms text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_id uuid;
  v_status text := 'aguardando_inicio';
  v_s record;
  v_plan uuid;
  v_option uuid;
  v_p record;
  v_o record;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from public.ortho_cases
              where client_id = p_client_id
                and status in ('aguardando_inicio','em_tratamento','contencao')) then
    raise exception 'CASE_ALREADY_OPEN';
  end if;
  -- R4: o caso é o resultado de uma venda.
  if p_negotiation_id is null then raise exception 'SALE_REQUIRED'; end if;
  if not exists (select 1 from public.commercial_sales s
                  where s.negotiation_id = p_negotiation_id
                    and s.client_id = p_client_id
                    and s.closed_at is not null and s.cancelled_at is null) then
    raise exception 'SALE_NOT_CLOSED';
  end if;
  if p_start_now and p_start_date is not null and p_start_date <= public.today_br() then
    v_status := 'em_tratamento';
  end if;

  select * into v_s from public.ortho_effective_settings(v_clinic);
  select plan_id, option_id into v_plan, v_option from public.plan_negotiations where id = p_negotiation_id;
  if v_option is not null then
    select * into v_p from public.treatment_plan_ortho where option_id = v_option;
  end if;
  select * into v_o from public.plan_negotiation_ortho where negotiation_id = p_negotiation_id;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     maintenance_procedure_id, plan_id, negotiation_id, notes, origin, created_by)
  values
    (v_clinic, p_client_id, p_orthodontist_id,
     coalesce(p_treatment_kind, v_p.treatment_kind, 'aparelho_fixo'),
     v_status, p_start_date,
     coalesce(p_planned_months, v_p.planned_months, 24),
     coalesce(p_interval_days, v_p.maintenance_interval_days, 30),
     case when p_start_date is not null
          then (p_start_date + make_interval(months => coalesce(v_s.reevaluation_interval_months, 6)))::date end,
     p_maintenance_procedure_id, v_plan, p_negotiation_id, nullif(btrim(p_notes), ''),
     'venda', (select auth.uid()))
  returning id into v_id;

  insert into public.ortho_case_terms
    (case_id, clinic_id, monthly_fee_cents, billing_day, installation_fee_cents,
     retainer_charged, retainer_fee_cents, retainer_terms,
     installments_count, billing_method, punctuality_discount_percent, updated_by)
  values
    (v_id, v_clinic,
     coalesce(p_monthly_fee_cents, v_o.monthly_fee_cents, 0),
     coalesce(p_billing_day, v_o.billing_day, 10),
     coalesce(p_installation_fee_cents, 0),
     coalesce(p_retainer_charged, v_o.retainer_charged, v_s.retainer_charge_enabled, false),
     coalesce(p_retainer_fee_cents, v_o.retainer_fee_cents, v_s.retainer_fee_cents, 0),
     coalesce(nullif(btrim(p_retainer_terms), ''), v_o.retainer_terms, v_s.retainer_terms),
     coalesce(v_o.installments_count, 12), v_o.billing_method,
     coalesce(v_o.punctuality_discount_percent, v_s.punctuality_discount_percent, 0),
     (select auth.uid()))
  on conflict (case_id) do update set
    monthly_fee_cents = excluded.monthly_fee_cents,
    billing_day = excluded.billing_day,
    installation_fee_cents = excluded.installation_fee_cents,
    retainer_charged = excluded.retainer_charged,
    retainer_fee_cents = excluded.retainer_fee_cents,
    retainer_terms = excluded.retainer_terms,
    installments_count = excluded.installments_count,
    billing_method = excluded.billing_method,
    punctuality_discount_percent = excluded.punctuality_discount_percent,
    updated_by = excluded.updated_by;

  perform public._ortho_log(v_id, 'caso_aberto',
    'Caso aberto a partir da venda' || case when v_status = 'em_tratamento' then ' — tratamento iniciado' else '' end
    || case when v_p.option_id is not null then ' — características da proposta ortodôntica do plano' else '' end);
  if v_status = 'em_tratamento' then
    perform public.ortho_plan_maintenances(v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) to authenticated;

-- Q1: o caso LEGADO — paciente que já estava em tratamento antes do sistema.
-- Gerente/Coordenador, só enquanto a porta está aberta na unidade (o Admin
-- fecha pela configuração). Fica marcado como legado, com o motivo no histórico.
create or replace function public.ortho_create_legacy_case(
  p_client_id uuid,
  p_orthodontist_id uuid,
  p_treatment_kind text,
  p_start_date date,
  p_planned_months integer,
  p_interval_days integer,
  p_monthly_fee_cents integer,
  p_billing_day integer,
  p_installation_fee_cents integer default 0,
  p_maintenance_procedure_id uuid default null,
  p_notes text default null,
  p_start_now boolean default true,
  p_retainer_charged boolean default null,
  p_retainer_fee_cents integer default null,
  p_retainer_terms text default null,
  p_legacy_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_id uuid;
  v_status text := 'aguardando_inicio';
  v_s record;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  select * into v_s from public.ortho_effective_settings(v_clinic);
  if not coalesce(v_s.legacy_entry_enabled, true) then raise exception 'LEGACY_CLOSED'; end if;
  if exists (select 1 from public.ortho_cases
              where client_id = p_client_id
                and status in ('aguardando_inicio','em_tratamento','contencao')) then
    raise exception 'CASE_ALREADY_OPEN';
  end if;
  if nullif(btrim(p_legacy_note), '') is null then raise exception 'LEGACY_NOTE_REQUIRED'; end if;
  if p_start_now and p_start_date is not null and p_start_date <= public.today_br() then
    v_status := 'em_tratamento';
  end if;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     maintenance_procedure_id, notes, origin, created_by)
  values
    (v_clinic, p_client_id, p_orthodontist_id, coalesce(p_treatment_kind, 'aparelho_fixo'),
     v_status, p_start_date,
     coalesce(p_planned_months, 24), coalesce(p_interval_days, 30),
     case when p_start_date is not null
          then (p_start_date + make_interval(months => coalesce(v_s.reevaluation_interval_months, 6)))::date end,
     p_maintenance_procedure_id, nullif(btrim(p_notes), ''), 'legado', (select auth.uid()))
  returning id into v_id;

  insert into public.ortho_case_terms
    (case_id, clinic_id, monthly_fee_cents, billing_day, installation_fee_cents,
     retainer_charged, retainer_fee_cents, retainer_terms,
     punctuality_discount_percent, updated_by)
  values
    (v_id, v_clinic,
     coalesce(p_monthly_fee_cents, 0), coalesce(p_billing_day, 10),
     coalesce(p_installation_fee_cents, 0),
     coalesce(p_retainer_charged, v_s.retainer_charge_enabled, false),
     coalesce(p_retainer_fee_cents, v_s.retainer_fee_cents, 0),
     coalesce(nullif(btrim(p_retainer_terms), ''), v_s.retainer_terms),
     coalesce(v_s.punctuality_discount_percent, 0),
     (select auth.uid()))
  on conflict (case_id) do nothing;

  perform public._ortho_log(v_id, 'caso_aberto',
    'Caso LEGADO (já em tratamento antes do sistema): ' || btrim(p_legacy_note)
    || case when v_status = 'em_tratamento' then ' — tratamento em andamento' else '' end);
  if v_status = 'em_tratamento' then
    perform public.ortho_plan_maintenances(v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ortho_create_legacy_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, text, boolean, boolean, integer, text, text) from public, anon, authenticated;
grant execute on function public.ortho_create_legacy_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, text, boolean, boolean, integer, text, text) to authenticated;

-- Tabela nova entra na auditoria de alterações (0288).
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_settings'
      and column_name in ('punctuality_discount_percent','max_punctuality_discount_percent','min_monthly_fee_cents','legacy_entry_enabled')) as config_nova,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'plan_negotiation_ortho') as acordo_na_negociacao,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('save_negotiation_ortho','_negotiation_ortho_violations','_ortho_open_from_sale','ortho_create_legacy_case')) as funcoes_novas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'evaluate_negotiation_rules'
      and p.prosrc like '%_negotiation_ortho_violations%') as regra_com_ortodontia,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'commercial_close_step'
      and p.prosrc like '%_ortho_open_from_sale%') as fechamento_abre_o_caso,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_cases' and column_name = 'origin') as origem_do_caso,
  (select count(*) from public.ortho_cases where origin not in ('venda','legado')) as casos_sem_origem;
-- Esperado: 4 · 1 · 4 · 1 · 1 · 1 · 0
