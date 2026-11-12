-- =============================================================================
-- 4006 — ASA2, ENTREGA 2: SELO "EM ATRASO" E PAINEL DE COBRANÇAS
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 12/11/2026: docs/integracao-asaas.md, seção 17.
--
--   * SELO "EM ATRASO" (17.1): a parcela em aberto conta como "em atraso" só
--     depois de N DIAS ÚTEIS do vencimento (rede; padrão 3). Dias úteis: fora
--     sábado, domingo e feriado NACIONAL (a compensação bancária). Multa e
--     juros não mudam. `overdue_badge_cutoff()` devolve o último vencimento que
--     já conta como atraso hoje — UMA regra para o selo, o aviso da ficha, o
--     número da aba Financeiro e o filtro da lista de prontuários.
--   * `client_overdue_badges(ids)`: "em atraso há N dias" (N desde o
--     vencimento), SEM valor, só das unidades em que quem pergunta pode ver o
--     selo. Duas etapas por permissão (`acao.cobranca.selo_atraso`): nasce com
--     Gerente e Franqueado (o Admin sempre); o dono libera depois Recepcionista,
--     Consultor e Assistente Comercial e Financeiro da Franqueadora. Dentista,
--     Planner, TSB, ASB e SDR NUNCA veem, mesmo marcados na matriz.
--   * PAINEL DE COBRANÇAS (17.2), permissão `modulo.painel_cobrancas`: nasce só
--     com o Admin (a integração está em testes). Quem pode ser liberado:
--     Gerente e Franqueado (a própria unidade) e Financeiro da Franqueadora (a
--     rede). A Recepcionista nunca. "A receber do Asaas" e "Cobranças
--     emitidas"; cada planilha baixada vai para a auditoria com os filtros.
--   * A taxa do Asaas e o líquido passam a ficar na cobrança (`fee_cents`,
--     `net_cents`), gravados quando o aviso de pagamento é processado; as
--     antigas são preenchidas pelos avisos já guardados.
--
-- ⚠️ As permissões deste arquivo LEEM a `permission_matrix` (como a 0340 e a
-- Central): mudar o papel em Administração › Permissões muda o banco também.
-- Toda função interna responde SÓ à chave de serviço.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A TOLERÂNCIA DO SELO (rede) E O CORTE DO DIA
-- -----------------------------------------------------------------------------
alter table public.finance_settings
  add column if not exists overdue_badge_business_days integer;
alter table public.finance_settings
  drop constraint if exists finance_settings_overdue_badge_days_check;
alter table public.finance_settings
  add constraint finance_settings_overdue_badge_days_check
  check (overdue_badge_business_days is null or overdue_badge_business_days between 0 and 15);
comment on column public.finance_settings.overdue_badge_business_days is
  'Dias ÚTEIS depois do vencimento até a parcela contar como "em atraso" no selo, no aviso da ficha e no filtro de prontuários (rede; padrão 3). Multa e juros não mudam (4006).';
update public.finance_settings
   set overdue_badge_business_days = 3
 where clinic_id is null and overdue_badge_business_days is null;

create or replace function public._overdue_badge_business_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.overdue_badge_business_days from public.finance_settings s where s.clinic_id is null limit 1),
    3);
$$;
revoke execute on function public._overdue_badge_business_days() from public, anon, authenticated;

-- O último vencimento que já conta como "em atraso" hoje: o maior D com
-- D + N dias úteis < hoje. Não revela dado de ninguém (é só uma data).
create or replace function public.overdue_badge_cutoff()
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
  v_n integer := public._overdue_badge_business_days();
  v_d date := public.today_br() - 1;
begin
  while public._payout_add_business_days(v_d, v_n) >= v_today loop
    v_d := v_d - 1;
  end loop;
  return v_d;
end;
$$;
revoke execute on function public.overdue_badge_cutoff() from public, anon, authenticated;
grant execute on function public.overdue_badge_cutoff() to authenticated;

-- -----------------------------------------------------------------------------
-- 2) QUEM PODE — a matriz, com os papéis que NUNCA podem
-- -----------------------------------------------------------------------------
-- Padrões de fábrica (iguais a `src/lib/permissions.ts`; há teste comparando).
create or replace function public._gateway_cap_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'acao.cobranca.selo_atraso' then array['unit_manager','franchisee']::public.user_role[]
    when 'modulo.painel_cobrancas' then '{}'::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._gateway_cap_default_roles(text) from public, anon, authenticated;

-- Os únicos papéis que a capacidade PODE alcançar, marcados ou não na matriz
-- (decisão do dono, 17.1 e 17.2). Fora desta lista, nunca.
create or replace function public._gateway_cap_ceiling(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'acao.cobranca.selo_atraso' then
      array['unit_manager','franchisee','receptionist','commercial_consultant',
            'commercial_assistant','finance_franchisor']::public.user_role[]
    when 'modulo.painel_cobrancas' then
      array['unit_manager','franchisee','finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._gateway_cap_ceiling(text) from public, anon, authenticated;

-- As unidades em que quem pergunta tem a capacidade. NULL = todas (Admin, ou
-- papel da Franqueadora com acesso à rede).
create or replace function public._gateway_cap_clinics(p_capability text)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_matrix boolean;
  v_allowed public.user_role[];
  v_ids uuid[] := '{}';
  r record;
begin
  if v_uid is null then return '{}'; end if;
  if public.is_admin_master() or public.is_owner() then return null; end if;

  select exists (select 1 from public.permission_matrix) into v_matrix;
  if v_matrix then
    select coalesce(array_agg(pm.role), '{}') into v_allowed
      from public.permission_matrix pm
     where pm.capability = p_capability and pm.allowed;
  else
    v_allowed := public._gateway_cap_default_roles(p_capability);
  end if;
  -- O teto: papel fora dele não conta, mesmo marcado.
  select coalesce(array_agg(x), '{}') into v_allowed
    from unnest(v_allowed) x
   where x = any (public._gateway_cap_ceiling(p_capability));

  -- O Financeiro da Franqueadora vê a rede inteira, como em todo o financeiro
  -- (`can_see_clinic_finance`), sem depender do escopo de unidades.
  if 'finance_franchisor' = any (v_allowed) and exists (
       select 1 from public.user_clinic_roles ucr
        where ucr.user_id = v_uid and ucr.role = 'finance_franchisor') then
    return null;
  end if;

  for r in
    select ucr.clinic_id, c.type
      from public.user_clinic_roles ucr
      join public.clinics c on c.id = ucr.clinic_id
     where ucr.user_id = v_uid and ucr.role = any (v_allowed)
  loop
    if r.type = 'franchisor' then
      -- Papel da Franqueadora alcança as unidades do escopo dela.
      v_ids := v_ids || array(select public.user_full_access_clinic_ids());
    else
      v_ids := v_ids || r.clinic_id;
    end if;
  end loop;
  return array(select distinct x from unnest(v_ids) x);
end;
$$;
revoke execute on function public._gateway_cap_clinics(text) from public, anon, authenticated;

-- A semente: com a matriz gravada (produção e treino), a capacidade nova nasce
-- com o padrão de fábrica; o padrão fixado (0292) também.
do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select cap, r
      from (values ('acao.cobranca.selo_atraso'), ('modulo.painel_cobrancas')) as caps(cap)
      cross join lateral unnest(public._gateway_cap_default_roles(cap)) as r
    on conflict (capability, role) do nothing;
  end if;
end;
$$;
insert into public.permission_defaults (capability, roles)
select cap, public._gateway_cap_default_roles(cap)
  from (values ('acao.cobranca.selo_atraso'), ('modulo.painel_cobrancas')) as caps(cap)
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 3) O SELO — "em atraso há N dias", sem valor
-- -----------------------------------------------------------------------------
create or replace function public.client_overdue_badges(p_client_ids uuid[])
returns table (client_id uuid, days_late integer, oldest_due date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinics uuid[] := public._gateway_cap_clinics('acao.cobranca.selo_atraso');
  v_cutoff date := public.overdue_badge_cutoff();
begin
  if p_client_ids is null or coalesce(array_length(p_client_ids, 1), 0) = 0 then return; end if;
  if coalesce(array_length(p_client_ids, 1), 0) > 1000 then raise exception 'TOO_MANY'; end if;
  if v_clinics is not null and coalesce(array_length(v_clinics, 1), 0) = 0 then return; end if;

  return query
  select pi.client_id,
         (public.today_br() - min(pi.due_date))::integer,
         min(pi.due_date)
    from public.payment_installments pi
   where pi.client_id = any (p_client_ids)
     and pi.status in ('em_aberto', 'parcial')
     and pi.due_date <= v_cutoff
     and (v_clinics is null or pi.clinic_id = any (v_clinics))
   group by pi.client_id;
end;
$$;
revoke execute on function public.client_overdue_badges(uuid[]) from public, anon, authenticated;
grant execute on function public.client_overdue_badges(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) TAXA E LÍQUIDO NA COBRANÇA
-- -----------------------------------------------------------------------------
alter table public.charges add column if not exists fee_cents bigint;
alter table public.charges add column if not exists net_cents bigint;
comment on column public.charges.fee_cents is 'Taxa do Asaas desta cobrança (valor pago − líquido do aviso) (4006).';
comment on column public.charges.net_cents is 'Valor líquido que o Asaas credita (netValue do aviso) (4006).';

-- Quando o aviso de pagamento termina de ser processado, o líquido e a taxa
-- vão para a cobrança. Só cobrança que deu baixa por este pagamento.
create or replace function public._gateway_event_store_net()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_net numeric := (new.payload->'payment'->>'netValue')::numeric;
  v_value numeric := (new.payload->'payment'->>'value')::numeric;
begin
  if new.charge_id is null or v_net is null or v_value is null then return new; end if;
  if new.payload->>'event' not in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    return new;
  end if;
  update public.charges c
     set net_cents = round(v_net * 100),
         fee_cents = round(v_value * 100) - round(v_net * 100)
   where c.id = new.charge_id
     and c.receipt_id is not null
     and c.asaas_payment_id = new.payload->'payment'->>'id';
  return new;
end;
$$;
revoke execute on function public._gateway_event_store_net() from public, anon, authenticated;

drop trigger if exists gateway_webhook_events_store_net on public.gateway_webhook_events;
create trigger gateway_webhook_events_store_net
  after update of processed_at on public.gateway_webhook_events
  for each row
  when (old.processed_at is null and new.processed_at is not null)
  execute function public._gateway_event_store_net();

-- As antigas: o último aviso de pagamento já processado de cada cobrança.
update public.charges c
   set net_cents = round((e.payload->'payment'->>'netValue')::numeric * 100),
       fee_cents = round((e.payload->'payment'->>'value')::numeric * 100)
                   - round((e.payload->'payment'->>'netValue')::numeric * 100)
  from (
    select distinct on (w.charge_id) w.charge_id, w.payload
      from public.gateway_webhook_events w
     where w.charge_id is not null
       and w.processed_at is not null
       and w.payload->>'event' in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED')
       and w.payload->'payment'->>'netValue' is not null
     order by w.charge_id, w.received_at desc
  ) e
 where c.id = e.charge_id
   and c.receipt_id is not null
   and c.net_cents is null
   and c.asaas_payment_id = e.payload->'payment'->>'id';

-- -----------------------------------------------------------------------------
-- 5) O PAINEL DE COBRANÇAS
-- -----------------------------------------------------------------------------
-- "A receber do Asaas": pagas e ainda não liquidadas.
create or replace function public.gateway_receivables_due(p_clinic_id uuid)
returns table (
  charge_id uuid, clinic_id uuid, clinic_name text, client_id uuid, client_name text,
  billing_type text, paid_on date, credit_date date,
  paid_cents bigint, fee_cents bigint, net_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinics uuid[] := public._gateway_cap_clinics('modulo.painel_cobrancas');
begin
  if v_clinics is not null and coalesce(array_length(v_clinics, 1), 0) = 0 then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_clinic_id is not null and v_clinics is not null and not (p_clinic_id = any (v_clinics)) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
  select ch.id, ch.clinic_id, cl.name, ch.client_id, c.full_name,
         ch.billing_type, ch.paid_on, ch.credit_date,
         ch.paid_cents, ch.fee_cents, ch.net_cents
    from public.charges ch
    join public.clinics cl on cl.id = ch.clinic_id
    left join public.clients c on c.id = ch.client_id
   where ch.status = 'paga'
     and (p_clinic_id is null or ch.clinic_id = p_clinic_id)
     and (v_clinics is null or ch.clinic_id = any (v_clinics))
   order by ch.credit_date nulls last, cl.name, c.full_name;
end;
$$;
revoke execute on function public.gateway_receivables_due(uuid) from public, anon, authenticated;
grant execute on function public.gateway_receivables_due(uuid) to authenticated;

-- "Cobranças emitidas": todas as emitidas pelo riSZon, com filtros. A planilha
-- (p_export) lê por aqui também, e a leitura vira registro de auditoria.
create or replace function public.gateway_charges_list(
  p_clinic_id uuid,
  p_statuses text[],
  p_billing_types text[],
  p_date_field text,
  p_from date,
  p_to date,
  p_export boolean default false
)
returns table (
  charge_id uuid, clinic_id uuid, clinic_name text, client_id uuid, client_name text,
  installment_seq integer, billing_type text, status text, is_overdue_reissue boolean,
  issued_at timestamptz, due_date date, value_cents bigint, paid_cents bigint,
  paid_on date, credit_date date, fee_cents bigint, net_cents bigint, invoice_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinics uuid[] := public._gateway_cap_clinics('modulo.painel_cobrancas');
  v_field text := coalesce(p_date_field, 'emissao');
  v_limit integer := case when p_export then 20000 else 1000 end;
  v_n integer;
begin
  if v_clinics is not null and coalesce(array_length(v_clinics, 1), 0) = 0 then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_clinic_id is not null and v_clinics is not null and not (p_clinic_id = any (v_clinics)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_field not in ('emissao', 'vencimento', 'pagamento') then
    raise exception 'INVALID_DATE_FIELD';
  end if;

  if p_export then
    select count(*) into v_n
      from public.charges ch
     where (p_clinic_id is null or ch.clinic_id = p_clinic_id)
       and (v_clinics is null or ch.clinic_id = any (v_clinics))
       and (p_statuses is null or ch.status = any (p_statuses))
       and (p_billing_types is null or ch.billing_type = any (p_billing_types))
       and (p_from is null or (case v_field when 'emissao' then (ch.issued_at at time zone 'America/Sao_Paulo')::date
                                            when 'vencimento' then ch.due_date else ch.paid_on end) >= p_from)
       and (p_to is null or (case v_field when 'emissao' then (ch.issued_at at time zone 'America/Sao_Paulo')::date
                                          when 'vencimento' then ch.due_date else ch.paid_on end) <= p_to);
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values ((select auth.uid()), p_clinic_id, 'export', 'gateway_charges_panel', null,
            jsonb_build_object(
              'planilha', 'Cobranças emitidas',
              'unidade', p_clinic_id,
              'situacoes', p_statuses,
              'meios', p_billing_types,
              'data', v_field,
              'de', p_from,
              'ate', p_to,
              'linhas', least(v_n, v_limit)));
  end if;

  return query
  select ch.id, ch.clinic_id, cl.name, ch.client_id, c.full_name,
         pi.seq, ch.billing_type, ch.status, ch.is_overdue_reissue,
         ch.issued_at, ch.due_date, ch.value_cents, ch.paid_cents,
         ch.paid_on, ch.credit_date, ch.fee_cents, ch.net_cents, ch.invoice_url
    from public.charges ch
    join public.clinics cl on cl.id = ch.clinic_id
    left join public.clients c on c.id = ch.client_id
    left join public.payment_installments pi on pi.id = ch.payment_installment_id
   where (p_clinic_id is null or ch.clinic_id = p_clinic_id)
     and (v_clinics is null or ch.clinic_id = any (v_clinics))
     and (p_statuses is null or ch.status = any (p_statuses))
     and (p_billing_types is null or ch.billing_type = any (p_billing_types))
     and (p_from is null or (case v_field when 'emissao' then (ch.issued_at at time zone 'America/Sao_Paulo')::date
                                          when 'vencimento' then ch.due_date else ch.paid_on end) >= p_from)
     and (p_to is null or (case v_field when 'emissao' then (ch.issued_at at time zone 'America/Sao_Paulo')::date
                                        when 'vencimento' then ch.due_date else ch.paid_on end) <= p_to)
   order by ch.issued_at desc nulls last, ch.created_at desc
   limit v_limit;
end;
$$;
revoke execute on function public.gateway_charges_list(uuid, text[], text[], text, date, date, boolean) from public, anon, authenticated;
grant execute on function public.gateway_charges_list(uuid, text[], text[], text, date, date, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select overdue_badge_business_days from public.finance_settings where clinic_id is null) as dias_uteis_do_selo,
  public.overdue_badge_cutoff() as corte_de_hoje,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'overdue_badge_cutoff', 'client_overdue_badges', 'gateway_receivables_due',
      'gateway_charges_list', '_gateway_cap_clinics', '_gateway_event_store_net')) as funcoes,
  (select count(*) from public.permission_defaults
    where capability in ('acao.cobranca.selo_atraso', 'modulo.painel_cobrancas')) as permissoes,
  (select count(*) from public.charges where receipt_id is not null and net_cents is null) as cobrancas_sem_liquido;
