-- =============================================================================
-- 4018 — ASA4, entrega 4: AS MENSALIDADES PELO ASAAS, DO JEITO GENÉRICO
-- (docs/integracao-asaas.md 19.32 a 19.32.10; aprovada pelo Jeferson em 15/11/2026)
-- =============================================================================
-- O CAMINHO COMUM (lista, emissão, baixa pelo aviso, travas, cancelamento,
-- taxa da rede, selo) passa a trabalhar com a cobrança de QUALQUER ORIGEM que
-- não seja a parcela de venda (a parcela continua no caminho de hoje, intocada).
-- Cada origem se registra em `charge_source_types` e informa só o que é dela,
-- em 5 funções:
--   due_fn(clinic, limit)        → as mensalidades que podem ir ao Asaas (e se a
--                                   cobrança sai já, sem esperar a janela)
--   info_fn(id)                   → unidade, cliente, valor, desconto, vencimento, descrição
--   settle_fn(id, pago_em, valor, meio) → o que a baixa faz (ativar, pontos…)
--   overdue_fn(clientes, corte)   → o que conta no selo "Em atraso"
--   lock: o gatilho genérico `_fee_source_lock('<origem>')` na tabela dela
-- Um tipo novo de mensalidade = registrar a origem e escrever as 5 funções.
-- Esta migração registra o PPR+ (`ppr_charge`) e a Ortodontia (`ortho_charge`).
--
-- E O QUE É DE CADA PROGRAMA (19.32.5 e 19.32.10):
--   * PPR+: boleto e Pix avulsos na adesão; a 1ª mensalidade nasce na
--     assinatura; a mensalidade nasce no dia 1 do mês anterior; a suspensão aos
--     30 dias roda sozinha; aos 90 dias NÃO cancela: avisa o Gerente a cada 7
--     dias até ele decidir; suspensa não gera mensalidade nova; reativada, a
--     próxima nasce na hora (os meses da suspensão não são cobrados); cancelada,
--     os meses que não venceram caem e os vencidos ficam como dívida.
--   * Ortodontia: boleto, Pix e cartão à vista pelo link; o desconto de
--     pontualidade vai como desconto do Asaas até o vencimento.
--   * Recorrentes (crédito, débito, Pix) continuam como hoje até a ASA4B; a
--     passagem para boleto/Pix é uma a uma, com a concordância do cliente.
--   * Nada muda sozinho: a unidade liga "Mensalidades pelo Asaas a partir de…"
--     na Central, depois de ver quantos clientes entram e marcar "Avisei os
--     clientes". Sem multa nem juros na mensalidade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A COBRANÇA LIGADA A QUALQUER ORIGEM
-- -----------------------------------------------------------------------------
alter table public.charges add column if not exists source_id uuid;
alter table public.charges add column if not exists description text;
create unique index if not exists charges_one_active_per_source
  on public.charges (source_type, source_id)
  where source_id is not null and status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa');
create index if not exists charges_source_idx on public.charges (source_type, source_id) where source_id is not null;
alter table public.charges drop constraint if exists charges_auto_origin_check;
alter table public.charges add constraint charges_auto_origin_check
  check (auto_origin is null or auto_origin in ('assinatura', 'venda_direta', 'rotina', 'rodar_agora', 'restante', 'renegociacao', 'mensalidade'));

-- O registro das origens.
create table if not exists public.charge_source_types (
  source_type text primary key,
  label text not null,
  due_fn text not null,
  info_fn text not null,
  settle_fn text not null,
  overdue_fn text not null,
  visible_fn text not null,
  sort_order integer not null default 0
);
alter table public.charge_source_types enable row level security;
drop policy if exists "charge_source_types_select" on public.charge_source_types;
create policy "charge_source_types_select" on public.charge_source_types for select to authenticated using (true);
comment on table public.charge_source_types is
  '4018 (19.32.7): as origens de cobrança fora da parcela de venda. Cada uma informa as suas funções; o caminho do Asaas chama pelo nome registrado.';

-- Quem vê a cobrança de uma origem (a leitura da tabela charges).
create or replace function public._charge_source_visible(p_source_type text, p_source_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fn text;
  v_ok boolean := false;
begin
  select t.visible_fn into v_fn from public.charge_source_types t where t.source_type = p_source_type;
  if v_fn is null or p_source_id is null then return false; end if;
  execute format('select public.%I($1)', v_fn) into v_ok using p_source_id;
  return coalesce(v_ok, false);
end;
$$;
revoke execute on function public._charge_source_visible(text, uuid) from public, anon, authenticated;
grant execute on function public._charge_source_visible(text, uuid) to authenticated;

drop policy if exists "charges_select_sources" on public.charges;
create policy "charges_select_sources" on public.charges
  for select to authenticated
  using (source_id is not null and public._charge_source_visible(source_type, source_id));

-- A unidade liga as mensalidades a partir de uma data (19.32.5), depois de ver
-- quantos clientes entram e confirmar que avisou.
alter table public.gateway_auto_charge_units add column if not exists fees_enabled_from date;
alter table public.gateway_auto_charge_units add column if not exists fees_confirmed_by uuid references public.profiles (id);
alter table public.gateway_auto_charge_units add column if not exists fees_confirmed_at timestamptz;

create or replace function public._fees_unit_from(p_clinic_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select u.fees_enabled_from from public.gateway_auto_charge_units u where u.clinic_id = p_clinic_id;
$$;
revoke execute on function public._fees_unit_from(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) O CAMINHO COMUM
-- -----------------------------------------------------------------------------
-- O que pode ir ao Asaas agora: a lista de cada origem, com as regras comuns
-- (a janela, a cobrança viva, o cancelamento à mão, a unidade pronta).
create or replace function public._fee_charges_due(p_clinic_id uuid, p_limit integer)
returns table (source_type text, source_id uuid, clinic_id uuid, billing_type text, due_date date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t record;
begin
  for t in select * from public.charge_source_types order by sort_order loop
    return query execute format(
      'select %L::text, d.source_id, d.clinic_id, d.billing_type, d.due_date
         from public.%I($1, $2) d
        where (d.imediata or d.due_date <= public.today_br() + public._auto_charge_window())
          and not exists (select 1 from public.charges c
                           where c.source_type = %L and c.source_id = d.source_id
                             and (c.status in (''emitindo'', ''emitida'', ''vencida'', ''erro_emissao'', ''externa'', ''paga'', ''liquidada'')
                                  or (c.status = ''cancelada'' and not c.cancel_system and c.cancelled_by is not null)))
          and public.central_is_ready(d.clinic_id)
        order by d.due_date
        limit $2', t.source_type, t.due_fn, t.source_type)
      using p_clinic_id, greatest(1, least(coalesce(p_limit, 200), 1000));
  end loop;
end;
$$;
revoke execute on function public._fee_charges_due(uuid, integer) from public, anon, authenticated;

-- A porta SEM USUÁRIO (só o servidor): cria a cobrança da origem, com o pagador
-- da regra de sempre (o responsável financeiro, senão o cliente), sem multa nem juros.
create or replace function public._fee_charge_prepare_system(p_source_type text, p_source_id uuid, p_billing_type text, p_origin text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.charge_source_types%rowtype;
  v record;
  v_client public.clients%rowtype;
  v_guard public.client_guardians%rowtype;
  v_menor boolean;
  v_kind text;
  v_gid uuid;
  v_cpf text;
  v_id uuid;
begin
  select * into t from public.charge_source_types where source_type = p_source_type;
  if t.source_type is null then raise exception 'SOURCE_UNKNOWN'; end if;
  if not exists (select 1 from public._fee_charges_due(null, 1000) d
                  where d.source_type = p_source_type and d.source_id = p_source_id) then
    raise exception 'NOT_DUE';
  end if;
  if coalesce(p_billing_type, '') not in ('BOLETO', 'PIX', 'CREDIT_CARD') then raise exception 'BILLING_TYPE_INVALID'; end if;
  execute format('select * from public.%I($1)', t.info_fn) into v using p_source_id;
  if v.clinic_id is null then raise exception 'SOURCE_NOT_FOUND'; end if;
  if coalesce(v.value_cents, 0) <= 0 then raise exception 'NOTHING_TO_CHARGE'; end if;
  select * into v_client from public.clients c where c.id = v.client_id;
  if v_client.id is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  select * into v_guard from public.client_guardians g where g.client_id = v.client_id and g.is_financial limit 1;
  v_menor := v_client.birth_date is not null and v_client.birth_date > (public.today_br() - interval '18 years')::date;
  if v_guard.id is not null then
    v_kind := 'guardian'; v_gid := v_guard.id; v_cpf := public.cpf_digits(v_guard.cpf);
  elsif v_menor then
    raise exception 'PAYER_REQUIRED';
  else
    v_kind := 'client'; v_cpf := public.cpf_digits(v_client.cpf);
  end if;
  if not public._cpf_ok(v_cpf) then
    raise exception '%', case when v_kind = 'guardian' then 'PAYER_CPF_INVALID_GUARDIAN' else 'PAYER_CPF_INVALID_CLIENT' end;
  end if;
  insert into public.charges (
    clinic_id, gateway_account_id, source_type, source_id, client_id, payer_kind, payer_guardian_id,
    billing_type, value_cents, discount_cents, fine_percent, fine_cents, interest_percent, due_date,
    is_overdue_reissue, status, created_by, auto_origin, description, via_carne
  ) values (
    v.clinic_id, public._gateway_account_of(v.clinic_id), p_source_type, p_source_id, v.client_id, v_kind, v_gid,
    p_billing_type, v.value_cents, least(coalesce(v.discount_cents, 0), v.value_cents - 1), 0, 0, 0, v.due_date,
    false, 'emitindo', null, p_origin, v.description, false
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._fee_charge_prepare_system(text, uuid, text, text) from public, anon, authenticated;

-- A baixa pelo aviso do Asaas (o ramo da origem em `_gateway_on_paid`).
create or replace function public._gateway_on_paid_source(p_charge_id uuid, p_event text, p_payment jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  t public.charge_source_types%rowtype;
  v_pid text := p_payment->>'id';
  v_paid bigint := round(coalesce((p_payment->>'value')::numeric, 0) * 100);
  v_net bigint := round((p_payment->>'netValue')::numeric * 100);
  v_on date := coalesce((p_payment->>'clientPaymentDate')::date, (p_payment->>'paymentDate')::date,
                        (p_payment->>'confirmedDate')::date, public.today_br());
  v_credit date := coalesce((p_payment->>'creditDate')::date, (p_payment->>'estimatedCreditDate')::date);
  v_final text := case when p_event = 'PAYMENT_CONFIRMED' then 'paga' else 'liquidada' end;
  v_method text;
begin
  select * into c from public.charges ch where ch.id = p_charge_id for update;
  select * into t from public.charge_source_types where source_type = c.source_type;
  -- Já baixada: só a liquidação.
  if c.status in ('paga', 'liquidada') then
    if v_final = 'liquidada' and c.status = 'paga' then
      update public.charges set status = 'liquidada', credit_date = coalesce(v_credit, credit_date), last_event_at = now() where id = c.id;
      return 'liquidada';
    end if;
    return 'ja_baixada';
  end if;
  -- Paga uma cobrança que o riSZon tinha cancelado: duplicidade (a mensalidade não muda).
  if c.status in ('cancelada', 'estornada') or c.is_external then
    insert into public.gateway_payment_surpluses
      (clinic_id, charge_id, installment_id, client_id, asaas_payment_id, amount_cents, paid_on, reason)
    values (c.clinic_id, c.id, null, c.client_id, v_pid, greatest(v_paid, 1), v_on,
            case when c.status = 'estornada' then 'cobranca_estornada' else 'cobranca_cancelada' end)
    on conflict (asaas_payment_id) do nothing;
    update public.charges set paid_cents = v_paid, paid_on = v_on, last_event_at = now() where id = c.id;
    return 'duplicidade';
  end if;

  v_method := case c.billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto' when 'CREDIT_CARD' then 'cartao' end;
  update public.charges
     set status = v_final, paid_cents = v_paid, paid_on = v_on, credit_date = v_credit,
         fee_cents = case when v_net is not null then v_paid - v_net end, net_cents = v_net, last_event_at = now()
   where id = c.id;
  -- A baixa da origem (o que a baixa à mão faz), sem pedir usuário; a trava da
  -- origem deixa passar a baixa que vem do Asaas.
  perform set_config('risarte.baixa_do_asaas', '1', true);
  execute format('select public.%I($1, $2, $3, $4)', t.settle_fn) using c.source_id, v_on, v_paid, v_method;
  perform set_config('risarte.baixa_do_asaas', '', true);
  -- A tarifa do Asaas, como despesa bancária (2.4.01), uma vez por cobrança.
  if v_net is not null and v_paid - v_net > 0
     and not exists (select 1 from public.financial_entries f where f.source_type = 'gateway_fee_charge' and f.source_id = c.id) then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date, expected_settlement_date,
      amount_cents, direction, status, source_type, source_id, description, created_by
    ) values (
      c.clinic_id, '2.4.01', v_on, coalesce(v_credit, v_on), coalesce(v_credit, v_on), v_paid - v_net, 'outflow', 'settled',
      'gateway_fee_charge', c.id, 'Taxa do Asaas — ' || coalesce(t.label, 'mensalidade') || ' (' || coalesce(v_method, 'cobrança') || ')', null);
  end if;
  return 'baixa';
end;
$$;
revoke execute on function public._gateway_on_paid_source(uuid, text, jsonb) from public, anon, authenticated;

-- A TRAVA DA ORIGEM: com a cobrança viva no Asaas, a mensalidade não aceita
-- baixa à mão, mudança de valor ou vencimento, cancelamento nem exclusão (o
-- servidor cancela no Asaas antes, pelo caminho da 4015). Marcar "atrasada" passa.
create or replace function public._fee_source_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := tg_argv[0];
begin
  if coalesce(current_setting('risarte.baixa_do_asaas', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not exists (select 1 from public.charges c
                  where c.source_type = v_type and c.source_id = old.id
                    and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then raise exception 'CHARGE_ACTIVE'; end if;
  if new.status is distinct from old.status and not (old.status in ('em_aberto', 'atrasada') and new.status in ('em_aberto', 'atrasada')) then
    raise exception 'CHARGE_ACTIVE';
  end if;
  if new.amount_cents is distinct from old.amount_cents or new.due_date is distinct from old.due_date then
    raise exception 'CHARGE_ACTIVE';
  end if;
  return new;
end;
$$;
revoke execute on function public._fee_source_lock() from public, anon, authenticated;

-- As cobranças vivas de uma origem (o servidor cancela no Asaas antes de mudar a mensalidade).
create or replace function public.fee_live_charges(p_source_type text, p_source_ids uuid[])
returns table (charge_id uuid, source_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.source_id from public.charges c
   where c.source_type = p_source_type and c.source_id = any(p_source_ids)
     and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')
     and public._charge_source_visible(p_source_type, c.source_id);
$$;
revoke execute on function public.fee_live_charges(text, uuid[]) from public, anon, authenticated;
grant execute on function public.fee_live_charges(text, uuid[]) to authenticated;

-- A cobrança de cada mensalidade, para as telas (o link e a situação).
create or replace function public.fee_charges_read(p_source_type text, p_source_ids uuid[])
returns table (source_id uuid, charge_id uuid, status text, billing_type text, link text, linha text, pix text, due_date date, value_cents bigint, discount_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (c.source_id) c.source_id, c.id, c.status, c.billing_type, c.invoice_url, c.identification_field, c.pix_copy_paste,
         c.due_date, c.value_cents, c.discount_cents
    from public.charges c
   where c.source_type = p_source_type and c.source_id = any(p_source_ids)
     and public._charge_source_visible(p_source_type, c.source_id)
   order by c.source_id, c.created_at desc;
$$;
revoke execute on function public.fee_charges_read(text, uuid[]) from public, anon, authenticated;
grant execute on function public.fee_charges_read(text, uuid[]) to authenticated;


-- -----------------------------------------------------------------------------
-- 3) O PPR+ (origem `ppr_charge`)
-- -----------------------------------------------------------------------------
alter table public.ppr_memberships drop constraint if exists ppr_memberships_payment_method_check;
alter table public.ppr_memberships add constraint ppr_memberships_payment_method_check
  check (payment_method is null or payment_method in ('credito_recorrente', 'debito_recorrente', 'pix_recorrente', 'boleto', 'pix'));
alter table public.ppr_memberships add column if not exists overdue_alert_at timestamptz;
alter table public.ppr_memberships add column if not exists overdue_kept_at timestamptz;
alter table public.ppr_memberships add column if not exists overdue_kept_by uuid references public.profiles (id);
alter table public.ppr_memberships add column if not exists method_consent jsonb;

create or replace function public._ppr_fee_billing(p_method text)
returns text language sql immutable set search_path = ''
as $$ select case p_method when 'boleto' then 'BOLETO' when 'pix' then 'PIX' end; $$;
revoke execute on function public._ppr_fee_billing(text) from public, anon, authenticated;

create or replace function public._ppr_fees_due(p_clinic_id uuid, p_limit integer)
returns table (source_id uuid, clinic_id uuid, billing_type text, due_date date, imediata boolean)
language sql stable security definer set search_path = ''
as $$
  -- a 1ª mensalidade (a que ativa a adesão) sai na hora da assinatura (4a)
  select pc.id, pc.clinic_id, public._ppr_fee_billing(m.payment_method), pc.due_date, not m.first_payment_confirmed
    from public.ppr_charges pc
    join public.ppr_memberships m on m.id = pc.membership_id
   where pc.status in ('em_aberto', 'atrasada')
     and pc.due_date >= public.today_br()
     and m.status <> 'cancelado'
     and public._ppr_fee_billing(m.payment_method) is not null
     and public._fees_unit_from(pc.clinic_id) is not null
     and pc.due_date >= public._fees_unit_from(pc.clinic_id)
     and (p_clinic_id is null or pc.clinic_id = p_clinic_id)
   order by pc.due_date
   limit greatest(1, coalesce(p_limit, 200));
$$;
revoke execute on function public._ppr_fees_due(uuid, integer) from public, anon, authenticated;

create or replace function public._ppr_fee_info(p_id uuid)
returns table (clinic_id uuid, client_id uuid, value_cents bigint, discount_cents bigint, due_date date, description text)
language sql stable security definer set search_path = ''
as $$
  select pc.clinic_id, m.holder_client_id, pc.amount_cents::bigint, 0::bigint, pc.due_date,
         'Mensalidade PPR+ ' || to_char(pc.reference_month, 'MM/YYYY') || ' — ' || cl.name
    from public.ppr_charges pc
    join public.ppr_memberships m on m.id = pc.membership_id
    join public.clinics cl on cl.id = pc.clinic_id
   where pc.id = p_id;
$$;
revoke execute on function public._ppr_fee_info(uuid) from public, anon, authenticated;

create or replace function public._ppr_fee_visible(p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.ppr_charges pc where pc.id = p_id
                  and (public.is_admin_master() or public.is_finance_franchisor()
                       or public.has_role_in_clinic(pc.clinic_id, array['unit_manager','receptionist']::public.user_role[])));
$$;
revoke execute on function public._ppr_fee_visible(uuid) from public, anon, authenticated;

create or replace function public._ppr_fees_overdue(p_client_ids uuid[], p_cutoff date)
returns table (client_id uuid, clinic_id uuid, due_date date)
language sql stable security definer set search_path = ''
as $$
  select m.holder_client_id, pc.clinic_id, pc.due_date
    from public.ppr_charges pc join public.ppr_memberships m on m.id = pc.membership_id
   where m.holder_client_id = any(p_client_ids) and pc.status in ('em_aberto', 'atrasada') and pc.due_date <= p_cutoff;
$$;
revoke execute on function public._ppr_fees_overdue(uuid[], date) from public, anon, authenticated;

-- A próxima mensalidade de uma adesão (a retomada na reativação e a 1ª na assinatura).
create or replace function public._ppr_generate_next(p_membership_id uuid, p_min_days integer default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m public.ppr_memberships%rowtype;
  v_mes date := date_trunc('month', public.today_br())::date;
  v_due date;
  v_id uuid;
begin
  select * into m from public.ppr_memberships where id = p_membership_id;
  if m.id is null or m.status in ('cancelado', 'suspenso') or coalesce(m.monthly_cents, 0) <= 0 then return null; end if;
  v_due := (v_mes + (coalesce(m.billing_day, 10) - 1))::date;
  if v_due < public.today_br() + p_min_days then
    v_mes := (v_mes + interval '1 month')::date;
    v_due := (v_mes + (coalesce(m.billing_day, 10) - 1))::date;
  end if;
  insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status)
  values (m.id, m.clinic_id, v_mes, v_due, m.monthly_cents, 'em_aberto')
  on conflict (membership_id, reference_month) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._ppr_generate_next(uuid, integer) from public, anon, authenticated;

-- A geração automática (19.32.6 item 3): no dia 1 do mês ANTERIOR ao vencimento
-- (roda todo dia; gera o mês que vem). Só nas unidades ligadas, só boleto/Pix,
-- e nunca na adesão suspensa ou cancelada.
create or replace function public._ppr_generate_run()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_mes date := (date_trunc('month', public.today_br()) + interval '1 month')::date;
  v_n integer;
begin
  insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status)
  select m.id, m.clinic_id, v_mes, (v_mes + (coalesce(m.billing_day, 10) - 1))::date, m.monthly_cents, 'em_aberto'
    from public.ppr_memberships m
   where m.status = 'ativo' and m.monthly_cents > 0
     and public._ppr_fee_billing(m.payment_method) is not null
     and public._fees_unit_from(m.clinic_id) is not null
     and (v_mes + (coalesce(m.billing_day, 10) - 1))::date >= public._fees_unit_from(m.clinic_id)
  on conflict (membership_id, reference_month) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public._ppr_generate_run() from public, anon, authenticated;

-- A 1ª mensalidade nasce na assinatura da adesão (4a), se o meio é boleto/Pix e a unidade ligou.
create or replace function public.ppr_memberships_first_fee()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.contract_signed and not coalesce(old.contract_signed, false)
     and not new.first_payment_confirmed
     and public._ppr_fee_billing(new.payment_method) is not null
     and public._fees_unit_from(new.clinic_id) is not null
     and not exists (select 1 from public.ppr_charges c where c.membership_id = new.id and c.status <> 'cancelada') then
    perform public._ppr_generate_next_first(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.ppr_memberships_first_fee() from public, anon, authenticated;

create or replace function public._ppr_generate_next_first(p_membership_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m public.ppr_memberships%rowtype;
  v_mes date := date_trunc('month', public.today_br())::date;
  v_due date;
  v_id uuid;
begin
  select * into m from public.ppr_memberships where id = p_membership_id;
  if m.id is null or coalesce(m.monthly_cents, 0) <= 0 then return null; end if;
  v_due := (v_mes + (coalesce(m.billing_day, 10) - 1))::date;
  -- vence no dia de cobrança deste mês se faltarem ao menos 3 dias; senão, no do mês seguinte
  if v_due < public.today_br() + 3 then
    v_mes := (v_mes + interval '1 month')::date;
    v_due := (v_mes + (coalesce(m.billing_day, 10) - 1))::date;
  end if;
  insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status)
  values (m.id, m.clinic_id, v_mes, v_due, m.monthly_cents, 'em_aberto')
  on conflict (membership_id, reference_month) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._ppr_generate_next_first(uuid) from public, anon, authenticated;

drop trigger if exists ppr_memberships_first_fee on public.ppr_memberships;
create trigger ppr_memberships_first_fee
  after update of contract_signed on public.ppr_memberships
  for each row execute function public.ppr_memberships_first_fee();

-- Cancelada a adesão: os meses que ainda não venceram caem; os vencidos ficam como dívida.
create or replace function public.ppr_memberships_cancel_fees()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    update public.ppr_charges set status = 'cancelada'
     where membership_id = new.id and status in ('em_aberto', 'atrasada') and due_date >= public.today_br();
  end if;
  return null;
end;
$$;
revoke execute on function public.ppr_memberships_cancel_fees() from public, anon, authenticated;
drop trigger if exists ppr_memberships_cancel_fees on public.ppr_memberships;
create trigger ppr_memberships_cancel_fees
  after update of status on public.ppr_memberships
  for each row execute function public.ppr_memberships_cancel_fees();

drop trigger if exists ppr_charges_fee_lock on public.ppr_charges;
create trigger ppr_charges_fee_lock
  before update or delete on public.ppr_charges
  for each row execute function public._fee_source_lock('ppr_charge');

-- O Gerente decide a adesão com 90 dias de atraso: "manter suspensa" para o aviso.
create or replace function public.ppr_overdue_keep(p_membership_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.ppr_memberships%rowtype;
begin
  select * into m from public.ppr_memberships where id = p_membership_id for update;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if not public._is_manager_or_admin(m.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if m.status <> 'suspenso' then raise exception 'NOT_SUSPENDED'; end if;
  update public.ppr_memberships set overdue_kept_at = now(), overdue_kept_by = (select auth.uid()), updated_at = now() where id = m.id;
  insert into public.ppr_events (membership_id, clinic_id, event_type, description, created_by)
  values (m.id, m.clinic_id, 'decisao_atraso', 'Mantida suspensa pelo Gerente (90 dias de atraso)', (select auth.uid()));
end;
$$;
revoke execute on function public.ppr_overdue_keep(uuid) from public, anon, authenticated;
grant execute on function public.ppr_overdue_keep(uuid) to authenticated;

-- A passagem de recorrência para boleto/Pix, uma a uma, com a concordância do cliente (19.32.10).
create or replace function public.ppr_membership_switch_method(p_membership_id uuid, p_method text, p_consent boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.ppr_memberships%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into m from public.ppr_memberships where id = p_membership_id for update;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(m.clinic_id, array['unit_manager','receptionist']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_method not in ('boleto', 'pix') then raise exception 'METHOD_NOT_ALLOWED'; end if;
  if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
  update public.ppr_memberships
     set payment_method = p_method,
         method_consent = jsonb_build_object('de', m.payment_method, 'para', p_method, 'por', v_user, 'em', now(),
                                             'texto', 'O cliente concordou em pagar por boleto ou Pix'),
         updated_at = now()
   where id = m.id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, m.clinic_id, 'update', 'fee_method_consent', m.id::text,
          jsonb_build_object('programa', 'PPR+', 'de', m.payment_method, 'para', p_method));
end;
$$;
revoke execute on function public.ppr_membership_switch_method(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.ppr_membership_switch_method(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A ORTODONTIA (origem `ortho_charge`)
-- -----------------------------------------------------------------------------
alter table public.ortho_case_terms drop constraint if exists ortho_case_terms_billing_check;
alter table public.ortho_case_terms add constraint ortho_case_terms_billing_check
  check (installments_count between 1 and 120
         and punctuality_discount_percent between 0 and 100
         and (billing_method is null or billing_method in
           ('pix_recorrente','debito_recorrente','credito_recorrente','cartao_parcelado','boleto','avista_periodo','pix','cartao','dinheiro')));
alter table public.ortho_billing_batches drop constraint if exists ortho_billing_batches_billing_method_check;
alter table public.ortho_billing_batches add constraint ortho_billing_batches_billing_method_check
  check (billing_method is null or billing_method in
    ('pix_recorrente','debito_recorrente','credito_recorrente','cartao_parcelado','boleto','avista_periodo','pix','cartao','dinheiro'));
alter table public.ortho_case_terms add column if not exists method_consent jsonb;
alter table public.plan_negotiation_ortho drop constraint if exists plan_negotiation_ortho_billing_method_check;
alter table public.plan_negotiation_ortho add constraint plan_negotiation_ortho_billing_method_check
  check (billing_method in ('pix_recorrente','debito_recorrente','credito_recorrente','cartao_parcelado','boleto','avista_periodo','pix','cartao','dinheiro'));

create or replace function public._ortho_fee_billing(p_method text)
returns text language sql immutable set search_path = ''
as $$ select case p_method when 'boleto' then 'BOLETO' when 'pix' then 'PIX' when 'cartao' then 'CREDIT_CARD' end; $$;
revoke execute on function public._ortho_fee_billing(text) from public, anon, authenticated;

-- O meio de uma mensalidade: o do lote, senão o do caso.
create or replace function public._ortho_fee_method(p_charge_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce((select b.billing_method from public.ortho_billing_batches b where b.id = oc.batch_id),
                  (select t.billing_method from public.ortho_case_terms t where t.case_id = oc.case_id))
    from public.ortho_charges oc where oc.id = p_charge_id;
$$;
revoke execute on function public._ortho_fee_method(uuid) from public, anon, authenticated;

create or replace function public._ortho_fee_discount_pct(p_charge_id uuid)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce((select b.punctuality_discount_percent from public.ortho_billing_batches b where b.id = oc.batch_id),
                  (select t.punctuality_discount_percent from public.ortho_case_terms t where t.case_id = oc.case_id), 0)
    from public.ortho_charges oc where oc.id = p_charge_id;
$$;
revoke execute on function public._ortho_fee_discount_pct(uuid) from public, anon, authenticated;

create or replace function public._ortho_fees_due(p_clinic_id uuid, p_limit integer)
returns table (source_id uuid, clinic_id uuid, billing_type text, due_date date, imediata boolean)
language sql stable security definer set search_path = ''
as $$
  select oc.id, oc.clinic_id, public._ortho_fee_billing(public._ortho_fee_method(oc.id)), oc.due_date, false
    from public.ortho_charges oc
   where oc.status in ('em_aberto', 'atrasada')
     and oc.kind = 'mensalidade'
     and oc.due_date >= public.today_br()
     and public._ortho_fee_billing(public._ortho_fee_method(oc.id)) is not null
     and public._fees_unit_from(oc.clinic_id) is not null
     and oc.due_date >= public._fees_unit_from(oc.clinic_id)
     and (p_clinic_id is null or oc.clinic_id = p_clinic_id)
   order by oc.due_date
   limit greatest(1, coalesce(p_limit, 200));
$$;
revoke execute on function public._ortho_fees_due(uuid, integer) from public, anon, authenticated;

create or replace function public._ortho_fee_info(p_id uuid)
returns table (clinic_id uuid, client_id uuid, value_cents bigint, discount_cents bigint, due_date date, description text)
language sql stable security definer set search_path = ''
as $$
  select oc.clinic_id, oc.client_id, oc.amount_cents::bigint,
         -- o desconto de pontualidade, como desconto do Asaas até o vencimento (19.32.5, 3)
         least(oc.amount_cents, round(oc.amount_cents * public._ortho_fee_discount_pct(oc.id) / 100.0))::bigint,
         oc.due_date,
         'Mensalidade da Ortodontia ' || to_char(oc.reference_month, 'MM/YYYY') || ' — ' || cl.name
    from public.ortho_charges oc join public.clinics cl on cl.id = oc.clinic_id
   where oc.id = p_id;
$$;
revoke execute on function public._ortho_fee_info(uuid) from public, anon, authenticated;

create or replace function public._ortho_fee_visible(p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.ortho_charges oc where oc.id = p_id and public.ortho_can_see_money(oc.clinic_id)); $$;
revoke execute on function public._ortho_fee_visible(uuid) from public, anon, authenticated;

create or replace function public._ortho_fees_overdue(p_client_ids uuid[], p_cutoff date)
returns table (client_id uuid, clinic_id uuid, due_date date)
language sql stable security definer set search_path = ''
as $$
  select oc.client_id, oc.clinic_id, oc.due_date from public.ortho_charges oc
   where oc.client_id = any(p_client_ids) and oc.status in ('em_aberto', 'atrasada') and oc.due_date <= p_cutoff;
$$;
revoke execute on function public._ortho_fees_overdue(uuid[], date) from public, anon, authenticated;

drop trigger if exists ortho_charges_fee_lock on public.ortho_charges;
create trigger ortho_charges_fee_lock
  before update or delete on public.ortho_charges
  for each row execute function public._fee_source_lock('ortho_charge');

create or replace function public.ortho_case_switch_method(p_case_id uuid, p_method text, p_consent boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.ortho_case_terms%rowtype;
  v_user uuid := (select auth.uid());
  v_clinic uuid;
begin
  select * into t from public.ortho_case_terms where case_id = p_case_id for update;
  if t.case_id is null then raise exception 'NOT_FOUND'; end if;
  select oc.clinic_id into v_clinic from public.ortho_cases oc where oc.id = p_case_id;
  if not public.ortho_can_settle(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if p_method not in ('boleto', 'pix', 'cartao') then raise exception 'METHOD_NOT_ALLOWED'; end if;
  if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
  update public.ortho_case_terms
     set billing_method = p_method,
         method_consent = jsonb_build_object('de', t.billing_method, 'para', p_method, 'por', v_user, 'em', now(),
                                             'texto', 'O cliente concordou em pagar por boleto, Pix ou cartão pelo link')
   where case_id = p_case_id;
  update public.ortho_billing_batches set billing_method = p_method where case_id = p_case_id and status = 'ativo';
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'fee_method_consent', p_case_id::text,
          jsonb_build_object('programa', 'Ortodontia', 'de', t.billing_method, 'para', p_method));
end;
$$;
revoke execute on function public.ortho_case_switch_method(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.ortho_case_switch_method(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A CHAVE DA UNIDADE: "Mensalidades pelo Asaas a partir de…" (19.32.5)
-- -----------------------------------------------------------------------------
create or replace function public.fees_switch_preview(p_clinic_id uuid, p_from date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_from date := coalesce(p_from, public.today_br());
begin
  if not public._is_manager_or_admin(p_clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  return jsonb_build_object(
    'ppr_entram', (select count(distinct m.holder_client_id) from public.ppr_memberships m
                    where m.clinic_id = p_clinic_id and m.status in ('ativo', 'aguardando_ativacao')
                      and public._ppr_fee_billing(m.payment_method) is not null),
    'ppr_esperam', (select count(distinct m.holder_client_id) from public.ppr_memberships m
                     where m.clinic_id = p_clinic_id and m.status in ('ativo', 'suspenso', 'aguardando_ativacao')
                       and public._ppr_fee_billing(m.payment_method) is null),
    'orto_entram', (select count(distinct oc.client_id) from public.ortho_charges oc
                     where oc.clinic_id = p_clinic_id and oc.status in ('em_aberto', 'atrasada') and oc.kind = 'mensalidade'
                       and oc.due_date >= v_from and public._ortho_fee_billing(public._ortho_fee_method(oc.id)) is not null),
    'orto_esperam', (select count(distinct oc.client_id) from public.ortho_charges oc
                      where oc.clinic_id = p_clinic_id and oc.status in ('em_aberto', 'atrasada') and oc.kind = 'mensalidade'
                        and oc.due_date >= v_from and public._ortho_fee_billing(public._ortho_fee_method(oc.id)) is null),
    'com_contato', (select count(distinct k.id) from public.clients k
                     where k.clinic_id = p_clinic_id and (coalesce(k.email, '') <> '' or coalesce(k.phone, '') <> '')
                       and (k.id in (select m.holder_client_id from public.ppr_memberships m
                                      where m.clinic_id = p_clinic_id and m.status in ('ativo', 'aguardando_ativacao')
                                        and public._ppr_fee_billing(m.payment_method) is not null)
                            or k.id in (select oc.client_id from public.ortho_charges oc
                                         where oc.clinic_id = p_clinic_id and oc.status in ('em_aberto', 'atrasada')
                                           and oc.due_date >= v_from and public._ortho_fee_billing(public._ortho_fee_method(oc.id)) is not null))),
    'ligada_desde', public._fees_unit_from(p_clinic_id));
end;
$$;
revoke execute on function public.fees_switch_preview(uuid, date) from public, anon, authenticated;
grant execute on function public.fees_switch_preview(uuid, date) to authenticated;

create or replace function public.fees_switch_set(p_clinic_id uuid, p_from date, p_warned boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not public._is_manager_or_admin(p_clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_from is not null then
    if not coalesce(p_warned, false) then raise exception 'WARNING_REQUIRED'; end if;
    if p_from < public.today_br() then raise exception 'DATE_IN_PAST'; end if;
  end if;
  insert into public.gateway_auto_charge_units (clinic_id, enabled, fees_enabled_from, fees_confirmed_by, fees_confirmed_at, changed_at, changed_by)
  values (p_clinic_id, false, p_from, case when p_from is not null then v_user end, case when p_from is not null then now() end, now(), v_user)
  on conflict (clinic_id) do update set
    fees_enabled_from = excluded.fees_enabled_from,
    fees_confirmed_by = excluded.fees_confirmed_by,
    fees_confirmed_at = excluded.fees_confirmed_at,
    changed_at = now(), changed_by = v_user;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, p_clinic_id, 'update', 'fees_switch', p_clinic_id::text,
          jsonb_build_object('a_partir_de', p_from, 'avisei_os_clientes', coalesce(p_warned, false)));
end;
$$;
revoke execute on function public.fees_switch_set(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.fees_switch_set(uuid, date, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O REGISTRO DAS DUAS ORIGENS
-- -----------------------------------------------------------------------------
insert into public.charge_source_types (source_type, label, due_fn, info_fn, settle_fn, overdue_fn, visible_fn, sort_order)
values
  ('ppr_charge', 'Mensalidade PPR+', '_ppr_fees_due', '_ppr_fee_info', '_ppr_fee_settle', '_ppr_fees_overdue', '_ppr_fee_visible', 10),
  ('ortho_charge', 'Mensalidade da Ortodontia', '_ortho_fees_due', '_ortho_fee_info', '_ortho_fee_settle', '_ortho_fees_overdue', '_ortho_fee_visible', 20)
on conflict (source_type) do update set
  label = excluded.label, due_fn = excluded.due_fn, info_fn = excluded.info_fn, settle_fn = excluded.settle_fn,
  overdue_fn = excluded.overdue_fn, visible_fn = excluded.visible_fn, sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- 7) O QUE JÁ EXISTE, COM OS PONTOS DA 4018 (o texto de hoje do banco)
-- -----------------------------------------------------------------------------
-- 4018: a regra da baixa do PPR+, sem pedir usuário (a baixa à mão e a do Asaas).
CREATE OR REPLACE FUNCTION public._ppr_charge_settle(p_charge_id uuid, p_paid boolean, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_charge public.ppr_charges;
  v_membership public.ppr_memberships;
  v_plan public.ppr_plans;
  v_user uuid := p_actor;
  v_points integer;
begin
  select * into v_charge from public.ppr_charges where id = p_charge_id;
  if v_charge.id is null then raise exception 'NOT_FOUND'; end if;

  select * into v_membership from public.ppr_memberships where id = v_charge.membership_id;
  select * into v_plan from public.ppr_plans where id = v_membership.plan_id;

  update public.ppr_charges set
    status = case when p_paid then 'paga' else 'em_aberto' end,
    paid_at = case when p_paid then now() else null end,
    paid_by = case when p_paid then v_user else null end
  where id = p_charge_id;

  if not p_paid then
    delete from public.ppr_social_points
    where membership_id = v_charge.membership_id
      and reference_month = v_charge.reference_month;
    return;
  end if;

  -- Primeira mensalidade paga = metade da regra de ouro (a outra é o contrato).
  if not v_membership.first_payment_confirmed then
    update public.ppr_memberships set
      first_payment_confirmed = true,
      first_payment_at = now(),
      first_payment_by = v_user,
      status = case
        when contract_signed and status = 'aguardando_ativacao' then 'ativo'
        else status end,
      activated_at = case
        when contract_signed and activated_at is null then now()
        else activated_at end,
      updated_at = now()
    where id = v_membership.id;
  elsif v_membership.status = 'suspenso' then
    -- Regularizou: volta a valer se não há mais nada vencido.
    if not exists (
      select 1 from public.ppr_charges c
      where c.membership_id = v_membership.id
        and c.status in ('em_aberto','atrasada')
        and c.due_date < current_date
    ) then
      update public.ppr_memberships set
        status = 'ativo', suspended_at = null, overdue_alert_at = null, overdue_kept_at = null, updated_at = now()
      where id = v_membership.id;
      -- 4018 (19.32.10): reativada, a próxima mensalidade nasce na hora (os meses
      -- da suspensão não são cobrados); só na unidade ligada e com boleto/Pix.
      if public._ppr_fee_billing(v_membership.payment_method) is not null
         and public._fees_unit_from(v_membership.clinic_id) is not null then
        perform public._ppr_generate_next(v_membership.id, 0);
      end if;
      insert into public.ppr_events (membership_id, clinic_id, event_type, description, created_by)
      values (v_membership.id, v_membership.clinic_id, 'reativacao',
              'Plano reativado — mensalidades regularizadas', v_user);
    end if;
  end if;

  -- Riso+ Social: pontos proporcionais ao valor pago (Light não pontua).
  if coalesce(v_plan.social_enabled, false) then
    v_points := floor(v_charge.amount_cents::numeric
                      / greatest(1, v_plan.social_points_per_cents));
    if v_points > 0 then
      insert into public.ppr_social_points
        (membership_id, clinic_id, client_id, reference_month, points, source_cents)
      values (v_membership.id, v_membership.clinic_id, v_membership.holder_client_id,
              v_charge.reference_month, v_points, v_charge.amount_cents)
      on conflict (membership_id, reference_month) do update
        set points = excluded.points, source_cents = excluded.source_cents;
    end if;
  end if;
end;
$function$;

revoke execute on function public._ppr_charge_settle(uuid, boolean, uuid) from public, anon, authenticated;

create or replace function public.ppr_mark_charge_paid(p_charge_id uuid, p_paid boolean default true)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select pc.clinic_id into v_clinic from public.ppr_charges pc where pc.id = p_charge_id;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_clinic, array['unit_manager','receptionist']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  perform public._ppr_charge_settle(p_charge_id, p_paid, (select auth.uid()));
end;
$$;
revoke execute on function public.ppr_mark_charge_paid(uuid, boolean) from public, anon, authenticated;
grant execute on function public.ppr_mark_charge_paid(uuid, boolean) to authenticated;

create or replace function public._ppr_fee_settle(p_id uuid, p_paid_on date, p_paid_cents bigint, p_method text)
returns void language plpgsql security definer set search_path = ''
as $$ begin perform public._ppr_charge_settle(p_id, true, null); end; $$;
revoke execute on function public._ppr_fee_settle(uuid, date, bigint, text) from public, anon, authenticated;

-- 4018: a regra da baixa da Ortodontia, sem pedir usuário (o desconto de pontualidade igual).
CREATE OR REPLACE FUNCTION public._ortho_charge_settle(p_charge_id uuid, p_paid boolean, p_payment_method text, p_paid_on date, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ch public.ortho_charges;
  v_user uuid := p_actor;
  v_on date := coalesce(p_paid_on, public.today_br());
  v_pct numeric := 0;
  v_disc integer := 0;
begin
  select * into v_ch from public.ortho_charges where id = p_charge_id;
  if v_ch.id is null then raise exception 'NOT_FOUND'; end if;
  if v_ch.status = 'cancelada' then raise exception 'CHARGE_CANCELLED'; end if;
  if v_on > public.today_br() then raise exception 'PAID_ON_FUTURE'; end if;

  if p_paid and v_ch.kind = 'mensalidade' then
    select coalesce(
      (select b.punctuality_discount_percent from public.ortho_billing_batches b where b.id = v_ch.batch_id),
      (select t.punctuality_discount_percent from public.ortho_case_terms t where t.case_id = v_ch.case_id),
      0) into v_pct;
    if v_on <= v_ch.due_date and v_pct > 0 then
      v_disc := least(v_ch.amount_cents, round(v_ch.amount_cents * v_pct / 100.0)::integer);
    end if;
  end if;

  update public.ortho_charges set
    status = case when p_paid then 'paga'
                  when due_date < public.today_br() then 'atrasada'
                  else 'em_aberto' end,
    paid_at = case when p_paid then now() end,
    paid_on = case when p_paid then v_on end,
    paid_by = case when p_paid then v_user end,
    payment_method = case when p_paid then nullif(p_payment_method, '') end,
    discount_cents = case when p_paid then v_disc else 0 end,
    paid_amount_cents = case when p_paid then amount_cents - v_disc end,
    updated_at = now()
  where id = p_charge_id;

  perform public._ortho_log(v_ch.case_id, case when p_paid then 'mensalidade_paga' else 'baixa_desfeita' end,
    case when v_ch.kind = 'contencao' then 'Contenção' else 'Mensalidade ' || to_char(v_ch.reference_month, 'MM/YYYY') end ||
    case when p_paid then ' paga em ' || to_char(v_on, 'DD/MM/YYYY')
                          || case when v_disc > 0 then ' (desconto de pontualidade de ' || v_pct || '%)' else '' end
         else ' — baixa desfeita' end);
end;
$function$;

revoke execute on function public._ortho_charge_settle(uuid, boolean, text, date, uuid) from public, anon, authenticated;

create or replace function public.ortho_mark_charge_paid(p_charge_id uuid, p_paid boolean default true, p_payment_method text default null, p_paid_on date default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select oc.clinic_id into v_clinic from public.ortho_charges oc where oc.id = p_charge_id;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_settle(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  perform public._ortho_charge_settle(p_charge_id, p_paid, p_payment_method, p_paid_on, (select auth.uid()));
end;
$$;
revoke execute on function public.ortho_mark_charge_paid(uuid, boolean, text, date) from public, anon, authenticated;
grant execute on function public.ortho_mark_charge_paid(uuid, boolean, text, date) to authenticated;

create or replace function public._ortho_fee_settle(p_id uuid, p_paid_on date, p_paid_cents bigint, p_method text)
returns void language plpgsql security definer set search_path = ''
as $$ begin perform public._ortho_charge_settle(p_id, true, p_method, p_paid_on, null); end; $$;
revoke execute on function public._ortho_fee_settle(uuid, date, bigint, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ppr_refresh_delinquency_raw(p_clinic_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
  v_days integer;
  v_susp integer;
  v_canc integer;
  v_changed integer := 0;
begin
  -- Marca como ATRASADA o que venceu e não foi pago.
  update public.ppr_charges set status = 'atrasada'
  where status = 'em_aberto' and due_date < current_date
    and (p_clinic_id is null or clinic_id = p_clinic_id);

  for v_row in
    select m.id, m.clinic_id, m.status,
           max(current_date - c.due_date) as days_late
    from public.ppr_memberships m
    join public.ppr_charges c on c.membership_id = m.id
    where m.status in ('ativo','suspenso')
      and c.status in ('em_aberto','atrasada')
      and c.due_date < current_date
      and (p_clinic_id is null or m.clinic_id = p_clinic_id)
    group by m.id, m.clinic_id, m.status
  loop
    select s.suspend_after_days, s.cancel_after_days into v_susp, v_canc
    from public.ppr_effective_settings(v_row.clinic_id) s;
    v_days := coalesce(v_row.days_late, 0);

    -- 4018 (19.32.10, ajuste 1): aos 90 dias o sistema NÃO cancela. Suspende, se
    -- ainda não suspendeu, e avisa o Gerente a cada 7 dias até ele decidir.
    if v_canc > 0 and v_days >= v_canc then
      if v_row.status = 'ativo' then
        update public.ppr_memberships set status = 'suspenso', suspended_at = now(), updated_at = now() where id = v_row.id;
      end if;
      if exists (select 1 from public.ppr_memberships mm where mm.id = v_row.id and mm.overdue_kept_at is null
                  and (mm.overdue_alert_at is null or mm.overdue_alert_at < now() - interval '7 days')) then
        update public.ppr_memberships set overdue_alert_at = now() where id = v_row.id;
        perform public._notify_users('ppr_90_dias', v_row.id::text || ':' || public.today_br()::text,
          coalesce((select array_agg(u.user_id) from public.user_clinic_roles u where u.clinic_id = v_row.clinic_id and u.role = 'unit_manager'), '{}'),
          v_row.clinic_id,
          'PPR+ — adesão com ' || v_days || ' dias de atraso: decida',
          'O sistema não cancela sozinho. Cancele a adesão ou mantenha suspensa. O aviso se repete a cada 7 dias até a decisão.',
          '/ppr/adesoes/' || v_row.id);
        v_changed := v_changed + 1;
      end if;
    elsif v_susp > 0 and v_days >= v_susp and v_row.status = 'ativo' then
      update public.ppr_memberships set
        status = 'suspenso', suspended_at = now(), updated_at = now()
      where id = v_row.id;
      insert into public.ppr_events (membership_id, clinic_id, event_type, description)
      values (v_row.id, v_row.clinic_id, 'suspensao',
              'Suspenso automaticamente — ' || v_days || ' dias de atraso');
      -- Avisa a unidade para cobrar o cliente.
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_row.clinic_id,
        'PPR+ — plano suspenso por falta de pagamento',
        'Mensalidade com ' || v_days || ' dias de atraso. Os benefícios estão'
          || ' bloqueados até a regularização.',
        '/ppr/adesoes/' || v_row.id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_row.clinic_id
        and ucr.role in ('receptionist','unit_manager');
      v_changed := v_changed + 1;
    end if;
  end loop;

  -- 4018: o aviso de 2 mensalidades vencidas (ao Gerente, uma vez por mês).
  for v_row in
    select m.id, m.clinic_id, count(*) as n
      from public.ppr_memberships m join public.ppr_charges c on c.membership_id = m.id
     where m.status in ('ativo', 'suspenso') and c.status in ('em_aberto', 'atrasada') and c.due_date < current_date
       and (p_clinic_id is null or m.clinic_id = p_clinic_id)
     group by m.id, m.clinic_id having count(*) >= 2
  loop
    perform public._notify_users('ppr_duas_vencidas', v_row.id::text || ':' || to_char(public.today_br(), 'YYYY-MM'),
      coalesce((select array_agg(u.user_id) from public.user_clinic_roles u where u.clinic_id = v_row.clinic_id and u.role = 'unit_manager'), '{}'),
      v_row.clinic_id, 'PPR+ — adesão com ' || v_row.n || ' mensalidades vencidas',
      'Fale com o titular antes da suspensão.', '/ppr/adesoes/' || v_row.id);
  end loop;
  return v_changed;
end;
$function$;

-- 4018: a cobrança de qualquer origem (a descrição vem da origem).
CREATE OR REPLACE FUNCTION public._charge_for_gateway(p_charge_id uuid)
 RETURNS TABLE(charge_id uuid, status text, clinic_id uuid, gateway_account_id uuid, billing_type text, value_cents bigint, discount_cents bigint, fine_percent numeric, fine_cents bigint, interest_percent numeric, due_date date, description text, asaas_payment_id text, payer_kind text, payer_guardian_id uuid, client_id uuid, payer_name text, payer_cpf text, asaas_customer_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, c.status, c.clinic_id, c.gateway_account_id, c.billing_type, c.value_cents,
         c.discount_cents, c.fine_percent, c.fine_cents, c.interest_percent, c.due_date,
         coalesce(c.description, 'Parcela ' || i.seq || ' — ' || cl.name),
         c.asaas_payment_id, c.payer_kind, c.payer_guardian_id, c.client_id,
         coalesce(g.full_name, k.full_name),
         public.cpf_digits(coalesce(g.cpf, k.cpf)),
         gc.asaas_customer_id
    from public.charges c
    left join public.payment_installments i on i.id = c.payment_installment_id
    join public.clinics cl on cl.id = c.clinic_id
    left join public.clients k on k.id = c.client_id
    left join public.client_guardians g on g.id = c.payer_guardian_id
    left join public.gateway_customers gc
      on gc.gateway_account_id = c.gateway_account_id
     and gc.cpf_cnpj = public.cpf_digits(coalesce(g.cpf, k.cpf))
   where c.id = p_charge_id;
$function$;

CREATE OR REPLACE FUNCTION public._gateway_on_paid(p_charge_id uuid, p_event text, p_payment jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.charges%rowtype;
  i public.payment_installments%rowtype;
  v_pid text := p_payment->>'id';
  v_paid bigint := round(coalesce((p_payment->>'value')::numeric, 0) * 100);
  v_net bigint := round((p_payment->>'netValue')::numeric * 100);
  v_on date := coalesce((p_payment->>'clientPaymentDate')::date, (p_payment->>'paymentDate')::date,
                        (p_payment->>'confirmedDate')::date, public.today_br());
  v_credit date := coalesce((p_payment->>'creditDate')::date, (p_payment->>'estimatedCreditDate')::date);
  v_final text := case when p_event = 'PAYMENT_CONFIRMED' then 'paga' else 'liquidada' end;
  v_reason text;
  v_r record;
  v_method text;
  v_link text;
begin
  select * into c from public.charges ch where ch.id = p_charge_id for update;
  -- 4018: a cobrança de outra origem (mensalidade) tem o ramo dela.
  if c.source_type <> 'installment' then return public._gateway_on_paid_source(c.id, p_event, p_payment); end if;
  v_link := '/prontuarios/' || c.client_id::text;

  -- Já baixada por esta cobrança: só a liquidação (o dinheiro caiu).
  if c.receipt_id is not null then
    if v_final = 'liquidada' and c.status = 'paga' then
      update public.charges set status = 'liquidada', credit_date = coalesce(v_credit, credit_date), last_event_at = now()
       where id = c.id;
      if v_credit is not null then
        update public.payment_receipts set settlement_date = v_credit where id = c.receipt_id;
        update public.financial_entries set cash_date = v_credit, expected_settlement_date = v_credit
         where source_id = c.receipt_id and source_type in ('receipt_cash', 'acquirer_fee') and reversal_of is null;
      end if;
      return 'liquidada';
    end if;
    return 'ja_baixada';
  end if;

  select * into i from public.payment_installments pi where pi.id = c.payment_installment_id for update;

  -- Duplicidade (16.6): cobrança encerrada ou parcela já paga.
  v_reason := case
    when c.status = 'cancelada' or c.is_external then 'cobranca_cancelada'
    when c.status = 'estornada' then 'cobranca_estornada'
    when i.status in ('paga', 'cancelada', 'renegociada') then 'parcela_ja_paga'
    else null end;
  if v_reason is not null then
    insert into public.gateway_payment_surpluses
      (clinic_id, charge_id, installment_id, client_id, asaas_payment_id, amount_cents, paid_on, reason)
    values (c.clinic_id, c.id, c.payment_installment_id, c.client_id, v_pid, greatest(v_paid, 1), v_on, v_reason)
    on conflict (asaas_payment_id) do nothing;
    update public.charges set paid_cents = v_paid, paid_on = v_on, last_event_at = now() where id = c.id;
    perform public._gateway_notify(c.gateway_account_id, 'duplicidade', v_pid, c.clinic_id, true, true, false,
      'Pagamento em duplicidade',
      'Um pagamento pelo Asaas chegou para uma cobrança cancelada ou parcela já paga. Decida entre devolver ou abater em outra parcela.',
      v_link);
    return 'duplicidade';
  end if;

  -- D21: a confirmação do pagamento fecha a venda (antes da baixa).
  perform public._gateway_confirm_sale(i.id);

  -- 4013: a parcela do parcelado pelo Asaas recebe a baixa como "cartão parcelado".
  v_method := case when c.installment_block is not null then 'cartao_parcelado'
                   else case c.billing_type when 'PIX' then 'pix' when 'BOLETO' then 'boleto' when 'CREDIT_CARD' then 'cartao' end end;
  select * into v_r from public._gateway_receipt(
    i.id, v_paid, v_on, v_method, 'Asaas ' || v_pid,
    md5('asaas-receipt:' || v_pid)::uuid,
    public._gateway_bank_account(c.gateway_account_id), true);

  if v_net is not null then
    perform public._gateway_apply_fee(v_r.receipt_id, v_paid - v_net, coalesce(v_credit, v_on), c.gateway_account_id,
      case when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end);
  end if;

  update public.charges
     set status = v_final, paid_cents = v_paid, paid_on = v_on, credit_date = v_credit,
         receipt_id = v_r.receipt_id, last_event_at = now()
   where id = c.id;

  if v_r.shortfall_cents > 0 then
    perform public._gateway_notify(c.gateway_account_id, 'pago_a_menor', v_pid, c.clinic_id, true, false, false,
      'Pagamento pelo Asaas abaixo do devido',
      'A parcela recebeu pelo Asaas um valor menor que o devido; o saldo ficou em aberto. Receba ou quite por valor menor.',
      v_link);
  end if;
  return 'baixa';
end;
$function$;

CREATE OR REPLACE FUNCTION public._gateway_apply_event(p_event_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.gateway_webhook_events%rowtype;
  p jsonb;
  v_ref text;
  c public.charges%rowtype;
  v_link text;
  v_other boolean;
  v_rec public.payment_receipts%rowtype;
begin
  select * into e from public.gateway_webhook_events w where w.id = p_event_id;

  -- Chave e situação da conta: aviso ao Admin.
  if e.event like 'ACCESS_TOKEN_%' or e.event like 'ACCOUNT_STATUS_%' then
    perform public._gateway_notify_admins(e.account_id, lower(e.event), e.asaas_event_id,
      'Asaas: atenção na conta',
      'O Asaas avisou: ' || e.event || '. Confira a conta na Central de Configuração.');
    return 'aviso_admin';
  end if;
  if e.event not like 'PAYMENT_%' then return 'sem_efeito'; end if;
  if e.event like 'PAYMENT_SPLIT_%' then return 'registrado_asa3'; end if;

  p := e.payload->'payment';
  if p is null then return 'ignorado_sem_cobranca'; end if;
  v_ref := p->>'externalReference';
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'ignorado_fora_do_riszon';
  end if;
  select * into c from public.charges ch where ch.id = v_ref::uuid and ch.gateway_account_id = e.account_id for update;
  if not found then return 'ignorado_fora_do_riszon'; end if;
  if c.asaas_payment_id is not null and c.asaas_payment_id <> coalesce(p->>'id', '') then
    return 'ignorado_outra_cobranca';
  end if;
  update public.gateway_webhook_events set charge_id = c.id where id = e.id;
  if c.asaas_payment_id is null then
    update public.charges set asaas_payment_id = p->>'id' where id = c.id;
  end if;
  v_link := '/prontuarios/' || c.client_id::text;

  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    return public._gateway_on_paid(c.id, case when e.event = 'PAYMENT_CONFIRMED' then 'PAYMENT_CONFIRMED' else 'PAYMENT_RECEIVED' end, p);

  elsif e.event = 'PAYMENT_OVERDUE' then
    if c.status = 'emitida' then
      update public.charges set status = 'vencida', last_event_at = now() where id = c.id;
      return 'vencida';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_DELETED' then
    if c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
      update public.charges
         set status = 'cancelada', cancelled_at = now(), cancelled_by = null,
             cancel_reason = 'Apagada no painel do Asaas', last_event_at = now()
       where id = c.id;
      perform public._gateway_notify(c.gateway_account_id, 'apagada_no_asaas', c.id::text, c.clinic_id, true, false, true,
        'Cobrança apagada no Asaas',
        'Uma cobrança emitida pelo riSZon foi apagada direto no painel do Asaas. A parcela voltou a aceitar nova cobrança.',
        v_link);
      return 'cancelada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_RESTORED' then
    select exists (
      select 1 from public.charges o
       where o.payment_installment_id = c.payment_installment_id and o.id <> c.id
         and o.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa')
    ) into v_other;
    if c.status = 'cancelada' and c.cancel_reason = 'Apagada no painel do Asaas' and not v_other
       and exists (select 1 from public.payment_installments i
                    where i.id = c.payment_installment_id and i.status in ('em_aberto', 'parcial')) then
      update public.charges
         set status = case when c.due_date < public.today_br() then 'vencida' else 'emitida' end,
             cancelled_at = null, cancel_reason = null, last_event_at = now()
       where id = c.id;
      return 'restaurada';
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'restaurada_no_asaas', c.id::text, c.clinic_id, true, false, true,
      'Cobrança restaurada no Asaas',
      'Uma cobrança foi restaurada no painel do Asaas, mas a parcela já tem outra cobrança ou não está em aberto. Confira e cancele a que sobrar.',
      v_link);
    return 'restaurada_so_aviso';

  elsif e.event = 'PAYMENT_UPDATED' then
    if round(coalesce((p->>'value')::numeric, 0) * 100) <> coalesce(c.value_cents, 0)
       or (p->>'dueDate')::date is distinct from c.due_date then
      perform public._gateway_notify(c.gateway_account_id, 'alterada_no_asaas', e.asaas_event_id, c.clinic_id, true, false, true,
        'Cobrança alterada no Asaas',
        'Uma cobrança emitida pelo riSZon teve valor ou vencimento alterado direto no painel do Asaas. O riSZon não segue a mudança; o pagamento segue a regra do valor a maior ou a menor.',
        v_link);
      return 'alterada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_REFUNDED' then
    -- 4018: a mensalidade estornada continua como paga; a unidade decide desfazer a baixa.
    if c.source_type <> 'installment' then
      if c.status in ('paga', 'liquidada', 'em_contestacao') then
        update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
      end if;
      perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
        'Estorno de mensalidade no Asaas',
        'Uma mensalidade paga pelo Asaas foi estornada. Ela continua marcada como paga: desfaça a baixa à mão, se for o caso.',
        v_link);
      return 'estornada';
    end if;
    if c.receipt_id is not null then
      select * into v_rec from public.payment_receipts r where r.id = c.receipt_id;
      if not v_rec.reversed then
        perform public._gateway_reverse_receipt(c.receipt_id, 'Estorno no Asaas');
      end if;
    end if;
    if c.status in ('paga', 'liquidada', 'em_contestacao') then
      update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
      'Estorno no Asaas',
      'Um pagamento pelo Asaas foi estornado. A baixa foi desfeita e a parcela voltou a ficar em aberto; a taxa da rede continua devida (pode ser dispensada pelo Financeiro).',
      v_link);
    return 'estornada';

  elsif e.event in ('PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE') then
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), e.asaas_event_id, c.clinic_id, true, true, true,
      'Asaas: estorno para tratar à mão',
      'O Asaas avisou ' || e.event || ' numa cobrança do riSZon. O Financeiro trata à mão.',
      v_link);
    return 'aviso_manual';

  elsif e.event in ('PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL') then
    if c.status in ('paga', 'liquidada') then
      update public.charges set status = 'em_contestacao', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), c.id::text, c.clinic_id, true, true, true,
      'Contestação no cartão',
      'O pagador contestou no cartão uma cobrança do riSZon (' || e.event || '). O Financeiro acompanha e trata à mão.',
      v_link);
    return 'contestacao';
  end if;

  return 'sem_efeito';
end;
$function$;

CREATE OR REPLACE FUNCTION public._split_charge_born_retained()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ref text;
  v_charge uuid;
begin
  if new.reversed then return new; end if;
  -- 4018: a taxa de uma mensalidade paga pelo Asaas com split nasce retida.
  if new.source_type <> 'receipt' then
    select ch.id into v_charge
      from public.charges ch
     where ch.source_type = new.source_type and ch.source_id = new.source_id and ch.split_applied
       and ch.status in ('paga', 'liquidada')
       and exists (select 1 from public.charge_splits cs
                    where cs.charge_id = ch.id and cs.fees ? new.fee and cs.status not in ('cancelado', 'recusado'))
     order by ch.created_at desc limit 1;
    if v_charge is not null then
      new.charge_id := v_charge;
      new.retained_cents := new.amount_cents;
    end if;
    return new;
  end if;
  if new.receipt_id is null then return new; end if;
  select r.reference into v_ref from public.payment_receipts r where r.id = new.receipt_id;
  if v_ref is null or v_ref not like 'Asaas %' then return new; end if;
  select ch.id into v_charge
    from public.charges ch
   where ch.asaas_payment_id = substr(v_ref, 7) and ch.split_applied
     and exists (select 1 from public.charge_splits cs
                  where cs.charge_id = ch.id and cs.fees ? new.fee
                    and cs.status not in ('cancelado', 'recusado'))
   limit 1;
  if v_charge is not null then
    new.charge_id := v_charge;
    new.retained_cents := new.amount_cents;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public._gateway_split_retention(p_charge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.charges%rowtype;
  v_tol bigint;
  v_short bigint := 0;
  s record;
  w record;
  v_new bigint;
  v_settled date;
  v_touched text[] := '{}';
  v_key text;
  v_frozen boolean;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or not c.split_applied then return; end if;
  if c.receipt_id is null and c.source_id is null then return; end if;
  select tolerance_cents into v_tol from public.gateway_split_settings where id;
  v_tol := coalesce(v_tol, 10);

  update public.split_charges set charge_id = c.id
   where ((c.receipt_id is not null and source_type = 'receipt' and source_id = c.receipt_id)
       or (c.source_id is not null and source_type = c.source_type and source_id = c.source_id))
     and charge_id is distinct from c.id;

  for w in
    select cs.*,
           (select coalesce(sum(sc.amount_cents), 0) from public.split_charges sc
             where sc.charge_id = c.id and not sc.reversed and cs.fees ? sc.fee) as expected
      from public.charge_splits cs where cs.charge_id = c.id
  loop
    if w.status = 'liquidado' and w.settled_cents is not null then
      v_short := v_short + greatest(w.expected - w.settled_cents, 0);
      if w.settled_cents > w.expected and w.excess_cents is distinct from (w.settled_cents - w.expected) then
        update public.charge_splits set excess_cents = w.settled_cents - w.expected, updated_at = now() where id = w.id;
        perform public._gateway_notify(c.gateway_account_id, 'repasse_a_maior', w.id::text, c.clinic_id, false, true, true,
          'Split: repasse acima do devido',
          'Uma cobrança repassou à rede mais do que as taxas vigentes no dia do pagamento (provável mudança de taxa com a cobrança em aberto). Confira no Painel de repasses e decida entre abater ou dispensar.',
          '/prontuarios/' || c.client_id::text);
      end if;
    end if;
  end loop;
  -- 18.7.2: paga enquanto esperava a fila só por tarifa — a falta é absorvida.
  if c.split_absorb_tariff then v_short := 0; end if;

  for s in
    select sc.*, cs.status as w_status, cs.settled_cents as w_settled, cs.settled_at as w_settled_at,
           (select coalesce(sum(x.amount_cents), 0) from public.split_charges x
             where x.charge_id = c.id and not x.reversed and cs.fees ? x.fee) as w_expected
      from public.split_charges sc
      left join public.charge_splits cs on cs.charge_id = c.id and cs.fees ? sc.fee
     where sc.charge_id = c.id
  loop
    v_frozen := s.w_status = 'liquidado' and exists (
      select 1 from public.financial_entries f
       where f.source_type = 'split_retained' and f.source_id = s.id and f.status = 'settled');
    continue when v_frozen;
    v_new := case
      when s.reversed or s.w_status is null then 0
      when s.w_status in ('cancelado', 'recusado', 'estornado') then 0
      when s.w_status = 'liquidado' and s.w_settled is not null and v_short > v_tol and s.w_expected > 0
        then floor(s.amount_cents * least(s.w_settled, s.w_expected)::numeric / s.w_expected)::bigint
      else s.amount_cents
    end;
    v_settled := case when s.w_status = 'liquidado' then (s.w_settled_at at time zone 'America/Sao_Paulo')::date end;
    if v_new is distinct from s.retained_cents then
      update public.split_charges set retained_cents = v_new where id = s.id;
      v_key := s.fee || '|' || s.period_month::text;
      if not (v_key = any (v_touched)) then v_touched := v_touched || v_key; end if;
    end if;
    if v_new > 0 or exists (select 1 from public.financial_entries f where f.source_type = 'split_retained' and f.source_id = s.id) then
      perform public._gateway_split_ledger(s.id, v_settled);
    end if;
  end loop;

  foreach v_key in array v_touched loop
    perform public.refresh_network_fee_payable(c.clinic_id, split_part(v_key, '|', 1), split_part(v_key, '|', 2)::date);
  end loop;
end;
$function$;

-- O selo "Em atraso" (19.32.6 item 5): as mensalidades vencidas de cada origem.
create or replace function public._fee_sources_overdue(p_client_ids uuid[], p_cutoff date)
returns table (client_id uuid, clinic_id uuid, due_date date)
language plpgsql stable security definer set search_path = ''
as $$
declare
  t record;
begin
  for t in select * from public.charge_source_types order by sort_order loop
    return query execute format('select * from public.%I($1, $2)', t.overdue_fn) using p_client_ids, p_cutoff;
  end loop;
end;
$$;
revoke execute on function public._fee_sources_overdue(uuid[], date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_overdue_badges(p_client_ids uuid[])
 RETURNS TABLE(client_id uuid, days_late integer, oldest_due date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_clinics uuid[] := public._gateway_cap_clinics('acao.cobranca.selo_atraso');
  v_cutoff date := public.overdue_badge_cutoff();
begin
  if p_client_ids is null or coalesce(array_length(p_client_ids, 1), 0) = 0 then return; end if;
  if coalesce(array_length(p_client_ids, 1), 0) > 1000 then raise exception 'TOO_MANY'; end if;
  if v_clinics is not null and coalesce(array_length(v_clinics, 1), 0) = 0 then return; end if;

  -- 4018: a parcela E a mensalidade vencidas (a mesma regra de dias úteis e a mesma permissão).
  return query
  select x.client_id,
         (public.today_br() - min(x.due_date))::integer,
         min(x.due_date)
    from (
      select pi.client_id, pi.clinic_id, pi.due_date
        from public.payment_installments pi
       where pi.client_id = any (p_client_ids)
         and pi.status in ('em_aberto', 'parcial')
         and pi.due_date <= v_cutoff
      union all
      select f.client_id, f.clinic_id, f.due_date from public._fee_sources_overdue(p_client_ids, v_cutoff) f
    ) x
   where (v_clinics is null or x.clinic_id = any (v_clinics))
   group by x.client_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 8) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from public.charge_source_types) as origens_registradas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_fee_charges_due', '_fee_charge_prepare_system', '_gateway_on_paid_source', '_fee_source_lock', 'fee_live_charges',
      'fee_charges_read', '_charge_source_visible', '_fees_unit_from', '_fee_sources_overdue', 'fees_switch_preview', 'fees_switch_set',
      '_ppr_fees_due', '_ppr_fee_info', '_ppr_fee_settle', '_ppr_fees_overdue', '_ppr_fee_visible', '_ppr_charge_settle',
      '_ppr_generate_run', '_ppr_generate_next', '_ppr_generate_next_first', 'ppr_overdue_keep', 'ppr_membership_switch_method',
      '_ortho_fees_due', '_ortho_fee_info', '_ortho_fee_settle', '_ortho_fees_overdue', '_ortho_fee_visible', '_ortho_charge_settle',
      'ortho_case_switch_method')) as funcoes_novas,
  (select count(*) from public.gateway_auto_charge_units where fees_enabled_from is not null) as unidades_com_mensalidades_ligadas,
  (select count(*) from public.charges where source_id is not null) as cobrancas_de_mensalidade;
